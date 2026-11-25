import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseScenario, type ChatEvent, type Scenario } from '@chatbot/model';
import { describe, expect, it } from 'vitest';
import { DialogEngine, MSG_LOOP, MSG_SUSPEND_DEFAULT, MSG_WAIT, isStaleResponse } from './dialog-engine';
import type { DialogContextState, EngineResult, HttpOutcome } from './outbox';

type Spec = Record<string, unknown> & { id: string; type: string };

// Собирает сценарий из блоков и переходов вида ['from:output', 'to']
function build(blocks: Spec[], transitions: [string, string][]): Scenario {
  return parseScenario({
    formatVersion: 1,
    blocks: blocks.map((b, i) => ({ title: b.id, x: i * 10, y: 0, ...b })),
    transitions: transitions.map(([from, target]) => {
      const [blockId, output] = from.split(':');
      return { source: { blockId, output }, target };
    }),
  });
}

function ev(
  type: ChatEvent['type'],
  payload?: string,
  sourceBlockId?: string,
  requestId?: string,
): ChatEvent {
  return {
    type,
    channel: 'PREVIEW',
    botId: null,
    chatId: 'c1',
    userId: 'u1',
    payload,
    sourceBlockId,
    requestId,
  };
}

const text = (t: string) => ev('TEXT_MESSAGE', t);
const texts = (r: EngineResult) => r.outbox.map((m) => m.text);

const engine = new DialogEngine();
const run = (
  e: ChatEvent,
  ctx: DialogContextState | null,
  s: Scenario,
  env: Record<string, string> = {},
  outcome?: HttpOutcome,
) => engine.handleEvent(e, ctx, s, env, outcome);

// Старт → Текст → Ввод имени → Условие → Текст → Выход
const greeting = build(
  [
    { id: 'start', type: 'ENTRY_POINT' },
    { id: 'hello', type: 'TEXT_MESSAGE', text: 'Здравствуйте' },
    { id: 'ask', type: 'TEXT_INPUT', question: 'Как вас зовут?', variableName: 'name' },
    { id: 'cond', type: 'CONDITION', expression: 'name == "Аня"' },
    { id: 'yes', type: 'TEXT_MESSAGE', text: 'Привет, {{name}}' },
    { id: 'no', type: 'TEXT_MESSAGE', text: 'Мы не знакомы, {{name}}' },
    { id: 'end', type: 'EXIT_POINT' },
  ],
  [
    ['start:default', 'hello'],
    ['hello:default', 'ask'],
    ['ask:default', 'cond'],
    ['cond:yes', 'yes'],
    ['cond:no', 'no'],
    ['yes:default', 'end'],
    ['no:default', 'end'],
  ],
);

