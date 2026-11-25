import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@chatbot/db';
import type { OutgoingMessage } from '@chatbot/engine-core';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { Inject, Injectable } from '@nestjs/common';
import { MessengerGateway } from '../dialog/ports';
import { APP_CONFIG, DEFAULT_VK_API_BASE_URL, PRISMA, type AppConfig } from '../infra/tokens';
import { parseVkChatId, toVkInlineKeyboard } from './vk-format';

const VK_API_VERSION = '5.199';
// Верхняя граница для положительного 32-битного signed int (random_id в VK API)
const VK_RANDOM_ID_MAX = 2_147_483_647;

interface VkApiError {
  error_code?: number;
  error_msg?: string;
}

interface VkApiResponse {
  response?: unknown;
  error?: VkApiError;
}

// Реализация порта MessengerGateway для ВКонтакте: токен расшифровывается в памяти
@Injectable()
export class VkMessengerGateway extends MessengerGateway {
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
    const token = await this.loadAccessToken(botId);
    const peerId = parseVkChatId(chatId);
    const baseUrl = (this.config.vkApiBaseUrl ?? DEFAULT_VK_API_BASE_URL).replace(/\/+$/, '');
    const endpoint = `${baseUrl}/messages.send`;

    for (const message of messages) {
      await this.sendOne(endpoint, token, peerId, message);
    }
  }

  private async loadAccessToken(botId: string): Promise<string> {
    const connection = await this.prisma.messengerConnection.findUnique({
      where: { botId_messenger: { botId, messenger: 'VK' } },
    });
    if (!connection) {
      throw new Error(`У бота ${botId} нет подключения к VK`);
    }
    return this.vault.decrypt(
      { cipherText: connection.tokenCipher, mask: connection.tokenMask },
      tokenAad(botId, 'VK'),
    );
  }

  private async sendOne(
    endpoint: string,
    accessToken: string,
    peerId: number,
    message: OutgoingMessage,
  ): Promise<void> {
    const params = new URLSearchParams({
      v: VK_API_VERSION,
      access_token: accessToken,
      peer_id: String(peerId),
      random_id: String(randomInt(1, VK_RANDOM_ID_MAX)),
      message: message.text,
    });
    if (message.kind === 'question' && message.buttons.length > 0) {
      params.set('keyboard', JSON.stringify(toVkInlineKeyboard(message.buttons)));
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      throw new Error(
        `Ошибка VK API messages.send: HTTP ${response.status}${rawBody ? ` (${rawBody.slice(0, 200)})` : ''}`,
      );
    }

    const body = (await response.json()) as VkApiResponse;
    if (body && typeof body === 'object' && body.error) {
      const code = body.error.error_code ?? 'unknown';
      const msg = body.error.error_msg ?? 'неизвестная ошибка';
      throw new Error(`Ошибка VK API messages.send (${code}): ${msg}`);
    }
  }
}
