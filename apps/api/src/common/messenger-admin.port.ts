import type { MessengerType, VkConnectionMode } from '@chatbot/model';
import { Inject, Injectable, Optional } from '@nestjs/common';

// Параметры подключения к мессенджеру (используются для VK; для Telegram не обязательны)
export interface MessengerConnectConfig {
  groupId?: number;
  mode?: VkConnectionMode;
  confirmationCode?: string;
  secret?: string;
}

// Информация о проверенном токене мессенджера
export interface VerifiedMessengerInfo {
  username?: string;
  groupId?: number;
  groupName?: string;
}

// Метаданные подключения VK, хранимые в MessengerConnection.config
export interface VkStoredConfig {
  groupId: number;
  mode: VkConnectionMode;
  confirmationCode?: string;
  secretCipher?: string;
  secretMask?: string;
}

// Разбирает JSON-конфигурацию подключения VK из БД
export function parseVkStoredConfig(raw: unknown): VkStoredConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.groupId !== 'number' || !Number.isInteger(obj.groupId) || obj.groupId <= 0) {
    return null;
  }
  const mode: VkConnectionMode = obj.mode === 'LONG_POLL' ? 'LONG_POLL' : 'CALLBACK';
  return {
    groupId: obj.groupId,
    mode,
    ...(typeof obj.confirmationCode === 'string' && obj.confirmationCode.length > 0
      ? { confirmationCode: obj.confirmationCode }
      : {}),
    ...(typeof obj.secretCipher === 'string' && obj.secretCipher.length > 0
      ? { secretCipher: obj.secretCipher }
      : {}),
    ...(typeof obj.secretMask === 'string' && obj.secretMask.length > 0
      ? { secretMask: obj.secretMask }
      : {}),
  };
}

// Конвертирует сохранённую конфигурацию VK в MessengerConnectConfig (без секрета)
export function toConnectConfig(
  messenger: MessengerType,
  rawConfig: unknown,
): MessengerConnectConfig | undefined {
  if (messenger !== 'VK') return undefined;
  const parsed = parseVkStoredConfig(rawConfig);
  if (!parsed) return undefined;
  return {
    groupId: parsed.groupId,
    mode: parsed.mode,
    ...(parsed.confirmationCode ? { confirmationCode: parsed.confirmationCode } : {}),
  };
}

// Интерфейс адаптера администрирования одного конкретного мессенджера
export interface SingleMessengerAdminAdapter {
  readonly messenger: MessengerType;
  verifyToken(token: string, config?: MessengerConnectConfig): Promise<VerifiedMessengerInfo | null>;
  connect(botId: string, token: string, config?: MessengerConnectConfig): Promise<void>;
  disconnect(botId: string, token: string, config?: MessengerConnectConfig): Promise<void>;
}

export const TELEGRAM_ADMIN_ADAPTER = Symbol('TELEGRAM_ADMIN_ADAPTER');
export const VK_ADMIN_ADAPTER = Symbol('VK_ADMIN_ADAPTER');

// Порт администрирования мессенджеров (базовый слой common: доступен projects, publication, telegram и vk)
export abstract class MessengerAdminPort {
  // Подключает бота к мессенджеру (webhook/callback или polling); ошибка внешней системы -> 502
  abstract connect(
    messenger: MessengerType,
    botId: string,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<void>;

  // Отключает бота от мессенджера (best-effort)
  abstract disconnect(
    messenger: MessengerType,
    botId: string,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<void>;

  // Проверяет токен бота; null — токен недействителен, недоступность мессенджера -> 502
  abstract verifyToken(
    messenger: MessengerType,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<VerifiedMessengerInfo | null>;
}

// Композитный порт, маршрутизирующий вызовы администрирования по типу мессенджера
@Injectable()
export class CompositeMessengerAdminPort extends MessengerAdminPort {
  private readonly adapters = new Map<MessengerType, SingleMessengerAdminAdapter>();

  constructor(
    @Optional() @Inject(TELEGRAM_ADMIN_ADAPTER) telegram?: SingleMessengerAdminAdapter,
    @Optional() @Inject(VK_ADMIN_ADAPTER) vk?: SingleMessengerAdminAdapter,
  ) {
    super();
    if (telegram) this.adapters.set('TELEGRAM', telegram);
    if (vk) this.adapters.set('VK', vk);
  }

  private adapterFor(messenger: MessengerType): SingleMessengerAdminAdapter {
    const adapter = this.adapters.get(messenger);
    if (!adapter) {
      throw new Error(`Адаптер мессенджера ${messenger} не зарегистрирован`);
    }
    return adapter;
  }

  connect(
    messenger: MessengerType,
    botId: string,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<void> {
    return this.adapterFor(messenger).connect(botId, token, config);
  }

  disconnect(
    messenger: MessengerType,
    botId: string,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<void> {
    return this.adapterFor(messenger).disconnect(botId, token, config);
  }

  verifyToken(
    messenger: MessengerType,
    token: string,
    config?: MessengerConnectConfig,
  ): Promise<VerifiedMessengerInfo | null> {
    return this.adapterFor(messenger).verifyToken(token, config);
  }
}
