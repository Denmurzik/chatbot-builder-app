import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

function mockFetch(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('бросает ApiError со status и issues на 400', async () => {
    const issues = [{ path: 'password', message: 'слишком короткий' }];
    mockFetch(400, { message: 'Ошибка проверки', issues });

    const error = await apiFetch('/auth/register', { method: 'POST' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.message).toBe('Ошибка проверки');
    expect(apiError.issues).toEqual(issues);
  });

  it('отправляет cookie и возвращает JSON при успехе', async () => {
    const fn = mockFetch(200, { id: '1', email: 'a@b.c' });

    const result = await apiFetch<{ id: string }>('/auth/me');

    expect(result.id).toBe('1');
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect(init.credentials).toBe('include');
  });

  it('на 204 возвращает undefined', async () => {
    mockFetch(204);
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});
