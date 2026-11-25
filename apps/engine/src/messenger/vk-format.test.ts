import { describe, expect, it } from 'vitest';
import { isVkChatId, parseVkChatId, toVkInlineKeyboard } from './vk-format';

describe('vk-format', () => {
  it('isVkChatId распознаёт префикс vk:', () => {
    expect(isVkChatId('vk:123456')).toBe(true);
    expect(isVkChatId('tg:123456')).toBe(false);
    expect(isVkChatId('123456')).toBe(false);
  });

  it('parseVkChatId извлекает положительное целое число из vk:<id>', () => {
    expect(parseVkChatId('vk:1')).toBe(1);
    expect(parseVkChatId('vk:2000000001')).toBe(2000000001);
  });

  it('parseVkChatId отклоняет некорректные форматы', () => {
    expect(() => parseVkChatId('tg:123')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('123')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('vk:')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('vk:0')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('vk:-10')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('vk:12.5')).toThrow(/chatId VK/);
    expect(() => parseVkChatId('vk:abc')).toThrow(/chatId VK/);
  });

  it('toVkInlineKeyboard строит по одной кнопке в ряд при <= 6 кнопках и обрезает подпись до 40 символов', () => {
    const longLabel = 'А'.repeat(55);
    const kb = toVkInlineKeyboard([
      { label: 'Да', callbackData: 'q1:0' },
      { label: longLabel, callbackData: 'q1:1' },
    ]);
    expect(kb).toEqual({
      inline: true,
      buttons: [
        [{ action: { type: 'callback', label: 'Да', payload: '{"callbackData":"q1:0"}' } }],
        [
          {
            action: {
              type: 'callback',
              label: 'А'.repeat(40),
              payload: '{"callbackData":"q1:1"}',
            },
          },
        ],
      ],
    });
  });

  it('toVkInlineKeyboard группирует по 2 в ряд при 7..10 кнопках и ограничивает общее число 10 кнопками', () => {
    const buttons = Array.from({ length: 12 }, (_, i) => ({
      label: `Кнопка ${i + 1}`,
      callbackData: `q:${i}`,
    }));
    const kb = toVkInlineKeyboard(buttons);
    expect(kb.inline).toBe(true);
    expect(kb.buttons).toHaveLength(5);
    expect(kb.buttons.every((row) => row.length === 2)).toBe(true);
    expect(kb.buttons.flat()).toHaveLength(10);
    expect(kb.buttons[4][1].action.label).toBe('Кнопка 10');
  });
});
