// Прототип П1 (п. 4 спецификации): очередь из 16 разделов сохраняет порядок событий диалога;
// режим --http: запросы, зависшие на 10 с, не тормозят события других диалогов.
// Запуск: pnpm --filter @chatbot/engine p1 [-- --http]
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { ChatEvent } from '@chatbot/model';
import { EventQueue, PARTITIONS, createRedisConnection, queueName } from '@chatbot/queue';
import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { ExternalApiClient } from '../src/http/external-api-client';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DIALOGS = 200;
const EVENTS_PER_DIALOG = 10;
const HTTP_REQUESTS = 50;
const HTTP_DELAY_MS = 10_000;
const HTTP_LOAD_EVENTS_PER_SEC = 40;
const HTTP_LOAD_SECONDS = 15;

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Не задана переменная окружения REDIS_URL');
const prefix = `p1-${randomUUID()}`;

function makeEvent(dialog: number, seq: number): ChatEvent {
  return {
    type: 'TEXT_MESSAGE',
    channel: 'MESSENGER',
    botId: 'p1-bot',
    chatId: `chat-${dialog}`,
    userId: 'u',
    payload: String(seq),
  };
}

// Перемешанный порядок: на каждом шаге выбирается случайный диалог со следующим по счёту событием
function shuffledOrder(): { dialog: number; seq: number }[] {
  const next = new Array<number>(DIALOGS).fill(0);
  const active = Array.from({ length: DIALOGS }, (_, i) => i);
  const order: { dialog: number; seq: number }[] = [];
  while (active.length > 0) {
    const i = Math.floor(Math.random() * active.length);
    const dialog = active[i];
    order.push({ dialog, seq: next[dialog] });
    next[dialog] += 1;
    if (next[dialog] === EVENTS_PER_DIALOG) active.splice(i, 1);
  }
  return order;
}

interface Harness {
  queue: EventQueue;
  stop(): Promise<void>;
}

// Поднимает 16 воркеров (concurrency 1, глобальная конкурентность 1) с заданным обработчиком
async function startWorkers(handler: (event: ChatEvent) => Promise<void>): Promise<Harness> {
  const connection = createRedisConnection(redisUrl as string);
  const queue = new EventQueue(connection, { prefix });
  await queue.setGlobalConcurrency(1);
  const workers = Array.from(
    { length: PARTITIONS },
    (_, p) =>
      new Worker(queueName(p), (job) => handler(job.data as ChatEvent), {
        connection,
        prefix,
        concurrency: 1,
      }),
  );
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  return {
    queue,
    async stop() {
      await Promise.all(workers.map((w) => w.close()));
      await queue.close();
      const keys = await connection.keys(`${prefix}:*`);
      if (keys.length > 0) await connection.del(...keys);
      await connection.quit();
    },
  };
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Превышено время ожидания обработки событий');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function runOrder(): Promise<void> {
  const lastSeq = new Map<string, number>();
  let processed = 0;
  let violations = 0;
  const harness = await startWorkers(async (event) => {
    const seq = Number(event.payload);
    const expected = (lastSeq.get(event.chatId) ?? -1) + 1;
    if (seq !== expected) violations += 1;
    lastSeq.set(event.chatId, seq);
    processed += 1;
  });
  const total = DIALOGS * EVENTS_PER_DIALOG;
  const started = Date.now();
  try {
    let n = 0;
    for (const { dialog, seq } of shuffledOrder()) {
      await harness.queue.enqueue(makeEvent(dialog, seq), `p1-${n++}`);
    }
    await waitUntil(() => processed >= total, 120_000);
  } finally {
    await harness.stop();
  }
  console.log(`dialogs: ${DIALOGS}, events: ${total}`);
  console.log(`violations: ${violations}`);
  console.log(`time: ${Date.now() - started} ms`);
  if (violations > 0) process.exitCode = 1;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

async function runHttp(): Promise<void> {
  // Локальный сервер отвечает через 10 с
  const server = createServer((_req, res) => {
    setTimeout(() => res.end('ok'), HTTP_DELAY_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`;

  let httpDone = 0;
  const client = new ExternalApiClient({
    async onResponse() {
      httpDone += 1;
    },
    async onFailure() {
      httpDone += 1;
    },
  });
  const latencies: { at: number; latency: number }[] = [];
  let started = 0;
  const harness = await startWorkers(async (event) => {
    if (event.payload === 'http') {
      // Запрос уходит вне задания: send не ждёт ответа (п. 1.5)
      client.send({ id: randomUUID(), method: 'GET', url, headers: {}, body: null }, 30, 0, 0);
      return;
    }
    latencies.push({ at: Date.now(), latency: Date.now() - Number(event.payload) });
  });

  const begin = Date.now();
  try {
    // 50 диалогов запускают запросы, одновременно идёт поток событий других диалогов
    for (let i = 0; i < HTTP_REQUESTS; i++) {
      await harness.queue.enqueue({ ...makeEvent(1000 + i, 0), payload: 'http' }, `p1h-req-${i}`);
      started += 1;
    }
    const total = HTTP_LOAD_EVENTS_PER_SEC * HTTP_LOAD_SECONDS;
    for (let n = 0; n < total; n++) {
      const dialog = n % DIALOGS;
      await harness.queue.enqueue(
        { ...makeEvent(dialog, 0), payload: String(Date.now()) },
        `p1h-ev-${n}`,
      );
      await new Promise((r) => setTimeout(r, 1000 / HTTP_LOAD_EVENTS_PER_SEC));
    }
    await waitUntil(() => latencies.length >= total && httpDone >= HTTP_REQUESTS, 60_000);
  } finally {
    await harness.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Рост задержки: сравниваем третьи части выборки (ожидается отсутствие роста)
  const values = latencies.map((l) => l.latency);
  const third = Math.floor(values.length / 3);
  const first = average(values.slice(0, third));
  const last = average(values.slice(-third));
  const max = Math.max(...values);
  const grows = last > first + 100;
  console.log(
    `http requests: ${started} (ответ через ${HTTP_DELAY_MS / 1000} с), завершено: ${httpDone}`,
  );
  console.log(`events: ${values.length} за ${((Date.now() - begin) / 1000).toFixed(1)} с`);
  console.log(`latency avg first third: ${first.toFixed(1)} ms`);
  console.log(`latency avg last third: ${last.toFixed(1)} ms`);
  console.log(`latency max: ${max} ms`);
  console.log(`latency growth: ${grows ? 'yes' : 'no'}`);
  if (grows) process.exitCode = 1;
}

(process.argv.includes('--http') ? runHttp() : runOrder()).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
