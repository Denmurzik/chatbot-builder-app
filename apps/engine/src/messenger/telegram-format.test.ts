import { describe, expect, it } from 'vitest';
import { parseTelegramChatId, toInlineKeyboard } from './telegram-format';

describe('telegram-format', () => {
  it('chatId с префиксом tg: превращается в число', () => {
    expect(parseTelegramChatId('tg:12345')).toBe(12345);
    expect(parseTelegramChatId('-100500')).toBe(-100500);
  });

  it('некорректный chatId — ошибка', () => {
    expect(() => parseTelegramChatId('web:abc')).toThrow();
  });

  it('кнопки вопроса — inline keyboard по одной в ряд', () => {
    expect(
      toInlineKeyboard([
        { label: 'Да', callbackData: 'b1:0' },
        { label: 'Нет', callbackData: 'b1:1' },
      ]),
    ).toEqual([[{ text: 'Да', callback_data: 'b1:0' }], [{ text: 'Нет', callback_data: 'b1:1' }]]);
  });
});
