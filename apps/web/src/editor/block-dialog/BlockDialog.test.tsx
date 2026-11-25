import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Edge } from '@xyflow/react';
import { EditorView } from '@codemirror/view';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { scenarioToFlow, type BlockNode, type BlockNodeData } from '../convert';
import { setupCodeMirrorJsdom } from '../fields/cm-test-setup';
import { BlockDialog } from './BlockDialog';

beforeAll(() => {
  setupCodeMirrorJsdom();
  // Radix Select в jsdom: нет захвата указателя и прокрутки к элементу
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// Выбор пункта в выпадающем списке shadcn: открыть с клавиатуры и кликнуть по пункту
async function choose(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
afterEach(cleanup);

const flow = scenarioToFlow({
  formatVersion: 1,
  blocks: [
    { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    {
      id: 'ask',
      type: 'TEXT_INPUT',
      title: 'Ввод имени',
      question: 'Как вас зовут?',
      variableName: 'name',
      x: 200,
      y: 0,
    },
    {
      id: 'cond',
      type: 'CONDITION',
      title: 'Это Анна?',
      expression: 'name == "Анна"',
      x: 400,
      y: 0,
    },
    { id: 'yes', type: 'TEXT_MESSAGE', title: 'Привет, Анна', text: 'Привет!', x: 600, y: 0 },
    {
      id: 'msg',
      type: 'TEXT_MESSAGE',
      title: 'Приветствие',
      text: 'Здравствуйте, {{name}}!',
      x: 600,
      y: 100,
    },
  ],
  transitions: [
    { source: { blockId: 'entry', output: 'default' }, target: 'ask' },
    { source: { blockId: 'ask', output: 'default' }, target: 'cond' },
    { source: { blockId: 'cond', output: 'yes' }, target: 'yes' },
    { source: { blockId: 'ask', output: 'default' }, target: 'msg' },
  ],
});

interface HarnessProps {
  nodeId: string;
  onClose?: () => void;
  onChangeSpy?: (id: string, data: BlockNodeData) => void;
  edges?: Edge[];
  focusTitle?: boolean;
}

// Состояние узлов хранит обвязка — как EditorPage: изменения применяются сразу
function Harness({
  nodeId,
  onClose = () => {},
  onChangeSpy,
  edges = flow.edges,
  focusTitle,
}: HarnessProps) {
  const [nodes, setNodes] = useState<BlockNode[]>(flow.nodes);
  return (
    <BlockDialog
      nodeId={nodeId}
      nodes={nodes}
      edges={edges}
      focusTitle={focusTitle}
      onClose={onClose}
      onChange={(id, data) => {
        onChangeSpy?.(id, data);
        setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data } : n)));
      }}
    />
  );
}

