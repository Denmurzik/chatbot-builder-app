import fs from 'node:fs';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { OutgoingMessage } from '@chatbot/engine-core';
import { scenarioSchema, type ChatEvent, type Scenario } from '@chatbot/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestEnv,
  textEvent,
  waitFor,
  type TestEnv,
  type TestEnvVar,
} from '../src/testing/test-env';
import { createClinicServer } from '../../mock-clinic/src/server';

const CLINIC_API_KEY = 'clinic-secret-key-1';
const CLINIC_API_KEY_SECOND = 'clinic-secret-key-2';
const API_ERROR_TEXT = 'Сервис недоступен, попробуйте позже';

const doctorScenarioPath = path.resolve(
  __dirname,
  '../../../packages/engine-core/examples/doctor-with-http.json',
);
const doctorScenario: Scenario = scenarioSchema.parse(
  JSON.parse(fs.readFileSync(doctorScenarioPath, 'utf-8')),
);

// Копия сценария для проверок сбоев: заголовок X-Mock-Fail из окружения, без повторов и короткий тайм-аут
function scenarioWithMockFail(base: Scenario): Scenario {
  return {
    ...base,
    blocks: base.blocks.map((block) => {
      if (block.type !== 'HTTP_REQUEST') return block;
      return {
        ...block,
        retryCount: 0,
        retryIntervalSec: 0,
        timeoutSec: 1,
        headers: [
          ...block.headers,
          { name: 'X-Mock-Fail', value: '{{env.MOCK_FAIL}}', secret: false },
        ],
      };
    }),
  };
}

function buttonEvent(botId: string, chatId: string, callbackData: string): ChatEvent {
  const sep = callbackData.lastIndexOf(':');
  const sourceBlockId = sep >= 0 ? callbackData.slice(0, sep) : undefined;
  return {
    type: 'BUTTON_PRESS',
    channel: 'MESSENGER',
    botId,
    chatId,
    userId: 'u1',
    payload: callbackData,
    sourceBlockId,
  };
}

