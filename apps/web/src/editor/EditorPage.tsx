import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  CircleHelp,
  Download,
  Moon,
  MoreVertical,
  Play,
  Redo2,
  Save,
  SlidersHorizontal,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BLOCK_TYPES,
  scenarioSchema,
  type BlockType,
  type EnvVarView,
  type Scenario,
  type ValidationError,
} from '@chatbot/model';
import { ApiError } from '@/api/client';
import { useProject, useSaveScenario } from '@/api/projects';
import { useValidateScenario } from '@/api/validation';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/lib/theme';
import { Canvas, type CanvasMode } from './Canvas';
import { BlockDialog } from './block-dialog/BlockDialog';
import { EditorActionsContext, type EditorActions } from './actions';
import {
  BLOCK_NODE_TYPE,
  flowToScenario,
  pruneEdges,
  scenarioToFlow,
  type BlockNode,
  type BlockNodeData,
} from './convert';
import { layoutScenario } from './layout';
import { SHAPE_RADIUS_CLASSES, nodeShapeOf } from './nodes/BlockNode';
import { NODE_HEIGHT, NODE_WIDTH, findFreeSpot, snapToGrid } from './placement';
import { nodeIssues } from './validate';
import { FirstStepCard, WelcomeOverlay } from './onboarding/EmptyState';
import type { ScenarioTemplate } from './onboarding/templates';
import { NodePicker } from './picker/NodePicker';
import { addFree, addFromOutput, insertOnEdge, type GraphResult } from './picker/insertion';
import { nextBlockId } from './ids';
import { sameSnapshot, snapshotOf, useHistory, type Snapshot } from './history';
import { duplicateSelectedNodes, removeSelectedNodes } from './selection';
import { ShortcutsHelp } from './ShortcutsHelp';
import {
  ServerIssuesContext,
  ValidationPanel,
  groupServerErrorsByBlock,
} from './ValidationPanel';
import { TestEnvironmentDialog } from './TestEnvironmentDialog';
import { ImportDialog } from './ImportDialog';
import { ImportExportMenu, useScenarioExport } from './ImportExportMenu';
import { PreviewPanel } from '@/preview/PreviewPanel';

// Окно, в пределах которого серия сдвигов стрелками считается одним действием
const KEY_MOVE_SERIES_MS = 500;

// Выбор и размеры узлов не меняют сценарий — не считаем их несохранёнными изменениями
function isMeaningfulNodeChange(change: NodeChange<BlockNode>): boolean {
  return change.type !== 'select' && change.type !== 'dimensions';
}

// Откуда открыта панель «Что дальше?»: с выхода блока (или с перетягивания «+» в точку), со связи или с кнопки холста
type PickerTarget =
  | { kind: 'free' }
  | { kind: 'output'; blockId: string; output: string; point?: { x: number; y: number } }
  | { kind: 'edge'; edgeId: string };

// Сценарий из одного «Старта» без связей — повод показать приветствие
function isBlankFlow(nodes: BlockNode[], edges: Edge[]): boolean {
  return nodes.length === 1 && nodes[0]!.data.type === 'ENTRY_POINT' && edges.length === 0;
}

// Tab открывает панель только с «пустого» места: фокус на body, самом холсте или его фоне
// (на кнопках, ссылках и полях Tab остаётся обычным переходом по фокусу)
function isFocusOnCanvasOrBody(): boolean {
  const active = document.activeElement;
  if (active === document.body || active === null) return true;
  return (
    active instanceof Element &&
    (active.classList.contains('react-flow') || active.classList.contains('react-flow__pane'))
  );
}

// Поля ввода, CodeMirror и окна: там Ctrl+Z работает по-своему и граф не трогает
function isUndoBlockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable="true"], .cm-editor, [role="dialog"], [role="menu"]',
    ) !== null
  );
}

function snapToGridPoint(point: { x: number; y: number }) {
  return { x: snapToGrid(point.x), y: snapToGrid(point.y) };
}

function showIssues(title: string, issues: { path: string; message: string }[]) {
  toast.error(title, {
    description: (
      <ul className="list-disc pl-4">
        {issues.map((issue, index) => (
          <li key={index}>{issue.message}</li>
        ))}
      </ul>
    ),
  });
}

// На сенсорных экранах по умолчанию панорамирование пальцем, на ПК — выделение рамкой
function defaultCanvasMode(): CanvasMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'select';
  return window.matchMedia('(pointer: coarse)').matches ? 'pan' : 'select';
}

