import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MSG_LOOP } from '@chatbot/engine-core';
import type { ChatEvent, PreviewEvent, Scenario } from '@chatbot/model';
import { createRedisConnection } from '@chatbot/queue';
import { envAad } from '@chatbot/vault';
import type IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REDIS_URL,
  createTestEnv,
  echoScenario,
  textEvent,
  waitFor,
  type TestEnv,
} from '../testing/test-env';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

// Зацикленный сценарий: старт → присваивание → присваивание (бесконечный цикл)
const loopScenario: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    { id: 'inc', type: 'ASSIGNMENT', title: 'Счётчик', x: 0, y: 0, variableName: 'n', expression: '1' },
  ],
  transitions: [
    { source: { blockId: 'start', output: 'default' }, target: 'inc' },
    { source: { blockId: 'inc', output: 'default' }, target: 'inc' },
  ],
};

// Сценарий с HTTP-запросом, использующим переменные окружения проекта
function httpPreviewScenario(): Scenario {
  return {
    formatVersion: 1,
    blocks: [
      { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
      {
        id: 'req',
        type: 'HTTP_REQUEST',
        title: 'Запрос',
        x: 0,
        y: 0,
        method: 'GET',
        url: '{{env.API_URL}}/ping',
        headers: [{ name: 'X-Preview-Key', value: '{{env.API_KEY}}', secret: false }],
        body: '',
        variableName: 'resp',
        errorVariable: 'err',
        timeoutSec: 5,
        retryCount: 0,
        retryIntervalSec: 0,
        errorStrategy: 'EXIT_ERROR',
        suspendText: null,
        responseMappings: [{ jsonPath: '$.ok', variableName: 'result' }],
      },
      { id: 'ok', type: 'TEXT_MESSAGE', title: 'Ответ', x: 0, y: 0, text: 'Ответ: {{result}}' },
      { id: 'bad', type: 'TEXT_MESSAGE', title: 'Ошибка', x: 0, y: 0, text: 'Ошибка HTTP' },
      { id: 'end', type: 'EXIT_POINT', title: 'Конец', x: 0, y: 0 },
    ],
    transitions: [
      { source: { blockId: 'start', output: 'default' }, target: 'req' },
      { source: { blockId: 'req', output: 'success' }, target: 'ok' },
      { source: { blockId: 'req', output: 'error' }, target: 'bad' },
      { source: { blockId: 'ok', output: 'default' }, target: 'end' },
      { source: { blockId: 'bad', output: 'default' }, target: 'end' },
    ],
  } as Scenario;
}

function previewEvent(
  chatId: string,
  payload: string,
  type: ChatEvent['type'] = 'TEXT_MESSAGE',
): ChatEvent {
  return {
    type,
    channel: 'PREVIEW',
    botId: null,
    chatId,
    userId: 'author-1',
    payload,
  };
}

describe('Канал превью: публикация событий в Redis (PostgreSQL + Redis)', () => {
  let env: TestEnv;
  let server: http.Server;
  let handler: Handler = (_req, res) => res.end('{}');
  let apiUrl = '';
  const seenHeaders: http.IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seenHeaders.push(req.headers);
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    env = await createTestEnv();
  }, 120000);

  afterAll(async () => {
    await env?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function createProject(scenario: Scenario, environment: unknown[] = []) {
    const author = await env.db.author.create({
      data: { email: `${randomUUID()}@x.ru`, passwordHash: 'h' },
    });
    return env.db.project.create({
      data: {
        authorId: author.id,
        name: 'preview-project',
        scenario: scenario as object,
        environment: environment as object[],
      },
    });
  }

  // Подписывается на Redis pub/sub канал `preview:<chatId>` и собирает полученные PreviewEvent
  async function subscribePreview(chatId: string): Promise<{
    events: PreviewEvent[];
    close: () => Promise<void>;
  }> {
    const sub: IORedis = createRedisConnection(REDIS_URL);
    const events: PreviewEvent[] = [];
    const channel = `preview:${chatId}`;
    sub.on('message', (ch, raw) => {
      if (ch === channel) {
        events.push(JSON.parse(raw) as PreviewEvent);
      }
    });
    await sub.subscribe(channel);
    return {
      events,
      async close() {
        await sub.unsubscribe(channel);
        await sub.quit();
      },
    };
  }

  it('эхо-сценарий: подписчик получает message, currentBlock, variables по порядку, шлюз мессенджера не вызывается', async () => {
    const project = await createProject(echoScenario);
    const chatId = `preview:${project.id}:sess-echo`;
    const sub = await subscribePreview(chatId);
    const sentBefore = env.gateway.sent.length;

    try {
      await env.emit(previewEvent(chatId, 'старт', 'START_COMMAND'));
      await waitFor(() => sub.events.length >= 3);

      expect(sub.events.slice(0, 3)).toEqual([
        { type: 'message', message: { kind: 'question', text: 'Что сказать?', buttons: [] } },
        { type: 'currentBlock', blockId: 'ask' },
        { type: 'variables', variables: {} },
      ]);

      // Ответ пользователя на TEXT_INPUT → два сообщения (эхо + повторный вопрос), currentBlock, variables
      await env.emit(previewEvent(chatId, 'привет'));
      await waitFor(() => sub.events.length >= 7);

      expect(sub.events.slice(3, 7)).toEqual([
        { type: 'message', message: { kind: 'text', text: 'Вы сказали: привет' } },
        { type: 'message', message: { kind: 'question', text: 'Что сказать?', buttons: [] } },
        { type: 'currentBlock', blockId: 'ask' },
        { type: 'variables', variables: { msg: 'привет' } },
      ]);

      // В FakeMessengerGateway ничего не ушло
      expect(env.gateway.sent.length).toBe(sentBefore);
    } finally {
      await sub.close();
    }
  });

  it('два сеанса превью с разными chatId и бот с тем же chatId — три разных контекста', async () => {
    const project = await createProject(echoScenario);
    const bot = await env.createBot(echoScenario);
    const chatId1 = `preview:${project.id}:sess-1`;
    const chatId2 = `preview:${project.id}:sess-2`;
    const sub1 = await subscribePreview(chatId1);
    const sub2 = await subscribePreview(chatId2);

    try {
      // Запускаем два превью-сеанса и бота с тем же chatId1
      await env.emit(previewEvent(chatId1, 'старт', 'START_COMMAND'));
      await env.emit(previewEvent(chatId2, 'старт', 'START_COMMAND'));
      await env.emit(textEvent(bot.id, chatId1, 'старт'));

      await waitFor(
        () =>
          sub1.events.length >= 3 &&
          sub2.events.length >= 3 &&
          env.texts(bot.id, chatId1).includes('Что сказать?'),
      );

      // Отправляем разные ответы в каждый из трёх диалогов
      await env.emit(previewEvent(chatId1, 'первый'));
      await env.emit(previewEvent(chatId2, 'второй'));
      await env.emit(textEvent(bot.id, chatId1, 'третий'));

      await waitFor(
        () =>
          sub1.events.length >= 7 &&
          sub2.events.length >= 7 &&
          env.texts(bot.id, chatId1).includes('Вы сказали: третий'),
      );

      const contexts = await env.db.dialogContext.findMany({
        where: { chatId: { in: [chatId1, chatId2] } },
      });
      expect(contexts).toHaveLength(3);

      const previewCtx1 = contexts.find((c) => c.botId === null && c.chatId === chatId1);
      const previewCtx2 = contexts.find((c) => c.botId === null && c.chatId === chatId2);
      const botCtx = contexts.find((c) => c.botId === bot.id && c.chatId === chatId1);

      expect(previewCtx1?.variables).toEqual({ msg: 'первый' });
      expect(previewCtx2?.variables).toEqual({ msg: 'второй' });
      expect(botCtx?.variables).toEqual({ msg: 'третий' });
    } finally {
      await sub1.close();
      await sub2.close();
    }
  });

  it('зацикленный сценарий публикует системное сообщение с blockId без дубля в message', async () => {
    const project = await createProject(loopScenario);
    const chatId = `preview:${project.id}:sess-loop`;
    const sub = await subscribePreview(chatId);

    try {
      await env.emit(previewEvent(chatId, 'старт', 'START_COMMAND'));
      await waitFor(() => sub.events.some((e) => e.type === 'variables'));

      expect(sub.events.filter((e) => e.type === 'message')).toEqual([]);
      expect(sub.events.find((e) => e.type === 'system')).toEqual({
        type: 'system',
        text: MSG_LOOP,
        blockId: 'inc',
      });
      expect(sub.events.find((e) => e.type === 'currentBlock')).toEqual({
        type: 'currentBlock',
        blockId: 'inc',
      });
    } finally {
      await sub.close();
    }
  });

  it('неверный ввод на OPTION_CHOICE публикует подсказку как system (blockId: null) и повтор вопроса как message', async () => {
    const choiceScenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'pick',
          type: 'OPTION_CHOICE',
          title: 'Выбор',
          x: 0,
          y: 0,
          question: 'Выберите вариант',
          options: ['Да', 'Нет'],
          variableName: 'ans',
        },
        { id: 'end', type: 'EXIT_POINT', title: 'Конец', x: 0, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'start', output: 'default' }, target: 'pick' },
        { source: { blockId: 'pick', output: 'Да' }, target: 'end' },
        { source: { blockId: 'pick', output: 'Нет' }, target: 'end' },
      ],
    };
    const project = await createProject(choiceScenario);
    const chatId = `preview:${project.id}:sess-choice`;
    const sub = await subscribePreview(chatId);

    try {
      await env.emit(previewEvent(chatId, 'старт', 'START_COMMAND'));
      await waitFor(() => sub.events.length >= 3);

      await env.emit(previewEvent(chatId, 'неизвестно'));
      await waitFor(() => sub.events.length >= 7);

      expect(sub.events.slice(3, 7)).toEqual([
        { type: 'system', text: 'Пожалуйста, выберите вариант кнопкой.', blockId: null },
        {
          type: 'message',
          message: {
            kind: 'question',
            text: 'Выберите вариант',
            buttons: [
              { label: 'Да', callbackData: 'pick:0' },
              { label: 'Нет', callbackData: 'pick:1' },
            ],
          },
        },
        { type: 'currentBlock', blockId: 'pick' },
        { type: 'variables', variables: {} },
      ]);
    } finally {
      await sub.close();
    }
  });

  it('HTTP-блок в превью использует окружение проекта и публикует ответ после завершения запроса', async () => {
    const project = await createProject(httpPreviewScenario());
    const secretKey = 'preview-secret-token-999';
    const encrypted = env.vault.encrypt(secretKey, envAad(project.id, 'API_KEY'));
    await env.db.project.update({
      where: { id: project.id },
      data: {
        environment: [
          { name: 'API_URL', value: apiUrl, secret: false },
          { name: 'API_KEY', secret: true, secretValue: encrypted },
        ],
      },
    });

    handler = (_req, res) => res.end(JSON.stringify({ ok: 'да' }));
    const chatId = `preview:${project.id}:sess-http`;
    const sub = await subscribePreview(chatId);

    try {
      await env.emit(previewEvent(chatId, 'старт', 'START_COMMAND'));
      await waitFor(() =>
        sub.events.some(
          (e) => e.type === 'message' && e.message.kind === 'text' && e.message.text === 'Ответ: да',
        ),
      );

      // Запрос ушёл с расшифрованным секретом из окружения проекта
      expect(seenHeaders.some((h) => h['x-preview-key'] === secretKey)).toBe(true);

      // В БД секрет замаскирован
      const ctx = await env.db.dialogContext.findFirstOrThrow({
        where: { botId: null, chatId },
      });
      const reqRow = await env.db.httpRequest.findFirstOrThrow({
        where: { dialogContextId: ctx.id },
      });
      expect(reqRow.status).toBe('SUCCEEDED');
      expect(JSON.stringify(reqRow)).not.toContain(secretKey);
    } finally {
      await sub.close();
    }
  });

  it('невалидный черновик project.scenario публикует системное сообщение с описанием ошибки', async () => {
    const project = await createProject({ formatVersion: 1, blocks: 'invalid' } as unknown as Scenario);
    const chatId = `preview:${project.id}:sess-invalid`;
    const sub = await subscribePreview(chatId);

    try {
      await env.emit(previewEvent(chatId, 'старт', 'START_COMMAND'));
      await waitFor(() => sub.events.some((e) => e.type === 'system'));

      const systemEvent = sub.events.find((e) => e.type === 'system');
      expect(systemEvent).toEqual({
        type: 'system',
        text: expect.stringContaining('Ошибка сценария:'),
        blockId: null,
      });
    } finally {
      await sub.close();
    }
  });
});
