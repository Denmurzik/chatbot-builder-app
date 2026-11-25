import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ru } from '@/i18n/ru';
import { cn } from '@/lib/utils';
import { usePreview, type PreviewConnectionStatus } from './usePreview';

export interface PreviewPanelProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCurrentBlock?: (blockId: string | null) => void;
  onErrorBlock?: (blockId: string | null) => void;
}

const STATUS_META: Record<PreviewConnectionStatus, { label: string; dotClass: string }> = {
  idle: { label: ru.preview.disconnected, dotClass: 'bg-muted-foreground' },
  connecting: { label: ru.preview.connecting, dotClass: 'bg-amber-500 animate-pulse' },
  connected: { label: ru.preview.connected, dotClass: 'bg-emerald-500' },
  disconnected: { label: ru.preview.disconnected, dotClass: 'bg-muted-foreground' },
  error: { label: ru.preview.error, dotClass: 'bg-destructive' },
};

// Сворачиваемая панель переменных текущего диалога превью
function VariablesSection({ variables }: { variables: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(variables);

  return (
    <div className="border-t bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {ru.preview.variablesTitle}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {entries.length}
        </span>
      </button>
      {expanded ? (
        <div className="max-h-40 overflow-y-auto border-t px-4 py-2">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{ru.preview.variablesEmpty}</p>
          ) : (
            <dl className="flex flex-col gap-1.5 text-xs">
              {entries.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-2">
                  <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 truncate font-mono text-foreground" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Выдвижная панель превью сценария: чат, кнопки вопросов, системные сообщения и переменные
export function PreviewPanel({
  projectId,
  open,
  onOpenChange,
  onCurrentBlock,
  onErrorBlock,
}: PreviewPanelProps) {
  const { status, error, messages, variables, sendInput, pressButton, restart } = usePreview({
    projectId,
    enabled: open,
    onCurrentBlock,
    onErrorBlock,
  });
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!open) setDraft('');
  }, [open]);

  const statusMeta = STATUS_META[status];
  const isConnected = status === 'connected';
  // Кнопки активны у последнего вопроса бота, если после него не было новой реплики бота
  // (системные сообщения и текстовый ввод автора не блокируют кнопки)
  let activeQuestionId: number | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i]!;
    if (item.role === 'bot') {
      if (item.kind === 'question') activeQuestionId = item.id;
      break;
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isConnected) return;
    if (sendInput(draft)) {
      setDraft('');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        data-testid="preview-panel"
        className="w-full max-w-full gap-0 bg-card p-0 sm:w-96 sm:max-w-md"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b bg-surface pr-12 pb-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{ru.preview.title}</SheetTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!isConnected}
              onClick={restart}
            >
              <RotateCcw className="size-3.5" />
              {ru.preview.restart}
            </Button>
          </div>
          <SheetDescription className="flex items-center gap-2 text-xs">
            <span
              className={cn('inline-block size-2 rounded-full', statusMeta.dotClass)}
              aria-hidden
            />
            <span>{statusMeta.label}</span>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{ru.preview.empty}</p>
            ) : (
              messages.map((item) => {
                if (item.role === 'user') {
                  return (
                    <div
                      key={item.id}
                      className="max-w-[85%] self-end rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap break-words text-primary-foreground"
                    >
                      {item.text}
                    </div>
                  );
                }

                if (item.role === 'system') {
                  return (
                    <div
                      key={item.id}
                      role="status"
                      aria-label={ru.preview.systemLabel}
                      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
                    >
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {item.text}
                      </span>
                    </div>
                  );
                }

                const isLatestQuestion = item.kind === 'question' && item.id === activeQuestionId;
                return (
                  <div key={item.id} className="flex max-w-[85%] flex-col gap-2 self-start">
                    <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words text-foreground">
                      {item.text}
                    </div>
                    {item.kind === 'question' && item.buttons.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.buttons.map((button) => (
                          <Button
                            key={button.callbackData}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!isLatestQuestion || !isConnected}
                            onClick={() => pressButton(button)}
                          >
                            {button.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <VariablesSection variables={variables} />

        <div className="border-t bg-surface p-3">
          {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <Input
              aria-label={ru.preview.inputLabel}
              placeholder={ru.preview.inputPlaceholder}
              value={draft}
              maxLength={4096}
              disabled={!isConnected}
              className="bg-card"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!isConnected || draft.trim() === ''}
              aria-label={ru.preview.send}
            >
              <Send className="size-4" />
              <span className="sr-only">{ru.preview.send}</span>
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
