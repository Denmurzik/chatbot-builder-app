import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { type EncryptedSecret } from '@chatbot/model';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MASK_PREFIX = '••••';
const MASK_VISIBLE_CHARS = 4;
const MASK_MIN_LENGTH_FOR_TAIL = 12;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

// Декодирует ключ из переменной окружения (base64, ровно 32 байта) без утечки значения в ошибки
function decodeEnvKey(raw: string | undefined, envName: string): Buffer {
  if (!raw) {
    throw new Error(`Не задана переменная окружения ${envName}`);
  }
  if (raw.length % 4 !== 0 || !BASE64_PATTERN.test(raw)) {
    throw new Error(`Переменная окружения ${envName} должна содержать корректную строку base64`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Ключ ${envName} должен иметь длину ровно ${KEY_LENGTH} байта`);
  }
  return key;
}

// Декодирует base64-компонент шифротекста с проверкой корректности кодировки
function decodeBase64Part(encoded: string, allowEmpty: boolean): Buffer {
  if (encoded.length === 0) {
    if (allowEmpty) {
      return Buffer.alloc(0);
    }
    throw new Error('Некорректный формат шифротекста');
  }
  if (encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new Error('Некорректный формат шифротекста');
  }
  return Buffer.from(encoded, 'base64');
}

// Формирует маску секрета: скрывает короткие значения полностью, от 12 символов оставляет 4 последних
function makeMask(value: string): string {
  const codePoints = Array.from(value);
  const tail =
    codePoints.length >= MASK_MIN_LENGTH_FOR_TAIL
      ? codePoints.slice(-MASK_VISIBLE_CHARS).join('')
      : '';
  return `${MASK_PREFIX}${tail}`;
}

// Хранилище для шифрования секретов (AES-256-GCM), маскирования и хеширования токенов (п. 2.13)
export class SecretVault {
  private readonly key: Buffer;
  private readonly hashKey: Buffer;

  constructor(key: Buffer, hashKey: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
      throw new Error(`Ключ шифрования должен иметь длину ровно ${KEY_LENGTH} байта`);
    }
    if (!Buffer.isBuffer(hashKey) || hashKey.length !== KEY_LENGTH) {
      throw new Error(`Ключ хеширования должен иметь длину ровно ${KEY_LENGTH} байта`);
    }
    if (timingSafeEqual(key, hashKey)) {
      throw new Error('Ключи VAULT_KEY и VAULT_HASH_KEY должны различаться');
    }
    // Копируем буферы, чтобы внешние изменения не затронули ключи внутри экземпляра
    this.key = Buffer.from(key);
    this.hashKey = Buffer.from(hashKey);
  }

  // Создаёт SecretVault из переменных окружения VAULT_KEY и VAULT_HASH_KEY (base64, 32 байта)
  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretVault {
    const key = decodeEnvKey(env.VAULT_KEY, 'VAULT_KEY');
    const hashKey = decodeEnvKey(env.VAULT_HASH_KEY, 'VAULT_HASH_KEY');
    return new SecretVault(key, hashKey);
  }

  // Шифрует значение алгоритмом AES-256-GCM с привязкой к AAD и формирует маску
  encrypt(value: string, aad: string): EncryptedSecret {
    if (!aad) {
      throw new Error('AAD не может быть пустым');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    cipher.setAAD(Buffer.from(aad, 'utf8'));

    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const cipherText = `${FORMAT_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
    const mask = makeMask(value);

    return { cipherText, mask };
  }

  // Расшифровывает секрет с проверкой версии, тега аутентификации и AAD
  decrypt(secret: EncryptedSecret, aad: string): string {
    if (!aad) {
      throw new Error('AAD не может быть пустым');
    }

    const parts = secret.cipherText.split(':');
    if (parts.length !== 4) {
      throw new Error('Некорректный формат шифротекста');
    }

    const [version, ivB64, tagB64, ctB64] = parts;
    if (version !== FORMAT_VERSION) {
      throw new Error('Неподдерживаемая версия формата шифротекста');
    }

    const iv = decodeBase64Part(ivB64, false);
    const tag = decodeBase64Part(tagB64, false);
    const ct = decodeBase64Part(ctB64, true);

    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Некорректная длина параметров шифротекста');
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      throw new Error('Не удалось расшифровать секрет: неверный ключ, AAD или повреждённые данные');
    }
  }

  // Возвращает маскированное представление секрета
  mask(value: string): string {
    return makeMask(value);
  }

  // Вычисляет детерминированный HMAC-SHA-256 (hex) для проверки уникальности токена
  hash(token: string): string {
    return createHmac('sha256', this.hashKey).update(token, 'utf8').digest('hex');
  }
}
