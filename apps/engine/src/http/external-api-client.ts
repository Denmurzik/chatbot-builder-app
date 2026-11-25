import pRetry, { AbortError } from 'p-retry';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { OutgoingHttpRequest } from '../dialog/ports';

export type { OutgoingHttpRequest };

// Ограничение размера тела ответа внешней системы — 1 МБ (п. 3.1)
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;

/** Приёмник результата: вызывается один раз после всех попыток. */
export interface HttpResultSink {
  onResponse(requestId: string, status: number, body: string): Promise<void>;
  onFailure(requestId: string, code: number, message: string): Promise<void>;
}

/** Ошибка с кодом: HTTP-статус не 2xx или 0 для тайм-аута и сетевой ошибки. */
class HttpAttemptError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * HTTP-клиент с тайм-аутом и повторами (п. 2.6).
 * `send` не ждёт ответа: результат приходит в приёмник.
 */
export class ExternalApiClient {
  // allowedHosts: null или пустой список — без ограничений (dev); иначе только перечисленные имена хостов
  constructor(
    private readonly sink: HttpResultSink,
    private readonly allowedHosts: readonly string[] | null = null,
  ) {}

  send(request: OutgoingHttpRequest, timeoutSec: number, retryCount: number, retryIntervalSec: number): void {
    this.run(request, timeoutSec, retryCount, retryIntervalSec).catch((error: unknown) => {
      console.error('ExternalApiClient: необработанная ошибка', error);
    });
  }

  private async run(
    request: OutgoingHttpRequest,
    timeoutSec: number,
    retryCount: number,
    retryIntervalSec: number,
  ): Promise<void> {
    let result: { status: number; body: string };
    // Запрещённый адрес — сразу отказ без повторов (защита внутренней сети сервера от SSRF)
    if (!this.isHostAllowed(request.url)) {
      await this.safely('onFailure', () => this.sink.onFailure(request.id, 0, 'Адрес не разрешён'));
      return;
    }
    try {
      result = await pRetry(() => this.attempt(request, timeoutSec), {
        retries: retryCount,
        minTimeout: retryIntervalSec * 1000,
        maxTimeout: retryIntervalSec * 1000,
        factor: 1,
        randomize: false,
      });
    } catch (error) {
      const unwrapped =
        error instanceof AbortError && error.originalError ? error.originalError : error;
      const failure =
        unwrapped instanceof HttpAttemptError
          ? unwrapped
          : new HttpAttemptError(0, 'Не удалось выполнить запрос');
      await this.safely('onFailure', () => this.sink.onFailure(request.id, failure.code, failure.message));
      return;
    }
    await this.safely('onResponse', () => this.sink.onResponse(request.id, result.status, result.body));
  }

  private isHostAllowed(url: string): boolean {
    if (!this.allowedHosts || this.allowedHosts.length === 0) return true;
    try {
      return this.allowedHosts.includes(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /** Ошибка приёмника только логируется и не попадает в путь ошибок запроса. */
  private async safely(name: string, call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (error) {
      console.error(`ExternalApiClient: ошибка в приёмнике ${name}`, error);
    }
  }

  /** Одна попытка: 2xx — успех, всё остальное — ошибка для повтора. */
  private async attempt(
    request: OutgoingHttpRequest,
    timeoutSec: number,
  ): Promise<{ status: number; body: string }> {
    try {
      const response = await undiciRequest(request.url, {
        method: request.method as Dispatcher.HttpMethod,
        headers: request.headers,
        body: request.body ?? undefined,
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump().catch(() => undefined);
        throw new HttpAttemptError(response.statusCode, `Внешняя система ответила кодом ${response.statusCode}`);
      }
      const body = await this.readBodyWithLimit(response.body);
      return { status: response.statusCode, body };
    } catch (error) {
      if (error instanceof HttpAttemptError || error instanceof AbortError) throw error;
      const name = (error as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new HttpAttemptError(0, `Превышено время ожидания ответа (${timeoutSec} с)`);
      }
      throw new HttpAttemptError(0, `Сетевая ошибка: ${(error as Error).message}`);
    }
  }

  /** Читает тело ответа с ограничением 1 МБ (п. 3.1); при превышении прерывает без повторов. */
  private async readBodyWithLimit(body: Dispatcher.ResponseData['body']): Promise<string> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buf.length;
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        body.destroy();
        throw new AbortError(new HttpAttemptError(0, 'Ошибка разбора: ответ слишком большой'));
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  }
}
