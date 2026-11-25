import type { Edge } from '@xyflow/react';
import type { BlockType } from '@chatbot/model';
import { BLOCK_META } from '../block-meta';
import { BLOCK_NODE_TYPE, connectEdges, safeOutputs, type BlockNode } from '../convert';
import { nextBlockId } from '../ids';
import { findFreePosition, placeNear, snapToGrid } from '../placement';

export interface GraphResult {
  nodes: BlockNode[];
  edges: Edge[];
  // Идентификатор созданного блока
  id: string;
}

// Новый блок выделяется, остальные выделение теряют
function withNewNode(nodes: BlockNode[], type: BlockType, position: { x: number; y: number }) {
  const id = nextBlockId(type, nodes);
  const created: BlockNode = {
    id,
    type: BLOCK_NODE_TYPE,
    position,
    data: BLOCK_META[type].defaults(),
    selected: true,
  };
  return { id, nodes: [...nodes.map((n) => ({ ...n, selected: false })), created] };
}

// «+» у выхода: блок правее источника и связь от этого выхода
export function addFromOutput(
  nodes: BlockNode[],
  edges: Edge[],
  from: { blockId: string; output: string },
  type: BlockType,
  position?: { x: number; y: number },
): GraphResult {
  const source = nodes.find((n) => n.id === from.blockId);
  const at =
    position ?? (source ? placeNear(source, nodes) : findFreePosition(nodes, { x: 0, y: 0 }));
  const next = withNewNode(nodes, type, at);
  return {
    ...next,
    edges: connectEdges(edges, {
      source: from.blockId,
      sourceHandle: from.output,
      target: next.id,
    }),
  };
}

// «+» на связи: старая связь заменяется двумя через первый выход нового блока.
// Блок без выходов вставить нельзя — вернётся null
export function insertOnEdge(
  nodes: BlockNode[],
  edges: Edge[],
  edgeIdToSplit: string,
  type: BlockType,
  position?: { x: number; y: number },
): GraphResult | null {
  const edge = edges.find((e) => e.id === edgeIdToSplit);
  if (!edge || edge.sourceHandle == null) return null;
  const [firstOutput] = safeOutputs(BLOCK_META[type].defaults());
  if (firstOutput === undefined) return null;
  const source = nodes.find((n) => n.id === edge.source);
  const at =
    position ?? (source ? placeNear(source, nodes) : findFreePosition(nodes, { x: 0, y: 0 }));
  const next = withNewNode(nodes, type, at);
  const withFirst = connectEdges(edges, {
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: next.id,
  });
  return {
    ...next,
    edges: connectEdges(withFirst, {
      source: next.id,
      sourceHandle: firstOutput,
      target: edge.target,
    }),
  };
}

// Блок без связей в заданной точке потока (по сетке)
export function addFree(
  nodes: BlockNode[],
  edges: Edge[],
  type: BlockType,
  point: { x: number; y: number },
): GraphResult {
  const next = withNewNode(nodes, type, { x: snapToGrid(point.x), y: snapToGrid(point.y) });
  return { ...next, edges };
}
