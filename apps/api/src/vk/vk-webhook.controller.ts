import { timingSafeEqual } from 'node:crypto';
import type { EventQueue } from '@chatbot/queue';
import { SecretVault, tokenAad } from '@chatbot/vault';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { parseVkStoredConfig } from '../common/messenger-admin.port';
import { PrismaService } from '../prisma/prisma.module';
import { EVENT_QUEUE } from '../queue/queue.module';
import { VkApiClient } from './vk-api.client';
import { mapVkUpdate, type VkMessageEventObject, type VkUpdate } from './vk-update-mapper';

function secretsEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Публичный контроллер приёма событий VK Callback API; маршрут вне префикса /api
@Controller('webhook/vk')
export class VkWebhookController {
  private readonly logger = new Logger(VkWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
    private readonly vault: SecretVault,
    private readonly vkApi: VkApiClient,
  ) {}

  @Post(':botId')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async receiveCallback(
    @Param('botId') botId: string,
    @Body() body: VkUpdate,
  ): Promise<string> {
    const connection = await this.prisma.client.messengerConnection.findUnique({
      where: { botId_messenger: { botId, messenger: 'VK' } },
      include: { bot: { select: { status: true } } },
    });
    if (!connection) {
      throw new NotFoundException('Подключение VK не найдено');
    }

    const config = parseVkStoredConfig(connection.config);
    if (!config) {
      throw new NotFoundException('Конфигурация подключения VK не найдена');
    }

    if (!body || body.group_id !== config.groupId) {
      throw new ForbiddenException('Некорректный идентификатор сообщества VK');
    }

    if (config.secretCipher) {
      const expectedSecret = this.vault.decrypt(
        { cipherText: config.secretCipher, mask: config.secretMask ?? '' },
        tokenAad(botId, 'VK_SECRET'),
      );
      if (!secretsEqual(body.secret, expectedSecret)) {
        throw new ForbiddenException('Неверный секретный ключ VK');
      }
    }

    if (body.type === 'confirmation') {
      if (!config.confirmationCode) {
        throw new BadRequestException('Код подтверждения VK не настроен');
      }
      return config.confirmationCode;
    }

    if (
      connection.bot.status === 'PUBLISHED' &&
      (body.type === 'message_new' || body.type === 'message_event')
    ) {
      if (body.type === 'message_event') {
        const obj = body.object as VkMessageEventObject | undefined;
        if (obj?.event_id && typeof obj.user_id === 'number' && typeof obj.peer_id === 'number') {
          try {
            const token = this.vault.decrypt(
              { cipherText: connection.tokenCipher, mask: connection.tokenMask },
              tokenAad(botId, 'VK'),
            );
            await this.vkApi.sendMessageEventAnswer(token, {
              eventId: obj.event_id,
              userId: obj.user_id,
              peerId: obj.peer_id,
            });
          } catch (err) {
            this.logger.warn(
              `Не удалось отправить messages.sendMessageEventAnswer для бота ${botId}: ${
                err instanceof Error ? err.name : 'UnknownError'
              }`,
            );
          }
        }
      }

      const mapped = mapVkUpdate(botId, body);
      if (mapped) {
        await this.queue.enqueue(mapped.event, mapped.jobId);
      }
    }

    return 'ok';
  }
}
