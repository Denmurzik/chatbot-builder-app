import { describe, expect, it } from 'vitest';
import { webhookSecret } from './webhook-secret';

describe('webhookSecret', () => {
  it('вычисляет 64-символьный hex для ключа ровно 32 байта', () => {
    const key32 = Buffer.alloc(32, 7).toString('base64');
    const secret = webhookSecret('bot-1', { VAULT_HASH_KEY: key32 });
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('бросает ошибку, если VAULT_HASH_KEY не задан', () => {
    expect(() => webhookSecret('bot-1', {})).toThrow(/VAULT_HASH_KEY/);
  });

  it('бросает ошибку, если декодированный VAULT_HASH_KEY не равен 32 байтам', () => {
    const key16 = Buffer.alloc(16, 1).toString('base64');
    const key64 = Buffer.alloc(64, 1).toString('base64');
    expect(() => webhookSecret('bot-1', { VAULT_HASH_KEY: key16 })).toThrow(/32 байт/);
    expect(() => webhookSecret('bot-1', { VAULT_HASH_KEY: key64 })).toThrow(/32 байт/);
  });
});
