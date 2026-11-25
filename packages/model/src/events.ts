import { z } from 'zod';

// Типы событий, поступающих в движок диалогов
export const EVENT_TYPES = [
  'START_COMMAND',
  'TEXT_MESSAGE',
  'BUTTON_PRESS',
  'RESPONSE_RECEIVED',
  'REQUEST_FAILED',
  'VERSION_PUBLISHED',
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

// Канал взаимодействия с пользователем
export const CHANNELS = ['MESSENGER', 'PREVIEW'] as const;

export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

// Состояния конечного автомата диалога
export const DIALOG_STATES = [
  'RUNNING',
  'WAITING_USER',
  'WAITING_EXTERNAL',
  'SUSPENDED',
  'FINISHED',
] as const;

export const dialogStateSchema = z.enum(DIALOG_STATES);
export type DialogState = z.infer<typeof dialogStateSchema>;

// Входящее событие диалога (кладётся в очередь и передаётся в DialogEngine)
export const chatEventSchema = z.object({
  type: eventTypeSchema,
  channel: channelSchema,
  botId: z.string().nullable(),
  chatId: z.string(),
  userId: z.string(),
  payload: z.string().optional(),
  sourceBlockId: z.string().optional(),
  requestId: z.string().optional(),
});

export type ChatEvent = z.infer<typeof chatEventSchema>;

// Кнопка вопроса в исходящем сообщении (совместима с OutgoingButton из engine-core)
export interface OutgoingButtonLike {
  label: string;
  callbackData: string;
}

// Исходящее сообщение бота (совместимо с OutgoingMessage из engine-core)
export type OutgoingMessageLike =
  | { kind: 'text'; text: string }
  | { kind: 'question'; text: string; buttons: OutgoingButtonLike[] }
  | { kind: 'system'; text: string; blockId?: string | null };

// Событие канала превью, публикуемое в Redis pub/sub (`preview:<chatId>`)
export type PreviewEvent =
  | { type: 'message'; message: OutgoingMessageLike }
  | { type: 'currentBlock'; blockId: string | null }
  | { type: 'variables'; variables: Record<string, string> }
  | { type: 'system'; text: string; blockId: string | null };

// Результат разбора chatId канала превью (`preview:<projectId>:<sessionId>`)
export interface ParsedPreviewChatId {
  projectId: string;
  sessionId: string;
}

// Разбирает chatId превью формата `preview:<projectId>:<sessionId>`.
// Разделение идёт по первому `:` после префикса: projectId не содержит двоеточий,
// а sessionId может содержать `:` (например, `preview:p:s:x` -> sessionId = `s:x`).
// При отсутствии префикса или пустых projectId/sessionId возвращает null.
export function parsePreviewChatId(chatId: string): ParsedPreviewChatId | null {
  if (!chatId.startsWith('preview:')) return null;
  const rest = chatId.slice('preview:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return {
    projectId: rest.slice(0, sep),
    sessionId: rest.slice(sep + 1),
  };
}
