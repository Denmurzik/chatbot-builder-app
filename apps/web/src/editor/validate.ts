import { ExpressionError, parseExpression } from '@chatbot/engine-core';
import { ru } from '@/i18n/ru';
import type { BlockNode, BlockNodeData } from './convert';

// Проверка списка строк (варианты / значения): пустые, повторы, зарезервированные значения
export function listIssues(lines: string[], forbidden: readonly string[] = []): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  let hasValue = false;
  let hasBlank = false;
  for (const line of lines) {
    if (line.trim() === '') {
      hasBlank = true;
      continue;
    }
    hasValue = true;
    if (forbidden.includes(line) && !reported.has(`r:${line}`)) {
      reported.add(`r:${line}`);
      issues.push(ru.validation.reserved(line));
    }
    if (seen.has(line) && !reported.has(`d:${line}`)) {
      reported.add(`d:${line}`);
      issues.push(ru.validation.duplicate(line));
    }
    seen.add(line);
  }
  if (hasBlank) issues.push(ru.validation.emptyLine);
  if (!hasValue) issues.push(ru.validation.listEmpty);
  return issues;
}

export function minIssue(value: number, min: number): string | null {
  return value < min ? ru.validation.min(min) : null;
}

const VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Имя переменной: латиница, цифры, _; не начинается с цифры
export function variableNameIssue(name: string): string | null {
  return VARIABLE_NAME_REGEX.test(name) ? null : ru.validation.variableName;
}

// Ошибка выражения: пустое или не проходящее разбор движком
export function expressionIssue(expression: string): string | null {
  if (expression.trim() === '') return ru.validation.expressionEmpty;
  try {
    parseExpression(expression);
    return null;
  } catch (error) {
    return error instanceof ExpressionError
      ? ru.validation.expressionError(error.message)
      : ru.validation.expressionError(ru.fieldInput.expressionErrorGeneric);
  }
}

function compact(issues: (string | null)[]): string[] {
  return [...new Set(issues.filter((issue): issue is string => issue !== null))];
}

// Ошибки данных блока, блокирующие сохранение
export function nodeIssues(node: BlockNode): string[] {
  return dataIssues(node.data);
}

export function dataIssues(data: BlockNodeData): string[] {
  switch (data.type) {
    case 'TEXT_INPUT':
      return compact([variableNameIssue(data.variableName)]);
    case 'LIST_CHOICE':
      return compact([variableNameIssue(data.variableName), variableNameIssue(data.listVariable)]);
    case 'OPTION_CHOICE':
      return [...compact([variableNameIssue(data.variableName)]), ...listIssues(data.options)];
    case 'ASSIGNMENT':
      return compact([variableNameIssue(data.variableName), expressionIssue(data.expression)]);
    case 'CONDITION':
      return compact([expressionIssue(data.expression)]);
    case 'SWITCH':
      return [
        ...compact([variableNameIssue(data.variableName)]),
        ...listIssues(data.values, ['else']),
      ];
    case 'HTTP_REQUEST':
      return compact([
        variableNameIssue(data.variableName),
        variableNameIssue(data.errorVariable),
        ...data.responseMappings.map((mapping) => variableNameIssue(mapping.variableName)),
        minIssue(data.timeoutSec, 1),
        minIssue(data.retryCount, 0),
        minIssue(data.retryIntervalSec, 0),
      ]);
    default:
      return [];
  }
}
