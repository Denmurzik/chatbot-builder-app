import { Prisma, type MessengerType } from '@chatbot/db';
import {
  emptyScenario,
  type EnvVarInput,
  type EnvVarView,
  type EnvironmentVariable,
  type Scenario,
} from '@chatbot/model';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EnvironmentService } from '../common/environment.service';
import {
  MessengerAdminPort,
  toConnectConfig,
  type MessengerConnectConfig,
} from '../common/messenger-admin.port';
import { sanitizeScenarioForClient } from '../common/scenario-helpers';
import { PrismaService } from '../prisma/prisma.module';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: Date;
  botsCount: number;
  blocksCount: number;
  publishedBotsCount: number;
  messengers: MessengerType[];
}

const projectSummarySelect = {
  id: true,
  name: true,
  updatedAt: true,
  scenario: true,
  bots: {
    select: {
      status: true,
      connections: {
        select: {
          messenger: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectSummaryRow = Prisma.ProjectGetPayload<{ select: typeof projectSummarySelect }>;

// Подсчитывает количество блоков в JSON-сценарии проекта без полной валидации
function countScenarioBlocks(scenario: Prisma.JsonValue): number {
  if (scenario && typeof scenario === 'object' && !Array.isArray(scenario)) {
    const blocks = (scenario as { blocks?: unknown }).blocks;
    if (Array.isArray(blocks)) {
      return blocks.length;
    }
  }
  return 0;
}

// Собирает сводку проекта для карточки списка за один запрос без N+1
function toProjectSummary(project: ProjectSummaryRow): ProjectSummary {
  let publishedBotsCount = 0;
  const messengerSet = new Set<MessengerType>();

  for (const bot of project.bots) {
    if (bot.status === 'PUBLISHED') {
      publishedBotsCount += 1;
    }
    for (const conn of bot.connections) {
      messengerSet.add(conn.messenger);
    }
  }

  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    botsCount: project.bots.length,
    blocksCount: countScenarioBlocks(project.scenario),
    publishedBotsCount,
    messengers: Array.from(messengerSet).sort(),
  };
}

export interface CreatedProject {
  id: string;
  name: string;
  scenario: Scenario;
}

export interface ProjectDetails {
  id: string;
  name: string;
  scenario: Scenario;
  environment: EnvVarView[];
  updatedAt: Date;
}

// Сервис управления проектами с изоляцией данных по authorId (п. 2.12 спецификации)
@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly environments: EnvironmentService,
    private readonly vault: SecretVault,
    private readonly messenger: MessengerAdminPort,
  ) {}

  async listByAuthor(authorId: string): Promise<ProjectSummary[]> {
    const projects = await this.prisma.client.project.findMany({
      where: { authorId },
      select: projectSummarySelect,
      orderBy: { updatedAt: 'desc' },
    });

    return projects.map(toProjectSummary);
  }

  async create(authorId: string, name: string): Promise<CreatedProject> {
    const initialScenario = emptyScenario();
    const created = await this.prisma.client.project.create({
      data: {
        authorId,
        name,
        scenario: initialScenario as unknown as Prisma.InputJsonValue,
        environment: [],
      },
      select: { id: true, name: true, scenario: true },
    });

    return {
      id: created.id,
      name: created.name,
      scenario: created.scenario as unknown as Scenario,
    };
  }

  async getById(authorId: string, projectId: string): Promise<ProjectDetails> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: { id: true, name: true, scenario: true, environment: true, updatedAt: true },
    });

    if (!project) {
      throw new NotFoundException('Проект не найден');
    }

    return {
      id: project.id,
      name: project.name,
      scenario: sanitizeScenarioForClient(project.scenario as unknown as Scenario),
      environment: this.environments.toView(project.environment as unknown as EnvironmentVariable[]),
      updatedAt: project.updatedAt,
    };
  }

  // Переименование проекта владельца (UC-A-04)
  async rename(authorId: string, projectId: string, name: string): Promise<ProjectSummary> {
    const existing = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Проект не найден');
    }

    try {
      const updated = await this.prisma.client.project.update({
        where: { id: projectId },
        data: { name },
        select: projectSummarySelect,
      });
      return toProjectSummary(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Проект не найден');
      }
      throw err;
    }
  }

  // Каскадное удаление проекта владельца вместе с ботами, подключениями, диалогами и запросами (UC-A-04)
  async remove(authorId: string, projectId: string): Promise<void> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: {
        id: true,
        bots: {
          select: {
            id: true,
            connections: {
              select: { messenger: true, tokenCipher: true, tokenMask: true, config: true },
            },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Проект не найден');
    }

    // Расшифровываем токены подключений до транзакции, чтобы отключить их после коммита
    const toDisconnect: Array<{
      messenger: MessengerType;
      botId: string;
      token: string;
      config?: MessengerConnectConfig;
    }> = [];
    for (const bot of project.bots) {
      for (const conn of bot.connections) {
        const token = this.vault.decrypt(
          { cipherText: conn.tokenCipher, mask: conn.tokenMask },
          tokenAad(bot.id, conn.messenger),
        );
        toDisconnect.push({
          messenger: conn.messenger,
          botId: bot.id,
          token,
          config: toConnectConfig(conn.messenger, conn.config),
        });
      }
    }

    const previewPrefix = `preview:${projectId}:`;
    try {
      await this.prisma.client.$transaction(async (tx) => {
        // Блокируем строку проекта и строки его ботов в предсказуемом порядке
        await tx.$queryRaw`SELECT id FROM project WHERE id = ${projectId} FOR UPDATE`;
        const lockedBots = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM bot WHERE project_id = ${projectId} ORDER BY id FOR UPDATE`;
        const botIds = lockedBots.map((b) => b.id);

        const dialogWhere: Prisma.DialogContextWhereInput =
          botIds.length > 0
            ? {
                OR: [
                  { botId: { in: botIds } },
                  { channel: 'PREVIEW', chatId: { startsWith: previewPrefix } },
                ],
              }
            : { channel: 'PREVIEW', chatId: { startsWith: previewPrefix } };

        const contexts = await tx.dialogContext.findMany({
          where: dialogWhere,
          select: { id: true },
        });
        const contextIds = contexts.map((c) => c.id);

        if (contextIds.length > 0) {
          // Сначала разрываем ссылки контекстов на текущие HTTP-запросы, затем удаляем запросы и контексты
          await tx.dialogContext.updateMany({
            where: { id: { in: contextIds } },
            data: { currentRequestId: null },
          });
          await tx.httpRequest.deleteMany({
            where: { dialogContextId: { in: contextIds } },
          });
          await tx.dialogContext.deleteMany({
            where: { id: { in: contextIds } },
          });
        }

        if (botIds.length > 0) {
          await tx.messengerConnection.deleteMany({ where: { botId: { in: botIds } } });
          await tx.bot.deleteMany({ where: { id: { in: botIds } } });
        }

        await tx.project.delete({ where: { id: projectId } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Проект не найден');
      }
      throw err;
    }

    // Best-effort отключение внешних подключений после успешного удаления из БД
    for (const { messenger, botId, token, config } of toDisconnect) {
      try {
        await this.messenger.disconnect(messenger, botId, token, config);
      } catch (err) {
        this.logger.warn(
          `Не удалось отключить бота ${botId} от мессенджера при удалении проекта ${projectId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  // Сохраняет тестовое окружение проекта (для превью); секреты шифруются, наружу уходят маски
  async setEnvironment(
    authorId: string,
    projectId: string,
    input: EnvVarInput[],
  ): Promise<EnvVarView[]> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: { environment: true },
    });
    if (!project) {
      throw new NotFoundException('Проект не найден');
    }
    const merged = this.environments.merge(
      projectId,
      project.environment as unknown as EnvironmentVariable[],
      input,
    );
    await this.prisma.client.project.update({
      where: { id: projectId },
      data: { environment: merged as unknown as Prisma.InputJsonValue },
    });
    return this.environments.toView(merged);
  }
}
