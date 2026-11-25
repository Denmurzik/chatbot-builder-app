import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Handle,
  NodeToolbar,
  Position,
  useNodeConnections,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
  type ReactFlowState,
} from '@xyflow/react';
import { Copy, MessageCircle, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { BlockType } from '@chatbot/model';
import { cn } from '@/lib/utils';
import { ru } from '@/i18n/ru';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconAction } from '../IconAction';
import { useEditorActions } from '../actions';
import { BLOCK_META } from '../block-meta';
import { outputLabel } from '../output-label';
import { blockPreview } from '../preview';
import { useHoverDelay } from '../useHoverDelay';
import { dataIssues } from '../validate';
import { useServerBlockIssues } from '../ValidationPanel';
import { safeOutputs, type BlockNode as BlockNodeType } from '../convert';

export type BlockShape = 'start' | 'finish' | 'talk' | 'branch' | 'compact' | 'integration';

// Форма блока по категории: развилки — «ромбовидная» плашка, присваивание — компактная карточка
export function nodeShapeOf(type: BlockType): BlockShape {
  const { category } = BLOCK_META[type];
  if (category === 'logic') return type === 'ASSIGNMENT' ? 'compact' : 'branch';
  return category;
}

// Скругление внешнего контура блока (используется и для подсветки превью по форме узла).
// Явный радиус пилюли (48px / 32px) вместо `full` (calc(infinity * 1px)), чтобы CSS не сжимал
// противоположные скруглённые углы до 0px по правилу пропорционального уменьшения радиусов.
export const SHAPE_RADIUS_CLASSES: Record<BlockShape, string> = {
  start: 'rounded-l-[48px] rounded-r-lg',
  finish: 'rounded-r-[32px] rounded-l-lg',
  talk: 'rounded-2xl',
  branch: 'rounded-lg',
  compact: 'rounded-md',
  integration: 'rounded-lg',
};

const selectSelectedCount = (state: ReactFlowState) => {
  let count = 0;
  for (const node of state.nodes) {
    if (node.selected) count += 1;
  }
  return count;
};

// Один выход: подпись, ручка справа и «+» у неподключённого выхода (можно кликнуть или потянуть)
function OutputRow({
  nodeId,
  type,
  output,
  color,
}: {
  nodeId: string;
  type: BlockType;
  output: string;
  color: string;
}) {
  const { addFromOutput } = useEditorActions();
  const connections = useNodeConnections({ id: nodeId, handleType: 'source', handleId: output });
  const handleRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupDragRef.current?.(), []);

  function handlePlusMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !handleRef.current) return;
    event.preventDefault();
    cleanupDragRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    suppressClickRef.current = false;

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragged && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) {
        dragged = true;
        suppressClickRef.current = true;
      }
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanupDragRef.current = null;
    };
    const onUp = () => {
      cleanup();
      if (dragged) {
        // Сбрасываем флаг сразу после возможного синхронного click
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    cleanupDragRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });

    // Передаём старт перетаскивания на реальную ручку выхода, чтобы React Flow потянул живую связь
    handleRef.current.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
  }

  return (
    <div
      className={cn(
        'relative px-3 py-0.5 text-right text-xs text-muted-foreground',
        connections.length === 0 && 'text-destructive',
      )}
      data-unconnected={connections.length === 0 ? 'true' : undefined}
      title={connections.length === 0 ? ru.editor.unconnectedOutput : undefined}
    >
      {outputLabel(type, output)}
      <Handle
        ref={handleRef}
        id={output}
        type="source"
        position={Position.Right}
        className="!size-3"
        style={{ backgroundColor: color }}
      />
      {connections.length === 0 && (
        <div className="pointer-events-none absolute top-1/2 left-full flex -translate-y-1/2 items-center pl-1.5">
          <span className="h-px w-5 bg-border" />
          <button
            type="button"
            aria-label={ru.editor.addNextBlock}
            title={ru.editor.addNextBlockHint}
            className="nodrag nopan pointer-events-auto flex size-6 touch-manipulation cursor-grab items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:border-[var(--brand)] hover:bg-accent hover:text-accent-foreground active:cursor-grabbing sm:size-5"
            onMouseDown={handlePlusMouseDown}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              addFromOutput(nodeId, output);
            }}
          >
            <Plus className="size-3.5 sm:size-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// Меню над блоком: «Настроить», «Дублировать», «Удалить», «Ещё» (переименовать)
function NodeMenu({
  id,
  isEntry,
  visible,
  onMenuOpenChange,
  hoverHandlers,
}: {
  id: string;
  isEntry: boolean;
  visible: boolean;
  onMenuOpenChange: (open: boolean) => void;
  hoverHandlers: { onMouseEnter: () => void; onMouseLeave: () => void };
}) {
  const { openBlock, duplicate, remove, rename } = useEditorActions();
  const t = ru.editor.nodeActions;
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={8}>
      <div className="nodrag nopan flex gap-1" {...hoverHandlers}>
        <IconAction icon={Settings2} label={t.configure} onClick={() => openBlock(id)} />
        {!isEntry && <IconAction icon={Copy} label={t.duplicate} onClick={() => duplicate(id)} />}
        {!isEntry && (
          <IconAction
            icon={Trash2}
            label={t.remove}
            onClick={() => remove(id)}
            className="hover:text-destructive"
          />
        )}
        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <IconAction icon={MoreHorizontal} label={t.more} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => rename(id)}>
              <Pencil className="size-4" />
              {t.rename}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </NodeToolbar>
  );
}

