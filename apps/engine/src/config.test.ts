import { describe, expect, it } from 'vitest';
import { loadAllowedHosts, loadConfig } from './config';

describe('loadConfig (engine)', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot',
    REDIS_URL: 'redis://127.0.0.1:56379',
  };

  it('читает DATABASE_URL, REDIS_URL, дефолтный VK_API_BASE_URL и опциональный QUEUE_PREFIX', () => {
    expect(loadConfig(baseEnv)).toEqual({
      databaseUrl: baseEnv.DATABASE_URL,
      redisUrl: baseEnv.REDIS_URL,
      vkApiBaseUrl: 'https://api.vk.com/method',
    });
    expect(loadConfig({ ...baseEnv, QUEUE_PREFIX: '  eng-prefix  ' }).queuePrefix).toBe(
      'eng-prefix',
    );
    expect(loadConfig({ ...baseEnv, QUEUE_PREFIX: '   ' }).queuePrefix).toBeUndefined();
  });

  it('читает валидный VK_API_BASE_URL, убирает завершающий слэш и отклоняет некорректный URL', () => {
    expect(loadConfig({ ...baseEnv, VK_API_BASE_URL: '   ' }).vkApiBaseUrl).toBe(
      'https://api.vk.com/method',
    );
    expect(
      loadConfig({ ...baseEnv, VK_API_BASE_URL: '  http://127.0.0.1:4020/method///  ' })
        .vkApiBaseUrl,
    ).toBe('http://127.0.0.1:4020/method');
    expect(
      loadConfig({ ...baseEnv, VK_API_BASE_URL: 'https://vk.example.com/api' }).vkApiBaseUrl,
    ).toBe('https://vk.example.com/api');
    expect(() => loadConfig({ ...baseEnv, VK_API_BASE_URL: 'not-a-url' })).toThrow(
      /VK_API_BASE_URL/,
    );
    expect(() => loadConfig({ ...baseEnv, VK_API_BASE_URL: 'ftp://vk.example.com' })).toThrow(
      /VK_API_BASE_URL/,
    );
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
});

describe('loadAllowedHosts', () => {
  it('не задано или пусто — null (без ограничений)', () => {
    expect(loadAllowedHosts({})).toBeNull();
    expect(loadAllowedHosts({ HTTP_ALLOWED_HOSTS: ' , ' })).toBeNull();
  });

  it('разбирает список через запятую в нижнем регистре', () => {
    expect(loadAllowedHosts({ HTTP_ALLOWED_HOSTS: 'Mock-Clinic, api.example.com ' })).toEqual([
      'mock-clinic',
      'api.example.com',
    ]);
  });
});
