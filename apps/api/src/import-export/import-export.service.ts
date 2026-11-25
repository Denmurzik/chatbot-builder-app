import type { Scenario } from '@chatbot/model';
import { BadRequestException, Injectable } from '@nestjs/common';
import YAML, { YAMLParseError } from 'yaml';
import {
  checkScenarioStructure,
  parseScenarioOrThrow,
  stripClientSecretsForImport,
  stripScenarioSecretsForExport,
} from '../common/scenario-helpers';
import type { ValidationIssue } from '../common/zod-body.pipe';
import { ProjectService } from '../projects/project.service';
import { ScenarioEditor } from '../projects/scenario-editor';

export type ExportFormat = 'json' | 'yaml';

export interface ExportedScenario {
  fileName: string;
  content: string;
  contentType: string;
}

export interface ImportScenarioResult {
  updatedAt: Date;
  secretsToFill: number;
}

const UNSAFE_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const MAX_FILENAME_BASE_LENGTH = 100;

// Формирует безопасное имя файла экспорта (JSON или YAML) из названия проекта (кириллица сохраняется)
export function buildExportFileName(projectName: string, format: ExportFormat = 'json'): string {
  let cleaned = '';
  for (const ch of projectName) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127 || UNSAFE_FILENAME_CHARS.has(ch)) {
      cleaned += ' ';
    } else {
      cleaned += ch;
    }
  }

  let base = cleaned
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');

  const lower = base.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.yaml')) {
    base = base.slice(0, -5).replace(/[\s.]+$/g, '');
  } else if (lower.endsWith('.yml')) {
    base = base.slice(0, -4).replace(/[\s.]+$/g, '');
  }

  if (base.length > MAX_FILENAME_BASE_LENGTH) {
    base = base.slice(0, MAX_FILENAME_BASE_LENGTH).replace(/[\s.]+$/g, '');
  }

  return `${base || 'scenario'}.${format}`;
}

// Сервис экспорта и импорта сценариев JSON и YAML (UC-A-29, UC-A-30, UC-A-31; операции serialize/checkStructure/deserialize)
@Injectable()
export class ImportExportService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly scenarioEditor: ScenarioEditor,
  ) {}

  // Выгружает сценарий проекта без секретов и окружения в формате JSON или YAML
  async exportScenario(
    authorId: string,
    projectId: string,
    format: ExportFormat = 'json',
  ): Promise<ExportedScenario> {
    const project = await this.projectService.getById(authorId, projectId);
    return {
      fileName: buildExportFileName(project.name, format),
      content: this.serialize(project.scenario, format),
      contentType:
        format === 'yaml'
          ? 'application/yaml; charset=utf-8'
          : 'application/json; charset=utf-8',
    };
  }

  // Импортирует JSON- или YAML-сценарий в проект владельца; при ошибке валидации сценарий не меняется
  async importScenario(
    authorId: string,
    projectId: string,
    rawBody: unknown,
  ): Promise<ImportScenarioResult> {
    // Проверяем владение до разбора тела, чтобы не раскрывать наличие чужих проектов
    await this.projectService.getById(authorId, projectId);

    const parsedBody = typeof rawBody === 'string' ? this.parseYamlBody(rawBody) : rawBody;
    const scenario = this.deserialize(parsedBody);
    const secretsToFill = this.countSecretsToFill(scenario);
    const { updatedAt } = await this.scenarioEditor.saveScenario(authorId, projectId, scenario);

    return { updatedAt, secretsToFill };
  }

  // Сериализует сценарий в JSON или YAML формата п. 3.3, очищая значения, шифротексты и маски секретных заголовков (п. 2.13)
  serialize(scenario: Scenario, format: ExportFormat = 'json'): string {
    const sanitized = stripScenarioSecretsForExport(scenario);
    if (format === 'yaml') {
      return YAML.stringify(sanitized);
    }
    return JSON.stringify(sanitized, null, 2);
  }

  // Проверяет структуру импортируемого сценария по схеме и возвращает список ошибок на русском
  checkStructure(raw: unknown): ValidationIssue[] {
    return checkScenarioStructure(raw);
  }

  // Разбирает и проверяет сценарий; отбрасывает secretValue и secretMask у заголовков
  deserialize(raw: unknown): Scenario {
    const parsed = parseScenarioOrThrow(raw, 'Файл не подходит');
    return stripClientSecretsForImport(parsed);
  }

  // Разбирает YAML-строку в объект сценария; при ошибке синтаксиса или не-объекте бросает 400
  private parseYamlBody(raw: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const reason =
        err instanceof YAMLParseError || err instanceof Error ? err.message : 'синтаксическая ошибка';
      throw new BadRequestException({
        message: 'Файл не подходит',
        issues: [{ path: '', message: `Некорректный YAML: ${reason}` }],
      });
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException({
        message: 'Файл не подходит',
        issues: [{ path: '', message: 'Некорректный YAML: ожидался объект сценария' }],
      });
    }

    return parsed as Record<string, unknown>;
  }

  // Считает количество секретных заголовков, у которых не задано открытое значение
  private countSecretsToFill(scenario: Scenario): number {
    let count = 0;
    for (const block of scenario.blocks) {
      if (block.type !== 'HTTP_REQUEST') continue;
      for (const header of block.headers) {
        if (header.secret && header.value === '') {
          count += 1;
        }
      }
    }
    return count;
  }
}