describe('BlockDialog', () => {
  it('колонка «Вход» показывает переменные блоков выше по графу с источником', () => {
    render(<Harness nodeId="cond" />);
    const input = screen.getByRole('region', { name: ru.blockDialog.input });
    expect(within(input).getByText('name')).toBeTruthy();
    expect(within(input).getByText('из блока «Ввод имени»')).toBeTruthy();
  });

  it('у первого блока после «Старта» в колонке «Вход» переменных нет', () => {
    render(<Harness nodeId="ask" />);
    const input = screen.getByRole('region', { name: ru.blockDialog.input });
    expect(within(input).getByText(ru.blockDialog.inputEmpty)).toBeTruthy();
  });

  it('«Выход» для Условия с тестовыми значениями показывает сработавший выход «Да»', () => {
    render(<Harness nodeId="cond" />);
    const input = screen.getByRole('region', { name: ru.blockDialog.input });
    fireEvent.change(within(input).getByLabelText(/Тестовое значение: name/), {
      target: { value: 'Анна' },
    });
    const output = screen.getByRole('region', { name: ru.blockDialog.output });
    expect(within(output).getByText('Сработает выход: Да')).toBeTruthy();

    fireEvent.change(within(input).getByLabelText(/Тестовое значение: name/), {
      target: { value: 'Борис' },
    });
    expect(within(output).getByText('Сработает выход: Нет')).toBeTruthy();
  });

  it('«Выход» показывает записываемые переменные и блоки, куда ведут связи', () => {
    render(<Harness nodeId="cond" />);
    const output = screen.getByRole('region', { name: ru.blockDialog.output });
    expect(within(output).getByText('ведёт в «Привет, Анна»')).toBeTruthy();
    // Выход «Нет» не подключён
    expect(within(output).getByText(ru.blockDialog.notConnected)).toBeTruthy();
    expect(within(output).getByText(ru.blockDialog.writesNone)).toBeTruthy();
  });

  it('«Выход» сообщения показывает текст после подстановки тестовых значений', () => {
    render(<Harness nodeId="msg" />);
    fireEvent.change(screen.getByLabelText(/Тестовое значение: name/), {
      target: { value: 'Анна' },
    });
    const output = screen.getByRole('region', { name: ru.blockDialog.output });
    expect(within(output).getByText('Здравствуйте, Анна!')).toBeTruthy();
  });

  it('название блока правится в заголовке окна и применяется сразу', () => {
    const spy = vi.fn();
    render(<Harness nodeId="ask" onChangeSpy={spy} />);
    fireEvent.change(screen.getByLabelText(ru.blockDialog.titleLabel), {
      target: { value: 'Имя клиента' },
    });
    expect(spy).toHaveBeenCalledWith('ask', expect.objectContaining({ title: 'Имя клиента' }));
    expect((screen.getByLabelText(ru.blockDialog.titleLabel) as HTMLInputElement).value).toBe(
      'Имя клиента',
    );
  });

  it('при «Переименовать» фокус сразу в названии, текст выделен', async () => {
    render(<Harness nodeId="ask" focusTitle />);
    const title = screen.getByLabelText(ru.blockDialog.titleLabel) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.selectionStart).toBe(0);
    expect(title.selectionEnd).toBe(title.value.length);
  });

  it('Esc закрывает окно', () => {
    const onClose = vi.fn();
    render(<Harness nodeId="ask" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc при открытом списке подсказок закрывает только список', async () => {
    const onClose = vi.fn();
    render(<Harness nodeId="msg" onClose={onClose} />);
    const content = screen.getByLabelText(ru.fields.text);
    const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement)!;
    view.focus();
    // Ввод «{{» открывает список переменных
    view.dispatch({
      changes: { from: 0, insert: '{{' },
      selection: { anchor: 2 },
      userEvent: 'input.type',
    });
    await waitFor(() => expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeNull());

    fireEvent.keyDown(content, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(document.querySelector('.cm-tooltip-autocomplete')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(content, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onClose).toHaveBeenCalled();
  });

  it('«Результат» в поле настроек использует тестовые значения из колонки «Вход»', () => {
    render(<Harness nodeId="msg" />);
    fireEvent.change(screen.getByLabelText(/Тестовое значение: name/), {
      target: { value: 'Анна' },
    });
    fireEvent.focus(screen.getByLabelText(ru.fields.text));
    expect(screen.getByTestId('result-value').textContent).toBe('Здравствуйте, Анна!');
  });

  it('Esc закрывает только большой редактор поля, окно блока остаётся, фокус — на «развернуть»', async () => {
    const onClose = vi.fn();
    render(<Harness nodeId="msg" onClose={onClose} />);
    const settings = screen.getByRole('region', { name: ru.blockDialog.settings });
    const expand = within(settings).getAllByRole('button', { name: ru.fieldInput.expand })[0];
    expand.focus();
    fireEvent.click(expand);
    // Большой редактор — единственное окно поверх окна блока (его заголовок — подпись поля)
    const big = await screen.findByRole('dialog', { name: ru.fields.text }, { timeout: 5000 });
    expect(big).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ru.fields.text })).toBeNull(), {
      timeout: 5000,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Приветствие', hidden: true })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(expand));
  });

  it('расширения CodeMirror не пересоздаются при несвязанном изменении узлов', () => {
    render(<Harness nodeId="msg" />);
    const content = screen.getByLabelText(ru.fields.text);
    const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement)!;
    const spy = vi.spyOn(view, 'dispatch');
    // Название блока меняет узлы, но не переменные и не их источники
    fireEvent.change(screen.getByLabelText(ru.blockDialog.titleLabel), {
      target: { value: 'Другое название' },
    });
    const reconfigured = spy.mock.calls.some((call) => {
      const spec = call[0] as { effects?: unknown } | undefined;
      return spec !== undefined && typeof spec === 'object' && spec.effects !== undefined;
    });
    expect(reconfigured).toBe(false);
  });

  it('«Вставить» ставит переменную в шаблон по позиции курсора', async () => {
    render(<Harness nodeId="msg" />);
    const editor = screen.getByLabelText(ru.fields.text);
    editor.focus();
    fireEvent.focusIn(editor);
    const insert = screen.getByRole('button', { name: `${ru.blockDialog.insert} name` });
    await waitFor(() => expect((insert as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(insert);
    await waitFor(() =>
      expect(screen.getByLabelText(ru.fields.text).textContent).toContain('{{name}}'),
    );
  });

  it('«Вставить» недоступна, пока курсор не поставлен в поле настроек', () => {
    render(<Harness nodeId="msg" />);
    const insert = screen.getByRole('button', { name: `${ru.blockDialog.insert} name` });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Вставить» идёт в последнее поле: обычное поле сбрасывает цель и не меняет другие поля', async () => {
    render(<Harness nodeId="msg" />);
    const editor = screen.getByLabelText(ru.fields.text);
    editor.focus();
    fireEvent.focusIn(editor);
    const insert = screen.getByRole('button', { name: `${ru.blockDialog.insert} name` });
    await waitFor(() => expect((insert as HTMLButtonElement).disabled).toBe(false));

    const title = screen.getByLabelText(ru.blockDialog.titleLabel);
    fireEvent.focus(title);
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(insert);
    expect(screen.getByLabelText(ru.fields.text).textContent).toBe('Здравствуйте, {{name}}!');
    expect((title as HTMLInputElement).value).toBe('Приветствие');
  });

  describe('конструктор условий', () => {
    it('показывает строки из выражения и пересобирает выражение при правке', async () => {
      const spy = vi.fn();
      render(<Harness nodeId="cond" onChangeSpy={spy} />);
      expect((screen.getByLabelText('Переменная 1') as HTMLInputElement).value).toBe('name');
      expect((screen.getByLabelText('Значение 1') as HTMLInputElement).value).toBe('Анна');

      fireEvent.change(screen.getByLabelText('Значение 1'), { target: { value: 'Ольга' } });
      expect(spy).toHaveBeenLastCalledWith(
        'cond',
        expect.objectContaining({ expression: 'name == "Ольга"' }),
      );

      fireEvent.click(screen.getByRole('button', { name: ru.condition.add }));
      fireEvent.change(screen.getByLabelText('Переменная 2'), { target: { value: 'name' } });
      await choose('Оператор 2', ru.condition.operators.notEmpty);
      await choose(ru.condition.join, ru.condition.any);
      expect(spy).toHaveBeenLastCalledWith(
        'cond',
        expect.objectContaining({ expression: 'name == "Ольга" || name != ""' }),
      );
    });

    it('предупреждает о переменной, которой нет выше по сценарию', async () => {
      render(<Harness nodeId="cond" />);
      fireEvent.change(screen.getByLabelText('Переменная 1'), { target: { value: 'ghost' } });
      expect(screen.getByText(ru.condition.unknownVariable('ghost'))).toBeTruthy();
      await choose('Оператор 1', ru.condition.operators.empty);
      expect(screen.getByText(ru.condition.unknownVariable('ghost'))).toBeTruthy();
    });

    it('выражение вне конструктора открывается в режиме «Выражение», текст сохраняется', () => {
      const complex = { ...flow.nodes[2]!.data, expression: '(a < 3) && !b' } as BlockNodeData;
      const nodes = flow.nodes.map((n) => (n.id === 'cond' ? { ...n, data: complex } : n));
      render(
        <BlockDialog
          nodeId="cond"
          nodes={nodes}
          edges={flow.edges}
          onChange={() => {}}
          onClose={() => {}}
        />,
      );
      expect(screen.queryByLabelText('Переменная 1')).toBeNull();
      expect(screen.getByLabelText(ru.fields.expression).textContent).toBe('(a < 3) && !b');
      const builder = screen.getByRole('button', { name: ru.condition.builder });
      expect((builder as HTMLButtonElement).disabled).toBe(true);
    });

    it('переключатель «Выражение» показывает текст, «Конструктор» возвращает строки', () => {
      render(<Harness nodeId="cond" />);
      fireEvent.click(screen.getByRole('button', { name: ru.condition.expression }));
      expect(screen.queryByLabelText('Переменная 1')).toBeNull();
      expect(screen.getByLabelText(ru.fields.expression).textContent).toBe('name == "Анна"');
      fireEvent.click(screen.getByRole('button', { name: ru.condition.builder }));
      expect((screen.getByLabelText('Переменная 1') as HTMLInputElement).value).toBe('name');
    });

    it('«Вставить» после правок строк не теряет значение и добавленную строку', () => {
      const spy = vi.fn();
      render(<Harness nodeId="cond" onChangeSpy={spy} />);
      const variable = screen.getByLabelText('Переменная 1');
      fireEvent.change(variable, { target: { value: 'zzz' } });
      fireEvent.focus(variable);
      fireEvent.change(screen.getByLabelText('Значение 1'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: ru.condition.add }));
      fireEvent.click(screen.getByRole('button', { name: `${ru.blockDialog.insert} name` }));

      expect((screen.getByLabelText('Переменная 1') as HTMLInputElement).value).toBe('name');
      expect((screen.getByLabelText('Значение 1') as HTMLInputElement).value).toBe('5');
      expect(screen.getAllByTestId('condition-row')).toHaveLength(2);
      expect(spy).toHaveBeenLastCalledWith(
        'cond',
        expect.objectContaining({ expression: 'name == 5' }),
      );
    });

    it('«Вставить» в поле значения вставляет имя в позицию курсора', () => {
      render(<Harness nodeId="cond" />);
      const value = screen.getByLabelText('Значение 1') as HTMLInputElement;
      fireEvent.focus(value);
      value.setSelectionRange(1, 1);
      fireEvent.click(screen.getByRole('button', { name: `${ru.blockDialog.insert} name` }));
      expect(value.value).toBe('Аnameнна');
    });

    it('список операторов — shadcn Select с группами «Сравнение / Числа / Пустота»', async () => {
      render(<Harness nodeId="cond" />);
      expect(document.querySelector('select')).toBeNull();
      const trigger = screen.getByRole('combobox', { name: 'Оператор 1' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });
      const listbox = await screen.findByRole('listbox');
      for (const label of Object.values(ru.condition.groups)) {
        expect(within(listbox).getByText(label)).toBeTruthy();
      }
    });

    it('сравнение чисел с нечисловым значением предупреждает о строковом сравнении', async () => {
      render(<Harness nodeId="cond" />);
      expect(screen.queryByText(ru.condition.stringCompare)).toBeNull();
      await choose('Оператор 1', ru.condition.operators.gt);
      // значение «Анна» — не число
      expect(screen.getByText(ru.condition.stringCompare)).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Значение 1'), { target: { value: '5' } });
      expect(screen.queryByText(ru.condition.stringCompare)).toBeNull();
    });

    it('удаление строки не сдвигает чужие значения, а её цель «Вставить» сбрасывается', () => {
      render(<Harness nodeId="cond" />);
      fireEvent.click(screen.getByRole('button', { name: ru.condition.add }));
      fireEvent.change(screen.getByLabelText('Переменная 2'), { target: { value: 'second' } });
      const firstVariable = screen.getByLabelText('Переменная 1');
      fireEvent.focus(firstVariable);
      fireEvent.click(screen.getAllByRole('button', { name: ru.condition.remove })[0]!);

      expect(screen.getAllByTestId('condition-row')).toHaveLength(1);
      expect((screen.getByLabelText('Переменная 1') as HTMLInputElement).value).toBe('second');
      // Цель удалённой строки сброшена: «Вставить» недоступна
      expect(
        (screen.getByRole('button', { name: `${ru.blockDialog.insert} name` }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it('показывает ошибку выражения, собранного конструктором', () => {
      render(<Harness nodeId="cond" />);
      fireEvent.change(screen.getByLabelText('Переменная 1'), { target: { value: 'a b' } });
      expect(screen.getByText(/Ошибка в выражении/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Переменная 1'), { target: { value: '' } });
      expect(screen.getByText(ru.validation.expressionEmpty)).toBeTruthy();
    });

    it('при внешней смене выражения (отмена) конструктор пересобирается', () => {
      const node = flow.nodes.find((n) => n.id === 'cond')!;
      const view = (expression: string) => (
        <BlockDialog
          nodeId="cond"
          nodes={flow.nodes.map((n) =>
            n.id === 'cond' ? { ...n, data: { ...node.data, expression } as BlockNodeData } : n,
          )}
          edges={flow.edges}
          onChange={() => {}}
          onClose={() => {}}
        />
      );
      const { rerender } = render(view('name == "Анна"'));
      rerender(view('age >= 18 || name != ""'));
      expect((screen.getByLabelText('Переменная 1') as HTMLInputElement).value).toBe('age');
      expect((screen.getByLabelText('Переменная 2') as HTMLInputElement).value).toBe('name');
      rerender(view('(a < 3) && !b'));
      expect(screen.queryByLabelText('Переменная 1')).toBeNull();
    });
  });

  it('на мобильном экране переключает вкладки «Настройки / Вход / Выход» (по умолчанию «Настройки»)', () => {
    render(<Harness nodeId="msg" />);
    const settingsTab = screen.getByRole('tab', { name: ru.blockDialog.settings });
    const inputTab = screen.getByRole('tab', { name: ru.blockDialog.input });
    const outputTab = screen.getByRole('tab', { name: ru.blockDialog.output });

    expect(settingsTab.getAttribute('aria-selected')).toBe('true');
    expect(inputTab.getAttribute('aria-selected')).toBe('false');
    expect(outputTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(inputTab);
    expect(inputTab.getAttribute('aria-selected')).toBe('true');
    expect(settingsTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(outputTab);
    expect(outputTab.getAttribute('aria-selected')).toBe('true');
    expect(inputTab.getAttribute('aria-selected')).toBe('false');
  });
});
