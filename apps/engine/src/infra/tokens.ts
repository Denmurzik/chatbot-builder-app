// Токены внедрения зависимостей и конфигурация приложения engine
export const APP_CONFIG = Symbol('APP_CONFIG');
export const PRISMA = Symbol('PRISMA');
export const EVENT_QUEUE = Symbol('EVENT_QUEUE');

// Адрес VK API по умолчанию
export const DEFAULT_VK_API_BASE_URL = 'https://api.vk.com/method';

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  // Префикс ключей BullMQ (в тестах — уникальный)
  queuePrefix?: string;
  // URL HTTP-прокси для исходящих запросов к Telegram Bot API
  telegramProxy?: string;
  // Базовый URL VK API (по умолчанию https://api.vk.com/method)
  vkApiBaseUrl?: string;
}