function EditorHeader({
  name,
  dirty,
  children,
}: {
  name?: string;
  dirty?: boolean;
  children?: ReactNode;
}) {
  const { id } = useParams();
  return (
    <header className="flex items-center justify-between gap-2 border-b bg-surface/95 px-2.5 py-2 backdrop-blur-sm sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
        <BrandLogo size={22} className="shrink-0" />
        <Link
          to="/projects"
          aria-label={ru.editor.back}
          title={ru.editor.back}
          className="flex shrink-0 items-center gap-1 rounded-md p-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:p-0"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">{ru.editor.back}</span>
        </Link>
        {name && (
          <>
            <span className="hidden h-5 w-px shrink-0 bg-border sm:inline-block" aria-hidden />
            <h1 className="min-w-0 truncate text-sm font-semibold sm:text-base">{name}</h1>
          </>
        )}
        {dirty && (
          <>
            <span
              className="size-2 shrink-0 rounded-full bg-[var(--brand)] 2xl:hidden"
              title={ru.editor.unsaved}
              aria-hidden="true"
            />
            <span className="hidden shrink-0 text-xs text-muted-foreground 2xl:inline">
              {ru.editor.unsaved}
            </span>
          </>
        )}
      </div>
      {children ? (
        children
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle size="icon-sm" />
          {id ? (
            <Link
              to={`/projects/${id}/bots`}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {ru.editor.bots}
            </Link>
          ) : null}
        </div>
      )}
    </header>
  );
}

