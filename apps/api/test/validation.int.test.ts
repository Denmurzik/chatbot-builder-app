import 'reflect-metadata';
import type { Scenario } from '@chatbot/model';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ScenarioValidator } from '../src/validation/scenario-validator';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

describe('Validation API (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  let validator: ScenarioValidator;
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
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-validation-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    validator = moduleRef.get(ScenarioValidator);
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

  it('POST /api/projects/:projectId/validate без cookie возвращает 401', async () => {
    await request(app.getHttpServer()).post('/api/projects/p1/validate').expect(401);
  });

  it('POST /api/projects/:projectId/validate проверяет сохранённый сценарий и изолирует чужие проекты (404)', async () => {
    const { agent, projectId } = await agentWithProject('owner@example.com');
    const { agent: other } = await agentWithProject('other@example.com');

    // Чужой проект и несуществующий проект → 404
    await other.post(`/api/projects/${projectId}/validate`).expect(404);
    await agent.post('/api/projects/00000000-0000-0000-0000-000000000000/validate').expect(404);

    // Начальный emptyScenario имеет неподключённый выход точки входа
    const initialRes = await agent.post(`/api/projects/${projectId}/validate`).expect(200);
    expect(initialRes.body).toEqual({
      errors: [
        expect.objectContaining({
          rule: 'outputs_connected',
          severity: 'ERROR',
          blockId: 'entry',
        }),
      ],
    });

    // После сохранения валидного сценария ошибок нет
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
    await agent.put(`/api/projects/${projectId}/scenario`).send(validScenario).expect(200);

    const validRes = await agent.post(`/api/projects/${projectId}/validate`).expect(200);
    expect(validRes.body).toEqual({ errors: [] });
  });

  it('ScenarioValidator.checkConnections проверяет реальные записи messenger_connection в БД', async () => {
    const { agent, projectId } = await agentWithProject('bot-owner@example.com');
    const bot = await agent
      .post(`/api/projects/${projectId}/bots`)
      .send({ name: 'Бот' })
      .expect(201);
    const botId = bot.body.id as string;

    await expect(validator.checkConnections(botId)).resolves.toEqual([
      {
        rule: 'connections',
        severity: 'ERROR',
        message: 'У бота нет подключения к мессенджеру',
      },
    ]);

    await db.prisma.messengerConnection.create({
      data: {
        botId,
        messenger: 'TELEGRAM',
        tokenCipher: 'v1:fake:cipher:text',
        tokenMask: '••••1234',
        tokenHash: 'hash-1234',
      },
    });

    await expect(validator.checkConnections(botId)).resolves.toEqual([]);
  });

  it('POST /api/projects/:projectId/validate возвращает предупреждения unreachableBlock, unwrittenVariable и missingEnvVariable', async () => {
    const { agent, projectId } = await agentWithProject('warnings@example.com');

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'msg',
          type: 'TEXT_MESSAGE',
          title: 'Привет',
          x: 100,
          y: 0,
          text: 'Привет, {{missingVar}}! URL: {{env.CLINIC_URL}}',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 200, y: 0 },
        { id: 'orphan', type: 'EXIT_POINT', title: 'Оторванный', x: 200, y: 200 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
      ],
    };
    await agent.put(`/api/projects/${projectId}/scenario`).send(scenario).expect(200);

    const resBeforeEnv = await agent.post(`/api/projects/${projectId}/validate`).expect(200);
    expect(resBeforeEnv.body.errors).toEqual(
      expect.arrayContaining([
        {
          rule: 'unreachableBlock',
          severity: 'WARNING',
          blockId: 'orphan',
          message: 'Блок недостижим из точки входа',
        },
        {
          rule: 'unwrittenVariable',
          severity: 'WARNING',
          blockId: 'msg',
          message: 'Переменная «missingVar» используется, но не задаётся до этого блока',
        },
        {
          rule: 'missingEnvVariable',
          severity: 'WARNING',
          blockId: 'msg',
          message: 'Переменная окружения «env.CLINIC_URL» не задана в окружении',
        },
      ]),
    );

    // После добавления переменной окружения в проект предупреждение missingEnvVariable исчезает
    await agent
      .put(`/api/projects/${projectId}/environment`)
      .send([{ name: 'CLINIC_URL', value: 'https://clinic.example.com', secret: false }])
      .expect(200);

    const resAfterEnv = await agent.post(`/api/projects/${projectId}/validate`).expect(200);
    expect(
      resAfterEnv.body.errors.filter((e: { rule: string }) => e.rule === 'missingEnvVariable'),
    ).toEqual([]);
  });
});
