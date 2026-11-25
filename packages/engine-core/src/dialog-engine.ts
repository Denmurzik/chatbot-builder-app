import {
  getOutputs,
  type Block,
  type ChatEvent,
  type HttpRequestBlock,
  type ListChoiceBlock,
  type Scenario,
} from '@chatbot/model';
import { DialogContext } from './dialog-context';
import { ExpressionError, evaluate, toBoolean } from './expression';
import type {
  DialogContextState,
  EngineResult,
  HttpOutcome,
  OutgoingButton,
  OutgoingMessage,
  PendingHttpRequest,
} from './outbox';
import { extract, toText } from './json-path';
import type { VariableScope } from './scope';
import { render } from './template';

const DEFAULT_MAX_AUTOPASS_STEPS = 100;

export const MSG_LOOP = 'Диалог остановлен: сценарий зациклился';
export const MSG_WAIT = 'Подождите, обрабатываю запрос';
export const MSG_SUSPEND_DEFAULT =
  'Сервис временно недоступен. Напишите любое сообщение, чтобы повторить запрос.';

// Проверяет, устарело ли событие ответа/ошибки HTTP относительно текущего контекста (п. 2.8)
export function isStaleResponse(event: ChatEvent, ctx: DialogContextState | null): boolean {
  if (event.type !== 'RESPONSE_RECEIVED' && event.type !== 'REQUEST_FAILED') {
    return false;
  }
  return (
    ctx === null ||
    ctx.state !== 'WAITING_EXTERNAL' ||
    ctx.currentRequestId === null ||
    event.requestId !== ctx.currentRequestId
  );
}

interface ListItem {
  label: string;
  value: string;
}

// Рабочее состояние обработки одного события
export interface DialogRun {
  ctx: DialogContext;
  scenario: Scenario;
  outbox: OutgoingMessage[];
  httpRequest: PendingHttpRequest | null;
  highlightBlockId: string | null;
  stale: boolean;
  resumeRequestId: string | null;
}

// Движок диалогов: чистая функция «событие + контекст → результат», без ввода-вывода
export class DialogEngine {
  private readonly maxAutopassSteps: number;

  constructor(opts: { maxAutopassSteps?: number } = {}) {
    this.maxAutopassSteps = opts.maxAutopassSteps ?? DEFAULT_MAX_AUTOPASS_STEPS;
  }

  // Точка входа: выбор сценария обработки по событию и состоянию диалога (п. 2.3)
  handleEvent(
    event: ChatEvent,
    ctx: DialogContextState | null,
    scenario: Scenario,
    env: Record<string, string>,
    outcome?: HttpOutcome,
  ): EngineResult {
    const run: DialogRun = {
      ctx: new DialogContext(ctx, env),
      scenario,
      outbox: [],
      httpRequest: null,
      highlightBlockId: null,
      stale: false,
      resumeRequestId: null,
    };
    const isUserInput = event.type === 'TEXT_MESSAGE' || event.type === 'BUTTON_PRESS';

    if (isStaleResponse(event, ctx)) {
      run.stale = true;
    } else if (event.type === 'START_COMMAND') {
      this.restartDialog(run);
    } else if (ctx === null || ctx.state === 'FINISHED' || ctx.state === 'RUNNING') {
      if (isUserInput) this.startDialog(run);
    } else if (ctx.state === 'WAITING_USER') {
      if (isUserInput) this.handleUserAnswer(run, event);
    } else if (ctx.state === 'WAITING_EXTERNAL') {
      if (event.type === 'TEXT_MESSAGE') {
        this.systemMessage(run, MSG_WAIT);
      } else if (event.type === 'RESPONSE_RECEIVED' || event.type === 'REQUEST_FAILED') {
        this.handleHttpOutcome(run, event, outcome);
      }
    } else if (ctx.state === 'SUSPENDED') {
      if (isUserInput) this.resumeHttpRequest(run);
    }

    return {
      context: run.ctx.snapshot(),
      outbox: run.outbox,
      httpRequest: run.httpRequest,
      highlightBlockId: run.highlightBlockId,
      stale: run.stale,
      resumeRequestId: run.resumeRequestId,
    };
  }

  // Перезапуск диалога по /start: переменные сбрасываются (UC-U-05)
  restartDialog(run: DialogRun): void {
    run.ctx.clearVariables();
    this.startDialog(run);
  }

