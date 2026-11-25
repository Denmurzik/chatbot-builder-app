import { BadGatewayException } from '@nestjs/common';
import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { TelegramAdminAdapter } from './telegram-admin.adapter';
import type { TelegramApiFactory } from './telegram-api.factory';
import type { TelegramWebhookService } from './telegram-webhook.service';

const grammyError = (code: number) =>
  new GrammyError('getMe failed', { ok: false, error_code: code, description: 'x' }, 'getMe', {});

function createAdapter(getMe: () => Promise<{ username?: string }>) {
  const webhook = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as TelegramWebhookService;
  const factory = { create: () => ({ getMe }) } as unknown as TelegramApiFactory;
  return { adapter: new TelegramAdminAdapter(webhook, factory), webhook };
}

describe('TelegramAdminAdapter', () => {
  it('возвращает имя бота для действительного токена', async () => {
    const { adapter } = createAdapter(async () => ({ username: 'my_bot' }));
    await expect(adapter.verifyToken('t')).resolves.toEqual({ username: 'my_bot' });
  });

  it('401 и 404 от Telegram — токен недействителен (null)', async () => {
    for (const code of [401, 404]) {
      const { adapter } = createAdapter(() => Promise.reject(grammyError(code)));
      await expect(adapter.verifyToken('t')).resolves.toBeNull();
    }
  });

  it('сетевая ошибка и прочие ответы Telegram — 502', async () => {
    const { adapter: netAdapter } = createAdapter(() =>
      Promise.reject(new HttpError('net', new Error('down'))),
    );
    await expect(netAdapter.verifyToken('t')).rejects.toThrow(BadGatewayException);

    const { adapter: errAdapter } = createAdapter(() => Promise.reject(grammyError(500)));
    await expect(errAdapter.verifyToken('t')).rejects.toThrow(
      'Telegram недоступен, попробуйте позже',
    );
  });

  it('делегирует connect и disconnect в TelegramWebhookService', async () => {
    const { adapter, webhook } = createAdapter(async () => ({ username: 'my_bot' }));
    await adapter.connect('bot-1', 'tok');
    await adapter.disconnect('bot-1', 'tok');
    expect(webhook.connect).toHaveBeenCalledWith('bot-1', 'tok');
    expect(webhook.disconnect).toHaveBeenCalledWith('bot-1', 'tok');
  });
});
