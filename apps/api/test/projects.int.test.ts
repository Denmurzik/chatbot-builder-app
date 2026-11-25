import 'reflect-metadata';
import { emptyScenario, type Scenario } from '@chatbot/model';
import { SecretVault, tokenAad } from '@chatbot/vault';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { MessengerAdminPort } from '../src/common/messenger-admin.port';
import { configureApp } from '../src/configure-app';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

describe('Projects API (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const messengerAdminMock = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    verifyToken: vi.fn().mockResolvedValue({ username: 'test_bot' }),
  };
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING,
    VK_POLLING: process.env.VK_POLLING,
    NODE_ENV: process.env.NODE_ENV,
    VAULT_KEY: process.env.VAULT_KEY,
    VAULT_HASH_KEY: process.env.VAULT_HASH_KEY,
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-projects-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MessengerAdminPort)
      .useValue(messengerAdminMock)
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
    vi.clearAllMocks();
    messengerAdminMock.disconnect.mockResolvedValue(undefined);
  });

  async function createAuthenticatedAgent(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    return agent;
  }

  it('все маршруты проектов без cookie возвращают 401', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/projects').expect(401);
    await request(server).post('/api/projects').send({ name: 'Тест' }).expect(401);
    await request(server).get('/api/projects/non-existent').expect(401);
    await request(server)
      .put('/api/projects/non-existent/scenario')
      .send(emptyScenario())
      .expect(401);
  });

  it('CRUD проектов: создание с emptyScenario(), список, чтение по id, 404 на несуществующий', async () => {
    const agent = await createAuthenticatedAgent('owner@example.com');

    // Пустой список
    const emptyList = await agent.get('/api/projects').expect(200);
    expect(emptyList.body).toEqual([]);

    // Создание проекта
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Запись к врачу' })
      .expect(201);

    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Запись к врачу',
      scenario: emptyScenario(),
    });

    // Список проектов
    const list = await agent.get('/api/projects').expect(200);
    expect(list.body).toEqual([
      {
        id: created.body.id,
        name: 'Запись к врачу',
        updatedAt: expect.any(String),
        botsCount: 0,
        blocksCount: 1,
        publishedBotsCount: 0,
        messengers: [],
      },
    ]);

    // Получение проекта по id
    const fetched = await agent.get(`/api/projects/${created.body.id}`).expect(200);
    expect(fetched.body).toEqual({
      id: created.body.id,
      name: 'Запись к врачу',
      scenario: emptyScenario(),
      environment: [],
      updatedAt: expect.any(String),
    });

    // Несуществующий проект — 404
    await agent.get('/api/projects/00000000-0000-0000-0000-000000000000').expect(404);
    await agent
      .put('/api/projects/00000000-0000-0000-0000-000000000000/scenario')
      .send(emptyScenario())
      .expect(404);

    // Пустое название проекта — 400
    const badCreate = await agent.post('/api/projects').send({ name: '   ' }).expect(400);
    expect(badCreate.body).toMatchObject({
      message: expect.any(String),
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'name', message: expect.any(String) }),
      ]),
    });
  });

  it('PUT /api/projects/:id/scenario — сохраняет валидный сценарий и возвращает updatedAt', async () => {
    const agent = await createAuthenticatedAgent('editor@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Эхо' })
      .expect(201);

    const validScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg1', type: 'TEXT_MESSAGE', title: 'Приветствие', x: 200, y: 0, text: 'Привет!' },
        { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 400, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg1' },
        { source: { blockId: 'msg1', output: 'default' }, target: 'exit' },
      ],
    };

    const putRes = await agent
      .put(`/api/projects/${created.body.id}/scenario`)
      .send(validScenario)
      .expect(200);

    expect(putRes.body).toEqual({
      updatedAt: expect.any(String),
    });

    const fetched = await agent.get(`/api/projects/${created.body.id}`).expect(200);
    expect(fetched.body.scenario).toEqual(validScenario);
  });

  it('Review Focus 3: переход на удалённый блок или два перехода из одного выхода → 400, прежний сценарий в БД не портится', async () => {
    const agent = await createAuthenticatedAgent('focus3@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Проверка графа' })
      .expect(201);

    const initialScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg1', type: 'TEXT_MESSAGE', title: 'Сообщение', x: 100, y: 0, text: 'Ок' },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg1' }],
    };

    await agent
      .put(`/api/projects/${created.body.id}/scenario`)
      .send(initialScenario)
      .expect(200);

    // Переход на удалённый блок
    const danglingScenario = {
      formatVersion: 1,
      blocks: [{ id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'deleted_block' }],
    };

    const err1 = await agent
      .put(`/api/projects/${created.body.id}/scenario`)
      .send(danglingScenario)
      .expect(400);

    expect(err1.body).toMatchObject({
      message: expect.any(String),
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'transitions.0.target',
          message: expect.any(String),
        }),
      ]),
    });

    // В базе остался прежний сценарий
    const afterErr1 = await agent.get(`/api/projects/${created.body.id}`).expect(200);
    expect(afterErr1.body.scenario).toEqual(initialScenario);

    // Два перехода из одного выхода
    const duplicateOutputScenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg1', type: 'TEXT_MESSAGE', title: 'А', x: 100, y: 0, text: 'А' },
        { id: 'msg2', type: 'TEXT_MESSAGE', title: 'Б', x: 100, y: 100, text: 'Б' },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg1' },
        { source: { blockId: 'entry', output: 'default' }, target: 'msg2' },
      ],
    };

    const err2 = await agent
      .put(`/api/projects/${created.body.id}/scenario`)
      .send(duplicateOutputScenario)
      .expect(400);

    expect(err2.body).toMatchObject({
      message: expect.any(String),
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'transitions.1.source',
          message: expect.any(String),
        }),
      ]),
    });

    // В базе по-прежнему исходный сценарий
    const afterErr2 = await agent.get(`/api/projects/${created.body.id}`).expect(200);
    expect(afterErr2.body.scenario).toEqual(initialScenario);
  });

  it('изоляция авторов (п. 2.12): автор B получает 404 на проект автора A и не видит его в списке', async () => {
    const agentA = await createAuthenticatedAgent('author-a@example.com');
    const agentB = await createAuthenticatedAgent('author-b@example.com');

    const projectA = await agentA
      .post('/api/projects')
      .send({ name: 'Секретный проект A' })
      .expect(201);

    // Автор A сохраняет непустой сценарий
    const scenarioA: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msgA', type: 'TEXT_MESSAGE', title: 'Текст A', x: 120, y: 0, text: 'Только для A' },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msgA' }],
    };
    await agentA
      .put(`/api/projects/${projectA.body.id}/scenario`)
      .send(scenarioA)
      .expect(200);

    // Автор B не видит проект A в своём списке
    const listB = await agentB.get('/api/projects').expect(200);
    expect(listB.body).toEqual([]);

    // Автор B получает 404 при чтении и сохранении проекта A
    await agentB.get(`/api/projects/${projectA.body.id}`).expect(404);
    await agentB
      .put(`/api/projects/${projectA.body.id}/scenario`)
      .send(emptyScenario())
      .expect(404);

    // Сценарий проекта A остался неизменным после попытки автора B
    const afterB = await agentA.get(`/api/projects/${projectA.body.id}`).expect(200);
    expect(afterB.body.scenario).toEqual(scenarioA);
  });

  it('секретный заголовок HTTP-блока: GET не отдаёт cipherText, secretMask сохраняет секрет, новое значение перешифровывает, secret:false очищает', async () => {
    const agent = await createAuthenticatedAgent('secret-header@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'HTTP с секретом' })
      .expect(201);
    const projectId: string = created.body.id;

    const secretToken = 'Bearer super-secret-token-1234';
    const scenarioWithSecret: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'req',
          type: 'HTTP_REQUEST',
          title: 'Запрос',
          x: 200,
          y: 0,
          method: 'GET',
          url: 'https://api.example.com/data',
          headers: [
            { name: 'Accept', value: 'application/json', secret: false },
            { name: 'Authorization', value: secretToken, secret: true },
            { name: 'X-Empty-Secret', value: '', secret: true },
          ],
          body: '',
          variableName: 'resp',
          errorVariable: 'err',
          timeoutSec: 5,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'EXIT_ERROR',
          suspendText: null,
          responseMappings: [],
        },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'req' }],
    };

    await agent
      .put(`/api/projects/${projectId}/scenario`)
      .send(scenarioWithSecret)
      .expect(200);

    // 1. GET отдаёт пустое value и secretMask, без secretValue и cipherText
    const fetched = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(JSON.stringify(fetched.body)).not.toContain('cipherText');
    expect(JSON.stringify(fetched.body)).not.toContain('secretValue');
    expect(JSON.stringify(fetched.body)).not.toContain(secretToken);

    const reqBlock = fetched.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(reqBlock.headers).toEqual([
      { name: 'Accept', value: 'application/json', secret: false },
      {
        name: 'Authorization',
        value: '',
        secret: true,
        secretMask: '••••1234',
      },
      { name: 'X-Empty-Secret', value: '', secret: true },
    ]);

    // В базе лежит шифротекст, без открытого значения и без secretMask
    const getDbAuthHeader = async () => {
      const dbProject = await db.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(JSON.stringify(dbProject.scenario)).not.toContain(secretToken);
      const dbScenario = dbProject.scenario as unknown as Scenario;
      const dbReq = dbScenario.blocks.find((b) => b.id === 'req');
      if (dbReq?.type !== 'HTTP_REQUEST') throw new Error('Ожидался HTTP_REQUEST');
      return dbReq.headers.find((h) => h.name === 'Authorization');
    };

    const firstDbAuth = await getDbAuthHeader();
    expect(firstDbAuth?.secretValue?.cipherText).toMatch(/^v1:/);
    expect(firstDbAuth?.secretMask).toBeUndefined();
    const firstCipherText = firstDbAuth!.secretValue!.cipherText;

    // 2. Повторное сохранение с value="" и secretMask сохраняет прежний шифротекст из БД (клиентский secretValue игнорируется)
    const tamperedScenario = structuredClone(fetched.body.scenario) as Scenario;
    const tamperedReq = tamperedScenario.blocks.find((b) => b.id === 'req');
    if (tamperedReq?.type === 'HTTP_REQUEST') {
      tamperedReq.headers[1].secretValue = { cipherText: 'v1:fake:client:cipher', mask: '••••9999' };
    }
    await agent
      .put(`/api/projects/${projectId}/scenario`)
      .send(tamperedScenario)
      .expect(200);

    const preservedDbAuth = await getDbAuthHeader();
    expect(preservedDbAuth?.secretValue?.cipherText).toBe(firstCipherText);

    const refetched = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(JSON.stringify(refetched.body)).not.toContain('cipherText');
    const refetchedReq = refetched.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(refetchedReq.headers[1]).toEqual({
      name: 'Authorization',
      value: '',
      secret: true,
      secretMask: '••••1234',
    });

    // 3. Новое непустое значение перешифровывает секрет и обновляет маску
    const updatedScenario = structuredClone(refetched.body.scenario) as Scenario;
    const updatedReq = updatedScenario.blocks.find((b) => b.id === 'req');
    if (updatedReq?.type === 'HTTP_REQUEST') {
      updatedReq.headers[1] = { name: 'Authorization', value: 'Bearer rotated-token-9876', secret: true };
    }
    await agent
      .put(`/api/projects/${projectId}/scenario`)
      .send(updatedScenario)
      .expect(200);

    const rotatedDbAuth = await getDbAuthHeader();
    expect(rotatedDbAuth?.secretValue?.cipherText).toMatch(/^v1:/);
    expect(rotatedDbAuth?.secretValue?.cipherText).not.toBe(firstCipherText);
    const afterRotate = await agent.get(`/api/projects/${projectId}`).expect(200);
    const rotatedReq = afterRotate.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(rotatedReq.headers[1]).toEqual({
      name: 'Authorization',
      value: '',
      secret: true,
      secretMask: '••••9876',
    });

    // 4. Переключение secret: false очищает secretValue в БД и secretMask в GET
    const plainScenario = structuredClone(afterRotate.body.scenario) as Scenario;
    const plainReq = plainScenario.blocks.find((b) => b.id === 'req');
    if (plainReq?.type === 'HTTP_REQUEST') {
      plainReq.headers[1] = {
        name: 'Authorization',
        value: 'public-value',
        secret: false,
        secretMask: '••••9876',
      };
    }
    await agent
      .put(`/api/projects/${projectId}/scenario`)
      .send(plainScenario)
      .expect(200);

    const plainDbAuth = await getDbAuthHeader();
    expect(plainDbAuth).toEqual({ name: 'Authorization', value: 'public-value', secret: false });
    const afterPlain = await agent.get(`/api/projects/${projectId}`).expect(200);
    const afterPlainReq = afterPlain.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(afterPlainReq.headers[1]).toEqual({
      name: 'Authorization',
      value: 'public-value',
      secret: false,
    });
  });

  it('UC-A-04: botsCount в списке, PATCH переименование (свой/чужой/пустое имя) и защита без cookie', async () => {
    const server = app.getHttpServer();
    await request(server).patch('/api/projects/non-existent').send({ name: 'Новое' }).expect(401);
    await request(server).delete('/api/projects/non-existent').expect(401);

    const owner = await createAuthenticatedAgent('rename-owner@example.com');
    const other = await createAuthenticatedAgent('rename-other@example.com');

    const created = await owner.post('/api/projects').send({ name: 'Исходный' }).expect(201);
    const projectId = created.body.id as string;

    // Добавляем 2 бота и проверяем botsCount в списке
    await owner.post(`/api/projects/${projectId}/bots`).send({ name: 'Бот 1' }).expect(201);
    await owner.post(`/api/projects/${projectId}/bots`).send({ name: 'Бот 2' }).expect(201);

    const listRes = await owner.get('/api/projects').expect(200);
    expect(listRes.body).toEqual([
      {
        id: projectId,
        name: 'Исходный',
        updatedAt: expect.any(String),
        botsCount: 2,
        blocksCount: 1,
        publishedBotsCount: 0,
        messengers: [],
      },
    ]);

    // Успешное переименование владельцем
    const renamed = await owner
      .patch(`/api/projects/${projectId}`)
      .send({ name: '  Новое название  ' })
      .expect(200);
    expect(renamed.body).toEqual({
      id: projectId,
      name: 'Новое название',
      updatedAt: expect.any(String),
      botsCount: 2,
      blocksCount: 1,
      publishedBotsCount: 0,
      messengers: [],
    });

    // Чужой и несуществующий проект → 404
    await other.patch(`/api/projects/${projectId}`).send({ name: 'Взлом' }).expect(404);
    await owner
      .patch('/api/projects/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Нет' })
      .expect(404);

    // Пустое имя → 400
    const badRename = await owner.patch(`/api/projects/${projectId}`).send({ name: '   ' }).expect(400);
    expect(badRename.body).toMatchObject({
      message: expect.any(String),
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'name', message: expect.any(String) }),
      ]),
    });
  });

  it('UC-A-04: DELETE каскадно удаляет ботов, подключения, диалоги (бота и превью), HTTP-запросы и отключает Telegram', async () => {
    const owner = await createAuthenticatedAgent('delete-owner@example.com');
    const other = await createAuthenticatedAgent('delete-other@example.com');

    const proj = await owner.post('/api/projects').send({ name: 'На удаление' }).expect(201);
    const keepProj = await owner.post('/api/projects').send({ name: 'Оставить' }).expect(201);
    const projectId = proj.body.id as string;
    const keepProjectId = keepProj.body.id as string;

    // Чужой и несуществующий проект → 404
    await other.delete(`/api/projects/${projectId}`).expect(404);
    await owner.delete('/api/projects/00000000-0000-0000-0000-000000000000').expect(404);

    // Создаём бота с подключением, диалогом и HTTP-запросом (вкл. currentRequestId)
    const bot = await owner.post(`/api/projects/${projectId}/bots`).send({ name: 'Бот 1' }).expect(201);
    const botId = bot.body.id as string;
    const rawToken = '123456:TEST-CASCADE-DELETE-TOKEN';
    const vault = SecretVault.fromEnv();
    const { cipherText, mask } = vault.encrypt(rawToken, tokenAad(botId, 'TELEGRAM'));
    await db.prisma.messengerConnection.create({
      data: {
        botId,
        messenger: 'TELEGRAM',
        tokenCipher: cipherText,
        tokenMask: mask,
        tokenHash: vault.hash(rawToken),
      },
    });

    const botDialog = await db.prisma.dialogContext.create({
      data: {
        botId,
        chatId: 'chat-100',
        userId: 'user-100',
        channel: 'MESSENGER',
        state: 'WAITING_EXTERNAL',
        variables: {},
      },
    });
    const botReq = await db.prisma.httpRequest.create({
      data: {
        dialogContextId: botDialog.id,
        blockId: 'req',
        method: 'GET',
        url: 'https://example.com',
        headers: [],
        body: '',
        status: 'SENT',
      },
    });
    await db.prisma.dialogContext.update({
      where: { id: botDialog.id },
      data: { currentRequestId: botReq.id },
    });

    // Создаём preview-контекст с HTTP-запросом для удаляемого проекта и для соседнего проекта
    const previewDialog = await db.prisma.dialogContext.create({
      data: {
        botId: null,
        chatId: `preview:${projectId}:sess-1`,
        userId: 'preview-user',
        channel: 'PREVIEW',
        state: 'WAITING_USER',
        variables: {},
      },
    });
    const previewReq = await db.prisma.httpRequest.create({
      data: {
        dialogContextId: previewDialog.id,
        blockId: 'req',
        method: 'POST',
        url: 'https://example.com/preview',
        headers: [],
        body: '{}',
        status: 'SUCCEEDED',
      },
    });
    await db.prisma.dialogContext.update({
      where: { id: previewDialog.id },
      data: { currentRequestId: previewReq.id },
    });

    const keepPreviewDialog = await db.prisma.dialogContext.create({
      data: {
        botId: null,
        chatId: `preview:${keepProjectId}:sess-1`,
        userId: 'preview-user',
        channel: 'PREVIEW',
        state: 'WAITING_USER',
        variables: {},
      },
    });

    // Даже если внешнее отключение упадёт — HTTP 204 и БД очищена
    messengerAdminMock.disconnect.mockRejectedValueOnce(new Error('Telegram timeout'));

    await owner.delete(`/api/projects/${projectId}`).expect(204);

    expect(messengerAdminMock.disconnect).toHaveBeenCalledTimes(1);
    expect(messengerAdminMock.disconnect).toHaveBeenCalledWith('TELEGRAM', botId, rawToken, undefined);

    // Все записи удаляемого проекта очищены
    expect(await db.prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    expect(await db.prisma.bot.count({ where: { projectId } })).toBe(0);
    expect(await db.prisma.messengerConnection.count({ where: { botId } })).toBe(0);
    expect(
      await db.prisma.dialogContext.count({ where: { id: { in: [botDialog.id, previewDialog.id] } } }),
    ).toBe(0);
    expect(
      await db.prisma.httpRequest.count({ where: { id: { in: [botReq.id, previewReq.id] } } }),
    ).toBe(0);

    // Соседний проект и его preview-контекст не затронуты
    expect(await db.prisma.project.findUnique({ where: { id: keepProjectId } })).not.toBeNull();
    expect(await db.prisma.dialogContext.findUnique({ where: { id: keepPreviewDialog.id } })).not.toBeNull();
  });

  it('ProjectSummary: blocksCount, publishedBotsCount и messengers в GET /api/projects и PATCH /api/projects/:id', async () => {
    const owner = await createAuthenticatedAgent('metrics-owner@example.com');

    const proj1 = await owner.post('/api/projects').send({ name: 'Основной проект' }).expect(201);
    const proj1Id = proj1.body.id as string;

    const scenario3Blocks: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg1', type: 'TEXT_MESSAGE', title: 'Ответ', x: 180, y: 0, text: 'Привет' },
        { id: 'exit', type: 'EXIT_POINT', title: 'Финиш', x: 360, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg1' },
        { source: { blockId: 'msg1', output: 'default' }, target: 'exit' },
      ],
    };
    await owner.put(`/api/projects/${proj1Id}/scenario`).send(scenario3Blocks).expect(200);

    // 3 бота: 2 опубликованных (с подключениями VK и TELEGRAM, включая дубль TELEGRAM) и 1 черновик
    const bot1 = await owner.post(`/api/projects/${proj1Id}/bots`).send({ name: 'Бот 1' }).expect(201);
    const bot2 = await owner.post(`/api/projects/${proj1Id}/bots`).send({ name: 'Бот 2' }).expect(201);
    await owner.post(`/api/projects/${proj1Id}/bots`).send({ name: 'Бот 3' }).expect(201);

    await db.prisma.bot.updateMany({
      where: { id: { in: [bot1.body.id as string, bot2.body.id as string] } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    const vault = SecretVault.fromEnv();
    const attachConnection = async (botId: string, messenger: 'TELEGRAM' | 'VK', rawToken: string) => {
      const { cipherText, mask } = vault.encrypt(rawToken, tokenAad(botId, messenger));
      await db.prisma.messengerConnection.create({
        data: {
          botId,
          messenger,
          tokenCipher: cipherText,
          tokenMask: mask,
          tokenHash: vault.hash(rawToken),
        },
      });
    };

    // Подключаем VK раньше TELEGRAM, чтобы проверить сортировку и дедупликацию
    await attachConnection(bot1.body.id as string, 'VK', 'vk-token-metrics-1');
    await attachConnection(bot1.body.id as string, 'TELEGRAM', 'tg-token-metrics-1');
    await attachConnection(bot2.body.id as string, 'TELEGRAM', 'tg-token-metrics-2');

    // Второй проект: 1 блок (emptyScenario), 1 неопубликованный бот с подключением VK
    const proj2 = await owner.post('/api/projects').send({ name: 'Второй проект' }).expect(201);
    const proj2Id = proj2.body.id as string;
    const proj2Bot = await owner.post(`/api/projects/${proj2Id}/bots`).send({ name: 'Бот VK' }).expect(201);
    await attachConnection(proj2Bot.body.id as string, 'VK', 'vk-token-metrics-2');

    const listRes = await owner.get('/api/projects').expect(200);
    expect(listRes.body).toEqual(
      expect.arrayContaining([
        {
          id: proj1Id,
          name: 'Основной проект',
          updatedAt: expect.any(String),
          botsCount: 3,
          blocksCount: 3,
          publishedBotsCount: 2,
          messengers: ['TELEGRAM', 'VK'],
        },
        {
          id: proj2Id,
          name: 'Второй проект',
          updatedAt: expect.any(String),
          botsCount: 1,
          blocksCount: 1,
          publishedBotsCount: 0,
          messengers: ['VK'],
        },
      ]),
    );

    const renamedRes = await owner
      .patch(`/api/projects/${proj1Id}`)
      .send({ name: 'Основной проект v2' })
      .expect(200);
    expect(renamedRes.body).toEqual({
      id: proj1Id,
      name: 'Основной проект v2',
      updatedAt: expect.any(String),
      botsCount: 3,
      blocksCount: 3,
      publishedBotsCount: 2,
      messengers: ['TELEGRAM', 'VK'],
    });
  });
});
