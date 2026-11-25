import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvVarView } from '@chatbot/model';
import { createQueryClient } from '@/app/queryClient';
import { ru } from '@/i18n/ru';
import { TestEnvironmentDialog } from './TestEnvironmentDialog';

describe('TestEnvironmentDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('показывает подсказку про превью и сохраняет EnvVarInput[] через PUT /api/projects/:id/environment', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([{ name: 'API_URL', secret: false, value: 'https://test.local' }]),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const initial: EnvVarView[] = [
      { name: 'API_URL', secret: false, value: 'https://old.local' },
    ];

    render(
      <QueryClientProvider client={createQueryClient()}>
        <TestEnvironmentDialog
          projectId="p1"
          environment={initial}
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(ru.testEnvironment.title)).toBeTruthy();
    expect(screen.getByText(ru.testEnvironment.description)).toBeTruthy();

    const valueInput = screen.getByLabelText(`${ru.environment.value} API_URL`);
    fireEvent.change(valueInput, { target: { value: 'https://test.local' } });
    fireEvent.click(screen.getByRole('button', { name: ru.environment.save }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/environment');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual([
      { name: 'API_URL', secret: false, value: 'https://test.local' },
    ]);
  });
});
