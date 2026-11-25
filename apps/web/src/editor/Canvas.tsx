import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useRef, type ReactNode } from 'react';
import { Copy, Hand, LayoutGrid, MousePointer2, Plus, Trash2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { useColorMode } from '@/app/theme';
import { Button } from '@/components/ui/button';
import { ru } from '@/i18n/ru';
import { cn } from '@/lib/utils';
import { BLOCK_META } from './block-meta';
import { BLOCK_NODE_TYPE, connectEdges, type BlockNode as BlockNodeType } from './convert';
import { useEditorActions } from './actions';
import { filterDeletion } from './deletion';
import { ScenarioEdge } from './edges/ScenarioEdge';
import { GRID_SIZE } from './placement';
import { BlockNode } from './nodes/BlockNode';
import { BLOCK_DRAG_MIME } from './picker/NodePicker';

export type CanvasMode = 'select' | 'pan';

// Типы узлов вне компонента — иначе React Flow пересоздаёт их на каждом рендере
const nodeTypes = { [BLOCK_NODE_TYPE]: BlockNode };
// Стрелки и кнопки на связи рисует сам ScenarioEdge — тип и markerEnd у рёбер задавать не нужно
const edgeTypes = { default: ScenarioEdge };
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];
const MULTI_SELECTION_KEYS = ['Meta', 'Control', 'Shift'];
const SELECT_MODE_PAN_BUTTONS = [1, 2];
const CONNECTION_LINE_STYLE = { stroke: 'var(--ring)', strokeWidth: 2 };

