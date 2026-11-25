import type { EditorView } from '@codemirror/view';
import { createContext, useCallback, useContext } from 'react';

// Поле настроек, в которое колонка «Вход» вставляет имя переменной кликом «Вставить»
export interface InsertTarget {
  // template — {{имя}} в шаблон; expression/variable — само имя
  kind: 'template' | 'expression' | 'variable';
  insert(name: string): void;
  // Поле ещё на экране (после смены настроек оно могло исчезнуть)
  isAlive(): boolean;
}

export interface InsertRegistry {
  target: InsertTarget | null;
  setTarget(target: InsertTarget | null): void;
}

export const InsertContext = createContext<InsertRegistry>({
  target: null,
  setTarget: () => {},
});

export function useInsertRegistry(): InsertRegistry {
  return useContext(InsertContext);
}

// Вставка текста в позицию курсора CodeMirror (с заменой выделения)
export function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

// Обработчик onCreateEditor для полей CodeMirror: запоминает поле как цель вставки при фокусе
export function useCodeMirrorInsertTarget(kind: 'template' | 'expression') {
  const { setTarget } = useInsertRegistry();
  return useCallback(
    (view: EditorView) => {
      view.dom.addEventListener('focusin', () =>
        setTarget({
          kind,
          insert: (name) => insertAtCursor(view, kind === 'template' ? `{{${name}}}` : name),
          isAlive: () => view.dom.isConnected,
        }),
      );
    },
    [kind, setTarget],
  );
}
