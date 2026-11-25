import {
  parseScenario,
  type EncryptedSecret,
  type HttpHeader,
  type Scenario,
} from '@chatbot/model';
import { headerAad, type SecretVault } from '@chatbot/vault';
import { BadRequestException } from '@nestjs/common';
import { ZodError, ZodIssueCode, type ZodIssue } from 'zod';
import type { ValidationIssue } from './zod-body.pipe';

// Переводит стандартные ошибки Zod на русский, сохраняя пользовательские русские сообщения из схемы
function translateZodIssue(issue: ZodIssue): string {
  switch (issue.code) {
    case ZodIssueCode.custom:
      return issue.message;
    case ZodIssueCode.invalid_literal:
      if (issue.path.length === 1 && issue.path[0] === 'formatVersion') {
        return `Неподдерживаемая версия формата (ожидалась ${String(issue.expected)})`;
      }
      return `Ожидалось значение ${JSON.stringify(issue.expected)}`;
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') {
        return 'Обязательное поле не заполнено';
      }
      return `Неверный тип значения (ожидался ${issue.expected}, получен ${issue.received})`;
    case ZodIssueCode.invalid_union_discriminator:
      return 'Неизвестный тип блока';
    case ZodIssueCode.invalid_enum_value:
      return `Недопустимое значение (допустимо: ${issue.options.join(', ')})`;
    case ZodIssueCode.too_small:
      return /^(Array|String|Number|Date) must/.test(issue.message)
        ? `Значение меньше допустимого (${String(issue.minimum)})`
        : issue.message;
    case ZodIssueCode.too_big:
      return /^(Array|String|Number|Date) must/.test(issue.message)
        ? `Значение больше допустимого (${String(issue.maximum)})`
        : issue.message;
    default:
      return issue.message;
  }
}

// Форматирует ошибки Zod в список { path, message } на русском языке
export function formatRussianZodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: translateZodIssue(issue),
  }));
}

// Проверяет структуру сценария по Zod-схеме и возвращает список ошибок на русском (пустой при успехе)
export function checkScenarioStructure(raw: unknown): ValidationIssue[] {
  try {
    parseScenario(raw);
    return [];
  } catch (err) {
    if (err instanceof ZodError) {
      return formatRussianZodIssues(err);
    }
    throw err;
  }
}

// Разбирает сценарий через parseScenario и бросает 400 BadRequestException с русскими issues при ошибке
export function parseScenarioOrThrow(raw: unknown, message = 'Некорректный сценарий'): Scenario {
  try {
    return parseScenario(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException({
        message,
        issues: formatRussianZodIssues(err),
      });
    }
    throw err;
  }
}

function mapHttpHeaders(
  scenario: Scenario,
  mapper: (blockId: string, header: HttpHeader) => HttpHeader,
): Scenario {
  return {
    ...scenario,
    blocks: scenario.blocks.map((block) => {
      if (block.type !== 'HTTP_REQUEST') return block;
      return {
        ...block,
        headers: block.headers.map((header) => mapper(block.id, header)),
      };
    }),
  };
}

// Подготавливает сценарий к отдаче клиенту: удаляет secretValue (шифротекст) и оставляет только secretMask
export function sanitizeScenarioForClient(scenario: Scenario): Scenario {
  return mapHttpHeaders(scenario, (_blockId, header): HttpHeader => {
    if (!header.secret) {
      return { name: header.name, value: header.value, secret: false };
    }
    const mask = header.secretValue?.mask;
    return mask
      ? { name: header.name, value: '', secret: true, secretMask: mask }
      : { name: header.name, value: '', secret: true };
  });
}

// Очищает секретные заголовки для экспорта JSON: удаляет открытые значения, secretValue и secretMask
export function stripScenarioSecretsForExport(scenario: Scenario): Scenario {
  return {
    formatVersion: scenario.formatVersion,
    blocks: mapHttpHeaders(scenario, (_blockId, header): HttpHeader =>
      header.secret
        ? { name: header.name, value: '', secret: true }
        : { name: header.name, value: header.value, secret: false },
    ).blocks,
    transitions: scenario.transitions,
  };
}

// Удаляет чужие secretValue и secretMask при импорте JSON, сохраняя введённые открытые значения
export function stripClientSecretsForImport(scenario: Scenario): Scenario {
  return {
    formatVersion: scenario.formatVersion,
    blocks: mapHttpHeaders(scenario, (_blockId, header): HttpHeader => ({
      name: header.name,
      value: header.value,
      secret: header.secret,
    })).blocks,
    transitions: scenario.transitions,
  };
}

// Шифрует новые секретные заголовки и переиспользует существующий шифротекст из БД при наличии secretMask
export function prepareScenarioSecretsForSave(
  projectId: string,
  existingScenario: Scenario | null,
  incomingScenario: Scenario,
  vault: SecretVault,
): Scenario {
  const existingSecrets = new Map<string, EncryptedSecret>();
  if (existingScenario) {
    for (const block of existingScenario.blocks) {
      if (block.type !== 'HTTP_REQUEST') continue;
      for (const header of block.headers) {
        if (header.secret && header.secretValue) {
          existingSecrets.set(`${block.id}\0${header.name}`, header.secretValue);
        }
      }
    }
  }

  return mapHttpHeaders(incomingScenario, (blockId, header): HttpHeader => {
    if (!header.secret) {
      return { name: header.name, value: header.value, secret: false };
    }
    if (header.value !== '') {
      return {
        name: header.name,
        value: '',
        secret: true,
        secretValue: vault.encrypt(header.value, headerAad(projectId, header.name)),
      };
    }
    if (header.secretMask) {
      const stored = existingSecrets.get(`${blockId}\0${header.name}`);
      if (stored) {
        return { name: header.name, value: '', secret: true, secretValue: stored };
      }
    }
    return { name: header.name, value: '', secret: true };
  });
}
