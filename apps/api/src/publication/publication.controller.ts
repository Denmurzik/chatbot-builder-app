import {
  envVarInputListSchema,
  type BotView,
  type EnvVarInput,
  type EnvVarView,
  type ValidationError,
} from '@chatbot/model';
import type { MessengerType } from '@chatbot/db';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { type AuthenticatedAuthor, CurrentAuthor } from '../auth/current-author.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { BotService, type ConnectVkResult } from './bot.service';
import {
  connectTelegramBodySchema,
  connectVkBodySchema,
  createBotBodySchema,
  type ConnectTelegramBody,
  type ConnectVkBody,
  type CreateBotBody,
} from './dto';

/**
 * Класс модели BCE: PublicationController — управление ботами, окружениями, подключением мессенджеров и публикацией.
 * Реализует UC-A-25…A-28, UC-A-32, UC-U-07, SD-6; спринт 2 (боты, окружения, подключение Telegram/VK, публикация и переопубликация).
 */
@Controller('projects/:projectId/bots')
@UseGuards(JwtGuard)
export class PublicationController {
  constructor(private readonly bots: BotService) {}

  @Get()
  listBots(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
  ): Promise<BotView[]> {
    return this.bots.list(author.id, projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createBot(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Body(new ZodBodyPipe(createBotBodySchema)) body: CreateBotBody,
  ): Promise<BotView> {
    return this.bots.create(author.id, projectId, body.name);
  }

  @Delete(':botId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBot(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
  ): Promise<void> {
    return this.bots.remove(author.id, projectId, botId);
  }

  @Put(':botId/environment')
  @HttpCode(HttpStatus.OK)
  setEnvironment(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
    @Body(new ZodBodyPipe(envVarInputListSchema)) body: EnvVarInput[],
  ): Promise<EnvVarView[]> {
    return this.bots.setEnvironment(author.id, projectId, botId, body);
  }

  // Подключение Telegram к боту (connectMessenger, п. 2.11); для опубликованного бота webhook переключается сразу
  @Put(':botId/connections/telegram')
  @HttpCode(HttpStatus.OK)
  connectMessenger(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
    @Body(new ZodBodyPipe(connectTelegramBodySchema)) body: ConnectTelegramBody,
  ): Promise<{ messenger: 'TELEGRAM'; tokenMask: string; botUsername: string }> {
    return this.bots.connectTelegram(author.id, projectId, botId, body.token);
  }

  @Delete(':botId/connections/telegram')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnectMessenger(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
  ): Promise<void> {
    return this.bots.disconnectTelegram(author.id, projectId, botId);
  }

  // Подключение сообщества VK к боту (Callback API или Bots Long Poll)
  @Put(':botId/connections/vk')
  @HttpCode(HttpStatus.OK)
  connectVk(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
    @Body(new ZodBodyPipe(connectVkBodySchema)) body: ConnectVkBody,
  ): Promise<ConnectVkResult> {
    return this.bots.connectVk(author.id, projectId, botId, body);
  }

  @Delete(':botId/connections/vk')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnectVk(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
  ): Promise<void> {
    return this.bots.disconnectVk(author.id, projectId, botId);
  }

  // Публикация и переопубликация бота (п. 2.11): 200 { bot, warnings } или 422 { errors }
  @Post(':botId/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
    @Param('botId') botId: string,
  ): Promise<{ bot: BotView; warnings: ValidationError[] }> {
    return this.bots.publish(author.id, projectId, botId);
  }

  isTokenInUse(messenger: MessengerType, tokenHash: string): Promise<boolean> {
    return this.bots.isTokenInUse(messenger, tokenHash);
  }
}
