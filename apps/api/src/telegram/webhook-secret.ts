import { createHmac } from 'node:crypto';

const KEY_LENGTH_BYTES = 32;

// Секрет webhook бота: HMAC-SHA-256(VAULT_HASH_KEY, 'webhook:' + botId) в hex (п. 2.12);
// отдельный столбец не нужен, секрет всегда вычисляется из botId
export function webhookSecret(botId: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.VAULT_HASH_KEY?.trim();
  if (!raw) throw new Error('Не задана переменная окружения VAULT_HASH_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `VAULT_HASH_KEY должен декодироваться ровно в ${KEY_LENGTH_BYTES} байт (получено ${key.length})`,
    );
  }
  return createHmac('sha256', key).update(`webhook:${botId}`).digest('hex');
}
