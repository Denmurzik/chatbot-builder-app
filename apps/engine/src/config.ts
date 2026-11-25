import path from 'node:path';
import dotenv from 'dotenv';
import { DEFAULT_VK_API_BASE_URL, type AppConfig } from './infra/tokens';

// Загружаем корневой .env при импорте модуля, независимо от cwd и порядка провайдеров
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parseOptionalProxyUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Некорректный URL прокси TELEGRAM_PROXY: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Некорректный URL прокси TELEGRAM_PROXY (ожидается http:// или https://): "${value}"`,
    );
  }
  return value;
}

function parseVkApiBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_VK_API_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Некорректный URL VK API VK_API_BASE_URL: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Некорректный URL VK API VK_API_BASE_URL (ожидается http:// или https://): "${value}"`,
    );
  }
  return value.replace(/\/+$/, '');
}

// Собирает конфигурацию engine из переменных окружения
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const redisUrl = env.REDIS_URL?.trim();
  if (!databaseUrl) throw new Error('Не задана переменная окружения DATABASE_URL');
  if (!redisUrl) throw new Error('Не задана переменная окружения REDIS_URL');
  const queuePrefix = env.QUEUE_PREFIX?.trim() || undefined;
  const telegramProxy = parseOptionalProxyUrl(env.TELEGRAM_PROXY);
  const vkApiBaseUrl = parseVkApiBaseUrl(env.VK_API_BASE_URL);
  return {
    databaseUrl,
    redisUrl,
    vkApiBaseUrl,
    ...(queuePrefix ? { queuePrefix } : {}),
    ...(telegramProxy ? { telegramProxy } : {}),
  };
}

// Список разрешённых хостов для исходящих HTTP-запросов (HTTP_ALLOWED_HOSTS через запятую).
// Пусто или не задано — без ограничений (dev)
export function loadAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const hosts = (env.HTTP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return hosts.length > 0 ? hosts : null;
}
