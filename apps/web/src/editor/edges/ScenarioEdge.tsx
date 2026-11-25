import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';
import { ru } from '@/i18n/ru';
import { IconAction } from '../IconAction';
import { useEditorActions } from '../actions';
import { useHoverDelay } from '../useHoverDelay';
import { backwardEdgePath, isBackward, type Rect } from './backward-path';

const ARROW_COLOR = 'var(--muted-foreground)';
const ARROW_COLOR_SELECTED = 'var(--primary)';

interface EdgeButtonsProps {
  visible: boolean;
  onInsert: () => void;
  onDelete: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

// Кнопки «добавить блок» и «удалить связь» в середине связи
export function EdgeButtons({
  visible,
  onInsert,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: EdgeButtonsProps) {
  if (!visible) return null;
  return (
    <div
      className="nodrag nopan pointer-events-auto flex gap-1"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <IconAction
        icon={Plus}
        label={ru.editor.insertOnEdge}
        onClick={(event) => {
          event.stopPropagation();
          onInsert();
        }}
      />
      <IconAction
        icon={Trash2}
        label={ru.editor.deleteEdge}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="hover:text-destructive"
      />
    </div>
  );
}

// Границы блока в координатах потока; пока блок не измерен — запасной прямоугольник у точки связи
function useNodeRect(nodeId: string, fallback: { x: number; y: number }): Rect {
  const node = useInternalNode(nodeId);
  const width = node?.measured.width;
  const height = node?.measured.height;
  if (!node || !width || !height) {
    return { x: fallback.x, y: fallback.y - 40, width: 0, height: 80 };
  }
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width,
    height,
  };
}

export function ScenarioEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
}: EdgeProps) {
  const { insertOnEdge, removeEdge } = useEditorActions();
  const { hovered, handlers } = useHoverDelay(150);
  const sourceRect = useNodeRect(source, { x: sourceX, y: sourceY });
  const targetRect = useNodeRect(target, { x: targetX, y: targetY });
  const sourcePoint = { x: sourceX, y: sourceY };
  const targetPoint = { x: targetX, y: targetY };

  let path: string;
  let labelX: number;
  let labelY: number;
  if (isBackward(sourcePoint, targetPoint, sourceRect)) {
    ({ path, labelX, labelY } = backwardEdgePath(sourcePoint, targetPoint, sourceRect, targetRect));
  } else {
    [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
  }

  // Стрелка рисуется здесь же: обычная, акцентная (превью) и выделенная — разные маркеры
  const customStroke = typeof style?.stroke === 'string' ? style.stroke : undefined;
  const color = selected ? ARROW_COLOR_SELECTED : (customStroke ?? ARROW_COLOR);
  const markerSuffix = selected ? '-selected' : customStroke ? '-accent' : '';
  const markerId = `arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}${markerSuffix}`;

  return (
    <g {...handlers}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} style={{ fill: color }} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${markerId})`}
        interactionWidth={24}
        style={{ ...style, stroke: color, strokeWidth: selected ? 2.5 : (style?.strokeWidth ?? 1.5) }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <EdgeButtons
            visible={hovered || Boolean(selected)}
            onInsert={() => insertOnEdge(id)}
            onDelete={() => removeEdge(id)}
            onMouseEnter={handlers.onMouseEnter}
            onMouseLeave={handlers.onMouseLeave}
          />
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}
