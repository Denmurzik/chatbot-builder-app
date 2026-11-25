import jsep from 'jsep';
import type { VariableScope } from './scope';

// Ошибка разбора или вычисления выражения
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

// Ограничения безопасности и сложности выражений (п. 2.5)
const MAX_EXPRESSION_LENGTH = 500;
const MAX_AST_DEPTH = 32;

const ALLOWED_UNARY_OPS = new Set(['!', '-']);
const ALLOWED_BINARY_OPS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
]);

const ENV_PLACEHOLDER_PREFIX = '__env_';
const ENV_REF_AT_START_REGEX = /^\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/;

interface PreparedExpression {
  ast: jsep.Expression;
  envRefs: Map<string, string>;
}

// Заменяет ссылки {{env.ИМЯ}} вне строковых литералов на служебные идентификаторы __env_ИМЯ
function replaceEnvReferences(expr: string): { prepared: string; envRefs: Map<string, string> } {
  const envRefs = new Map<string, string>();
  let prepared = '';
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Строковые литералы копируем без изменений, чтобы не трогать {{...}} внутри кавычек
    if (ch === '"' || ch === "'") {
      const quote = ch;
      prepared += ch;
      i += 1;
      while (i < expr.length) {
        const curr = expr[i];
        prepared += curr;
        i += 1;
        if (curr === '\\' && i < expr.length) {
          prepared += expr[i];
          i += 1;
        } else if (curr === quote) {
          break;
        }
      }
      continue;
    }

    if (ch === '{' && expr[i + 1] === '{') {
      const match = ENV_REF_AT_START_REGEX.exec(expr.slice(i));
      if (!match) {
        throw new ExpressionError('недопустимое выражение');
      }
      const envName = match[1];
      const placeholder = `${ENV_PLACEHOLDER_PREFIX}${envName}`;
      envRefs.set(placeholder, envName);
      prepared += placeholder;
      i += match[0].length;
      continue;
    }

    prepared += ch;
    i += 1;
  }

  return { prepared, envRefs };
}

// Проверяет AST по белому списку узлов и операторов (п. 2.5) и контролирует глубину дерева
function validateAst(node: jsep.Expression, depth: number): void {
  if (depth > MAX_AST_DEPTH) {
    throw new ExpressionError(`выражение превышает максимальную глубину ${MAX_AST_DEPTH}`);
  }

  switch (node.type) {
    case 'Literal': {
      const literal = node as jsep.Literal;
      if (
        typeof literal.value !== 'string' &&
        typeof literal.value !== 'number' &&
        typeof literal.value !== 'boolean'
      ) {
        throw new ExpressionError('недопустимое выражение');
      }
      return;
    }
    case 'Identifier':
      return;
    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression;
      if (!unary.prefix || !ALLOWED_UNARY_OPS.has(unary.operator)) {
        throw new ExpressionError('недопустимое выражение');
      }
      validateAst(unary.argument, depth + 1);
      return;
    }
    case 'BinaryExpression':
    case 'LogicalExpression': {
      const binary = node as jsep.BinaryExpression;
      if (!ALLOWED_BINARY_OPS.has(binary.operator)) {
        throw new ExpressionError('недопустимое выражение');
      }
      validateAst(binary.left, depth + 1);
      validateAst(binary.right, depth + 1);
      return;
    }
    default:
      // Запрещаем вызовы функций, доступ к полям, присваивание, this и прочие узлы JS
      throw new ExpressionError('недопустимое выражение');
  }
}

// Подготавливает, разбирает и проверяет выражение
function prepareAndValidate(expr: string): PreparedExpression {
  if (expr.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(
      `выражение превышает максимальную длину ${MAX_EXPRESSION_LENGTH} символов`,
    );
  }
  if (expr.trim().length === 0) {
    throw new ExpressionError('недопустимое выражение');
  }

  const { prepared, envRefs } = replaceEnvReferences(expr);

  let ast: jsep.Expression;
  try {
    ast = jsep(prepared);
  } catch {
    throw new ExpressionError('недопустимое выражение');
  }

  validateAst(ast, 1);
  return { ast, envRefs };
}

