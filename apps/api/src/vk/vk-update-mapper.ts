import type { ChatEvent } from '@chatbot/model';

export interface VkMessageObject {
  id?: number;
  conversation_message_id?: number;
  peer_id: number;
  from_id: number;
  text?: string;
  out?: number;
  payload?: unknown;
}

export interface VkMessageEventObject {
  user_id: number;
  peer_id: number;
  event_id: string;
  payload?: unknown;
}

export interface VkUpdate {
  type: string;
  group_id?: number;
  event_id?: string;
  secret?: string;
  object?: unknown;
}

const START_PATTERN = /^\/start(?:\s|$)/i;
const RUSSIAN_START_PATTERN = /^начать$/i;

function extractCallbackData(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { callbackData?: unknown }).callbackData === 'string'
      ) {
        const value = (parsed as { callbackData: string }).callbackData;
        return value.length > 0 ? value : null;
      }
    } catch {
      // Сырая строка формата 'blockId:idx'
    }
    return trimmed;
  }
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { callbackData?: unknown }).callbackData === 'string'
  ) {
    const value = (payload as { callbackData: string }).callbackData;
    return value.length > 0 ? value : null;
  }
  return null;
}

// Преобразует входящее событие VK (Callback API / Bots Long Poll) в ChatEvent и дедупликационный jobId
export function mapVkUpdate(
  botId: string,
  update: VkUpdate,
): { event: ChatEvent; jobId: string } | null {
  if (update.type === 'message_new') {
    const rawObj = update.object as { message?: VkMessageObject } | VkMessageObject | undefined;
    const message: VkMessageObject | undefined =
      rawObj && typeof rawObj === 'object' && 'message' in rawObj && rawObj.message
        ? rawObj.message
        : (rawObj as VkMessageObject | undefined);

    if (!message || typeof message.peer_id !== 'number' || typeof message.from_id !== 'number') {
      return null;
    }
    // Исходящие сообщения самого сообщества игнорируем
    if (message.out === 1) return null;

    const text = typeof message.text === 'string' ? message.text : '';
    const trimmed = text.trim();
    // Пустые нетекстовые вложения (стикеры/фото без текста) игнорируем
    if (trimmed.length === 0) return null;

    const suffix = update.event_id || message.conversation_message_id || message.id;
    if (!suffix) return null;

    const jobId = `vk-${botId}-${String(suffix)}`;
    const base = {
      channel: 'MESSENGER' as const,
      botId,
      chatId: `vk:${message.peer_id}`,
      userId: `vk:${message.from_id}`,
    };

    if (START_PATTERN.test(trimmed) || RUSSIAN_START_PATTERN.test(trimmed)) {
      return { event: { type: 'START_COMMAND', ...base }, jobId };
    }
    return { event: { type: 'TEXT_MESSAGE', ...base, payload: text }, jobId };
  }

  if (update.type === 'message_event') {
    const obj = update.object as VkMessageEventObject | undefined;
    if (
      !obj ||
      typeof obj.peer_id !== 'number' ||
      typeof obj.user_id !== 'number' ||
      typeof obj.event_id !== 'string' ||
      obj.event_id.length === 0
    ) {
      return null;
    }
    const callbackData = extractCallbackData(obj.payload);
    if (!callbackData) return null;

    const lastColon = callbackData.lastIndexOf(':');
    const sourceBlockId = lastColon >= 0 ? callbackData.slice(0, lastColon) : callbackData;

    return {
      event: {
        type: 'BUTTON_PRESS',
        channel: 'MESSENGER',
        botId,
        chatId: `vk:${obj.peer_id}`,
        userId: `vk:${obj.user_id}`,
        payload: callbackData,
        sourceBlockId,
      },
      jobId: `vk-${botId}-${obj.event_id}`,
    };
  }

  return null;
}
