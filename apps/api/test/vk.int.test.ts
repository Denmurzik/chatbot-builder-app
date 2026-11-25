import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Scenario } from '@chatbot/model';
import { createRedisConnection } from '@chatbot/queue';
import { SecretVault, tokenAad } from '@chatbot/vault';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
const GROUP_ID = 4242;
const TOKEN_1 = 'vk-good-token-one-xxxxxxxxxxxxxxxx';
const TOKEN_2 = 'vk-good-token-two-xxxxxxxxxxxxxxxx';

const validScenario: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    { id: 'msg', type: 'TEXT_MESSAGE', title: 'Привет', x: 100, y: 0, text: 'Привет!' },
    { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 200, y: 0 },
  ],
  transitions: [
    { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
    { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
  ],
};

interface VkCall {
  method: string;
  params: URLSearchParams;
}

describe('VK: подключение, публикация, Callback API и Long Poll (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  let vkServer: Server;
  let vkBase = '';
  const prefix = `test-vk-${randomUUID()}`;
  const redis = createRedisConnection(REDIS_URL);
  const prevEnv = { ...process.env };

  // Состояние мок-сервера VK
  const apiCalls: VkCall[] = [];
  let longPollQueue: unknown[] = [];

  const jobKeys = (): Promise<string[]> => redis.keys(`${prefix}:events-*:vk-*`);
  const jobsData = async (): Promise<Array<Record<string, unknown>>> => {
    const out: Array<Record<string, unknown>> = [];
    for (const key of await jobKeys()) {
      const raw = await redis.hget(key, 'data');
      if (raw) out.push(JSON.parse(raw) as Record<string, unknown>);
    }
    return out;
  };
  const waitFor = async (cond: () => Promise<boolean>, timeoutMs = 10000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Условие не выполнилось за отведённое время');
  };

  // Локальный мок VK API и Bots Long Poll сервера
  function handleVk(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', vkBase || 'http://127.0.0.1');
      const json = (body: unknown): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (url.pathname === '/lp') {
        // Long Poll: отдаём накопленные события, иначе ждём немного и возвращаем пустой ответ
        const send = (): void => {
          if (res.writableEnded) return;
          const updates = longPollQueue;
          longPollQueue = [];
          json({ ts: '1', updates });
        };
        if (longPollQueue.length > 0) send();
        else {
          const timer = setTimeout(send, 300);
          res.on('close', () => clearTimeout(timer));
        }
        return;
      }

      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const method = url.pathname.replace(/^\//, '');
      apiCalls.push({ method, params });
      const token = params.get('access_token') ?? '';
      if (!token.startsWith('vk-good')) {
        json({ error: { error_code: 5, error_msg: 'User authorization failed' } });
        return;
      }
      if (method === 'groups.getById') {
        const groupId = Number(params.get('group_id') ?? GROUP_ID);
        json({ response: { groups: [{ id: groupId, name: 'Тестовое сообщество', screen_name: 'club_test' }] } });
      } else if (method === 'groups.getLongPollServer') {
        json({ response: { key: 'lp-key', server: `${vkBase}/lp`, ts: '1' } });
      } else if (method === 'messages.sendMessageEventAnswer') {
        json({ response: 1 });
      } else {
        json({ response: 1 });
      }
    });
  }

  beforeAll(async () => {
    vkServer = createServer(handleVk);
    await new Promise<void>((resolve) => vkServer.listen(0, '127.0.0.1', resolve));
    vkBase = `http://127.0.0.1:${(vkServer.address() as AddressInfo).port}`;

    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-vk-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '1';
    process.env.VK_API_BASE_URL = vkBase;
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = REDIS_URL;
    process.env.QUEUE_PREFIX = prefix;
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    // Сначала останавливаем приложение (и Long Poll циклы), затем мок-сервер
    await app?.close();
    vkServer?.closeAllConnections();
    await new Promise<void>((resolve) => (vkServer ? vkServer.close(() => resolve()) : resolve()));
    await db?.destroy();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    process.env = prevEnv;
  });

  beforeEach(async () => {
    await db.truncateAll();
    apiCalls.length = 0;
    longPollQueue = [];
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  async function agentWithProject(email = `${randomUUID()}@example.com`) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/register').send({ email, password: 'password123' }).expect(201);
    const project = await agent.post('/api/projects').send({ name: 'Проект VK' }).expect(201);
    const projectId = project.body.id as string;
    await agent.put(`/api/projects/${projectId}/scenario`).send(validScenario).expect(200);
    return { agent, projectId };
  }

  async function createBot(agent: ReturnType<typeof request.agent>, projectId: string, name = 'Бот') {
    const res = await agent.post(`/api/projects/${projectId}/bots`).send({ name }).expect(201);
    return res.body.id as string;
  }

  const connUrl = (projectId: string, botId: string) =>
    `/api/projects/${projectId}/bots/${botId}/connections/vk`;

  const callbackBody = (token = TOKEN_1, extra: Record<string, unknown> = {}) => ({
    token,
    groupId: GROUP_ID,
    mode: 'CALLBACK',
    confirmationCode: 'conf123',
    secret: 'sec-key',
    ...extra,
  });

  // Создаёт опубликованного VK-бота в режиме Callback
  async function publishedCallbackBot() {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);
    await agent.put(connUrl(projectId, botId)).send(callbackBody()).expect(200);
    await agent.post(`/api/projects/${projectId}/bots/${botId}/publish`).expect(200);
    return { agent, projectId, botId };
  }

  const messageNew = (eventId: string, text: string, extra: Record<string, unknown> = {}) => ({
    type: 'message_new',
    group_id: GROUP_ID,
    secret: 'sec-key',
    event_id: eventId,
    object: { message: { id: 1, conversation_message_id: 1, peer_id: 2000000001, from_id: 77, text } },
    ...extra,
  });

  it('подключение VK в режиме CALLBACK: маска, шифрование, конфиг без секрета в ответе', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);

    const res = await agent.put(connUrl(projectId, botId)).send(callbackBody()).expect(200);
    expect(res.body).toMatchObject({
      messenger: 'VK',
      vkGroupId: GROUP_ID,
      vkMode: 'CALLBACK',
      vkHasSecret: true,
      vkConfirmationCode: 'conf123',
      groupName: 'Тестовое сообщество',
    });
    expect(res.body.tokenMask).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(TOKEN_1);
    expect(JSON.stringify(res.body)).not.toContain('sec-key');

    const stored = await db.prisma.messengerConnection.findFirstOrThrow({ where: { botId, messenger: 'VK' } });
    const vault = SecretVault.fromEnv();
    expect(stored.tokenCipher).not.toContain(TOKEN_1);
    expect(
      vault.decrypt({ cipherText: stored.tokenCipher, mask: stored.tokenMask }, tokenAad(botId, 'VK')),
    ).toBe(TOKEN_1);
    expect(JSON.stringify(stored.config)).not.toContain('sec-key');

    const list = await agent.get(`/api/projects/${projectId}/bots`).expect(200);
    expect(list.body[0].connections[0]).toMatchObject({ messenger: 'VK' });
  });

  it('подключение VK в режиме LONG_POLL без confirmationCode; CALLBACK без кода -> 400', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);

    await agent
      .put(connUrl(projectId, botId))
      .send({ token: TOKEN_1, groupId: GROUP_ID, mode: 'CALLBACK' })
      .expect(400);

    const res = await agent
      .put(connUrl(projectId, botId))
      .send({ token: TOKEN_1, groupId: GROUP_ID, mode: 'LONG_POLL' })
      .expect(200);
    expect(res.body).toMatchObject({ messenger: 'VK', vkMode: 'LONG_POLL', vkHasSecret: false });
  });

  it('недействительный токен -> 400, запись не создаётся', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);
    const res = await agent.put(connUrl(projectId, botId)).send(callbackBody('bad-token')).expect(400);
    expect(res.body.message).toContain('недействителен');
    expect(await db.prisma.messengerConnection.count()).toBe(0);
  });

  it('дубликат токена у другого бота -> 409; тот же бот может повторить', async () => {
    const { agent, projectId } = await agentWithProject();
    const botA = await createBot(agent, projectId, 'A');
    const botB = await createBot(agent, projectId, 'B');
    await agent.put(connUrl(projectId, botA)).send(callbackBody()).expect(200);
    const conflict = await agent.put(connUrl(projectId, botB)).send(callbackBody()).expect(409);
    expect(conflict.body.message).toBe('Токен уже используется другим ботом');
    await agent.put(connUrl(projectId, botA)).send(callbackBody()).expect(200);
    await agent.put(connUrl(projectId, botB)).send(callbackBody(TOKEN_2)).expect(200);
  });

  it('публикация VK-only бота: статус PUBLISHED', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);
    await agent.put(connUrl(projectId, botId)).send(callbackBody()).expect(200);
    const res = await agent.post(`/api/projects/${projectId}/bots/${botId}/publish`).expect(200);
    expect(res.body.bot).toMatchObject({ id: botId, status: 'PUBLISHED' });
    expect(res.body.bot.connections).toEqual([expect.objectContaining({ messenger: 'VK' })]);
  });

  it('webhook: confirmation возвращает confirmationCode; неверный secret и group_id -> 403', async () => {
    const { botId } = await publishedCallbackBot();
    const server = app.getHttpServer();

    const ok = await request(server)
      .post(`/webhook/vk/${botId}`)
      .send({ type: 'confirmation', group_id: GROUP_ID, secret: 'sec-key' })
      .expect(200);
    expect(ok.text).toBe('conf123');

    await request(server)
      .post(`/webhook/vk/${botId}`)
      .send({ type: 'confirmation', group_id: GROUP_ID, secret: 'wrong' })
      .expect(403);
    await request(server)
      .post(`/webhook/vk/${botId}`)
      .send({ type: 'confirmation', group_id: GROUP_ID })
      .expect(403);
    await request(server)
      .post(`/webhook/vk/${botId}`)
      .send({ type: 'confirmation', group_id: GROUP_ID + 1, secret: 'sec-key' })
      .expect(403);
    await request(server)
      .post(`/webhook/vk/${randomUUID()}`)
      .send({ type: 'confirmation', group_id: GROUP_ID, secret: 'sec-key' })
      .expect(404);
    expect(await jobKeys()).toHaveLength(0);
  });

  it('webhook message_new: /start, Начать и обычный текст ставят ChatEvent с vk:<peerId>', async () => {
    const { botId } = await publishedCallbackBot();
    const server = app.getHttpServer();

    for (const [id, text] of [
      ['e-start', '/start'],
      ['e-begin', 'Начать'],
      ['e-text', 'Привет, бот'],
    ] as const) {
      const res = await request(server).post(`/webhook/vk/${botId}`).send(messageNew(id, text)).expect(200);
      expect(res.text).toBe('ok');
    }
    // Повторная доставка не задваивает задание
    await request(server).post(`/webhook/vk/${botId}`).send(messageNew('e-text', 'Привет, бот')).expect(200);
    // Неверный secret не ставит событие
    await request(server)
      .post(`/webhook/vk/${botId}`)
      .send(messageNew('e-bad', 'x', { secret: 'wrong' }))
      .expect(403);

    const jobs = await jobsData();
    expect(jobs).toHaveLength(3);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'START_COMMAND', botId, chatId: 'vk:2000000001', userId: 'vk:77' }),
        expect.objectContaining({ type: 'TEXT_MESSAGE', botId, chatId: 'vk:2000000001', payload: 'Привет, бот' }),
      ]),
    );
    expect(jobs.filter((j) => j.type === 'START_COMMAND')).toHaveLength(2);
  });

  it('webhook message_event: BUTTON_PRESS и вызов messages.sendMessageEventAnswer', async () => {
    const { botId } = await publishedCallbackBot();
    await request(app.getHttpServer())
      .post(`/webhook/vk/${botId}`)
      .send({
        type: 'message_event',
        group_id: GROUP_ID,
        secret: 'sec-key',
        object: {
          user_id: 77,
          peer_id: 77,
          event_id: 'btn-1',
          payload: { callbackData: 'q1:0' },
        },
      })
      .expect(200);

    const jobs = await jobsData();
    expect(jobs).toEqual([
      expect.objectContaining({
        type: 'BUTTON_PRESS',
        botId,
        chatId: 'vk:77',
        userId: 'vk:77',
        payload: 'q1:0',
        sourceBlockId: 'q1',
      }),
    ]);
    const answer = apiCalls.find((c) => c.method === 'messages.sendMessageEventAnswer');
    expect(answer).toBeDefined();
    expect(answer?.params.get('event_id')).toBe('btn-1');
    expect(answer?.params.get('access_token')).toBe(TOKEN_1);
  });

  it('неопубликованный бот: webhook отвечает 200 без постановки', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);
    await agent.put(connUrl(projectId, botId)).send(callbackBody()).expect(200);
    await request(app.getHttpServer())
      .post(`/webhook/vk/${botId}`)
      .send(messageNew('e1', 'привет'))
      .expect(200);
    expect(await jobKeys()).toHaveLength(0);
  });

  it('отключение VK: запись удалена, webhook -> 404', async () => {
    const { agent, projectId, botId } = await publishedCallbackBot();
    await agent.delete(connUrl(projectId, botId)).expect(204);
    expect(await db.prisma.messengerConnection.count({ where: { botId, messenger: 'VK' } })).toBe(0);
    await request(app.getHttpServer())
      .post(`/webhook/vk/${botId}`)
      .send(messageNew('e1', 'привет'))
      .expect(404);
    // Повторное отключение безопасно
    await agent.delete(connUrl(projectId, botId)).expect(204);
  });

  it('Long Poll: опубликованный бот получает событие с мок-сервера и ставит ChatEvent', async () => {
    const { agent, projectId } = await agentWithProject();
    const botId = await createBot(agent, projectId);
    await agent
      .put(connUrl(projectId, botId))
      .send({ token: TOKEN_1, groupId: GROUP_ID, mode: 'LONG_POLL' })
      .expect(200);

    longPollQueue.push(messageNew('lp-1', 'из long poll', { secret: undefined }));
    await agent.post(`/api/projects/${projectId}/bots/${botId}/publish`).expect(200);

    await waitFor(async () => (await jobKeys()).length === 1);
    const jobs = await jobsData();
    expect(jobs[0]).toMatchObject({
      type: 'TEXT_MESSAGE',
      botId,
      chatId: 'vk:2000000001',
      userId: 'vk:77',
      payload: 'из long poll',
    });
    expect(apiCalls.some((c) => c.method === 'groups.getLongPollServer')).toBe(true);

    // Отключение останавливает опрос: новые события не принимаются
    await agent.delete(connUrl(projectId, botId)).expect(204);
    longPollQueue.push(messageNew('lp-2', 'после отключения', { secret: undefined }));
    await new Promise((r) => setTimeout(r, 800));
    expect(await jobKeys()).toHaveLength(1);
  });
});
