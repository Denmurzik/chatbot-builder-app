// Модель конструктора условий: строки «переменная — оператор — значение» и их объединение.
// Преобразуется в строку выражения движка и обратно; выражения вне модели остаются текстом.

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'empty',
  'notEmpty',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ConditionJoin = 'and' | 'or';

export interface ConditionRow {
  // Имя переменной диалога или ссылка {{env.ИМЯ}}
  variable: string;
  op: ConditionOperator;
  // Для «пусто» / «не пусто» не используется
  value: string;
}

export interface ConditionModel {
  join: ConditionJoin;
  rows: ConditionRow[];
}

const JOIN_TOKEN: Record<ConditionJoin, string> = { and: '&&', or: '||' };
const OPERATOR_TOKEN: Record<Exclude<ConditionOperator, 'empty' | 'notEmpty'>, string> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};
const TOKEN_OPERATOR: Record<string, ConditionOperator> = {
  '==': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '<': 'lt',
  '>=': 'gte',
  '<=': 'lte',
};

// Число без ведущих нулей: только такие значения пишем без кавычек
const PLAIN_NUMBER_REGEX = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const ENV_REF_REGEX = /^\{\{\s*(env\.[A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;
// «переменная оператор значение», значение — число или строка в кавычках
const ROW_REGEX =
  /^(\{\{\s*env\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}|[A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/;
// Экранирования, которые разбор выражений понимает однозначно; любое другое — режим «Выражение»
const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

export function emptyCondition(): ConditionModel {
  return { join: 'and', rows: [{ variable: '', op: 'eq', value: '' }] };
}

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .split('\b')
    .join('\\b')
    .replace(/\f/g, '\\f')
    .replace(/\v/g, '\\v');
  return `"${escaped}"`;
}

// null — в строке есть экранирование, которое конструктор не воспроизводит без изменений
function unquote(literalText: string): string | null {
  let unknown = false;
  const text = literalText.slice(1, -1).replace(/\\([\s\S])/g, (_match, char: string) => {
    const known = ESCAPES[char];
    if (known === undefined) unknown = true;
    return known ?? char;
  });
  return unknown ? null : text;
}

// Значение записывается в выражение числом (без кавычек), а не строкой
export function isPlainNumber(value: string): boolean {
  return PLAIN_NUMBER_REGEX.test(value);
}

function literal(value: string): string {
  return PLAIN_NUMBER_REGEX.test(value) ? value : quote(value);
}

function rowToExpression(row: ConditionRow): string {
  const variable = row.variable.trim();
  if (row.op === 'empty') return `${variable} == ""`;
  if (row.op === 'notEmpty') return `${variable} != ""`;
  return `${variable} ${OPERATOR_TOKEN[row.op]} ${literal(row.value)}`;
}

// Выражение движка из модели; строки без переменной пропускаются
export function conditionToExpression(model: ConditionModel): string {
  return model.rows
    .filter((row) => row.variable.trim() !== '')
    .map(rowToExpression)
    .join(` ${JOIN_TOKEN[model.join]} `);
}

// Делит выражение по && и || вне строковых литералов
function splitTopLevel(expr: string): { parts: string[]; joins: string[] } {
  const parts: string[] = [];
  const joins: string[] = [];
  let current = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) j += expr[j] === '\\' ? 2 : 1;
      current += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const pair = expr.slice(i, i + 2);
    if (pair === '&&' || pair === '||') {
      parts.push(current);
      joins.push(pair);
      current = '';
      i += 2;
      continue;
    }
    current += ch;
    i += 1;
  }
  parts.push(current);
  return { parts, joins };
}

function parseRow(part: string): ConditionRow | null {
  const match = ROW_REGEX.exec(part.trim());
  if (!match) return null;
  const [, rawVariable, token, rawValue] = match as unknown as [string, string, string, string];
  if (rawVariable === 'true' || rawVariable === 'false') return null;
  const env = ENV_REF_REGEX.exec(rawVariable);
  const variable = env ? `{{${env[1]}}}` : rawVariable;
  const quoted = /^["']/.test(rawValue);
  const value = quoted ? unquote(rawValue) : rawValue;
  if (value === null) return null;
  const op = TOKEN_OPERATOR[token]!;
  if (quoted && value === '') {
    if (op === 'eq') return { variable, op: 'empty', value: '' };
    if (op === 'neq') return { variable, op: 'notEmpty', value: '' };
  }
  return { variable, op, value };
}

// Модель из выражения; null — выражение сложнее конструктора (режим «Выражение»)
export function expressionToCondition(expr: string): ConditionModel | null {
  if (expr.trim() === '') return emptyCondition();
  const { parts, joins } = splitTopLevel(expr);
  if (new Set(joins).size > 1) return null;
  const rows: ConditionRow[] = [];
  for (const part of parts) {
    const row = parseRow(part);
    if (!row) return null;
    rows.push(row);
  }
  return { join: joins[0] === '||' ? 'or' : 'and', rows };
}
