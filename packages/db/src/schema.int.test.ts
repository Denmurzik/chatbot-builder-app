import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://chatbot:chatbot@127.0.0.1:55432/chatbot';
// Собственная база теста, чтобы не трогать данные других worktree
const dbName = `chatbot_test_db_${randomBytes(4).toString('hex')}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${dbName}`;

describe('схема PostgreSQL', () => {
  let admin: PrismaClient;
  let db: PrismaClient;

  beforeAll(async () => {
    admin = createPrismaClient(ADMIN_URL);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      stdio: 'pipe',
    });
    db = createPrismaClient(testUrl.toString());
  }, 120000);

  afterAll(async () => {
    await db?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin?.$disconnect();
  });

  async function createBot(suffix: string) {
    const author = await db.author.create({
      data: { email: `a-${suffix}@x.ru`, passwordHash: 'h' },
    });
    const project = await db.project.create({
      data: { authorId: author.id, name: 'p', scenario: {}, environment: [] },
    });
    return db.bot.create({
      data: { projectId: project.id, name: 'b', environment: [] },
    });
  }

  it('миграция применена: все таблицы на месте', async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'author',
      'project',
      'bot',
      'messenger_connection',
      'dialog_context',
      'http_request',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('UNIQUE email у author', async () => {
    await db.author.create({ data: { email: 'dup@x.ru', passwordHash: 'h' } });
    await expect(
      db.author.create({ data: { email: 'dup@x.ru', passwordHash: 'h' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('UNIQUE token_hash и UNIQUE (bot_id, messenger)', async () => {
    const bot1 = await createBot('t1');
    const bot2 = await createBot('t2');
    const conn = (botId: string, messenger: 'TELEGRAM' | 'VK', tokenHash: string) => ({
      data: { botId, messenger, tokenCipher: 'c', tokenMask: 'm', tokenHash },
    });
    await db.messengerConnection.create(conn(bot1.id, 'TELEGRAM', 'hash-1'));
    await expect(
      db.messengerConnection.create(conn(bot2.id, 'TELEGRAM', 'hash-1')),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.messengerConnection.create(conn(bot1.id, 'TELEGRAM', 'hash-2')),
    ).rejects.toMatchObject({ code: 'P2002' });
    await db.messengerConnection.create(conn(bot1.id, 'VK', 'hash-3'));
  });

  it('UNIQUE (bot_id, chat_id); для превью (bot_id NULL) повторы допустимы', async () => {
    const bot = await createBot('d1');
    const ctx = (botId: string | null, chatId: string) => ({
      data: {
        botId,
        chatId,
        userId: 'u',
        channel: botId ? ('MESSENGER' as const) : ('PREVIEW' as const),
        state: 'RUNNING' as const,
        currentBlockId: 'b1',
        variables: {},
      },
    });
    await db.dialogContext.create(ctx(bot.id, 'chat-1'));
    await expect(db.dialogContext.create(ctx(bot.id, 'chat-1'))).rejects.toMatchObject({
      code: 'P2002',
    });
    await db.dialogContext.create(ctx(null, 'preview:1'));
    await db.dialogContext.create(ctx(null, 'preview:1'));
  });

  it('http_request и текущий запрос диалога', async () => {
    const ctx = await db.dialogContext.create({
      data: {
        botId: null,
        chatId: 'preview:2',
        userId: 'u',
        channel: 'PREVIEW',
        state: 'WAITING_EXTERNAL',
        currentBlockId: 'b3',
        variables: {},
      },
    });
    const req = await db.httpRequest.create({
      data: {
        dialogContextId: ctx.id,
        blockId: 'b3',
        method: 'GET',
        url: 'http://x',
        headers: [],
        body: '',
        status: 'SENT',
      },
    });
    const updated = await db.dialogContext.update({
      where: { id: ctx.id },
      data: { currentRequestId: req.id },
    });
    expect(updated.currentRequestId).toBe(req.id);
    expect(req.responseCode).toBeNull();
  });
});
