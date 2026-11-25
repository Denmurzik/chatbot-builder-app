import type { EventQueue } from '@chatbot/queue';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { EVENT_QUEUE } from '../queue/queue.module';
import { TelegramApiFactory } from './telegram-api.factory';
import { errorName } from './telegram-errors';
import { mapUpdate, type TelegramUpdate } from './update-mapper';

// Общий путь приёма обновлений (webhook и long polling): проверка публикации -> mapUpdate -> очередь
@Injectable()
export class UpdateIngestService {
  private readonly logger = new Logger(UpdateIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    private readonly vault: SecretVault,
    private readonly apiFactory: TelegramApiFactory,
  ) {}

  // Возвращает true, если задание поставлено в очередь
  async ingest(botId: string, update: TelegramUpdate): Promise<boolean> {
    const bot = await this.prisma.client.bot.findUnique({
      where: { id: botId },
      select: { status: true },
    });
    if (bot?.status !== 'PUBLISHED') return false;
    const mapped = mapUpdate(botId, update);
    if (mapped) await this.queue.enqueue(mapped.event, mapped.jobId);
    if (update.callback_query) {
      // Не ждём ответа Telegram, чтобы не задерживать 200 на webhook; ошибки логируются внутри
      void this.answerCallback(botId, update.callback_query.id);
    }
    return mapped !== null;
  }

  // Снимает индикатор загрузки на кнопке; сбой не должен ломать приём события
  private async answerCallback(botId: string, callbackQueryId: string): Promise<void> {
    try {
      const connection = await this.prisma.client.messengerConnection.findUnique({
        where: { botId_messenger: { botId, messenger: 'TELEGRAM' } },
      });
      if (!connection) return;
      const token = this.vault.decrypt(
        { cipherText: connection.tokenCipher, mask: connection.tokenMask },
        tokenAad(botId),
      );
      await this.apiFactory.create(token).answerCallbackQuery(callbackQueryId);
    } catch (err) {
      this.logger.warn(`Не удалось ответить на нажатие кнопки бота ${botId}: ${errorName(err)}`);
    }
  }
}
