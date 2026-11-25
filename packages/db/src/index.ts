// Точка входа пакета @chatbot/db
import { PrismaClient } from '@prisma/client';

// Клиент Prisma; без аргумента URL берётся из DATABASE_URL
export function createPrismaClient(url?: string): PrismaClient {
  return url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
}

export * from '@prisma/client';
