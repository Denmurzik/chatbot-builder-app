import { BadGatewayException, Injectable } from '@nestjs/common';
import { GrammyError } from 'grammy';
import type {
  SingleMessengerAdminAdapter,
  VerifiedMessengerInfo,
} from '../common/messenger-admin.port';
import { TelegramApiFactory } from './telegram-api.factory';
import { TelegramWebhookService } from './telegram-webhook.service';

// Адаптер администрирования Telegram: реализует SingleMessengerAdminAdapter поверх webhook/polling и getMe
@Injectable()
export class TelegramAdminAdapter implements SingleMessengerAdminAdapter {
  readonly messenger = 'TELEGRAM' as const;

  constructor(
    private readonly webhook: TelegramWebhookService,
    private readonly apiFactory: TelegramApiFactory,
  ) {}

  connect(botId: string, token: string): Promise<void> {
    return this.webhook.connect(botId, token);
  }

  disconnect(botId: string, token: string): Promise<void> {
    return this.webhook.disconnect(botId, token);
  }

  // Проверка токена вызовом getMe: 401/404 -> null, прочие ошибки -> 502
  async verifyToken(token: string): Promise<VerifiedMessengerInfo | null> {
    try {
      const me = await this.apiFactory.create(token).getMe();
      return { username: me.username ?? '' };
    } catch (err) {
      if (err instanceof GrammyError && (err.error_code === 401 || err.error_code === 404)) {
        return null;
      }
      throw new BadGatewayException('Telegram недоступен, попробуйте позже');
    }
  }
}
