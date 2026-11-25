import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config';
import type { VkUpdate } from './vk-update-mapper';

const VK_API_VERSION = '5.199';

export interface VkGroupInfo {
  id: number;
  name: string;
  screenName: string;
}

export interface VkLongPollServerInfo {
  key: string;
  server: string;
  ts: string;
}

export interface VkLongPollResponse {
  ts?: string;
  updates?: VkUpdate[];
  failed?: number;
}

// Ошибка, возвращённая VK API в поле error JSON-ответа
export class VkApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`VK API error ${code}: ${message}`);
    this.name = 'VkApiError';
  }
}

interface VkRawGroup {
  id?: number;
  name?: string;
  screen_name?: string;
}

interface VkApiEnvelope<T> {
  response?: T;
  error?: {
    error_code?: number;
    error_msg?: string;
  };
}

// HTTP-клиент VK API (v5.199) на встроенном fetch без сторонних зависимостей
@Injectable()
export class VkApiClient {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  private async callMethod<T>(
    method: string,
    token: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const body = new URLSearchParams({
      ...params,
      v: VK_API_VERSION,
      access_token: token,
    });
    const url = `${this.config.vkApiBaseUrl}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`VK API HTTP ${response.status}`);
    }
    const data = (await response.json()) as VkApiEnvelope<T>;
    if (data.error) {
      throw new VkApiError(data.error.error_code ?? 0, data.error.error_msg ?? 'Unknown error');
    }
    if (data.response === undefined) {
      throw new Error('Пустой ответ VK API');
    }
    return data.response;
  }

  // Проверяет токен и возвращает данные сообщества (groups.getById)
  async getGroupById(token: string, groupId?: number): Promise<VkGroupInfo> {
    const params: Record<string, string> = {};
    if (groupId !== undefined) {
      params.group_id = String(groupId);
    }
    const res = await this.callMethod<{ groups?: VkRawGroup[] } | VkRawGroup[]>(
      'groups.getById',
      token,
      params,
    );
    const list = Array.isArray(res) ? res : (res.groups ?? []);
    const group = list[0];
    if (!group || typeof group.id !== 'number') {
      throw new VkApiError(100, 'Сообщество не найдено');
    }
    return {
      id: group.id,
      name: group.name ?? '',
      screenName: group.screen_name ?? '',
    };
  }

  // Получает параметры Bots Long Poll сервера сообщества (groups.getLongPollServer)
  async getLongPollServer(token: string, groupId: number): Promise<VkLongPollServerInfo> {
    const res = await this.callMethod<{ key?: string; server?: string; ts?: string | number }>(
      'groups.getLongPollServer',
      token,
      { group_id: String(groupId) },
    );
    if (!res.key || !res.server || res.ts === undefined) {
      throw new Error('Некорректный ответ groups.getLongPollServer');
    }
    return {
      key: res.key,
      server: res.server,
      ts: String(res.ts),
    };
  }

  // Выполняет один запрос long polling к серверу VK
  async pollLongPoll(
    server: string,
    key: string,
    ts: string,
    signal: AbortSignal,
    wait = 25,
  ): Promise<VkLongPollResponse> {
    const separator = server.includes('?') ? '&' : '?';
    const url =
      `${server}${separator}act=a_check` +
      `&key=${encodeURIComponent(key)}` +
      `&ts=${encodeURIComponent(ts)}` +
      `&wait=${wait}`;
    const response = await fetch(url, { method: 'GET', signal });
    if (!response.ok) {
      throw new Error(`VK Long Poll HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      ts?: string | number;
      updates?: VkUpdate[];
      failed?: number;
    };
    return {
      ...(data.ts !== undefined ? { ts: String(data.ts) } : {}),
      ...(Array.isArray(data.updates) ? { updates: data.updates } : {}),
      ...(typeof data.failed === 'number' ? { failed: data.failed } : {}),
    };
  }

  // Отвечает на callback-кнопку (снимает спиннер в клиенте VK)
  async sendMessageEventAnswer(
    token: string,
    params: { eventId: string; userId: number; peerId: number },
  ): Promise<void> {
    await this.callMethod<number>('messages.sendMessageEventAnswer', token, {
      event_id: params.eventId,
      user_id: String(params.userId),
      peer_id: String(params.peerId),
    });
  }
}
