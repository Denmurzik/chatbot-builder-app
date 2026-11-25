import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createPrismaClient, type Bot, type PrismaClient } from '@chatbot/db';
import type { OutgoingMessage } from '@chatbot/engine-core';
import type { ChatEvent, Scenario } from '@chatbot/model';
import { EventQueue, createRedisConnection } from '@chatbot/queue';
import { SecretVault, envAad } from '@chatbot/vault';
import { Test, type TestingModule } from '@nestjs/testing';
import type IORedis from 'ioredis';
import { AppModule } from '../app.module';
import { HttpRequestLauncher, MessengerGateway } from '../dialog/ports';
import { APP_CONFIG, PRISMA, type AppConfig } from '../infra/tokens';

export const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';

export interface SentMessage {
  botId: string;
  chatId: string;
  message: OutgoingMessage;
}

// Подмена MessengerGateway: запоминает сообщения вместо отправки в Telegram
export class FakeMessengerGateway extends MessengerGateway {
  readonly sent: SentMessage[] = [];
  // Включённый режим имитирует сбой отправки
  failing = false;

  async sendMessage(botId: string, chatId: string, message: OutgoingMessage): Promise<void> {
    if (this.failing) throw new Error('Имитация сбоя отправки');
    this.sent.push({ botId, chatId, message });
  }
}

// Сценарий «эхо»: старт → вопрос → ответ эхом → снова вопрос
export const echoScenario: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    {
      id: 'ask',
      type: 'TEXT_INPUT',
      title: 'Ввод',
      x: 0,
      y: 0,
      question: 'Что сказать?',
      variableName: 'msg',
    },
    { id: 'say', type: 'TEXT_MESSAGE', title: 'Эхо', x: 0, y: 0, text: 'Вы сказали: {{msg}}' },
  ],
  transitions: [
    { source: { blockId: 'start', output: 'default' }, target: 'ask' },
    { source: { blockId: 'ask', output: 'default' }, target: 'say' },
    { source: { blockId: 'say', output: 'default' }, target: 'ask' },
  ],
};

export interface TestEnvVar {
  name: string;
  value: string;
  secret: boolean;
}

export interface TestEnv {
  module: TestingModule;
  db: PrismaClient;
  gateway: FakeMessengerGateway;
  queue: EventQueue;
  config: AppConfig;
  vault: SecretVault;
  createBot(scenario?: Scenario, env?: TestEnvVar[]): Promise<Bot>;
  emit(event: ChatEvent): Promise<void>;
  texts(botId: string, chatId: string): string[];
  close(): Promise<void>;
}

export function textEvent(botId: string, chatId: string, payload: string): ChatEvent {
  return { type: 'TEXT_MESSAGE', channel: 'MESSENGER', botId, chatId, userId: 'u1', payload };
}

// Ждёт выполнения условия (опрос), иначе падает по тайм-ауту
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: условие не выполнилось за отведённое время');
}

export interface TestEnvOptions {
  launcher?: HttpRequestLauncher;
  // Если true, используется реальный MessengerGateway (CompositeMessengerGateway) вместо подделки
  useRealMessengerGateway?: boolean;
  // Переопределение базового URL VK API для интеграционных тестов
  vkApiBaseUrl?: string;
}

// Поднимает приложение engine на собственной базе и собственном префиксе BullMQ
export async function createTestEnv(options: TestEnvOptions = {}): Promise<TestEnv> {
  process.env.TELEGRAM_POLLING = '0';
  const dbName = `chatbot_engine_test_${randomBytes(4).toString('hex')}`;
  const testUrl = new URL(ADMIN_URL);
  testUrl.pathname = `/${dbName}`;
  const admin = createPrismaClient(ADMIN_URL);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../../../packages/db'),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  const prefix = `test-engine-${randomUUID()}`;
  const vault = new SecretVault(Buffer.alloc(32, 7), Buffer.alloc(32, 8));
  const gateway = new FakeMessengerGateway();
  const config: AppConfig = {
    databaseUrl: testUrl.toString(),
    redisUrl: REDIS_URL,
    queuePrefix: prefix,
    ...(options.vkApiBaseUrl ? { vkApiBaseUrl: options.vkApiBaseUrl } : {}),
  };
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(SecretVault)
    .useValue(vault);
  if (!options.useRealMessengerGateway) {
    builder.overrideProvider(MessengerGateway).useValue(gateway);
  }
  if (options.launcher) {
    builder.overrideProvider(HttpRequestLauncher).useValue(options.launcher);
  }
  const module = await builder.compile();
  await module.init();

  const db = module.get<PrismaClient>(PRISMA);
  const redis: IORedis = createRedisConnection(REDIS_URL);
  const queue = new EventQueue(redis, { prefix });
  let jobSeq = 0;

  return {
    module,
    db,
    gateway,
    queue,
    config,
    vault,
    async createBot(scenario = echoScenario, env?: TestEnvVar[]) {
      const author = await db.author.create({
        data: { email: `${randomUUID()}@x.ru`, passwordHash: 'h' },
      });
      const project = await db.project.create({
        data: { authorId: author.id, name: 'p', scenario: {}, environment: [] },
      });
      const bot = await db.bot.create({
        data: {
          projectId: project.id,
          name: 'b',
          status: 'PUBLISHED',
          publishedScenario: scenario as object,
          environment: [],
        },
      });
      if (!env || env.length === 0) return bot;
      const stored = env.map((item) =>
        item.secret
          ? {
              name: item.name,
              secret: true,
              secretValue: vault.encrypt(item.value, envAad(bot.id, item.name)),
            }
          : { name: item.name, value: item.value, secret: false },
      );
      return db.bot.update({
        where: { id: bot.id },
        data: { environment: stored as object[] },
      });
    },
    async emit(event) {
      jobSeq += 1;
      await queue.enqueue(event, `job-${jobSeq}`);
    },
    texts(botId, chatId) {
      return gateway.sent
        .filter((s) => s.botId === botId && s.chatId === chatId)
        .map((s) => s.message.text);
    },
    async close() {
      await module.close();
      await queue.close();
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
