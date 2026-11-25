import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { createQueryClient } from './queryClient';
import { AuthGuard } from './AuthGuard';

describe('401 от API', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('401 на /api/projects ведёт на /login', async () => {
    // /auth/me отвечает 200, а список проектов — 401 (сессия истекла)
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/api/auth/me'
            ? new Response(JSON.stringify({ id: '1', email: 'a@b.co' }), { status: 200 })
            : new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
        ),
      ),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/projects']}>
          <Routes>
            <Route path="/login" element={<div>страница входа</div>} />
            <Route element={<AuthGuard />}>
              <Route path="/projects" element={<ProjectsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('страница входа')).toBeTruthy();
  });
});
