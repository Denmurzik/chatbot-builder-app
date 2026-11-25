import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { UpdateIngestService } from './update-ingest.service';
import type { TelegramUpdate } from './update-mapper';
import { webhookSecret } from './webhook-secret';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function secretsEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Приём webhook Telegram; маршрут вне префикса /api. botId берётся только из маршрута (п. 2.12)
@Controller('webhook/telegram')
export class MessengerGatewayController {
  constructor(private readonly ingestService: UpdateIngestService) {}

  @Post(':botId')
  @HttpCode(200)
  async receiveUpdate(
    @Param('botId') botId: string,
    @Body() update: TelegramUpdate,
    @Headers(SECRET_HEADER) secret?: string,
  ): Promise<{ ok: true }> {
    if (!secretsEqual(secret, webhookSecret(botId))) {
      throw new UnauthorizedException();
    }
    if (update && typeof update.update_id === 'number') {
      await this.ingestService.ingest(botId, update);
    }
    return { ok: true };
  }
}
