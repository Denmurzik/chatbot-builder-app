import type { OutgoingMessage } from '@chatbot/engine-core';
import { Injectable } from '@nestjs/common';
import { MessengerGateway } from '../dialog/ports';
import { TelegramMessengerGateway } from './messenger-gateway';
import { isVkChatId } from './vk-format';
import { VkMessengerGateway } from './vk-messenger-gateway';

// Маршрутизатор исходящих сообщений по префиксу chatId: `vk:` → VK, остальное → Telegram
@Injectable()
export class CompositeMessengerGateway extends MessengerGateway {
  constructor(
    private readonly telegram: TelegramMessengerGateway,
    private readonly vk: VkMessengerGateway,
  ) {
    super();
  }

  async sendMessage(botId: string, chatId: string, message: OutgoingMessage): Promise<void> {
    if (isVkChatId(chatId)) {
      await this.vk.sendMessage(botId, chatId, message);
      return;
    }
    await this.telegram.sendMessage(botId, chatId, message);
  }

  override async sendMessages(
    botId: string,
    chatId: string,
    messages: OutgoingMessage[],
  ): Promise<void> {
    if (isVkChatId(chatId)) {
      await this.vk.sendMessages(botId, chatId, messages);
      return;
    }
    await this.telegram.sendMessages(botId, chatId, messages);
  }
}
