import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSummary } from '@/api/projects';
import { createQueryClient } from '@/app/queryClient';
import { ru } from '@/i18n/ru';
import { ProjectsPage } from './ProjectsPage';

function renderProjectsPage() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<div>редактор проекта</div>} />
          <Route path="/login" element={<div>страница входа</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('отрисовывает карточки проектов и позволяет переименовать проект через PATCH', async () => {
    const user = userEvent.setup();
    let projects: ProjectSummary[] = [
      { id: 'p1', name: 'Запись к врачу', updatedAt: '2026-01-01T10:00:00Z', botsCount: 0 },
      { id: 'p2', name: 'Доставка пиццы', updatedAt: '2026-01-02T10:00:00Z', botsCount: 2 },
    ];

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'u1', email: 'author@example.com' }), { status: 200 }),
        );
      }
      if (url === '/api/projects' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify(projects), { status: 200 }));
      }
      if (url === '/api/projects/p1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { name: string };
        const updated: ProjectSummary = {
          ...projects[0]!,
          name: body.name,
          updatedAt: '2026-01-03T10:00:00Z',
        };
        projects = [updated, projects[1]!];
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');

    renderProjectsPage();

    expect(await screen.findByText('Запись к врачу')).toBeTruthy();
    expect(screen.getByText('Доставка пиццы')).toBeTruthy();

    // Открываем меню действий карточки — навигации в редактор не происходит
    await user.click(screen.getByRole('button', { name: ru.projects.actionsLabel('Запись к врачу') }));
    expect(screen.queryByText('редактор проекта')).toBeNull();

    await user.click(await screen.findByRole('menuitem', { name: ru.projects.rename }));

    // Поле предзаполнено текущим именем
    const input = await screen.findByLabelText(ru.projects.nameLabel);
    expect((input as HTMLInputElement).value).toBe('Запись к врачу');

    // Проверка валидации пустого имени
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: ru.projects.renameSave }));
    expect(await screen.findByText(ru.projects.nameRequired)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    // Сохранение нового имени
    await user.type(input, 'Клиника 24');
    await user.click(screen.getByRole('button', { name: ru.projects.renameSave }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === '/api/projects/p1' &&
            init?.method === 'PATCH' &&
            init.body === JSON.stringify({ name: 'Клиника 24' }),
        ),
      ).toBe(true),
    );
    expect(successSpy).toHaveBeenCalledWith(ru.projects.renamed);
    expect(await screen.findByText('Клиника 24')).toBeTruthy();
  });

  it('при удалении проекта с ботами предупреждает об их количестве и отправляет DELETE', async () => {
    const user = userEvent.setup();
    let projects: ProjectSummary[] = [
      { id: 'p2', name: 'Доставка пиццы', updatedAt: '2026-01-02T10:00:00Z', botsCount: 2 },
    ];

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'u1', email: 'author@example.com' }), { status: 200 }),
        );
      }
      if (url === '/api/projects' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify(projects), { status: 200 }));
      }
      if (url === '/api/projects/p2' && init?.method === 'DELETE') {
        projects = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');

    renderProjectsPage();

    expect(await screen.findByText('Доставка пиццы')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: ru.projects.actionsLabel('Доставка пиццы') }));
    await user.click(await screen.findByRole('menuitem', { name: ru.projects.delete }));

    // В диалоге есть явное предупреждение о 2 ботах и их диалогах
    expect(await screen.findByText(ru.projects.deleteBotsWarning(2))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: ru.projects.delete }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/projects/p2' && init?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    expect(successSpy).toHaveBeenCalledWith(ru.projects.deleted);
    expect(await screen.findByText(ru.projects.empty)).toBeTruthy();
  });

  it('при удалении проекта без ботов не показывает предупреждение о ботах', async () => {
    const user = userEvent.setup();
    const projects: ProjectSummary[] = [
      { id: 'p1', name: 'Пустой проект', updatedAt: '2026-01-01T10:00:00Z' },
    ];

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'u1', email: 'author@example.com' }), { status: 200 }),
        );
      }
      if (url === '/api/projects' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify(projects), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProjectsPage();

    expect(await screen.findByText('Пустой проект')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: ru.projects.actionsLabel('Пустой проект') }));
    await user.click(await screen.findByRole('menuitem', { name: ru.projects.delete }));

    expect(await screen.findByText(ru.projects.deleteTitle)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('отображает бренд, переключатель темы и метрики карточек (статус, блоки, TG/VK)', async () => {
    const projects: ProjectSummary[] = [
      {
        id: 'p1',
        name: 'Опубликованный бот',
        updatedAt: '2026-01-01T10:00:00Z',
        botsCount: 2,
        blocksCount: 12,
        publishedBotsCount: 1,
        messengers: ['TELEGRAM', 'VK'],
      },
      {
        id: 'p2',
        name: 'Черновик сценария',
        updatedAt: '2026-01-02T10:00:00Z',
        botsCount: 0,
        blocksCount: 3,
        publishedBotsCount: 0,
        messengers: [],
      },
    ];

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'u1', email: 'author@example.com' }), { status: 200 }),
        );
      }
      if (url === '/api/projects' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(new Response(JSON.stringify(projects), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProjectsPage();

    expect(await screen.findByText('Опубликованный бот')).toBeTruthy();
    expect(screen.getByText(ru.appName)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${ru.theme.switchToLight}|${ru.theme.switchToDark}`),
      }),
    ).toBeTruthy();

    expect(screen.getByText(ru.projects.publishedBadge)).toBeTruthy();
    expect(screen.getByText(ru.projects.draftBadge)).toBeTruthy();
    expect(screen.getByText(ru.projects.blocksCount(12))).toBeTruthy();
    expect(screen.getByText(ru.projects.blocksCount(3))).toBeTruthy();
    expect(screen.getByText('TG')).toBeTruthy();
    expect(screen.getByText('VK')).toBeTruthy();
  });
});
