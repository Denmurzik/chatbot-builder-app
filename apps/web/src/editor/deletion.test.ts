import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { BlockNode } from './convert';
import { filterDeletion } from './deletion';

const entry = {
  id: 'entry',
  type: 'block',
  position: { x: 0, y: 0 },
  data: { type: 'ENTRY_POINT', title: 'Старт' },
} as BlockNode;
const msg = {
  id: 'msg',
  type: 'block',
  position: { x: 0, y: 0 },
  data: { type: 'TEXT_MESSAGE', title: 'Привет', text: '' },
} as BlockNode;
const entryEdge: Edge = { id: 'e1', source: 'entry', target: 'msg', sourceHandle: 'default' };

describe('filterDeletion', () => {
  it('Delete на одной «Старт»: ничего не удаляется (ни узел, ни его связь)', () => {
    expect(filterDeletion([entry], [entryEdge])).toBe(false);
  });

  it('вместе со «Старт» удаляется выделенный блок и его связи, но не «Старт»', () => {
    const result = filterDeletion([entry, msg], [entryEdge]);
    expect(result).toEqual({ nodes: [msg], edges: [entryEdge] });
  });

  it('выделенная связь удаляется, даже если «Старт» выделен тоже', () => {
    const other: Edge = { id: 'e2', source: 'a', target: 'b', selected: true };
    const result = filterDeletion([entry], [entryEdge, other]);
    expect(result).toEqual({ nodes: [], edges: [other] });
  });
});