// Разбирает и проверяет выражение на соответствие белому списку (используется валидатором сценария)
export function parseExpression(expr: string): void {
  prepareAndValidate(expr);
}

// Приводит результат выражения к логическому значению
export function toBoolean(v: string | number | boolean): boolean {
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'number') {
    return v !== 0 && !Number.isNaN(v);
  }
  return v !== '' && v !== 'false';
}

// Пытается интерпретировать значение как конечное число (пустая строка и boolean — не числа)
function tryParseNumber(v: string | number | boolean): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    if (v.trim() === '') {
      return null;
    }
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// Требует числовое значение для арифметических операций
function requireNumber(v: string | number | boolean): number {
  const num = tryParseNumber(v);
  if (num === null) {
    throw new ExpressionError(`ожидалось число, получено "${String(v)}"`);
  }
  return num;
}

// Рекурсивно вычисляет проверенный AST-узел без использования eval/Function
function evaluateNode(
  node: jsep.Expression,
  scope: VariableScope,
  envRefs: Map<string, string>,
): string | number | boolean {
  switch (node.type) {
    case 'Literal':
      return (node as jsep.Literal).value as string | number | boolean;

    case 'Identifier': {
      const name = (node as jsep.Identifier).name;
      const envName = envRefs.get(name);
      if (envName !== undefined) {
        const value = scope.getEnv(envName);
        if (value === undefined) {
          throw new ExpressionError(`неизвестная переменная: env.${envName}`);
        }
        return value;
      }
      const value = scope.get(name);
      if (value === undefined) {
        throw new ExpressionError(`неизвестная переменная: ${name}`);
      }
      return value;
    }

    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression;
      const arg = evaluateNode(unary.argument, scope, envRefs);
      if (unary.operator === '!') {
        return !toBoolean(arg);
      }
      return -requireNumber(arg);
    }

    case 'BinaryExpression':
    case 'LogicalExpression': {
      const binary = node as jsep.BinaryExpression;
      const op = binary.operator;

      // Логические операторы с коротким замыканием
      if (op === '&&') {
        const left = evaluateNode(binary.left, scope, envRefs);
        if (!toBoolean(left)) {
          return false;
        }
        return toBoolean(evaluateNode(binary.right, scope, envRefs));
      }
      if (op === '||') {
        const left = evaluateNode(binary.left, scope, envRefs);
        if (toBoolean(left)) {
          return true;
        }
        return toBoolean(evaluateNode(binary.right, scope, envRefs));
      }

      const left = evaluateNode(binary.left, scope, envRefs);
      const right = evaluateNode(binary.right, scope, envRefs);

      // Арифметика
      if (op === '+') {
        const leftNum = tryParseNumber(left);
        const rightNum = tryParseNumber(right);
        if (leftNum !== null && rightNum !== null) {
          return leftNum + rightNum;
        }
        return String(left) + String(right);
      }
      if (op === '-' || op === '*' || op === '/' || op === '%') {
        const leftNum = requireNumber(left);
        const rightNum = requireNumber(right);
        if ((op === '/' || op === '%') && rightNum === 0) {
          throw new ExpressionError('деление на ноль');
        }
        switch (op) {
          case '-':
            return leftNum - rightNum;
          case '*':
            return leftNum * rightNum;
          case '/':
            return leftNum / rightNum;
          case '%':
            return leftNum % rightNum;
        }
      }

      // Сравнения: числовое, если обе части числа, иначе строковое (п. 2.5)
      const leftNum = tryParseNumber(left);
      const rightNum = tryParseNumber(right);
      const a = leftNum !== null && rightNum !== null ? leftNum : String(left);
      const b = leftNum !== null && rightNum !== null ? rightNum : String(right);

      switch (op) {
        case '==':
          return a === b;
        case '!=':
          return a !== b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '>=':
          return a >= b;
      }

      throw new ExpressionError('недопустимое выражение');
    }

    default:
      throw new ExpressionError('недопустимое выражение');
  }
}

// Безопасно вычисляет выражение над переменными из области видимости
export function evaluate(expr: string, scope: VariableScope): string | number | boolean {
  const { ast, envRefs } = prepareAndValidate(expr);
  return evaluateNode(ast, scope, envRefs);
}
