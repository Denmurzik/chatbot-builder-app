import { Prisma } from '@chatbot/db';
import type { Scenario } from '@chatbot/model';
import { SecretVault } from '@chatbot/vault';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  parseScenarioOrThrow,
  prepareScenarioSecretsForSave,
} from '../common/scenario-helpers';
import { PrismaService } from '../prisma/prisma.module';

// Редактор сценария (класс модели ScenarioEditor): проверка структуры и сохранение сценария проекта
@Injectable()
export class ScenarioEditor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: SecretVault,
  ) {}

  // Проверяет структуру сценария через parseScenario и бросает 400 с issues при ошибке
  validateScenario(rawScenario: unknown): Scenario {
    return parseScenarioOrThrow(rawScenario, 'Некорректный сценарий');
  }

  // Сохраняет сценарий проекта с проверкой принадлежности автору и структурной целостности графа
  async saveScenario(
    authorId: string,
    projectId: string,
    rawScenario: unknown,
  ): Promise<{ updatedAt: Date }> {
    // Проверяем владение до валидации тела, чтобы не раскрывать наличие чужих проектов
    const existing = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId },
      select: { id: true, scenario: true },
    });

    if (!existing) {
      throw new NotFoundException('Проект не найден');
    }

    const validated = this.validateScenario(rawScenario);
    const scenario = prepareScenarioSecretsForSave(
      projectId,
      existing.scenario as unknown as Scenario | null,
      validated,
      this.vault,
    );

    try {
      const updated = await this.prisma.client.project.update({
        where: { id: projectId, authorId },
        data: {
          scenario: scenario as unknown as Prisma.InputJsonValue,
        },
        select: { updatedAt: true },
      });

      return { updatedAt: updated.updatedAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Проект не найден');
      }
      throw err;
    }
  }
}
