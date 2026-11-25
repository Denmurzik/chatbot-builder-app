import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Scenario } from '@chatbot/model';
import { tokenAad } from '@chatbot/vault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoopHttpRequestLauncher } from '../http/http-request-launcher';
import { createTestEnv, waitFor, type TestEnv } from '../testing/test-env';

interface CapturedVkCall {
  path: string;
  params: Record<string, string>;
}

// Сценарий: старт → вопрос с кнопками → подтверждение выбранного варианта → выход
const vkChoiceScenario: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    {
      id: 'choice',
      type: 'OPTION_CHOICE',
      title: 'Выбор',
      x: 0,
      y: 0,
      question: 'Подтвердить запись?',
      options: ['Да', 'Нет'],
      variableName: 'answer',
    },
    {
      id: 'confirm',
      type: 'TEXT_MESSAGE',
      title: 'Подтверждение',
      x: 0,
      y: 0,
      text: 'Ваш выбор: {{answer}}',
    },
    { id: 'end', type: 'EXIT_POINT', title: 'Конец', x: 0, y: 0 },
  ],
  transitions: [
    { source: { blockId: 'start', output: 'default' }, target: 'choice' },
    { source: { blockId: 'choice', output: 'Да' }, target: 'confirm' },
    { source: { blockId: 'choice', output: 'Нет' }, target: 'confirm' },
    { source: { blockId: 'confirm', output: 'default' }, target: 'end' },
  ],
};

describe('VK-шлюз в реальном диалоге (PostgreSQL + Redis + mock VK API)', () => {
  let env: TestEnv;
  let server: http.Server;
  const vkCalls: CapturedVkCall[] = [];
  let nextMessageId = 1;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
        vkCalls.push({ path: req.url ?? '', params });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: nextMessageId++ }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const vkApiBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/method`;

    env = await createTestEnv({
      launcher: new NoopHttpRequestLauncher(),
      useRealMessengerGateway: true,
      vkApiBaseUrl,
    });
  }, 120000);

  afterAll(async () => {
    await env?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('проводит многошаговый диалог vk:123456: START_COMMAND → клавиатура → BUTTON_PRESS → итог', async () => {
    const bot = await env.createBot(vkChoiceScenario);
    const vkToken = 'vk1.a.INTEGRATION_TEST_TOKEN';
    const encrypted = env.vault.encrypt(vkToken, tokenAad(bot.id, 'VK'));
    await env.db.messengerConnection.create({
      data: {
        botId: bot.id,
        messenger: 'VK',
        tokenCipher: encrypted.cipherText,
        tokenMask: encrypted.mask,
        tokenHash: env.vault.hash(vkToken),
        config: { groupId: 12345, mode: 'longpoll' },
      },
    });

    // Шаг 1: старт диалога → VK должен получить вопрос с inline-клавиатурой
    await env.emit({
      type: 'START_COMMAND',
      channel: 'MESSENGER',
      botId: bot.id,
      chatId: 'vk:123456',
      userId: 'vk:123456',
    });
    await waitFor(() => vkCalls.length >= 1);

    const first = vkCalls[0];
    expect(first.path).toBe('/method/messages.send');
    expect(first.params.v).toBe('5.199');
    expect(first.params.access_token).toBe(vkToken);
    expect(first.params.peer_id).toBe('123456');
    expect(first.params.message).toBe('Подтвердить запись?');

    const keyboard = JSON.parse(first.params.keyboard) as {
      inline: boolean;
      buttons: { action: { type: string; label: string; payload: string } }[][];
    };
    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons).toHaveLength(2);
    expect(keyboard.buttons[0][0].action.type).toBe('callback');
    expect(keyboard.buttons[0][0].action.label).toBe('Да');

    const { callbackData } = JSON.parse(keyboard.buttons[0][0].action.payload) as {
      callbackData: string;
    };

    // Шаг 2: нажатие кнопки → VK должен получить финальное подтверждение
    await env.emit({
      type: 'BUTTON_PRESS',
      channel: 'MESSENGER',
      botId: bot.id,
      chatId: 'vk:123456',
      userId: 'vk:123456',
      payload: callbackData,
    });
    await waitFor(() => vkCalls.length >= 2);

    const second = vkCalls[1];
    expect(second.path).toBe('/method/messages.send');
    expect(second.params.peer_id).toBe('123456');
    expect(second.params.message).toBe('Ваш выбор: Да');
    expect(second.params.keyboard).toBeUndefined();

    const ctx = await env.db.dialogContext.findFirstOrThrow({
      where: { botId: bot.id, chatId: 'vk:123456' },
    });
    expect(ctx.state).toBe('FINISHED');
    expect(ctx.variables).toEqual({ answer: 'Да' });
  });
});
