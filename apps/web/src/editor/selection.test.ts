import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { BLOCK_NODE_TYPE, type BlockNode } from './convert';
import { duplicateSelectedNodes, removeSelectedNodes } from './selection';

function makeNode(
  id: string,
  type: BlockNode['data']['type'],
  x: number,
  y: number,
  selected = false,
): BlockNode {
  const data =
    type === 'ENTRY_POINT'
      ? { type: 'ENTRY_POINT' as const, title: 'Старт' }
      : type === 'EXIT_POINT'
        ? { type: 'EXIT_POINT' as const, title: 'Конец' }
        : { type: 'TEXT_MESSAGE' as const, title: `Блок ${id}`, text: 'Привет' };
  return {
    id,
    type: BLOCK_NODE_TYPE,
    position: { x, y },
    data,
    selected,
  };
}

describe('selection helpers', () => {
  it('дублирует выбранную группу со сдвигом, сохраняя внутренние связи и не трогая ENTRY_POINT', () => {
    const nodes: BlockNode[] = [
      makeNode('entry', 'ENTRY_POINT', 0, 0, true),
      makeNode('msg_1', 'TEXT_MESSAGE', 100, 40, true),
      makeNode('msg_2', 'TEXT_MESSAGE', 300, 40, true),
      makeNode('exit_1', 'EXIT_POINT', 500, 40, false),
    ];
    const edges: Edge[] = [
      { id: 'entry:default->msg_1', source: 'entry', sourceHandle: 'default', target: 'msg_1' },
      { id: 'msg_1:default->msg_2', source: 'msg_1', sourceHandle: 'default', target: 'msg_2' },
      { id: 'msg_2:default->exit_1', source: 'msg_2', sourceHandle: 'default', target: 'exit_1' },
    ];

    const result = duplicateSelectedNodes(nodes, edges, ['entry', 'msg_1', 'msg_2']);
    expect(result).not.toBeNull();
    // 4 исходных + 2 новых (entry не дублируется)
    expect(result!.nodes).toHaveLength(6);

    const copies = result!.nodes.slice(4);
    expect(copies.every((n) => n.selected)).toBe(true);
    expect(result!.nodes.slice(0, 4).every((n) => !n.selected)).toBe(true);
    expect(copies[0]!.position).toEqual({ x: 140, y: 80 });
    expect(copies[1]!.position).toEqual({ x: 340, y: 80 });

    // Внутреннее ребро между msg_1 и msg_2 продублировано, внешние — нет
    expect(result!.edges).toHaveLength(4);
    const copiedEdge = result!.edges[3]!;
    expect(copiedEdge.source).toBe(copies[0]!.id);
    expect(copiedEdge.target).toBe(copies[1]!.id);
    expect(copiedEdge.sourceHandle).toBe('default');
  });

  it('возвращает null при попытке дублировать или удалить только точку входа', () => {
    const nodes = [makeNode('entry', 'ENTRY_POINT', 0, 0, true)];
    expect(duplicateSelectedNodes(nodes, [], ['entry'])).toBeNull();
    expect(removeSelectedNodes(nodes, [], ['entry'])).toBeNull();
  });

  it('удаляет выбранные блоки кроме ENTRY_POINT и очищает висячие рёбра', () => {
    const nodes: BlockNode[] = [
      makeNode('entry', 'ENTRY_POINT', 0, 0, true),
      makeNode('msg_1', 'TEXT_MESSAGE', 100, 40, true),
      makeNode('exit_1', 'EXIT_POINT', 300, 40, false),
    ];
    const edges: Edge[] = [
      { id: 'entry:default->msg_1', source: 'entry', sourceHandle: 'default', target: 'msg_1' },
      { id: 'msg_1:default->exit_1', source: 'msg_1', sourceHandle: 'default', target: 'exit_1' },
    ];

    const result = removeSelectedNodes(nodes, edges, ['entry', 'msg_1']);
    expect(result).not.toBeNull();
    expect(result!.nodes.map((n) => n.id)).toEqual(['entry', 'exit_1']);
    expect(result!.edges).toHaveLength(0);
  });
});
