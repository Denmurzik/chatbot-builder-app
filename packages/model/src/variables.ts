import type { Block } from './blocks';
import type { Scenario } from './scenario';

// Регулярное выражение из п. 2.4 для поиска переменных вида {{имя}} и {{env.ИМЯ}}
export const TEMPLATE_VAR_REGEX = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;

// Префикс ссылок на переменные окружения в шаблонах и выражениях
export const ENV_VAR_PREFIX = 'env.';

const ENV_REF_NAME_REGEX = /^env\.([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_REF_IN_EXPR_REGEX = /^\{\{\s*(env\.[A-Za-z_][A-Za-z0-9_]*)\s*\}\}/;
const NUMERIC_LITERAL_AT_START_REGEX = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const IDENTIFIER_AT_START_REGEX = /^[A-Za-z_][A-Za-z0-9_]*/;
const EXPR_KEYWORDS = new Set(['true', 'false']);

// Доступная переменная в точке сценария и блок, который её записал
export interface AvailableVariable {
  name: string;
  sourceBlockId: string;
}

// Добавляет непустые имена в список без дубликатов, сохраняя порядок первого появления
function pushUnique(target: string[], seen: Set<string>, names: Iterable<string>): void {
  for (const raw of names) {
    const name = raw.trim();
    if (name.length > 0 && !seen.has(name)) {
      seen.add(name);
      target.push(name);
    }
  }
}

// Извлекает имена переменных из шаблона без дублей в порядке первого появления
export function extractVariableNames(template: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of template.matchAll(TEMPLATE_VAR_REGEX)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}

// Извлекает имена переменных и {{env.X}} из выражения вне строковых литералов, без true/false
function extractExpressionVariables(expr: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Пропускаем строковые литералы в одинарных и двойных кавычках с учётом экранирования
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < expr.length) {
        const curr = expr[i];
        i += 1;
        if (curr === '\\' && i < expr.length) {
          i += 1;
        } else if (curr === quote) {
          break;
        }
      }
      continue;
    }

    // Ссылка на переменную окружения {{env.X}} внутри выражения
    if (ch === '{' && expr[i + 1] === '{') {
      const match = ENV_REF_IN_EXPR_REGEX.exec(expr.slice(i));
      if (match) {
        pushUnique(result, seen, [match[1]]);
        i += match[0].length;
        continue;
      }
    }

    // Числовые литералы (включая научную нотацию 1e3, 2.5e-4) пропускаем целиком
    if (/[0-9]/.test(ch)) {
      const prev = i > 0 ? expr[i - 1] : '';
      if (!/[A-Za-z0-9_]/.test(prev)) {
        const numMatch = NUMERIC_LITERAL_AT_START_REGEX.exec(expr.slice(i));
        if (numMatch) {
          i += numMatch[0].length;
          continue;
        }
      }
    }

    // Идентификатор переменной, не являющийся частью числового литерала (например, 1e5)
    if (/[A-Za-z_]/.test(ch)) {
      const prev = i > 0 ? expr[i - 1] : '';
      const match = IDENTIFIER_AT_START_REGEX.exec(expr.slice(i));
      if (match) {
        const ident = match[0];
        if (!/[A-Za-z0-9_]/.test(prev) && !EXPR_KEYWORDS.has(ident)) {
          pushUnique(result, seen, [ident]);
        }
        i += ident.length;
        continue;
      }
    }

    i += 1;
  }

  return result;
}

// Возвращает имена переменных, которые блок записывает при выполнении
export function blockWrites(block: Block): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  switch (block.type) {
    case 'ENTRY_POINT':
    case 'EXIT_POINT':
    case 'TEXT_MESSAGE':
    case 'CONDITION':
    case 'SWITCH':
      return result;
    case 'TEXT_INPUT':
    case 'OPTION_CHOICE':
    case 'LIST_CHOICE':
    case 'ASSIGNMENT':
      pushUnique(result, seen, [block.variableName]);
      return result;
    case 'HTTP_REQUEST':
      pushUnique(result, seen, [
        block.variableName,
        block.errorVariable,
        ...block.responseMappings.map((m) => m.variableName),
      ]);
      return result;
  }
}

