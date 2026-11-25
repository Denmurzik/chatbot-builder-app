import { killAllTrackedProcesses, readPidsManifest } from './process-utils';

// Глобальная очистка E2E: завершает все дочерние сервисы без осиротевших процессов
export default async function globalTeardown(): Promise<void> {
  const manifest = readPidsManifest();
  if (!manifest) return;
  await killAllTrackedProcesses(manifest.processes);
}
