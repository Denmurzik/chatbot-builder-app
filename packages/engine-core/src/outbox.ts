import type { DialogState, EncryptedSecret, HttpMethod } from '@chatbot/model';

// Кнопка вопроса: подпись и код `<blockId>:<индекс>` (п. 2.1)
export interface OutgoingButton {
  label: string;
  callbackData: string;
}

// Исходящее сообщение пользователю
export type OutgoingMessage =
  | { kind: 'text'; text: string }
  | { kind: 'question'; text: string; buttons: OutgoingButton[] }
  | { kind: 'system'; text: string; blockId?: string | null };

// Заголовок подготовленного HTTP-запроса: секретное значение передаётся как есть (расшифровка — в задаче 8)
export interface PendingHttpHeader {
  name: string;
  value: string;
  secret: boolean;
  secretValue?: EncryptedSecret;
}

// HTTP-запрос, который должен выполнить внешний исполнитель
export interface PendingHttpRequest {
  blockId: string;
  method: HttpMethod;
  url: string;
  headers: PendingHttpHeader[];
  body: string | null;
  timeoutSec: number;
  retryCount: number;
  retryIntervalSec: number;
}

// Результат выполнения внешнего HTTP-запроса (события RESPONSE_RECEIVED / REQUEST_FAILED)
export type HttpOutcome =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'failure'; code: number; message: string };

// Состояние контекста диалога, которое движок получает и возвращает
export interface DialogContextState {
  state: DialogState;
  currentBlockId: string | null;
  variables: Record<string, string>;
  currentRequestId: string | null;
}

// Результат обработки события
export interface EngineResult {
  context: DialogContextState;
  outbox: OutgoingMessage[];
  httpRequest: PendingHttpRequest | null;
  highlightBlockId: string | null;
  stale: boolean;
  resumeRequestId: string | null;
}