function ScenarioEditor({
  projectId,
  name,
  initial,
  environment,
  onImported,
}: {
  projectId: string;
  name: string;
  initial: Scenario;
  environment: EnvVarView[];
  onImported: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [initialFlow] = useState(() => scenarioToFlow(initial));
  const [nodes, setNodes] = useState<BlockNode[]>(initialFlow.nodes);
  const [edges, setEdges] = useState<Edge[]>(initialFlow.edges);
  const [dirty, setDirty] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(defaultCanvasMode);
  const [importOpen, setImportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testEnvOpen, setTestEnvOpen] = useState(false);
  // Подсветка блока в превью — отдельное состояние (не через commitNodes/историю)
  const [previewBlockId, setPreviewBlockId] = useState<string | null>(null);
  const [previewErrorBlockId, setPreviewErrorBlockId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  // Ошибки сервера для значков на блоках сбрасываются при первом изменении сценария
  const [serverBlockErrors, setServerBlockErrors] = useState<ValidationError[]>([]);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  // Окно блока: какой блок открыт и нужно ли сразу выделить его название (действие «Переименовать»)
  const [dialog, setDialog] = useState<{ id: string; focusTitle: boolean } | null>(null);
  // Оверлей «С чего начнём?» — только при первом открытии пустого сценария (флаг в памяти страницы)
  const [welcomePending, setWelcomePending] = useState(() =>
    isBlankFlow(initialFlow.nodes, initialFlow.edges),
  );
  // Актуальные значения для расчётов вне updater-функций (в них побочных эффектов быть не должно)
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  // Счётчик правок графа: по нему понимаем, менялся ли граф, пока шёл запрос сохранения
  const revisionRef = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getNodes, setCenter } = useReactFlow();
  const save = useSaveScenario(projectId);
  const validate = useValidateScenario(projectId);
  const serverIssuesByBlock = useMemo(
    () => groupServerErrorsByBlock(serverBlockErrors),
    [serverBlockErrors],
  );
  // Базовые снимки: начало перетаскивания и открытие окна блока (шаг — по итогу)
  const dragBaseRef = useRef<Snapshot | null>(null);
  const dialogBaseRef = useRef<Snapshot | null>(null);
  // Время последнего сдвига стрелками: серия нажатий в пределах 500 мс — один шаг истории
  const keyMoveAtRef = useRef(0);

  const blank = isBlankFlow(nodes, edges);
  const showWelcome = welcomePending && blank;
  const entryNode = blank ? nodes[0] : undefined;

  const commitNodes = useCallback((next: BlockNode[]) => {
    nodesRef.current = next;
    setNodes(next);
  }, []);

  const commitEdges = useCallback((next: Edge[]) => {
    edgesRef.current = next;
    setEdges(next);
  }, []);

  const touch = useCallback(() => {
    revisionRef.current += 1;
    setDirty(true);
    setServerBlockErrors((prev) => (prev.length === 0 ? prev : []));
  }, []);

  const getGraph = useCallback(() => ({ nodes: nodesRef.current, edges: edgesRef.current }), []);

  // Отмена и повтор помечают сценарий изменённым; размеры и текущее выделение сохраняются для оставшихся блоков
  const restoreGraph = useCallback(
    (snapshot: Snapshot) => {
      const existingById = new Map(nodesRef.current.map((node) => [node.id, node]));
      commitNodes(
        snapshot.nodes.map((node) => {
          const existing = existingById.get(node.id);
          return {
            ...node,
            ...(existing?.measured ? { measured: existing.measured } : {}),
            ...(existing?.selected ? { selected: true } : {}),
          };
        }),
      );
      commitEdges(snapshot.edges);
      touch();
    },
    [commitNodes, commitEdges, touch],
  );

  const history = useHistory({ getGraph, restore: restoreGraph });
  const { record, pushSnapshot } = history;

  const handleNodesChange = useCallback(
    (changes: NodeChange<BlockNode>[]) => {
      if (changes.some((change) => change.type === 'remove')) record();
      // Сдвиг стрелками клавиатуры (не перетаскивание): шаг истории на серию нажатий
      if (
        dragBaseRef.current === null &&
        changes.some((change) => change.type === 'position' && !change.dragging)
      ) {
        const now = Date.now();
        if (now - keyMoveAtRef.current > KEY_MOVE_SERIES_MS) record();
        keyMoveAtRef.current = now;
      }
      const next = applyNodeChanges(changes, nodesRef.current);
      commitNodes(next);
      // Удаление блока убирает и его рёбра
      if (changes.some((change) => change.type === 'remove')) {
        commitEdges(pruneEdges(next, edgesRef.current));
      }
      if (changes.some(isMeaningfulNodeChange)) touch();
    },
    [commitNodes, commitEdges, touch, record],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((change) => change.type !== 'select')) record();
      commitEdges(applyEdgeChanges(changes, edgesRef.current));
      if (changes.some((change) => change.type !== 'select')) touch();
    },
    [commitEdges, touch, record],
  );

  const handleEdgesReplace = useCallback(
    (updater: (edges: Edge[]) => Edge[]) => {
      record();
      commitEdges(updater(edgesRef.current));
      touch();
    },
    [commitEdges, touch, record],
  );

  function applyGraph(result: GraphResult) {
    record();
    commitNodes(result.nodes);
    commitEdges(result.edges);
    touch();
  }

  // Центр видимой области холста в координатах потока (левый верхний угол нового блока)
  function visibleCenter() {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition(
      bounds
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: 0, y: 0 },
    );
    return { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 };
  }

  // Выбор блока в панели или сброс на холст: учитываем, откуда открыта панель
  function placeBlock(type: BlockType, target: PickerTarget, point?: { x: number; y: number }) {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    let result: GraphResult | null;
    if (target.kind === 'output') {
      result = addFromOutput(nodes, edges, target, type, point ?? target.point);
    } else if (target.kind === 'edge') {
      result = insertOnEdge(nodes, edges, target.edgeId, type, point);
      if (!edges.some((edge) => edge.id === target.edgeId)) toast.error(ru.editor.edgeGone);
    } else {
      // Кнопка «+» и Tab кладут блок в центр вида, но не поверх других блоков
      result = addFree(nodes, edges, type, point ?? findFreeSpot(nodes, visibleCenter()));
    }
    if (result) applyGraph(result);
    setPicker(null);
  }

  function handleBlockDrop(rawType: string, client: { x: number; y: number }) {
    const type = BLOCK_TYPES.find((t) => t === rawType);
    if (!type || type === 'ENTRY_POINT') return;
    const target: PickerTarget = picker ?? { kind: 'free' };
    // Блок без выходов на связь не вставить — кладём его без связей
    const effective: PickerTarget =
      target.kind === 'edge' && type === 'EXIT_POINT' ? { kind: 'free' } : target;
    placeBlock(type, effective, snapToGridPoint(screenToFlowPosition(client)));
  }

  // Перетянули «+» (или выходную ручку) на пустое место холста: запоминаем точку и открываем выбор блока
  const handleConnectDrop = useCallback(
    (source: { blockId: string; output: string }, client: { x: number; y: number }) => {
      const flowPos = screenToFlowPosition(client);
      setPicker({
        kind: 'output',
        blockId: source.blockId,
        output: source.output,
        point: snapToGridPoint({ x: flowPos.x, y: flowPos.y - 40 }),
      });
    },
    [screenToFlowPosition],
  );

  function applyTemplate(template: ScenarioTemplate) {
    setWelcomePending(false);
    if (template.id === 'empty') return;
    record();
    const flow = scenarioToFlow(template.build());
    commitNodes(flow.nodes);
    commitEdges(flow.edges);
    touch();
    window.requestAnimationFrame(() => {
      void fitView({ padding: 0.2, maxZoom: 1 });
    });
  }

  // Правка полей: после смены options/values удаляем рёбра исчезнувших выходов
  const handleDataChange = useCallback(
    (id: string, data: BlockNodeData) => {
      const next = nodesRef.current.map((node) => (node.id === id ? { ...node, data } : node));
      commitNodes(next);
      commitEdges(pruneEdges(next, edgesRef.current));
      touch();
    },
    [commitNodes, commitEdges, touch],
  );

  // Упорядочить: раскладка слева направо по сетке и подгонка вида
  const handleAutoLayout = useCallback(() => {
    // Реальные измеренные размеры берём из экземпляра React Flow
    const measuredById = new Map(getNodes().map((n) => [n.id, n.measured]));
    const source = nodesRef.current.map((node) => {
      const measured = measuredById.get(node.id) ?? node.measured;
      return measured ? { ...node, measured } : node;
    });
    record();
    commitNodes(layoutScenario(source, edgesRef.current));
    touch();
    window.requestAnimationFrame(() => {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
    });
  }, [commitNodes, touch, fitView, getNodes, record]);

  // Окно блока: при открытии запоминаем базовый снимок, при закрытии с изменениями — один шаг
  const openDialog = useCallback((id: string, focusTitle: boolean) => {
    dialogBaseRef.current ??= snapshotOf(nodesRef.current, edgesRef.current);
    setDialog({ id, focusTitle });
  }, []);

  const closeDialog = useCallback(() => {
    const base = dialogBaseRef.current;
    dialogBaseRef.current = null;
    if (base && !sameSnapshot(base, snapshotOf(nodesRef.current, edgesRef.current))) {
      pushSnapshot(base);
    }
    setDialog(null);
  }, [pushSnapshot]);

  // Перетаскивание: шаг только если блоки действительно сдвинулись
  const handleDragStart = useCallback(() => {
    dragBaseRef.current = snapshotOf(nodesRef.current, edgesRef.current);
  }, []);

  const handleDragStop = useCallback(() => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (base && !sameSnapshot(base, snapshotOf(nodesRef.current, edgesRef.current))) {
      pushSnapshot(base);
    }
  }, [pushSnapshot]);

  // Действия блоков и связей для BlockNode и ScenarioEdge; задачи 4 и 5 подменяют часть из них
  const actions = useMemo<EditorActions>(
    () => ({
      // Выделяем блок и открываем его окно «Вход — Настройки — Выход»
      openBlock: (id) => {
        commitNodes(nodesRef.current.map((node) => ({ ...node, selected: node.id === id })));
        openDialog(id, false);
      },
      addFromOutput: (blockId, output) => setPicker({ kind: 'output', blockId, output }),
      insertOnEdge: (edgeId) => setPicker({ kind: 'edge', edgeId }),
      // Корзина на связи: один шаг истории; React Flow с его фильтром удаления не участвует
      removeEdge: (edgeId) => handleEdgesChange([{ type: 'remove', id: edgeId }]),
      // Копия правее и ниже со сдвигом 40, без связей, с новым id
      duplicate: (id) => {
        const current = nodesRef.current;
        const source = current.find((node) => node.id === id);
        if (!source || source.data.type === 'ENTRY_POINT') return;
        record();
        const copy: BlockNode = {
          id: nextBlockId(source.data.type, current),
          type: BLOCK_NODE_TYPE,
          position: {
            x: snapToGrid(source.position.x + 40),
            y: snapToGrid(source.position.y + 40),
          },
          data: structuredClone(source.data),
          selected: true,
        };
        commitNodes([...current.map((node) => ({ ...node, selected: false })), copy]);
        touch();
      },
      // Удаление блока убирает и его рёбра; точку входа удалить нельзя
      remove: (id) => {
        const target = nodesRef.current.find((node) => node.id === id);
        if (!target || target.data.type === 'ENTRY_POINT') return;
        handleNodesChange([{ type: 'remove', id }]);
      },
      // Название редактируется в окне блока: открываем его с выделенным названием
      rename: (id) => {
        if (!nodesRef.current.some((node) => node.id === id)) return;
        openDialog(id, true);
      },
    }),
    [commitNodes, touch, handleNodesChange, handleEdgesChange, record, openDialog],
  );

  const saveScenario = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (save.isPending) return false;
      const currentNodes = nodesRef.current;

      // Ошибки полей блоков (повторы, «else», числа) блокируют сохранение
      const blockIssues = currentNodes.flatMap((node) =>
        nodeIssues(node).map((message) => ({
          path: node.id,
          message: ru.validation.blockError(node.data.title, node.id, message),
        })),
      );
      if (blockIssues.length > 0) {
        const firstId = blockIssues[0]!.path;
        commitNodes(currentNodes.map((node) => ({ ...node, selected: node.id === firstId })));
        showIssues(ru.editor.fixErrors, blockIssues);
        return false;
      }

      const scenario = flowToScenario(currentNodes, edgesRef.current);
      const parsed = scenarioSchema.safeParse(scenario);
      if (!parsed.success) {
        showIssues(
          ru.editor.invalidScenario,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
        return false;
      }
      const sentRevision = revisionRef.current;
      try {
        await save.mutateAsync(parsed.data);
        // Если граф менялся, пока шёл запрос, изменения остаются несохранёнными
        if (revisionRef.current === sentRevision) setDirty(false);
        if (!silent) toast.success(ru.editor.saved);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 400 && error.issues?.length) {
          showIssues(ru.editor.invalidScenario, error.issues);
        } else {
          toast.error(ru.editor.saveError);
        }
        return false;
      }
    },
    [save, commitNodes],
  );

  const handleSave = useCallback(() => {
    void saveScenario();
  }, [saveScenario]);

  const handleSaveBeforeExport = useCallback(
    () => saveScenario({ silent: true }),
    [saveScenario],
  );

  const { exporting, handleExport } = useScenarioExport({
    projectId,
    projectName: name,
    dirty,
    disabled: save.isPending,
    onSaveBeforeExport: handleSaveBeforeExport,
  });

  const handleDuplicateSelected = useCallback(() => {
    const selectedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    const result = duplicateSelectedNodes(nodesRef.current, edgesRef.current, selectedIds);
    if (!result) return;
    record();
    commitNodes(result.nodes);
    commitEdges(result.edges);
    touch();
  }, [record, commitNodes, commitEdges, touch]);

  const handleDeleteSelected = useCallback(() => {
    const selectedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    const result = removeSelectedNodes(nodesRef.current, edgesRef.current, selectedIds);
    if (!result) return;
    record();
    commitNodes(result.nodes);
    commitEdges(result.edges);
    touch();
  }, [record, commitNodes, commitEdges, touch]);

  const handleClearSelection = useCallback(() => {
    commitNodes(nodesRef.current.map((node) => (node.selected ? { ...node, selected: false } : node)));
    commitEdges(edgesRef.current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
  }, [commitNodes, commitEdges]);

  const handleValidate = useCallback(async () => {
    if (save.isPending || validate.isPending) return;
    if (dirty) {
      const saved = await saveScenario({ silent: true });
      if (!saved) return;
    }
    // Если сценарий изменился, пока шла проверка, ошибки сервера устарели и на блоки не переносятся
    const validatedRevision = revisionRef.current;
    try {
      const result = await validate.mutateAsync();
      setValidationErrors(result.errors);
      if (revisionRef.current === validatedRevision) setServerBlockErrors(result.errors);
      setValidationOpen(true);
    } catch {
      toast.error(ru.validationPanel.checkError);
    }
  }, [save.isPending, validate, dirty, saveScenario]);

  const centerOnBlock = useCallback(
    (blockId: string) => {
      const target = nodesRef.current.find((node) => node.id === blockId);
      if (!target) return;
      const measured = getNodes().find((node) => node.id === blockId)?.measured ?? target.measured;
      const width = measured?.width ?? NODE_WIDTH;
      const height = measured?.height ?? NODE_HEIGHT;
      void setCenter(target.position.x + width / 2, target.position.y + height / 2, {
        zoom: 1,
        duration: 200,
      });
    },
    [getNodes, setCenter],
  );

  const handleSelectValidationBlock = useCallback(
    (blockId: string) => {
      const current = nodesRef.current;
      if (!current.some((node) => node.id === blockId)) return;
      commitNodes(current.map((node) => ({ ...node, selected: node.id === blockId })));
      centerOnBlock(blockId);
      // На узких экранах закрываем панель проверки, чтобы увидеть выделенный блок на холсте
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setValidationOpen(false);
      }
    },
    [commitNodes, centerOnBlock],
  );

  const handleOpenPreview = useCallback(async () => {
    if (save.isPending) return;
    if (dirty) {
      const saved = await saveScenario({ silent: true });
      if (!saved) return;
    }
    setPreviewOpen(true);
  }, [save.isPending, dirty, saveScenario]);

  const handlePreviewOpenChange = useCallback((open: boolean) => {
    setPreviewOpen(open);
    if (!open) {
      setPreviewBlockId(null);
      setPreviewErrorBlockId(null);
    }
  }, []);

  const handlePreviewCurrentBlock = useCallback((blockId: string | null) => {
    setPreviewBlockId(blockId);
    if (blockId !== null) {
      setPreviewErrorBlockId((prev) => (prev === blockId ? prev : null));
    }
  }, []);

  const handlePreviewErrorBlock = useCallback(
    (blockId: string | null) => {
      setPreviewErrorBlockId(blockId);
      if (blockId !== null) centerOnBlock(blockId);
    },
    [centerOnBlock],
  );

  // Подсветка текущего/ошибочного блока в превью накладывается при рендере, повторяя точную форму узла
  const displayNodes = useMemo(() => {
    if (!previewBlockId && !previewErrorBlockId) return nodes;
    return nodes.map((node) => {
      const isError = node.id === previewErrorBlockId;
      const isCurrent = !isError && node.id === previewBlockId;
      if (!isError && !isCurrent) return node;
      const radius = SHAPE_RADIUS_CLASSES[nodeShapeOf(node.data.type)];
      const highlight = isError
        ? `preview-node-error ${radius} ring-2 ring-destructive ring-offset-2 ring-offset-background shadow-[0_0_0_4px_color-mix(in_oklab,var(--destructive)_25%,transparent)]`
        : `preview-node-current animate-preview-pulse ${radius}`;
      return {
        ...node,
        className: node.className ? `${node.className} ${highlight}` : highlight,
      };
    });
  }, [nodes, previewBlockId, previewErrorBlockId]);

  // Подсветка связей активного блока в превью — производный массив, не мутирует сохранённые связи
  const displayEdges = useMemo(() => {
    if (!previewBlockId) return edges;
    return edges.map((edge) =>
      edge.source === previewBlockId || edge.target === previewBlockId
        ? {
            ...edge,
            animated: true,
            style: { ...edge.style, stroke: 'var(--brand)', strokeWidth: 2 },
          }
        : edge,
    );
  }, [edges, previewBlockId]);

  // Ctrl+S — сохранить; code не зависит от раскладки (в русской key = «ы»)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y — по code (не зависит от раскладки); поля ввода и окна не трогаем
  const { undo, redo } = history;
  const overlayOpen =
    dialog !== null || picker !== null || testEnvOpen || importOpen || shortcutsOpen;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const isUndo = event.code === 'KeyZ' && !event.shiftKey;
      const isRedo = (event.code === 'KeyZ' && event.shiftKey) || event.code === 'KeyY';
      if (!isUndo && !isRedo) return;
      if (overlayOpen || isUndoBlockedTarget(event.target)) return;
      event.preventDefault();
      if (isUndo) undo();
      else redo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, overlayOpen]);

  // Режимы холста (V / H), выделение всех блоков (Ctrl+A) и снятие выделения (Esc)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (showWelcome || overlayOpen || isUndoBlockedTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyA') {
        event.preventDefault();
        commitNodes(nodesRef.current.map((node) => (node.selected ? node : { ...node, selected: true })));
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.code === 'KeyV') {
        setCanvasMode('select');
      } else if (event.code === 'KeyH') {
        setCanvasMode('pan');
      } else if (
        event.key === 'Escape' &&
        !validationOpen &&
        !previewOpen &&
        nodesRef.current.some((node) => node.selected)
      ) {
        handleClearSelection();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showWelcome, overlayOpen, validationOpen, previewOpen, commitNodes, handleClearSelection]);

  // Предупреждение о несохранённых изменениях: закрытие вкладки и переход по ссылкам
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Tab — открыть панель «Что дальше?», если фокус не в поле ввода
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // Под оверлеем приветствия и пока открыто окно или панель Tab не трогаем
      if (showWelcome || overlayOpen || !isFocusOnCanvasOrBody()) return;
      event.preventDefault();
      setPicker({ kind: 'free' });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showWelcome, overlayOpen]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  return (
    <>
      <EditorHeader name={name} dirty={dirty}>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
          {/* Десктопная панель инструментов: на экранах <lg скрыта, доступна в мобильном меню */}
          <div className="hidden items-center gap-3 lg:flex">
            {/* История изменений */}
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!history.canUndo}
                onClick={history.undo}
                aria-label={ru.editor.undo}
                title={`${ru.editor.undo} (Ctrl+Z)`}
              >
                <Undo2 className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!history.canRedo}
                onClick={history.redo}
                aria-label={ru.editor.redo}
                title={`${ru.editor.redo} (Ctrl+Shift+Z)`}
              >
                <Redo2 className="size-4" />
              </Button>
            </div>
            <span className="h-5 w-px bg-border" aria-hidden />
            {/* Инструменты проверки, окружения и импорта/экспорта */}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={save.isPending || validate.isPending}
                onClick={() => void handleValidate()}
              >
                <CheckCheck className="size-4" />
                {validate.isPending ? ru.validationPanel.checking : ru.validationPanel.button}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTestEnvOpen(true)}
              >
                <SlidersHorizontal className="size-4" />
                {ru.testEnvironment.button}
              </Button>
              <ImportExportMenu
                projectId={projectId}
                projectName={name}
                dirty={dirty}
                disabled={save.isPending}
                onSaveBeforeExport={handleSaveBeforeExport}
                onImported={onImported}
                onOpenImport={() => setImportOpen(true)}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={() => setShortcutsOpen(true)}
                aria-label={ru.editor.shortcuts.open}
                title={ru.editor.shortcuts.open}
              >
                <CircleHelp className="size-4" />
              </Button>
            </div>
            <span className="h-5 w-px bg-border" aria-hidden />
            <ThemeToggle size="icon-sm" />
            <Link
              to={`/projects/${projectId}/bots`}
              className="px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {ru.editor.bots}
            </Link>
          </div>
          {/* Основные действия: видны на всех экранах */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={handleSave}
                  aria-label={save.isPending ? ru.editor.saving : ru.editor.save}
                  className="size-8 p-0 sm:w-auto sm:px-3"
                >
                  <Save className="size-4" />
                  <span className="hidden sm:inline">
                    {save.isPending ? ru.editor.saving : ru.editor.save}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ru.editor.saveShortcut}</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={save.isPending}
              onClick={() => void handleOpenPreview()}
              className="h-8 px-2.5 sm:px-3"
            >
              <Play className="size-4" />
              {ru.preview.button}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="lg:hidden"
                  aria-label={ru.editor.moreActions}
                  title={ru.editor.moreActions}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled={!history.canUndo} onSelect={history.undo}>
                  <Undo2 className="size-4" />
                  {ru.editor.undo}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!history.canRedo} onSelect={history.redo}>
                  <Redo2 className="size-4" />
                  {ru.editor.redo}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={save.isPending || validate.isPending}
                  onSelect={() => void handleValidate()}
                >
                  <CheckCheck className="size-4" />
                  {validate.isPending ? ru.validationPanel.checking : ru.validationPanel.button}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTestEnvOpen(true)}>
                  <SlidersHorizontal className="size-4" />
                  {ru.testEnvironment.button}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={save.isPending || exporting}
                  onSelect={() => void handleExport('json')}
                >
                  <Download className="size-4" />
                  {ru.importExport.exportJson}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={save.isPending || exporting}
                  onSelect={() => void handleExport('yaml')}
                >
                  <Download className="size-4" />
                  {ru.importExport.exportYaml}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={save.isPending}
                  onSelect={() => setImportOpen(true)}
                >
                  <Upload className="size-4" />
                  {ru.importExport.import}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/bots`)}>
                  <Bot className="size-4" />
                  {ru.editor.bots}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {theme === 'dark' ? ru.theme.switchToLight : ru.theme.switchToDark}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
                  <CircleHelp className="size-4" />
                  {ru.editor.shortcuts.open}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </EditorHeader>
      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="relative min-w-0 flex-1" aria-label={ru.editor.canvas}>
          <EditorActionsContext.Provider value={actions}>
            <ServerIssuesContext.Provider value={serverIssuesByBlock}>
              <Canvas
                nodes={displayNodes}
                edges={displayEdges}
                mode={canvasMode}
                onModeChange={setCanvasMode}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onEdgesReplace={handleEdgesReplace}
                onAutoLayout={handleAutoLayout}
                onAddClick={() => setPicker({ kind: 'free' })}
                onBlockDrop={handleBlockDrop}
                onConnectDrop={handleConnectDrop}
                onNodeDragStart={handleDragStart}
                onNodeDragStop={handleDragStop}
                onDuplicateSelected={handleDuplicateSelected}
                onDeleteSelected={handleDeleteSelected}
                onClearSelection={handleClearSelection}
              >
                {picker?.kind === 'output' && picker.point && (
                  <ViewportPortal>
                    <div
                      data-testid="connect-drop-marker"
                      className="pointer-events-none absolute flex h-20 w-48 items-center justify-center rounded-lg border-2 border-dashed border-[var(--brand)] bg-[var(--brand-soft)]/45 px-3 text-xs font-medium text-foreground shadow-sm"
                      style={{
                        transform: `translate(${picker.point.x}px, ${picker.point.y}px)`,
                      }}
                    >
                      {ru.editor.dropTargetHint}
                    </div>
                  </ViewportPortal>
                )}
                {blank && !showWelcome && entryNode && (
                  <FirstStepCard
                    entry={entryNode}
                    onClick={() =>
                      setPicker({ kind: 'output', blockId: entryNode.id, output: 'default' })
                    }
                  />
                )}
              </Canvas>
            </ServerIssuesContext.Provider>
          </EditorActionsContext.Provider>
          {showWelcome && <WelcomeOverlay onChoose={applyTemplate} />}
        </div>
      </div>
      <BlockDialog
        nodeId={dialog?.id ?? null}
        nodes={nodes}
        edges={edges}
        focusTitle={dialog?.focusTitle ?? false}
        onChange={handleDataChange}
        onClose={closeDialog}
      />
      <ImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={onImported}
      />
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ValidationPanel
        open={validationOpen}
        onOpenChange={setValidationOpen}
        errors={validationErrors}
        onSelectBlock={handleSelectValidationBlock}
      />
      <PreviewPanel
        projectId={projectId}
        open={previewOpen}
        onOpenChange={handlePreviewOpenChange}
        onCurrentBlock={handlePreviewCurrentBlock}
        onErrorBlock={handlePreviewErrorBlock}
      />
      <TestEnvironmentDialog
        projectId={projectId}
        environment={environment}
        open={testEnvOpen}
        onOpenChange={setTestEnvOpen}
      />
      <NodePicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        excluded={picker?.kind === 'edge' ? ['EXIT_POINT'] : []}
        onPick={(type) => picker && placeBlock(type, picker)}
      />
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ru.editor.leaveTitle}</DialogTitle>
            <DialogDescription>{ru.editor.leaveDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => blocker.state === 'blocked' && blocker.reset()}
            >
              {ru.editor.leaveStay}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => blocker.state === 'blocked' && blocker.proceed()}
            >
              {ru.editor.leaveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EditorPage() {
  const { id = '' } = useParams();
  const { data: project, isError, refetch } = useProject(id);
  // Счётчик импортов: перемонтирует редактор после успешного импорта, сбрасывая историю и dirty
  const [importRevision, setImportRevision] = useState(0);

  const handleImported = useCallback(async () => {
    const result = await refetch();
    if (!result.isError) {
      setImportRevision((prev) => prev + 1);
    }
  }, [refetch]);

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        {isError ? (
          <>
            <EditorHeader />
            <p className="p-6 text-destructive">{ru.editor.loadError}</p>
          </>
        ) : !project ? (
          <>
            <EditorHeader />
            <p className="p-6 text-muted-foreground">{ru.common.loading}</p>
          </>
        ) : (
          <ReactFlowProvider>
            {/* Состояние редактора инициализируется один раз из загруженного проекта */}
            <ScenarioEditor
              key={`${project.id}:${importRevision}`}
              projectId={project.id}
              name={project.name}
              initial={project.scenario}
              environment={project.environment ?? []}
              onImported={handleImported}
            />
          </ReactFlowProvider>
        )}
      </div>
    </TooltipProvider>
  );
}
