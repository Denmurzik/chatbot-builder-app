import { closeCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { Edge } from '@xyflow/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { availableVariables } from '@chatbot/model';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';
import { cn } from '@/lib/utils';
import { BLOCK_META } from '../block-meta';
import { FieldContext } from '../fields/field-context';
import { flowToScenario, type BlockNode, type BlockNodeData } from '../convert';
import { InputPane } from './InputPane';
import { InsertContext, type InsertTarget } from './insert-target';
import { OutputPane } from './OutputPane';
import { SettingsPane } from './SettingsPane';

const t = ru.blockDialog;

interface BlockDialogProps {
  // Блок, чьё окно открыто; null — окно закрыто
  nodeId: string | null;
  nodes: BlockNode[];
  edges: Edge[];
  onChange: (id: string, data: BlockNodeData) => void;
  onClose: () => void;
  // Открыть сразу с выделенным названием (действие «Переименовать»)
  focusTitle?: boolean;
}

// Список подсказок CodeMirror открыт: Esc должен закрыть только его
function isCompletionOpen(): boolean {
  return document.querySelector('.cm-tooltip-autocomplete') !== null;
}

// Поле ввода (в том числе редактор CodeMirror): кнопки и ссылки цель вставки не сбрасывают
function isTextField(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') ||
      target.closest('[contenteditable="true"]') !== null)
  );
}

// Боковые колонки («Вход», «Выход») тоном отличаются от центральной («Настройки»), как слои в n8n
function Column({
  title,
  side = false,
  mobileActive = true,
  children,
}: {
  title: string;
  side?: boolean;
  mobileActive?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'min-h-0 flex-col border-border lg:flex lg:border-r lg:last:border-r-0',
        mobileActive ? 'flex flex-1' : 'hidden',
        side && 'bg-surface/85',
      )}
    >
      <h2 className="hidden border-b border-border px-4 py-2 text-sm font-semibold text-foreground lg:block">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{children}</div>
    </section>
  );
}

type BlockDialogTab = 'settings' | 'input' | 'output';

function DialogBody({
  node,
  nodes,
  edges,
  onChange,
}: {
  node: BlockNode;
  nodes: BlockNode[];
  edges: Edge[];
  onChange: BlockDialogProps['onChange'];
}) {
  // На мобильном экране три колонки показываются как вкладки; по умолчанию открыты «Настройки»
  const [activeTab, setActiveTab] = useState<BlockDialogTab>('settings');
  // Тестовые значения живут только пока окно открыто
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<InsertTarget | null>(null);
  const registry = useMemo(() => ({ target, setTarget }), [target]);

  const variables = useMemo(
    () => availableVariables(flowToScenario(nodes, edges), node.id),
    [nodes, edges, node.id],
  );
  const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.data.title])), [nodes]);
  // Источники переменных: стабильный объект, пока названия не изменились, иначе расширения
  // CodeMirror в полях пересоздавались бы при любом изменении узлов (и закрывали список подсказок)
  const sourcesKey = JSON.stringify(
    variables.map((variable) => [variable.name, titles.get(variable.sourceBlockId) ?? '']),
  );
  const sources = useMemo(
    () => Object.fromEntries(JSON.parse(sourcesKey) as [string, string][]),
    [sourcesKey],
  );
  const fieldContext = useMemo(() => ({ testValues, sources }), [testValues, sources]);
  const meta = BLOCK_META[node.data.type];
  const Icon = meta.icon;

  const tabs: { id: BlockDialogTab; label: string }[] = [
    { id: 'settings', label: t.settings },
    { id: 'input', label: t.input },
    { id: 'output', label: t.output },
  ];

  return (
    <InsertContext.Provider value={registry}>
      {/* Фокус в любом другом поле сбрасывает цель «Вставить»; поля-цели ставят её после (CodeMirror — на focusin) */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onFocusCapture={(event) => {
          if (isTextField(event.target)) setTarget(null);
        }}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface py-2.5 pr-12 pl-3 sm:gap-3 sm:py-3 sm:pl-4">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-white sm:size-9"
            style={{ backgroundColor: meta.color }}
          >
            <Icon className="size-4 sm:size-5" />
          </span>
          <Input
            data-title-input
            className="min-w-0 flex-1 text-sm font-semibold sm:max-w-md sm:text-base"
            aria-label={t.titleLabel}
            value={node.data.title}
            onChange={(event) => onChange(node.id, { ...node.data, title: event.target.value })}
          />
          <span className="w-full truncate text-xs text-muted-foreground sm:w-auto sm:text-sm">
            {meta.label} · {ru.fields.id}: {node.id}
          </span>
        </header>
        <div
          role="tablist"
          aria-label={t.label}
          className="grid grid-cols-3 border-b border-border bg-muted/20 lg:hidden"
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
                className={cn(
                  'border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  selected
                    ? 'border-[var(--brand)] bg-background text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
          <Column title={t.input} side mobileActive={activeTab === 'input'}>
            <InputPane
              variables={variables}
              titles={titles}
              testValues={testValues}
              onTestValueChange={(name, value) =>
                setTestValues((prev) => ({ ...prev, [name]: value }))
              }
            />
          </Column>
          <Column title={t.settings} mobileActive={activeTab === 'settings'}>
            <FieldContext.Provider value={fieldContext}>
              <SettingsPane
                data={node.data}
                variables={variables.map((variable) => variable.name)}
                onChange={(data) => onChange(node.id, data)}
              />
            </FieldContext.Provider>
          </Column>
          <Column title={t.output} side mobileActive={activeTab === 'output'}>
            <OutputPane node={node} nodes={nodes} edges={edges} testValues={testValues} />
          </Column>
        </div>
      </div>
    </InsertContext.Provider>
  );
}

// Большое окно блока в стиле n8n: «Вход — Настройки — Выход». Изменения применяются сразу
export function BlockDialog({
  nodeId,
  nodes,
  edges,
  onChange,
  onClose,
  focusTitle = false,
}: BlockDialogProps) {
  const node = nodeId === null ? undefined : nodes.find((n) => n.id === nodeId);

  // Esc при открытом списке подсказок закрывает только список. Radix слушает Esc на document и
  // помечает событие обработанным (preventDefault), после чего CodeMirror его игнорирует, поэтому
  // перехватываем раньше Radix (слушатель добавлен при монтировании, до открытия окна) и сами
  // закрываем список
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !isCompletionOpen()) return;
      event.stopImmediatePropagation();
      const editor = document.activeElement?.closest<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      if (view) closeCompletion(view);
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Блок удалили, пока окно открыто, — закрываем
  useEffect(() => {
    if (nodeId !== null && !node) onClose();
  }, [nodeId, node, onClose]);

  return (
    <Dialog open={node !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label={t.label}
        className="flex h-[94dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-card-foreground sm:h-[90dvh] sm:max-w-[92vw] lg:max-w-[90vw]"
        // Не уводим фокус на первое поле само по себе — фокус на окне (иначе он остался бы на холсте
        // и Tab открыл бы панель блоков); для «Переименовать» — в название
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (!(event.target instanceof HTMLElement)) return;
          const title = event.target.querySelector<HTMLInputElement>('[data-title-input]');
          if (focusTitle && title) {
            title.focus();
            title.select();
          } else {
            event.target.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">{node?.data.title ?? t.label}</DialogTitle>
        <DialogDescription className="sr-only">{t.label}</DialogDescription>
        {node && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* key: при смене блока локальное состояние окна (тестовые значения, поля) сбрасывается */}
            <DialogBody key={node.id} node={node} nodes={nodes} edges={edges} onChange={onChange} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
