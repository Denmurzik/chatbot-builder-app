import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewEvent, Scenario } from '@chatbot/model';
import { createQueryClient } from '@/app/queryClient';
import { EditorPage } from '@/editor/EditorPage';
import { setupCodeMirrorJsdom } from '@/editor/fields/cm-test-setup';
import { ru } from '@/i18n/ru';
import { PreviewPanel } from './PreviewPanel';

const setCenterMock = vi.fn(() => Promise.resolve(true));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      setCenter: setCenterMock,
    }),
  };
});

type Listener = (...args: unknown[]) => void;

class MockSocket {
  private listeners = new Map<string, Set<Listener>>();
  emit = vi.fn();
  disconnect = vi.fn();

  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  trigger(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

let currentSocket: MockSocket;
const ioMock = vi.fn((..._args: unknown[]) => {
  currentSocket = new MockSocket();
  return currentSocket;
});

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

function connectSocket() {
  act(() => {
    currentSocket.trigger('connect');
    const startCall = currentSocket.emit.mock.calls.find(([ev]) => ev === 'start');
    const ack = startCall?.[2] as ((res: { chatId: string }) => void) | undefined;
    ack?.({ chatId: 'preview:p1:s1' });
  });
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    ioMock.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('отрисовывает сообщения, кнопки вопросов (устаревшие неактивны), системные сообщения и переменные', () => {
    const onCurrentBlock = vi.fn();
    const onErrorBlock = vi.fn();

    render(
      <PreviewPanel
        projectId="p1"
        open
        onOpenChange={vi.fn()}
        onCurrentBlock={onCurrentBlock}
        onErrorBlock={onErrorBlock}
      />,
    );

    connectSocket();
    expect(screen.getByText(ru.preview.connected)).toBeTruthy();

    const events: PreviewEvent[] = [
      { type: 'message', message: { kind: 'text', text: 'Добро пожаловать' } },
      {
        type: 'message',
        message: {
          kind: 'question',
          text: 'Первый вопрос',
          buttons: [{ label: 'Старый вариант', callbackData: 'q1:0' }],
        },
      },
      {
        type: 'message',
        message: {
          kind: 'question',
          text: 'Второй вопрос',
          buttons: [
            { label: 'Да', callbackData: 'q2:0' },
            { label: 'Нет', callbackData: 'q2:1' },
          ],
        },
      },
      { type: 'currentBlock', blockId: 'q2' },
      { type: 'variables', variables: { city: 'Москва' } },
    ];

    act(() => {
      for (const ev of events) currentSocket.trigger('preview', ev);
    });

    expect(screen.getByText('Добро пожаловать')).toBeTruthy();
    expect(screen.getByText('Первый вопрос')).toBeTruthy();
    expect(screen.getByText('Второй вопрос')).toBeTruthy();
    expect(onCurrentBlock).toHaveBeenCalledWith('q2');

    // Кнопка старого вопроса неактивна, кнопки последнего вопроса кликабельны
    const oldButton = screen.getByRole('button', { name: 'Старый вариант' }) as HTMLButtonElement;
    const yesButton = screen.getByRole('button', { name: 'Да' }) as HTMLButtonElement;
    expect(oldButton.disabled).toBe(true);
    expect(yesButton.disabled).toBe(false);

    fireEvent.click(yesButton);
    expect(currentSocket.emit).toHaveBeenCalledWith(
      'button',
      { callbackData: 'q2:0' },
      expect.any(Function),
    );

    // Системное сообщение
    act(() => {
      currentSocket.trigger('preview', {
        type: 'system',
        text: 'Остановлено на неподключённом выходе',
        blockId: 'q2',
      } satisfies PreviewEvent);
    });
    expect(screen.getByText('Остановлено на неподключённом выходе')).toBeTruthy();
    expect(onErrorBlock).toHaveBeenCalledWith('q2');

    // Раскрываем панель переменных
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ru.preview.variablesTitle) }));
    expect(screen.getByText('city')).toBeTruthy();
    expect(screen.getByText('Москва')).toBeTruthy();
  });

  it('отправляет текст через форму ввода и перезапускает диалог по кнопке', () => {
    render(<PreviewPanel projectId="p1" open onOpenChange={vi.fn()} />);
    connectSocket();

    const input = screen.getByLabelText(ru.preview.inputLabel);
    fireEvent.change(input, { target: { value: 'Привет, бот' } });
    fireEvent.click(screen.getByRole('button', { name: ru.preview.send }));

    expect(currentSocket.emit).toHaveBeenCalledWith(
      'input',
      { text: 'Привет, бот' },
      expect.any(Function),
    );
    expect(screen.getByText('Привет, бот')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ru.preview.restart }));
    expect(currentSocket.emit).toHaveBeenCalledWith('restart', expect.any(Function));
    expect(screen.queryByText('Привет, бот')).toBeNull();
  });

  it('кнопки последнего вопроса остаются активны после пользовательского ввода и системного ответа и отключаются только после новой реплики бота', () => {
    render(<PreviewPanel projectId="p1" open onOpenChange={vi.fn()} />);
    connectSocket();

    act(() => {
      currentSocket.trigger('preview', {
        type: 'message',
        message: {
          kind: 'question',
          text: 'Выберите вариант',
          buttons: [
            { label: 'Вариант А', callbackData: 'q1:0' },
            { label: 'Вариант Б', callbackData: 'q1:1' },
          ],
        },
      } satisfies PreviewEvent);
    });

    // Автор вводит текст вместо нажатия кнопки, бот отвечает системным сообщением
    const input = screen.getByLabelText(ru.preview.inputLabel);
    fireEvent.change(input, { target: { value: 'что-то текстом' } });
    fireEvent.click(screen.getByRole('button', { name: ru.preview.send }));

    act(() => {
      currentSocket.trigger('preview', {
        type: 'system',
        text: 'Выберите вариант кнопкой',
        blockId: null,
      } satisfies PreviewEvent);
    });

    const btnA = screen.getByRole('button', { name: 'Вариант А' }) as HTMLButtonElement;
    expect(btnA.disabled).toBe(false);

    // Новая реплика бота отключает кнопки предыдущего вопроса
    act(() => {
      currentSocket.trigger('preview', {
        type: 'message',
        message: { kind: 'text', text: 'Спасибо, записали' },
      } satisfies PreviewEvent);
    });
    expect(btnA.disabled).toBe(true);
  });

  it('не закрывается при клике снаружи (по холсту) и закрывается только кнопкой закрытия', () => {
    const onOpenChange = vi.fn();
    render(
      <div>
        <button type="button">Холст</button>
        <PreviewPanel projectId="p1" open onOpenChange={onOpenChange} />
      </div>,
    );
    connectSocket();

    const outside = screen.getByRole('button', { name: 'Холст' });
    fireEvent.pointerDown(outside);
    fireEvent.mouseDown(outside);
    fireEvent.click(outside);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ru.common.close }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('отображает ошибки подключения (connect_error) и ack {error}', () => {
    render(<PreviewPanel projectId="p1" open onOpenChange={vi.fn()} />);

    act(() => {
      currentSocket.trigger('connect_error');
    });
    expect(screen.getByText(ru.preview.error)).toBeTruthy();
    expect(screen.getByText(ru.preview.startError)).toBeTruthy();

    connectSocket();
    const input = screen.getByLabelText(ru.preview.inputLabel);
    fireEvent.change(input, { target: { value: 'тест' } });
    fireEvent.click(screen.getByRole('button', { name: ru.preview.send }));

    const inputCall = currentSocket.emit.mock.calls.find(([ev]) => ev === 'input');
    const ack = inputCall?.[2] as ((res: { error: string }) => void) | undefined;
    act(() => {
      ack?.({ error: 'Ошибка отправки' });
    });
    expect(screen.getByText('Ошибка отправки')).toBeTruthy();
  });
});

