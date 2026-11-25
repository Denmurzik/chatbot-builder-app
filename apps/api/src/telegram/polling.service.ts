import { SecretVault, tokenAad } from '@chatbot/vault';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Bot } from 'grammy';
import { API_CONFIG, type ApiConfig } from '../config';
import { PrismaService } from '../prisma/prisma.module';
import { telegramClientOptions } from './telegram-client-options';
import { errorName } from './telegram-errors';
import { UpdateIngestService } from './update-ingest.service';

// Long polling вместо webhook для опубликованных ботов (TELEGRAM_POLLING=1):
// для сетей, куда Telegram не может достучаться (одна копия api)
@Injectable()
export class PollingService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(PollingService.name);
  private readonly running = new Map<string, { bot: Bot; token: string }>();

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly prisma: PrismaService,
    private readonly ingestService: UpdateIngestService,
    private readonly vault: SecretVault,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.telegramPolling) return;
    const connections = await this.prisma.client.messengerConnection.findMany({
      where: { messenger: 'TELEGRAM', bot: { status: 'PUBLISHED' } },
    });
    for (const connection of connections) {
      try {
        await this.ensureBot(connection.botId);
      } catch (err) {
        // Сообщение ошибки может содержать URL с токеном — логируем только тип
        this.logger.error(
          `Не удалось запустить polling бота ${connection.botId}: ${errorName(err)}`,
        );
      }
    }
  }

  // Запускает опрос бота, если он ещё не запущен; при смене токена перезапускает
  async ensureBot(botId: string, knownToken?: string): Promise<void> {
    let resolved = knownToken;
    if (resolved === undefined) {
      const connection = await this.prisma.client.messengerConnection.findUnique({
        where: { botId_messenger: { botId, messenger: 'TELEGRAM' } },
      });
      if (!connection) return;
      resolved = this.vault.decrypt(
        { cipherText: connection.tokenCipher, mask: connection.tokenMask },
        tokenAad(botId),
      );
    }
    const token: string = resolved;
    const running = this.running.get(botId);
    if (running?.token === token) return;
    if (running) await this.stopBot(botId);

    const client = telegramClientOptions(this.config.telegramProxy);
    const bot = new Bot(token, client ? { client } : undefined);
    bot.use(async (ctx) => {
      try {
        await this.ingestService.ingest(botId, ctx.update);
      } catch (err) {
        this.logger.error(`Ошибка приёма обновления бота ${botId}: ${errorName(err)}`);
      }
    });
    this.running.set(botId, { bot, token });
    // Запускаем polling в фоне без блокировки; bot.start() сам снимает webhook.
    // Сбой bot.start() пишется в лог без токена; автоматического перезапуска нет
    void bot.start().catch((err: unknown) => {
      this.logger.error(`Polling бота ${botId} остановлен: ${errorName(err)}`);
    });
    this.logger.log(`Long polling запущен для бота ${botId}`);
  }

  // Если указан token, останавливает опрос только когда он работает именно с этим токеном
  // (смена токена: отключение старого не должно гасить уже запущенный опрос с новым)
  async stopBot(botId: string, token?: string): Promise<void> {
    const running = this.running.get(botId);
    if (!running) return;
    if (token !== undefined && running.token !== token) return;
    this.running.delete(botId);
    await running.bot.stop().catch(() => undefined);
  }

  // Останавливаем polling до закрытия Prisma и очереди в onApplicationShutdown
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stopBot(id)));
  }
}
