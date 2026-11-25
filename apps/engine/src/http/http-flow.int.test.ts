import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Scenario } from '@chatbot/model';
import { envAad } from '@chatbot/vault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MSG_WAIT } from '@chatbot/engine-core';
import { createTestEnv, textEvent, waitFor, type TestEnv } from '../testing/test-env';
import { HttpRequestExecutor } from './http-request-executor';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function httpScenario(overrides: Record<string, unknown> = {}): Scenario {
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
        url: '{{env.API_URL}}/slots',
        headers: [{ name: 'X-Trace', value: 'key={{env.API_KEY}}', secret: false }],
        body: '',
        variableName: 'resp',
        errorVariable: 'err',
        timeoutSec: 5,
        retryCount: 0,
        retryIntervalSec: 0,
        errorStrategy: 'EXIT_ERROR',
        suspendText: 'Сервис недоступен, напишите что-нибудь',
        responseMappings: [{ jsonPath: '$.slots', variableName: 'slots' }],
        ...overrides,
      },
      { id: 'ok', type: 'TEXT_MESSAGE', title: 'Ок', x: 0, y: 0, text: 'Слоты: {{slots}}' },
      { id: 'bad', type: 'TEXT_MESSAGE', title: 'Ошибка', x: 0, y: 0, text: 'Ошибка запроса' },
    ],
    transitions: [
      { source: { blockId: 'start', output: 'default' }, target: 'req' },
      { source: { blockId: 'req', output: 'success' }, target: 'ok' },
      { source: { blockId: 'req', output: 'error' }, target: 'bad' },
    ],
  } as Scenario;
}

