import type { Edge } from '@xyflow/react';
import type { BlockNode } from './convert';

// Что реально удалять по Delete: точку входа удалить нельзя, а связи, которые React Flow
// добавил только из-за неё, остаются. Возвращает false, если удалять нечего
export function filterDeletion(
  nodes: BlockNode[],
  edges: Edge[],
): { nodes: BlockNode[]; edges: Edge[] } | false {
  const doomed = nodes.filter((node) => node.data.type !== 'ENTRY_POINT');
  const doomedIds = new Set(doomed.map((node) => node.id));
  const keptEdges = edges.filter(
    (edge) => edge.selected || doomedIds.has(edge.source) || doomedIds.has(edge.target),
  );
  if (doomed.length === 0 && keptEdges.length === 0) return false;
  return { nodes: doomed, edges: keptEdges };
}