  // Старт с точки входа (UC-U-01, U-04)
  startDialog(run: DialogRun): void {
    const entry = run.scenario.blocks.find((b) => b.type === 'ENTRY_POINT');
    run.ctx.clearVariables();
    run.ctx.currentRequestId = null;
    if (!entry) {
      this.systemMessage(run, 'Сценарий не настроен: нет точки входа');
      this.finishDialog(run);
      return;
    }
    run.ctx.currentBlockId = entry.id;
    run.ctx.state = 'RUNNING';
    this.runAutopass(run);
  }

  finishDialog(run: DialogRun): void {
    run.ctx.state = 'FINISHED';
  }

  // Ответ пользователя блоку ввода или выбора (UC-U-08…U-13)
  private handleUserAnswer(run: DialogRun, event: ChatEvent): void {
    const block = this.currentBlock(run);
    if (!block) {
      this.missingBlock(run);
      return;
    }

    if (block.type === 'TEXT_INPUT') {
      const text = event.type === 'TEXT_MESSAGE' ? (event.payload ?? '') : '';
      if (text.trim() === '') {
        this.sendQuestion(run, block);
        return;
      }
      run.ctx.setVariable(block.variableName, text);
      this.advance(run, block, 'default');
    } else if (block.type === 'OPTION_CHOICE') {
      const index = this.matchButton(event, block.id, block.options);
      if (index === null) {
        this.rejectChoice(run, block, event);
        return;
      }
      run.ctx.setVariable(block.variableName, block.options[index]);
      this.advance(run, block, block.options[index]);
    } else if (block.type === 'LIST_CHOICE') {
      const items = this.readList(run, block) ?? [];
      const index = this.matchButton(
        event,
        block.id,
        items.map((i) => i.label),
      );
      if (index === null) {
        this.rejectChoice(run, block, event);
        return;
      }
      run.ctx.setVariable(block.variableName, items[index].value);
      this.advance(run, block, 'default');
    } else {
      this.sendQuestion(run, block);
    }
  }

  // Неверный ответ на выбор: для текста — подсказка и повтор вопроса, для устаревшей кнопки — только вопрос (UC-U-12, U-13)
  private rejectChoice(run: DialogRun, block: Block, event: ChatEvent): void {
    if (event.type === 'TEXT_MESSAGE') {
      this.systemMessage(run, 'Пожалуйста, выберите вариант кнопкой.');
    }
    this.sendQuestion(run, block);
  }

  // Индекс выбранного варианта по кнопке или тексту; null — не распознано или устаревшая кнопка (UC-U-13)
  matchButton(event: ChatEvent, blockId: string, labels: string[]): number | null {
    const payload = event.payload ?? '';
    if (event.type === 'BUTTON_PRESS') {
      const sep = payload.lastIndexOf(':');
      if (sep < 0) return null;
      const sourceId = payload.slice(0, sep);
      if (sourceId !== blockId || (event.sourceBlockId ?? sourceId) !== blockId) return null;
      const raw = payload.slice(sep + 1);
      if (!/^\d+$/.test(raw)) return null;
      const index = Number(raw);
      return index < labels.length ? index : null;
    }
    const text = payload.trim().toLowerCase();
    if (text === '') return null;
    const index = labels.findIndex((l) => l.trim().toLowerCase() === text);
    return index >= 0 ? index : null;
  }

  // Переход по выходу после ответа пользователя и продолжение автопрохода
  private advance(run: DialogRun, block: Block, output: string): void {
    run.ctx.state = 'RUNNING';
    if (this.followOutput(run, block, output)) this.runAutopass(run);
  }

  // Автопроход блоков без ожидания (п. 2.3)
  runAutopass(run: DialogRun): void {
    let steps = 0;
    for (;;) {
      steps += 1;
      if (steps > this.maxAutopassSteps) {
        this.systemMessage(run, MSG_LOOP, run.ctx.currentBlockId);
        run.highlightBlockId = run.ctx.currentBlockId;
        this.finishDialog(run);
        return;
      }
      const block = this.currentBlock(run);
      if (!block) {
        this.missingBlock(run);
        return;
      }
      const output = this.executeBlock(block, run);
      if (output === null) return;
      if (!this.followOutput(run, block, output)) return;
    }
  }

