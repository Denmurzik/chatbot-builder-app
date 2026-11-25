import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupCodeMirrorJsdom } from './cm-test-setup';
import { ExpressionEditorDialog } from './ExpressionEditorDialog';

beforeAll(() => {
  setupCodeMirrorJsdom();
});

function Harness({ initial, mode }: { initial: string; mode: 'expression' | 'template' }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <output data-testid="field">{value}</output>
      <ExpressionEditorDialog
        open={open}
        onOpenChange={setOpen}
        mode={mode}
        value={value}
        onChange={setValue}
        variables={['tries', 'name']}
        envNames={[]}
        testValues={{ tries: '1' }}
        sources={{ tries: 'Счётчик' }}
        resultKind="value"
      />
      <span data-testid="open">{String(open)}</span>
    </div>
  );
}

function editorView(): EditorView {
  const dom = document.querySelector('.cm-editor') as HTMLElement;
  return EditorView.findFromDOM(dom)!;
}

describe('ExpressionEditorDialog', () => {
  afterEach(cleanup);

  it('клик по переменной вставляет её в позицию курсора', () => {
    render(<Harness initial="a < 3" mode="expression" />);
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: /tries/ }));
    expect(view.state.doc.toString()).toBe('atries < 3');
    expect(screen.getByTestId('field').textContent).toBe('atries < 3');
  });

  it('в шаблоне вставляет {{имя}}', () => {
    render(<Harness initial="Привет, " mode="template" />);
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    fireEvent.click(screen.getByRole('button', { name: /name/ }));
    expect(view.state.doc.toString()).toBe('Привет, {{name}}');
  });

  it('поиск фильтрует переменные', () => {
    render(<Harness initial="" mode="expression" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nam' } });
    expect(screen.queryByRole('button', { name: /tries/ })).toBeNull();
    expect(screen.getByRole('button', { name: /name/ })).toBeTruthy();
  });

  it('справа показан результат, закрытие сохраняет текст в поле', () => {
    render(<Harness initial="tries < 3" mode="expression" />);
    expect(screen.getByTestId('result-value').textContent).toBe('да');
    const view = editorView();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' && true' } }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByTestId('field').textContent).toBe('tries < 3 && true');
  });
});
