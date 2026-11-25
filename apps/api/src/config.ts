import path from 'node:path';
import { Global, Module } from '@nestjs/common';
import dotenv from 'dotenv';

// Загружаем корневой .env независимо от текущей рабочей директории (одинаковая глубина из src/ и dist/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEV_JWT_SECRET = 'change-me-dev-jwt-secret';
const MIN_PROD_JWT_SECRET_LENGTH = 32;

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export const API_CONFIG = Symbol('API_CONFIG');

export interface ApiConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  telegramPolling: boolean;
  telegramProxy?: string;
  vkApiBaseUrl: string;
  vkPollingEnabled: boolean;
  publicUrl?: string;
  queuePrefix?: string;
}

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

// Читает и проверяет конфигурацию API из переменных окружения
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Не задана переменная окружения DATABASE_URL');
  }

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('Не задана переменная окружения JWT_SECRET');
  }

  const rawPort = env.API_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Некорректный порт API_PORT: "${rawPort}"`);
  }

  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProduction = nodeEnv === 'production';

  if (
    isProduction &&
    (jwtSecret.length < MIN_PROD_JWT_SECRET_LENGTH || jwtSecret === DEV_JWT_SECRET)
  ) {
    throw new Error(
      'В production JWT_SECRET должен быть длиной не менее 32 символов и отличаться от значения по умолчанию',
    );
  }

  const telegramPolling = env.TELEGRAM_POLLING?.trim() === '1';

  const publicUrl = env.PUBLIC_URL?.trim() || undefined;
  if (isProduction && !telegramPolling && !publicUrl) {
    throw new Error('В production не задана переменная окружения PUBLIC_URL');
  }

  const queuePrefix = env.QUEUE_PREFIX?.trim() || undefined;
  const telegramProxy = parseOptionalProxyUrl(env.TELEGRAM_PROXY);
  const vkApiBaseUrl =
    env.VK_API_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.vk.com/method';
  const vkPollingEnabled = env.VK_POLLING?.trim() !== '0';

  return {
    databaseUrl,
    jwtSecret,
    port,
    nodeEnv,
    isProduction,
    telegramPolling,
    ...(telegramProxy ? { telegramProxy } : {}),
    vkApiBaseUrl,
    vkPollingEnabled,
    ...(publicUrl ? { publicUrl } : {}),
    ...(queuePrefix ? { queuePrefix } : {}),
  };
}

// Глобальный модуль конфигурации, предоставляющий ApiConfig через DI
@Global()
@Module({
  providers: [
    {
      provide: API_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [API_CONFIG],
})
export class ConfigModule {}
