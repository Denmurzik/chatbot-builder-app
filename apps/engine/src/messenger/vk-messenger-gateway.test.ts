import type { PrismaClient } from '@chatbot/db';
import { SecretVault, tokenAad } from '@chatbot/vault';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { VkMessengerGateway } from './vk-messenger-gateway';

describe('VkMessengerGateway', () => {
  const vault = new SecretVault(Buffer.alloc(32, 3), Buffer.alloc(32, 4));
  const botId = 'bot-vk-1';
  const encrypted = vault.encrypt('vk1.a.TEST_ACCESS_TOKEN', tokenAad(botId, 'VK'));

  const findUniqueMock = vi.fn();
  const prisma = {
    messengerConnection: {
      findUnique: findUniqueMock,
    },
  } as unknown as PrismaClient;

  const gateway = new VkMessengerGateway(prisma, vault, {
    databaseUrl: 'postgresql://unused',
    redisUrl: 'redis://unused',
    vkApiBaseUrl: 'http://127.0.0.1:49999/method',
  });

  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue({
      botId,
      messenger: 'VK',
      tokenCipher: encrypted.cipherText,
      tokenMask: encrypted.mask,
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ response: 101 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('не обращается к БД и VK API при пустой пачке сообщений', async () => {
    await gateway.sendMessages(botId, 'vk:12345', []);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('расшифровывает токен один раз на пачку и отправляет текст, системное и вопрос с inline-клавиатурой', async () => {
    const decryptSpy = vi.spyOn(vault, 'decrypt');
    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify({ response: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await gateway.sendMessages(botId, 'vk:98765', [
      { kind: 'system', text: 'Системное уведомление', blockId: 'b1' },
      { kind: 'text', text: 'Привет' },
      {
        kind: 'question',
        text: 'Выберите',
        buttons: [{ label: 'Да', callbackData: 'q:0' }],
      },
    ]);

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { botId_messenger: { botId, messenger: 'VK' } },
    });
    expect(decryptSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const calls = fetchSpy.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method,
      params: new URLSearchParams(String(init?.body ?? '')),
    }));

    for (const call of calls) {
      expect(call.url).toBe('http://127.0.0.1:49999/method/messages.send');
      expect(call.method).toBe('POST');
      expect(call.params.get('v')).toBe('5.199');
      expect(call.params.get('access_token')).toBe('vk1.a.TEST_ACCESS_TOKEN');
      expect(call.params.get('peer_id')).toBe('98765');
      const randomId = Number(call.params.get('random_id'));
      expect(Number.isInteger(randomId) && randomId > 0 && randomId < 2_147_483_647).toBe(true);
    }

    expect(calls[0].params.get('message')).toBe('Системное уведомление');
    expect(calls[0].params.get('keyboard')).toBeNull();
    expect(calls[1].params.get('message')).toBe('Привет');
    expect(calls[1].params.get('keyboard')).toBeNull();
    expect(calls[2].params.get('message')).toBe('Выберите');
    expect(JSON.parse(calls[2].params.get('keyboard')!)).toEqual({
      inline: true,
      buttons: [
        [{ action: { type: 'callback', label: 'Да', payload: '{"callbackData":"q:0"}' } }],
      ],
    });

    decryptSpy.mockRestore();
  });

  it('бросает понятную ошибку, если у бота нет подключения к VK', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(
      gateway.sendMessage(botId, 'vk:123', { kind: 'text', text: 'Привет' }),
    ).rejects.toThrow(/нет подключения к VK/);
  });

  it('бросает ошибку при неуспешном HTTP-статусе VK API', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
    await expect(
      gateway.sendMessage(botId, 'vk:123', { kind: 'text', text: 'Привет' }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it('бросает ошибку с кодом и текстом при VK JSON error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { error_code: 901, error_msg: "Can't send messages for users without permission" } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(
      gateway.sendMessage(botId, 'vk:123', { kind: 'text', text: 'Привет' }),
    ).rejects.toThrow(/901.*without permission/);
  });
});
