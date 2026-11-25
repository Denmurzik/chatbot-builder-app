// Нагрузочный тест реального конвейера движка диалогов (PostgreSQL + Redis/BullMQ, 16 разделов).
// Запуск: pnpm test:load (настройка через LOAD_DIALOGS и LOAD_STEPS)
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPrismaClient, type PrismaClient } from '../packages/db/dist/index';
import {
  DialogEngine,
  type OutgoingMessage,
  type PendingHttpRequest,
} from '../packages/engine-core/dist/index';
import type { ChatEvent, OutgoingMessageLike, Scenario } from '../packages/model/dist/index';
import { EventQueue, PARTITIONS, createRedisConnection } from '../packages/queue/dist/index';
import { SecretVault } from '../packages/vault/dist/index';
import { ContextRepository } from '../apps/engine/dist/dialog/context.repository';
import { DialogService } from '../apps/engine/dist/dialog/dialog.service';
import {
  HttpRequestLauncher,
  MessengerGateway,
  PreviewNotifier,
  type OutgoingHttpRequest,
} from '../apps/engine/dist/dialog/ports';
import { EventDispatcher } from '../apps/engine/dist/dispatcher/event-dispatcher';
import type { AppConfig } from '../apps/engine/dist/infra/tokens';

// Загружаем .env через dotenv из зависимостей @chatbot/engine (без новых корневых пакетов)
const engineRequire = createRequire(new URL('../apps/engine/package.json', import.meta.url));
engineRequire('reflect-metadata');
const dotenv = engineRequire('dotenv') as { config: (options?: { path?: string }) => unknown };
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_DATABASE_URL = 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot';
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:56379';
const DEFAULT_DIALOGS = 50;
const DEFAULT_STEPS = 4;
const WAIT_TIMEOUT_MS = 120_000;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Переменная ${name} должна быть положительным целым числом, получено: ${raw}`);
  }
  return parsed;
}

// Формирует многошаговый сценарий: старт -> N последовательных пар TEXT_INPUT -> TEXT_MESSAGE -> финал
function buildLoadScenario(steps: number): Scenario {
  const blocks: Scenario['blocks'] = [
    { id: 'start', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
  ];
  const transitions: Scenario['transitions'] = [
    { source: { blockId: 'start', output: 'default' }, target: 'ask-1' },
  ];

  for (let step = 1; step <= steps; step++) {
    const askId = `ask-${step}`;
    const echoId = `echo-${step}`;
    const varName = `step${step}`;
    blocks.push(
      {
        id: askId,
        type: 'TEXT_INPUT',
        title: `Ввод ${step}`,
        x: step * 200,
        y: 0,
        question: `Шаг ${step}: введите сообщение`,
        variableName: varName,
      },
      {
        id: echoId,
        type: 'TEXT_MESSAGE',
        title: `Ответ ${step}`,
        x: step * 200,
        y: 120,
        text: `Ответ {{${varName}}} (шаг ${step})`,
      },
    );
    transitions.push({ source: { blockId: askId, output: 'default' }, target: echoId });
    if (step < steps) {
      transitions.push({ source: { blockId: echoId, output: 'default' }, target: `ask-${step + 1}` });
    } else {
      transitions.push({ source: { blockId: echoId, output: 'default' }, target: 'done' });
    }
  }

  blocks.push(
    {
      id: 'done',
      type: 'TEXT_MESSAGE',
      title: 'Завершение',
      x: (steps + 1) * 200,
      y: 120,
      text: `Диалог завершён: {{step1}}..{{step${steps}}}`,
    },
    {
      id: 'exit',
      type: 'EXIT_POINT',
      title: 'Выход',
      x: (steps + 2) * 200,
      y: 120,
    },
  );
  transitions.push({ source: { blockId: 'done', output: 'default' }, target: 'exit' });

  return { formatVersion: 1, blocks, transitions };
}

// Ожидаемая последовательность исходящих сообщений для конкретного диалога
function buildExpectedMessages(dialogIndex: number, steps: number): string[] {
  const expected: string[] = ['Шаг 1: введите сообщение'];
  for (let step = 1; step <= steps; step++) {
    const payload = `d${dialogIndex}-s${step}`;
    expected.push(`Ответ ${payload} (шаг ${step})`);
    if (step < steps) {
      expected.push(`Шаг ${step + 1}: введите сообщение`);
    } else {
      expected.push(`Диалог завершён: d${dialogIndex}-s1..d${dialogIndex}-s${steps}`);
    }
  }
  return expected;
}

// Быстрый in-memory шлюз мессенджера: сохраняет упорядоченные ответы по каждому chatId
class LoadMessengerGateway extends MessengerGateway {
  readonly messagesByChat = new Map<string, string[]>();

  async sendMessage(_botId: string, chatId: string, message: OutgoingMessage): Promise<void> {
    let list = this.messagesByChat.get(chatId);
    if (!list) {
      list = [];
      this.messagesByChat.set(chatId, list);
    }
    list.push(message.text);
  }
}

class NoopHttpRequestLauncher extends HttpRequestLauncher {
  launch(_request: OutgoingHttpRequest, _pending: PendingHttpRequest): void {
    // Нагрузочный сценарий не использует внешние HTTP-блоки
  }
}

class NoopPreviewNotifier extends PreviewNotifier {
  async publishMessage(_chatId: string, _message: OutgoingMessageLike): Promise<void> {}
  async publishCurrentBlock(_chatId: string, _blockId: string | null): Promise<void> {}
  async publishVariables(_chatId: string, _variables: Record<string, string>): Promise<void> {}
  async publishSystemMessage(_chatId: string, _text: string, _blockId?: string | null): Promise<void> {}
}

// Обёртка над реальным DialogService для точного учёта задержек и ошибок обработки событий
class InstrumentedDialogService extends DialogService {
  readonly latenciesMs: number[] = [];
  readonly errors: string[] = [];
  processedEvents = 0;

  constructor(
    prisma: PrismaClient,
    vault: SecretVault,
    engine: DialogEngine,
    repository: ContextRepository,
    gateway: MessengerGateway,
    launcher: HttpRequestLauncher,
    preview: PreviewNotifier,
    private readonly enqueuedAt: Map<string, number>,
  ) {
    super(prisma, vault, engine, repository, gateway, launcher, preview);
  }

  override async process(event: ChatEvent): Promise<void> {
    const key = `${event.chatId}:${event.payload ?? ''}`;
    try {
      await super.process(event);
      const startedAt = this.enqueuedAt.get(key);
      if (startedAt !== undefined) {
        this.latenciesMs.push(performance.now() - startedAt);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.push(`${key}: ${message}`);
      throw error;
    } finally {
      this.processedEvents += 1;
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Превышено время ожидания завершения нагрузочного теста (${timeoutMs} мс)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main(): Promise<void> {
  const dialogs = readPositiveInt('LOAD_DIALOGS', DEFAULT_DIALOGS);
  const steps = readPositiveInt('LOAD_STEPS', DEFAULT_STEPS);
  const eventsPerDialog = steps + 1;
  const totalEvents = dialogs * eventsPerDialog;

  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const queuePrefix = `load-${runId}`;

  const prisma = createPrismaClient(databaseUrl);
  const redis = createRedisConnection(redisUrl);
  const queue = new EventQueue(redis, { prefix: queuePrefix });
  const gateway = new LoadMessengerGateway();
  const enqueuedAt = new Map<string, number>();

  const config: AppConfig = {
    databaseUrl,
    redisUrl,
    queuePrefix,
  };
  const vault = new SecretVault(randomBytes(32), randomBytes(32));
  const dialogService = new InstrumentedDialogService(
    prisma,
    vault,
    new DialogEngine(),
    new ContextRepository(),
    gateway,
    new NoopHttpRequestLauncher(),
    new NoopPreviewNotifier(),
    enqueuedAt,
  );
  const dispatcher = new EventDispatcher(config, queue, dialogService);

  let authorId: string | null = null;
  let projectId: string | null = null;
  let botId: string | null = null;

  try {
    const scenario = buildLoadScenario(steps);
    const author = await prisma.author.create({
      data: { email: `load-${runId}@example.local`, passwordHash: 'load-test-hash' },
    });
    authorId = author.id;

    const project = await prisma.project.create({
      data: {
        authorId: author.id,
        name: `Нагрузочный тест ${runId}`,
        scenario: scenario as object,
        environment: [],
      },
    });
    projectId = project.id;

    const bot = await prisma.bot.create({
      data: {
        projectId: project.id,
        name: `Бот нагрузки ${runId}`,
        status: 'PUBLISHED',
        publishedScenario: scenario as object,
        environment: [],
        publishedAt: new Date(),
      },
    });
    botId = bot.id;

    await dispatcher.start();

    const startedAt = performance.now();

    // Параллельно запускаем все диалоги; внутри каждого диалога события ставятся в очередь строго по порядку
    await Promise.all(
      Array.from({ length: dialogs }, async (_, dialogIndex) => {
        const chatId = `load-chat-${dialogIndex}`;
        const userId = `load-user-${dialogIndex}`;
        const payloads = ['/start', ...Array.from({ length: steps }, (__, s) => `d${dialogIndex}-s${s + 1}`)];

        for (let seq = 0; seq < payloads.length; seq++) {
          const payload = payloads[seq];
          const event: ChatEvent = {
            type: seq === 0 ? 'START_COMMAND' : 'TEXT_MESSAGE',
            channel: 'MESSENGER',
            botId: bot.id,
            chatId,
            userId,
            payload,
          };
          enqueuedAt.set(`${chatId}:${payload}`, performance.now());
          await dispatcher.enqueue(event, `${runId}-d${dialogIndex}-e${seq}`);
        }
      }),
    );

    await waitUntil(() => dialogService.processedEvents >= totalEvents, WAIT_TIMEOUT_MS);
    const durationMs = performance.now() - startedAt;

    // Проверка строгих инвариантов по всем диалогам
    const violations: string[] = [];
    if (dialogService.processedEvents !== totalEvents) {
      violations.push(
        `Обработано событий: ${dialogService.processedEvents}, ожидалось: ${totalEvents}`,
      );
    }
    if (dialogService.errors.length > 0) {
      violations.push(`Ошибок обработчика: ${dialogService.errors.length} (${dialogService.errors[0]})`);
    }

    let okDialogs = 0;
    for (let dialogIndex = 0; dialogIndex < dialogs; dialogIndex++) {
      const chatId = `load-chat-${dialogIndex}`;
      const expected = buildExpectedMessages(dialogIndex, steps);
      const actual = gateway.messagesByChat.get(chatId) ?? [];

      if (actual.length !== expected.length) {
        violations.push(
          `${chatId}: получено ${actual.length} сообщений вместо ${expected.length}`,
        );
        continue;
      }

      let dialogValid = true;
      for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
          violations.push(
            `${chatId} [сообщение #${i + 1}]: получено "${actual[i]}", ожидалось "${expected[i]}"`,
          );
          dialogValid = false;
          break;
        }
      }
      if (dialogValid) okDialogs += 1;
    }

    const sortedLatencies = [...dialogService.latenciesMs].sort((a, b) => a - b);
    const p50 = percentile(sortedLatencies, 50);
    const p95 = percentile(sortedLatencies, 95);
    const p99 = percentile(sortedLatencies, 99);
    const max = sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0;
    const throughput = durationMs > 0 ? totalEvents / (durationMs / 1000) : 0;

    console.log('=== Результаты нагрузочного теста ===');
    console.log(`Разделов BullMQ: ${PARTITIONS}`);
    console.log(`Диалогов (dialogs): ${dialogs} (успешно: ${okDialogs}/${dialogs})`);
    console.log(`Событий (events): ${totalEvents} (${eventsPerDialog} на диалог)`);
    console.log(`Длительность (durationMs): ${durationMs.toFixed(1)} мс`);
    console.log(`Пропускная способность (throughput): ${throughput.toFixed(1)} событий/с`);
    console.log(
      `Задержка (latency): p50=${p50.toFixed(1)} мс, p95=${p95.toFixed(1)} мс, p99=${p99.toFixed(1)} мс, max=${max.toFixed(1)} мс`,
    );
    console.log(`Ошибок движка: ${dialogService.errors.length}`);
    console.log(`Нарушений инвариантов: ${violations.length}`);

    if (violations.length > 0) {
      for (const issue of violations.slice(0, 10)) {
        console.error(`  - ${issue}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await dispatcher.onModuleDestroy().catch((error: unknown) => {
      console.error('Ошибка остановки EventDispatcher:', error);
    });
    await queue.close().catch((error: unknown) => {
      console.error('Ошибка закрытия EventQueue:', error);
    });
    try {
      const keys = await redis.keys(`${queuePrefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
    } catch (error: unknown) {
      console.error('Ошибка очистки ключей Redis:', error);
    }
    await redis.quit().catch(() => {});

    try {
      if (botId) {
        await prisma.httpRequest.deleteMany({ where: { dialogContext: { botId } } });
        await prisma.dialogContext.deleteMany({ where: { botId } });
        await prisma.bot.delete({ where: { id: botId } });
      }
      if (projectId) {
        await prisma.project.delete({ where: { id: projectId } });
      }
      if (authorId) {
        await prisma.author.delete({ where: { id: authorId } });
      }
    } catch (error: unknown) {
      console.error('Ошибка очистки тестовых данных в PostgreSQL:', error);
    }
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error('Нагрузочный тест завершился с ошибкой:', error);
  process.exit(1);
});
