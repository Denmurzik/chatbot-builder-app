import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config';
import { PollingService } from './polling.service';
import { TelegramApiFactory } from './telegram-api.factory';
import { describeError } from './telegram-errors';
import { webhookSecret } from './webhook-secret';

const ALLOWED_UPDATES: Array<'message' | 'callback_query'> = ['message', 'callback_query'];

// Подключение бота к Telegram: webhook по умолчанию или long polling (TELEGRAM_POLLING=1)
// для сетей, куда Telegram не может достучаться (одна копия api)
@Injectable()
export class TelegramWebhookService {
  private readonly logger = new Logger(TelegramWebhookService.name);

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly apiFactory: TelegramApiFactory,
    private readonly polling: PollingService,
  ) {}

  // Ошибка Telegram -> 502; состояние бота при этом не меняется
  async connect(botId: string, token: string): Promise<void> {
    try {
      const api = this.apiFactory.create(token);
      if (this.config.telegramPolling) {
        await api.deleteWebhook();
        await this.polling.ensureBot(botId, token);
        return;
      }
      if (!this.config.publicUrl) {
        throw new BadGatewayException('Не удалось подключить бота к Telegram: не задан PUBLIC_URL');
      }
      const url = `${this.config.publicUrl.replace(/\/+$/, '')}/webhook/telegram/${botId}`;
      await api.setWebhook(url, {
        secret_token: webhookSecret(botId),
        allowed_updates: ALLOWED_UPDATES,
      });
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Не удалось подключить бота к Telegram: ${describeError(err)}`);
    }
  }

  // Отключение best-effort: ошибки Telegram не мешают удалению бота или смене токена
  async disconnect(botId: string, token: string): Promise<void> {
    try {
      if (this.config.telegramPolling) {
        await this.polling.stopBot(botId, token);
        return;
      }
      await this.apiFactory.create(token).deleteWebhook();
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`Не удалось отключить бота ${botId} от Telegram: ${name}`);
    }
  }
}