describe('HTTP-поток: отправка, приём результата, восстановление (PostgreSQL + Redis)', () => {
  let env: TestEnv;
  let server: http.Server;
  let handler: Handler = (_req, res) => res.end('{}');
  let apiUrl = '';
  const seenHeaders: http.IncomingHttpHeaders[] = [];
  const API_KEY = 'super-secret-key-12345';

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

  async function createHttpBot(scenario: Scenario) {
    const bot = await env.createBot(scenario);
    const secret = env.vault.encrypt(API_KEY, envAad(bot.id, 'API_KEY'));
    await env.db.bot.update({
      where: { id: bot.id },
      data: {
        environment: [
          { name: 'API_URL', value: apiUrl, secret: false },
          { name: 'API_KEY', secret: true, secretValue: secret },
        ],
      },
    });
    return bot;
  }

  function contextOf(botId: string, chatId: string) {
    return env.db.dialogContext.findFirstOrThrow({ where: { botId, chatId } });
  }

  it('успешный ответ: переменные сохраняются, сообщение отправлено, секрет замаскирован в БД', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ slots: '10:00, 11:00' }));
    const bot = await createHttpBot(httpScenario());
    await env.emit(textEvent(bot.id, 'tg:h1', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:h1').includes('Слоты: 10:00, 11:00'));

    const ctx = await contextOf(bot.id, 'tg:h1');
    const rows = await env.db.httpRequest.findMany({ where: { dialogContextId: ctx.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SUCCEEDED', responseCode: 200 });
    // Реальный запрос ушёл с расшифрованным секретом, а в БД лежит маска
    expect(seenHeaders.some((h) => h['x-trace'] === `key=${API_KEY}`)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(API_KEY);
    expect(rows[0]!.url).toBe(`${apiUrl}/slots`);
  });

  it('ответ 500 с повтором и EXIT_ERROR ведёт по ветке «ошибка»', async () => {
    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      res.statusCode = 500;
      res.end('boom');
    };
    const bot = await createHttpBot(httpScenario({ retryCount: 1, retryIntervalSec: 0 }));
    await env.emit(textEvent(bot.id, 'tg:h2', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:h2').includes('Ошибка запроса'));

    const ctx = await contextOf(bot.id, 'tg:h2');
    const row = await env.db.httpRequest.findFirstOrThrow({ where: { dialogContextId: ctx.id } });
    expect(row.status).toBe('FAILED');
    expect(calls).toBe(2);
  });

  it('SUSPEND: текст приостановки, затем сообщение пользователя повторяет тот же запрос', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    };
    const bot = await createHttpBot(httpScenario({ errorStrategy: 'SUSPEND' }));
    await env.emit(textEvent(bot.id, 'tg:h3', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:h3').length >= 1);
    expect(env.texts(bot.id, 'tg:h3')).toEqual(['Сервис недоступен, напишите что-нибудь']);
    await waitFor(async () => (await contextOf(bot.id, 'tg:h3')).state === 'SUSPENDED');

    const ctx = await contextOf(bot.id, 'tg:h3');
    const first = await env.db.httpRequest.findFirstOrThrow({ where: { dialogContextId: ctx.id } });

    // Повтор снова падает: снова приостановка с тем же текстом
    await env.emit(textEvent(bot.id, 'tg:h3', 'ещё раз'));
    await waitFor(() => env.texts(bot.id, 'tg:h3').length >= 2);
    await waitFor(async () => (await contextOf(bot.id, 'tg:h3')).state === 'SUSPENDED');
    expect(env.texts(bot.id, 'tg:h3')[1]).toBe('Сервис недоступен, напишите что-нибудь');

    // Сервис ожил: следующее сообщение возобновляет запрос и ведёт по успешной ветке
    handler = (_req, res) => res.end(JSON.stringify({ slots: '12:00' }));
    await env.emit(textEvent(bot.id, 'tg:h3', 'и ещё'));
    await waitFor(() => env.texts(bot.id, 'tg:h3').includes('Слоты: 12:00'));

    const rows = await env.db.httpRequest.findMany({ where: { dialogContextId: ctx.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, status: 'SUCCEEDED', attempt: 2, error: null });
  });

  it('ответ, пришедший после /start, отбрасывается', async () => {
    handler = () => undefined; // запросы висят, ответ подставляется вручную
    const bot = await createHttpBot(httpScenario({ timeoutSec: 30 }));
    await env.emit(textEvent(bot.id, 'tg:h4', 'старт'));
    await waitFor(async () => {
      const row = await env.db.dialogContext.findFirst({
        where: { botId: bot.id, chatId: 'tg:h4' },
      });
      return row?.state === 'WAITING_EXTERNAL';
    });
    const before = await contextOf(bot.id, 'tg:h4');
    const oldId = before.currentRequestId!;

    // /start сбрасывает диалог и запускает новый запрос; ответ на первый становится устаревшим
    await env.emit({
      type: 'START_COMMAND',
      channel: 'MESSENGER',
      botId: bot.id,
      chatId: 'tg:h4',
      userId: 'u1',
    });
    await waitFor(async () => {
      const ctx = await contextOf(bot.id, 'tg:h4');
      return ctx.currentRequestId !== null && ctx.currentRequestId !== oldId;
    });
    const newId = (await contextOf(bot.id, 'tg:h4')).currentRequestId!;

    await env.db.httpRequest.update({
      where: { id: oldId },
      data: { status: 'SUCCEEDED', responseCode: 200, responseBody: '{"slots":"старый"}' },
    });
    await env.queue.enqueue(
      {
        type: 'RESPONSE_RECEIVED',
        channel: 'MESSENGER',
        botId: bot.id,
        chatId: 'tg:h4',
        userId: 'u1',
        requestId: oldId,
      },
      `manual-${oldId}`,
    );
    // Разделы очереди обрабатываются по порядку: ответ на маркер приходит после устаревшего события
    await env.emit(textEvent(bot.id, 'tg:h4', 'маркер'));
    await waitFor(() => env.texts(bot.id, 'tg:h4').includes(MSG_WAIT));
    const after = await contextOf(bot.id, 'tg:h4');
    expect(after.state).toBe('WAITING_EXTERNAL');
    expect(after.currentRequestId).toBe(newId);
    expect(env.texts(bot.id, 'tg:h4')).toEqual([MSG_WAIT]);
  });

  // Диалог в ожидании ответа без живого запроса в процессе: так выглядит состояние после перезапуска
  async function seedInterrupted(botId: string, chatId: string) {
    const ctx = await env.db.dialogContext.create({
      data: {
        botId,
        chatId,
        userId: 'u1',
        channel: 'MESSENGER',
        state: 'WAITING_EXTERNAL',
        currentBlockId: 'req',
        variables: {},
      },
    });
    const row = await env.db.httpRequest.create({
      data: {
        dialogContextId: ctx.id,
        blockId: 'req',
        method: 'GET',
        url: 'http://127.0.0.1:9/slots',
        headers: [],
        body: '',
        status: 'SENT',
      },
    });
    await env.db.dialogContext.update({
      where: { id: ctx.id },
      data: { currentRequestId: row.id },
    });
    return { ctx, row };
  }

  it('recoverAfterRestart переводит SENT в FAILED и ведёт диалог по ветке «ошибка»', async () => {
    const bot = await createHttpBot(httpScenario());
    const { row } = await seedInterrupted(bot.id, 'tg:h5');

    const recovered = await env.module.get(HttpRequestExecutor).recoverAfterRestart();
    expect(recovered).toBeGreaterThanOrEqual(1);
    await waitFor(() => env.texts(bot.id, 'tg:h5').includes('Ошибка запроса'));

    const after = await env.db.httpRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'FAILED', error: 'запрос прерван перезапуском' });
  });

  it('RESPONSE_RECEIVED для строки в статусе FAILED отбрасывается и успехом не считается', async () => {
    const bot = await createHttpBot(httpScenario());
    const { ctx, row } = await seedInterrupted(bot.id, 'tg:h6');
    await env.db.httpRequest.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: 'сбой' },
    });
    await env.queue.enqueue(
      {
        type: 'RESPONSE_RECEIVED',
        channel: 'MESSENGER',
        botId: bot.id,
        chatId: 'tg:h6',
        userId: 'u1',
        requestId: row.id,
      },
      `manual-${row.id}`,
    );
    // Маркер идёт следом в том же разделе очереди: ответ на него означает, что событие уже разобрано
    await env.emit(textEvent(bot.id, 'tg:h6', 'маркер'));
    await waitFor(() => env.texts(bot.id, 'tg:h6').includes(MSG_WAIT));
    expect(env.texts(bot.id, 'tg:h6')).toEqual([MSG_WAIT]);
    const after = await env.db.dialogContext.findUniqueOrThrow({ where: { id: ctx.id } });
    expect(after.state).toBe('WAITING_EXTERNAL');
  });

  it('секрет в URL маскируется и в закодированном виде', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ slots: 'ok' }));
    const bot = await createHttpBot(
      httpScenario({ url: '{{env.API_URL}}/slots?k={{env.API_KEY}}' }),
    );
    const special = 'a+b/c=';
    const secret = env.vault.encrypt(special, envAad(bot.id, 'API_KEY'));
    await env.db.bot.update({
      where: { id: bot.id },
      data: {
        environment: [
          { name: 'API_URL', value: apiUrl, secret: false },
          { name: 'API_KEY', secret: true, secretValue: secret },
        ],
      },
    });
    await env.emit(textEvent(bot.id, 'tg:h7', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:h7').includes('Слоты: ok'));

    const ctx = await contextOf(bot.id, 'tg:h7');
    const row = await env.db.httpRequest.findFirstOrThrow({ where: { dialogContextId: ctx.id } });
    expect(row.url).toBe(`${apiUrl}/slots?k=${secret.mask}`);
    expect(row.url).not.toContain(encodeURIComponent(special));
    expect(row.url).not.toContain(special);
  });
});
