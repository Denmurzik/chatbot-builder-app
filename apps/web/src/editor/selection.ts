import type { Edge } from '@xyflow/react';
import { BLOCK_NODE_TYPE, pruneEdges, type BlockNode } from './convert';
import { nextBlockId } from './ids';
import { snapToGrid } from './placement';

export interface SelectionGraphResult {
  nodes: BlockNode[];
  edges: Edge[];
}

const DUPLICATE_OFFSET = 40;

// Дублирует выбранные блоки (кроме точки входа) вместе со связями между ними; выделяет копии
export function duplicateSelectedNodes(
  nodes: BlockNode[],
  edges: Edge[],
  selectedIds: Iterable<string>,
): SelectionGraphResult | null {
  const idSet = new Set(selectedIds);
  const sources = nodes.filter((node) => idSet.has(node.id) && node.data.type !== 'ENTRY_POINT');
  if (sources.length === 0) return null;

  const workingNodes = [...nodes];
  const idMap = new Map<string, string>();
  const copies: BlockNode[] = [];

  for (const source of sources) {
    const newId = nextBlockId(source.data.type, workingNodes);
    idMap.set(source.id, newId);
    const copy: BlockNode = {
      id: newId,
      type: BLOCK_NODE_TYPE,
      position: {
        x: snapToGrid(source.position.x + DUPLICATE_OFFSET),
        y: snapToGrid(source.position.y + DUPLICATE_OFFSET),
      },
      data: structuredClone(source.data),
      selected: true,
    };
    workingNodes.push(copy);
    copies.push(copy);
  }

  // Сохраняем внутренние связи между продублированными блоками
  const copiedEdges: Edge[] = [];
  for (const edge of edges) {
    const nextSource = idMap.get(edge.source);
    const nextTarget = idMap.get(edge.target);
    if (!nextSource || !nextTarget) continue;
    const handlePart = edge.sourceHandle ? `:${edge.sourceHandle}` : '';
    copiedEdges.push({
      ...structuredClone(edge),
      id: `${nextSource}${handlePart}->${nextTarget}`,
      source: nextSource,
      target: nextTarget,
      selected: false,
    });
  }

  const deselectedOriginal = nodes.map((node) => (node.selected ? { ...node, selected: false } : node));
  const deselectedEdges = edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge));

  return {
    nodes: [...deselectedOriginal, ...copies],
    edges: [...deselectedEdges, ...copiedEdges],
  };
}

// Удаляет выбранные блоки (точка входа защищена) и связанные с ними рёбра
export function removeSelectedNodes(
  nodes: BlockNode[],
  edges: Edge[],
  selectedIds: Iterable<string>,
): SelectionGraphResult | null {
  const idSet = new Set(selectedIds);
  const removableIds = new Set(
    nodes
      .filter((node) => idSet.has(node.id) && node.data.type !== 'ENTRY_POINT')
      .map((node) => node.id),
  );
  if (removableIds.size === 0) return null;

  const nextNodes = nodes.filter((node) => !removableIds.has(node.id));
  const nextEdges = pruneEdges(nextNodes, edges);
  return { nodes: nextNodes, edges: nextEdges };
}
