import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { ru } from '@/i18n/ru';
import { docNode, operatorDoc, variableInfoText, variableNode } from './docs';

const t = ru.fieldInput;

// Операторы и литералы выражений с русскими пояснениями (п. 2.5)
const OPERATORS: ReadonlyArray<{ label: string; detail: string }> = [
  { label: '==', detail: t.operators.eq },
  { label: '!=', detail: t.operators.neq },
  { label: '<', detail: t.operators.lt },
  { label: '<=', detail: t.operators.lte },
  { label: '>', detail: t.operators.gt },
  { label: '>=', detail: t.operators.gte },
  { label: '&&', detail: t.operators.and },
  { label: '||', detail: t.operators.or },
  { label: '!', detail: t.operators.not },
  { label: 'true', detail: t.operators.true },
  { label: 'false', detail: t.operators.false },
];

// Данные для документации подсказок переменных: тестовые значения и блоки-источники
export interface CompletionDocs {
  testValues?: Record<string, string>;
  sources?: Record<string, string>;
}

function hasOwn(values: Record<string, string> | undefined, name: string): boolean {
  return values !== undefined && Object.prototype.hasOwnProperty.call(values, name);
}

// Панель info для переменной: «из блока „…“, тестовое значение: …»
function variableInfo(name: string, docs: CompletionDocs | undefined): () => Node {
  return () =>
    variableNode(
      name,
      variableInfoText(
        hasOwn(docs?.sources, name) ? docs?.sources?.[name] : undefined,
        hasOwn(docs?.testValues, name) ? docs?.testValues?.[name] : undefined,
      ),
    );
}

// Убирает пустые имена и дубликаты, сохраняя порядок
function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => name.length > 0))];
}

// Подсказки для выражения: переменные, {{env.ИМЯ}}, операторы и литералы
export function buildCompletions(
  variables: readonly string[],
  envNames: readonly string[],
  docs?: CompletionDocs,
): Completion[] {
  return [
    ...uniqueNames(variables).map<Completion>((name) => ({
      label: name,
      type: 'variable',
      detail: t.variableDetail,
      info: variableInfo(name, docs),
    })),
    ...uniqueNames(envNames).map<Completion>((name) => ({
      label: `{{env.${name}}}`,
      type: 'constant',
      detail: t.envDetail,
    })),
    ...OPERATORS.map<Completion>((op) => ({
      label: op.label,
      type: op.label === 'true' || op.label === 'false' ? 'keyword' : 'operator',
      detail: op.detail,
      info: () => docNode(operatorDoc(op.label)!),
    })),
  ];
}

// Подсказки для шаблона: имя переменной и env.ИМЯ (внутри уже набранных {{ }})
export function buildTemplateCompletions(
  variables: readonly string[],
  envNames: readonly string[],
  docs?: CompletionDocs,
): Completion[] {
  return [
    ...uniqueNames(variables).map<Completion>((name) => ({
      label: name,
      type: 'variable',
      detail: t.variableDetail,
      info: variableInfo(name, docs),
    })),
    ...uniqueNames(envNames).map<Completion>((name) => ({
      label: `env.${name}`,
      type: 'constant',
      detail: t.envDetail,
    })),
  ];
}

// Источник подсказок для поля выражения
export function createExpressionCompletionSource(
  variables: readonly string[],
  envNames: readonly string[],
  docs?: CompletionDocs,
): (context: CompletionContext) => CompletionResult | null {
  const options = buildCompletions(variables, envNames, docs);
  return (context) => {
    const word = context.matchBefore(/\{\{[\w.]*|[A-Za-z_]\w*|[=!<>&|]+/);
    if (!word && !context.explicit) return null;
    return { from: word ? word.from : context.pos, options };
  };
}

// Источник подсказок для шаблона: срабатывает после {{
export function createTemplateCompletionSource(
  variables: readonly string[],
  envNames: readonly string[],
  docs?: CompletionDocs,
): (context: CompletionContext) => CompletionResult | null {
  const items = buildTemplateCompletions(variables, envNames, docs);
  return (context) => {
    const match = context.matchBefore(/\{\{\s*[\w.]*/);
    if (!match) return null;
    // Начало вводимого имени — после «{{» и пробелов
    const inner = /^\{\{\s*/.exec(match.text);
    const from = match.from + (inner ? inner[0].length : 2);
    // Закрывающие скобки добавляем только если их ещё нет после курсора
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === '}}';
    const options = items.map<Completion>((item) => ({
      ...item,
      apply: closed ? item.label : `${item.label}}}`,
    }));
    return { from, options, validFor: /^[\w.]*$/ };
  };
}
