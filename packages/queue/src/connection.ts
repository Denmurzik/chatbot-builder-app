import IORedis from 'ioredis';

// Соединение для BullMQ; maxRetriesPerRequest: null нужен воркерам (блокирующие команды)
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}
