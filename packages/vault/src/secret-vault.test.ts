import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { envAad, headerAad, tokenAad } from './aad';
import { SecretVault } from './secret-vault';

describe('SecretVault', () => {
  const key = randomBytes(32);
  const hashKey = randomBytes(32);

  describe('шифрование и расшифровка', () => {
    it('возвращает исходное значение после шифрования и расшифровки', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'bot-1:TELEGRAM';
      const plain = '123456789:AAH-секретный-токен-бота';

      const encrypted = vault.encrypt(plain, aad);
      const decrypted = vault.decrypt(encrypted, aad);

      expect(decrypted).toBe(plain);
    });

    it('корректно шифрует и расшифровывает пустую строку', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'project-1:EMPTY_VAR';

      const encrypted = vault.encrypt('', aad);

      expect(vault.decrypt(encrypted, aad)).toBe('');
      expect(encrypted.mask).toBe('••••');
    });

    it('формирует cipherText в формате v1:iv:tag:ct с 12-байтным IV и 16-байтным тегом', () => {
      const vault = new SecretVault(key, hashKey);
      const encrypted = vault.encrypt('super-secret-value', 'bot-1:API_KEY');

      const parts = encrypted.cipherText.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
      expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
      expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
      expect(Buffer.from(parts[3], 'base64').length).toBeGreaterThan(0);
    });

    it('даёт разный cipherText при двух шифрованиях одного и того же значения', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'bot-1:TELEGRAM';
      const value = '123456:ABCdef';

      const first = vault.encrypt(value, aad);
      const second = vault.encrypt(value, aad);

      expect(first.cipherText).not.toBe(second.cipherText);
      expect(first.mask).toBe(second.mask);
      expect(vault.decrypt(first, aad)).toBe(value);
      expect(vault.decrypt(second, aad)).toBe(value);
    });

    it('бросает ошибку при расшифровке с чужим aad', () => {
      const vault = new SecretVault(key, hashKey);
      const encrypted = vault.encrypt('secret-token-value', 'bot-1:TELEGRAM');

      expect(() => vault.decrypt(encrypted, 'bot-2:TELEGRAM')).toThrow();
    });

    it('бросает ошибку при изменении байта шифротекста', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'bot-1:TELEGRAM';
      const encrypted = vault.encrypt('123456:ABCdef', aad);

      const [version, iv, tag, ctB64] = encrypted.cipherText.split(':');
      const ctBytes = Buffer.from(ctB64, 'base64');
      ctBytes[0] ^= 0xff;
      const tampered = {
        ...encrypted,
        cipherText: `${version}:${iv}:${tag}:${ctBytes.toString('base64')}`,
      };

      expect(() => vault.decrypt(tampered, aad)).toThrow();
    });

    it('бросает ошибку при изменении тега аутентификации или неверном формате cipherText', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'bot-1:TELEGRAM';
      const encrypted = vault.encrypt('123456:ABCdef', aad);

      const [version, iv, tagB64, ct] = encrypted.cipherText.split(':');
      const tagBytes = Buffer.from(tagB64, 'base64');
      tagBytes[0] ^= 0x01;

      expect(() =>
        vault.decrypt(
          { ...encrypted, cipherText: `${version}:${iv}:${tagBytes.toString('base64')}:${ct}` },
          aad,
        ),
      ).toThrow();

      expect(() =>
        vault.decrypt({ ...encrypted, cipherText: `v2:${iv}:${tagB64}:${ct}` }, aad),
      ).toThrow();

      expect(() => vault.decrypt({ ...encrypted, cipherText: 'invalid-format' }, aad)).toThrow();
    });

    it('отклоняет усечённый 12-байтный тег аутентификации и 16-байтный IV', () => {
      const vault = new SecretVault(key, hashKey);
      const aad = 'bot-1:TELEGRAM';
      const encrypted = vault.encrypt('123456:ABCdef', aad);
      const [version, ivB64, tagB64, ct] = encrypted.cipherText.split(':');

      const truncatedTag = Buffer.from(tagB64, 'base64').subarray(0, 12).toString('base64');
      expect(() =>
        vault.decrypt(
          { ...encrypted, cipherText: `${version}:${ivB64}:${truncatedTag}:${ct}` },
          aad,
        ),
      ).toThrow();

      const iv16 = randomBytes(16).toString('base64');
      expect(() =>
        vault.decrypt({ ...encrypted, cipherText: `${version}:${iv16}:${tagB64}:${ct}` }, aad),
      ).toThrow();
    });

    it('отклоняет пустой aad при шифровании и расшифровке', () => {
      const vault = new SecretVault(key, hashKey);
      const encrypted = vault.encrypt('123456:ABCdef', 'bot-1:TELEGRAM');

      expect(() => vault.encrypt('123456:ABCdef', '')).toThrow();
      expect(() => vault.decrypt(encrypted, '')).toThrow();
    });

    it('не включает значение секрета или шифротекст в текст ошибки', () => {
      const vault = new SecretVault(key, hashKey);
      const secretVal = 'TOP_SECRET_DO_NOT_LEAK_9999';
      const encrypted = vault.encrypt(secretVal, 'bot-1:API_KEY');

      let errorMessage = '';
      try {
        vault.decrypt(encrypted, 'bot-2:API_KEY');
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      expect(errorMessage).not.toBe('');
      expect(errorMessage).not.toContain(secretVal);
      expect(errorMessage).not.toContain(encrypted.cipherText);
    });
  });

  describe('маскирование', () => {
    it("формирует маску '••••Cdef' для '123456:ABCdef'", () => {
      const vault = new SecretVault(key, hashKey);
      const encrypted = vault.encrypt('123456:ABCdef', 'bot-1:TELEGRAM');

      expect(encrypted.mask).toBe('••••Cdef');
    });

    it('скрывает короткие значения (< 12 символов) полностью и показывает 4 символа начиная с 12', () => {
      const vault = new SecretVault(key, hashKey);

      expect(vault.encrypt('ab', 'bot-1:VAR').mask).toBe('••••');
      expect(vault.encrypt('12345678901', 'bot-1:VAR').mask).toBe('••••');
      expect(vault.encrypt('123456789012', 'bot-1:VAR').mask).toBe('••••9012');
    });

    it('возвращает ту же маску через SecretVault.mask для коротких и длинных значений', () => {
      const vault = new SecretVault(key, hashKey);

      expect(vault.mask('')).toBe('••••');
      expect(vault.mask('ab')).toBe('••••');
      expect(vault.mask('12345678901')).toBe('••••');
      expect(vault.mask('123456789012')).toBe('••••9012');
      expect(vault.mask('123456:ABCdef')).toBe('••••Cdef');
      expect(vault.mask('123456:ABCdef')).toBe(
        vault.encrypt('123456:ABCdef', 'bot-1:TELEGRAM').mask,
      );
    });
  });

  describe('хеширование (hash)', () => {
    it('детерминирован и равен HMAC-SHA-256 в hex', () => {
      const vault = new SecretVault(key, hashKey);
      const token = '123456:ABCdef';
      const expected = createHmac('sha256', hashKey).update(token, 'utf8').digest('hex');

      const hash1 = vault.hash(token);
      const hash2 = vault.hash(token);

      expect(hash1).toBe(expected);
      expect(hash2).toBe(hash1);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('даёт разные хеши для разных токенов', () => {
      const vault = new SecretVault(key, hashKey);

      expect(vault.hash('token-1')).not.toBe(vault.hash('token-2'));
    });
  });

  describe('проверка ключей и fromEnv', () => {
    it('бросает ошибку в конструкторе, если длина ключа или ключа хеширования не 32 байта', () => {
      expect(() => new SecretVault(randomBytes(16), hashKey)).toThrow();
      expect(() => new SecretVault(randomBytes(33), hashKey)).toThrow();
      expect(() => new SecretVault(key, randomBytes(31))).toThrow();
      expect(() => new SecretVault(key, randomBytes(64))).toThrow();
    });

    it('отклоняет совпадающие key и hashKey в конструкторе и fromEnv', () => {
      const sameKeyCopy = Buffer.from(key);
      const sameKeyB64 = key.toString('base64');

      expect(() => new SecretVault(key, sameKeyCopy)).toThrow(
        'Ключи VAULT_KEY и VAULT_HASH_KEY должны различаться',
      );
      expect(() =>
        SecretVault.fromEnv({ VAULT_KEY: sameKeyB64, VAULT_HASH_KEY: sameKeyB64 }),
      ).toThrow('Ключи VAULT_KEY и VAULT_HASH_KEY должны различаться');
    });

    it('создаёт экземпляр через fromEnv с валидными 32-байтными ключами в base64', () => {
      const env: NodeJS.ProcessEnv = {
        VAULT_KEY: key.toString('base64'),
        VAULT_HASH_KEY: hashKey.toString('base64'),
      };

      const vault = SecretVault.fromEnv(env);
      const encrypted = vault.encrypt('123456:ABCdef', 'bot-1:TELEGRAM');

      expect(vault.decrypt(encrypted, 'bot-1:TELEGRAM')).toBe('123456:ABCdef');
      expect(vault.hash('123456:ABCdef')).toBe(
        createHmac('sha256', hashKey).update('123456:ABCdef', 'utf8').digest('hex'),
      );
    });

    it('бросает ошибку в fromEnv при отсутствии ключей, неверном base64 или длине не 32 байта', () => {
      const validKey = key.toString('base64');
      const shortKey = randomBytes(16).toString('base64');

      expect(() => SecretVault.fromEnv({})).toThrow();
      expect(() => SecretVault.fromEnv({ VAULT_KEY: validKey })).toThrow();
      expect(() => SecretVault.fromEnv({ VAULT_HASH_KEY: validKey })).toThrow();
      expect(() =>
        SecretVault.fromEnv({ VAULT_KEY: shortKey, VAULT_HASH_KEY: validKey }),
      ).toThrow();
      expect(() =>
        SecretVault.fromEnv({ VAULT_KEY: validKey, VAULT_HASH_KEY: shortKey }),
      ).toThrow();
      expect(() =>
        SecretVault.fromEnv({ VAULT_KEY: 'не-base64!!!', VAULT_HASH_KEY: validKey }),
      ).toThrow();
    });

    it('не включает значение невалидного ключа в сообщение об ошибке fromEnv', () => {
      const badSecretKey = randomBytes(16).toString('base64');
      let errorMessage = '';
      try {
        SecretVault.fromEnv({
          VAULT_KEY: badSecretKey,
          VAULT_HASH_KEY: hashKey.toString('base64'),
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      expect(errorMessage).not.toBe('');
      expect(errorMessage).not.toContain(badSecretKey);
    });
  });

  describe('форматы AAD с префиксами', () => {
    it('формирует AAD для токена, переменной окружения и заголовка', () => {
      expect(tokenAad('bot-1')).toBe('token:bot-1:TELEGRAM');
      expect(envAad('owner-1', 'API_KEY')).toBe('env:owner-1:API_KEY');
      expect(headerAad('proj-1', 'Authorization')).toBe('header:proj-1:Authorization');
    });

    it('префиксы не допускают перенос шифротекста между разными типами сущностей', () => {
      const vault = new SecretVault(key, hashKey);
      const encrypted = vault.encrypt('secret-value', envAad('id-1', 'TELEGRAM'));
      expect(() => vault.decrypt(encrypted, tokenAad('id-1'))).toThrow();
      expect(() => vault.decrypt(encrypted, headerAad('id-1', 'TELEGRAM'))).toThrow();
    });
  });
});