  // Выполняет один блок сценария; возвращает имя выхода для продолжения автопрохода или null при остановке
  executeBlock(block: Block, run: DialogRun): string | null {
    const scope = run.ctx.scope();
    try {
      switch (block.type) {
        case 'ENTRY_POINT':
          return 'default';
        case 'TEXT_MESSAGE':
          run.outbox.push({ kind: 'text', text: render(block.text, scope, 'TEXT') });
          return 'default';
        case 'ASSIGNMENT':
          run.ctx.setVariable(block.variableName, String(evaluate(block.expression, scope)));
          return 'default';
        case 'CONDITION':
          return toBoolean(evaluate(block.expression, scope)) ? 'yes' : 'no';
        case 'SWITCH': {
          const value = run.ctx.getVariable(block.variableName) ?? '';
          return block.values.includes(value) ? value : 'else';
        }
        case 'LIST_CHOICE': {
          const items = this.readList(run, block);
          if (!items || items.length === 0) {
            return 'noOptions';
          }
          this.sendQuestion(run, block);
          run.ctx.state = 'WAITING_USER';
          return null;
        }
        case 'TEXT_INPUT':
        case 'OPTION_CHOICE':
          this.sendQuestion(run, block);
          run.ctx.state = 'WAITING_USER';
          return null;
        case 'HTTP_REQUEST':
          run.httpRequest = this.buildPendingHttpRequest(block, scope);
          run.ctx.state = 'WAITING_EXTERNAL';
          run.ctx.currentRequestId = null;
          return null;
        case 'EXIT_POINT':
          this.finishDialog(run);
          return null;
      }
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.systemMessage(run, `Ошибка в выражении блока «${block.title}»: ${e.message}`, block.id);
        run.highlightBlockId = block.id;
        this.finishDialog(run);
        return null;
      }
      throw e;
    }
  }

  // Переход по выходу блока; false — выход не подключён, диалог завершён
  followOutput(run: DialogRun, block: Block, output: string): boolean {
    const transition = getOutputs(block).includes(output)
      ? run.scenario.transitions.find(
          (t) => t.source.blockId === block.id && t.source.output === output,
        )
      : undefined;
    if (!transition) {
      this.systemMessage(
        run,
        `Сценарий не настроен: у блока «${block.title}» не подключён выход`,
        block.id,
      );
      run.highlightBlockId = block.id;
      this.finishDialog(run);
      return false;
    }
    run.ctx.currentBlockId = transition.target;
    return true;
  }

  private sendQuestion(run: DialogRun, block: Block): void {
    const scope = run.ctx.scope();
    if (block.type === 'TEXT_INPUT') {
      run.outbox.push({ kind: 'question', text: render(block.question, scope, 'TEXT'), buttons: [] });
    } else if (block.type === 'OPTION_CHOICE') {
      run.outbox.push({
        kind: 'question',
        text: render(block.question, scope, 'TEXT'),
        buttons: this.buttons(block.id, block.options),
      });
    } else if (block.type === 'LIST_CHOICE') {
      const items = this.readList(run, block) ?? [];
      run.outbox.push({
        kind: 'question',
        text: render(block.question, scope, 'TEXT'),
        buttons: this.buttons(
          block.id,
          items.map((i) => i.label),
        ),
      });
    }
  }

  private buttons(blockId: string, labels: string[]): OutgoingButton[] {
    return labels.map((label, i) => ({ label, callbackData: `${blockId}:${i}` }));
  }

  // Разбор массива из JSON-строки переменной; null — не массив или ошибка разбора
  private readList(run: DialogRun, block: ListChoiceBlock): ListItem[] | null {
    const raw = run.ctx.getVariable(block.listVariable);
    if (raw === undefined) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const items: ListItem[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const label = toText(rec[block.labelField]);
      const value = toText(rec[block.valueField]);
      if (label === '') continue;
      items.push({ label, value });
    }
    return items;
  }

  // Обработка ответа или ошибки внешнего HTTP-запроса (п. 2.7, 2.9)
  private handleHttpOutcome(
    run: DialogRun,
    event: ChatEvent,
    outcome: HttpOutcome | undefined,
  ): void {
    if (!outcome) {
      throw new Error('outcome обязателен');
    }
    const block = this.currentBlock(run);
    if (!block || block.type !== 'HTTP_REQUEST') {
      this.missingBlock(run);
      return;
    }
    if (event.type === 'RESPONSE_RECEIVED') {
      if (outcome.kind !== 'response') {
        throw new Error('Ожидался outcome вида response для RESPONSE_RECEIVED');
      }
      this.handleHttpResponse(run, block, outcome.status, outcome.body);
    } else {
      if (outcome.kind !== 'failure') {
        throw new Error('Ожидался outcome вида failure для REQUEST_FAILED');
      }
      this.handleHttpFailure(run, block, outcome.code, outcome.message);
    }
  }

  // Разбор JSON-ответа по правилам ResponseMapping и переход по выходу success (п. 2.7)
  private handleHttpResponse(
    run: DialogRun,
    block: HttpRequestBlock,
    status: number,
    body: string,
  ): void {
    if (block.variableName) {
      run.ctx.setVariable(block.variableName, body);
    }
    if (block.responseMappings.length === 0) {
      run.ctx.currentRequestId = null;
      this.advance(run, block, 'success');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.handleHttpFailure(run, block, status, 'Ошибка разбора ответа');
      return;
    }

    const extracted: Array<[string, string]> = [];
    for (const mapping of block.responseMappings) {
      let res: { found: true; value: unknown } | { found: false };
      try {
        res = extract(parsed, mapping.jsonPath);
      } catch {
        this.handleHttpFailure(run, block, status, 'Ошибка разбора ответа');
        return;
      }
      if (!res.found) {
        this.handleHttpFailure(run, block, status, 'Ошибка разбора ответа');
        return;
      }
      extracted.push([mapping.variableName, toText(res.value)]);
    }

    for (const [name, value] of extracted) {
      run.ctx.setVariable(name, value);
    }
    run.ctx.currentRequestId = null;
    this.advance(run, block, 'success');
  }

  // Стратегия обработки ошибки HTTP-блока: EXIT_ERROR или SUSPEND (п. 2.9)
  private handleHttpFailure(
    run: DialogRun,
    block: HttpRequestBlock,
    code: number,
    message: string,
  ): void {
    if (block.errorVariable) {
      run.ctx.setVariable(block.errorVariable, JSON.stringify({ code, message }));
    }
    if (block.errorStrategy === 'SUSPEND') {
      const suspendText =
        block.suspendText !== null && block.suspendText.trim() !== ''
          ? render(block.suspendText, run.ctx.scope(), 'TEXT')
          : MSG_SUSPEND_DEFAULT;
      run.outbox.push({ kind: 'text', text: suspendText });
      run.ctx.state = 'SUSPENDED';
      return;
    }
    run.ctx.currentRequestId = null;
    this.advance(run, block, 'error');
  }

  // Возобновление приостановленного HTTP-запроса по сообщению/кнопке пользователя (UC-U-19)
  private resumeHttpRequest(run: DialogRun): void {
    const block = this.currentBlock(run);
    if (!block || block.type !== 'HTTP_REQUEST') {
      this.missingBlock(run);
      return;
    }
    run.httpRequest = this.buildPendingHttpRequest(block, run.ctx.scope());
    run.ctx.state = 'WAITING_EXTERNAL';
    run.resumeRequestId = run.ctx.currentRequestId;
  }

  // Формирует параметры HTTP-запроса с подстановкой переменных шаблона
  private buildPendingHttpRequest(
    block: HttpRequestBlock,
    scope: VariableScope,
  ): PendingHttpRequest {
    return {
      blockId: block.id,
      method: block.method,
      url: render(block.url, scope, 'URL'),
      headers: block.headers.map((h) => ({
        name: h.name,
        // Секретное значение никогда не передаётся открытым текстом; расшифровка — только из secretValue
        value: h.secret ? '' : render(h.value, scope, 'HEADER'),
        secret: h.secret,
        ...(h.secretValue !== undefined ? { secretValue: h.secretValue } : {}),
      })),
      body: block.body.trim() === '' ? null : render(block.body, scope, 'JSON'),
      timeoutSec: block.timeoutSec,
      retryCount: block.retryCount,
      retryIntervalSec: block.retryIntervalSec,
    };
  }

  // Блок текущего диалога пропал из сценария (например, после переопубликации)
  private missingBlock(run: DialogRun): void {
    this.systemMessage(
      run,
      'Сценарий изменился, диалог начнётся заново — отправьте любое сообщение',
    );
    this.finishDialog(run);
  }

  private currentBlock(run: DialogRun): Block | undefined {
    const id = run.ctx.currentBlockId;
    return run.scenario.blocks.find((b) => b.id === id);
  }

  private systemMessage(run: DialogRun, text: string, blockId: string | null = null): void {
    run.outbox.push({ kind: 'system', text, blockId });
  }
}
