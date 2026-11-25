import {
  EditorState,
  Prec,
  Transaction,
  type ChangeSpec,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

// Тема в токенах shadcn: работает и в светлой, и в тёмной теме через CSS-переменные
export function fieldTheme(multiline: boolean): Extension {
  return EditorView.theme({
    '&': {
      minHeight: multiline ? '5rem' : '2.25rem',
      border: '1px solid var(--input)',
      borderRadius: 'calc(var(--radius) - 2px)',
      backgroundColor: 'transparent',
      color: 'var(--foreground)',
      fontSize: '0.875rem',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--ring)',
      boxShadow: '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.5',
      overflowX: multiline ? 'hidden' : 'auto',
    },
    '.cm-content': { padding: '0.4rem 0.25rem', caretColor: 'var(--foreground)' },
    // CodeMirror рисует курсор и выделение сам (drawSelection), caretColor на них не влияет
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'color-mix(in oklab, var(--ring) 40%, transparent)' },
    '.cm-line': { padding: '0 0.5rem' },
    '.cm-placeholder': { color: 'var(--muted-foreground)' },
    '.cm-template-pill': {
      backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)',
      border: '1px solid color-mix(in oklab, var(--border) 70%, transparent)',
      borderRadius: '9999px',
      padding: '0 0.35rem',
      color: 'var(--foreground)',
    },
    '.cm-template-var-unknown': {
      textDecoration: 'underline wavy var(--destructive)',
      textUnderlineOffset: '3px',
    },
    '.cm-expr-op': { color: 'var(--syntax-operator)', fontWeight: '600' },
    '.cm-expr-number': { color: 'var(--syntax-number)' },
    '.cm-expr-keyword': { color: 'var(--syntax-keyword)', fontWeight: '600' },
    '.cm-expr-string': { color: 'var(--syntax-string)' },
    '.cm-expr-env': { color: 'var(--syntax-env)' },
    '.cm-expr-var': {
      color: 'var(--syntax-variable)',
      backgroundColor: 'color-mix(in oklab, var(--syntax-variable) 12%, transparent)',
      borderRadius: '4px',
      padding: '0 0.15rem',
    },
    '.cm-expr-var-unknown': {
      color: 'var(--syntax-unknown)',
      textDecoration: 'underline wavy var(--destructive)',
      textUnderlineOffset: '3px',
    },
    '.cm-doc': { padding: '0.25rem 0.5rem', maxWidth: '18rem', fontSize: '0.8125rem' },
    '.cm-doc-signature': {
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontWeight: '600',
    },
    '.cm-doc-description': { margin: '0.25rem 0' },
    '.cm-doc-label': { color: 'var(--muted-foreground)', fontSize: '0.75rem' },
    '.cm-doc-example': {
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      backgroundColor: 'var(--muted)',
      borderRadius: '4px',
      padding: '0 0.25rem',
    },
    '.cm-tooltip': {
      border: '1px solid var(--border)',
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      borderRadius: 'calc(var(--radius) - 2px)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
    '.cm-completionDetail': { marginLeft: '0.75rem', fontStyle: 'normal', opacity: '0.7' },
  });
}

// Ввод «{{» в шаблоне сам ставит «}}» и оставляет курсор между скобками
export const templateAutoClose: Extension = EditorView.inputHandler.of((view, from, to, text) => {
  // Ввод «}» перед уже стоящей «}» просто сдвигает курсор (иначе «{{|}}» + «name}}» дало бы «}}}}»)
  if (text === '}' && from === to && view.state.sliceDoc(from, from + 1) === '}') {
    view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'input.type' });
    return true;
  }
  if (text !== '{' || from !== to || from === 0) return false;
  if (view.state.sliceDoc(from - 1, from) !== '{') return false;
  // Уже «{{» перед курсором (третья скобка) или «}}» сразу после — не дублируем
  if (from >= 2 && view.state.sliceDoc(from - 2, from) === '{{') return false;
  if (view.state.sliceDoc(from, from + 2) === '}}') return false;
  view.dispatch({
    changes: { from, to, insert: '{}}' },
    selection: { anchor: from + 1 },
    userEvent: 'input.type',
  });
  return true;
});

// Однострочное поле: переводы строк в начальном значении заменяются пробелами
export function toSingleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ');
}

// Однострочное поле: Enter ничего не делает (перевод строки недопустим)
export const singleLineEnter: Extension = Prec.high(keymap.of([{ key: 'Enter', run: () => true }]));

// Отступ справа под кнопку «развернуть»
export const expandPadding: Extension = EditorView.theme({
  '.cm-scroller': { paddingRight: '1.75rem' },
});

// Однострочное поле: переводы строки во вставляемом тексте заменяются пробелами.
// Длина вставки сохраняется (CRLF считается одним переводом строки), поэтому выделение остаётся валидным
export const singleLineFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  let hasNewline = false;
  const changes: ChangeSpec[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.lines > 1) hasNewline = true;
    changes.push({ from: fromA, to: toA, insert: inserted.sliceString(0, undefined, ' ') });
  });
  if (!hasNewline) return tr;
  return {
    changes,
    selection: tr.selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
  };
});

// Плагин подсветки: функция возвращает размеченные диапазоны для всего документа
export function decorationPlugin(build: (doc: string) => Range<Decoration>[]): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = Decoration.set(build(view.state.doc.toString()), true);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = Decoration.set(build(update.state.doc.toString()), true);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

// Параметры базовой настройки @uiw/react-codemirror: без гуттеров и подсветки строки
export const baseSetup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  indentOnInput: false,
  closeBrackets: false,
} as const;
