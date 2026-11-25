import { createContext, useContext } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import type { ValidationError } from '@chatbot/model';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ru } from '@/i18n/ru';

const EMPTY_ISSUES_MAP: ReadonlyMap<string, string[]> = new Map();
const EMPTY_ISSUES_LIST: string[] = [];

// Серверные ошибки проверки сценария, сгруппированные по blockId (очищаются при правке графа)
export const ServerIssuesContext = createContext<ReadonlyMap<string, string[]>>(EMPTY_ISSUES_MAP);

export function useServerBlockIssues(blockId: string): string[] {
  return useContext(ServerIssuesContext).get(blockId) ?? EMPTY_ISSUES_LIST;
}

// Группирует серверные ошибки уровня ERROR по id блока для значков на холсте
export function groupServerErrorsByBlock(
  errors: readonly ValidationError[],
): ReadonlyMap<string, string[]> {
  if (errors.length === 0) return EMPTY_ISSUES_MAP;
  const map = new Map<string, string[]>();
  for (const error of errors) {
    if (error.severity !== 'ERROR' || !error.blockId) continue;
    const list = map.get(error.blockId);
    if (list) list.push(error.message);
    else map.set(error.blockId, [error.message]);
  }
  return map;
}

export interface ValidationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: readonly ValidationError[];
  onSelectBlock: (blockId: string) => void;
}

function SeverityIcon({ severity }: { severity: ValidationError['severity'] }) {
  if (severity === 'ERROR') {
    return (
      <CircleAlert
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-label={ru.validationPanel.errorSeverity}
      />
    );
  }
  return (
    <AlertTriangle
      className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
      aria-label={ru.validationPanel.warningSeverity}
    />
  );
}

// Выдвижная панель результатов проверки сценария: холст остаётся доступным (modal=false)
export function ValidationPanel({
  open,
  onOpenChange,
  errors,
  onSelectBlock,
}: ValidationPanelProps) {
  const errorCount = errors.filter((item) => item.severity === 'ERROR').length;
  const warningCount = errors.length - errorCount;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        data-testid="validation-panel"
        className="w-full max-w-full gap-0 bg-card p-0 sm:w-96 sm:max-w-96"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b bg-surface pr-12 pb-3">
          <SheetTitle>{ru.validationPanel.title}</SheetTitle>
          <SheetDescription>
            {errors.length > 0
              ? ru.validationPanel.summary(errorCount, warningCount)
              : ru.validationPanel.description}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {errors.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="size-8 text-muted-foreground" aria-hidden />
                <p>{ru.validationPanel.empty}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {errors.map((error, index) => {
                  const content = (
                    <>
                      <SeverityIcon severity={error.severity} />
                      <span className="min-w-0 flex-1 text-sm break-words text-foreground">
                        {error.message}
                      </span>
                    </>
                  );
                  return (
                    <li key={`${error.rule}-${error.blockId ?? 'global'}-${index}`}>
                      {error.blockId ? (
                        <button
                          type="button"
                          onClick={() => onSelectBlock(error.blockId!)}
                          className="flex w-full cursor-pointer items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-start gap-2.5 rounded-md px-2.5 py-2">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
