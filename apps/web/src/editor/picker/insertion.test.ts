import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { BLOCK_META } from '../block-meta';
import { BLOCK_NODE_TYPE, edgeId, type BlockNode } from '../convert';
import { addFree, addFromOutput, insertOnEdge } from './insertion';

function node(id: string, type: 'ENTRY_POINT' | 'TEXT_MESSAGE', x = 0, y = 0): BlockNode {
  return { id, type: BLOCK_NODE_TYPE, position: { x, y }, data: BLOCK_META[type].defaults() };
}

const entry = node('entry', 'ENTRY_POINT');

describe('addFromOutput', () => {
  it('добавляет блок правее источника и ребро от выбранного выхода', () => {
    const result = addFromOutput(
      [entry],
      [],
      { blockId: 'entry', output: 'default' },
      'TEXT_MESSAGE',
    );
    expect(result.nodes).toHaveLength(2);
    const created = result.nodes.find((n) => n.id === result.id)!;
    expect(created.position.x).toBeGreaterThan(entry.position.x);
    expect(created.position.x % 20).toBe(0);
    expect(created.selected).toBe(true);
    expect(result.edges).toEqual([
      {
        id: edgeId('entry', 'default'),
        source: 'entry',
        sourceHandle: 'default',
        target: result.id,
      },
    ]);
  });
});

describe('insertOnEdge', () => {
  const msg = node('msg_1', 'TEXT_MESSAGE', 400, 0);
  const edge: Edge = {
    id: edgeId('entry', 'default'),
    source: 'entry',
    sourceHandle: 'default',
    target: 'msg_1',
  };

  it('заменяет одну связь двумя через первый выход нового блока', () => {
    const result = insertOnEdge([entry, msg], [edge], edge.id, 'TEXT_MESSAGE')!;
    expect(result.edges).toHaveLength(2);
    expect(result.edges.map((e) => [e.source, e.sourceHandle, e.target])).toEqual(
      expect.arrayContaining([
        ['entry', 'default', result.id],
        [result.id, 'default', 'msg_1'],
      ]),
    );
  });

  it('блок без выходов вставить на связь нельзя', () => {
    expect(insertOnEdge([entry, msg], [edge], edge.id, 'EXIT_POINT')).toBeNull();
  });

  it('неизвестная связь — null', () => {
    expect(insertOnEdge([entry, msg], [edge], 'nope', 'TEXT_MESSAGE')).toBeNull();
  });
});

describe('addFree', () => {
  it('ставит блок в заданную точку по сетке без связей', () => {
    const result = addFree([entry], [], 'TEXT_MESSAGE', { x: 205, y: 118 });
    const created = result.nodes.find((n) => n.id === result.id)!;
    expect(created.position).toEqual({ x: 200, y: 120 });
    expect(result.edges).toEqual([]);
  });
});
