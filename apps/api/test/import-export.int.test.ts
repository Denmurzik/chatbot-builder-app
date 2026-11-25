import 'reflect-metadata';
import { emptyScenario, type Scenario } from '@chatbot/model';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

describe('Import/Export API (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING,
    VK_POLLING: process.env.VK_POLLING,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-import-export-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
    process.env.TELEGRAM_POLLING = prevEnv.TELEGRAM_POLLING;
    if (prevEnv.VK_POLLING === undefined) delete process.env.VK_POLLING;
    else process.env.VK_POLLING = prevEnv.VK_POLLING;
    process.env.NODE_ENV = prevEnv.NODE_ENV;
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  async function createAuthenticatedAgent(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    return agent;
  }

  function buildScenarioWithSecrets(secretValue: string): Scenario {
    return {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'req',
          type: 'HTTP_REQUEST',
          title: 'Запрос к API',
          x: 240,
          y: 0,
          method: 'GET',
          url: 'https://clinic.example.com/slots',
          headers: [
            { name: 'Accept', value: 'application/json', secret: false },
            { name: 'Authorization', value: secretValue, secret: true },
          ],
          body: '',
          variableName: 'slots',
          errorVariable: 'slotsErr',
          timeoutSec: 10,
          retryCount: 1,
          retryIntervalSec: 2,
          errorStrategy: 'EXIT_ERROR',
          suspendText: null,
          responseMappings: [{ jsonPath: '$.items', variableName: 'items' }],
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 480, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'req' },
        { source: { blockId: 'req', output: 'success' }, target: 'exit' },
      ],
    };
  }

  it('без cookie возвращает 401 на экспорт и импорт', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/projects/non-existent/export').expect(401);
    await request(server)
      .post('/api/projects/non-existent/import')
      .send(emptyScenario())
      .expect(401);
  });

  it('экспорт без секретов: значение и шифротекст отсутствуют, secret: true сохранён, окружение не выгружается, имя файла с кириллицей', async () => {
    const agent = await createAuthenticatedAgent('export-owner@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Запись к врачу' })
      .expect(201);
    const projectId: string = created.body.id;

    // Добавляем тестовое окружение проекта (не должно попасть в экспорт)
    await agent
      .put(`/api/projects/${projectId}/environment`)
      .send([{ name: 'API_KEY', value: 'env-secret-value', secret: true }])
      .expect(200);

    const secretToken = 'Bearer super-secret-export-token';
    await agent
      .put(`/api/projects/${projectId}/scenario`)
      .send(buildScenarioWithSecrets(secretToken))
      .expect(200);

    const exportRes = await agent.get(`/api/projects/${projectId}/export`).expect(200);

    expect(exportRes.headers['content-type']).toMatch(/application\/json/i);
    expect(exportRes.headers['content-disposition']).toMatch(/attachment;/i);
    expect(exportRes.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Запись к врачу.json')}`,
    );

    // В теле экспорта нет ни открытого секрета, ни шифротекста, ни окружения
    expect(exportRes.text).not.toContain(secretToken);
    expect(exportRes.text).not.toContain('secretValue');
    expect(exportRes.text).not.toContain('cipherText');
    expect(exportRes.text).not.toContain('env-secret-value');
    expect(exportRes.text).not.toContain('API_KEY');

    const exported = JSON.parse(exportRes.text) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(['blocks', 'formatVersion', 'transitions']);
    expect(exported.formatVersion).toBe(1);

    const reqBlock = (exported.blocks as Array<{ id: string; headers?: unknown[] }>).find(
      (b) => b.id === 'req',
    );
    expect(reqBlock?.headers).toEqual([
      { name: 'Accept', value: 'application/json', secret: false },
      { name: 'Authorization', value: '', secret: true },
    ]);
  });

  it('round-trip export → import даёт тот же сценарий (кроме секретов) и возвращает secretsToFill', async () => {
    const agent = await createAuthenticatedAgent('roundtrip@example.com');
    const sourceProject = await agent
      .post('/api/projects')
      .send({ name: 'Исходный проект' })
      .expect(201);
    const targetProject = await agent
      .post('/api/projects')
      .send({ name: 'Целевой проект' })
      .expect(201);

    await agent
      .put(`/api/projects/${sourceProject.body.id}/scenario`)
      .send(buildScenarioWithSecrets('Bearer original-secret'))
      .expect(200);

    const exported = await agent
      .get(`/api/projects/${sourceProject.body.id}/export`)
      .expect(200);
    const exportedScenario = JSON.parse(exported.text) as Scenario;

    const importRes = await agent
      .post(`/api/projects/${targetProject.body.id}/import`)
      .send(exportedScenario)
      .expect(200);

    expect(importRes.body).toEqual({
      updatedAt: expect.any(String),
      secretsToFill: 1,
    });

    const fetched = await agent.get(`/api/projects/${targetProject.body.id}`).expect(200);
    expect(fetched.body.scenario).toEqual(exportedScenario);
  });

  it('импорт с чужим secretValue отбрасывает его до saveScenario и требует ввести секрет заново', async () => {
    const agent = await createAuthenticatedAgent('foreign-secret@example.com');
    const projectA = await agent.post('/api/projects').send({ name: 'Проект A' }).expect(201);
    const projectB = await agent.post('/api/projects').send({ name: 'Проект B' }).expect(201);

    await agent
      .put(`/api/projects/${projectA.body.id}/scenario`)
      .send(buildScenarioWithSecrets('Bearer project-a-secret'))
      .expect(200);

    // Берём сценарий проекта A прямо из GET (в нём есть secretValue с AAD от проекта A)
    const detailsA = await agent.get(`/api/projects/${projectA.body.id}`).expect(200);

    const importRes = await agent
      .post(`/api/projects/${projectB.body.id}/import`)
      .send(detailsA.body.scenario)
      .expect(200);

    expect(importRes.body).toEqual({
      updatedAt: expect.any(String),
      secretsToFill: 1,
    });

    const detailsB = await agent.get(`/api/projects/${projectB.body.id}`).expect(200);
    const reqBlock = detailsB.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(reqBlock.headers).toEqual([
      { name: 'Accept', value: 'application/json', secret: false },
      { name: 'Authorization', value: '', secret: true },
    ]);
  });

  it('битый JSON, formatVersion: 2 и переход на несуществующий блок → 400, сценарий не изменился', async () => {
    const agent = await createAuthenticatedAgent('invalid-import@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Защита от битого импорта' })
      .expect(201);
    const projectId: string = created.body.id;

    const initialScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg1', type: 'TEXT_MESSAGE', title: 'Привет', x: 120, y: 0, text: 'Неизменный текст' },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg1' }],
    };
    await agent.put(`/api/projects/${projectId}/scenario`).send(initialScenario).expect(200);

    // 1. Битый JSON — express отсекает до контроллера с 400
    await agent
      .post(`/api/projects/${projectId}/import`)
      .set('Content-Type', 'application/json')
      .send('{"formatVersion": 1, "blocks": [')
      .expect(400);

    const afterBrokenJson = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(afterBrokenJson.body.scenario).toEqual(initialScenario);

    // 2. Неподдерживаемая formatVersion: 2
    const badVersionRes = await agent
      .post(`/api/projects/${projectId}/import`)
      .send({ formatVersion: 2, blocks: [], transitions: [] })
      .expect(400);

    expect(badVersionRes.body).toEqual({
      message: 'Файл не подходит',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'formatVersion',
          message: expect.stringMatching(/[А-Яа-яЁё]/),
        }),
      ]),
    });

    const afterBadVersion = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(afterBadVersion.body.scenario).toEqual(initialScenario);

    // 3. Переход на несуществующий блок
    const danglingRes = await agent
      .post(`/api/projects/${projectId}/import`)
      .send({
        formatVersion: 1,
        blocks: [{ id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
        transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'ghost_block' }],
      })
      .expect(400);

    expect(danglingRes.body).toEqual({
      message: 'Файл не подходит',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'transitions.0.target',
          message: expect.stringContaining('ghost_block'),
        }),
      ]),
    });

    const afterDangling = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(afterDangling.body.scenario).toEqual(initialScenario);
  });

  it('импорт заголовка {secret:true, value:"k"}: в БД value==="", secretValue зашифрован, secretsToFill===0', async () => {
    const agent = await createAuthenticatedAgent('secret-with-value@example.com');
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Секретный заголовок с непустым значением' })
      .expect(201);
    const projectId: string = created.body.id;

    // Импортируем сценарий с секретным заголовком, у которого задано открытое значение
    const scenarioWithValue: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'req',
          type: 'HTTP_REQUEST',
          title: 'Запрос',
          x: 240,
          y: 0,
          method: 'GET',
          url: 'https://example.com/api',
          headers: [{ name: 'Authorization', value: 'k', secret: true }],
          body: '',
          variableName: 'resp',
          errorVariable: 'err',
          timeoutSec: 10,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'EXIT_ERROR',
          suspendText: null,
          responseMappings: [],
        },
      ],
      transitions: [],
    };

    const importRes = await agent
      .post(`/api/projects/${projectId}/import`)
      .send(scenarioWithValue)
      .expect(200);

    // Значение было задано → секрет зашифрован → заполнять не нужно
    expect(importRes.body).toEqual({
      updatedAt: expect.any(String),
      secretsToFill: 0,
    });

    // GET отдаёт только secretMask (без secretValue/cipherText), в БД лежит зашифрованный secretValue
    const details = await agent.get(`/api/projects/${projectId}`).expect(200);
    const reqBlock = details.body.scenario.blocks.find((b: { id: string }) => b.id === 'req');
    expect(reqBlock).toBeDefined();
    const authHeader = reqBlock.headers.find((h: { name: string }) => h.name === 'Authorization');
    expect(authHeader.value).toBe('');
    expect(authHeader.secret).toBe(true);
    expect(authHeader.secretValue).toBeUndefined();
    expect(authHeader.secretMask).toBeTruthy();

    const dbProject = await db.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const dbScenario = dbProject.scenario as unknown as Scenario;
    const dbReq = dbScenario.blocks.find((b) => b.id === 'req');
    expect(dbReq?.type).toBe('HTTP_REQUEST');
    if (dbReq?.type === 'HTTP_REQUEST') {
      const dbAuth = dbReq.headers.find((h) => h.name === 'Authorization');
      expect(dbAuth?.secretValue?.cipherText).toMatch(/^v1:/);
    }
  });

  it('чужой и несуществующий проект → 404 на экспорт и импорт, чужой сценарий не меняется', async () => {
    const agentA = await createAuthenticatedAgent('owner-a@example.com');
    const agentB = await createAuthenticatedAgent('other-b@example.com');

    const projectA = await agentA.post('/api/projects').send({ name: 'Проект A' }).expect(201);
    const scenarioA: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msgA', type: 'TEXT_MESSAGE', title: 'Текст', x: 100, y: 0, text: 'Личный текст A' },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msgA' }],
    };
    await agentA.put(`/api/projects/${projectA.body.id}/scenario`).send(scenarioA).expect(200);

    // Чужой проект → 404 (даже при невалидном теле на импорте)
    await agentB.get(`/api/projects/${projectA.body.id}/export`).expect(404);
    await agentB
      .post(`/api/projects/${projectA.body.id}/import`)
      .send(emptyScenario())
      .expect(404);
    await agentB
      .post(`/api/projects/${projectA.body.id}/import`)
      .send({ formatVersion: 999 })
      .expect(404);

    // Несуществующий проект → 404
    await agentA.get('/api/projects/00000000-0000-0000-0000-000000000000/export').expect(404);
    await agentA
      .post('/api/projects/00000000-0000-0000-0000-000000000000/import')
      .send(emptyScenario())
      .expect(404);

    // Сценарий проекта A остался неизменным
    const afterB = await agentA.get(`/api/projects/${projectA.body.id}`).expect(200);
    expect(afterB.body.scenario).toEqual(scenarioA);
  });

  it('YAML экспорт (?format=yaml) без секретов, round-trip import и 400 на невалидный YAML/format', async () => {
    const agent = await createAuthenticatedAgent('yaml-owner@example.com');
    const sourceProject = await agent
      .post('/api/projects')
      .send({ name: 'Запись к врачу' })
      .expect(201);
    const targetProject = await agent
      .post('/api/projects')
      .send({ name: 'Целевой YAML' })
      .expect(201);

    const secretToken = 'Bearer yaml-secret-token';
    await agent
      .put(`/api/projects/${sourceProject.body.id}/scenario`)
      .send(buildScenarioWithSecrets(secretToken))
      .expect(200);

    // Некорректный параметр format → 400 на русском
    const badFormat = await agent
      .get(`/api/projects/${sourceProject.body.id}/export?format=xml`)
      .expect(400);
    expect(badFormat.body.message).toMatch(/[А-Яа-яЁё]/);

    // Экспорт в YAML
    const yamlRes = await agent
      .get(`/api/projects/${sourceProject.body.id}/export?format=yaml`)
      .expect(200);
    expect(yamlRes.headers['content-type']).toMatch(/application\/yaml/i);
    expect(yamlRes.headers['content-disposition']).toMatch(/attachment;/i);
    expect(yamlRes.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Запись к врачу.yaml')}`,
    );
    expect(yamlRes.text).not.toContain(secretToken);
    expect(yamlRes.text).not.toContain('secretValue');
    expect(yamlRes.text).not.toContain('secretMask');

    // Импорт YAML обратно в другой проект
    const importRes = await agent
      .post(`/api/projects/${targetProject.body.id}/import`)
      .set('Content-Type', 'application/yaml; charset=utf-8')
      .send(yamlRes.text)
      .expect(200);
    expect(importRes.body).toEqual({
      updatedAt: expect.any(String),
      secretsToFill: 1,
    });

    const fetched = await agent.get(`/api/projects/${targetProject.body.id}`).expect(200);
    const expectedJson = await agent
      .get(`/api/projects/${sourceProject.body.id}/export?format=json`)
      .expect(200);
    expect(fetched.body.scenario).toEqual(JSON.parse(expectedJson.text));

    // Битый YAML → 400, сценарий целевого проекта не портится
    const badYamlRes = await agent
      .post(`/api/projects/${targetProject.body.id}/import`)
      .set('Content-Type', 'application/yaml')
      .send('formatVersion: 1\nblocks: [unclosed')
      .expect(400);
    expect(badYamlRes.body).toMatchObject({
      message: 'Файл не подходит',
      issues: [
        expect.objectContaining({
          path: '',
          message: expect.stringContaining('Некорректный YAML'),
        }),
      ],
    });

    const afterBadYaml = await agent.get(`/api/projects/${targetProject.body.id}`).expect(200);
    expect(afterBadYaml.body.scenario).toEqual(JSON.parse(expectedJson.text));
  });
});
