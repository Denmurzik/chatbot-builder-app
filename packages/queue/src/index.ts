// Точка входа пакета @chatbot/queue
export { PARTITIONS, dialogKey, partitionOf, queueName } from './partition';
export { createRedisConnection } from './connection';
export { EventQueue } from './event-queue';
export type { EventQueueOptions } from './event-queue';
