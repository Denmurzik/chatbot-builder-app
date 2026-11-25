import { createContext, useContext } from 'react';

// Действия редактора для блоков и связей: задачи 4 и 5 подменяют значения в EditorPage,
// не трогая BlockNode и ScenarioEdge
export interface EditorActions {
  openBlock(id: string): void;
  addFromOutput(blockId: string, output: string): void;
  insertOnEdge(edgeId: string): void;
  removeEdge(edgeId: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
  rename(id: string): void;
}

const noop = () => {};

export const EditorActionsContext = createContext<EditorActions>({
  openBlock: noop,
  addFromOutput: noop,
  insertOnEdge: noop,
  removeEdge: noop,
  duplicate: noop,
  remove: noop,
  rename: noop,
});

export function useEditorActions(): EditorActions {
  return useContext(EditorActionsContext);
}
