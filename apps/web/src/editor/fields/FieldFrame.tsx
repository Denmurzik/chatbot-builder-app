import { Maximize2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ru } from '@/i18n/ru';
import { ExpressionEditorDialog } from './ExpressionEditorDialog';
import { useFieldContext } from './field-context';
import { ResultPopover, type ResultKind } from './ResultPopover';

const t = ru.fieldInput;

interface FieldFrameProps {
  mode: 'template' | 'expression';
  value: string;
  onChange: (value: string) => void;
  variables: string[];
  envNames: string[];
  resultKind: ResultKind;
  testValues?: Record<string, string>;
  sources?: Record<string, string>;
  // Маркер «fx» слева (поле выражения)
  marker?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // Редактор поля (CodeMirror) и блок ошибки под ним
  children: ReactNode;
  footer?: ReactNode;
}

// Оболочка поля: маркер «fx», кнопка «развернуть», «Результат» в фокусе и большой редактор
export function FieldFrame({
  mode,
  value,
  onChange,
  variables,
  envNames,
  resultKind,
  testValues,
  sources,
  marker = false,
  ariaLabel,
  ariaLabelledBy,
  children,
  footer,
}: FieldFrameProps) {
  const context = useFieldContext();
  const values = testValues ?? context.testValues;
  const origins = sources ?? context.sources;
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="relative"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Фокус остался внутри поля (например, на кнопке «развернуть») — «Результат» не прячем
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div ref={anchorRef} className="flex items-start gap-1.5">
        {marker && (
          <span
            aria-hidden="true"
            className="mt-1.5 shrink-0 rounded-md border bg-muted px-1.5 font-mono text-xs leading-5 text-muted-foreground italic"
          >
            {t.fx}
          </span>
        )}
        <div className="relative min-w-0 flex-1">
          {children}
          <button
            ref={expandRef}
            type="button"
            aria-label={t.expand}
            title={t.expand}
            className="absolute top-1 right-1 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>
      {footer}
      {focused && !expanded && (
        <ResultPopover anchor={anchorRef} kind={resultKind} value={value} testValues={values} />
      )}
      <ExpressionEditorDialog
        open={expanded}
        onOpenChange={setExpanded}
        mode={mode}
        value={value}
        onChange={onChange}
        variables={variables}
        envNames={envNames}
        testValues={values}
        sources={origins}
        resultKind={resultKind}
        title={
          ariaLabel ??
          (ariaLabelledBy
            ? (document.getElementById(ariaLabelledBy)?.textContent ?? undefined)
            : undefined)
        }
        returnFocusTo={expandRef}
      />
    </div>
  );
}
