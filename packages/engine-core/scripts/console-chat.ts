import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseScenario, type ChatEvent } from '@chatbot/model';
import { DialogEngine, type DialogContextState, type OutgoingMessage } from '../src/index';

// Консольный чат для проверки сценария без мессенджера: единственное место с вводом-выводом
const file = process.argv[2];
if (!file) {
  console.error('Использование: pnpm --filter @chatbot/engine-core chat <scenario.json>');
  process.exit(1);
}

const scenario = parseScenario(JSON.parse(readFileSync(file, 'utf-8')));
const engine = new DialogEngine();
let ctx: DialogContextState | null = null;
let buttons: { label: string; callbackData: string }[] = [];

function print(messages: OutgoingMessage[]): void {
  for (const m of messages) {
    if (m.kind === 'system') {
      console.log(`[Система]: ${m.text}`);
      continue;
    }
    console.log(`Бот: ${m.text}`);
    if (m.kind === 'question') {
      buttons = m.buttons;
      m.buttons.forEach((b, i) => console.log(`  ${i + 1}. ${b.label}`));
    }
  }
}

function toEvent(line: string): ChatEvent {
  const base = { channel: 'PREVIEW', botId: null, chatId: 'console', userId: 'console' } as const;
  if (line === '/start') return { ...base, type: 'START_COMMAND' };
  const n = Number(line);
  if (buttons.length > 0 && Number.isInteger(n) && n >= 1 && n <= buttons.length) {
    const callbackData = buttons[n - 1].callbackData;
    return {
      ...base,
      type: 'BUTTON_PRESS',
      payload: callbackData,
      sourceBlockId: callbackData.slice(0, callbackData.lastIndexOf(':')),
    };
  }
  return { ...base, type: 'TEXT_MESSAGE', payload: line };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  if (line === '') return;
  console.log(`Вы: ${line}`);
  const event = toEvent(line);
  buttons = [];
  const result = engine.handleEvent(event, ctx, scenario, {});
  ctx = result.context;
  print(result.outbox);
  if (ctx.state === 'FINISHED') console.log('[диалог завершён]');
});
