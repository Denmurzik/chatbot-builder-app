import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositeMessengerGateway } from './composite-messenger-gateway';
import type { TelegramMessengerGateway } from './messenger-gateway';
import type { VkMessengerGateway } from './vk-messenger-gateway';

describe('CompositeMessengerGateway', () => {
  const telegram = {
    sendMessage: vi.fn(),
    sendMessages: vi.fn(),
  } as unknown as TelegramMessengerGateway;

  const vk = {
    sendMessage: vi.fn(),
    sendMessages: vi.fn(),
  } as unknown as VkMessengerGateway;

  const composite = new CompositeMessengerGateway(telegram, vk);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('маршрутизирует chatId с префиксом vk: в VkMessengerGateway', async () => {
    const msg = { kind: 'text' as const, text: 'Привет VK' };
    await composite.sendMessage('b1', 'vk:42', msg);
    await composite.sendMessages('b1', 'vk:42', [msg]);

    expect(vk.sendMessage).toHaveBeenCalledWith('b1', 'vk:42', msg);
    expect(vk.sendMessages).toHaveBeenCalledWith('b1', 'vk:42', [msg]);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.sendMessages).not.toHaveBeenCalled();
  });

  it('маршрутизирует tg: и числовой chatId в TelegramMessengerGateway', async () => {
    const msg = { kind: 'text' as const, text: 'Привет TG' };
    await composite.sendMessage('b1', 'tg:100', msg);
    await composite.sendMessages('b1', '100', [msg]);

    expect(telegram.sendMessage).toHaveBeenCalledWith('b1', 'tg:100', msg);
    expect(telegram.sendMessages).toHaveBeenCalledWith('b1', '100', [msg]);
    expect(vk.sendMessage).not.toHaveBeenCalled();
    expect(vk.sendMessages).not.toHaveBeenCalled();
  });
});
