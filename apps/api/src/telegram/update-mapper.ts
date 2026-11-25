import type { ChatEvent } from '@chatbot/model';
import type { Update } from 'grammy/types';

export type TelegramUpdate = Update;

const START_PATTERN = /^\/start(?:@\w+)?(?:\s|$)/;

// Строит ChatEvent и jobId из обновления Telegram (п. 2.1); неподдерживаемые обновления -> null
export function mapUpdate(
  botId: string,
  update: TelegramUpdate,
): { event: ChatEvent; jobId: string } | null {
  const jobId = `tg-${botId}-${update.update_id}`;

  if (update.callback_query) {
    const query = update.callback_query;
    const chat = query.message?.chat;
    if (!chat || !query.from || typeof query.data !== 'string') return null;
    const separator = query.data.indexOf(':');
    const sourceBlockId = separator >= 0 ? query.data.slice(0, separator) : query.data;
    return {
      event: {
        type: 'BUTTON_PRESS',
        channel: 'MESSENGER',
        botId,
        chatId: `tg:${chat.id}`,
        userId: `tg:${query.from.id}`,
        payload: query.data,
        sourceBlockId,
      },
      jobId,
    };
  }

  const message = update.message;
  if (!message?.chat || !message.from) return null;
  const text = message.text;
  const base = {
    channel: 'MESSENGER' as const,
    botId,
    chatId: `tg:${message.chat.id}`,
    userId: `tg:${message.from.id}`,
  };

  if (text !== undefined && START_PATTERN.test(text)) {
    return { event: { type: 'START_COMMAND', ...base }, jobId };
  }
  // Фото, стикер и прочее без текста — текстовое сообщение с пустым payload
  return { event: { type: 'TEXT_MESSAGE', ...base, payload: text ?? '' }, jobId };
}
