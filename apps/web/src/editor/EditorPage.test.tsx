import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyScenario, scenarioSchema, type Scenario } from '@chatbot/model';
import { ru } from '@/i18n/ru';
import { createQueryClient } from '@/app/queryClient';
import { EditorPage } from './EditorPage';
import { setupCodeMirrorJsdom } from './fields/cm-test-setup';
import { BLOCK_DRAG_MIME } from './picker/NodePicker';

// jsdom не содержит ResizeObserver и DOMMatrixReadOnly, нужных React Flow
beforeEach(() => {
  setupCodeMirrorJsdom();
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
      constructor(_transform?: string) {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      // С включённым измерением сообщаем React Flow, что элемент появился: тогда рисуются связи
      observe(target: Element) {
        if (measureNodes) {
          this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

// Включается в тестах, которым нужны отрисованные связи (jsdom размеров не считает)
let measureNodes = false;

// У всех элементов — прямоугольник 100×50, чтобы у блоков и их выходов были границы
function stubLayout() {
  measureNodes = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
    width: 100,
    height: 50,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
}

// GET проекта отдаёт пустой сценарий, PUT сценария — успех
function stubFetch(scenario: Scenario = emptyScenario()) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ updatedAt: '2026-01-02T00:00:00Z' }), { status: 200 })
        : new Response(
            JSON.stringify({
              id: 'p1',
              name: 'Запись к врачу',
              scenario,
              updatedAt: '2026-01-01T00:00:00Z',
            }),
            { status: 200 },
          ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// useBlocker требует роутер с данными
function renderEditor() {
  const router = createMemoryRouter([{ path: '/projects/:id', element: <EditorPage /> }], {
    initialEntries: ['/projects/p1'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('EditorPage', () => {
  afterEach(() => {
    cleanup();
    measureNodes = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('отрисовывает холст и загруженный блок', async () => {
    stubFetch();
    renderEditor();

    expect(await screen.findByRole('heading', { level: 1, name: 'Запись к врачу' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Сохранить/ })).toBeTruthy();
    // Постоянной левой панели блоков нет
    expect(screen.queryByLabelText('Блоки')).toBeNull();
    // Правой панели свойств нет: настройки открываются окном блока
    expect(screen.queryByLabelText('Свойства блока')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Старт')).toBeTruthy();
  });

  it('Ctrl+S по code KeyS (русская раскладка, key «ы») сохраняет сценарий', async () => {
    const fetchMock = stubFetch();
    renderEditor();
    await screen.findByRole('button', { name: /Сохранить/ });

    fireEvent.keyDown(window, { key: 'ы', code: 'KeyS', ctrlKey: true });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/projects/p1/scenario' && init?.method === 'PUT',
        ),
      ).toBe(true),
    );
  });

  describe('меню блока', () => {
    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 100, y: 60 },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
    };

    // Сохраняем сценарий по Ctrl+S и возвращаем отправленное тело
    async function savedScenario(fetchMock: ReturnType<typeof stubFetch>): Promise<Scenario> {
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
      );
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
      return JSON.parse(String(call[1]!.body)) as Scenario;
    }

    it('Ctrl+Z (code KeyZ) отменяет дублирование, Ctrl+Y возвращает, поля ввода не затрагиваются', async () => {
      stubFetch(scenario);
      renderEditor();
      fireEvent.click(await screen.findByText('Привет'));
      fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));
      expect(document.querySelectorAll('.react-flow__node')).toHaveLength(3);

      // Событие из поля ввода граф не трогает
      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key: 'я', code: 'KeyZ', ctrlKey: true });
      expect(document.querySelectorAll('.react-flow__node')).toHaveLength(3);
      input.remove();

      fireEvent.keyDown(window, { key: 'я', code: 'KeyZ', ctrlKey: true });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(2));
      // Отмена помечает сценарий изменённым
      expect(screen.getByText(ru.editor.unsaved)).toBeTruthy();

      fireEvent.keyDown(window, { key: 'н', code: 'KeyY', ctrlKey: true });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(3));
      fireEvent.keyDown(window, { key: 'я', code: 'KeyZ', ctrlKey: true });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(2));
      fireEvent.keyDown(window, { key: 'я', code: 'KeyZ', ctrlKey: true, shiftKey: true });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(3));
    });

    it('«Дублировать» создаёт копию с новым id, сдвигом 40 по сетке, без связей и выделяет её', async () => {
      const fetchMock = stubFetch(scenario);
      renderEditor();
      fireEvent.click(await screen.findByText('Привет'));

      fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));

      const saved = await savedScenario(fetchMock);
      expect(saved.blocks).toHaveLength(3);
      const copy = saved.blocks.find((b) => b.id !== 'entry' && b.id !== 'msg_1')!;
      expect(copy.type).toBe('TEXT_MESSAGE');
      expect(copy.x).toBe(140);
      expect(copy.y).toBe(100);
      expect(copy.x % 20).toBe(0);
      expect(copy.y % 20).toBe(0);
      // Связей столько же: у копии их нет
      expect(saved.transitions).toHaveLength(1);
      // Выделена только копия
      const selected = document.querySelectorAll('.react-flow__node.selected');
      expect(selected).toHaveLength(1);
      expect(selected[0]!.getAttribute('data-id')).toBe(copy.id);
    });

    it('у «Точки входа» нет «Дублировать» и «Удалить»: сценарий не меняется', async () => {
      const fetchMock = stubFetch(scenario);
      renderEditor();
      fireEvent.click(await screen.findByText('Старт'));

      await screen.findByRole('button', { name: ru.editor.nodeActions.configure });
      expect(screen.queryByRole('button', { name: ru.editor.nodeActions.duplicate })).toBeNull();
      expect(screen.queryByRole('button', { name: ru.editor.nodeActions.remove })).toBeNull();

      const saved = await savedScenario(fetchMock);
      expect(saved.blocks).toHaveLength(2);
      expect(saved.transitions).toHaveLength(1);
    });
  });
  describe('добавление блоков', () => {
    const chain: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 0 },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
    };

    async function savedScenario(fetchMock: ReturnType<typeof stubFetch>): Promise<Scenario> {
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
      );
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
      return JSON.parse(String(call[1]!.body)) as Scenario;
    }

    it('панель «Что дальше?» закрыта по умолчанию и открывается кнопкой «+» холста, Esc закрывает', async () => {
      stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');
      expect(screen.queryByTestId('node-picker')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: ru.editor.addBlock }));
      expect(await screen.findByText(ru.editor.picker.title)).toBeTruthy();
      // «Точку входа» не предлагаем никогда
      expect(screen.queryByRole('button', { name: /^Точка входа/ })).toBeNull();
      expect(screen.getByRole('button', { name: /^Точка выхода/ })).toBeTruthy();

      fireEvent.keyDown(screen.getByTestId('node-picker'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('node-picker')).toBeNull());
    });

    it('«+» неподключённого выхода добавляет блок и связь от этого выхода', async () => {
      const fetchMock = stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');

      // Единственный неподключённый выход — «Далее» у «Привет»
      fireEvent.click(await screen.findByLabelText(ru.editor.addNextBlock));
      fireEvent.click(await screen.findByRole('button', { name: /^Сообщение/ }));
      await waitFor(() => expect(screen.queryByTestId('node-picker')).toBeNull());

      const saved = await savedScenario(fetchMock);
      expect(saved.blocks).toHaveLength(3);
      const created = saved.blocks.find((b) => b.id !== 'entry' && b.id !== 'msg_1')!;
      expect(created.x).toBeGreaterThan(400);
      expect(saved.transitions).toContainEqual({
        source: { blockId: 'msg_1', output: 'default' },
        target: created.id,
      });
      expect(saved.transitions).toHaveLength(2);
    });

    it('drop из панели создаёт блок в точке отпускания по сетке', async () => {
      const fetchMock = stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');

      // jsdom не знает DragEvent: координаты и dataTransfer задаём на событии вручную
      const drop = createEvent.drop(screen.getByTestId('canvas'));
      Object.defineProperties(drop, {
        clientX: { value: 205 },
        clientY: { value: 318 },
        dataTransfer: {
          value: { getData: (mime: string) => (mime === BLOCK_DRAG_MIME ? 'TEXT_INPUT' : '') },
        },
      });
      fireEvent(screen.getByTestId('canvas'), drop);

      const saved = await savedScenario(fetchMock);
      const created = saved.blocks.find((b) => b.type === 'TEXT_INPUT')!;
      expect([created.x, created.y]).toEqual([200, 320]);
      expect(saved.transitions).toHaveLength(1);
    });

    it('в пустом сценарии: оверлей «С чего начнём?», затем карточка первого шага, исчезающая после добавления блока', async () => {
      const fetchMock = stubFetch();
      renderEditor();
      await screen.findByText('Старт');
      expect(screen.getByText(ru.editor.onboarding.welcomeTitle)).toBeTruthy();

      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(ru.editor.onboarding.welcomeEmpty) }),
      );
      expect(screen.queryByText(ru.editor.onboarding.welcomeTitle)).toBeNull();
      const card = await screen.findByRole('button', {
        name: new RegExp(ru.editor.onboarding.firstStep),
      });

      // Клик открывает панель; связь со «Старт» создаётся сама
      fireEvent.click(card);
      fireEvent.click(await screen.findByRole('button', { name: /^Сообщение/ }));
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: new RegExp(ru.editor.onboarding.firstStep) }),
        ).toBeNull(),
      );
      const saved = await savedScenario(fetchMock);
      expect(saved.blocks).toHaveLength(2);
      expect(saved.transitions[0]!.source).toEqual({ blockId: 'entry', output: 'default' });
    });

    it('карточка первого шага принимает клики: pointer-events-auto, nodrag, nopan; клик открывает «Что дальше?»', async () => {
      stubFetch();
      renderEditor();
      await screen.findByText('Старт');
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(ru.editor.onboarding.welcomeEmpty) }),
      );
      const card = await screen.findByRole('button', {
        name: new RegExp(ru.editor.onboarding.firstStep),
      });
      for (const cls of ['pointer-events-auto', 'nodrag', 'nopan']) {
        expect(card.classList.contains(cls)).toBe(true);
      }
      fireEvent.click(card);
      expect(await screen.findByText(ru.editor.picker.title)).toBeTruthy();
    });

    it('Tab открывает панель только с body или холста, не с кнопки и не под приветствием', async () => {
      stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');

      // Фокус на кнопке: Tab остаётся обычным переходом
      const button = screen.getByRole('button', { name: ru.editor.addBlock });
      button.focus();
      fireEvent.keyDown(button, { key: 'Tab', code: 'Tab' });
      expect(screen.queryByTestId('node-picker')).toBeNull();

      // Фокус на фоне холста: панель открывается
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' });
      expect(await screen.findByTestId('node-picker')).toBeTruthy();
    });

    it('Tab не открывает панель под оверлеем приветствия', async () => {
      stubFetch();
      renderEditor();
      await screen.findByText(ru.editor.onboarding.welcomeTitle);
      fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' });
      expect(screen.queryByTestId('node-picker')).toBeNull();
    });

    it('«+» холста ставит блок на свободное место, а не поверх существующего', async () => {
      const fetchMock = stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');
      // Блоки без размеров в jsdom считаются 320×160; центр вида — (0, 0) по умолчанию
      fireEvent.click(screen.getByRole('button', { name: ru.editor.addBlock }));
      fireEvent.click(await screen.findByRole('button', { name: /^Сообщение/ }));
      await waitFor(() => expect(screen.queryByTestId('node-picker')).toBeNull());

      const saved = await savedScenario(fetchMock);
      const created = saved.blocks.find((b) => b.id !== 'entry' && b.id !== 'msg_1')!;
      const overlaps = saved.blocks
        .filter((b) => b.id !== created.id)
        .some(
          (b) =>
            created.x < b.x + 320 &&
            b.x < created.x + 320 &&
            created.y < b.y + 160 &&
            b.y < created.y + 160,
        );
      expect(overlaps).toBe(false);
    });

    it('сохранение отправляет данные, очищенные схемой', async () => {
      const fetchMock = stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');
      const saved = await savedScenario(fetchMock);
      expect(saved).toEqual(scenarioSchema.parse(saved));
    });

    it('шаблон «Запись к врачу» заменяет пустой сценарий', async () => {
      const fetchMock = stubFetch();
      renderEditor();
      await screen.findByText('Старт');

      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(ru.editor.onboarding.welcomeTemplate) }),
      );
      const saved = await savedScenario(fetchMock);
      expect(saved.blocks.length).toBeGreaterThan(2);
      expect(saved.transitions.length).toBeGreaterThan(2);
    });
  });

  describe('связи', () => {
    const chain: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 0 },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
    };

    it('корзина на связи удаляет её с первого клика, Ctrl+Z возвращает', async () => {
      stubLayout();
      stubFetch(chain);
      renderEditor();
      await screen.findByText('Привет');
      const edge = await waitFor(() => {
        const found = document.querySelector('.react-flow__edge');
        if (!found) throw new Error('связь ещё не отрисована');
        return found;
      });

      fireEvent.mouseEnter(edge.querySelector('g') ?? edge);
      fireEvent.click(await screen.findByRole('button', { name: ru.editor.deleteEdge }));
      await waitFor(() => expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(0));
      expect(screen.getByText(ru.editor.unsaved)).toBeTruthy();

      fireEvent.keyDown(window, { key: 'я', code: 'KeyZ', ctrlKey: true });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(1));
    });
  });

  describe('сдвиг блока стрелками', () => {
    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 0 },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
    };

    it('серия нажатий — один шаг истории: одна отмена возвращает блок', async () => {
      stubLayout();
      const fetchMock = stubFetch(scenario);
      renderEditor();
      fireEvent.click(await screen.findByText('Привет'));
      const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="msg_1"]')!;
      node.focus();
      for (let i = 0; i < 3; i += 1)
        fireEvent.keyDown(node, { key: 'ArrowRight', code: 'ArrowRight' });
      await waitFor(() => expect(screen.getByText(ru.editor.unsaved)).toBeTruthy());

      fireEvent.keyDown(window, { key: 'я', code: 'KeyZ', ctrlKey: true });
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
      );
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
      const saved = JSON.parse(String(call[1]!.body)) as Scenario;
      expect(saved.blocks.find((b) => b.id === 'msg_1')!.x).toBe(400);
    });
  });

  describe('окно блока', () => {
    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 0 },
      ],
      transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
    };

    async function savedScenario(fetchMock: ReturnType<typeof stubFetch>): Promise<Scenario> {
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
      );
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
      return JSON.parse(String(call[1]!.body)) as Scenario;
    }

    it('кнопка «Настроить» открывает окно, переименование применяется сразу, Esc закрывает', async () => {
      const fetchMock = stubFetch(scenario);
      renderEditor();
      fireEvent.click(await screen.findByText('Привет'));
      fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.configure }));

      const title = await screen.findByLabelText(ru.blockDialog.titleLabel);
      fireEvent.change(title, { target: { value: 'Приветствие' } });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      const saved = await savedScenario(fetchMock);
      expect(saved.blocks.find((b) => b.id === 'msg_1')!.title).toBe('Приветствие');
    });

    it('двойной клик по блоку открывает окно', async () => {
      stubFetch(scenario);
      renderEditor();
      fireEvent.doubleClick(await screen.findByText('Привет'));
      expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    it('Delete в поле окна не удаляет блок', async () => {
      const fetchMock = stubFetch(scenario);
      renderEditor();
      fireEvent.doubleClick(await screen.findByText('Привет'));
      const title = await screen.findByLabelText(ru.blockDialog.titleLabel);
      title.focus();
      fireEvent.keyDown(title, { key: 'Delete', code: 'Delete' });
      fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Backspace', code: 'Backspace' });

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const saved = await savedScenario(fetchMock);
      expect(saved.blocks).toHaveLength(2);
    });

    it('ошибка в имени переменной блокирует сохранение', async () => {
      const bad: Scenario = {
        ...scenario,
        blocks: [
          scenario.blocks[0]!,
          {
            id: 'ask',
            type: 'TEXT_INPUT',
            title: 'Ввод',
            question: 'Имя?',
            variableName: 'имя',
            x: 400,
            y: 0,
          },
        ],
        transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'ask' }],
      };
      const fetchMock = stubFetch(bad);
      renderEditor();
      await screen.findByText('Ввод');
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    });
  });

  describe('множественное выделение и режимы холста', () => {
    const multiScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 0 },
        { id: 'exit_1', type: 'EXIT_POINT', title: 'Конец', x: 800, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg_1' },
        { source: { blockId: 'msg_1', output: 'default' }, target: 'exit_1' },
      ],
    };

    async function saveAndRead(fetchMock: ReturnType<typeof stubFetch>): Promise<Scenario> {
      const before = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').length;
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
      await waitFor(() =>
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').length).toBe(
          before + 1,
        ),
      );
      const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
      return JSON.parse(String(puts.at(-1)![1]!.body)) as Scenario;
    }

    it('переключает режим «Выделение / Перемещение» кнопками и клавишами V / H', async () => {
      stubFetch(multiScenario);
      renderEditor();
      await screen.findByText('Привет');

      const canvas = screen.getByTestId('canvas');
      expect(canvas.getAttribute('data-canvas-mode')).toBe('select');

      fireEvent.click(screen.getByRole('button', { name: ru.editor.modePan }));
      expect(canvas.getAttribute('data-canvas-mode')).toBe('pan');

      fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });
      expect(canvas.getAttribute('data-canvas-mode')).toBe('select');

      fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
      expect(canvas.getAttribute('data-canvas-mode')).toBe('pan');
    });

    it('Ctrl+A выделяет все блоки, показывает групповую панель и позволяет дублировать/удалять за один шаг Undo', async () => {
      const fetchMock = stubFetch(multiScenario);
      renderEditor();
      await screen.findByText('Привет');

      expect(screen.queryByTestId('selection-bar')).toBeNull();
      fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true });

      const bar = await screen.findByTestId('selection-bar');
      expect(bar.textContent).toContain(ru.editor.selectionCount(3));

      // Дублируем выбранную группу: ENTRY_POINT не дублируется, копируются msg_1 и exit_1 + связь между ними
      fireEvent.click(screen.getByRole('button', { name: ru.editor.nodeActions.duplicate }));
      await waitFor(() => expect(screen.getByTestId('selection-bar').textContent).toContain(ru.editor.selectionCount(2)));
      const afterDuplicate = await saveAndRead(fetchMock);
      expect(afterDuplicate.blocks).toHaveLength(5);
      expect(afterDuplicate.transitions).toHaveLength(3);

      // Отмена одним шагом Ctrl+Z возвращает исходные 3 блока
      fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
      const afterUndo = await saveAndRead(fetchMock);
      expect(afterUndo.blocks).toHaveLength(3);

      // Снова выделяем всё и снимаем выделение по Escape
      fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true });
      await screen.findByTestId('selection-bar');
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());

      // Выделяем всё и удаляем группой: ENTRY_POINT защищена, остаётся 1 блок
      fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true });
      await screen.findByTestId('selection-bar');
      fireEvent.click(screen.getByRole('button', { name: ru.editor.nodeActions.remove }));
      const afterDelete = await saveAndRead(fetchMock);
      expect(afterDelete.blocks).toHaveLength(1);
      expect(afterDelete.blocks[0]!.type).toBe('ENTRY_POINT');
    });
  });
});
