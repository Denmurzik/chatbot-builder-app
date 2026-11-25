import type { OutgoingMessageLike, PreviewEvent } from '@chatbot/model';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import IORedis from 'ioredis';
import { PreviewNotifier } from '../dialog/ports';
import { APP_CONFIG, type AppConfig } from '../infra/tokens';

/**
 * Публикатор событий канала PREVIEW в Redis pub/sub (`preview:<chatId>`):
 * сообщения бота, подсветка текущего блока, переменные и системные сообщения (UC-A-20…A-23).
 */
@Injectable()
export class PreviewPublisher extends PreviewNotifier implements OnApplicationShutdown {
  private readonly logger = new Logger(PreviewPublisher.name);
  private readonly redis: IORedis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    // Отдельный клиент без бесконечной очереди команд, чтобы сбой Redis не подвешивал воркер раздела
    this.redis = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (error: unknown) => {
      this.logger.warn(`Ошибка соединения Redis в PreviewPublisher: ${String(error)}`);
    });
  }

  async publishMessage(chatId: string, message: OutgoingMessageLike): Promise<void> {
    await this.publish(chatId, { type: 'message', message });
  }

  async publishCurrentBlock(chatId: string, blockId: string | null): Promise<void> {
    await this.publish(chatId, { type: 'currentBlock', blockId });
  }

  async publishVariables(chatId: string, variables: Record<string, string>): Promise<void> {
    await this.publish(chatId, { type: 'variables', variables });
  }

  async publishSystemMessage(
    chatId: string,
    text: string,
    blockId: string | null = null,
  ): Promise<void> {
    await this.publish(chatId, { type: 'system', text, blockId });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async publish(chatId: string, event: PreviewEvent): Promise<void> {
    await this.redis.publish(`preview:${chatId}`, JSON.stringify(event));
  }
}
