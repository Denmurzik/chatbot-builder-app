import { randomUUID } from 'node:crypto';
import type { ChatEvent } from '@chatbot/model';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisConnection } from './connection';
import { EventQueue } from './event-queue';
import { PARTITIONS, dialogKey, partitionOf, queueName } from './partition';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379';
// Уникальный префикс, чтобы не пересекаться с другими worktree
const prefix = `test-queue-${randomUUID()}`;

const event = (chatId: string): ChatEvent => ({
  type: 'TEXT_MESSAGE',
  channel: 'MESSENGER',
  botId: 'bot1',
  chatId,
  userId: 'u1',
  payload: 'привет',
});

describe('EventQueue', () => {
  const redis = createRedisConnection(REDIS_URL);
  let queue: EventQueue;

  beforeAll(() => {
    queue = new EventQueue(redis, { prefix });
  });

  afterAll(async () => {
    await queue.close();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('enqueue дважды с одним jobId даёт одно задание в нужном разделе', async () => {
    const ev = event('c1');
    await queue.enqueue(ev, 'job-1');
    await queue.enqueue(ev, 'job-1');

    const p = partitionOf(dialogKey(ev.botId, ev.chatId));
    const probe = new Queue(queueName(p), { connection: redis, prefix });
    try {
      const counts = await probe.getJobCounts('waiting', 'active', 'delayed');
      expect(counts.waiting).toBe(1);
      const job = await probe.getJob('job-1');
      expect(job?.name).toBe('event');
      expect(job?.data).toEqual(ev);
      expect(job?.opts.attempts).toBe(1);
    } finally {
      await probe.close();
    }

    // в остальных разделах пусто
    let total = 0;
    for (let i = 0; i < PARTITIONS; i++) {
      const q = new Queue(queueName(i), { connection: redis, prefix });
      total += (await q.getJobCounts('waiting')).waiting;
      await q.close();
    }
    expect(total).toBe(1);
  });

  it('setGlobalConcurrency применяется ко всем разделам', async () => {
    await queue.setGlobalConcurrency(3);
    for (let i = 0; i < PARTITIONS; i++) {
      const q = new Queue(queueName(i), { connection: redis, prefix });
      expect(await q.getGlobalConcurrency()).toBe(3);
      await q.close();
    }
  });
});
