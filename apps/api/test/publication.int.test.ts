import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Scenario } from '@chatbot/model';
import { createRedisConnection } from '@chatbot/queue';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GrammyError } from 'grammy';
import request from 'supertest';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { TelegramApiFactory } from '../src/telegram/telegram-api.factory';
import { webhookSecret } from '../src/telegram/webhook-secret';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

const TOKEN_1 = '111111:AAAA-good-token-one-xxxxxxxxxxxxxxxx';
const TOKEN_2 = '222222:BBBB-good-token-two-xxxxxxxxxxxxxxxx';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';

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

interface Call {
  token: string;
  method: 'setWebhook' | 'deleteWebhook' | 'answerCallbackQuery';
  args: unknown[];
}

describe('Публикация и переопубликация (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const redis = createRedisConnection(REDIS_URL);
  const prevEnv = { ...process.env };
  const queuePrefix = `test-pub-${randomUUID()}`;

  // Telegram подменён: вызовы записываются, setWebhook можно заставить упасть
  const calls: Call[] = [];
  let failSetWebhook = false;
  // Хук на вызов setWebhook: имитирует гонку между подключением и сохранением токена
  let onSetWebhook: ((token: string) => Promise<void>) | null = null;
  const apiFactory = {
    create: (token: string) => ({
      getMe: async () => ({ username: 'test_bot' }),
      setWebhook: async (...args: unknown[]) => {
        calls.push({ token, method: 'setWebhook', args });
        await onSetWebhook?.(token);
        if (failSetWebhook) {
          throw new GrammyError(
            'Call to setWebhook failed',
            { ok: false, error_code: 400, description: 'Bad Request: bad webhook' },
            'setWebhook',
            {},
          );
        }
      },
      deleteWebhook: async (...args: unknown[]) => {
        calls.push({ token, method: 'deleteWebhook', args });
      },
      answerCallbackQuery: async (...args: unknown[]) => {
        calls.push({ token, method: 'answerCallbackQuery', args });
      },
    }),
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-publication-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_URL = 'https://bots.example.com/';
    process.env.REDIS_URL = REDIS_URL;
    process.env.QUEUE_PREFIX = queuePrefix;
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramApiFactory)
      .useValue(apiFactory)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    process.env = prevEnv;
  });

  beforeEach(async () => {
    await db.truncateAll();
    calls.length = 0;
    failSetWebhook = false;
    onSetWebhook = null;
  });

  async function setup(opts: { valid?: boolean; connect?: boolean } = {}) {
    const { valid = true, connect = true } = opts;
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/register')
      .send({ email: `${randomUUID()}@example.com`, password: 'password123' })
      .expect(201);
    const project = await agent.post('/api/projects').send({ name: 'Проект' }).expect(201);
    const projectId = project.body.id as string;
    if (valid) await agent.put(`/api/projects/${projectId}/scenario`).send(validScenario).expect(200);
    const bot = await agent.post(`/api/projects/${projectId}/bots`).send({ name: 'Бот' }).expect(201);
    const botId = bot.body.id as string;
    if (connect) {
      await agent
        .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
        .send({ token: TOKEN_1 })
        .expect(200);
    }
    return { agent, projectId, botId, publishUrl: `/api/projects/${projectId}/bots/${botId}/publish` };
  }

  it('без cookie -> 401', async () => {
    await request(app.getHttpServer()).post('/api/projects/p/bots/b/publish').expect(401);
  });

  it('чужой автор -> 404', async () => {
    const { publishUrl } = await setup();
    const other = request.agent(app.getHttpServer());
    await other
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: 'password123' })
      .expect(201);
    await other.post(publishUrl).expect(404);
  });

  it('ошибки проверки -> 422, бот не изменился, Telegram не вызывался', async () => {
    const { agent, botId, publishUrl } = await setup({ valid: false });
    const res = await agent.post(publishUrl).expect(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'outputs_connected', severity: 'ERROR' })]),
    );
    const bot = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    expect(bot.status).toBe('CREATED');
    expect(bot.publishedScenario).toBeNull();
    expect(calls).toEqual([]);
  });

  it('нет подключения к мессенджеру -> 422', async () => {
    const { agent, publishUrl } = await setup({ connect: false });
    const res = await agent.post(publishUrl).expect(422);
    expect(res.body.errors).toEqual([expect.objectContaining({ rule: 'connections' })]);
  });

  it('успешная публикация: PUBLISHED, published_scenario, setWebhook с URL и secret_token', async () => {
    const { agent, botId, publishUrl } = await setup();
    const res = await agent.post(publishUrl).expect(200);
    expect(res.body.bot).toMatchObject({ id: botId, status: 'PUBLISHED' });
    expect(res.body.bot.publishedAt).toBeTruthy();
    expect(res.body.warnings).toEqual([]);

    const bot = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    expect(bot.status).toBe('PUBLISHED');
    expect(bot.publishedScenario).toEqual(validScenario);
    expect(bot.publishedAt).not.toBeNull();

    const hooks = calls.filter((c) => c.method === 'setWebhook');
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.token).toBe(TOKEN_1);
    expect(hooks[0]!.args).toEqual([
      `https://bots.example.com/webhook/telegram/${botId}`,
      { secret_token: webhookSecret(botId), allowed_updates: ['message', 'callback_query'] },
    ]);
  });

  it('правка сценария проекта после публикации не меняет published_scenario', async () => {
    const { agent, projectId, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    const edited: Scenario = {
      ...validScenario,
      blocks: validScenario.blocks.map((b) =>
        b.id === 'msg' && b.type === 'TEXT_MESSAGE' ? { ...b, text: 'Изменено' } : b,
      ),
    };
    await agent.put(`/api/projects/${projectId}/scenario`).send(edited).expect(200);
    const bot = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    expect(bot.publishedScenario).toEqual(validScenario);
  });

  it('переопубликация сбрасывает контексты WAITING_EXTERNAL и WAITING_USER, первая публикация их не трогает', async () => {
    const { agent, botId, publishUrl } = await setup();
    const mk = (chatId: string, state: 'WAITING_EXTERNAL' | 'WAITING_USER') =>
      db.prisma.dialogContext.create({
        data: {
          botId,
          chatId,
          userId: chatId,
          channel: 'MESSENGER',
          state,
          currentBlockId: 'msg',
          variables: { a: 1 },
        },
      });
    const waitingUser = await mk('c1', 'WAITING_USER');
    await agent.post(publishUrl).expect(200);
    expect((await db.prisma.dialogContext.findUniqueOrThrow({ where: { id: waitingUser.id } })).state).toBe(
      'WAITING_USER',
    );

    const waitingExternal = await mk('c2', 'WAITING_EXTERNAL');
    const req = await db.prisma.httpRequest.create({
      data: {
        dialogContextId: waitingExternal.id,
        blockId: 'msg',
        method: 'GET',
        url: 'http://x',
        headers: [],
        body: '',
        status: 'SENT',
      },
    });
    await db.prisma.dialogContext.update({
      where: { id: waitingExternal.id },
      data: { currentRequestId: req.id },
    });

    await agent.post(publishUrl).expect(200);
    for (const id of [waitingUser.id, waitingExternal.id]) {
      const ctx = await db.prisma.dialogContext.findUniqueOrThrow({ where: { id } });
      expect(ctx).toMatchObject({
        state: 'FINISHED',
        currentBlockId: null,
        variables: {},
        currentRequestId: null,
      });
    }
  });

  it('параллельные переопубликации обе сбрасывают контексты и завершаются успешно', async () => {
    const { agent, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    const ctx = await db.prisma.dialogContext.create({
      data: {
        botId,
        chatId: 'c-par',
        userId: 'u',
        channel: 'MESSENGER',
        state: 'WAITING_USER',
        currentBlockId: 'msg',
        variables: { a: 1 },
      },
    });
    const results = await Promise.all([agent.post(publishUrl), agent.post(publishUrl)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.prisma.dialogContext.findUniqueOrThrow({ where: { id: ctx.id } })).toMatchObject({
      state: 'FINISHED',
      currentBlockId: null,
      variables: {},
    });
  });

  it('ошибка setWebhook -> 502, статус и сценарий прежние', async () => {
    const { agent, botId, publishUrl } = await setup();
    failSetWebhook = true;
    const res = await agent.post(publishUrl).expect(502);
    expect(res.body.message).toBe('Не удалось подключить бота к Telegram: Bad Request: bad webhook');
    const bot = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    expect(bot.status).toBe('CREATED');
    expect(bot.publishedScenario).toBeNull();
    expect(bot.publishedAt).toBeNull();
  });

  it('смена токена у опубликованного бота: connect нового и disconnect старого', async () => {
    const { agent, projectId, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    calls.length = 0;
    await agent
      .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
      .send({ token: TOKEN_2 })
      .expect(200);
    expect(calls.map((c) => `${c.method}:${c.token}`)).toEqual([
      `setWebhook:${TOKEN_2}`,
      `deleteWebhook:${TOKEN_1}`,
    ]);
  });

  it('ошибка setWebhook при смене токена -> 502, прежнее подключение сохранено', async () => {
    const { agent, projectId, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    failSetWebhook = true;
    await agent
      .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
      .send({ token: TOKEN_2 })
      .expect(502);
    const rows = await db.prisma.messengerConnection.findMany({ where: { botId } });
    expect(rows).toHaveLength(1);
  });

  it('сбой сохранения токена после connect(new): откат — deleteWebhook(new) и setWebhook(old), 409', async () => {
    const { agent, projectId, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    calls.length = 0;
    // Пока подключается новый токен, другой бот успевает занять тот же токен (P2002 по token_hash)
    onSetWebhook = async (token) => {
      if (token !== TOKEN_2) return;
      onSetWebhook = null;
      const other = await db.prisma.bot.create({
        data: { projectId, name: 'Другой', environment: [] },
      });
      const vault = SecretVault.fromEnv();
      const { cipherText, mask } = vault.encrypt(TOKEN_2, tokenAad(other.id));
      await db.prisma.messengerConnection.create({
        data: {
          botId: other.id,
          messenger: 'TELEGRAM',
          tokenCipher: cipherText,
          tokenMask: mask,
          tokenHash: vault.hash(TOKEN_2),
        },
      });
    };
    const res = await agent
      .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
      .send({ token: TOKEN_2 })
      .expect(409);
    expect(res.body.message).toBe('Токен уже используется другим ботом');
    expect(calls.map((c) => `${c.method}:${c.token}`)).toEqual([
      `setWebhook:${TOKEN_2}`,
      `deleteWebhook:${TOKEN_2}`,
      `setWebhook:${TOKEN_1}`,
    ]);
    const stored = await db.prisma.messengerConnection.findFirstOrThrow({ where: { botId } });
    expect(stored.tokenHash).toBe(SecretVault.fromEnv().hash(TOKEN_1));
  });

  it('удаление бота и отключение мессенджера снимают webhook', async () => {
    const { agent, projectId, botId } = await setup();
    await agent.delete(`/api/projects/${projectId}/bots/${botId}/connections/telegram`).expect(204);
    expect(calls).toEqual([{ token: TOKEN_1, method: 'deleteWebhook', args: [] }]);

    calls.length = 0;
    await agent
      .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
      .send({ token: TOKEN_1 })
      .expect(200);
    await agent.delete(`/api/projects/${projectId}/bots/${botId}`).expect(204);
    expect(calls).toEqual([{ token: TOKEN_1, method: 'deleteWebhook', args: [] }]);
  });

  it('нажатие кнопки: событие ставится в очередь и Telegram получает answerCallbackQuery', async () => {
    const { agent, botId, publishUrl } = await setup();
    await agent.post(publishUrl).expect(200);
    calls.length = 0;
    await request(app.getHttpServer())
      .post(`/webhook/telegram/${botId}`)
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(botId))
      .send({
        update_id: 501,
        callback_query: {
          id: 'cbq-1',
          chat_instance: 'ci',
          from: { id: 7, is_bot: false, first_name: 'A' },
          data: 'msg:yes',
          message: { message_id: 1, date: 0, chat: { id: 42, type: 'private' } },
        },
      })
      .expect(200);
    await vi.waitFor(() =>
      expect(calls).toEqual([{ token: TOKEN_1, method: 'answerCallbackQuery', args: ['cbq-1'] }]),
    );
    expect(await redis.keys(`${queuePrefix}:events-*:tg-*`)).toHaveLength(1);
  });

  it('публикация возвращает предупреждение missingEnvVariable для окружения бота, но не блокирует публикацию', async () => {
    const { agent, projectId, botId, publishUrl } = await setup({ valid: false });
    const envScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'msg',
          type: 'TEXT_MESSAGE',
          title: 'Привет',
          x: 100,
          y: 0,
          text: 'API: {{env.CLINIC_URL}}',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
      ],
    };
    await agent.put(`/api/projects/${projectId}/scenario`).send(envScenario).expect(200);

    const firstPub = await agent.post(publishUrl).expect(200);
    expect(firstPub.body.bot.status).toBe('PUBLISHED');
    expect(firstPub.body.warnings).toEqual([
      {
        rule: 'missingEnvVariable',
        severity: 'WARNING',
        blockId: 'msg',
        message: 'Переменная окружения «env.CLINIC_URL» не задана в окружении',
      },
    ]);

    // После добавления переменной в окружение бота предупреждение исчезает
    await agent
      .put(`/api/projects/${projectId}/bots/${botId}/environment`)
      .send([{ name: 'CLINIC_URL', value: 'https://clinic.example.com', secret: false }])
      .expect(200);

    const secondPub = await agent.post(publishUrl).expect(200);
    expect(secondPub.body.warnings).toEqual([]);
  });
});