// Возвращает имена переменных (включая env.*), которые блок читает из шаблонов и выражений
export function blockReads(block: Block): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  switch (block.type) {
    case 'ENTRY_POINT':
    case 'EXIT_POINT':
      return result;
    case 'TEXT_MESSAGE':
      pushUnique(result, seen, extractVariableNames(block.text));
      return result;
    case 'TEXT_INPUT':
    case 'OPTION_CHOICE':
      pushUnique(result, seen, extractVariableNames(block.question));
      return result;
    case 'LIST_CHOICE':
      pushUnique(result, seen, [block.listVariable]);
      pushUnique(result, seen, extractVariableNames(block.question));
      return result;
    case 'ASSIGNMENT':
    case 'CONDITION':
      pushUnique(result, seen, extractExpressionVariables(block.expression));
      return result;
    case 'SWITCH':
      pushUnique(result, seen, [block.variableName]);
      return result;
    case 'HTTP_REQUEST':
      pushUnique(result, seen, extractVariableNames(block.url));
      for (const header of block.headers) {
        if (!header.secret) {
          pushUnique(result, seen, extractVariableNames(header.value));
        }
      }
      pushUnique(result, seen, extractVariableNames(block.body));
      if (block.suspendText !== null) {
        pushUnique(result, seen, extractVariableNames(block.suspendText));
      }
      return result;
  }
}

// Возвращает имена обычных переменных диалога (без ссылок env.*), которые читает блок
export function blockDialogReads(block: Block): string[] {
  return blockReads(block).filter((name) => !name.startsWith(ENV_VAR_PREFIX));
}

// Возвращает уникальные имена переменных окружения (без префикса env.), на которые ссылается блок
export function extractEnvRefs(block: Block): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of blockReads(block)) {
    const match = ENV_REF_NAME_REGEX.exec(name);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      result.push(match[1]);
    }
  }

  return result;
}

// Возвращает все уникальные имена переменных окружения (без префикса env.), используемые в сценарии
export function extractScenarioEnvRefs(scenario: Scenario): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const block of scenario.blocks) {
    pushUnique(result, seen, extractEnvRefs(block));
  }

  return result;
}

// Возвращает переменные, записанные блоками, из которых есть путь в blockId (обход назад без самого блока)
export function availableVariables(scenario: Scenario, blockId: string): AvailableVariable[] {
  const blocksById = new Map<string, Block>();
  for (const block of scenario.blocks) {
    blocksById.set(block.id, block);
  }
  if (!blocksById.has(blockId)) {
    return [];
  }

  const incoming = new Map<string, string[]>();
  for (const transition of scenario.transitions) {
    const sources = incoming.get(transition.target);
    if (sources) {
      sources.push(transition.source.blockId);
    } else {
      incoming.set(transition.target, [transition.source.blockId]);
    }
  }

  // Помечаем сам блок посещённым сразу, чтобы исключить его даже при наличии циклов
  const visited = new Set<string>([blockId]);
  const queue: string[] = [];
  for (const prevId of incoming.get(blockId) ?? []) {
    if (!visited.has(prevId)) {
      visited.add(prevId);
      queue.push(prevId);
    }
  }

  const seenNames = new Set<string>();
  const result: AvailableVariable[] = [];

  for (let head = 0; head < queue.length; head += 1) {
    const currentId = queue[head];
    const block = blocksById.get(currentId);
    if (block) {
      for (const name of blockWrites(block)) {
        if (!seenNames.has(name)) {
          seenNames.add(name);
          result.push({ name, sourceBlockId: currentId });
        }
      }
    }

    for (const prevId of incoming.get(currentId) ?? []) {
      if (!visited.has(prevId)) {
        visited.add(prevId);
        queue.push(prevId);
      }
    }
  }

  return result;
}
