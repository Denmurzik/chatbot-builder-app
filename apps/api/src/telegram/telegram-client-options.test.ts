import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, proxyAgentCtor } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  proxyAgentCtor: vi.fn((uri: string) => ({ uri, kind: 'proxy-agent' })),
}));

vi.mock('undici', () => ({
  fetch: fetchMock,
  ProxyAgent: proxyAgentCtor,
}));

import { telegramClientOptions } from './telegram-client-options';

describe('telegramClientOptions (api)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    proxyAgentCtor.mockClear();
  });

  it('возвращает undefined, если прокси не задан или пуст', () => {
    expect(telegramClientOptions()).toBeUndefined();
    expect(telegramClientOptions('')).toBeUndefined();
    expect(telegramClientOptions('   ')).toBeUndefined();
    expect(proxyAgentCtor).not.toHaveBeenCalled();
  });

  it('передаёт fetch, который вызывает undici fetch с ProxyAgent и переиспользует агент', async () => {
    const opts1 = telegramClientOptions('http://telegram-proxy:10809');
    const opts2 = telegramClientOptions('http://telegram-proxy:10809');
    expect(opts1?.fetch).toBeTypeOf('function');
    expect(opts2?.fetch).toBeTypeOf('function');
    // Один ProxyAgent на адрес прокси в рамках процесса
    expect(proxyAgentCtor).toHaveBeenCalledTimes(1);
    expect(proxyAgentCtor).toHaveBeenCalledWith('http://telegram-proxy:10809');

    const fakeResponse = { ok: true };
    fetchMock.mockResolvedValueOnce(fakeResponse);

    const result = await opts1!.fetch!('https://api.telegram.org/bot123/getMe', {
      method: 'POST',
    });

    expect(result).toBe(fakeResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledUrl).toBe('https://api.telegram.org/bot123/getMe');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.dispatcher).toEqual({
      uri: 'http://telegram-proxy:10809',
      kind: 'proxy-agent',
    });
  });
});
