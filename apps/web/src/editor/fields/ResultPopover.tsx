import {
  MapScope,
  ExpressionError,
  evaluate,
  parseExpression,
  render,
  toBoolean,
} from '@chatbot/engine-core';
import { TEMPLATE_VAR_REGEX } from '@chatbot/model';
import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ru } from '@/i18n/ru';
import { referencedNames } from './highlight';

const t = ru.fieldInput;

// template — текст с {{переменными}}; value — выражение; condition — выражение Условия (да/нет и выход)
export type ResultKind = 'template' | 'value' | 'condition';

export interface ResultPart {
  text: string;
  // Часть подставлена из тестового значения
  substituted?: boolean;
  // Для переменной нет тестового значения
  missing?: boolean;
  // Значение env.* подставится только при запуске
  env?: boolean;
}

export interface ComputedResult {
  parts: ResultPart[];
  // Итоговый текст (без пометок)
  text: string;
  error?: string;
  // Имена без тестового значения (для выражения: вычисление пропущено)
  missingNames: string[];
  // Ссылки на env.* (при предпросмотре значений нет)
  envNames: string[];
  // Для condition — выход, который сработает: yes | no
  branch?: 'yes' | 'no';
}

function hasOwn(values: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, name);
}

function errorText(error: unknown): string {
  return error instanceof ExpressionError ? error.message : t.expressionErrorGeneric;
}

function computeTemplate(text: string, testValues: Record<string, string>): ComputedResult {
  const parts: ResultPart[] = [];
  const missingNames: string[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(TEMPLATE_VAR_REGEX))) {
    const from = match.index ?? 0;
    if (from > last) parts.push({ text: text.slice(last, from) });
    const name = match[1];
    if (name.startsWith('env.')) parts.push({ text: '', env: true });
    else if (hasOwn(testValues, name)) parts.push({ text: testValues[name], substituted: true });
    else {
      parts.push({ text: '', missing: true });
      missingNames.push(name);
    }
    last = from + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return {
    parts,
    text: render(text, new MapScope(testValues, {}), 'TEXT'),
    missingNames,
    envNames: [],
  };
}

function computeExpression(
  kind: 'value' | 'condition',
  text: string,
  testValues: Record<string, string>,
): ComputedResult {
  // Синтаксическая ошибка важнее отсутствующих тестовых значений
  try {
    parseExpression(text);
  } catch (error) {
    return { parts: [], text: '', missingNames: [], envNames: [], error: errorText(error) };
  }
  const names = referencedNames(text);
  const envNames = names.filter((name) => name.startsWith('env.'));
  const missingNames = names.filter(
    (name) => !name.startsWith('env.') && !hasOwn(testValues, name),
  );
  if (missingNames.length > 0 || envNames.length > 0) {
    return { parts: [], text: '', missingNames, envNames };
  }
  try {
    const value = evaluate(text, new MapScope(testValues, {}));
    const shown = typeof value === 'boolean' ? (value ? t.resultYes : t.resultNo) : String(value);
    return {
      parts: [{ text: shown, substituted: true }],
      text: shown,
      missingNames,
      envNames,
      ...(kind === 'condition'
        ? { branch: toBoolean(value) ? ('yes' as const) : ('no' as const) }
        : {}),
    };
  } catch (error) {
    return { parts: [], text: '', missingNames, envNames, error: errorText(error) };
  }
}

// Живое значение поля по тестовым значениям из колонки «Вход»
export function computeResult(
  kind: ResultKind,
  text: string,
  testValues: Record<string, string>,
): ComputedResult {
  if (kind === 'template') return computeTemplate(text, testValues);
  if (text.trim() === '') return { parts: [], text: '', missingNames: [], envNames: [] };
  return computeExpression(kind, text, testValues);
}

interface ResultViewProps {
  kind: ResultKind;
  value: string;
  testValues: Record<string, string>;
  // Строка-подсказка под результатом
  showTip?: boolean;
}

// Тело «Результата»: используется и во всплывающем окне, и в большом редакторе
export function ResultView({ kind, value, testValues, showTip = true }: ResultViewProps) {
  const result = computeResult(kind, value, testValues);
  const empty = value.trim() === '';
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t.result}
      </div>
      {result.error ? (
        <p role="alert" className="text-destructive">
          {t.expressionError}: {result.error}
        </p>
      ) : kind !== 'template' && result.missingNames.length > 0 ? (
        <p className="text-muted-foreground">{t.noTestValueFor(result.missingNames.join(', '))}</p>
      ) : kind !== 'template' && result.envNames.length > 0 ? (
        <p className="text-muted-foreground">{t.envRuntime}</p>
      ) : (
        <div
          data-testid="result-value"
          className="rounded-md border bg-muted/40 px-2 py-1 font-mono break-words whitespace-pre-wrap"
        >
          {empty ? (
            <span className="text-muted-foreground">{t.resultEmpty}</span>
          ) : (
            result.parts.map((part, index) =>
              part.env ? (
                <span key={index} className="cm-result-env text-muted-foreground italic">
                  {t.envRuntime}
                </span>
              ) : part.missing ? (
                <span key={index} className="cm-result-missing text-muted-foreground italic">
                  {t.noTestValue}
                </span>
              ) : part.substituted ? (
                <span
                  key={index}
                  className="cm-result-sub rounded-sm bg-primary/15 px-0.5 text-primary"
                >
                  {part.text}
                </span>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )
          )}
        </div>
      )}
      {result.branch && (
        <p className="text-muted-foreground">
          {t.branch(result.branch === 'yes' ? ru.outputs.yes : ru.outputs.no)}
        </p>
      )}
      {showTip && (
        <p className="text-xs text-muted-foreground">
          {kind === 'template' ? t.tipTemplate : t.tipExpression}
        </p>
      )}
    </div>
  );
}

interface ResultPopoverProps extends ResultViewProps {
  // Поле, под которым показывается «Результат». Без него блок выводится на месте (тесты)
  anchor?: RefObject<HTMLElement | null>;
}

interface PopoverPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

const GAP = 4;
// Если снизу меньше места, а сверху больше, блок показывается над полем
const MIN_BELOW = 180;

function measure(element: HTMLElement): PopoverPosition {
  const rect = element.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  return below < MIN_BELOW && above > below
    ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + GAP }
    : { left: rect.left, width: rect.width, top: rect.bottom + GAP };
}

const POPOVER_CLASS = 'rounded-md border bg-popover p-3 text-popover-foreground shadow-md';

// Всплывающее «Результат» под полем в фокусе. Рисуется в портале поверх всего,
// поэтому колонка с прокруткой его не обрезает; положение следует за полем
export function ResultPopover({ anchor, ...props }: ResultPopoverProps) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    const element = anchor?.current;
    if (!element) return;
    const update = () => setPosition(measure(element));
    update();
    window.addEventListener('resize', update);
    // Прокрутка любого предка (колонка «Настройки») сдвигает поле
    window.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [anchor]);

  if (!anchor) {
    return (
      <div className={POPOVER_CLASS}>
        <ResultView {...props} />
      </div>
    );
  }
  if (!position) return null;
  return createPortal(
    <div
      style={{ position: 'fixed', ...position }}
      className={`pointer-events-none z-[100] max-h-[50vh] overflow-hidden ${POPOVER_CLASS}`}
    >
      <ResultView {...props} />
    </div>,
    document.body,
  );
}
