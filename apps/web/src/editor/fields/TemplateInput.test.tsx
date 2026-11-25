import type { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView as CmView, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupCodeMirrorJsdom } from './cm-test-setup';
import { TemplateInput } from './TemplateInput';

beforeAll(() => {
  setupCodeMirrorJsdom();
});

describe('TemplateInput', () => {
  afterEach(() => {
    cleanup();
  });

  it('помечает неизвестную переменную подчёркиванием и подсказкой', () => {
    const { container } = render(
      <TemplateInput
        value="Привет, {{unknown_var}}!"
        onChange={vi.fn()}
        variables={['name']}
        envNames={[]}
      />,
    );

    const unknownPill = container.querySelector('.cm-template-var-unknown');
    expect(unknownPill).not.toBeNull();
    expect(unknownPill?.getAttribute('title')).toBe('переменная не задана выше по сценарию');
    expect(unknownPill?.textContent).toBe('{{unknown_var}}');
    expect(screen.getByText(/переменная не задана выше по сценарию/)).toBeTruthy();
  });

  it('подсвечивает известную переменную как таблетку без пометки ошибки', () => {
    const { container } = render(
      <TemplateInput
        value="Привет, {{name}}!"
        onChange={vi.fn()}
        variables={['name']}
        envNames={[]}
      />,
    );

    const pill = container.querySelector('.cm-template-pill');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('{{name}}');
    expect(container.querySelector('.cm-template-var-unknown')).toBeNull();
  });

  it('разрешает {{env.ИМЯ}} свободно при пустом envNames без пометки ошибки', () => {
    const { container } = render(
      <TemplateInput
        value="Ключ: {{env.API_KEY}}"
        onChange={vi.fn()}
        variables={[]}
        envNames={[]}
      />,
    );

    const pill = container.querySelector('.cm-template-pill');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('{{env.API_KEY}}');
    expect(container.querySelector('.cm-template-var-unknown')).toBeNull();
  });

  it('поддерживает многострочный режим и обновляет значение через view.dispatch', () => {
    const onChange = vi.fn();
    let editorView: EditorView | null = null;

    render(
      <TemplateInput
        value={'Строка 1\nСтрока 2'}
        onChange={onChange}
        variables={['name']}
        envNames={[]}
        multiline
        onCreateEditor={(view) => {
          editorView = view;
        }}
      />,
    );

    expect(editorView).not.toBeNull();
    expect(editorView!.state.doc.lines).toBe(2);

    act(() => {
      editorView!.dispatch({
        changes: { from: editorView!.state.doc.length, insert: ' {{name}}' },
      });
    });

    expect(onChange).toHaveBeenCalledWith('Строка 1\nСтрока 2 {{name}}');
  });

  it('подчёркивание обновляется при смене variables', () => {
    const props = { onChange: vi.fn(), envNames: [], value: 'Привет, {{name}}!' };
    const { container, rerender } = render(<TemplateInput {...props} variables={[]} />);
    expect(container.querySelector('.cm-template-var-unknown')).not.toBeNull();

    rerender(<TemplateInput {...props} variables={['name']} />);
    expect(container.querySelector('.cm-template-var-unknown')).toBeNull();
  });

  it('задаёт ARIA-атрибуты поля', () => {
    const { container } = render(
      <TemplateInput
        value=""
        onChange={vi.fn()}
        variables={[]}
        envNames={[]}
        ariaLabelledBy="lbl"
        multiline
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content.getAttribute('role')).toBe('textbox');
    expect(content.getAttribute('aria-labelledby')).toBe('lbl');
    expect(content.getAttribute('aria-multiline')).toBe('true');
  });

  // Имитация набора символа: вызываем обработчики ввода CodeMirror так же, как при вводе с клавиатуры
  function typeChar(view: EditorView, char: string): void {
    const { from, to } = view.state.selection.main;
    act(() => {
      const handled = view.state
        .facet(CmView.inputHandler)
        .some((handler) => handler(view, from, to, char, () => view.state.update({})));
      if (!handled) {
        view.dispatch({ changes: { from, to, insert: char }, selection: { anchor: from + 1 } });
      }
    });
  }

  it('ввод «{{» ставит «}}» и курсор между скобками', () => {
    let view: EditorView | null = null;
    render(
      <TemplateInput
        value="Привет, "
        onChange={vi.fn()}
        variables={['name']}
        envNames={[]}
        onCreateEditor={(v) => {
          view = v;
        }}
      />,
    );
    act(() => view!.dispatch({ selection: { anchor: 8 } }));
    typeChar(view!, '{');
    expect(view!.state.doc.toString()).toBe('Привет, {');
    typeChar(view!, '{');
    expect(view!.state.doc.toString()).toBe('Привет, {{}}');
    expect(view!.state.selection.main.head).toBe(10);
  });

  it('ввод «}» перед уже стоящей «}» сдвигает курсор, а не вставляет скобку', () => {
    let view: EditorView | null = null;
    render(
      <TemplateInput
        value="Привет, "
        onChange={vi.fn()}
        variables={['name']}
        envNames={[]}
        onCreateEditor={(v) => {
          view = v;
        }}
      />,
    );
    act(() => view!.dispatch({ selection: { anchor: 8 } }));
    typeChar(view!, '{');
    typeChar(view!, '{');
    for (const char of 'name') typeChar(view!, char);
    typeChar(view!, '}');
    typeChar(view!, '}');
    expect(view!.state.doc.toString()).toBe('Привет, {{name}}');
    expect(view!.state.selection.main.head).toBe(16);
  });

  it('Tab не обрабатывается редактором: фокус уходит из поля, отступ не ставится', () => {
    let view: EditorView | null = null;
    render(
      <TemplateInput
        value="a"
        onChange={vi.fn()}
        variables={[]}
        envNames={[]}
        multiline
        onCreateEditor={(v) => {
          view = v;
        }}
      />,
    );
    const handled = runScopeHandlers(
      view!,
      new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9 }),
      'editor',
    );
    expect(handled).toBe(false);
    expect(view!.state.doc.toString()).toBe('a');
  });

  it('значение с переводами строк в однострочном поле показывается с пробелами', () => {
    let view: EditorView | null = null;
    render(
      <TemplateInput
        value={'a\nb'}
        onChange={vi.fn()}
        variables={[]}
        envNames={[]}
        onCreateEditor={(v) => {
          view = v;
        }}
      />,
    );
    expect(view!.state.doc.toString()).toBe('a b');
  });

  it('фокус показывает «Результат» с подставленным тестовым значением', () => {
    const { container } = render(
      <TemplateInput
        value="Привет, {{name}}"
        onChange={vi.fn()}
        variables={['name']}
        envNames={[]}
        testValues={{ name: 'Аня' }}
      />,
    );
    expect(screen.queryByTestId('result-value')).toBeNull();
    fireEvent.focus(container.querySelector('.cm-content') as HTMLElement);
    expect(screen.getByTestId('result-value').textContent).toBe('Привет, Аня');
  });
});
