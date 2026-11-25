import type { ReactNode } from 'react';
import { Position, ReactFlowProvider, type Edge, type NodeProps } from '@xyflow/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { EditorActionsContext, type EditorActions } from '../actions';
import type { BlockNode as BlockNodeType } from '../convert';
import { BlockNode, SHAPE_RADIUS_CLASSES, nodeShapeOf } from './BlockNode';

// В jsdom у React Flow нет DOM-узла вьюпорта, и NodeToolbar ничего не рисует (портал в него),
// поэтому подменяем его обычной обёрткой: проверяем кнопки, а не позиционирование
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    NodeToolbar: ({ children, isVisible }: { children?: ReactNode; isVisible?: boolean }) =>
      isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
  };
});

function createActions(): EditorActions {
  return {
    openBlock: vi.fn(),
    addFromOutput: vi.fn(),
    insertOnEdge: vi.fn(),
    removeEdge: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
  };
}

function renderBlockNode(
  id: string,
  data: BlockNodeType['data'],
  options: { selected?: boolean; actions?: EditorActions; edges?: Edge[] } = {},
) {
  const actions = options.actions ?? createActions();
  const props: NodeProps<BlockNodeType> = {
    id,
    type: 'block',
    data,
    selected: options.selected ?? false,
    dragging: false,
    draggable: true,
    deletable: true,
    selectable: true,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };
  const result = render(
    <ReactFlowProvider initialEdges={options.edges}>
      <EditorActionsContext.Provider value={actions}>
        <BlockNode {...props} />
      </EditorActionsContext.Provider>
    </ReactFlowProvider>,
  );
  return { ...result, actions };
}

