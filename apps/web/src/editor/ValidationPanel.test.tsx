import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scenario, ValidationError } from '@chatbot/model';
import { createQueryClient } from '@/app/queryClient';
import { ru } from '@/i18n/ru';
import { EditorPage } from './EditorPage';
import { ValidationPanel } from './ValidationPanel';
import { setupCodeMirrorJsdom } from './fields/cm-test-setup';

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
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('ValidationPanel', () => {
  afterEach(() => {
    cleanup();
    setCenterMock.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('отрисовывает список ошибок и предупреждений с иконками уровня', () => {
    const errors: ValidationError[] = [
      {
        rule: 'outputs_connected',
        message: 'Выход «Далее» не подключён',
        severity: 'ERROR',
        blockId: 'msg_1',
      },
      {
        rule: 'loop_without_wait',
        message: 'Обнаружен цикл без ожидания ответа',
        severity: 'WARNING',
        blockId: 'cond_1',
      },
      {
        rule: 'single_entry_point',
        message: 'В сценарии должна быть точка входа',
        severity: 'ERROR',
      },
    ];

    render(
      <ValidationPanel open onOpenChange={vi.fn()} errors={errors} onSelectBlock={vi.fn()} />,
    );

    expect(screen.getByText('Выход «Далее» не подключён')).toBeTruthy();
    expect(screen.getByText('Обнаружен цикл без ожидания ответа')).toBeTruthy();
    expect(screen.getByText('В сценарии должна быть точка входа')).toBeTruthy();
    expect(screen.getAllByLabelText(ru.validationPanel.errorSeverity)).toHaveLength(2);
    expect(screen.getAllByLabelText(ru.validationPanel.warningSeverity)).toHaveLength(1);
    // Пункт без blockId — не кнопка
    expect(screen.queryByRole('button', { name: /В сценарии должна быть точка входа/ })).toBeNull();
  });

  it('клик по пункту с blockId вызывает onSelectBlock', () => {
    const onSelectBlock = vi.fn();
    const errors: ValidationError[] = [
      {
        rule: 'outputs_connected',
        message: 'Выход «Далее» не подключён',
        severity: 'ERROR',
        blockId: 'msg_1',
      },
    ];

    render(
      <ValidationPanel
        open
        onOpenChange={vi.fn()}
        errors={errors}
        onSelectBlock={onSelectBlock}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Выход «Далее» не подключён/ }));
    expect(onSelectBlock).toHaveBeenCalledWith('msg_1');
  });

  it('при пустом списке показывает «Ошибок не найдено»', () => {
    render(<ValidationPanel open onOpenChange={vi.fn()} errors={[]} onSelectBlock={vi.fn()} />);

    expect(screen.getByText('Ошибок не найдено')).toBeTruthy();
  });

  it('отрисовывает предупреждения новых правил (unreachableBlock, unwrittenVariable, missingEnvVariable) с иконкой и выбором блока', () => {
    const onSelectBlock = vi.fn();
    const warnings: ValidationError[] = [
      {
        rule: 'unreachableBlock',
        message: 'Блок «Забытый шаг» недостижим от точки входа',
        severity: 'WARNING',
        blockId: 'orphan_1',
      },
      {
        rule: 'unwrittenVariable',
        message: 'Переменная «patient_name» используется, но нигде не записывается',
        severity: 'WARNING',
        blockId: 'msg_2',
      },
      {
        rule: 'missingEnvVariable',
        message: 'Переменная окружения «CLINIC_API_KEY» не задана',
        severity: 'WARNING',
        blockId: 'http_1',
      },
    ];

    render(
      <ValidationPanel
        open
        onOpenChange={vi.fn()}
        errors={warnings}
        onSelectBlock={onSelectBlock}
      />,
    );

    expect(screen.getByText(ru.validationPanel.summary(0, 3))).toBeTruthy();
    expect(screen.getAllByLabelText(ru.validationPanel.warningSeverity)).toHaveLength(3);
    expect(screen.queryAllByLabelText(ru.validationPanel.errorSeverity)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Забытый шаг/ }));
    expect(onSelectBlock).toHaveBeenCalledWith('orphan_1');

    fireEvent.click(screen.getByRole('button', { name: /patient_name/ }));
    expect(onSelectBlock).toHaveBeenCalledWith('msg_2');

    fireEvent.click(screen.getByRole('button', { name: /CLINIC_API_KEY/ }));
    expect(onSelectBlock).toHaveBeenCalledWith('http_1');
  });
});

describe('EditorPage — проверка сценария', () => {
  const scenario: Scenario = {
    formatVersion: 1,
    blocks: [
      { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
      { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Привет', text: 'Здравствуйте', x: 400, y: 80 },
    ],
    transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
  };

  function stubFetch(validationErrors: ValidationError[]) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects/p1/validate' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ errors: validationErrors }), { status: 200 }),
        );
      }
      if (url === '/api/projects/p1/scenario' && init?.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ updatedAt: '2026-01-02T00:00:00Z' }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'p1',
            name: 'Запись к врачу',
            scenario,
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

  afterEach(() => {
    cleanup();
    setCenterMock.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('кнопка «Проверить» открывает панель, отмечает ошибки на блоке и центрирует холст по клику', async () => {
    const fetchMock = stubFetch([
      {
        rule: 'outputs_connected',
        message: 'Выход «Далее» не подключён',
        severity: 'ERROR',
        blockId: 'msg_1',
      },
    ]);
    renderEditor();
    await screen.findByText('Привет');

    fireEvent.click(screen.getByRole('button', { name: ru.validationPanel.button }));

    const item = await screen.findByRole('button', { name: /Выход «Далее» не подключён/ });
    // Без несохранённых изменений PUT не вызывается
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/projects/p1/validate' && init?.method === 'POST',
      ),
    ).toBe(true);

    // Ошибка сервера отмечена на блоке так же, как локальная
    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="msg_1"]')!;
    const badge = node.querySelector('[data-testid="block-issues"]');
    expect(badge?.textContent).toBe('1');
    expect(badge?.getAttribute('title')).toContain('Выход «Далее» не подключён');

    // Клик по ошибке центрирует холст на блоке и выделяет его
    fireEvent.click(item);
    expect(setCenterMock).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
      zoom: 1,
      duration: 200,
    });
    await waitFor(() => {
      const selected = document.querySelectorAll('.react-flow__node.selected');
      expect(selected).toHaveLength(1);
      expect(selected[0]!.getAttribute('data-id')).toBe('msg_1');
    });

    // После изменения сценария отметка серверной ошибки на блоке исчезает
    fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));
    await waitFor(() => {
      const updatedNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="msg_1"]')!;
      expect(updatedNode.querySelector('[data-testid="block-issues"]')).toBeNull();
    });
  });

  it('при несохранённых изменениях «Проверить» сначала сохраняет сценарий, затем проверяет', async () => {
    const fetchMock = stubFetch([]);
    renderEditor();
    fireEvent.click(await screen.findByText('Привет'));
    fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));
    expect(screen.getByText(ru.editor.unsaved)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ru.validationPanel.button }));

    expect(await screen.findByText(ru.validationPanel.empty)).toBeTruthy();
    const methods = fetchMock.mock.calls
      .filter(([url]) => url !== '/api/projects/p1')
      .map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
    expect(methods).toEqual(['PUT /api/projects/p1/scenario', 'POST /api/projects/p1/validate']);
  });
});
