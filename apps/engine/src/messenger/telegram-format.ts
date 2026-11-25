import type { OutgoingButton } from '@chatbot/engine-core';

// chatId вида `tg:123` (или просто число) → числовой id чата Telegram
export function parseTelegramChatId(chatId: string): number {
  const raw = chatId.startsWith('tg:') ? chatId.slice(3) : chatId;
  if (!/^-?\d+$/.test(raw)) throw new Error(`Некорректный chatId Telegram: ${chatId}`);
  return Number(raw);
}

// Кнопки вопроса → inline keyboard, по одной кнопке в ряд
export function toInlineKeyboard(
  buttons: OutgoingButton[],
): { text: string; callback_data: string }[][] {
  return buttons.map((b) => [{ text: b.label, callback_data: b.callbackData }]);
}