describe('BlockNode', () => {
  afterEach(() => {
    cleanup();
  });

  it('у ENTRY_POINT нет ручки входа и нет кнопок «Удалить» и «Дублировать»', () => {
    const { container } = renderBlockNode(
      'entry',
      { type: 'ENTRY_POINT', title: 'Старт' },
      { selected: true },
    );

    expect(container.querySelector('.react-flow__handle.target')).toBeNull();
    expect(container.querySelectorAll('.react-flow__handle.source')).toHaveLength(1);
    expect(container.querySelector('[data-block-shape="start"]')).toBeTruthy();

    expect(screen.queryByRole('button', { name: ru.editor.nodeActions.remove })).toBeNull();
    expect(screen.queryByRole('button', { name: ru.editor.nodeActions.duplicate })).toBeNull();
    expect(screen.getByRole('button', { name: ru.editor.nodeActions.configure })).toBeTruthy();
  });

  it('показывает значок с числом ошибок и подсвечивает неподключённый выход', () => {
    const { container } = renderBlockNode('txt', {
      type: 'TEXT_INPUT',
      title: 'Вопрос',
      question: 'Имя?',
      variableName: '1bad',
    } as BlockNodeType['data']);

    const badge = screen.getByTestId('block-issues');
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('title')).toBe(ru.validation.variableName);
    expect(container.querySelector('[data-unconnected="true"]')).toBeTruthy();
  });

  it('без ошибок значка нет', () => {
    renderBlockNode('exit', { type: 'EXIT_POINT', title: 'Конец' });
    expect(screen.queryByTestId('block-issues')).toBeNull();
  });

  it('у EXIT_POINT есть ручка входа слева и нет ручек выходов', () => {
    const { container } = renderBlockNode('exit', { type: 'EXIT_POINT', title: 'Конец' });

    const target = container.querySelector('.react-flow__handle.target');
    expect(target).toBeTruthy();
    expect(target?.className).toContain('left');
    expect(container.querySelectorAll('.react-flow__handle.source')).toHaveLength(0);
    expect(container.querySelector('[data-block-shape="finish"]')).toBeTruthy();
  });

  it('у OPTION_CHOICE с 3 вариантами рисует 3 ручки выходов с подписями и кнопки «+»', () => {
    const { container, actions } = renderBlockNode('opt_1', {
      type: 'OPTION_CHOICE',
      title: 'Выбор',
      question: 'Куда?',
      options: ['Запись', 'Отмена', 'Помощь'],
      variableName: 'choice',
    });

    expect(container.querySelector('.react-flow__handle.target')).toBeTruthy();
    const sources = container.querySelectorAll('.react-flow__handle.source');
    expect(sources).toHaveLength(3);
    expect(screen.getByText('Запись')).toBeTruthy();
    expect(screen.getByText('Отмена')).toBeTruthy();
    expect(screen.getByText('Помощь')).toBeTruthy();
    const talk = container.querySelector('[data-block-shape="talk"]');
    expect(talk).toBeTruthy();
    // Без хвостика: выступающих за контур элементов нет, форма узнаётся по значку-реплике
    expect(talk!.querySelector('.rotate-45, [class*="-bottom-"]')).toBeNull();
    expect(talk!.querySelector('[data-testid="talk-icon"]')).toBeTruthy();

    const addButtons = screen.getAllByRole('button', { name: ru.editor.addNextBlock });
    expect(addButtons).toHaveLength(3);
    fireEvent.click(addButtons[1]!);
    expect(actions.addFromOutput).toHaveBeenCalledWith('opt_1', 'Отмена');
  });

  it('перетаскивание «+» выхода передаёт mousedown на ручку и не вызывает повторный click', () => {
    const { container, actions } = renderBlockNode('opt_2', {
      type: 'TEXT_MESSAGE',
      title: 'Привет',
      text: 'Текст',
    });

    const sourceHandle = container.querySelector('.react-flow__handle.source')!;
    const handleMouseDown = vi.fn();
    sourceHandle.addEventListener('mousedown', handleMouseDown);

    const addButton = screen.getByRole('button', { name: ru.editor.addNextBlock });
    fireEvent.mouseDown(addButton, { button: 0, clientX: 100, clientY: 100 });
    expect(handleMouseDown).toHaveBeenCalledTimes(1);

    // Сдвиг > 4px подавляет click при отпускании
    fireEvent.mouseMove(window, { clientX: 160, clientY: 120 });
    fireEvent.mouseUp(window, { clientX: 160, clientY: 120 });
    fireEvent.click(addButton);
    expect(actions.addFromOutput).not.toHaveBeenCalled();
  });

  it('«+» скрыт у подключённого выхода и виден у свободного', () => {
    const data = {
      type: 'CONDITION',
      title: 'Условие',
      expression: 'x > 1',
    } as BlockNodeType['data'];
    renderBlockNode('c1', data, {
      edges: [{ id: 'e1', source: 'c1', sourceHandle: 'yes', target: 'next' }],
    });
    // Выходы «да» и «нет»: подключён один — остаётся одна кнопка «+»
    expect(screen.getAllByRole('button', { name: ru.editor.addNextBlock })).toHaveLength(1);
  });

  it('у HTTP-запроса одиночная рамка, пилюля метода и моноширинный URL', () => {
    const { container } = renderBlockNode('h1', {
      type: 'HTTP_REQUEST',
      title: 'API',
      method: 'POST',
      url: 'https://example.com/api/v1/slots',
      headers: [],
      body: '',
      variableName: 'res',
      errorVariable: 'err',
      timeoutSec: 10,
      retryCount: 0,
      retryIntervalSec: 1,
      errorStrategy: 'EXIT_ERROR',
      suspendText: null,
      responseMappings: [],
    });
    const shape = container.querySelector<HTMLElement>('[data-block-shape="integration"]')!;
    // Одиночная рамка без border-2 и без inset-двойной рамки
    expect(shape.className).toContain('border');
    expect(shape.className).not.toContain('border-2');
    expect(shape.className).not.toContain('shadow-[inset_');
    expect(shape.style.borderTopWidth).toBe('3px');
    // Ручки — потомки самого блока, без промежуточной обёртки с рамкой
    expect(shape.querySelectorAll('.react-flow__handle.source').length).toBeGreaterThan(0);
    expect(shape.querySelector(':scope > div.rounded-md.border')).toBeNull();

    const badge = screen.getByTestId('http-method-badge');
    expect(badge.textContent).toBe('POST');
    expect(badge.className).toContain('sky');
    const urlEl = screen.getByText('https://example.com/api/v1/slots');
    expect(urlEl.className).toContain('font-mono');
  });

  it('выделенный блок получает цветное свечение по цвету категории', () => {
    const { container } = renderBlockNode(
      'msg_sel',
      { type: 'TEXT_MESSAGE', title: 'Привет', text: 'Текст' },
      { selected: true },
    );
    const card = container.querySelector<HTMLElement>('[data-block-shape="talk"]')!;
    expect(card.style.boxShadow).toContain('0 0 0 1px');
  });

  it('меню выделенного блока вызывает «Дублировать» и «Удалить»', () => {
    const { actions } = renderBlockNode(
      'msg_1',
      { type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте' },
      { selected: true },
    );

    fireEvent.click(screen.getByRole('button', { name: ru.editor.nodeActions.duplicate }));
    expect(actions.duplicate).toHaveBeenCalledWith('msg_1');

    fireEvent.click(screen.getByRole('button', { name: ru.editor.nodeActions.remove }));
    expect(actions.remove).toHaveBeenCalledWith('msg_1');

    fireEvent.click(screen.getByRole('button', { name: ru.editor.nodeActions.configure }));
    expect(actions.openBlock).toHaveBeenCalledWith('msg_1');
  });

  it('назначает формы по категориям: развилка, компактная карточка и интеграция', () => {
    const { container: cond } = renderBlockNode('c1', {
      type: 'CONDITION',
      title: 'Условие',
      expression: 'x > 1',
    });
    expect(cond.querySelector('[data-block-shape="branch"]')).toBeTruthy();
    cleanup();

    const { container: assign } = renderBlockNode('a1', {
      type: 'ASSIGNMENT',
      title: 'Присвоить',
      variableName: 'x',
      expression: '1',
    });
    expect(assign.querySelector('[data-block-shape="compact"]')).toBeTruthy();
    cleanup();

    const { container: http } = renderBlockNode('h1', {
      type: 'HTTP_REQUEST',
      title: 'API',
      method: 'GET',
      url: 'https://example.com',
      headers: [],
      body: '',
      variableName: 'res',
      errorVariable: 'err',
      timeoutSec: 10,
      retryCount: 0,
      retryIntervalSec: 1,
      errorStrategy: 'EXIT_ERROR',
      suspendText: null,
      responseMappings: [],
    });
    expect(http.querySelector('[data-block-shape="integration"]')).toBeTruthy();
  });

  it('подбирает скругление подсветки превью по точной форме каждого типа блока', () => {
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('ENTRY_POINT')]).toBe('rounded-l-[48px] rounded-r-lg');
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('EXIT_POINT')]).toBe('rounded-r-[32px] rounded-l-lg');
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('TEXT_MESSAGE')]).toBe('rounded-2xl');
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('CONDITION')]).toBe('rounded-lg');
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('ASSIGNMENT')]).toBe('rounded-md');
    expect(SHAPE_RADIUS_CLASSES[nodeShapeOf('HTTP_REQUEST')]).toBe('rounded-lg');
  });
});
