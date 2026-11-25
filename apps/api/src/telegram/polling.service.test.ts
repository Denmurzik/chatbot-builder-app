import { beforeEach, describe, expect, it, vi } from 'vitest';

const started: Array<{
  token: string;
  options: unknown;
  stop: ReturnType<typeof vi.fn>;
}> = [];

// Подмена grammY: опрос не ходит в сеть
vi.mock('grammy', () => ({
  Bot: class {
    readonly stop = vi.fn(async () => undefined);
    constructor(
      readonly token: string,
      readonly options?: unknown,
    ) {
      started.push({ token, options, stop: this.stop });
    }
    use(): void {}
    start(): Promise<void> {
      return new Promise(() => undefined);
    }
  },
  Api: class {},
  GrammyError: class extends Error {},
}));

import { tokenAad } from '@chatbot/vault';
import type { ApiConfig } from '../config';
import { PollingService } from './polling.service';
import { TelegramWebhookService } from './telegram-webhook.service';

beforeEach(() => {
  started.length = 0;
});

describe('PollingService', () => {
  it('disconnect(old) после connect(new) не останавливает опрос с новым токеном', async () => {
    const config = { telegramPolling: true } as ApiConfig;
    const polling = new PollingService(config, {} as never, {} as never, {} as never);
    const api = { create: () => ({ deleteWebhook: async () => undefined }) };
    const service = new TelegramWebhookService(config, api as never, polling);

    await service.connect('bot-1', 'T1');
    await service.connect('bot-1', 'T2'); // перезапуск: T1 остановлен
    await service.disconnect('bot-1', 'T1'); // старый токен: опрос с T2 не трогаем

    const t1 = started.find((b) => b.token === 'T1')!;
    const t2 = started.find((b) => b.token === 'T2')!;
    expect(t1.stop).toHaveBeenCalledTimes(1);
    expect(t2.stop).not.toHaveBeenCalled();

    await service.disconnect('bot-1', 'T2');
    expect(t2.stop).toHaveBeenCalledTimes(1);
  });

  it('при старте поднимает опрос опубликованных Telegram-ботов и передаёт опции прокси в Bot', async () => {
    const config = {
      telegramPolling: true,
      telegramProxy: 'http://telegram-proxy:10809',
    } as ApiConfig;
    const findMany = vi.fn(async () => [{ botId: 'bot-1' }, { botId: 'bot-2' }]);
    const findUnique = vi.fn(async ({ where }: { where: { botId_messenger: { botId: string } } }) => ({
      botId: where.botId_messenger.botId,
      tokenCipher: `cipher-${where.botId_messenger.botId}`,
      tokenMask: 'mask',
    }));
    const prisma = { client: { messengerConnection: { findMany, findUnique } } };
    const decrypt = vi.fn((secret: { cipherText: string }) => `plain-${secret.cipherText}`);
    const polling = new PollingService(config, prisma as never, {} as never, { decrypt } as never);

    await polling.onApplicationBootstrap();

    expect(findMany).toHaveBeenCalledWith({
      where: { messenger: 'TELEGRAM', bot: { status: 'PUBLISHED' } },
    });
    expect(decrypt).toHaveBeenCalledWith(
      { cipherText: 'cipher-bot-1', mask: 'mask' },
      tokenAad('bot-1'),
    );
    expect(started).toHaveLength(2);
    expect(started.map((b) => b.token)).toEqual(['plain-cipher-bot-1', 'plain-cipher-bot-2']);
    for (const bot of started) {
      expect(bot.options).toEqual({
        client: { fetch: expect.any(Function) },
      });
    }

    await polling.beforeApplicationShutdown();
  });

  it('не передаёт client-опции без TELEGRAM_PROXY и не запускает опрос при telegramPolling=false', async () => {
    const findMany = vi.fn(async () => [{ botId: 'bot-1' }]);
    const prisma = { client: { messengerConnection: { findMany } } };

    const disabled = new PollingService(
      { telegramPolling: false } as ApiConfig,
      prisma as never,
      {} as never,
      {} as never,
    );
    await disabled.onApplicationBootstrap();
    expect(findMany).not.toHaveBeenCalled();
    expect(started).toHaveLength(0);

    const direct = new PollingService(
      { telegramPolling: true } as ApiConfig,
      {} as never,
      {} as never,
      {} as never,
    );
    await direct.ensureBot('bot-1', 'TOKEN-DIRECT');
    expect(started).toHaveLength(1);
    expect(started[0]?.options).toBeUndefined();
    await direct.beforeApplicationShutdown();
  });
});
