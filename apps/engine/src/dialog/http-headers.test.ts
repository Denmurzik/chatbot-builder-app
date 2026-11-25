import { headerAad, SecretVault } from '@chatbot/vault';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { decryptHeaders, toStoredHeaders } from './http-headers';

const vault = new SecretVault(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
const secretValue = vault.encrypt('Bearer abcdefghijkl', headerAad('proj1', 'Authorization'));
const headers = [
  { name: 'Accept', value: 'application/json', secret: false },
  { name: 'Authorization', value: '', secret: true, secretValue },
];

describe('заголовки http_request', () => {
  it('в базу пишется маска вместо секретного значения', () => {
    const stored = toStoredHeaders(headers);
    expect(stored).toEqual([
      { name: 'Accept', value: 'application/json', secret: false },
      { name: 'Authorization', value: secretValue.mask, secret: true },
    ]);
    expect(JSON.stringify(stored)).not.toContain('abcdefghijkl');
  });

  it('для отправки секреты расшифровываются в памяти с AAD header:<projectId>:<name>', () => {
    expect(decryptHeaders(headers, 'proj1', vault)).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer abcdefghijkl',
    });
  });

  it('секретный заголовок с чужим projectId не расшифровывается', () => {
    expect(() => decryptHeaders(headers, 'proj2', vault)).toThrow();
  });

  it('секретный заголовок без secretValue даёт пустую строку (не h.value) и пишет предупреждение без значения', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const result = decryptHeaders(
        [{ name: 'X-Api-Key', value: 'leaked-plaintext', secret: true }],
        'proj1',
        vault,
      );
      expect(result).toEqual({ 'X-Api-Key': '' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('leaked-plaintext');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
