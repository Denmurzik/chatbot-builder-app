import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { BlockNode } from './convert';
import { layoutScenario } from './layout';
import { GRID_SIZE, defaultNodeSize } from './placement';

function makeNode(
  id: string,
  data: BlockNode['data'],
  measured?: { width?: number; height?: number },
): BlockNode {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data,
    ...(measured ? { measured } : {}),
  };
}

function boxesOverlap(a: BlockNode, b: BlockNode): boolean {
  const sizeA = {
    width: a.measured?.width ?? defaultNodeSize(a.data.type).width,
    height: a.measured?.height ?? defaultNodeSize(a.data.type).height,
  };
  const sizeB = {
    width: b.measured?.width ?? defaultNodeSize(b.data.type).width,
    height: b.measured?.height ?? defaultNodeSize(b.data.type).height,
  };
  return (
    a.position.x < b.position.x + sizeB.width &&
    b.position.x < a.position.x + sizeA.width &&
    a.position.y < b.position.y + sizeB.height &&
    b.position.y < a.position.y + sizeA.height
  );
}

describe('layoutScenario', () => {
  it('раскладывает ветвящийся сценарий слева направо без пересечений и с привязкой к 20', () => {
    const nodes: BlockNode[] = [
      makeNode('entry', { type: 'ENTRY_POINT', title: 'Старт' }),
      makeNode('cond', { type: 'CONDITION', title: 'Проверка', expression: 'x > 0' }),
      makeNode('yes_msg', { type: 'TEXT_MESSAGE', title: 'Да', text: 'Ок' }),
      makeNode('no_msg', { type: 'TEXT_MESSAGE', title: 'Нет', text: 'Увы' }),
      makeNode('exit', { type: 'EXIT_POINT', title: 'Конец' }),
    ];
    const edges: Edge[] = [
      { id: 'entry::default', source: 'entry', sourceHandle: 'default', target: 'cond' },
      { id: 'cond::yes', source: 'cond', sourceHandle: 'yes', target: 'yes_msg' },
      { id: 'cond::no', source: 'cond', sourceHandle: 'no', target: 'no_msg' },
      { id: 'yes_msg::default', source: 'yes_msg', sourceHandle: 'default', target: 'exit' },
      { id: 'no_msg::default', source: 'no_msg', sourceHandle: 'default', target: 'exit' },
    ];

    const laidOut = layoutScenario(nodes, edges);
    const byId = new Map(laidOut.map((n) => [n.id, n]));

    // У каждого ребра цель правее источника
    for (const edge of edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(target.position.x).toBeGreaterThan(source.position.x);
    }

    // Никакие два узла не пересекаются
    for (let i = 0; i < laidOut.length; i += 1) {
      for (let j = i + 1; j < laidOut.length; j += 1) {
        expect(boxesOverlap(laidOut[i]!, laidOut[j]!)).toBe(false);
      }
    }

    // Все координаты кратны 20
    for (const node of laidOut) {
      expect(node.position.x % GRID_SIZE).toBe(0);
      expect(node.position.y % GRID_SIZE).toBe(0);
    }
  });

  it('учитывает measured-размеры узлов и не ломается на пустом списке', () => {
    expect(layoutScenario([], [])).toEqual([]);

    const nodes: BlockNode[] = [
      makeNode('a', { type: 'ENTRY_POINT', title: 'Старт' }, { width: 320, height: 100 }),
      makeNode('b', { type: 'EXIT_POINT', title: 'Конец' }, { width: 200, height: 80 }),
    ];
    const edges: Edge[] = [{ id: 'a::default', source: 'a', sourceHandle: 'default', target: 'b' }];

    const laidOut = layoutScenario(nodes, edges);
    expect(laidOut[1]!.position.x).toBeGreaterThanOrEqual(laidOut[0]!.position.x + 320);
    for (const node of laidOut) {
      expect(node.position.x % GRID_SIZE).toBe(0);
      expect(node.position.y % GRID_SIZE).toBe(0);
    }
  });

  it('цепочка с обратной связью (Эхо): зазор между рангами >= 100, без пересечений', () => {
    const size = { width: 320, height: 120 };
    const nodes: BlockNode[] = [
      makeNode('start', { type: 'ENTRY_POINT', title: 'Старт' }, size),
      makeNode('in1', { type: 'TEXT_INPUT', title: 'Ввод', question: '', variableName: 'x' }, size),
      makeNode('echo', { type: 'TEXT_MESSAGE', title: 'Эхо', text: 'Эхо' }, size),
      makeNode('in2', { type: 'TEXT_INPUT', title: 'Ввод', question: '', variableName: 'x' }, size),
    ];
    const link = (s: string, t: string): Edge => ({
      id: `${s}::default`,
      source: s,
      sourceHandle: 'default',
      target: t,
    });
    const edges = [
      link('start', 'in1'),
      link('in1', 'echo'),
      link('echo', 'in2'),
      link('in2', 'echo'),
    ];

    const laidOut = layoutScenario(nodes, edges);
    const sorted = [...laidOut].sort((a, b) => a.position.x - b.position.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      expect(sorted[i]!.position.x - (prev.position.x + size.width)).toBeGreaterThanOrEqual(100);
    }
    for (let i = 0; i < laidOut.length; i += 1) {
      for (let j = i + 1; j < laidOut.length; j += 1) {
        expect(boxesOverlap(laidOut[i]!, laidOut[j]!)).toBe(false);
      }
    }
    for (const node of laidOut) {
      expect(node.position.x % GRID_SIZE).toBe(0);
      expect(node.position.y % GRID_SIZE).toBe(0);
    }
  });
});
