import type { PrismaClient } from '@chatbot/db';
import type { OutgoingMessage } from '@chatbot/engine-core';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { Inject, Injectable } from '@nestjs/common';
import { Api } from 'grammy';
import { MessengerGateway } from '../dialog/ports';
import { APP_CONFIG, PRISMA, type AppConfig } from '../infra/tokens';
import { telegramClientOptions } from './telegram-client-options';
import { parseTelegramChatId, toInlineKeyboard } from './telegram-format';

// Реализация порта MessengerGateway для Telegram: токен расшифровывается в памяти
@Injectable()
export class TelegramMessengerGateway extends MessengerGateway {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly vault: SecretVault,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async sendMessage(botId: string, chatId: string, message: OutgoingMessage): Promise<void> {
    await this.sendMessages(botId, chatId, [message]);
  }

  // Токен читается и расшифровывается один раз на пачку сообщений
  override async sendMessages(
    botId: string,
    chatId: string,
    messages: OutgoingMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;
    const api = await this.createApi(botId);
    const telegramChatId = parseTelegramChatId(chatId);
    for (const message of messages) {
      if (message.kind === 'question' && message.buttons.length > 0) {
        await api.sendMessage(telegramChatId, message.text, {
          reply_markup: { inline_keyboard: toInlineKeyboard(message.buttons) },
        });
      } else {
        await api.sendMessage(telegramChatId, message.text);
      }
    }
  }

  private async createApi(botId: string): Promise<Api> {
    const connection = await this.prisma.messengerConnection.findUnique({
      where: { botId_messenger: { botId, messenger: 'TELEGRAM' } },
    });
    if (!connection) throw new Error(`У бота ${botId} нет подключения к Telegram`);
    const token = this.vault.decrypt(
      { cipherText: connection.tokenCipher, mask: connection.tokenMask },
      tokenAad(botId),
    );
    return new Api(token, telegramClientOptions(this.config.telegramProxy));
  }
}
