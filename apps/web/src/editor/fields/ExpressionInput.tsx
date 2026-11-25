import type { EditorView } from '@codemirror/view';
import { ExpressionError, parseExpression } from '@chatbot/engine-core';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useId, useMemo, useState } from 'react';
import { ru } from '@/i18n/ru';
import { baseSetup, toSingleLine } from './cm-base';
import { expressionExtensions } from './field-extensions';
import { useFieldContext } from './field-context';
import { useStableCallback } from './use-stable-callback';
import { FieldFrame } from './FieldFrame';
import type { ResultKind } from './ResultPopover';

// Задержка показа ошибки разбора, мс
const ERROR_DELAY_MS = 300;

// Текст ошибки разбора на русском
function errorMessage(value: string): string | null {
  if (value.trim().length === 0) return null;
  try {
    parseExpression(value);
    return null;
  } catch (error) {
    return error instanceof ExpressionError ? error.message : ru.fieldInput.expressionErrorGeneric;
  }
}

export interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: string[];
  envNames: string[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // Тестовые значения из колонки «Вход» и названия блоков-источников (по умолчанию — из окна блока)
  testValues?: Record<string, string>;
  variableSources?: Record<string, string>;
  // condition — выражение Условия: «Результат» показывает да/нет и сработавший выход
  resultKind?: Extract<ResultKind, 'value' | 'condition'>;
  // Нужен для тестов и фокусировки
  onCreateEditor?: (view: EditorView) => void;
}

// Однострочное поле выражения с подсказками и проверкой синтаксиса
export function ExpressionInput({
  value,
  onChange,
  variables,
  envNames,
  placeholder,
  id,
  ariaLabel,
  ariaLabelledBy,
  testValues,
  variableSources,
  resultKind = 'value',
  onCreateEditor,
}: ExpressionInputProps) {
  const reactId = useId();
  const context = useFieldContext();
  const handleChange = useStableCallback((next: string) => onChange(next));
  const values = testValues ?? context.testValues;
  const origins = variableSources ?? context.sources;
  const [error, setError] = useState<string | null>(null);

  // Ошибка показывается с задержкой, чтобы не мигать во время набора
  useEffect(() => {
    const timer = setTimeout(() => setError(errorMessage(value)), ERROR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const variablesKey = variables.join('\u0000');
  const envKey = envNames.join('\u0000');
  const errorId = `${id ?? reactId}-error`;
  const hasError = error !== null;
  const extensions = useMemo(
    () =>
      expressionExtensions({
        variables,
        envNames,
        docs: { testValues: values, sources: origins },
        multiline: false,
        expandable: true,
        ariaLabel,
        ariaLabelledBy,
        invalid: hasError,
        errorId,
      }),
    // Массивы variables/envNames сравниваются по содержимому через ключи, а не по ссылке:
    // иначе расширения пересоздавались бы при каждом рендере родителя
    [variablesKey, envKey, values, origins, ariaLabel, ariaLabelledBy, hasError, errorId],
  );

  return (
    <FieldFrame
      mode="expression"
      marker
      value={value}
      onChange={onChange}
      variables={variables}
      envNames={envNames}
      resultKind={resultKind}
      testValues={values}
      sources={origins}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      footer={
        error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
            {ru.fieldInput.expressionError}: {error}
          </p>
        )
      }
    >
      <CodeMirror
        id={id}
        value={toSingleLine(value)}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        basicSetup={baseSetup}
        indentWithTab={false}
        placeholder={placeholder}
        onCreateEditor={onCreateEditor}
      />
    </FieldFrame>
  );
}
