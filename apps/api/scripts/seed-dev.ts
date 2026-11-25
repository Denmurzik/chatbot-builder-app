import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPrismaClient, type Prisma } from '@chatbot/db';
import { parseScenario } from '@chatbot/model';
import { SecretVault, tokenAad } from '@chatbot/vault';
import argon2 from 'argon2';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV?.trim() === 'production') {
  console.error('Скрипт seed:dev запрещён в production (NODE_ENV=production)');
  process.exit(1);
}

const DEV_EMAIL = 'dev@example.com';
const DEV_PASSWORD = 'devpassword';
const NAME = 'Эхо';

// Заполняет dev-базу: автор, проект и опубликованный эхо-бот; повторный запуск дублей не создаёт
async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const scenario = parseScenario(
      JSON.parse(readFileSync(path.resolve(__dirname, 'echo-scenario.json'), 'utf8')),
    ) as unknown as Prisma.InputJsonValue;

    const author =
      (await prisma.author.findUnique({ where: { email: DEV_EMAIL } })) ??
      (await prisma.author.create({
        data: {
          email: DEV_EMAIL,
          passwordHash: await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id }),
        },
      }));

    const project =
      (await prisma.project.findFirst({ where: { authorId: author.id, name: NAME } })) ??
      (await prisma.project.create({
        data: { authorId: author.id, name: NAME, scenario, environment: [] },
      }));

    const botData = {
      status: 'PUBLISHED' as const,
      publishedScenario: scenario,
      environment: [],
      publishedAt: new Date(),
    };
    const existingBot = await prisma.bot.findFirst({
      where: { projectId: project.id, name: NAME },
    });
    const bot = existingBot
      ? await prisma.bot.update({ where: { id: existingBot.id }, data: botData })
      : await prisma.bot.create({ data: { projectId: project.id, name: NAME, ...botData } });

    const token = process.env.TELEGRAM_DEV_TOKEN?.trim();
    if (!token) {
      console.log('TELEGRAM_DEV_TOKEN не задан: подключение Telegram не создано');
    } else {
      const vault = SecretVault.fromEnv();
      const encrypted = vault.encrypt(token, tokenAad(bot.id));
      const data = {
        tokenCipher: encrypted.cipherText,
        tokenMask: encrypted.mask,
        tokenHash: vault.hash(token),
      };
      await prisma.messengerConnection.upsert({
        where: { botId_messenger: { botId: bot.id, messenger: 'TELEGRAM' } },
        create: { botId: bot.id, messenger: 'TELEGRAM', ...data },
        update: data,
      });
      console.log(`Подключение Telegram создано (токен ${encrypted.mask})`);
    }
    console.log(`Готово: автор ${DEV_EMAIL}, проект «${NAME}», бот ${bot.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
