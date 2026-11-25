import { describe, expect, it } from 'vitest';
import { PARTITIONS, dialogKey, fnv1a32, partitionOf, queueName } from './partition';

// Эталонная реализация FNV-1a 32 бита по UTF-8 байтам (независимая от кода пакета)
function referenceFnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(key, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

describe('partition', () => {
  it('использует 16 разделов', () => {
    expect(PARTITIONS).toBe(16);
  });

  it('dialogKey: botId или preview плюс chatId', () => {
    expect(dialogKey('bot1', 'tg:1')).toBe('bot1:tg:1');
    expect(dialogKey(null, 'tg:1')).toBe('preview:tg:1');
  });

  it('partitionOf детерминирован и лежит в диапазоне 0..15', () => {
    for (let i = 0; i < 500; i++) {
      const key = `bot${i}:chat-${i * 7}`;
      const p = partitionOf(key);
      expect(p).toBe(partitionOf(key));
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(16);
    }
  });

  it('partitionOf совпадает с эталонным FNV-1a mod 16', () => {
    const expected = referenceFnv1a('preview:tg:1') % 16;
    expect(partitionOf('preview:tg:1')).toBe(expected);
    for (const key of ['', 'a', 'бот:чат-1', 'bot:😀']) {
      expect(partitionOf(key)).toBe(referenceFnv1a(key) % 16);
    }
  });

  it('fnv1a32 совпадает с известными векторами FNV-1a 32', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('распределяет ключи по разным разделам', () => {
    const used = new Set<number>();
    for (let i = 0; i < 200; i++) used.add(partitionOf(`bot:chat-${i}`));
    expect(used.size).toBeGreaterThan(8);
  });

  it('queueName: events-<номер>', () => {
    expect(queueName(0)).toBe('events-0');
    expect(queueName(15)).toBe('events-15');
  });
});
