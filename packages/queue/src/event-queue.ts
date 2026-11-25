import type { ChatEvent } from '@chatbot/model';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { createRedisConnection } from './connection';
import { PARTITIONS, dialogKey, partitionOf, queueName } from './partition';

export interface EventQueueOptions {
  // Префикс ключей BullMQ в Redis (по умолчанию стандартный «bull»)
  prefix?: string;
}

// Очередь событий диалогов: 16 разделов BullMQ, порядок сохраняется внутри раздела
export class EventQueue {
  private readonly connection: IORedis;
  private readonly ownsConnection: boolean;
  private readonly queues: Queue[];

  constructor(redis: string | IORedis, options: EventQueueOptions = {}) {
    this.ownsConnection = typeof redis === 'string';
    this.connection = typeof redis === 'string' ? createRedisConnection(redis) : redis;
    this.queues = Array.from(
      { length: PARTITIONS },
      (_, p) =>
        new Queue(queueName(p), {
          connection: this.connection,
          ...(options.prefix ? { prefix: options.prefix } : {}),
        }),
    );
  }

  // Повторный вызов с тем же jobId не создаёт второго задания
  async enqueue(event: ChatEvent, jobId: string): Promise<void> {
    const partition = partitionOf(dialogKey(event.botId, event.chatId));
    await this.queues[partition].add('event', event, {
      jobId,
      attempts: 1,
      removeOnComplete: 1000,
    });
  }

  // Ограничение числа одновременных заданий на каждый из 16 разделов
  async setGlobalConcurrency(n: number): Promise<void> {
    await Promise.all(this.queues.map((q) => q.setGlobalConcurrency(n)));
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map((q) => q.close()));
    if (this.ownsConnection) await this.connection.quit();
  }
}
