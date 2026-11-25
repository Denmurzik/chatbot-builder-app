// Число разделов очереди событий (п. 2.2 спецификации)
export const PARTITIONS = 16;

// Ключ диалога: события одного диалога всегда попадают в один раздел
export function dialogKey(botId: string | null, chatId: string): string {
  return `${botId ?? 'preview'}:${chatId}`;
}

// FNV-1a 32 бита по UTF-8 байтам ключа
export function fnv1a32(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(key, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Номер раздела: остаток от деления хэша на число разделов
export function partitionOf(key: string): number {
  return fnv1a32(key) % PARTITIONS;
}

export function queueName(partition: number): string {
  return `events-${partition}`;
}
