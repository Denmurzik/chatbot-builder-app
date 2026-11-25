import { PARTITIONS, createRedisConnection, queueName } from '@chatbot/queue';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRISMA } from '../infra/tokens';
import { EVENT_QUEUE } from '../infra/tokens';
import { EventDispatcher } from './event-dispatcher';
import { REDIS_URL, createTestEnv, textEvent, waitFor, type TestEnv } from '../testing/test-env';

describe('EventDispatcher', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv();
  }, 120000);

  afterAll(async () => {
    await env?.close();
  });

  it('на каждом из 16 разделов глобальная конкурентность равна 1', async () => {
    const redis = createRedisConnection(REDIS_URL);
    try {
      for (let p = 0; p < PARTITIONS; p++) {
        const q = new Queue(queueName(p), { connection: redis, prefix: env.config.queuePrefix });
        expect(await q.getGlobalConcurrency()).toBe(1);
        await q.close();
      }
    } finally {
      await redis.quit();
    }
  });

  it('задание с неверным событием логируется и не повторяется, следующие идут дальше', async () => {
    const bot = await env.createBot();
    await env.emit({ ...textEvent(bot.id, 'tg:9', 'x'), type: 'NOPE' as never });
    await env.emit(textEvent(bot.id, 'tg:9', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:9').length >= 1);
    expect(env.texts(bot.id, 'tg:9')).toEqual(['Что сказать?']);
  });

  it('при остановке сначала закрываются воркеры, затем очередь и Prisma', async () => {
    const own = await createTestEnv();
    const order: string[] = [];
    const dispatcher = own.module.get(EventDispatcher);
    const originalDestroy = dispatcher.onModuleDestroy.bind(dispatcher);
    dispatcher.onModuleDestroy = async () => {
      await originalDestroy();
      order.push('workers');
    };
    const queue = own.module.get<{ close(): Promise<void> }>(EVENT_QUEUE);
    const originalQueueClose = queue.close.bind(queue);
    queue.close = async () => {
      order.push('queue');
      await originalQueueClose();
    };
    const prisma = own.module.get<{ $disconnect(): Promise<void> }>(PRISMA);
    const originalDisconnect = prisma.$disconnect.bind(prisma);
    prisma.$disconnect = async () => {
      order.push('prisma');
      await originalDisconnect();
    };
    await own.close();
    expect(order).toEqual(['workers', 'queue', 'prisma']);
  });
});