describe('EditorPage — превью и тестовое окружение', () => {
  const scenario: Scenario = {
    formatVersion: 1,
    blocks: [
      { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
      { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 80 },
    ],
    transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
  };

  beforeEach(() => {
    ioMock.mockClear();
    setCenterMock.mockClear();
    sessionStorage.clear();
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
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch({ saveOk = true }: { saveOk?: boolean } = {}) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects/p1/scenario' && init?.method === 'PUT') {
        return Promise.resolve(
          saveOk
            ? new Response(JSON.stringify({ updatedAt: '2026-01-02T00:00:00Z' }), { status: 200 })
            : new Response(JSON.stringify({ message: 'Ошибка сохранения' }), { status: 500 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'p1',
            name: 'Запись к врачу',
            scenario,
            environment: [{ name: 'BASE_URL', secret: false, value: 'https://test.api' }],
            updatedAt: '2026-01-01T00:00:00Z',
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

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

  it('подсвечивает текущий блок без пометки dirty и центрирует холст при system с blockId', async () => {
    stubFetch();
    renderEditor();
    await screen.findByText('Привет');

    fireEvent.click(screen.getByRole('button', { name: ru.preview.button }));
    expect(await screen.findByTestId('preview-panel')).toBeTruthy();

    connectSocket();

    act(() => {
      currentSocket.trigger('preview', {
        type: 'currentBlock',
        blockId: 'msg_1',
      } satisfies PreviewEvent);
    });

    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="msg_1"]')!;
    expect(node.classList.contains('preview-node-current')).toBe(true);
    // Подсветка не помечает сценарий изменённым
    expect(screen.queryByText(ru.editor.unsaved)).toBeNull();

    // Системное сообщение с blockId подсвечивает ошибку и центрирует холст
    act(() => {
      currentSocket.trigger('preview', {
        type: 'system',
        text: 'Выход не подключён',
        blockId: 'msg_1',
      } satisfies PreviewEvent);
    });

    expect(node.classList.contains('preview-node-error')).toBe(true);
    expect(setCenterMock).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
      zoom: 1,
      duration: 200,
    });

    // Следующий ввод автора сбрасывает красную рамку ошибки
    const input = screen.getByLabelText(ru.preview.inputLabel);
    fireEvent.change(input, { target: { value: 'далее' } });
    fireEvent.click(screen.getByRole('button', { name: ru.preview.send }));
    expect(node.classList.contains('preview-node-error')).toBe(false);
  });

  it('при несохранённых изменениях «Превью» сохраняет сценарий и не открывается при ошибке сохранения', async () => {
    const fetchMock = stubFetch({ saveOk: false });
    renderEditor();
    fireEvent.click(await screen.findByText('Привет'));
    fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));
    expect(screen.getByText(ru.editor.unsaved)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ru.preview.button }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/projects/p1/scenario' && init?.method === 'PUT',
        ),
      ).toBe(true),
    );
    expect(screen.queryByTestId('preview-panel')).toBeNull();
  });

  it('кнопка «Тестовое окружение» открывает диалог с переменными проекта', async () => {
    stubFetch();
    renderEditor();
    await screen.findByText('Привет');

    fireEvent.click(screen.getByRole('button', { name: ru.testEnvironment.button }));
    expect(await screen.findByText(ru.testEnvironment.description)).toBeTruthy();
    expect(screen.getByDisplayValue('BASE_URL')).toBeTruthy();
  });
});
