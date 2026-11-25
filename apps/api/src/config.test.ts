import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot',
    JWT_SECRET: 'change-me-dev-jwt-secret',
    NODE_ENV: 'development',
  };
  const prod: NodeJS.ProcessEnv = { PUBLIC_URL: 'https://bots.example.com' };

  it('разрешает dev-секрет вне production и отключает telegramPolling по умолчанию', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.isProduction).toBe(false);
    expect(cfg.jwtSecret).toBe('change-me-dev-jwt-secret');
    expect(cfg.telegramPolling).toBe(false);
  });

  it('включает telegramPolling только при TELEGRAM_POLLING=1', () => {
    expect(loadConfig({ ...baseEnv, TELEGRAM_POLLING: '1' }).telegramPolling).toBe(true);
    expect(loadConfig({ ...baseEnv, TELEGRAM_POLLING: '0' }).telegramPolling).toBe(false);
    expect(loadConfig({ ...baseEnv, TELEGRAM_POLLING: 'true' }).telegramPolling).toBe(false);
  });

  it('разрешает telegramPolling в production и не требует PUBLIC_URL при включённом опросе', () => {
    const cfg = loadConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      JWT_SECRET: 'a-very-strong-production-jwt-secret-key-32-plus-chars',
      TELEGRAM_POLLING: '1',
    });
    expect(cfg.isProduction).toBe(true);
    expect(cfg.telegramPolling).toBe(true);
    expect(cfg.publicUrl).toBeUndefined();
  });

  it('требует PUBLIC_URL в production при выключенном опросе и читает его вне production', () => {
    const strong = 'a-very-strong-production-jwt-secret-key-32-plus-chars';
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: 'production', JWT_SECRET: strong }),
    ).toThrow(/PUBLIC_URL/);
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: 'production', JWT_SECRET: strong, TELEGRAM_POLLING: '0' }),
    ).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ ...baseEnv, PUBLIC_URL: 'http://localhost:3000' }).publicUrl).toBe(
      'http://localhost:3000',
    );
    expect(loadConfig(baseEnv).publicUrl).toBeUndefined();
  });

  it('отклоняет короткий или дефолтный JWT_SECRET в production', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        ...prod,
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me-dev-jwt-secret',
      }),
    ).toThrow(/JWT_SECRET/);

    expect(() =>
      loadConfig({
        ...baseEnv,
        ...prod,
        NODE_ENV: 'production',
        JWT_SECRET: 'short-secret-under-32-chars',
      }),
    ).toThrow(/JWT_SECRET/);

    const validProd = loadConfig({
      ...baseEnv,
      ...prod,
      NODE_ENV: 'production',
      JWT_SECRET: 'a-very-strong-production-jwt-secret-key-32-plus-chars',
    });
    expect(validProd.isProduction).toBe(true);
  });

  it('читает QUEUE_PREFIX при наличии и обрезает пробелы', () => {
    expect(loadConfig(baseEnv).queuePrefix).toBeUndefined();
    expect(loadConfig({ ...baseEnv, QUEUE_PREFIX: '  test-prefix  ' }).queuePrefix).toBe(
      'test-prefix',
    );
    expect(loadConfig({ ...baseEnv, QUEUE_PREFIX: '   ' }).queuePrefix).toBeUndefined();
  });

  it('читает валидный TELEGRAM_PROXY и отклоняет некорректный URL', () => {
    expect(loadConfig(baseEnv).telegramProxy).toBeUndefined();
    expect(loadConfig({ ...baseEnv, TELEGRAM_PROXY: '   ' }).telegramProxy).toBeUndefined();
    expect(
      loadConfig({ ...baseEnv, TELEGRAM_PROXY: '  http://telegram-proxy:10809  ' }).telegramProxy,
    ).toBe('http://telegram-proxy:10809');
    expect(
      loadConfig({ ...baseEnv, TELEGRAM_PROXY: 'https://proxy.example.com:8443' }).telegramProxy,
    ).toBe('https://proxy.example.com:8443');
    expect(() => loadConfig({ ...baseEnv, TELEGRAM_PROXY: 'not-a-url' })).toThrow(
      /TELEGRAM_PROXY/,
    );
    expect(() => loadConfig({ ...baseEnv, TELEGRAM_PROXY: 'socks5://127.0.0.1:1080' })).toThrow(
      /TELEGRAM_PROXY/,
    );
  });

  it('читает VK_API_BASE_URL и VK_POLLING со значениями по умолчанию', () => {
    const def = loadConfig(baseEnv);
    expect(def.vkApiBaseUrl).toBe('https://api.vk.com/method');
    expect(def.vkPollingEnabled).toBe(true);

    expect(
      loadConfig({ ...baseEnv, VK_API_BASE_URL: 'http://127.0.0.1:4099/' }).vkApiBaseUrl,
    ).toBe('http://127.0.0.1:4099');
    expect(loadConfig({ ...baseEnv, VK_POLLING: '0' }).vkPollingEnabled).toBe(false);
    expect(loadConfig({ ...baseEnv, VK_POLLING: '1' }).vkPollingEnabled).toBe(true);
  });
});
