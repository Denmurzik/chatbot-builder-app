import type { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { ru } from '@/i18n/ru';
import { baseSetup, toSingleLine } from './cm-base';
import { templateExtensions } from './field-extensions';
import { useFieldContext } from './field-context';
import { useStableCallback } from './use-stable-callback';
import { FieldFrame } from './FieldFrame';
import { findUnknownNames } from './highlight';

export interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: string[];
  envNames: string[];
  multiline?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // Тестовые значения из колонки «Вход» и названия блоков-источников (по умолчанию — из окна блока)
  testValues?: Record<string, string>;
  variableSources?: Record<string, string>;
  // Нужен для тестов и фокусировки
  onCreateEditor?: (view: EditorView) => void;
}

// Поле текста с подстановками {{переменная}}, подсказками и живым «Результатом»
export function TemplateInput({
  value,
  onChange,
  variables,
  envNames,
  multiline = false,
  placeholder,
  id,
  ariaLabel,
  ariaLabelledBy,
  testValues,
  variableSources,
  onCreateEditor,
}: TemplateInputProps) {
  const context = useFieldContext();
  const handleChange = useStableCallback((next: string) => onChange(next));
  const values = testValues ?? context.testValues;
  const origins = variableSources ?? context.sources;
  const variablesKey = variables.join('\u0000');
  const envKey = envNames.join('\u0000');
  const extensions = useMemo(
    () =>
      templateExtensions({
        variables,
        envNames,
        docs: { testValues: values, sources: origins },
        multiline,
        expandable: true,
        ariaLabel,
        ariaLabelledBy,
      }),
    // Массивы variables/envNames сравниваются по содержимому через ключи, а не по ссылке:
    // иначе расширения пересоздавались бы при каждом рендере родителя
    [variablesKey, envKey, values, origins, multiline, ariaLabel, ariaLabelledBy],
  );

  const unknown = findUnknownNames(value, new Set(variables));

  return (
    <FieldFrame
      mode="template"
      value={value}
      onChange={onChange}
      variables={variables}
      envNames={envNames}
      resultKind="template"
      testValues={values}
      sources={origins}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      footer={
        unknown.length > 0 && (
          <p className="mt-1 text-xs text-destructive">
            {ru.fieldInput.unknownVariable}: {unknown.join(', ')}
          </p>
        )
      }
    >
      <CodeMirror
        id={id}
        value={multiline ? value : toSingleLine(value)}
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
