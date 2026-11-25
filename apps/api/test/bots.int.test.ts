import 'reflect-metadata';
import { Prisma } from '@chatbot/db';
import { SecretVault, tokenAad } from '@chatbot/vault';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.module';
import { MessengerAdminPort } from '../src/common/messenger-admin.port';
import { PublicationController } from '../src/publication/publication.controller';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

const GOOD_TOKEN_1 = '111111:AAAA-good-token-one-xxxxxxxxxxxxxxxx';
const GOOD_TOKEN_2 = '222222:BBBB-good-token-two-xxxxxxxxxxxxxxxx';

describe('Боты, окружения и подключение Telegram (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING,
    VK_POLLING: process.env.VK_POLLING,
    NODE_ENV: process.env.NODE_ENV,
    VAULT_KEY: process.env.VAULT_KEY,
    VAULT_HASH_KEY: process.env.VAULT_HASH_KEY,
  };

  // Подмена порта мессенджера: токены с префиксом bad- недействительны
  const messengerAdmin: MessengerAdminPort = {
    verifyToken: async (_messenger, token: string) =>
      token.startsWith('bad-') ? null : { username: 'test_bot' },
    connect: async () => undefined,
    disconnect: async () => undefined,
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-bots-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MessengerAdminPort)
      .useValue(messengerAdmin)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  async function agentWithProject(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/register').send({ email, password: 'password123' }).expect(201);
    const project = await agent.post('/api/projects').send({ name: 'Проект' }).expect(201);
    return { agent, projectId: project.body.id as string };
  }

  async function createBot(agent: ReturnType<typeof request.agent>, projectId: string, name = 'Бот') {
    const res = await agent.post(`/api/projects/${projectId}/bots`).send({ name }).expect(201);
    return res.body.id as string;
  }

  it('маршруты без cookie возвращают 401', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/projects/p/bots').expect(401);
    await request(server).post('/api/projects/p/bots').send({ name: 'Б' }).expect(401);
    await request(server).delete('/api/projects/p/bots/b').expect(401);
    await request(server).put('/api/projects/p/bots/b/environment').send([]).expect(401);
    await request(server).put('/api/projects/p/environment').send([]).expect(401);
    await request(server).put('/api/projects/p/bots/b/connections/telegram').send({ token: 'x' }).expect(401);
    await request(server).delete('/api/projects/p/bots/b/connections/telegram').expect(401);
  });

  it('создание, список и удаление бота владельцем', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');

    expect((await agent.get(`/api/projects/${projectId}/bots`).expect(200)).body).toEqual([]);

    const created = await agent.post(`/api/projects/${projectId}/bots`).send({ name: 'Мой бот' }).expect(201);
    expect(created.body).toMatchObject({
      name: 'Мой бот',
      status: 'CREATED',
      publishedAt: null,
      connections: [],
      environment: [],
    });

    await agent.post(`/api/projects/${projectId}/bots`).send({ name: '  ' }).expect(400);

    const list = await agent.get(`/api/projects/${projectId}/bots`).expect(200);
    expect(list.body).toHaveLength(1);

    await agent.delete(`/api/projects/${projectId}/bots/${created.body.id}`).expect(204);
    expect((await agent.get(`/api/projects/${projectId}/bots`).expect(200)).body).toEqual([]);
    await agent.delete(`/api/projects/${projectId}/bots/${created.body.id}`).expect(404);
  });

  it('удаление бота чистит диалоги, http-запросы и подключения', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botId = await createBot(agent, projectId);
    await agent
      .put(`/api/projects/${projectId}/bots/${botId}/connections/telegram`)
      .send({ token: GOOD_TOKEN_1 })
      .expect(200);

    const ctx = await db.prisma.dialogContext.create({
      data: {
        botId,
        chatId: 'c1',
        userId: 'u1',
        channel: 'MESSENGER',
        state: 'RUNNING',
        variables: {},
      },
    });
    const req = await db.prisma.httpRequest.create({
      data: {
        dialogContextId: ctx.id,
        blockId: 'b1',
        method: 'GET',
        url: 'http://x',
        headers: [],
        body: '',
        status: 'SENT',
      },
    });
    await db.prisma.dialogContext.update({ where: { id: ctx.id }, data: { currentRequestId: req.id } });

    await agent.delete(`/api/projects/${projectId}/bots/${botId}`).expect(204);

    expect(await db.prisma.bot.count()).toBe(0);
    expect(await db.prisma.dialogContext.count()).toBe(0);
    expect(await db.prisma.httpRequest.count()).toBe(0);
    expect(await db.prisma.messengerConnection.count()).toBe(0);
  });

  it('чужой автор получает 404 на все маршруты бота', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botId = await createBot(agent, projectId);
    const { agent: other } = await agentWithProject('other@example.com');
    const base = `/api/projects/${projectId}/bots`;

    await other.get(base).expect(404);
    await other.post(base).send({ name: 'Чужой' }).expect(404);
    await other.delete(`${base}/${botId}`).expect(404);
    await other.put(`${base}/${botId}/environment`).send([]).expect(404);
    await other.put(`/api/projects/${projectId}/environment`).send([]).expect(404);
    await other.put(`${base}/${botId}/connections/telegram`).send({ token: GOOD_TOKEN_1 }).expect(404);
    await other.delete(`${base}/${botId}/connections/telegram`).expect(404);
  });

  it('окружение бота: секрет отдаётся маской, повторное сохранение без значения оставляет шифротекст', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botId = await createBot(agent, projectId);
    const url = `/api/projects/${projectId}/bots/${botId}/environment`;

    const saved = await agent
      .put(url)
      .send([
        { name: 'BASE_URL', secret: false, value: 'https://api.example.com' },
        { name: 'API_KEY', secret: true, value: 'super-secret-value-123' },
      ])
      .expect(200);
    expect(saved.body[0]).toEqual({ name: 'BASE_URL', secret: false, value: 'https://api.example.com' });
    expect(saved.body[1]).toMatchObject({ name: 'API_KEY', secret: true });
    expect(saved.body[1].mask).toBeTruthy();
    expect(JSON.stringify(saved.body)).not.toContain('super-secret-value-123');

    const before = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });

    const again = await agent
      .put(url)
      .send([{ name: 'API_KEY', secret: true }])
      .expect(200);
    expect(again.body).toEqual([{ name: 'API_KEY', secret: true, mask: saved.body[1].mask }]);
    const after = await db.prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    expect((after.environment as unknown as Array<{ secretValue: unknown }>)[0].secretValue).toEqual(
      (before.environment as unknown as Array<{ name: string; secretValue: unknown }>).find(
        (v) => v.name === 'API_KEY',
      )?.secretValue,
    );

    const list = await agent.get(`/api/projects/${projectId}/bots`).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('super-secret-value-123');
    expect(list.body[0].environment).toEqual(again.body);
  });

  it('окружение: 400 на плохое имя, дубль и секрет без значения', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botId = await createBot(agent, projectId);
    const url = `/api/projects/${projectId}/bots/${botId}/environment`;

    await agent.put(url).send([{ name: 'bad-name', secret: false, value: '1' }]).expect(400);
    await agent
      .put(url)
      .send([
        { name: 'A', secret: false, value: '1' },
        { name: 'A', secret: false, value: '2' },
      ])
      .expect(400);
    const res = await agent.put(url).send([{ name: 'NEW_SECRET', secret: true }]).expect(400);
    expect(res.body.message).toBe('Введите значение секретной переменной NEW_SECRET');
  });

  it('тестовое окружение проекта: PUT возвращает маски, GET /projects/:id отдаёт EnvVarView', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');

    const saved = await agent
      .put(`/api/projects/${projectId}/environment`)
      .send([
        { name: 'HOST', secret: false, value: 'localhost' },
        { name: 'PASSWORD', secret: true, value: 'hunter2-hunter2' },
      ])
      .expect(200);
    expect(JSON.stringify(saved.body)).not.toContain('hunter2');

    const project = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(project.body.environment).toEqual(saved.body);
    expect(JSON.stringify(project.body)).not.toContain('hunter2');
  });

  it('подключение Telegram: маска, шифрование токена, замена записи при повторе', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botId = await createBot(agent, projectId);
    const url = `/api/projects/${projectId}/bots/${botId}/connections/telegram`;

    const first = await agent.put(url).send({ token: GOOD_TOKEN_1 }).expect(200);
    expect(first.body).toMatchObject({ messenger: 'TELEGRAM', botUsername: 'test_bot' });
    expect(first.body.tokenMask).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain(GOOD_TOKEN_1);

    const stored = await db.prisma.messengerConnection.findFirstOrThrow({ where: { botId } });
    const vault = SecretVault.fromEnv();
    expect(stored.tokenCipher).not.toContain(GOOD_TOKEN_1);
    expect(vault.decrypt({ cipherText: stored.tokenCipher, mask: stored.tokenMask }, tokenAad(botId))).toBe(GOOD_TOKEN_1);
    expect(stored.tokenHash).toBe(vault.hash(GOOD_TOKEN_1));

    // Тот же бот с другим токеном: запись заменяется
    await agent.put(url).send({ token: GOOD_TOKEN_2 }).expect(200);
    const rows = await db.prisma.messengerConnection.findMany({ where: { botId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(vault.hash(GOOD_TOKEN_2));

    const list = await agent.get(`/api/projects/${projectId}/bots`).expect(200);
    expect(list.body[0].connections).toEqual([{ messenger: 'TELEGRAM', tokenMask: rows[0].tokenMask }]);

    await agent.delete(url).expect(204);
    expect(await db.prisma.messengerConnection.count()).toBe(0);
  });

  it('подключение Telegram: 400 при недействительном токене, 409 при чужом использовании', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const botA = await createBot(agent, projectId, 'A');
    const botB = await createBot(agent, projectId, 'B');
    const urlA = `/api/projects/${projectId}/bots/${botA}/connections/telegram`;
    const urlB = `/api/projects/${projectId}/bots/${botB}/connections/telegram`;

    const bad = await agent.put(urlA).send({ token: 'bad-token' }).expect(400);
    expect(bad.body.message).toBe('Токен недействителен');
    expect(await db.prisma.messengerConnection.count()).toBe(0);

    await agent.put(urlA).send({ token: GOOD_TOKEN_1 }).expect(200);
    const conflict = await agent.put(urlB).send({ token: GOOD_TOKEN_1 }).expect(409);
    expect(conflict.body.message).toBe('Токен уже используется другим ботом');

    // Тот же токен у того же бота допустим
    await agent.put(urlA).send({ token: GOOD_TOKEN_1 }).expect(200);

    // Проверка isTokenInUse через PublicationController
    const controller = app.get(PublicationController);
    const vault = SecretVault.fromEnv();
    await expect(controller.isTokenInUse('TELEGRAM', vault.hash(GOOD_TOKEN_1))).resolves.toBe(true);
    await expect(controller.isTokenInUse('TELEGRAM', vault.hash(GOOD_TOKEN_2))).resolves.toBe(false);
  });

  it('удаление бота при гонке P2025 возвращает 404 «Бот не найден»', async () => {
    const { agent, projectId } = await agentWithProject('race@example.com');
    const botId = await createBot(agent, projectId, 'Гоночный бот');

    const prismaService = app.get(PrismaService);
    const txSpy = vi.spyOn(prismaService.client, '$transaction').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record to delete does not exist.', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    try {
      const res = await agent.delete(`/api/projects/${projectId}/bots/${botId}`).expect(404);
      expect(res.body.message).toBe('Бот не найден');
    } finally {
      txSpy.mockRestore();
    }
  });
});
