import { useCallback, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import type { BlockNode } from './convert';

export const HISTORY_LIMIT = 100;

// Снимок графа: только то, что относится к сценарию (без выделения, перетаскивания и размеров)
export interface Snapshot {
  nodes: BlockNode[];
  edges: Edge[];
}

export function snapshotOf(nodes: BlockNode[], edges: Edge[]): Snapshot {
  return {
    nodes: nodes.map((node) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { selected, dragging, measured, ...rest } = node;
      return structuredClone(rest) as BlockNode;
    }),
    edges: edges.map((edge) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { selected, ...rest } = edge;
      return structuredClone(rest) as Edge;
    }),
  };
}

// Равенство снимков по содержимому
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Стеки «отменить» и «повторить»; снимок кладётся ДО изменения
export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  // Новое действие: сохраняем состояние до него и забываем «повтор»
  push(before: Snapshot): void {
    this.past.push(before);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  // current — состояние сейчас; возвращает то, к чему вернуться, или null
  undo(current: Snapshot): Snapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }
}

interface UseHistoryOptions {
  getGraph: () => Snapshot;
  // Применить снимок к редактору (и пометить сценарий изменённым)
  restore: (snapshot: Snapshot) => void;
}

// Хук поверх History: флаги для кнопок и «один шаг на тик» (удаление блока и его рёбер)
export function useHistory({ getGraph, restore }: UseHistoryOptions) {
  const historyRef = useRef(new History());
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const tickRef = useRef(false);

  const sync = useCallback(() => {
    const history = historyRef.current;
    setFlags({ canUndo: history.canUndo, canRedo: history.canRedo });
  }, []);

  const pushSnapshot = useCallback(
    (snapshot: Snapshot) => {
      historyRef.current.push(snapshot);
      sync();
    },
    [sync],
  );

  // Запомнить текущее состояние перед изменением; повторные вызовы в том же тике — один шаг
  const record = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = true;
    queueMicrotask(() => {
      tickRef.current = false;
    });
    const { nodes, edges } = getGraph();
    pushSnapshot(snapshotOf(nodes, edges));
  }, [getGraph, pushSnapshot]);

  const undo = useCallback(() => {
    const { nodes, edges } = getGraph();
    const target = historyRef.current.undo(snapshotOf(nodes, edges));
    if (target) restore(target);
    sync();
  }, [getGraph, restore, sync]);

  const redo = useCallback(() => {
    const { nodes, edges } = getGraph();
    const target = historyRef.current.redo(snapshotOf(nodes, edges));
    if (target) restore(target);
    sync();
  }, [getGraph, restore, sync]);

  return { record, pushSnapshot, undo, redo, ...flags };
}
