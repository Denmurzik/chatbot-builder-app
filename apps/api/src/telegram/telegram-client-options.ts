import type { ApiClientOptions } from 'grammy';
import { ProxyAgent, fetch as undiciFetch, type RequestInfo, type RequestInit } from 'undici';

// Один ProxyAgent на адрес прокси в рамках процесса (переиспользует пул соединений)
const agents = new Map<string, ProxyAgent>();

function getProxyAgent(proxyUrl: string): ProxyAgent {
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  return agent;
}

// Возвращает опции клиента grammY для отправки запросов к Telegram через HTTP-прокси.
// Если proxyUrl не задан или пуст — undefined (прямые запросы без прокси).
export function telegramClientOptions(proxyUrl?: string): ApiClientOptions | undefined {
  const normalized = proxyUrl?.trim();
  if (!normalized) return undefined;
  const dispatcher = getProxyAgent(normalized);
  const proxiedFetch = (url: unknown, init?: Record<string, unknown>) =>
    undiciFetch(url as RequestInfo, {
      ...(init as RequestInit | undefined),
      dispatcher,
    });
  return {
    fetch: proxiedFetch as unknown as NonNullable<ApiClientOptions['fetch']>,
  };
}
