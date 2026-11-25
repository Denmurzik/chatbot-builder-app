import type { PreviewEvent } from '@chatbot/model';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';

const PREVIEW_CHANNEL_PREFIX = 'preview:';
const PREVIEW_CHANNEL_PATTERN = 'preview:*';

export type PreviewEventHandler = (chatId: string, event: PreviewEvent) => void;

// Подписчик Redis pub/sub на канал превью (`preview:*`): отдельное соединение на процесс
@Injectable()
export class PreviewSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewSubscriber.name);
  private redis: IORedis | null = null;
  private handler: PreviewEventHandler | null = null;

  setHandler(handler: PreviewEventHandler): void {
    this.handler = handler;
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      throw new Error('Не задана переменная окружения REDIS_URL');
    }

    const client = new IORedis(redisUrl);
    this.redis = client;

    client.on('error', (error: unknown) => {
      this.logger.warn(`Ошибка соединения Redis в PreviewSubscriber: ${String(error)}`);
    });

    client.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      this.handleMessage(channel, raw);
    });

    await client.psubscribe(PREVIEW_CHANNEL_PATTERN);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redis) return;
    const client = this.redis;
    this.redis = null;
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }

  private handleMessage(channel: string, raw: string): void {
    if (!channel.startsWith(PREVIEW_CHANNEL_PREFIX)) return;
    const chatId = channel.slice(PREVIEW_CHANNEL_PREFIX.length);
    if (!chatId) return;

    let event: PreviewEvent;
    try {
      event = JSON.parse(raw) as PreviewEvent;
    } catch (error) {
      this.logger.warn(
        `Некорректный JSON в канале превью ${channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    this.handler?.(chatId, event);
  }
}
