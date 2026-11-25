import { GrammyError } from 'grammy';

// Возвращает только имя типа ошибки, чтобы не утекли URL/токены из сообщения
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError';
}

// Текст ошибки для автора без URL и токена: только описание Telegram, иначе общая фраза
export function describeError(err: unknown): string {
  if (err instanceof GrammyError) return err.description;
  return 'Telegram недоступен';
}
