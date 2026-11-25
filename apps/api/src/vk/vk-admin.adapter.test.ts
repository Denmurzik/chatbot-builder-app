import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { VkAdminAdapter } from './vk-admin.adapter';
import { VkApiError, type VkApiClient } from './vk-api.client';
import type { VkPollingService } from './vk-polling.service';

function createAdapter(getGroupById: VkApiClient['getGroupById']) {
  const vkApi = { getGroupById } as unknown as VkApiClient;
  const polling = {
    startBot: vi.fn().mockResolvedValue(undefined),
    stopBot: vi.fn().mockResolvedValue(undefined),
  } as unknown as VkPollingService;
  return { adapter: new VkAdminAdapter(vkApi, polling), polling };
}

describe('VkAdminAdapter', () => {
  it('возвращает данные сообщества при валидном токене и совпадении groupId', async () => {
    const { adapter } = createAdapter(async () => ({
      id: 12345,
      name: 'Клиника',
      screenName: 'clinic_bot',
    }));
    await expect(adapter.verifyToken('vk1.a.tok', { groupId: 12345 })).resolves.toEqual({
      groupId: 12345,
      groupName: 'Клиника',
      username: 'clinic_bot',
    });
  });

  it('возвращает null, если groupId сообщества не совпадает с указанным', async () => {
    const { adapter } = createAdapter(async () => ({
      id: 99999,
      name: 'Другая',
      screenName: 'other',
    }));
    await expect(adapter.verifyToken('vk1.a.tok', { groupId: 12345 })).resolves.toBeNull();
  });

  it('ошибки авторизации VK (коды 5, 15, 27, 100) возвращают null', async () => {
    for (const code of [5, 15, 27, 100]) {
      const { adapter } = createAdapter(() => Promise.reject(new VkApiError(code, 'denied')));
      await expect(adapter.verifyToken('bad', { groupId: 1 })).resolves.toBeNull();
    }
  });

  it('сетевая ошибка и прочие ошибки VK API -> 502 BadGatewayException', async () => {
    const { adapter: net } = createAdapter(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(net.verifyToken('tok', { groupId: 1 })).rejects.toThrow(BadGatewayException);

    const { adapter: internal } = createAdapter(() =>
      Promise.reject(new VkApiError(10, 'Internal server error')),
    );
    await expect(internal.verifyToken('tok', { groupId: 1 })).rejects.toThrow(
      'VK недоступен, попробуйте позже',
    );
  });

  it('connect запускает Long Poll в режиме LONG_POLL и останавливает в режиме CALLBACK', async () => {
    const { adapter, polling } = createAdapter(async () => ({
      id: 1,
      name: 'G',
      screenName: 'g',
    }));
    await adapter.connect('bot-1', 'tok', { groupId: 123, mode: 'LONG_POLL' });
    expect(polling.startBot).toHaveBeenCalledWith('bot-1', 'tok', 123);

    await adapter.connect('bot-1', 'tok', { groupId: 123, mode: 'CALLBACK' });
    expect(polling.stopBot).toHaveBeenCalledWith('bot-1');

    await adapter.disconnect('bot-1', 'tok');
    expect(polling.stopBot).toHaveBeenCalledWith('bot-1', 'tok');
  });
});
