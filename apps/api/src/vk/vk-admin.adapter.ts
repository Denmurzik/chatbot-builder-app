import { BadGatewayException, Injectable } from '@nestjs/common';
import type {
  MessengerConnectConfig,
  SingleMessengerAdminAdapter,
  VerifiedMessengerInfo,
} from '../common/messenger-admin.port';
import { VkApiClient, VkApiError } from './vk-api.client';
import { VkPollingService } from './vk-polling.service';

// Коды ошибок VK API, означающие недействительный токен, отсутствие прав или неверный group_id
const INVALID_TOKEN_CODES = new Set([5, 15, 27, 100, 113]);

// Адаптер администрирования VK: проверка токена через groups.getById и управление Bots Long Poll
@Injectable()
export class VkAdminAdapter implements SingleMessengerAdminAdapter {
  readonly messenger = 'VK' as const;

  constructor(
    private readonly vkApi: VkApiClient,
    private readonly polling: VkPollingService,
  ) {}

  async verifyToken(
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<VerifiedMessengerInfo | null> {
    try {
      const group = await this.vkApi.getGroupById(token, config?.groupId);
      if (config?.groupId !== undefined && group.id !== config.groupId) {
        return null;
      }
      return {
        groupId: group.id,
        groupName: group.name,
        username: group.screenName,
      };
    } catch (err) {
      if (err instanceof VkApiError && INVALID_TOKEN_CODES.has(err.code)) {
        return null;
      }
      throw new BadGatewayException('VK недоступен, попробуйте позже');
    }
  }

  async connect(botId: string, token: string, config?: MessengerConnectConfig): Promise<void> {
    if (config?.mode === 'LONG_POLL' && config.groupId) {
      await this.polling.startBot(botId, token, config.groupId);
    } else {
      await this.polling.stopBot(botId);
    }
  }

  async disconnect(botId: string, token: string): Promise<void> {
    await this.polling.stopBot(botId, token);
  }
}
