import { Decoration } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { TEMPLATE_VAR_REGEX } from '@chatbot/model';
import { ru } from '@/i18n/ru';

const ENV_PREFIX = 'env.';

// Лексемы выражения: ссылка на env, строка, число, идентификатор, оператор
const TOKEN_REGEX =
  /\{\{\s*env\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}|'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[<>!+\-*/%]/g;

const mark = (cls: string, from: number, to: number, title?: string): Range<Decoration> =>
  Decoration.mark({ class: cls, ...(title ? { attributes: { title } } : {}) }).range(from, to);

// Имена в шаблоне, которых нет среди доступных переменных (env.* разрешены свободно)
export function findUnknownNames(text: string, known: ReadonlySet<string>): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(new RegExp(TEMPLATE_VAR_REGEX))) {
    const name = match[1];
    if (!name.startsWith(ENV_PREFIX) && !known.has(name)) unknown.add(name);
  }
  return [...unknown];
}

// Шаблон: сегмент {{…}} — «таблетка»; неизвестная переменная подчёркнута с подсказкой
export function templateDecorations(doc: string, known: ReadonlySet<string>): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const match of doc.matchAll(new RegExp(TEMPLATE_VAR_REGEX))) {
    const name = match[1];
    const from = match.index ?? 0;
    const isUnknown = !name.startsWith(ENV_PREFIX) && !known.has(name);
    ranges.push(
      isUnknown
        ? mark(
            'cm-template-pill cm-template-var-unknown',
            from,
            from + match[0].length,
            ru.fieldInput.unknownVariable,
          )
        : mark('cm-template-pill', from, from + match[0].length),
    );
  }
  return ranges;
}

// Выражение: каждая лексема своим классом (переменная, env, строка, число, оператор, литерал)
export function expressionDecorations(
  doc: string,
  known: ReadonlySet<string>,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const match of doc.matchAll(TOKEN_REGEX)) {
    const text = match[0];
    const from = match.index ?? 0;
    const to = from + text.length;
    if (text.startsWith('{{')) ranges.push(mark('cm-expr-env', from, to));
    else if (text[0] === "'" || text[0] === '"') ranges.push(mark('cm-expr-string', from, to));
    else if (/^\d/.test(text)) ranges.push(mark('cm-expr-number', from, to));
    else if (text === 'true' || text === 'false') ranges.push(mark('cm-expr-keyword', from, to));
    else if (/^[A-Za-z_]/.test(text)) {
      ranges.push(
        known.has(text)
          ? mark('cm-expr-var', from, to)
          : mark('cm-expr-var-unknown', from, to, ru.fieldInput.unknownVariable),
      );
    } else ranges.push(mark('cm-expr-op', from, to));
  }
  return ranges;
}

// Имена переменных, на которые ссылается выражение: обычные и env.ИМЯ
export function referencedNames(expr: string): string[] {
  const names = new Set<string>();
  for (const match of expr.matchAll(TOKEN_REGEX)) {
    const text = match[0];
    if (text.startsWith('{{')) {
      names.add(text.replace(/^\{\{\s*|\s*\}\}$/g, ''));
    } else if (/^[A-Za-z_]/.test(text) && text !== 'true' && text !== 'false') names.add(text);
  }
  return [...names];
}
