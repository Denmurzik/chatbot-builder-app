import type { Edge } from '@xyflow/react';
import { Graph, layout } from '@dagrejs/dagre';
import type { BlockNode } from './convert';
import { defaultNodeSize, snapToGrid } from './placement';

const NODE_SEP = 60;
const RANK_SEP = 120;

function sizeOf(node: BlockNode): { width: number; height: number } {
  const fallback = defaultNodeSize(node.data.type);
  return {
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

// Обратные рёбра (замыкают цикл при обходе в глубину от входов) не должны влиять на ранги
function forwardEdges(nodes: BlockNode[], edges: Edge[]): Edge[] {
  const ids = new Set(nodes.map((node) => node.id));
  const out = new Map<string, Edge[]>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge]);
    if (edge.source !== edge.target) hasIncoming.add(edge.target);
  }
  const state = new Map<string, 'open' | 'done'>();
  const back = new Set<Edge>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const edge of out.get(id) ?? []) {
      const next = state.get(edge.target);
      if (next === 'open') back.add(edge);
      else if (!next) visit(edge.target);
    }
    state.set(id, 'done');
  };
  const roots = [...nodes.filter((n) => !hasIncoming.has(n.id)), ...nodes];
  for (const root of roots) if (!state.has(root.id)) visit(root.id);
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && !back.has(edge));
}

// Раскладка слева направо (dagre): возвращает узлы с новыми позициями по сетке 20
export function layoutScenario(nodes: BlockNode[], edges: Edge[]): BlockNode[] {
  if (nodes.length === 0) return [];
  const graph = new Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, acyclicer: 'greedy' });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, sizeOf(node));
  for (const edge of forwardEdges(nodes, edges)) graph.setEdge(edge.source, edge.target);
  layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id);
    const { width, height } = sizeOf(node);
    // dagre отдаёт центр узла — переводим в левый верхний угол и привязываем к сетке
    return {
      ...node,
      position: {
        x: snapToGrid(placed.x - width / 2),
        y: snapToGrid(placed.y - height / 2),
      },
    };
  });
}
