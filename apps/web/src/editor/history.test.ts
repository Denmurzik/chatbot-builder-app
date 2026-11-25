import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { BLOCK_NODE_TYPE, type BlockNode } from './convert';
import { HISTORY_LIMIT, History, snapshotOf } from './history';

function node(id: string, x = 0, selected = false): BlockNode {
  return {
    id,
    type: BLOCK_NODE_TYPE,
    position: { x, y: 0 },
    data: { type: 'TEXT_MESSAGE', title: id, text: '' },
    selected,
    dragging: selected,
    measured: { width: 10, height: 10 },
  } as BlockNode;
}

function edge(source: string, target: string, selected = false): Edge {
  return { id: `${source}-${target}`, source, sourceHandle: 'default', target, selected };
}

describe('snapshotOf', () => {
  it('убирает selected, dragging и measured', () => {
    const snap = snapshotOf([node('a', 0, true)], [edge('a', 'b', true)]);
    expect(snap.nodes[0]).not.toHaveProperty('selected');
    expect(snap.nodes[0]).not.toHaveProperty('dragging');
    expect(snap.nodes[0]).not.toHaveProperty('measured');
    expect(snap.edges[0]).not.toHaveProperty('selected');
  });

  it('не делит данные с исходным графом', () => {
    const source = node('a');
    const snap = snapshotOf([source], []);
    (snap.nodes[0]!.data as { title: string }).title = 'changed';
    expect(source.data.title).toBe('a');
  });
});

describe('History', () => {
  const nodes = [node('a'), node('b')];
  const edges = [edge('a', 'b')];

  it('удаление связи и отмена возвращают её', () => {
    const history = new History();
    const before = snapshotOf(nodes, edges);
    history.push(before);
    const restored = history.undo(snapshotOf(nodes, []));
    expect(restored).toEqual(before);
    expect(restored!.edges).toHaveLength(1);
  });

  it('три действия и три отмены возвращают исходный граф', () => {
    const history = new History();
    const s0 = snapshotOf([node('a')], []);
    const s1 = snapshotOf([node('a'), node('b')], []);
    const s2 = snapshotOf([node('a'), node('b')], [edge('a', 'b')]);
    const s3 = snapshotOf([node('a'), node('b', 5)], [edge('a', 'b')]);
    history.push(s0);
    history.push(s1);
    history.push(s2);
    let current = s3;
    for (const expected of [s2, s1, s0]) {
      current = history.undo(current)!;
      expect(current).toEqual(expected);
    }
    expect(history.canUndo).toBe(false);
    expect(history.undo(current)).toBeNull();
  });

  it('повтор после отмены возвращает отменённое состояние', () => {
    const history = new History();
    const s0 = snapshotOf([node('a')], []);
    const s1 = snapshotOf([node('a'), node('b')], []);
    history.push(s0);
    const undone = history.undo(s1)!;
    expect(history.canRedo).toBe(true);
    expect(history.redo(undone)).toEqual(s1);
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('новое действие очищает повтор', () => {
    const history = new History();
    const s0 = snapshotOf([node('a')], []);
    const s1 = snapshotOf([node('a'), node('b')], []);
    history.push(s0);
    history.undo(s1);
    expect(history.canRedo).toBe(true);
    history.push(s0);
    expect(history.canRedo).toBe(false);
  });

  it('хранит не больше HISTORY_LIMIT шагов', () => {
    const history = new History();
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) history.push(snapshotOf([node('a', i)], []));
    let count = 0;
    let current = snapshotOf([node('a', -1)], []);
    while (history.canUndo) {
      current = history.undo(current)!;
      count += 1;
    }
    expect(count).toBe(HISTORY_LIMIT);
    // Самые старые шаги вытеснены
    expect(current.nodes[0]!.position.x).toBe(20);
  });
});
