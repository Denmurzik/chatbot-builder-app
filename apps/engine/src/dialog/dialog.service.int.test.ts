import { headerAad } from '@chatbot/vault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoopHttpRequestLauncher } from '../http/http-request-launcher';
import { createTestEnv, textEvent, waitFor, type TestEnv } from '../testing/test-env';

describe('обработка событий диалога (PostgreSQL + Redis)', () => {
  let env: TestEnv;

  beforeAll(async () => {
    // Без реальных HTTP-вызовов: проверяется сохранение http_request в статусе SENT
    env = await createTestEnv({ launcher: new NoopHttpRequestLauncher() });
  }, 120000);

  afterAll(async () => {
    await env?.close();
  });

  it('событие через очередь создаёт dialog_context и шлёт ожидаемые сообщения', async () => {
    const bot = await env.createBot();
    await env.emit(textEvent(bot.id, 'tg:1', 'привет'));
    await waitFor(() => env.texts(bot.id, 'tg:1').length >= 1);

    expect(env.texts(bot.id, 'tg:1')).toEqual(['Что сказать?']);
    const row = await env.db.dialogContext.findFirst({ where: { botId: bot.id, chatId: 'tg:1' } });
    expect(row).toMatchObject({
      state: 'WAITING_USER',
      currentBlockId: 'ask',
      channel: 'MESSENGER',
    });
  });

  it('события одного диалога обрабатываются по порядку', async () => {
    const bot = await env.createBot();
    for (const t of ['старт', 'раз', 'два', 'три']) await env.emit(textEvent(bot.id, 'tg:2', t));
    await waitFor(() => env.texts(bot.id, 'tg:2').length >= 7);

    expect(env.texts(bot.id, 'tg:2')).toEqual([
      'Что сказать?',
      'Вы сказали: раз',
      'Что сказать?',
      'Вы сказали: два',
      'Что сказать?',
      'Вы сказали: три',
      'Что сказать?',
    ]);
  });

  it('два бота с одним chat_id получают независимые контексты', async () => {
    const botA = await env.createBot();
    const botB = await env.createBot();
    await env.emit(textEvent(botA.id, 'tg:3', 'старт'));
    await env.emit(textEvent(botA.id, 'tg:3', 'только A'));
    await env.emit(textEvent(botB.id, 'tg:3', 'старт'));
    await waitFor(
      () => env.texts(botA.id, 'tg:3').length >= 3 && env.texts(botB.id, 'tg:3').length >= 1,
    );

    const a = await env.db.dialogContext.findFirstOrThrow({
      where: { botId: botA.id, chatId: 'tg:3' },
    });
    const b = await env.db.dialogContext.findFirstOrThrow({
      where: { botId: botB.id, chatId: 'tg:3' },
    });
    expect(a.id).not.toBe(b.id);
    expect(a.variables).toEqual({ msg: 'только A' });
    expect(b.variables).toEqual({});
    expect(env.texts(botB.id, 'tg:3')).toEqual(['Что сказать?']);
  });

  it('HTTP-блок сохраняет http_request со статусом SENT и маской вместо секрета', async () => {
    const bot = await env.createBot();
    // AAD секрета заголовка — header:<projectId>:<имя заголовка>
    const encrypted = env.vault.encrypt('Bearer abcdefghijkl', headerAad(bot.projectId, 'Authorization'));
    await env.db.bot.update({
      where: { id: bot.id },
      data: {
        publishedScenario: {
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
              url: 'http://127.0.0.1:9/x',
              headers: [{ name: 'Authorization', value: '', secret: true, secretValue: encrypted }],
              body: '',
              variableName: 'resp',
              errorVariable: 'err',
              timeoutSec: 5,
              retryCount: 0,
              retryIntervalSec: 0,
              errorStrategy: 'EXIT_ERROR',
              suspendText: null,
              responseMappings: [],
            },
          ],
          transitions: [{ source: { blockId: 'start', output: 'default' }, target: 'req' }],
        },
      },
    });
    await env.emit(textEvent(bot.id, 'tg:5', 'старт'));
    await waitFor(async () => (await env.db.httpRequest.count()) >= 1);

    const ctx = await env.db.dialogContext.findFirstOrThrow({
      where: { botId: bot.id, chatId: 'tg:5' },
    });
    const req = await env.db.httpRequest.findFirstOrThrow({ where: { dialogContextId: ctx.id } });
    expect(req).toMatchObject({ status: 'SENT', method: 'GET', blockId: 'req' });
    expect(ctx).toMatchObject({ state: 'WAITING_EXTERNAL', currentRequestId: req.id });
    expect(JSON.stringify(req.headers)).not.toContain('abcdefghijkl');
    expect(req.headers).toEqual([{ name: 'Authorization', value: encrypted.mask, secret: true }]);
  });

  it('сбой отправки не откатывает сохранённый контекст, воркер продолжает работу', async () => {
    const bot = await env.createBot();
    env.gateway.failing = true;
    await env.emit(textEvent(bot.id, 'tg:6', 'старт'));
    await waitFor(async () => {
      const row = await env.db.dialogContext.findFirst({
        where: { botId: bot.id, chatId: 'tg:6' },
      });
      return row?.state === 'WAITING_USER';
    });
    env.gateway.failing = false;
    expect(env.texts(bot.id, 'tg:6')).toEqual([]);

    await env.emit(textEvent(bot.id, 'tg:6', 'привет'));
    await waitFor(() => env.texts(bot.id, 'tg:6').length >= 2);
    expect(env.texts(bot.id, 'tg:6')).toEqual(['Вы сказали: привет', 'Что сказать?']);
  });

  it('событие несуществующего бота не ломает обработку следующих', async () => {
    await env.emit(textEvent('00000000-0000-0000-0000-000000000000', 'tg:4', 'x'));
    const bot = await env.createBot();
    await env.emit(textEvent(bot.id, 'tg:4', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:4').length >= 1);
    expect(env.texts(bot.id, 'tg:4')).toEqual(['Что сказать?']);
  });

  it('событие бота со статусом != PUBLISHED пропускается даже при наличии publishedScenario', async () => {
    const draftBot = await env.createBot();
    await env.db.bot.update({ where: { id: draftBot.id }, data: { status: 'CREATED' } });
    await env.emit(textEvent(draftBot.id, 'tg:7', 'старт'));

    // Отправляем событие другому опубликованному боту как барьер обработки
    const activeBot = await env.createBot();
    await env.emit(textEvent(activeBot.id, 'tg:7', 'старт'));
    await waitFor(() => env.texts(activeBot.id, 'tg:7').length >= 1);

    expect(env.texts(draftBot.id, 'tg:7')).toEqual([]);
    const row = await env.db.dialogContext.findFirst({
      where: { botId: draftBot.id, chatId: 'tg:7' },
    });
    expect(row).toBeNull();
  });

  it('переопубликация между событиями: следующее событие идёт по новому сценарию с точки входа', async () => {
    const bot = await env.createBot();
    await env.emit(textEvent(bot.id, 'tg:8', 'старт'));
    await waitFor(() => env.texts(bot.id, 'tg:8').length >= 1);

    // Как BotService.publish: UPDATE bot, затем сброс контекстов в одной транзакции
    await env.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT status FROM bot WHERE id = ${bot.id} FOR UPDATE`;
      await tx.bot.update({
        where: { id: bot.id },
        data: {
          publishedScenario: {
            formatVersion: 1,
            blocks: [
              { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
              { id: 'hi', type: 'TEXT_MESSAGE', title: 'Привет', x: 0, y: 0, text: 'Новая версия' },
            ],
            transitions: [{ source: { blockId: 'start', output: 'default' }, target: 'hi' }],
          },
        },
      });
      await tx.dialogContext.updateMany({
        where: { botId: bot.id },
        data: { state: 'FINISHED', currentBlockId: null, variables: {}, currentRequestId: null },
      });
    });
    await env.emit(textEvent(bot.id, 'tg:8', 'ещё'));
    await waitFor(() => env.texts(bot.id, 'tg:8').length >= 2);
    expect(env.texts(bot.id, 'tg:8').slice(0, 2)).toEqual(['Что сказать?', 'Новая версия']);
  });
});
