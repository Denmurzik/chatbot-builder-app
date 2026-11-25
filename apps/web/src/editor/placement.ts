import type { BlockType } from '@chatbot/model';
import { BLOCK_META } from './block-meta';

// Размеры узла по умолчанию (min-w-48 … max-w-64), пока React Flow не измерил его
export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 160;
export const NODE_GAP = 40;
export const GRID_SIZE = 20;

// Размеры по умолчанию (пока React Flow не измерил узел) — не меньше реальных карточек
export function defaultNodeSize(type: BlockType): { width: number; height: number } {
  switch (BLOCK_META[type].category) {
    case 'start':
    case 'finish':
      return { width: 280, height: 100 };
    default:
      return { width: 320, height: 160 };
  }
}

// Привязка координаты к сетке (+ 0 убирает -0)
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE + 0;
}

// Округление вверх до узла сетки: отступы от соседей не уменьшаются
function snapUp(value: number): number {
  return Math.ceil(value / GRID_SIZE) * GRID_SIZE + 0;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacedNode {
  position: { x: number; y: number };
  selected?: boolean;
  measured?: { width?: number; height?: number };
}

function boxOf(node: PlacedNode): Box {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? NODE_WIDTH,
    height: node.measured?.height ?? NODE_HEIGHT,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + NODE_GAP / 2 &&
    b.x < a.x + a.width + NODE_GAP / 2 &&
    a.y < b.y + b.height + NODE_GAP / 2 &&
    b.y < a.y + a.height + NODE_GAP / 2
  );
}

// Ищет свободное место для блока: сначала правее и ниже кандидата, затем следующие колонки.
// Все координаты — по сетке
function searchFree(boxes: Box[], start: { x: number; y: number }, columnTop: number) {
  const candidate: Box = {
    x: snapUp(start.x),
    y: snapUp(start.y),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
  for (let column = 0; column < 50; column += 1) {
    for (let row = 0; row < 200; row += 1) {
      const hit = boxes.find((b) => overlaps(candidate, b));
      if (!hit) return { x: candidate.x, y: candidate.y };
      candidate.y = snapUp(hit.y + hit.height + NODE_GAP);
    }
    candidate.x += snapUp(NODE_WIDTH + NODE_GAP);
    candidate.y = columnTop;
  }
  return { x: candidate.x, y: candidate.y };
}

// Ближайшее свободное место от точки start (по сетке): вниз, затем в следующие колонки
export function findFreeSpot(
  nodes: readonly PlacedNode[],
  start: { x: number; y: number },
): { x: number; y: number } {
  return searchFree(nodes.map(boxOf), start, snapUp(start.y));
}

// Новый блок — справа от источника; если место занято, сдвиг вниз, затем вправо
export function placeNear(
  source: PlacedNode,
  nodes: readonly PlacedNode[],
): { x: number; y: number } {
  const a = boxOf(source);
  const columnTop = snapUp(a.y);
  return searchFree(nodes.map(boxOf), { x: a.x + a.width + NODE_GAP, y: a.y }, columnTop);
}

// Свободное место для нового блока: справа от выбранного (или последнего) блока;
// без блоков — в центре видимой области
export function findFreePosition(
  nodes: readonly PlacedNode[],
  center: { x: number; y: number },
): { x: number; y: number } {
  if (nodes.length === 0) {
    return {
      x: snapToGrid(center.x - NODE_WIDTH / 2),
      y: snapToGrid(center.y - NODE_HEIGHT / 2),
    };
  }
  const anchor = nodes.find((n) => n.selected) ?? nodes[nodes.length - 1]!;
  return placeNear(anchor, nodes);
}
