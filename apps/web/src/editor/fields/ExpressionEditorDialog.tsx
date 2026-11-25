import type { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';
import { baseSetup } from './cm-base';
import { expressionExtensions, templateExtensions } from './field-extensions';
import { ResultView, type ResultKind } from './ResultPopover';
import { useStableCallback } from './use-stable-callback';

const t = ru.fieldInput;

export interface ExpressionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // template — текст с {{…}}; expression — выражение
  mode: 'template' | 'expression';
  value: string;
  // Значение попадает в поле сразу, поэтому закрытие ничего не теряет
  onChange: (value: string) => void;
  variables: string[];
  envNames: string[];
  testValues: Record<string, string>;
  sources: Record<string, string>;
  resultKind: ResultKind;
  title?: string;
  // Куда вернуть фокус после закрытия (кнопка «развернуть»)
  returnFocusTo?: RefObject<HTMLElement | null>;
}

function hasOwn(values: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, name);
}

// Вставка текста в позицию курсора (с заменой выделения)
function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

// Большой редактор поля: слева переменные с поиском, в центре текст, справа «Результат»
export function ExpressionEditorDialog({
  open,
  onOpenChange,
  mode,
  value,
  onChange,
  variables,
  envNames,
  testValues,
  sources,
  resultKind,
  title,
  returnFocusTo,
}: ExpressionEditorDialogProps) {
  const [query, setQuery] = useState('');
  const handleChange = useStableCallback((next: string) => onChange(next));
  const viewRef = useRef<EditorView | null>(null);

  const variablesKey = variables.join('\u0000');
  const envKey = envNames.join('\u0000');
  const extensions = useMemo(
    () => {
      const options = {
        variables,
        envNames,
        docs: { testValues, sources },
        multiline: true,
        ariaLabel: title ?? t.editorTitle,
      };
      return mode === 'template' ? templateExtensions(options) : expressionExtensions(options);
    },
    // Массивы сравниваются по содержимому через ключи, а не по ссылке
    [mode, variablesKey, envKey, testValues, sources, title],
  );

  const [activeTab, setActiveTab] = useState<'editor' | 'variables' | 'result'>('editor');
  const needle = query.trim().toLowerCase();
  const filtered = variables.filter((name) => name.toLowerCase().includes(needle));
  const tabs: { id: 'editor' | 'variables' | 'result'; label: string }[] = [
    { id: 'editor', label: t.editorTitle },
    { id: 'variables', label: t.variables },
    { id: 'result', label: t.result },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[94dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-[95vw]"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          viewRef.current?.focus();
        }}
      >
        <DialogTitle className="border-b bg-surface px-4 py-3 pr-12 text-base font-semibold">
          {title ?? t.editorTitle}
        </DialogTitle>
        <DialogDescription className="sr-only">{t.editorTitle}</DialogDescription>
        <div
          role="tablist"
          aria-label={title ?? t.editorTitle}
          className="grid grid-cols-3 border-b bg-muted/20 lg:hidden"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-[var(--brand)] bg-background text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <section
            aria-label={t.variables}
            className={`min-h-0 flex-col bg-surface/85 lg:flex lg:border-r ${activeTab === 'variables' ? 'flex flex-1' : 'hidden'}`}
          >
            <div className="border-b p-3">
              <Input
                type="search"
                value={query}
                placeholder={t.searchVariables}
                aria-label={t.searchVariables}
                className="bg-card"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <li className="p-2 text-sm text-muted-foreground">{t.noVariables}</li>
              )}
              {filtered.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => {
                      const view = viewRef.current;
                      if (view) insertAtCursor(view, mode === 'template' ? `{{${name}}}` : name);
                      setActiveTab('editor');
                    }}
                  >
                    <span className="font-mono font-semibold">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {hasOwn(sources, name) && `${t.fromBlock(sources[name])} · `}
                      {hasOwn(testValues, name) ? t.testValueIs(testValues[name]) : t.testValueNone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section
            aria-label={t.editorTitle}
            className={`min-h-0 overflow-y-auto p-4 lg:block ${activeTab === 'editor' ? 'block flex-1' : 'hidden'}`}
          >
            <CodeMirror
              value={value}
              onChange={handleChange}
              extensions={extensions}
              theme="none"
              basicSetup={baseSetup}
              indentWithTab={false}
              minHeight="12rem"
              onCreateEditor={(view) => {
                viewRef.current = view;
              }}
            />
          </section>
          <section
            aria-label={t.result}
            className={`min-h-0 overflow-y-auto bg-surface/85 p-4 lg:block lg:border-l ${activeTab === 'result' ? 'block flex-1' : 'hidden'}`}
          >
            <ResultView kind={resultKind} value={value} testValues={testValues} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
