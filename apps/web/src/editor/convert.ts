import type { Edge, Node } from '@xyflow/react';
import { getOutputs, type Block, type Scenario } from '@chatbot/model';

// Omit, сохраняющий размеченное объединение
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// Данные узла — ТОЛЬКО поля блока модели (без id/x/y): состояние интерфейса сюда не попадает,
// иначе оно утекло бы в сохранённый сценарий
export type BlockNodeData = DistributiveOmit<Block, 'id' | 'x' | 'y'>;
export type BlockNode = Node<BlockNodeData, 'block'>;

export const BLOCK_NODE_TYPE = 'block' as const;

export function edgeId(source: string, output: string): string {
  return `${source}::${output}`;
}

// Собирает блок модели из узла холста
export function nodeToBlock(node: BlockNode): Block {
  return {
    ...node.data,
    id: node.id,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
  } as Block;
}

export function scenarioToFlow(scenario: Scenario): { nodes: BlockNode[]; edges: Edge[] } {
  const nodes: BlockNode[] = scenario.blocks.map((block) => {
    const { id, x, y, ...data } = block;
    return { id, type: BLOCK_NODE_TYPE, position: { x, y }, data };
  });
  const edges: Edge[] = scenario.transitions.map((transition) => ({
    id: edgeId(transition.source.blockId, transition.source.output),
    source: transition.source.blockId,
    sourceHandle: transition.source.output,
    target: transition.target,
  }));
  return { nodes, edges };
}

// Выходы блока для ручек: без пустых и повторяющихся имён, значение «else» в SWITCH
// не дублирует служебный выход (иначе ручки получат одинаковые id и ключи)
export function safeOutputs(data: BlockNodeData): string[] {
  const reserved = data.type === 'SWITCH' ? ['else'] : [];
  const unique = (items: string[]) => [
    ...new Set(items.filter((item) => item.trim() !== '' && !reserved.includes(item))),
  ];
  if (data.type === 'OPTION_CHOICE') return unique(data.options);
  if (data.type === 'SWITCH') return [...unique(data.values), 'else'];
  return getOutputs({ ...data, id: 'x', x: 0, y: 0 } as Block);
}

// Оставляет только рёбра с существующими узлами и выходами (ручка = имя выхода)
export function pruneEdges(nodes: BlockNode[], edges: Edge[]): Edge[] {
  const outputsById = new Map(nodes.map((node) => [node.id, safeOutputs(node.data)]));
  return edges.filter(
    (edge) =>
      edge.sourceHandle != null &&
      (outputsById.get(edge.source)?.includes(edge.sourceHandle) ?? false) &&
      outputsById.has(edge.target),
  );
}

// Новое соединение заменяет прежнее ребро из того же выхода
export function connectEdges(
  edges: Edge[],
  connection: { source: string; sourceHandle: string; target: string },
): Edge[] {
  return [
    ...edges.filter(
      (e) => !(e.source === connection.source && e.sourceHandle === connection.sourceHandle),
    ),
    {
      id: edgeId(connection.source, connection.sourceHandle),
      source: connection.source,
      sourceHandle: connection.sourceHandle,
      target: connection.target,
    },
  ];
}

export function flowToScenario(nodes: BlockNode[], edges: Edge[]): Scenario {
  return {
    formatVersion: 1,
    blocks: nodes.map(nodeToBlock),
    transitions: pruneEdges(nodes, edges).map((edge) => ({
      source: { blockId: edge.source, output: edge.sourceHandle as string },
      target: edge.target,
    })),
  };
}
