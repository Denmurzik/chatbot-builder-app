import { envAad, SecretVault } from '@chatbot/vault';
import { describe, expect, it } from 'vitest';
import { buildEnvironment } from './environment';

const vault = new SecretVault(Buffer.alloc(32, 1), Buffer.alloc(32, 2));

describe('buildEnvironment', () => {
  it('открытые значения берутся как есть, секретные расшифровываются с AAD env:<botId>:<имя>', () => {
    const env = buildEnvironment(
      'bot1',
      [
        { name: 'HOST', value: 'https://api.test', secret: false },
        { name: 'KEY', secret: true, secretValue: vault.encrypt('s3cret-value', envAad('bot1', 'KEY')) },
      ],
      vault,
    );
    expect(env).toEqual({ HOST: 'https://api.test', KEY: 's3cret-value' });
  });

  it('секрет, перенесённый в чужого бота, не расшифровывается', () => {
    const secretValue = vault.encrypt('x', envAad('bot1', 'KEY'));
    expect(() =>
      buildEnvironment('bot2', [{ name: 'KEY', secret: true, secretValue }], vault),
    ).toThrow();
  });

  it('секретная переменная без значения даёт пустую строку', () => {
    expect(buildEnvironment('b', [{ name: 'K', secret: true }], vault)).toEqual({ K: '' });
  });
});
