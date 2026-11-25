import type { EventQueue } from '@chatbot/queue';
import { SecretVault, tokenAad } from '@chatbot/vault';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { parseVkStoredConfig } from '../common/messenger-admin.port';
import { API_CONFIG, type ApiConfig } from '../config';
import { PrismaService } from '../prisma/prisma.module';
import { EVENT_QUEUE } from '../queue/queue.module';
import { VkApiClient } from './vk-api.client';
import { mapVkUpdate, type VkMessageEventObject, type VkUpdate } from './vk-update-mapper';

const RETRY_DELAY_MS = 1000;

interface RunningBotLoop {
  controller: AbortController;
  token: string;
  groupId: number;
  loop: Promise<void>;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Bots Long Poll клиент для опубликованных VK-ботов с режимом LONG_POLL
@Injectable()
export class VkPollingService
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(VkPollingService.name);
  private readonly running = new Map<string, RunningBotLoop>();

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly prisma: PrismaService,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    private readonly vault: SecretVault,
    private readonly vkApi: VkApiClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.vkPollingEnabled) return;
    const connections = await this.prisma.client.messengerConnection.findMany({
      where: { messenger: 'VK', bot: { status: 'PUBLISHED' } },
    });
    for (const connection of connections) {
      const cfg = parseVkStoredConfig(connection.config);
      if (!cfg || cfg.mode !== 'LONG_POLL') continue;
      try {
        const token = this.vault.decrypt(
          { cipherText: connection.tokenCipher, mask: connection.tokenMask },
          tokenAad(connection.botId, 'VK'),
        );
        await this.startBot(connection.botId, token, cfg.groupId);
      } catch (err) {
        this.logger.error(
          `Не удалось запустить VK Long Poll для бота ${connection.botId}: ${
            err instanceof Error ? err.name : 'UnknownError'
          }`,
        );
      }
    }
  }

  // Запускает цикл Bots Long Poll для бота; при смене токена или groupId перезапускает
  async startBot(botId: string, token: string, groupId: number): Promise<void> {
    if (!this.config.vkPollingEnabled) return;
    const existing = this.running.get(botId);
    if (existing && existing.token === token && existing.groupId === groupId) {
      return;
    }
    if (existing) {
      await this.stopBot(botId);
    }

    const controller = new AbortController();
    const loop = this.runLoop(botId, token, groupId, controller.signal);
    this.running.set(botId, { controller, token, groupId, loop });
    this.logger.log(`VK Bots Long Poll запущен для бота ${botId} (группа ${groupId})`);
  }

  // Останавливает цикл опроса бота (если передан token — только при совпадении токена)
  async stopBot(botId: string, token?: string): Promise<void> {
    const existing = this.running.get(botId);
    if (!existing) return;
    if (token !== undefined && existing.token !== token) return;
    this.running.delete(botId);
    existing.controller.abort();
    await existing.loop.catch(() => undefined);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stopAll();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopAll();
  }

  private async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stopBot(id)));
  }

  private async runLoop(
    botId: string,
    token: string,
    groupId: number,
    signal: AbortSignal,
  ): Promise<void> {
    let serverInfo: { key: string; server: string; ts: string } | null = null;

    while (!signal.aborted) {
      try {
        if (!serverInfo) {
          serverInfo = await this.vkApi.getLongPollServer(token, groupId);
          if (signal.aborted) break;
        }

        const res = await this.vkApi.pollLongPoll(
          serverInfo.server,
          serverInfo.key,
          serverInfo.ts,
          signal,
        );
        if (signal.aborted) break;

        if (res.failed === 1) {
          if (res.ts !== undefined) {
            serverInfo = { ...serverInfo, ts: res.ts };
          }
          continue;
        }
        if (res.failed === 2 || res.failed === 3) {
          serverInfo = null;
          continue;
        }

        if (res.ts !== undefined) {
          serverInfo = { ...serverInfo, ts: res.ts };
        }

        for (const update of res.updates ?? []) {
          if (signal.aborted) break;
          await this.handleUpdate(botId, token, update);
        }
      } catch (err) {
        if (signal.aborted) break;
        this.logger.warn(
          `Ошибка VK Long Poll для бота ${botId}: ${err instanceof Error ? err.name : 'UnknownError'}`,
        );
        serverInfo = null;
        await abortableDelay(RETRY_DELAY_MS, signal);
      }
    }
  }

  private async handleUpdate(botId: string, token: string, update: VkUpdate): Promise<void> {
    if (update.type === 'message_event') {
      const obj = update.object as VkMessageEventObject | undefined;
      if (obj?.event_id && typeof obj.user_id === 'number' && typeof obj.peer_id === 'number') {
        try {
          await this.vkApi.sendMessageEventAnswer(token, {
            eventId: obj.event_id,
            userId: obj.user_id,
            peerId: obj.peer_id,
          });
        } catch (err) {
          this.logger.warn(
            `Не удалось отправить messages.sendMessageEventAnswer (Long Poll) для бота ${botId}: ${
              err instanceof Error ? err.name : 'UnknownError'
            }`,
          );
        }
      }
    }

    const mapped = mapVkUpdate(botId, update);
    if (mapped) {
      await this.queue.enqueue(mapped.event, mapped.jobId);
    }
  }
}