describe('DialogEngine', () => {
  it('ветвь «да» условия: приветствие по имени и завершение', () => {
    const r1 = run(text('привет'), null, greeting);
    expect(texts(r1)).toEqual(['Здравствуйте', 'Как вас зовут?']);
    expect(r1.context.state).toBe('WAITING_USER');
    const r2 = run(text('Аня'), r1.context, greeting);
    expect(texts(r2)).toEqual(['Привет, Аня']);
    expect(r2.context.state).toBe('FINISHED');
  });

  it('ветвь «нет» условия', () => {
    const r1 = run(ev('START_COMMAND'), null, greeting);
    const r2 = run(text('Борис'), r1.context, greeting);
    expect(texts(r2)).toEqual(['Мы не знакомы, Борис']);
    expect(r2.context.state).toBe('FINISHED');
  });

  it('сообщение после FINISHED начинает новый диалог', () => {
    const r1 = run(text('x'), null, greeting);
    const r2 = run(text('Аня'), r1.context, greeting);
    const r3 = run(text('снова'), r2.context, greeting);
    expect(texts(r3)).toEqual(['Здравствуйте', 'Как вас зовут?']);
    expect(r3.context.state).toBe('WAITING_USER');
  });

  it('/start посреди диалога сбрасывает переменные', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'ask', type: 'TEXT_INPUT', question: 'Имя?', variableName: 'name' },
        { id: 'ask2', type: 'TEXT_INPUT', question: 'Город?', variableName: 'city' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'ask'],
        ['ask:default', 'ask2'],
        ['ask2:default', 'end'],
      ],
    );
    const r1 = run(text('hi'), null, s);
    const r2 = run(text('Иван'), r1.context, s);
    expect(r2.context.variables).toEqual({ name: 'Иван' });
    const r3 = run(ev('START_COMMAND'), r2.context, s);
    expect(r3.context.variables).toEqual({});
    expect(r3.context.currentBlockId).toBe('ask');
    expect(texts(r3)).toEqual(['Имя?']);
  });

  it('Присваивание и Переключатель', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'set', type: 'ASSIGNMENT', variableName: 'k', expression: '"b"' },
        { id: 'sw', type: 'SWITCH', variableName: 'k', values: ['a', 'b'] },
        { id: 'ta', type: 'TEXT_MESSAGE', text: 'A' },
        { id: 'tb', type: 'TEXT_MESSAGE', text: 'B' },
        { id: 'te', type: 'TEXT_MESSAGE', text: 'иначе' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'set'],
        ['set:default', 'sw'],
        ['sw:a', 'ta'],
        ['sw:b', 'tb'],
        ['sw:else', 'te'],
        ['tb:default', 'end'],
      ],
    );
    const r = run(text('x'), null, s);
    expect(texts(r)).toEqual(['B']);
    expect(r.context.variables).toEqual({ k: 'b' });
    expect(r.context.state).toBe('FINISHED');

    const s2 = build(
      s.blocks.map((b) => (b.id === 'set' ? { ...b, expression: '"zzz"' } : b)) as Spec[],
      s.transitions.map((t): [string, string] => [`${t.source.blockId}:${t.source.output}`, t.target]),
    );
    expect(texts(run(text('x'), null, s2))).toEqual(['иначе', 'Сценарий не настроен: у блока «te» не подключён выход']);
  });

  describe('выбор из вариантов', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'pick', type: 'OPTION_CHOICE', question: 'Выберите', options: ['Да', 'Нет'], variableName: 'ans' },
        { id: 'ty', type: 'TEXT_MESSAGE', text: 'ответ {{ans}}: ура' },
        { id: 'tn', type: 'TEXT_MESSAGE', text: 'ответ {{ans}}: жаль' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'pick'],
        ['pick:Да', 'ty'],
        ['pick:Нет', 'tn'],
        ['ty:default', 'end'],
        ['tn:default', 'end'],
      ],
    );

    it('отправляет вопрос с кнопками blockId:индекс', () => {
      const r = run(text('x'), null, s);
      expect(r.outbox).toEqual([
        {
          kind: 'question',
          text: 'Выберите',
          buttons: [
            { label: 'Да', callbackData: 'pick:0' },
            { label: 'Нет', callbackData: 'pick:1' },
          ],
        },
      ]);
    });

    it('принимает нажатие кнопки', () => {
      const r1 = run(text('x'), null, s);
      const r2 = run(ev('BUTTON_PRESS', 'pick:1', 'pick'), r1.context, s);
      expect(texts(r2)).toEqual(['ответ Нет: жаль']);
    });

    it('принимает текст варианта без учёта регистра и пробелов', () => {
      const r1 = run(text('x'), null, s);
      const r2 = run(text('  да '), r1.context, s);
      expect(texts(r2)).toEqual(['ответ Да: ура']);
    });

    it('неверный текст — вопрос отправляется заново', () => {
      const r1 = run(text('x'), null, s);
      const r2 = run(text('может'), r1.context, s);
      expect(r2.outbox).toEqual([
        { kind: 'system', text: 'Пожалуйста, выберите вариант кнопкой.', blockId: null },
        ...r1.outbox,
      ]);
      expect(r2.context.state).toBe('WAITING_USER');
      expect(r2.context.currentBlockId).toBe('pick');
    });
  });

  describe('выбор из списка', () => {
    // Сценарий, в котором список кладётся в переменную блоком Присваивание (как результат HTTP-блока)
    const listScenario = (json: string | null) =>
      build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          ...(json === null
            ? []
            : [{ id: 'set', type: 'ASSIGNMENT', variableName: 'slots', expression: `'${json}'` }]),
          {
            id: 'pick',
            type: 'LIST_CHOICE',
            question: 'Время?',
            listVariable: 'slots',
            labelField: 't',
            valueField: 'id',
            variableName: 'slotId',
          },
          { id: 'ok', type: 'TEXT_MESSAGE', text: 'слот {{slotId}}' },
          { id: 'none', type: 'TEXT_MESSAGE', text: 'нет времени' },
          { id: 'end', type: 'EXIT_POINT' },
        ],
        [
          ['start:default', json === null ? 'pick' : 'set'],
          ...(json === null ? [] : ([['set:default', 'pick']] as [string, string][])),
          ['pick:default', 'ok'],
          ['pick:noOptions', 'none'],
          ['ok:default', 'end'],
          ['none:default', 'end'],
        ],
      );

    it('показывает кнопки из массива и сохраняет valueField', () => {
      const s = listScenario('[{"t":"10:00","id":"1"}]');
      const r1 = run(text('go'), null, s);
      expect(r1.outbox).toEqual([
        { kind: 'question', text: 'Время?', buttons: [{ label: '10:00', callbackData: 'pick:0' }] },
      ]);
      const r2 = run(ev('BUTTON_PRESS', 'pick:0', 'pick'), r1.context, s);
      expect(texts(r2)).toEqual(['слот 1']);
      expect(r2.context.variables.slotId).toBe('1');
    });

    it('пустой список, не массив, не JSON и отсутствие переменной — выход noOptions', () => {
      for (const json of ['[]', '{"a":1}', 'не json', null]) {
        expect(texts(run(text('go'), null, listScenario(json)))).toEqual(['нет времени']);
      }
    });

    it('элементы без подписи пропускаются, числа приводятся к тексту', () => {
      const s = listScenario('[{"id":"1"},{"t":"","id":"2"},{"t":5,"id":7}]');
      const r1 = run(text('go'), null, s);
      expect(r1.outbox).toEqual([
        { kind: 'question', text: 'Время?', buttons: [{ label: '5', callbackData: 'pick:0' }] },
      ]);
      const r2 = run(ev('BUTTON_PRESS', 'pick:0', 'pick'), r1.context, s);
      expect(r2.context.variables.slotId).toBe('7');
    });

    it('все элементы без подписи — выход noOptions', () => {
      expect(texts(run(text('go'), null, listScenario('[{"id":"1"}]')))).toEqual(['нет времени']);
    });
  });

  it('устаревшая кнопка (чужой blockId) — вопрос текущего блока заново', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'p1', type: 'OPTION_CHOICE', question: 'Первый', options: ['а', 'б'], variableName: 'v1' },
        { id: 'p2', type: 'OPTION_CHOICE', question: 'Второй', options: ['в', 'г'], variableName: 'v2' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'p1'],
        ['p1:а', 'p2'],
        ['p1:б', 'p2'],
        ['p2:в', 'end'],
        ['p2:г', 'end'],
      ],
    );
    const r1 = run(text('x'), null, s);
    const r2 = run(ev('BUTTON_PRESS', 'p1:0', 'p1'), r1.context, s);
    expect(r2.context.currentBlockId).toBe('p2');
    const r3 = run(ev('BUTTON_PRESS', 'p1:1', 'p1'), r2.context, s);
    expect(r3.context.currentBlockId).toBe('p2');
    expect(r3.context.variables).toEqual({ v1: 'а' });
    expect(r3.outbox).toHaveLength(1);
    expect(r3.outbox[0]).toMatchObject({ kind: 'question', text: 'Второй' });
  });

  it('цикл Присваивание↔Условие: на 101-м шаге FINISHED и сообщение о зацикливании', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'set', type: 'ASSIGNMENT', variableName: 'i', expression: '1' },
        { id: 'cond', type: 'CONDITION', expression: 'true' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'set'],
        ['set:default', 'cond'],
        ['cond:yes', 'set'],
        ['cond:no', 'end'],
      ],
    );
    const r = run(text('x'), null, s);
    expect(r.context.state).toBe('FINISHED');
    expect(texts(r)).toEqual(['Диалог остановлен: сценарий зациклился']);
    // шаги: start(1), set(2), cond(3)…; 101-й шаг — cond
    expect(r.highlightBlockId).toBe('cond');
  });

  it('автопроход ровно из 100 шагов не считается зацикливанием', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 't', type: 'TEXT_MESSAGE', text: 'ok' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 't'],
        ['t:default', 'end'],
      ],
    );
    const r = new DialogEngine({ maxAutopassSteps: 3 }).handleEvent(text('x'), null, s, {});
    expect(texts(r)).toEqual(['ok']);
    const r2 = new DialogEngine({ maxAutopassSteps: 2 }).handleEvent(text('x'), null, s, {});
    expect(texts(r2)).toEqual(['ok', 'Диалог остановлен: сценарий зациклился']);
  });

  it('неподключённый выход: FINISHED, системное сообщение и подсветка блока', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 't', type: 'TEXT_MESSAGE', title: 'Привет', text: 'ok' },
      ],
      [['start:default', 't']],
    );
    const r = run(text('x'), null, s);
    expect(texts(r)).toEqual(['ok', 'Сценарий не настроен: у блока «Привет» не подключён выход']);
    expect(r.context.state).toBe('FINISHED');
    expect(r.highlightBlockId).toBe('t');
  });

  describe('HTTP-запрос', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'ask', type: 'TEXT_INPUT', question: 'Город?', variableName: 'city' },
        {
          id: 'http',
          type: 'HTTP_REQUEST',
          method: 'POST',
          url: '{{env.API_URL}}/find?city={{city}}',
          headers: [
            { name: 'X-City', value: '{{city}}', secret: false },
            { name: 'Authorization', value: '{{env.TOKEN}}', secret: true },
          ],
          body: '{"city":"{{city}}"}',
          variableName: 'resp',
          errorVariable: 'err',
          timeoutSec: 10,
          retryCount: 2,
          retryIntervalSec: 5,
          errorStrategy: 'EXIT_ERROR',
          suspendText: null,
          responseMappings: [],
        },
      ],
      [
        ['start:default', 'ask'],
        ['ask:default', 'http'],
      ],
    );

    it('возвращает httpRequest с подстановкой, WAITING_EXTERNAL и requestId = null', () => {
      const r1 = run(text('x'), null, s, { API_URL: 'https://api.test' });
      const r2 = run(text('Санкт "Петербург"'), r1.context, s, { API_URL: 'https://api.test' });
      expect(r2.context.state).toBe('WAITING_EXTERNAL');
      expect(r2.context.currentRequestId).toBeNull();
      expect(r2.httpRequest).toEqual({
        blockId: 'http',
        method: 'POST',
        url: 'https://api.test/find?city=' + encodeURIComponent('Санкт "Петербург"'),
        headers: [
          { name: 'X-City', value: 'Санкт "Петербург"', secret: false },
          { name: 'Authorization', value: '', secret: true },
        ],
        body: '{"city":"Санкт \\"Петербург\\""}',
        timeoutSec: 10,
        retryCount: 2,
        retryIntervalSec: 5,
      });
    });

    it('пока ждёт внешний ответ, сообщение пользователя получает «Подождите»', () => {
      const r1 = run(text('x'), null, s);
      const r2 = run(text('Омск'), r1.context, s);
      const r3 = run(text('эй'), r2.context, s);
      expect(texts(r3)).toEqual(['Подождите, обрабатываю запрос']);
      expect(r3.context.state).toBe('WAITING_EXTERNAL');
      expect(r3.httpRequest).toBeNull();
    });
  });

  describe('HTTP response', () => {
    // Строит сценарий с HTTP-блоком, выходами success и error
    const httpScenario = (overrides: Partial<Record<string, unknown>> = {}) =>
      build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 'ask', type: 'TEXT_INPUT', question: 'Город?', variableName: 'city' },
          {
            id: 'http',
            type: 'HTTP_REQUEST',
            method: 'POST',
            url: '{{env.API_URL}}/slots?city={{city}}',
            headers: [{ name: 'X-City', value: '{{city}}', secret: false }],
            body: '{"city":"{{city}}"}',
            variableName: 'resp',
            errorVariable: 'err',
            timeoutSec: 10,
            retryCount: 2,
            retryIntervalSec: 5,
            errorStrategy: 'EXIT_ERROR',
            suspendText: null,
            responseMappings: [{ jsonPath: '$.items', variableName: 'slots' }],
            ...overrides,
          },
          { id: 'ok', type: 'TEXT_MESSAGE', text: 'Слоты: {{slots}}' },
          { id: 'fail', type: 'TEXT_MESSAGE', text: 'Ошибка: {{err}}' },
          { id: 'end', type: 'EXIT_POINT' },
        ],
        [
          ['start:default', 'ask'],
          ['ask:default', 'http'],
          ['http:success', 'ok'],
          ['http:error', 'fail'],
          ['ok:default', 'end'],
          ['fail:default', 'end'],
        ],
      );

    const waitingCtx = (overrides: Partial<DialogContextState> = {}): DialogContextState => ({
      state: 'WAITING_EXTERNAL',
      currentBlockId: 'http',
      variables: { city: 'Омск' },
      currentRequestId: 'req-1',
      ...overrides,
    });

    it('RESPONSE_RECEIVED с совпадающим requestId: сохраняет тело, маппинги и продолжает автопроход', () => {
      const s = httpScenario();
      const body = '{"items":[1,2]}';
      const r = run(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx(), s, {}, {
        kind: 'response',
        status: 200,
        body,
      });
      expect(r.stale).toBe(false);
      expect(r.resumeRequestId).toBeNull();
      expect(r.context.variables.resp).toBe(body);
      expect(r.context.variables.slots).toBe('[1,2]');
      expect(r.context.state).toBe('FINISHED');
      expect(r.context.currentRequestId).toBeNull();
      expect(texts(r)).toEqual(['Слоты: [1,2]']);
    });

    it('пустой responseMappings и тело не JSON — не ошибка, переход по success', () => {
      const s = httpScenario({ responseMappings: [] });
      const r = run(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx(), s, {}, {
        kind: 'response',
        status: 200,
        body: 'not json',
      });
      expect(r.stale).toBe(false);
      expect(r.context.variables.resp).toBe('not json');
      expect(r.context.variables.err).toBeUndefined();
      expect(r.context.state).toBe('FINISHED');
      expect(texts(r)).toEqual(['Слоты: ']);
    });

    it('маппинг не нашёл путь при непустом responseMappings — errorVariable и переход по error', () => {
      const s = httpScenario();
      const r = run(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx(), s, {}, {
        kind: 'response',
        status: 200,
        body: '{"other":1}',
      });
      expect(r.stale).toBe(false);
      expect(r.context.variables.err).toBe('{"code":200,"message":"Ошибка разбора ответа"}');
      expect(r.context.state).toBe('FINISHED');
      expect(r.context.currentRequestId).toBeNull();
      expect(texts(r)).toEqual(['Ошибка: {"code":200,"message":"Ошибка разбора ответа"}']);
    });

    it('тело не JSON при непустом responseMappings — errorVariable и переход по error', () => {
      const s = httpScenario();
      const r = run(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx(), s, {}, {
        kind: 'response',
        status: 200,
        body: 'not json',
      });
      expect(r.stale).toBe(false);
      expect(r.context.variables.err).toBe('{"code":200,"message":"Ошибка разбора ответа"}');
      expect(r.context.state).toBe('FINISHED');
      expect(texts(r)).toEqual(['Ошибка: {"code":200,"message":"Ошибка разбора ответа"}']);
    });

    it('REQUEST_FAILED при EXIT_ERROR: errorVariable и переход по error', () => {
      const s = httpScenario();
      const r = run(ev('REQUEST_FAILED', undefined, undefined, 'req-1'), waitingCtx(), s, {}, {
        kind: 'failure',
        code: 0,
        message: 'timeout',
      });
      expect(r.stale).toBe(false);
      expect(r.context.variables.err).toBe('{"code":0,"message":"timeout"}');
      expect(r.context.state).toBe('FINISHED');
      expect(r.context.currentRequestId).toBeNull();
      expect(texts(r)).toEqual(['Ошибка: {"code":0,"message":"timeout"}']);
    });

    it('SUSPEND: отправляет suspendText или MSG_SUSPEND_DEFAULT, сохраняет currentBlockId и currentRequestId', () => {
      const sCustom = httpScenario({
        errorStrategy: 'SUSPEND',
        suspendText: 'Сервис недоступен, напишите снова',
      });
      const r1 = run(ev('REQUEST_FAILED', undefined, undefined, 'req-1'), waitingCtx(), sCustom, {}, {
        kind: 'failure',
        code: 503,
        message: 'Service Unavailable',
      });
      expect(r1.stale).toBe(false);
      expect(r1.context.state).toBe('SUSPENDED');
      expect(r1.context.currentBlockId).toBe('http');
      expect(r1.context.currentRequestId).toBe('req-1');
      expect(r1.context.variables.err).toBe('{"code":503,"message":"Service Unavailable"}');
      expect(texts(r1)).toEqual(['Сервис недоступен, напишите снова']);

      const sDefault = httpScenario({ errorStrategy: 'SUSPEND', suspendText: null });
      const r2 = run(ev('REQUEST_FAILED', undefined, undefined, 'req-1'), waitingCtx(), sDefault, {}, {
        kind: 'failure',
        code: 0,
        message: 'timeout',
      });
      expect(r2.context.state).toBe('SUSPENDED');
      expect(r2.context.currentBlockId).toBe('http');
      expect(r2.context.currentRequestId).toBe('req-1');
      expect(texts(r2)).toEqual([MSG_SUSPEND_DEFAULT]);
    });

    it('SUSPENDED + TEXT_MESSAGE: resume с переотрендеренным запросом и без записи сообщения в переменные', () => {
      const s = httpScenario({ errorStrategy: 'SUSPEND' });
      const suspended = waitingCtx({ state: 'SUSPENDED' });
      const r = run(text('повторить'), suspended, s, { API_URL: 'https://api.test' });
      expect(r.stale).toBe(false);
      expect(r.context.state).toBe('WAITING_EXTERNAL');
      expect(r.context.currentBlockId).toBe('http');
      expect(r.context.currentRequestId).toBe('req-1');
      expect(r.resumeRequestId).toBe('req-1');
      expect(r.context.variables).toEqual({ city: 'Омск' });
      expect(r.outbox).toEqual([]);
      expect(r.httpRequest).toEqual({
        blockId: 'http',
        method: 'POST',
        url: 'https://api.test/slots?city=' + encodeURIComponent('Омск'),
        headers: [{ name: 'X-City', value: 'Омск', secret: false }],
        body: '{"city":"Омск"}',
        timeoutSec: 10,
        retryCount: 2,
        retryIntervalSec: 5,
      });
    });

    it('SUSPENDED + BUTTON_PRESS: тоже resume', () => {
      const s = httpScenario({ errorStrategy: 'SUSPEND' });
      const suspended = waitingCtx({ state: 'SUSPENDED' });
      const r = run(ev('BUTTON_PRESS', 'old:0', 'old'), suspended, s, {
        API_URL: 'https://api.test',
      });
      expect(r.stale).toBe(false);
      expect(r.context.state).toBe('WAITING_EXTERNAL');
      expect(r.resumeRequestId).toBe('req-1');
      expect(r.httpRequest).not.toBeNull();
      expect(r.outbox).toEqual([]);
    });

    it('SUSPENDED + START_COMMAND: перезапуск диалога', () => {
      const s = httpScenario({ errorStrategy: 'SUSPEND' });
      const suspended = waitingCtx({ state: 'SUSPENDED' });
      const r = run(ev('START_COMMAND'), suspended, s);
      expect(r.stale).toBe(false);
      expect(r.resumeRequestId).toBeNull();
      expect(r.httpRequest).toBeNull();
      expect(r.context.state).toBe('WAITING_USER');
      expect(r.context.currentBlockId).toBe('ask');
      expect(r.context.currentRequestId).toBeNull();
      expect(r.context.variables).toEqual({});
      expect(texts(r)).toEqual(['Город?']);
    });

    it('устаревший ответ (чужой requestId, state ≠ WAITING_EXTERNAL, currentRequestId === null, SUSPENDED) — stale', () => {
      const s = httpScenario();
      const cases: Array<{ name: string; event: ChatEvent; ctx: DialogContextState | null }> = [
        {
          name: 'чужой requestId',
          event: ev('RESPONSE_RECEIVED', undefined, undefined, 'req-other'),
          ctx: waitingCtx(),
        },
        {
          name: 'currentRequestId === null',
          event: ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'),
          ctx: waitingCtx({ currentRequestId: null }),
        },
        {
          name: 'state === WAITING_USER',
          event: ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'),
          ctx: waitingCtx({ state: 'WAITING_USER' }),
        },
        {
          name: 'state === SUSPENDED + RESPONSE_RECEIVED',
          event: ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'),
          ctx: waitingCtx({ state: 'SUSPENDED' }),
        },
        {
          name: 'state === SUSPENDED + REQUEST_FAILED',
          event: ev('REQUEST_FAILED', undefined, undefined, 'req-1'),
          ctx: waitingCtx({ state: 'SUSPENDED' }),
        },
        {
          name: 'ctx === null',
          event: ev('REQUEST_FAILED', undefined, undefined, 'req-1'),
          ctx: null,
        },
      ];

      for (const c of cases) {
        expect(isStaleResponse(c.event, c.ctx), c.name).toBe(true);
        const r = run(c.event, c.ctx, s, {}, { kind: 'response', status: 200, body: '{}' });
        expect(r.stale, c.name).toBe(true);
        expect(r.outbox, c.name).toEqual([]);
        expect(r.httpRequest, c.name).toBeNull();
        expect(r.resumeRequestId, c.name).toBeNull();
        if (c.ctx !== null) {
          expect(r.context, c.name).toEqual(c.ctx);
        }
      }

      // Не-HTTP события и актуальный ответ не считаются устаревшими
      expect(isStaleResponse(text('hi'), waitingCtx())).toBe(false);
      expect(
        isStaleResponse(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx()),
      ).toBe(false);
    });

    it('RESPONSE_RECEIVED и REQUEST_FAILED без outcome при совпадающем requestId бросают ошибку', () => {
      const s = httpScenario();
      expect(() =>
        run(ev('RESPONSE_RECEIVED', undefined, undefined, 'req-1'), waitingCtx(), s),
      ).toThrow('outcome обязателен');
      expect(() =>
        run(ev('REQUEST_FAILED', undefined, undefined, 'req-1'), waitingCtx(), s),
      ).toThrow('outcome обязателен');
    });
  });

  describe('жизненный цикл диалога', () => {
    const ask = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'ask', type: 'TEXT_INPUT', question: 'Имя?', variableName: 'name' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'ask'],
        ['ask:default', 'end'],
      ],
    );

    it('после FINISHED переменные пусты', () => {
      const r1 = run(text('x'), null, ask);
      const r2 = run(text('Иван'), r1.context, ask);
      expect(r2.context.variables).toEqual({ name: 'Иван' });
      expect(r2.context.state).toBe('FINISHED');
      const r3 = run(text('снова'), r2.context, ask);
      expect(r3.context.variables).toEqual({});
      expect(r3.context.state).toBe('WAITING_USER');
    });

    it('сохранённый контекст RUNNING трактуется как завершённый: начинается новый диалог', () => {
      const stale: DialogContextState = {
        state: 'RUNNING',
        currentBlockId: 'end',
        variables: { old: '1' },
        currentRequestId: null,
      };
      const r = run(text('x'), stale, ask);
      expect(r.context.state).toBe('WAITING_USER');
      expect(r.context.variables).toEqual({});
      expect(texts(r)).toEqual(['Имя?']);
    });

    it('отсутствие контекста (null) трактуется как FINISHED', () => {
      const r = run(text('x'), null, ask);
      expect(r.context.state).toBe('WAITING_USER');
      expect(texts(r)).toEqual(['Имя?']);
    });

    it('/start сбрасывает currentRequestId', () => {
      const waiting: DialogContextState = {
        state: 'WAITING_EXTERNAL',
        currentBlockId: 'ask',
        variables: {},
        currentRequestId: 'req-1',
      };
      expect(run(ev('START_COMMAND'), waiting, ask).context.currentRequestId).toBeNull();
    });

    it('нажатие кнопки после FINISHED начинает новый диалог', () => {
      const finished: DialogContextState = {
        state: 'FINISHED',
        currentBlockId: 'end',
        variables: { name: 'Иван' },
        currentRequestId: null,
      };
      const r = run(ev('BUTTON_PRESS', 'old:0', 'old'), finished, ask);
      expect(texts(r)).toEqual(['Имя?']);
      expect(r.context.state).toBe('WAITING_USER');
      expect(r.context.variables).toEqual({});
    });

    it('BUTTON_PRESS при ожидании текстового ввода — вопрос заново, переменная не задана', () => {
      const r1 = run(text('x'), null, ask);
      const r2 = run(ev('BUTTON_PRESS', 'ask:0', 'ask'), r1.context, ask);
      expect(r2.outbox).toEqual(r1.outbox);
      expect(r2.context.variables).toEqual({});
      expect(r2.context.state).toBe('WAITING_USER');
    });

    it('блок пропал из сценария: системное сообщение и FINISHED', () => {
      const r1 = run(text('x'), null, ask);
      const other = build([{ id: 'start', type: 'ENTRY_POINT' }], []);
      const r2 = run(text('Иван'), r1.context, other);
      expect(texts(r2)).toEqual([
        'Сценарий изменился, диалог начнётся заново — отправьте любое сообщение',
      ]);
      expect(r2.context.state).toBe('FINISHED');
    });

    it('нет точки входа: системное сообщение и FINISHED', () => {
      const empty = build([{ id: 'end', type: 'EXIT_POINT' }], []);
      const r = run(text('x'), null, empty);
      expect(texts(r)).toEqual(['Сценарий не настроен: нет точки входа']);
      expect(r.context.state).toBe('FINISHED');
    });

    it('ошибка выражения: сообщение, подсветка блока и FINISHED', () => {
      const s = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 'bad', type: 'ASSIGNMENT', title: 'Плохой', variableName: 'v', expression: '1 +' },
        ],
        [['start:default', 'bad']],
      );
      const r = run(text('x'), null, s);
      expect(texts(r)).toHaveLength(1);
      expect(texts(r)[0]).toMatch(/^Ошибка в выражении блока «Плохой»: /);
      expect(r.highlightBlockId).toBe('bad');
      expect(r.context.state).toBe('FINISHED');
    });
  });

  describe('кнопки', () => {
    const s = build(
      [
        { id: 'start', type: 'ENTRY_POINT' },
        { id: 'my_block-1', type: 'OPTION_CHOICE', question: 'Q', options: ['а', 'б'], variableName: 'v' },
        { id: 'end', type: 'EXIT_POINT' },
      ],
      [
        ['start:default', 'my_block-1'],
        ['my_block-1:а', 'end'],
        ['my_block-1:б', 'end'],
      ],
    );

    it('blockId с «-» и «_» разбирается корректно', () => {
      const r1 = run(text('x'), null, s);
      expect(r1.outbox[0]).toMatchObject({
        buttons: [{ callbackData: 'my_block-1:0' }, { callbackData: 'my_block-1:1' }],
      });
      const r2 = run(ev('BUTTON_PRESS', 'my_block-1:1', 'my_block-1'), r1.context, s);
      expect(r2.context.variables).toEqual({ v: 'б' });
      expect(r2.context.state).toBe('FINISHED');
    });

    it('индекс кнопки вне диапазона — вопрос заново без подсказки', () => {
      const r1 = run(text('x'), null, s);
      const r2 = run(ev('BUTTON_PRESS', 'my_block-1:2', 'my_block-1'), r1.context, s);
      expect(r2.outbox).toEqual(r1.outbox);
      expect(r2.context.variables).toEqual({});
    });
  });

  describe('лимит автопрохода по умолчанию', () => {
    // Цепочка из n текстовых блоков: шагов автопрохода = 1 (старт) + n + 1 (выход)
    const chain = (n: number) =>
      build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          ...Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'TEXT_MESSAGE', text: 'x' })),
          { id: 'end', type: 'EXIT_POINT' },
        ],
        [
          ['start:default', 't0'],
          ...Array.from({ length: n }, (_, i): [string, string] => [
            `t${i}:default`,
            i + 1 < n ? `t${i + 1}` : 'end',
          ]),
        ],
      );

    it('цепочка ровно из 100 шагов проходит', () => {
      const r = run(text('x'), null, chain(98));
      expect(r.outbox).toHaveLength(98);
      expect(texts(r)).not.toContain('Диалог остановлен: сценарий зациклился');
    });

    it('на 101-м шаге диалог останавливается', () => {
      const r = run(text('x'), null, chain(99));
      expect(texts(r).at(-1)).toBe('Диалог остановлен: сценарий зациклился');
      expect(r.highlightBlockId).toBe('end');
      expect(r.context.state).toBe('FINISHED');
    });
  });

  it('не мутирует переданный контекст', () => {
    const r1 = run(text('x'), null, greeting);
    const frozen = JSON.stringify(r1.context);
    run(text('Аня'), r1.context, greeting);
    expect(JSON.stringify(r1.context)).toBe(frozen);
  });

  it('пример сценария doctor-with-http.json проходит проверку parseScenario', () => {
    const filePath = path.resolve(__dirname, '../examples/doctor-with-http.json');
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
    const scenario = parseScenario(raw);

    const httpBlocks = scenario.blocks.filter((b) => b.type === 'HTTP_REQUEST');
    expect(httpBlocks).toHaveLength(3);
    for (const block of httpBlocks) {
      expect(block.url).toContain('{{env.API_URL}}');
      expect(block.errorStrategy).toBe('EXIT_ERROR');
      expect(block.headers).toContainEqual({
        name: 'X-Api-Key',
        value: '{{env.API_KEY}}',
        secret: false,
      });
    }
    const postBlock = httpBlocks.find((b) => b.method === 'POST');
    expect(postBlock?.retryCount).toBe(0);
  });

  describe('системные сообщения (kind: system)', () => {
    it('зацикливание, неподключённый выход, ошибка выражения имеют kind: system и blockId', () => {
      const loop = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 'set', type: 'ASSIGNMENT', variableName: 'i', expression: '1' },
          { id: 'cond', type: 'CONDITION', expression: 'true' },
        ],
        [
          ['start:default', 'set'],
          ['set:default', 'cond'],
          ['cond:yes', 'set'],
        ],
      );
      const rLoop = run(text('x'), null, loop);
      expect(rLoop.outbox).toEqual([{ kind: 'system', text: MSG_LOOP, blockId: 'cond' }]);

      const disconnected = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 't', type: 'TEXT_MESSAGE', title: 'Привет', text: 'ok' },
        ],
        [['start:default', 't']],
      );
      const rDisc = run(text('x'), null, disconnected);
      expect(rDisc.outbox).toEqual([
        { kind: 'text', text: 'ok' },
        {
          kind: 'system',
          text: 'Сценарий не настроен: у блока «Привет» не подключён выход',
          blockId: 't',
        },
      ]);

      const badExpr = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 'bad', type: 'ASSIGNMENT', title: 'Плохой', variableName: 'v', expression: '1 +' },
        ],
        [['start:default', 'bad']],
      );
      const rExpr = run(text('x'), null, badExpr);
      expect(rExpr.outbox).toEqual([
        {
          kind: 'system',
          text: expect.stringMatching(/^Ошибка в выражении блока «Плохой»: /),
          blockId: 'bad',
        },
      ]);
    });

    it('нет точки входа, missingBlock и MSG_WAIT имеют kind: system и blockId: null', () => {
      const noEntry = build([{ id: 'end', type: 'EXIT_POINT' }], []);
      expect(run(text('x'), null, noEntry).outbox).toEqual([
        { kind: 'system', text: 'Сценарий не настроен: нет точки входа', blockId: null },
      ]);

      const ask = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          { id: 'ask', type: 'TEXT_INPUT', question: 'Имя?', variableName: 'name' },
          { id: 'end', type: 'EXIT_POINT' },
        ],
        [
          ['start:default', 'ask'],
          ['ask:default', 'end'],
        ],
      );
      const r1 = run(text('x'), null, ask);
      const withoutAsk = build([{ id: 'start', type: 'ENTRY_POINT' }], []);
      expect(run(text('Иван'), r1.context, withoutAsk).outbox).toEqual([
        {
          kind: 'system',
          text: 'Сценарий изменился, диалог начнётся заново — отправьте любое сообщение',
          blockId: null,
        },
      ]);

      const waitingCtx: DialogContextState = {
        state: 'WAITING_EXTERNAL',
        currentBlockId: 'http',
        variables: {},
        currentRequestId: 'req-1',
      };
      expect(run(text('эй'), waitingCtx, ask).outbox).toEqual([
        { kind: 'system', text: MSG_WAIT, blockId: null },
      ]);
    });

    it('обычные реплики (text, question, suspendText) не помечаются как system', () => {
      const r1 = run(text('привет'), null, greeting);
      expect(r1.outbox).toEqual([
        { kind: 'text', text: 'Здравствуйте' },
        { kind: 'question', text: 'Как вас зовут?', buttons: [] },
      ]);

      const httpSuspend = build(
        [
          { id: 'start', type: 'ENTRY_POINT' },
          {
            id: 'http',
            type: 'HTTP_REQUEST',
            method: 'GET',
            url: 'https://api.test/x',
            headers: [],
            body: '',
            variableName: 'resp',
            errorVariable: 'err',
            timeoutSec: 5,
            retryCount: 0,
            retryIntervalSec: 0,
            errorStrategy: 'SUSPEND',
            suspendText: 'Попробуйте позже',
            responseMappings: [],
          },
        ],
        [['start:default', 'http']],
      );
      const waiting: DialogContextState = {
        state: 'WAITING_EXTERNAL',
        currentBlockId: 'http',
        variables: {},
        currentRequestId: 'req-1',
      };
      const rSuspend = run(
        ev('REQUEST_FAILED', undefined, undefined, 'req-1'),
        waiting,
        httpSuspend,
        {},
        { kind: 'failure', code: 503, message: 'down' },
      );
      expect(rSuspend.outbox).toEqual([{ kind: 'text', text: 'Попробуйте позже' }]);
    });
  });
});
