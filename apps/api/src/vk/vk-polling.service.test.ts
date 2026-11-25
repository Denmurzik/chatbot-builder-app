import type { EventQueue } from '@chatbot/queue';
import type { SecretVault } from '@chatbot/vault';
import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../config';
import type { PrismaService } from '../prisma/prisma.module';
import type { VkApiClient, VkLongPollResponse } from './vk-api.client';
import { VkPollingService } from './vk-polling.service';

function makeConfig(vkPollingEnabled = true): ApiConfig {
  return {
    databaseUrl: 'postgresql://localhost/test',
    jwtSecret: 'secret',
    port: 3000,
    nodeEnv: 'test',
    isProduction: false,
    telegramPolling: false,
    vkApiBaseUrl: 'http://127.0.0.1:9999',
    vkPollingEnabled,
  };
}

describe('VkPollingService', () => {
  it('не запускает опрос, если vkPollingEnabled=false', async () => {
    const getLongPollServer = vi.fn();
    const service = new VkPollingService(
      makeConfig(false),
      { client: { messengerConnection: { findMany: vi.fn() } } } as unknown as PrismaService,
      { enqueue: vi.fn() } as unknown as EventQueue,
      {} as unknown as SecretVault,
      { getLongPollServer } as unknown as VkApiClient,
    );
    await service.startBot('bot-1', 'tok', 100);
    expect(getLongPollServer).not.toHaveBeenCalled();
  });

  it('обрабатывает failed=1 (обновляет ts), failed=2 (перезапрашивает сервер) и ставит события в очередь', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const sendMessageEventAnswer = vi.fn().mockResolvedValue(undefined);
    const getLongPollServer = vi
      .fn()
      .mockResolvedValueOnce({ server: 'http://lp/1', key: 'k1', ts: '10' })
      .mockResolvedValueOnce({ server: 'http://lp/2', key: 'k2', ts: '20' });

    let call = 0;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    const pollLongPoll = vi.fn(
      async (
        _server: string,
        _key: string,
        _ts: string,
        signal: AbortSignal,
      ): Promise<VkLongPollResponse> => {
        call += 1;
        if (call === 1) return { failed: 1, ts: '15' };
        if (call === 2) return { failed: 2 };
        if (call === 3) {
          return {
            ts: '21',
            updates: [
              {
                type: 'message_new',
                event_id: 'lp-e1',
                object: { message: { id: 1, peer_id: 50, from_id: 50, text: 'привет' } },
              },
              {
                type: 'message_event',
                object: {
                  event_id: 'lp-btn-1',
                  user_id: 50,
                  peer_id: 50,
                  payload: { callbackData: 'q1:0' },
                },
              },
            ],
          };
        }
        resolveDone();
        // Ждём остановки цикла
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return {};
      },
    );

    const service = new VkPollingService(
      makeConfig(true),
      { client: { messengerConnection: { findMany: vi.fn().mockResolvedValue([]) } } } as unknown as PrismaService,
      { enqueue } as unknown as EventQueue,
      {} as unknown as SecretVault,
      { getLongPollServer, pollLongPoll, sendMessageEventAnswer } as unknown as VkApiClient,
    );

    await service.startBot('bot-lp', 'vk-tok', 777);
    await done;
    await service.stopBot('bot-lp');

    expect(getLongPollServer).toHaveBeenCalledTimes(2);
    expect(pollLongPoll).toHaveBeenNthCalledWith(1, 'http://lp/1', 'k1', '10', expect.any(AbortSignal));
    expect(pollLongPoll).toHaveBeenNthCalledWith(2, 'http://lp/1', 'k1', '15', expect.any(AbortSignal));
    expect(pollLongPoll).toHaveBeenNthCalledWith(3, 'http://lp/2', 'k2', '20', expect.any(AbortSignal));

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      {
        type: 'TEXT_MESSAGE',
        channel: 'MESSENGER',
        botId: 'bot-lp',
        chatId: 'vk:50',
        userId: 'vk:50',
        payload: 'привет',
      },
      'vk-bot-lp-lp-e1',
    );
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      {
        type: 'BUTTON_PRESS',
        channel: 'MESSENGER',
        botId: 'bot-lp',
        chatId: 'vk:50',
        userId: 'vk:50',
        payload: 'q1:0',
        sourceBlockId: 'q1',
      },
      'vk-bot-lp-lp-btn-1',
    );
    expect(sendMessageEventAnswer).toHaveBeenCalledWith('vk-tok', {
      eventId: 'lp-btn-1',
      userId: 50,
      peerId: 50,
    });
  });
});
