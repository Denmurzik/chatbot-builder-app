import { describe, expect, it } from 'vitest';
import {
  botConnectionViewSchema,
  botViewSchema,
  messengerTypeSchema,
  vkConnectionModeSchema,
} from './bots';

describe('bots schemas', () => {
  it('принимает допустимые типы мессенджеров и режимы VK', () => {
    expect(messengerTypeSchema.parse('TELEGRAM')).toBe('TELEGRAM');
    expect(messengerTypeSchema.parse('VK')).toBe('VK');
    expect(() => messengerTypeSchema.parse('WHATSAPP')).toThrow();

    expect(vkConnectionModeSchema.parse('CALLBACK')).toBe('CALLBACK');
    expect(vkConnectionModeSchema.parse('LONG_POLL')).toBe('LONG_POLL');
    expect(() => vkConnectionModeSchema.parse('WEBHOOK')).toThrow();
  });

  it('валидирует представление бота с подключениями Telegram и VK', () => {
    const parsed = botViewSchema.parse({
      id: 'bot-1',
      name: 'Клиника',
      status: 'PUBLISHED',
      publishedAt: '2026-11-22T12:00:00.000Z',
      connections: [
        { messenger: 'TELEGRAM', tokenMask: '1234…abcd' },
        {
          messenger: 'VK',
          tokenMask: 'vk1.…9876',
          vkGroupId: 220123456,
          vkMode: 'CALLBACK',
          vkHasSecret: true,
          vkConfirmationCode: 'abc123',
        },
      ],
      environment: [],
    });

    expect(parsed.connections).toHaveLength(2);
    expect(parsed.connections[1]?.vkGroupId).toBe(220123456);
    expect(parsed.connections[1]?.vkMode).toBe('CALLBACK');
  });

  it('отклоняет некорректный vkGroupId', () => {
    expect(() =>
      botConnectionViewSchema.parse({
        messenger: 'VK',
        tokenMask: 'vk1.…9876',
        vkGroupId: 0,
      }),
    ).toThrow();

    expect(() =>
      botConnectionViewSchema.parse({
        messenger: 'VK',
        tokenMask: 'vk1.…9876',
        vkGroupId: 12.5,
      }),
    ).toThrow();
  });
});
