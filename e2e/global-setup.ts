import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  LOGS_DIR,
  REPO_ROOT,
  isProcessAlive,
  killAllTrackedProcesses,
  savePidsManifest,
  type TrackedProcess,
} from './process-utils';

const execFileAsync = promisify(execFile);

const READY_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Собирает чистое окружение для E2E-сервисов с безопасными значениями по умолчанию
function buildE2eEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL || 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot',
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:56379',
    JWT_SECRET: process.env.JWT_SECRET || 'e2e-test-jwt-secret-key-at-least-32-chars',
    VAULT_KEY: process.env.VAULT_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    VAULT_HASH_KEY: process.env.VAULT_HASH_KEY || 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
    TELEGRAM_POLLING: '0',
    VK_POLLING: '0',
    HTTP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    API_PORT: '3000',
    MOCK_CLINIC_PORT: '4010',
    MOCK_CLINIC_API_KEY: 'test-key',
    NODE_ENV: 'test',
  };
}

// Идемпотентно применяет миграции Prisma перед запуском сервисов
async function applyMigrations(env: NodeJS.ProcessEnv): Promise<void> {
  const dbDir = path.resolve(REPO_ROOT, 'packages/db');
  const scriptPath = path.resolve(dbDir, 'scripts/prisma-env.js');
  await execFileAsync(process.execPath, [scriptPath, 'migrate', 'deploy'], {
    cwd: dbDir,
    env,
    windowsHide: true,
  });
}

// Запускает дочерний Node-процесс с перенаправлением вывода в лог-файл
function spawnService(
  name: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): TrackedProcess {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.resolve(LOGS_DIR, `${name}.log`);
  const logFd = fs.openSync(logPath, 'w');

  try {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });

    if (!child.pid) {
      throw new Error(`Не удалось получить PID процесса ${name}`);
    }

    child.unref();
    return { name, pid: child.pid };
  } finally {
    fs.closeSync(logFd);
  }
}

// Ждёт HTTP-ответа сервиса с ожидаемым статусом и проверяет, что процесс не упал
async function waitForHttp(
  url: string,
  checkStatus: (status: number) => boolean,
  proc: TrackedProcess,
  headers?: Record<string, string>,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = '';

  while (Date.now() < deadline) {
    if (!isProcessAlive(proc.pid)) {
      const logTail = readLogTail(proc.name);
      throw new Error(`Сервис ${proc.name} завершился до готовности.\nЛог:\n${logTail}`);
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (checkStatus(res.status)) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await delay(POLL_INTERVAL_MS);
  }

  const logTail = readLogTail(proc.name);
  throw new Error(
    `Сервис ${proc.name} не стал доступен по ${url} за ${READY_TIMEOUT_MS} мс (${lastError}).\nЛог:\n${logTail}`,
  );
}

function readLogTail(name: string): string {
  const logPath = path.resolve(LOGS_DIR, `${name}.log`);
  if (!fs.existsSync(logPath)) return '(лог отсутствует)';
  const content = fs.readFileSync(logPath, 'utf-8');
  return content.slice(-2_000) || '(лог пуст)';
}

// Глобальная подготовка E2E: миграции БД и запуск mock-clinic, api, engine и vite
export default async function globalSetup(): Promise<void> {
  const env = buildE2eEnv();
  const tracked: TrackedProcess[] = [];

  try {
    await applyMigrations(env);

    // 1. Тестовый HTTP API клиники (:4010)
    const clinicProc = spawnService(
      'mock-clinic',
      [path.resolve(REPO_ROOT, 'apps/mock-clinic/dist/main.js')],
      REPO_ROOT,
      env,
    );
    tracked.push(clinicProc);
    savePidsManifest(tracked);

    // 2. HTTP/WS API-сервер (:3000)
    const apiProc = spawnService(
      'api',
      [path.resolve(REPO_ROOT, 'apps/api/dist/main.js')],
      REPO_ROOT,
      env,
    );
    tracked.push(apiProc);
    savePidsManifest(tracked);

    // 3. Движок диалогов (воркеры очереди BullMQ)
    const engineProc = spawnService(
      'engine',
      [path.resolve(REPO_ROOT, 'apps/engine/dist/main.js')],
      REPO_ROOT,
      env,
    );
    tracked.push(engineProc);
    savePidsManifest(tracked);

    // 4. Vite dev-сервер фронтенда (:5173, проксирует /api и WebSocket на :3000)
    const webDir = path.resolve(REPO_ROOT, 'apps/web');
    const viteBin = path.resolve(webDir, 'node_modules/vite/bin/vite.js');
    const webProc = spawnService(
      'web',
      [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      webDir,
      env,
    );
    tracked.push(webProc);
    savePidsManifest(tracked);

    // Ожидаем готовность HTTP-сервисов и прокси Vite -> API
    await Promise.all([
      waitForHttp('http://127.0.0.1:4010/doctors', (s) => s === 200, clinicProc, {
        'X-Api-Key': env.MOCK_CLINIC_API_KEY || 'test-key',
      }),
      waitForHttp('http://127.0.0.1:3000/api/auth/me', (s) => s === 401 || s === 200, apiProc),
      waitForHttp('http://127.0.0.1:5173/', (s) => s === 200, webProc),
    ]);

    await waitForHttp(
      'http://127.0.0.1:5173/api/auth/me',
      (s) => s === 401 || s === 200,
      webProc,
    );

    // Даём engine время подписаться на все партиции BullMQ и убеждаемся, что он жив
    await delay(1_500);
    if (!isProcessAlive(engineProc.pid)) {
      const logTail = readLogTail('engine');
      throw new Error(`Сервис engine завершился при запуске.\nЛог:\n${logTail}`);
    }
  } catch (error) {
    // При любой ошибке старта гарантированно останавливаем уже запущенные процессы
    await killAllTrackedProcesses(tracked);
    throw error;
  }
}
