import { Prisma, type MessengerType } from '@chatbot/db';
import {
  environmentSchema,
  type BotConnectionView,
  type BotView,
  type EnvVarInput,
  type EnvVarView,
  type EnvironmentVariable,
  type Scenario,
  type ValidationError,
  type VkConnectionMode,
} from '@chatbot/model';
import { SecretVault, tokenAad } from '@chatbot/vault';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EnvironmentService } from '../common/environment.service';
import {
  MessengerAdminPort,
  parseVkStoredConfig,
  toConnectConfig,
  type MessengerConnectConfig,
  type VkStoredConfig,
} from '../common/messenger-admin.port';
import { PrismaService } from '../prisma/prisma.module';
import { ScenarioValidator } from '../validation/scenario-validator';
import type { ConnectVkBody } from './dto';

type BotWithConnections = Prisma.BotGetPayload<{ include: { connections: true } }>;

export interface ConnectVkResult {
  messenger: 'VK';
  tokenMask: string;
  vkGroupId: number;
  vkMode: VkConnectionMode;
  vkHasSecret: boolean;
  vkConfirmationCode?: string;
  groupName: string;
}

interface DecryptedConnection {
  messenger: MessengerType;
  token: string;
  config?: MessengerConnectConfig;
}

// Сервис ботов проекта, их окружений и подключений Telegram / VK (п. 2.11, 2.12)
@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: SecretVault,
    private readonly environments: EnvironmentService,
    private readonly validator: ScenarioValidator,
    private readonly messenger: MessengerAdminPort,
  ) {}

  async list(authorId: string, projectId: string): Promise<BotView[]> {
    await this.assertProject(authorId, projectId);
    const bots = await this.prisma.client.bot.findMany({
      where: { projectId },
      include: { connections: true },
      orderBy: { name: 'asc' },
    });
    return bots.map((b) => this.toView(b));
  }

  async create(authorId: string, projectId: string, name: string): Promise<BotView> {
    await this.assertProject(authorId, projectId);
    const bot = await this.prisma.client.bot.create({
      data: { projectId, name, environment: [] },
      include: { connections: true },
    });
    return this.toView(bot);
  }

  async remove(authorId: string, projectId: string, botId: string): Promise<void> {
    await this.getOwnedBot(authorId, projectId, botId);
    const connections = await this.decryptAllConnections(botId);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        // Первой блокируется строка бота — тот же порядок, что у публикации (без взаимной блокировки с движком)
        await tx.$queryRaw`SELECT id FROM bot WHERE id = ${botId} FOR UPDATE`;
        // Сначала разрываем ссылки контекстов на запросы, затем удаляем зависимые записи
        await tx.dialogContext.updateMany({ where: { botId }, data: { currentRequestId: null } });
        await tx.httpRequest.deleteMany({ where: { dialogContext: { botId } } });
        await tx.dialogContext.deleteMany({ where: { botId } });
        await tx.messengerConnection.deleteMany({ where: { botId } });
        await tx.bot.delete({ where: { id: botId } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Бот не найден');
      }
      throw err;
    }
    for (const conn of connections) {
      await this.messenger.disconnect(conn.messenger, botId, conn.token, conn.config);
    }
  }

  async isTokenInUse(messenger: MessengerType, tokenHash: string): Promise<boolean> {
    const existing = await this.prisma.client.messengerConnection.findFirst({
      where: { messenger, tokenHash },
      select: { id: true },
    });
    return existing !== null;
  }

  async setEnvironment(
    authorId: string,
    projectId: string,
    botId: string,
    input: EnvVarInput[],
  ): Promise<EnvVarView[]> {
    const bot = await this.getOwnedBot(authorId, projectId, botId);
    const merged = this.environments.merge(
      botId,
      bot.environment as unknown as EnvironmentVariable[],
      input,
    );
    await this.prisma.client.bot.update({
      where: { id: botId },
      data: { environment: merged as unknown as Prisma.InputJsonValue },
    });
    return this.environments.toView(merged);
  }

  async connectTelegram(
    authorId: string,
    projectId: string,
    botId: string,
    token: string,
  ): Promise<{ messenger: 'TELEGRAM'; tokenMask: string; botUsername: string }> {
    const bot = await this.getOwnedBot(authorId, projectId, botId);
    const me = await this.messenger.verifyToken('TELEGRAM', token);
    if (!me) {
      throw new BadRequestException('Токен недействителен');
    }
    const tokenHash = this.vault.hash(token);
    const other = await this.prisma.client.messengerConnection.findUnique({ where: { tokenHash } });
    if (other && other.botId !== botId) {
      throw new ConflictException('Токен уже используется другим ботом');
    }
    const oldConn = await this.decryptConnection(botId, 'TELEGRAM');
    const oldToken = oldConn?.token ?? null;
    // Опубликованный бот сразу переключается на новый токен (до сохранения: ошибка Telegram -> 502)
    const published = bot.status === 'PUBLISHED';
    if (published) await this.messenger.connect('TELEGRAM', botId, token);
    const { cipherText, mask } = this.vault.encrypt(token, tokenAad(botId, 'TELEGRAM'));
    const data = { tokenCipher: cipherText, tokenMask: mask, tokenHash };
    try {
      await this.saveConnection(botId, 'TELEGRAM', data);
    } catch (err) {
      if (published && oldToken !== token) {
        // Откатываем подключение нового токена, возвращаем прежний
        await this.messenger.disconnect('TELEGRAM', botId, token);
        if (oldToken) {
          await this.messenger.connect('TELEGRAM', botId, oldToken).catch(() => undefined);
        }
      }
      throw err;
    }
    if (published && oldToken && oldToken !== token) {
      await this.messenger.disconnect('TELEGRAM', botId, oldToken);
    }
    return { messenger: 'TELEGRAM', tokenMask: mask, botUsername: me.username ?? '' };
  }

  async disconnectTelegram(authorId: string, projectId: string, botId: string): Promise<void> {
    await this.getOwnedBot(authorId, projectId, botId);
    const oldConn = await this.decryptConnection(botId, 'TELEGRAM');
    await this.prisma.client.messengerConnection.deleteMany({
      where: { botId, messenger: 'TELEGRAM' },
    });
    if (oldConn) await this.messenger.disconnect('TELEGRAM', botId, oldConn.token);
  }

  async connectVk(
    authorId: string,
    projectId: string,
    botId: string,
    body: ConnectVkBody,
  ): Promise<ConnectVkResult> {
    const bot = await this.getOwnedBot(authorId, projectId, botId);
    const connectConfig: MessengerConnectConfig = {
      groupId: body.groupId,
      mode: body.mode,
      ...(body.confirmationCode ? { confirmationCode: body.confirmationCode } : {}),
      ...(body.secret ? { secret: body.secret } : {}),
    };
    const verified = await this.messenger.verifyToken('VK', body.token, connectConfig);
    if (!verified) {
      throw new BadRequestException(
        'Токен сообщества VK недействителен или не соответствует указанному ID сообщества',
      );
    }
    const tokenHash = this.vault.hash(body.token);
    const other = await this.prisma.client.messengerConnection.findUnique({ where: { tokenHash } });
    if (other && other.botId !== botId) {
      throw new ConflictException('Токен уже используется другим ботом');
    }

    const oldConn = await this.decryptConnection(botId, 'VK');
    const published = bot.status === 'PUBLISHED';
    if (published) {
      await this.messenger.connect('VK', botId, body.token, connectConfig);
    }

    const { cipherText, mask } = this.vault.encrypt(body.token, tokenAad(botId, 'VK'));
    const vkConfig: VkStoredConfig = {
      groupId: body.groupId,
      mode: body.mode,
      ...(body.confirmationCode ? { confirmationCode: body.confirmationCode } : {}),
    };
    if (body.secret && body.secret.length > 0) {
      const encryptedSecret = this.vault.encrypt(body.secret, tokenAad(botId, 'VK_SECRET'));
      vkConfig.secretCipher = encryptedSecret.cipherText;
      vkConfig.secretMask = encryptedSecret.mask;
    }

    const data = {
      tokenCipher: cipherText,
      tokenMask: mask,
      tokenHash,
      config: vkConfig as unknown as Prisma.InputJsonValue,
    };

    try {
      await this.saveConnection(botId, 'VK', data);
    } catch (err) {
      if (published && oldConn?.token !== body.token) {
        await this.messenger.disconnect('VK', botId, body.token, connectConfig);
        if (oldConn) {
          await this.messenger
            .connect('VK', botId, oldConn.token, oldConn.config)
            .catch(() => undefined);
        }
      }
      throw err;
    }

    if (published && oldConn && oldConn.token !== body.token) {
      await this.messenger.disconnect('VK', botId, oldConn.token, oldConn.config);
    }

    return {
      messenger: 'VK',
      tokenMask: mask,
      vkGroupId: body.groupId,
      vkMode: body.mode,
      vkHasSecret: Boolean(vkConfig.secretCipher),
      ...(vkConfig.confirmationCode ? { vkConfirmationCode: vkConfig.confirmationCode } : {}),
      groupName: verified.groupName ?? '',
    };
  }

  async disconnectVk(authorId: string, projectId: string, botId: string): Promise<void> {
    await this.getOwnedBot(authorId, projectId, botId);
    const oldConn = await this.decryptConnection(botId, 'VK');
    await this.prisma.client.messengerConnection.deleteMany({
      where: { botId, messenger: 'VK' },
    });
    if (oldConn) {
      await this.messenger.disconnect('VK', botId, oldConn.token, oldConn.config);
    }
  }

  // Публикация и переопубликация (п. 2.11): проверка -> подключение всех мессенджеров -> фиксация сценария
  async publish(
    authorId: string,
    projectId: string,
    botId: string,
  ): Promise<{ bot: BotView; warnings: ValidationError[] }> {
    const bot = await this.getOwnedBot(authorId, projectId, botId);
    const project = await this.prisma.client.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { scenario: true },
    });
    const scenario = project.scenario as unknown as Scenario;
    const parsedEnv = environmentSchema.safeParse(bot.environment);
    const envVars = parsedEnv.success ? parsedEnv.data : [];
    const issues = [
      ...this.validator.validate(scenario, envVars),
      ...(await this.validator.checkConnections(botId)),
    ];
    if (issues.some((i) => i.severity === 'ERROR')) {
      throw new UnprocessableEntityException({ errors: issues });
    }
    const warnings = issues.filter((i) => i.severity === 'WARNING');

    const connections = await this.decryptAllConnections(botId);
    if (connections.length === 0) {
      throw new UnprocessableEntityException({
        errors: [
          {
            rule: 'connections',
            severity: 'ERROR',
            message: 'У бота нет подключения к мессенджеру',
          },
        ],
      });
    }
    // Вне транзакции: ошибка внешнего API мессенджера даёт 502, и бот не меняется
    for (const conn of connections) {
      await this.messenger.connect(conn.messenger, botId, conn.token, conn.config);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Статус читаем внутри транзакции: параллельные публикации тоже сбрасывают контексты
      // FOR UPDATE: параллельная публикация ждёт и видит уже обновлённый статус
      const current = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM bot WHERE id = ${botId} FOR UPDATE`;
      if (current.length === 0) throw new NotFoundException('Бот не найден');
      const wasPublished = current[0]!.status === 'PUBLISHED';
      const result = await tx.bot.update({
        where: { id: botId },
        data: {
          publishedScenario: structuredClone(scenario) as unknown as Prisma.InputJsonValue,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        include: { connections: true },
      });
      if (wasPublished) {
        // Новая версия сценария: прежние диалоги завершаются, следующее сообщение начнёт с начала
        await tx.dialogContext.updateMany({
          where: { botId },
          data: {
            state: 'FINISHED',
            currentBlockId: null,
            variables: {},
            currentRequestId: null,
          },
        });
      }
      return result;
    });
    return { bot: this.toView(updated), warnings };
  }

  private async decryptConnection(
    botId: string,
    messenger: MessengerType,
  ): Promise<DecryptedConnection | null> {
    const connection = await this.prisma.client.messengerConnection.findUnique({
      where: { botId_messenger: { botId, messenger } },
    });
    if (!connection) return null;
    const token = this.vault.decrypt(
      { cipherText: connection.tokenCipher, mask: connection.tokenMask },
      tokenAad(botId, messenger),
    );
    return {
      messenger,
      token,
      config: toConnectConfig(messenger, connection.config),
    };
  }

  private async decryptAllConnections(botId: string): Promise<DecryptedConnection[]> {
    const rows = await this.prisma.client.messengerConnection.findMany({
      where: { botId },
    });
    return rows.map((connection) => ({
      messenger: connection.messenger,
      token: this.vault.decrypt(
        { cipherText: connection.tokenCipher, mask: connection.tokenMask },
        tokenAad(botId, connection.messenger),
      ),
      config: toConnectConfig(connection.messenger, connection.config),
    }));
  }

  // Запись подключения; P2002 по token_hash — токен занят другим ботом, иная гонка (botId_messenger) — повтор
  private async saveConnection(
    botId: string,
    messenger: MessengerType,
    data: {
      tokenCipher: string;
      tokenMask: string;
      tokenHash: string;
      config?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    const attempt = async (): Promise<'ok' | 'retry'> => {
      try {
        await this.prisma.client.messengerConnection.upsert({
          where: { botId_messenger: { botId, messenger } },
          create: { botId, messenger, ...data },
          update: data,
        });
        return 'ok';
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err;
        }
        if (String(err.meta?.target ?? '').includes('token_hash')) {
          throw new ConflictException('Токен уже используется другим ботом');
        }
        return 'retry';
      }
    };
    if ((await attempt()) === 'retry' && (await attempt()) === 'retry') {
      throw new ConflictException('Не удалось сохранить подключение, повторите попытку');
    }
  }

  private async assertProject(authorId: string, projectId: string): Promise<void> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Проект не найден');
    }
  }

  private async getOwnedBot(authorId: string, projectId: string, botId: string) {
    const bot = await this.prisma.client.bot.findFirst({
      where: { id: botId, projectId, project: { authorId } },
    });
    if (!bot) {
      throw new NotFoundException('Бот не найден');
    }
    return bot;
  }

  private toView(bot: BotWithConnections): BotView {
    const connections: BotConnectionView[] = bot.connections.map((c) => {
      if (c.messenger === 'VK') {
        const cfg = parseVkStoredConfig(c.config);
        return {
          messenger: 'VK',
          tokenMask: c.tokenMask,
          ...(cfg
            ? {
                vkGroupId: cfg.groupId,
                vkMode: cfg.mode,
                vkHasSecret: Boolean(cfg.secretCipher),
                ...(cfg.confirmationCode ? { vkConfirmationCode: cfg.confirmationCode } : {}),
              }
            : {}),
        };
      }
      return { messenger: c.messenger, tokenMask: c.tokenMask };
    });

    return {
      id: bot.id,
      name: bot.name,
      status: bot.status,
      publishedAt: bot.publishedAt ? bot.publishedAt.toISOString() : null,
      connections,
      environment: this.environments.toView(bot.environment as unknown as EnvironmentVariable[]),
    };
  }
}