const SHAPE_CLASSES: Record<BlockShape, string> = {
  // Точка входа: скруглена слева, как «начало» потока
  start: `min-w-44 max-w-56 ${SHAPE_RADIUS_CLASSES.start} border bg-card`,
  // Точка выхода: скруглена справа, как «конец» потока
  finish: `min-w-44 max-w-56 ${SHAPE_RADIUS_CLASSES.finish} border bg-card`,
  // Реплика: крупное скругление 16 px (узнаётся по значку-реплике в углу, выступов за контур нет)
  talk: `min-w-48 max-w-64 ${SHAPE_RADIUS_CLASSES.talk} border bg-card`,
  // Развилка: прямоугольное тело, ромб — значок
  branch: `min-w-48 max-w-64 ${SHAPE_RADIUS_CLASSES.branch} border bg-card`,
  // Присваивание: компактная карточка
  compact: `min-w-40 max-w-56 ${SHAPE_RADIUS_CLASSES.compact} border bg-card`,
  // Интеграция: аккуратная одиночная рамка, метод и URL выделены в теле карточки
  integration: `min-w-48 max-w-64 ${SHAPE_RADIUS_CLASSES.integration} border bg-card`,
};

// Скругление шапки под форму узла, чтобы тонкая подложка не вылезала за рамку
const HEADER_SHAPE_CLASSES: Record<BlockShape, string> = {
  start: 'rounded-tl-[47px] rounded-tr-[7px] pl-5',
  finish: 'rounded-r-[31px] rounded-l-[7px] pr-5',
  talk: 'rounded-t-[15px]',
  branch: 'rounded-t-[7px]',
  compact: 'rounded-t-[5px]',
  integration: 'rounded-t-[7px]',
};

// Цвета пилюли HTTP-метода для читаемого контраста в светлой и тёмной темах
const HTTP_METHOD_CLASSES: Record<string, string> = {
  GET: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  POST: 'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PUT: 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  PATCH: 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  DELETE: 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

// Значок блока: у развилок — ромб, у остальных — скруглённый квадрат (у начала и конца — круг)
function BlockIcon({
  shape,
  color,
  children,
}: {
  shape: BlockShape;
  color: string;
  children: ReactNode;
}) {
  if (shape === 'branch') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center">
        <span
          className="flex size-6 rotate-45 items-center justify-center rounded-[4px] text-white"
          style={{ backgroundColor: color }}
        >
          <span className="-rotate-45">{children}</span>
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center text-white',
        shape === 'compact' ? 'size-5 rounded' : 'size-6 rounded-md',
        (shape === 'start' || shape === 'finish') && 'rounded-full',
      )}
      style={{ backgroundColor: color }}
    >
      {children}
    </span>
  );
}