async function listenOnFreePort(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function closeServer(server: http.Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('Сквозная проверка: запись к врачу через тестовое API клиники', () => {
  let env: TestEnv;
  let server: http.Server;
  let apiUrl = '';
  const failureScenario = scenarioWithMockFail(doctorScenario);
  let savedHttpAllowedHosts: string | undefined;

  beforeAll(async () => {
    // Сохраняем и удаляем ограничение хостов, чтобы запросы к локальному серверу проходили
    savedHttpAllowedHosts = process.env.HTTP_ALLOWED_HOSTS;
    delete process.env.HTTP_ALLOWED_HOSTS;
    server = createClinicServer({ apiKey: CLINIC_API_KEY, timeoutDelayMs: 3000 });
    apiUrl = await listenOnFreePort(server);
    env = await createTestEnv();
  }, 120000);

  afterAll(async () => {
    await env?.close();
    await closeServer(server);
    // Восстанавливаем HTTP_ALLOWED_HOSTS после тестов
    if (savedHttpAllowedHosts !== undefined) {
      process.env.HTTP_ALLOWED_HOSTS = savedHttpAllowedHosts;
    } else {
      delete process.env.HTTP_ALLOWED_HOSTS;
    }
  });

  function sentFor(botId: string, chatId: string): OutgoingMessage[] {
    return env.gateway.sent
      .filter((item) => item.botId === botId && item.chatId === chatId)
      .map((item) => item.message);
  }

  function lastQuestion(botId: string, chatId: string) {
    const questions = sentFor(botId, chatId).filter(
      (msg): msg is Extract<OutgoingMessage, { kind: 'question' }> => msg.kind === 'question',
    );
    return questions[questions.length - 1];
  }

  function contextOf(botId: string, chatId: string) {
    return env.db.dialogContext.findFirstOrThrow({ where: { botId, chatId } });
  }

  function botEnv(overrides: Partial<Record<string, TestEnvVar>> = {}): TestEnvVar[] {
    const base: Record<string, TestEnvVar> = {
      API_URL: { name: 'API_URL', value: apiUrl, secret: false },
      API_KEY: { name: 'API_KEY', value: CLINIC_API_KEY, secret: true },
    };
    for (const [key, item] of Object.entries(overrides)) {
      if (item) base[key] = item;
    }
    return Object.values(base);
  }

  it('полный успешный путь записи до подтверждения «вы записаны»', async () => {
    const bot = await env.createBot(doctorScenario, botEnv());
    const chatId = 'tg:doctor-ok';

    await env.emit(textEvent(bot.id, chatId, 'привет'));
    await waitFor(() => env.texts(bot.id, chatId).includes('Введите ваше ФИО:'));

    await env.emit(textEvent(bot.id, chatId, 'Иван Иванов'));
    await waitFor(() => lastQuestion(bot.id, chatId)?.text === 'Выберите врача, Иван Иванов:');

    const doctorQuestion = lastQuestion(bot.id, chatId);
    expect(doctorQuestion?.buttons.map((b) => b.label)).toEqual([
      'Иванова Анна Петровна',
      'Петров Сергей Владимирович',
      'Сидорова Елена Николаевна',
    ]);
    expect(doctorQuestion?.buttons[0]?.callbackData).toBe('pick_doctor:0');

    await env.emit(buttonEvent(bot.id, chatId, 'pick_doctor:0'));
    await waitFor(() => lastQuestion(bot.id, chatId)?.text === 'Выберите удобное время:');

    const slotQuestion = lastQuestion(bot.id, chatId);
    expect(slotQuestion?.buttons[0]).toEqual({
      label: '2026-12-03 10:00',
      callbackData: 'pick_slot:0',
    });

    await env.emit(buttonEvent(bot.id, chatId, 'pick_slot:0'));
    await waitFor(() => env.texts(bot.id, chatId).some((t) => t.includes('вы записаны!')));

    const confirm = env.texts(bot.id, chatId).find((t) => t.includes('вы записаны!'));
    expect(confirm).toContain('Иван Иванов, вы записаны!');
    expect(confirm).toContain('Врач: Иванова Анна Петровна');
    expect(confirm).toContain('время: 2026-12-03 10:00');
    expect(confirm).toMatch(/номер записи: b\d+/);

    const ctx = await contextOf(bot.id, chatId);
    expect(ctx.state).toBe('FINISHED');

    // Секретный ключ API не должен попадать в журнал HTTP-запросов в открытом виде
    const rows = await env.db.httpRequest.findMany({
      where: { dialogContextId: ctx.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain(CLINIC_API_KEY);
  });

  it('занятый слот второму диалогу не предлагается', async () => {
    const bot = await env.createBot(doctorScenario, botEnv());
    const firstChat = 'tg:slot-first';
    const secondChat = 'tg:slot-second';

    // Первый пользователь бронирует первый слот у второго врача (Петров: 10:30 и 13:00)
    await env.emit(textEvent(bot.id, firstChat, 'старт'));
    await waitFor(() => env.texts(bot.id, firstChat).includes('Введите ваше ФИО:'));
    await env.emit(textEvent(bot.id, firstChat, 'Мария Смирнова'));
    await waitFor(() => lastQuestion(bot.id, firstChat)?.text === 'Выберите врача, Мария Смирнова:');
    await env.emit(buttonEvent(bot.id, firstChat, 'pick_doctor:1'));
    await waitFor(() => lastQuestion(bot.id, firstChat)?.text === 'Выберите удобное время:');

    const firstSlotLabels = lastQuestion(bot.id, firstChat)?.buttons.map((b) => b.label) ?? [];
    expect(firstSlotLabels).toEqual(['2026-12-03 10:30', '2026-12-03 13:00']);

    await env.emit(buttonEvent(bot.id, firstChat, 'pick_slot:0'));
    await waitFor(() => env.texts(bot.id, firstChat).some((t) => t.includes('вы записаны!')));

    // Второй пользователь выбирает того же врача — занятый слот 10:30 отсутствует
    await env.emit(textEvent(bot.id, secondChat, 'старт'));
    await waitFor(() => env.texts(bot.id, secondChat).includes('Введите ваше ФИО:'));
    await env.emit(textEvent(bot.id, secondChat, 'Олег Кузнецов'));
    await waitFor(() => lastQuestion(bot.id, secondChat)?.text === 'Выберите врача, Олег Кузнецов:');
    await env.emit(buttonEvent(bot.id, secondChat, 'pick_doctor:1'));
    await waitFor(() => lastQuestion(bot.id, secondChat)?.text === 'Выберите удобное время:');

    const secondSlotLabels = lastQuestion(bot.id, secondChat)?.buttons.map((b) => b.label) ?? [];
    expect(secondSlotLabels).not.toContain('2026-12-03 10:30');
    expect(secondSlotLabels).toEqual(['2026-12-03 13:00']);
  });

  it('ответ 500 от API ведёт по ветке «Сервис недоступен»', async () => {
    const bot = await env.createBot(
      failureScenario,
      botEnv({ MOCK_FAIL: { name: 'MOCK_FAIL', value: '500', secret: false } }),
    );
    const chatId = 'tg:fail-500';

    await env.emit(textEvent(bot.id, chatId, 'старт'));
    await waitFor(() => env.texts(bot.id, chatId).includes('Введите ваше ФИО:'));
    await env.emit(textEvent(bot.id, chatId, 'Анна Орлова'));

    await waitFor(() => env.texts(bot.id, chatId).includes(API_ERROR_TEXT));
    const ctx = await contextOf(bot.id, chatId);
    expect(ctx.state).toBe('FINISHED');

    // Проверяем строку http_request: статус ошибки и код ответа 500
    const rows = await env.db.httpRequest.findMany({
      where: { dialogContextId: ctx.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const failRow = rows[rows.length - 1];
    expect(failRow!.responseCode).toBe(500);
  });

  it('неверный ключ API ведёт по ветке ошибки', async () => {
    const bot = await env.createBot(
      failureScenario,
      botEnv({
        API_KEY: { name: 'API_KEY', value: 'wrong-api-key', secret: true },
        MOCK_FAIL: { name: 'MOCK_FAIL', value: '', secret: false },
      }),
    );
    const chatId = 'tg:fail-401';

    await env.emit(textEvent(bot.id, chatId, 'старт'));
    await waitFor(() => env.texts(bot.id, chatId).includes('Введите ваше ФИО:'));
    await env.emit(textEvent(bot.id, chatId, 'Пётр Соколов'));

    await waitFor(() => env.texts(bot.id, chatId).includes(API_ERROR_TEXT));
    const ctx = await contextOf(bot.id, chatId);
    expect(ctx.state).toBe('FINISHED');

    // Проверяем строку http_request: код ответа 401
    const rows = await env.db.httpRequest.findMany({
      where: { dialogContextId: ctx.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const failRow = rows[rows.length - 1];
    expect(failRow!.responseCode).toBe(401);
  });

  it('тайм-аут ответа API ведёт по ветке ошибки', async () => {
    const bot = await env.createBot(
      failureScenario,
      botEnv({ MOCK_FAIL: { name: 'MOCK_FAIL', value: 'timeout', secret: false } }),
    );
    const chatId = 'tg:fail-timeout';

    await env.emit(textEvent(bot.id, chatId, 'старт'));
    await waitFor(() => env.texts(bot.id, chatId).includes('Введите ваше ФИО:'));
    await env.emit(textEvent(bot.id, chatId, 'Елена Морозова'));

    await waitFor(() => env.texts(bot.id, chatId).includes(API_ERROR_TEXT));
    const ctx = await contextOf(bot.id, chatId);
    expect(ctx.state).toBe('FINISHED');

    // Проверяем строку http_request: статус TIMED_OUT
    const rows = await env.db.httpRequest.findMany({
      where: { dialogContextId: ctx.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const failRow = rows[rows.length - 1];
    expect(failRow!.status).toBe('TIMED_OUT');
  });

  it('два бота с разным окружением ведут независимые диалоги', async () => {
    const secondServer = createClinicServer({
      apiKey: CLINIC_API_KEY_SECOND,
      timeoutDelayMs: 3000,
    });
    const secondApiUrl = await listenOnFreePort(secondServer);

    try {
      const botA = await env.createBot(doctorScenario, botEnv());
      const botB = await env.createBot(doctorScenario, [
        { name: 'API_URL', value: secondApiUrl, secret: false },
        { name: 'API_KEY', value: CLINIC_API_KEY_SECOND, secret: true },
      ]);
      // Одинаковый chatId у двух разных ботов не должен смешивать контекст и брони
      const sharedChatId = 'tg:shared-chat';

      await env.emit(textEvent(botA.id, sharedChatId, 'старт'));
      await env.emit(textEvent(botB.id, sharedChatId, 'старт'));
      await waitFor(
        () =>
          env.texts(botA.id, sharedChatId).includes('Введите ваше ФИО:') &&
          env.texts(botB.id, sharedChatId).includes('Введите ваше ФИО:'),
      );

      await env.emit(textEvent(botA.id, sharedChatId, 'Пациент А'));
      await env.emit(textEvent(botB.id, sharedChatId, 'Пациент Б'));
      await waitFor(
        () =>
          lastQuestion(botA.id, sharedChatId)?.text === 'Выберите врача, Пациент А:' &&
          lastQuestion(botB.id, sharedChatId)?.text === 'Выберите врача, Пациент Б:',
      );

      // Оба выбирают третьего врача (Сидорова) и первый слот (09:30) — у каждого свой сервер API
      await env.emit(buttonEvent(botA.id, sharedChatId, 'pick_doctor:2'));
      await env.emit(buttonEvent(botB.id, sharedChatId, 'pick_doctor:2'));
      await waitFor(
        () =>
          lastQuestion(botA.id, sharedChatId)?.text === 'Выберите удобное время:' &&
          lastQuestion(botB.id, sharedChatId)?.text === 'Выберите удобное время:',
      );

      await env.emit(buttonEvent(botA.id, sharedChatId, 'pick_slot:0'));
      await env.emit(buttonEvent(botB.id, sharedChatId, 'pick_slot:0'));
      await waitFor(
        () =>
          env.texts(botA.id, sharedChatId).some((t) => t.includes('вы записаны!')) &&
          env.texts(botB.id, sharedChatId).some((t) => t.includes('вы записаны!')),
      );

      const confirmA = env.texts(botA.id, sharedChatId).find((t) => t.includes('вы записаны!'));
      const confirmB = env.texts(botB.id, sharedChatId).find((t) => t.includes('вы записаны!'));
      expect(confirmA).toContain('Пациент А, вы записаны!');
      expect(confirmA).toContain('время: 2026-12-03 09:30');
      expect(confirmB).toContain('Пациент Б, вы записаны!');
      expect(confirmB).toContain('время: 2026-12-03 09:30');
      expect(confirmB).toContain('номер записи: b1');
    } finally {
      await closeServer(secondServer);
    }
  });
});
