import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PrismaClient } from '@chatbot/db';
import { createPrismaClient } from '@chatbot/db';

const DEFAULT_ADMIN_URL = 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot';

export interface IsolatedTestDb {
  dbName: string;
  databaseUrl: string;
  prisma: PrismaClient;
  truncateAll(): Promise<void>;
  destroy(): Promise<void>;
}

// Создаёт изолированную БД PostgreSQL для интеграционных тестов API, применяет миграции и очищает после завершения
export async function createIsolatedTestDb(): Promise<IsolatedTestDb> {
  const adminUrl = process.env.DATABASE_URL ?? DEFAULT_ADMIN_URL;
  const dbName = `chatbot_api_test_${randomBytes(4).toString('hex')}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;
  const databaseUrl = testUrl.toString();

  const admin = createPrismaClient(adminUrl);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

  const dbPkgDir = path.resolve(__dirname, '../../../packages/db');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPkgDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const prisma = createPrismaClient(databaseUrl);

  return {
    dbName,
    databaseUrl,
    prisma,
    async truncateAll(): Promise<void> {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "http_request", "dialog_context", "messenger_connection", "bot", "project", "author" RESTART IDENTITY CASCADE',
      );
    },
    async destroy(): Promise<void> {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
