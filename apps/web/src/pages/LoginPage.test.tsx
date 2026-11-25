import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { LoginPage } from './LoginPage';

function renderLogin(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects" element={<div>страница проектов</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubResponse(status: number, body?: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

async function fillAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(ru.auth.email), 'a@b.co');
  await user.type(screen.getByLabelText(ru.auth.password), 'password123');
  await user.click(screen.getByRole('button', { name: ru.auth.submitLogin }));
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('показывает «Неверный email или пароль» на 401', async () => {
    stubResponse(401, { message: 'Unauthorized' });
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText('Неверный email или пароль')).toBeTruthy();
  });

  it('переходит на /projects на 200', async () => {
    stubResponse(200, { id: '1', email: 'a@b.co' });
    renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByText('страница проектов')).toBeTruthy());
  });

  it('отображает логотип, переключатель темы и корректные a11y-атрибуты полей', () => {
    renderLogin();
    expect(screen.getByText(ru.appName)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${ru.theme.switchToLight}|${ru.theme.switchToDark}`),
      }),
    ).toBeTruthy();

    const emailInput = screen.getByLabelText(ru.auth.email);
    expect(emailInput.getAttribute('id')).toBe('auth-email');
    expect(emailInput.getAttribute('name')).toBe('email');
    expect(emailInput.getAttribute('autocomplete')).toBe('email');

    const passwordInput = screen.getByLabelText(ru.auth.password);
    expect(passwordInput.getAttribute('id')).toBe('auth-password');
    expect(passwordInput.getAttribute('name')).toBe('password');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
  });
});