function clientPointOf(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('changedTouches' in event && event.changedTouches[0]) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

// Delete в окне блока, выпадающих списках и диалогах не должен удалять блоки на холсте
function isFocusInsidePanel(): boolean {
  const active = document.activeElement;
  return (
    active instanceof Element &&
    active.closest('[data-radix-popper-content-wrapper], [role="dialog"]') !== null
  );
}

interface CanvasProps {
  nodes: BlockNodeType[];
  edges: Edge[];
  mode?: CanvasMode;
  onModeChange?: (mode: CanvasMode) => void;
  onNodesChange: (changes: NodeChange<BlockNodeType>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onEdgesReplace: (updater: (edges: Edge[]) => Edge[]) => void;
  onAutoLayout: () => void;
  // Кнопка «+» в панели холста
  onAddClick: () => void;
  // Блок из панели «Что дальше?» отпущен над холстом (координаты экрана)
  onBlockDrop: (type: string, point: { x: number; y: number }) => void;
  // Связь (от ручки или «+» выхода) отпущена на пустом месте холста — предлагаем выбрать новый блок
  onConnectDrop?: (source: { blockId: string; output: string }, point: { x: number; y: number }) => void;
  // Начало и конец перетаскивания одного или группы блоков — для истории
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  // Групповые действия при множественном выделении
  onDuplicateSelected?: () => void;
  onDeleteSelected?: () => void;
  onClearSelection?: () => void;
  // Дополнительные слои внутри холста (приветствие)
  children?: ReactNode;
}

export function Canvas({
  nodes,
  edges,
  mode = 'select',
  onModeChange,
  onNodesChange,
  onEdgesChange,
  onEdgesReplace,
  onAutoLayout,
  onAddClick,
  onBlockDrop,
  onConnectDrop,
  onNodeDragStart,
  onNodeDragStop,
  onDuplicateSelected,
  onDeleteSelected,
  onClearSelection,
  children,
}: CanvasProps) {
  const colorMode = useColorMode();
  const { openBlock } = useEditorActions();
  // Подавляем контекстное меню браузера, если пользователь панорамировал холст правой кнопкой мыши
  const rightPanOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressContextMenuRef = useRef(false);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedCount = selectedNodes.length;
  const mutableSelectedCount = selectedNodes.filter((node) => node.data.type !== 'ENTRY_POINT').length;

  // Из одного выхода — один переход: новое соединение заменяет прежнее
  function handleConnect(connection: Connection) {
    const { source, sourceHandle, target } = connection;
    if (!sourceHandle) return;
    onEdgesReplace((current) => connectEdges(current, { source, sourceHandle, target }));
  }

  return (
    <div
      className="size-full"
      data-testid="canvas"
      data-canvas-mode={mode}
      onPointerDown={(event) => {
        if (mode === 'select' && event.button === 2) {
          rightPanOriginRef.current = { x: event.clientX, y: event.clientY };
          suppressContextMenuRef.current = false;
        }
      }}
      onPointerMove={(event) => {
        const origin = rightPanOriginRef.current;
        if (!origin) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) {
          suppressContextMenuRef.current = true;
        }
      }}
      onPointerUp={() => {
        rightPanOriginRef.current = null;
      }}
      onContextMenu={(event) => {
        if (suppressContextMenuRef.current) {
          suppressContextMenuRef.current = false;
          event.preventDefault();
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(BLOCK_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const type = event.dataTransfer.getData(BLOCK_DRAG_MIME);
        if (!type) return;
        event.preventDefault();
        onBlockDrop(type, { x: event.clientX, y: event.clientY });
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid
        snapGrid={SNAP_GRID}
        selectionOnDrag={mode === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={mode === 'select' ? SELECT_MODE_PAN_BUTTONS : true}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={MULTI_SELECTION_KEYS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        connectionDragThreshold={5}
        connectionLineStyle={CONNECTION_LINE_STYLE}
        onConnectEnd={(event, connectionState) => {
          if (connectionState.isValid) return;
          const { fromHandle } = connectionState;
          if (!fromHandle || fromHandle.type !== 'source' || fromHandle.id == null) return;
          // Отпускание на исходный блок считаем отменой
          if (
            event.target instanceof Element &&
            event.target.closest(`.react-flow__node[data-id="${fromHandle.nodeId}"]`)
          ) {
            return;
          }
          const point = clientPointOf(event);
          if (point) {
            onConnectDrop?.({ blockId: fromHandle.nodeId, output: fromHandle.id }, point);
          }
        }}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onNodeDragStart}
        onSelectionDragStop={onNodeDragStop}
        onNodeDoubleClick={(_event, node) => openBlock(node.id)}
        deleteKeyCode={['Delete', 'Backspace']}
        onBeforeDelete={async ({ nodes: doomed, edges: doomedEdges }) =>
          isFocusInsidePanel() ? false : filterDeletion(doomed, doomedEdges)
        }
        colorMode={colorMode}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={GRID_SIZE} />
        {onModeChange && (
          <Panel
            position="top-left"
            aria-label={ru.editor.canvasMode}
            className="flex items-center gap-0.5 rounded-lg border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm"
          >
            <Button
              type="button"
              size="icon-sm"
              variant={mode === 'select' ? 'default' : 'ghost'}
              aria-label={ru.editor.modeSelect}
              aria-pressed={mode === 'select'}
              title={ru.editor.modeSelectHint}
              onClick={() => onModeChange('select')}
            >
              <MousePointer2 className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={mode === 'pan' ? 'default' : 'ghost'}
              aria-label={ru.editor.modePan}
              aria-pressed={mode === 'pan'}
              title={ru.editor.modePanHint}
              onClick={() => onModeChange('pan')}
            >
              <Hand className="size-4" />
            </Button>
          </Panel>
        )}
        <Panel
          position="top-right"
          aria-label={ru.editor.canvasActions}
          className="flex flex-col items-end gap-2"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAutoLayout}
            aria-label={ru.editor.autoLayout}
            title={ru.editor.autoLayoutHint}
            className="size-9 p-0 sm:h-8 sm:w-auto sm:px-3"
          >
            <LayoutGrid className="size-4" />
            <span className="hidden sm:inline">{ru.editor.autoLayout}</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onAddClick}
            aria-label={ru.editor.addBlock}
            title={`${ru.editor.addBlock} (Tab)`}
          >
            <Plus className="size-4" />
          </Button>
        </Panel>
        {selectedCount > 1 && (
          <Panel
            position="bottom-center"
            aria-label={ru.editor.selectionActions}
            data-testid="selection-bar"
            className="flex max-w-[calc(100vw-1rem)] items-center gap-1.5 rounded-full border bg-surface/95 px-3 py-1.5 shadow-md backdrop-blur-sm"
          >
            <span className="px-1 text-xs font-medium whitespace-nowrap text-foreground">
              {ru.editor.selectionCount(selectedCount)}
            </span>
            {mutableSelectedCount > 0 && onDuplicateSelected && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                aria-label={ru.editor.nodeActions.duplicate}
                title={ru.editor.nodeActions.duplicate}
                onClick={onDuplicateSelected}
              >
                <Copy className="size-3.5" />
                <span className="hidden sm:inline">{ru.editor.nodeActions.duplicate}</span>
              </Button>
            )}
            {mutableSelectedCount > 0 && onDeleteSelected && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                aria-label={ru.editor.nodeActions.remove}
                title={ru.editor.nodeActions.remove}
                onClick={onDeleteSelected}
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">{ru.editor.nodeActions.remove}</span>
              </Button>
            )}
            {onClearSelection && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className={cn('size-7 rounded-full')}
                aria-label={ru.editor.clearSelection}
                title={ru.editor.clearSelection}
                onClick={onClearSelection}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </Panel>
        )}
        {children}
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          bgColor="color-mix(in oklab, var(--surface) 78%, transparent)"
          maskColor="color-mix(in oklab, var(--muted-foreground) 16%, transparent)"
          className="hidden !border !border-border rounded-md overflow-hidden backdrop-blur-sm opacity-80 transition-[opacity,background-color] hover:opacity-100 hover:!bg-surface md:block"
          nodeColor={(node) => BLOCK_META[(node as BlockNodeType).data.type].color}
        />
      </ReactFlow>
    </div>
  );
}
