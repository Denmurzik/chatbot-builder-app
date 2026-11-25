import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { emptyScenario } from '@chatbot/model';
import { createRedisConnection } from '@chatbot/queue';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { webhookSecret } from '../src/telegram/webhook-secret';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';

describe('Webhook Telegram (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const prefix = `test-api-${randomUUID()}`;
  const redis = createRedisConnection(REDIS_URL);
  const prevEnv = { ...process.env };

  // Каждое задание BullMQ хранится в хеше prefix:events-N:jobId
  const jobKeys = (): Promise<string[]> => redis.keys(`${prefix}:events-*:tg-*`);
  const countJobs = async (): Promise<number> => (await jobKeys()).length;

  const update = (id: number) => ({
    update_id: id,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: 'private' },
      from: { id: 7, is_bot: false, first_name: 'A' },
      text: 'привет',
    },
  });

  async function createBot(status: 'PUBLISHED' | 'CREATED'): Promise<string> {
    const author = await db.prisma.author.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'x' },
    });
    const project = await db.prisma.project.create({
      data: { authorId: author.id, name: 'P', scenario: emptyScenario() as never, environment: [] },
    });
    const bot = await db.prisma.bot.create({
      data: {
        projectId: project.id,
        name: 'B',
        status,
        publishedScenario: emptyScenario() as never,
        environment: [],
      },
    });
    return bot.id;
  }

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-webhook-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = REDIS_URL;
    process.env.QUEUE_PREFIX = prefix;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    process.env = prevEnv;
  });

  beforeEach(async () => {
    await db.truncateAll();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  it('без секрета и с неверным секретом -> 401, очередь пуста', async () => {
    const botId = await createBot('PUBLISHED');
    const server = app.getHttpServer();
    await request(server).post(`/webhook/telegram/${botId}`).send(update(1)).expect(401);
    await request(server)
      .post(`/webhook/telegram/${botId}`)
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong')
      .send(update(1))
      .expect(401);
    // Секрет другого бота не подходит
    const otherId = await createBot('PUBLISHED');
    await request(server)
      .post(`/webhook/telegram/${botId}`)
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(otherId))
      .send(update(1))
      .expect(401);
    expect(await countJobs()).toBe(0);
  });

  it('верный секрет -> 200 и одно задание; повторная доставка не задваивает', async () => {
    const botId = await createBot('PUBLISHED');
    const server = app.getHttpServer();
    for (let i = 0; i < 2; i++) {
      await request(server)
        .post(`/webhook/telegram/${botId}`)
        .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(botId))
        .send(update(100))
        .expect(200);
    }
    const keys = await jobKeys();
    expect(keys).toHaveLength(1);
    const rawData = await redis.hget(keys[0]!, 'data');
    expect(rawData).toBeTruthy();
    const data = JSON.parse(rawData!);
    expect(data).toMatchObject({
      type: 'TEXT_MESSAGE',
      chatId: 'tg:42',
      userId: 'tg:7',
      botId,
    });
  });

  it('неопубликованный бот -> 200 без постановки', async () => {
    const botId = await createBot('CREATED');
    await request(app.getHttpServer())
      .post(`/webhook/telegram/${botId}`)
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(botId))
      .send(update(1))
      .expect(200);
    expect(await countJobs()).toBe(0);
  });

  it('несуществующий бот с корректным секретом -> 200 без постановки', async () => {
    const botId = randomUUID();
    await request(app.getHttpServer())
      .post(`/webhook/telegram/${botId}`)
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(botId))
      .send(update(1))
      .expect(200);
    expect(await countJobs()).toBe(0);
  });
});
