import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = process.cwd();
export const PIDS_FILE = path.resolve(REPO_ROOT, 'test-results/e2e-pids.json');
export const LOGS_DIR = path.resolve(REPO_ROOT, 'test-results/e2e-logs');

export interface TrackedProcess {
  name: string;
  pid: number;
}

export interface PidsManifest {
  processes: TrackedProcess[];
}

// Записывает список PID дочерних процессов в файл для надёжного завершения в teardown
export function savePidsManifest(processes: TrackedProcess[]): void {
  fs.mkdirSync(path.dirname(PIDS_FILE), { recursive: true });
  const manifest: PidsManifest = { processes };
  fs.writeFileSync(PIDS_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
}

// Читает список PID дочерних процессов (или null, если файл отсутствует)
export function readPidsManifest(): PidsManifest | null {
  if (!fs.existsSync(PIDS_FILE)) return null;
  try {
    const raw = fs.readFileSync(PIDS_FILE, 'utf-8');
    return JSON.parse(raw) as PidsManifest;
  } catch {
    return null;
  }
}

// Удаляет файл со списком PID
export function removePidsManifest(): void {
  if (fs.existsSync(PIDS_FILE)) {
    fs.rmSync(PIDS_FILE, { force: true });
  }
}

// Проверяет, жив ли процесс с указанным PID
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Завершает дерево процессов: taskkill на Windows, SIGTERM -> SIGKILL группы процессов на POSIX
export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
      });
    } catch {
      // Процесс уже мог завершиться самостоятельно
    }
    return;
  }

  // На POSIX дочерние процессы запущены с detached: true, поэтому -pid завершает всю группу
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(100);
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Процесс уже завершён
    }
  }
}

// Завершает все отслеживаемые процессы и очищает манифест
export async function killAllTrackedProcesses(processes: TrackedProcess[]): Promise<void> {
  await Promise.all(processes.map((proc) => killProcessTree(proc.pid)));
  removePidsManifest();
}
