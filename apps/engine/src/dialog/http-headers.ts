import type { PendingHttpHeader } from '@chatbot/engine-core';
import { headerAad, type SecretVault } from '@chatbot/vault';
import { Logger } from '@nestjs/common';

const logger = new Logger('HttpHeaders');

// Заголовок в том виде, в каком он хранится в http_request.headers
export interface StoredHeader {
  name: string;
  value: string;
  secret: boolean;
}

// Для хранения: вместо секретного значения — маска (п. 2.13)
export function toStoredHeaders(headers: PendingHttpHeader[]): StoredHeader[] {
  return headers.map((h) => ({
    name: h.name,
    value: h.secret ? (h.secretValue?.mask ?? '') : h.value,
    secret: h.secret,
  }));
}

// Для отправки: секреты расшифровываются только в памяти. AAD — `header:<projectId>:<имя заголовка>`.
export function decryptHeaders(
  headers: PendingHttpHeader[],
  projectId: string,
  vault: SecretVault,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h.secret) {
      if (h.secretValue) {
        result[h.name] = vault.decrypt(h.secretValue, headerAad(projectId, h.name));
      } else {
        // Секретный заголовок без шифротекста никогда не подставляет открытое h.value
        logger.warn(`Секретный заголовок "${h.name}" не содержит зашифрованного значения`);
        result[h.name] = '';
      }
    } else {
      result[h.name] = h.value;
    }
  }
  return result;
}
