import type { OutgoingMessage, PendingHttpRequest } from '@chatbot/engine-core';
import type { OutgoingMessageLike } from '@chatbot/model';

/** Исходящий HTTP-запрос блока «HTTP-запрос». */
export interface OutgoingHttpRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

// Порт запуска исходящего HTTP-запроса после фиксации транзакции (реализуется в HttpModule)
export abstract class HttpRequestLauncher {
  abstract launch(request: OutgoingHttpRequest, pending: PendingHttpRequest): void;
}

// Порт публикации событий превью (реализуется в PreviewModule)
export abstract class PreviewNotifier {
  abstract publishMessage(chatId: string, message: OutgoingMessageLike): Promise<void>;
  abstract publishCurrentBlock(chatId: string, blockId: string | null): Promise<void>;
  abstract publishVariables(chatId: string, variables: Record<string, string>): Promise<void>;
  abstract publishSystemMessage(
    chatId: string,
    text: string,
    blockId?: string | null,
  ): Promise<void>;
}

// Порт отправки сообщений пользователю (реализуется в MessengerModule; в тестах заменяется подделкой)
export abstract class MessengerGateway {
  abstract sendMessage(botId: string, chatId: string, message: OutgoingMessage): Promise<void>;

  // Пачка сообщений одного события; при первой ошибке остальные не отправляются, чтобы не нарушить порядок
  async sendMessages(botId: string, chatId: string, messages: OutgoingMessage[]): Promise<void> {
    for (const message of messages) await this.sendMessage(botId, chatId, message);
  }
}
