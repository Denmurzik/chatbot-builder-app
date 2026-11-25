import { Inject, Injectable } from '@nestjs/common';
import { Api } from 'grammy';
import { API_CONFIG, type ApiConfig } from '../config';
import { telegramClientOptions } from './telegram-client-options';

// Подмножество Bot API, которое нужно серверу; в тестах подменяется фабрикой-заглушкой
export interface TelegramApi {
  setWebhook(
    url: string,
    other?: { secret_token?: string; allowed_updates?: Array<'message' | 'callback_query'> },
  ): Promise<unknown>;
  deleteWebhook(): Promise<unknown>;
  getMe(): Promise<{ username?: string }>;
  answerCallbackQuery(callbackQueryId: string): Promise<unknown>;
}

const REQUEST_TIMEOUT_SECONDS = 10;

// Создаёт клиент Bot API для токена (без сети до первого вызова)
@Injectable()
export class TelegramApiFactory {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  create(token: string): TelegramApi {
    return new Api(token, {
      timeoutSeconds: REQUEST_TIMEOUT_SECONDS,
      ...telegramClientOptions(this.config.telegramProxy),
    });
  }
}
