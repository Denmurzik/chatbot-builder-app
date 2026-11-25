import type { PrismaClient } from '@chatbot/db';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock, apiCtorMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  apiCtorMock: vi.fn(),
}));

vi.mock('grammy', () => ({
  Api: vi.fn((token: string, options?: unknown) => {
    apiCtorMock(token, options);
    return { sendMessage: sendMessageMock };
  }),
}));

import { TelegramMessengerGateway } from './messenger-gateway';

describe('TelegramMessengerGateway', () => {
  const vault = new SecretVault(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  const botId = 'bot-1';
  const encrypted = vault.encrypt('123456:TEST-TOKEN', tokenAad(botId));

  const prisma = {
    messengerConnection: {
      findUnique: vi.fn().mockResolvedValue({
        botId,
        messenger: 'TELEGRAM',
        tokenCipher: encrypted.cipherText,
        tokenMask: encrypted.mask,
      }),
    },
  } as unknown as PrismaClient;

  const gateway = new TelegramMessengerGateway(prisma, vault, {
    databaseUrl: 'postgresql://unused',
    redisUrl: 'redis://unused',
    queuePrefix: 'test',
  });

  beforeEach(() => {
    sendMessageMock.mockReset();
    apiCtorMock.mockClear();
  });

  it('отправляет системное сообщение как обычный текст, а вопрос с кнопками — с клавиатурой', async () => {
    await gateway.sendMessages(botId, 'tg:12345', [
      { kind: 'system', text: 'Диалог остановлен: сценарий зациклился', blockId: 'b1' },
      { kind: 'text', text: 'Привет' },
      {
        kind: 'question',
        text: 'Выберите',
        buttons: [{ label: 'Да', callbackData: 'q:0' }],
      },
    ]);

    expect(apiCtorMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledTimes(3);
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      1,
      12345,
      'Диалог остановлен: сценарий зациклился',
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(2, 12345, 'Привет');
    expect(sendMessageMock).toHaveBeenNthCalledWith(3, 12345, 'Выберите', {
      reply_markup: { inline_keyboard: [[{ text: 'Да', callback_data: 'q:0' }]] },
    });
  });
});
