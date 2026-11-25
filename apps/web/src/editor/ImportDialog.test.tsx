import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import type { Scenario } from '@chatbot/model';
import { createQueryClient } from '@/app/queryClient';
import { ru } from '@/i18n/ru';
import { parseContentDispositionFileName } from '@/api/import-export';
import { EditorPage } from './EditorPage';
import { ImportDialog } from './ImportDialog';
import { ImportExportMenu } from './ImportExportMenu';
import { setupCodeMirrorJsdom } from './fields/cm-test-setup';

// Минимальные заглушки для React Flow и CodeMirror в jsdom
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const INITIAL_SCENARIO: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    { id: 'msg_1', type: 'TEXT_MESSAGE', title: 'Старое сообщение', text: 'Привет', x: 200, y: 0 },
  ],
  transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_1' }],
};

const IMPORTED_SCENARIO: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    { id: 'msg_new', type: 'TEXT_MESSAGE', title: 'Импортированный блок', text: 'Готово', x: 200, y: 0 },
  ],
  transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'msg_new' }],
};

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

function makeJsonFile(content: string, name = 'scenario.json'): File {
  return new File([content], name, { type: 'application/json' });
}

function makeYamlFile(content: string, name = 'scenario.yaml'): File {
  return new File([content], name, { type: 'application/yaml' });
}

describe('parseContentDispositionFileName', () => {
  it('извлекает кириллическое имя из filename*=UTF-8', () => {
    const header =
      "attachment; filename=\"_____.json\"; filename*=UTF-8''%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C.json";
    expect(parseContentDispositionFileName(header, 'fallback.json')).toBe('Запись.json');
  });

  it('использует filename="..." если нет filename*', () => {
    expect(parseContentDispositionFileName('attachment; filename="bot.json"', 'fallback.json')).toBe(
      'bot.json',
    );
  });

  it('возвращает fallback при отсутствии заголовка', () => {
    expect(parseContentDispositionFileName(null, 'fallback.json')).toBe('fallback.json');
  });
});