export function BlockNode({ id, data, selected }: NodeProps<BlockNodeType>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const selectedCount = useStore(selectSelectedCount);
  const { hovered, handlers } = useHoverDelay(150);
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = BLOCK_META[data.type];
  const Icon = meta.icon;
  const shape = nodeShapeOf(data.type);
  const outputs = safeOutputs(data);
  const preview = blockPreview(data);
  const outputsKey = JSON.stringify(outputs);
  const localIssues = dataIssues(data);
  const serverIssues = useServerBlockIssues(id);
  const issues = serverIssues.length > 0 ? [...localIssues, ...serverIssues] : localIssues;

  // После смены набора ручек React Flow нужно пересчитать их положение
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputsKey, updateNodeInternals]);

  const httpData =
    data.type === 'HTTP_REQUEST' ? (data as Record<string, unknown>) : null;
  const httpMethod =
    httpData && typeof httpData.method === 'string' ? httpData.method.trim().toUpperCase() : '';
  const httpUrl = httpData && typeof httpData.url === 'string' ? httpData.url.trim() : '';

  const content = (
    <>
      <div
        className={cn(
          'flex items-center gap-2 px-3',
          shape === 'compact' ? 'py-1.5' : 'py-2',
          HEADER_SHAPE_CLASSES[shape],
        )}
        style={{ backgroundColor: `color-mix(in oklab, ${meta.color} 9%, transparent)` }}
      >
        <BlockIcon shape={shape} color={meta.color}>
          <Icon className={shape === 'compact' ? 'size-3' : 'size-4'} />
        </BlockIcon>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{data.title || meta.label}</div>
          <div className="truncate text-xs text-muted-foreground">{meta.label}</div>
        </div>
        {shape === 'talk' && (
          <MessageCircle
            aria-hidden
            data-testid="talk-icon"
            className="size-4 shrink-0 text-muted-foreground/70"
          />
        )}
      </div>
      {data.type === 'HTTP_REQUEST' ? (
        (httpMethod || httpUrl) && (
          <div className="flex items-start gap-1.5 px-3 py-2 text-xs">
            {httpMethod && (
              <span
                data-testid="http-method-badge"
                className={cn(
                  'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold tracking-wide',
                  HTTP_METHOD_CLASSES[httpMethod] ?? 'border-border bg-muted text-muted-foreground',
                )}
              >
                {httpMethod}
              </span>
            )}
            {httpUrl && (
              <span className="line-clamp-2 min-w-0 flex-1 font-mono break-all text-muted-foreground">
                {httpUrl}
              </span>
            )}
          </div>
        )
      ) : (
        preview && (
          <div
            className={cn(
              'line-clamp-2 px-3 py-2 text-xs break-words text-muted-foreground',
              shape === 'compact' && 'font-mono',
            )}
          >
            {preview}
          </div>
        )
      )}
      {outputs.length > 0 && (
        <div className="flex flex-col border-t py-1">
          {outputs.map((output) => (
            <OutputRow
              key={output}
              nodeId={id}
              type={data.type}
              output={output}
              color={meta.color}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div
      data-block-shape={shape}
      className={cn('relative text-card-foreground shadow-sm', SHAPE_CLASSES[shape])}
      style={{
        borderTopColor: meta.color,
        borderTopWidth: 3,
        ...(selected
          ? {
              boxShadow: `0 0 0 1px ${meta.color}, 0 0 18px -4px color-mix(in oklab, ${meta.color} 35%, transparent)`,
            }
          : undefined),
      }}
      {...handlers}
    >
      <NodeMenu
        id={id}
        isEntry={data.type === 'ENTRY_POINT'}
        visible={selectedCount <= 1 && (Boolean(selected) || hovered || menuOpen)}
        onMenuOpenChange={setMenuOpen}
        hoverHandlers={handlers}
      />
      {issues.length > 0 && (
        <span
          role="img"
          aria-label={ru.editor.blockErrors(issues.length)}
          title={issues.join('\n')}
          data-testid="block-issues"
          className="absolute -top-2 -right-2 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-[11px] font-semibold text-white"
        >
          {issues.length}
        </span>
      )}
      {data.type !== 'ENTRY_POINT' && (
        <Handle type="target" position={Position.Left} className="!size-3 !bg-muted-foreground" />
      )}
      {content}
    </div>
  );
}