describe('ImportExportMenu — экспорт', () => {
  it('вызывает GET /api/projects/:id/export?format=json и запускает скачивание JSON-файла', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(INITIAL_SCENARIO), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition':
              "attachment; filename=\"bot.json\"; filename*=UTF-8''%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C.json",
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const createObjectURL = vi.fn(() => 'blob:mock-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    const onSaveBeforeExport = vi.fn(async () => true);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportExportMenu
          projectId="p1"
          projectName="Запись"
          dirty={false}
          onSaveBeforeExport={onSaveBeforeExport}
          onImported={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: ru.importExport.export }));
    await user.click(await screen.findByRole('menuitem', { name: ru.importExport.exportJson }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onSaveBeforeExport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/export?format=json', {
      method: 'GET',
      credentials: 'include',
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-export');

    const anchor = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchor?.download).toBe('Запись.json');
  });

  it('вызывает GET /api/projects/:id/export?format=yaml и запускает скачивание YAML-файла', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(YAML.stringify(INITIAL_SCENARIO), {
          status: 200,
          headers: {
            'Content-Type': 'application/yaml; charset=utf-8',
            'Content-Disposition':
              "attachment; filename=\"bot.yaml\"; filename*=UTF-8''%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C.yaml",
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const createObjectURL = vi.fn(() => 'blob:mock-yaml');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportExportMenu
          projectId="p1"
          projectName="Запись"
          dirty={false}
          onSaveBeforeExport={vi.fn(async () => true)}
          onImported={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: ru.importExport.export }));
    await user.click(await screen.findByRole('menuitem', { name: ru.importExport.exportYaml }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/export?format=yaml', {
      method: 'GET',
      credentials: 'include',
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-yaml');

    const anchor = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchor?.download).toBe('Запись.yaml');
  });

  it('при несохранённых изменениях сначала сохраняет сценарий перед экспортом', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(INITIAL_SCENARIO), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const onSaveBeforeExport = vi.fn(async () => true);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportExportMenu
          projectId="p1"
          projectName="Проект"
          dirty={true}
          onSaveBeforeExport={onSaveBeforeExport}
          onImported={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: ru.importExport.export }));
    await user.click(await screen.findByRole('menuitem', { name: ru.importExport.exportJson }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onSaveBeforeExport).toHaveBeenCalledTimes(1);
  });

  it('не запускает экспорт, если предварительное сохранение не удалось', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onSaveBeforeExport = vi.fn(async () => false);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportExportMenu
          projectId="p1"
          projectName="Проект"
          dirty={true}
          onSaveBeforeExport={onSaveBeforeExport}
          onImported={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: ru.importExport.export }));
    await user.click(await screen.findByRole('menuitem', { name: ru.importExport.exportYaml }));

    await waitFor(() => expect(onSaveBeforeExport).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ImportDialog — проверка JSON и предупреждение о секретах', () => {
  it('показывает понятную ошибку для файла, который не является JSON, без отправки на сервер', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportDialog projectId="p1" open onOpenChange={vi.fn()} onImported={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByText(ru.importExport.importDescription)).toBeTruthy();

    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, { target: { files: [makeJsonFile('{не валидный json')] } });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    expect(await screen.findByText(ru.importExport.invalidJson)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('при secretsToFill > 0 показывает предупреждение о секретных заголовках', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ updatedAt: '2026-01-03T00:00:00Z', secretsToFill: 2 }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => '');
    const onImported = vi.fn(async () => {});
    const onOpenChange = vi.fn();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportDialog projectId="p1" open onOpenChange={onOpenChange} onImported={onImported} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, {
      target: { files: [makeJsonFile(JSON.stringify(IMPORTED_SCENARIO))] },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(successSpy).toHaveBeenCalledWith(ru.importExport.importSuccess);
    expect(warningSpy).toHaveBeenCalledWith(ru.importExport.secretsToFill(2));
  });

  it('во время выполнения импорта (busy) блокирует кнопку «Отмена» и предотвращает закрытие', async () => {
    let resolveImport!: (res: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveImport = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportDialog projectId="p1" open onOpenChange={onOpenChange} onImported={vi.fn()} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, {
      target: { files: [makeJsonFile(JSON.stringify(IMPORTED_SCENARIO))] },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    // Диалог перешёл в состояние busy (fetch вызван и ожидает ответа)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const cancelButton = screen.getByRole('button', { name: ru.common.cancel }) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);

    // Нажатие на кнопку «Отмена» или попытка закрытия не вызывает onOpenChange
    fireEvent.click(cancelButton);
    expect(onOpenChange).not.toHaveBeenCalled();

    // Завершаем запрос
    resolveImport(
      new Response(JSON.stringify({ updatedAt: '2026-01-03T00:00:00Z', secretsToFill: 0 }), {
        status: 200,
      }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('импортирует корректный YAML-файл с Content-Type: application/yaml; charset=utf-8', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ updatedAt: '2026-01-03T00:00:00Z', secretsToFill: 1 }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => '');
    const onImported = vi.fn(async () => {});
    const onOpenChange = vi.fn();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportDialog projectId="p1" open onOpenChange={onOpenChange} onImported={onImported} />
      </QueryClientProvider>,
    );

    const yamlText = YAML.stringify(IMPORTED_SCENARIO);
    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, { target: { files: [makeYamlFile(yamlText)] } });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/import');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/yaml; charset=utf-8');
    expect(init.body).toBe(yamlText);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(successSpy).toHaveBeenCalledWith(ru.importExport.importSuccess);
    expect(warningSpy).toHaveBeenCalledWith(ru.importExport.secretsToFill(1));
  });

  it('показывает понятную ошибку для битого YAML без отправки на сервер', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ImportDialog projectId="p1" open onOpenChange={vi.fn()} onImported={vi.fn()} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, {
      target: { files: [makeYamlFile('blocks:\n  - [незакрытый список', 'broken.yml')] },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    expect(await screen.findByText(ru.importExport.invalidYaml)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EditorPage — импорт сценария', () => {
  it('при ответе 400 показывает список issues и не меняет холст', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects/p1/import' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: 'Файл не подходит',
              issues: [
                { path: 'formatVersion', message: 'Неподдерживаемая версия формата (ожидалась 1)' },
                { path: 'transitions.0.target', message: 'Переход ведёт на несуществующий блок' },
              ],
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'p1',
            name: 'Тестовый бот',
            scenario: INITIAL_SCENARIO,
            environment: [],
            updatedAt: '2026-01-01T00:00:00Z',
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor();
    expect(await screen.findByText('Старое сообщение')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ru.importExport.import }));
    expect(await screen.findByText(ru.importExport.importDescription)).toBeTruthy();

    const input = screen.getByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, {
      target: { files: [makeJsonFile(JSON.stringify({ formatVersion: 2 }))] },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    expect(await screen.findByText(/Неподдерживаемая версия формата/)).toBeTruthy();
    expect(screen.getByText(/Переход ведёт на несуществующий блок/)).toBeTruthy();
    // Холст не изменился
    expect(screen.getByText('Старое сообщение')).toBeTruthy();
    expect(screen.queryByText('Импортированный блок')).toBeNull();
  });

  it('при успешном импорте перезагружает сценарий на холсте и очищает историю отмены', async () => {
    let currentScenario = INITIAL_SCENARIO;
    let currentUpdatedAt = '2026-01-01T00:00:00Z';

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects/p1/import' && init?.method === 'POST') {
        currentScenario = IMPORTED_SCENARIO;
        currentUpdatedAt = '2026-01-02T00:00:00Z';
        return Promise.resolve(
          new Response(JSON.stringify({ updatedAt: currentUpdatedAt, secretsToFill: 0 }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'p1',
            name: 'Тестовый бот',
            scenario: currentScenario,
            environment: [],
            updatedAt: currentUpdatedAt,
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(toast, 'success').mockImplementation(() => '');

    renderEditor();
    expect(await screen.findByText('Старое сообщение')).toBeTruthy();

    // Делаем правку на холсте, чтобы появились история отмены и флаг несохранённых изменений
    fireEvent.click(screen.getByText('Старое сообщение'));
    fireEvent.click(await screen.findByRole('button', { name: ru.editor.nodeActions.duplicate }));
    const undoBefore = screen.getByRole('button', { name: ru.editor.undo }) as HTMLButtonElement;
    expect(undoBefore.disabled).toBe(false);
    expect(screen.getByText(ru.editor.unsaved)).toBeTruthy();

    // Импортируем новый сценарий
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.import }));
    const input = await screen.findByLabelText(ru.importExport.fileLabel);
    fireEvent.change(input, {
      target: { files: [makeJsonFile(JSON.stringify(IMPORTED_SCENARIO))] },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.importExport.confirmImport }));

    // Новый сценарий появился на холсте, старого блока нет
    expect(await screen.findByText('Импортированный блок')).toBeTruthy();
    expect(screen.queryByText('Старое сообщение')).toBeNull();

    // История отмены и флаг несохранённых изменений сброшены
    const undoAfter = screen.getByRole('button', { name: ru.editor.undo }) as HTMLButtonElement;
    expect(undoAfter.disabled).toBe(true);
    expect(screen.queryByText(ru.editor.unsaved)).toBeNull();
  });
});
