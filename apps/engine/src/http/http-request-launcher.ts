import type { PendingHttpRequest } from '@chatbot/engine-core';
import { Injectable, Logger } from '@nestjs/common';
import { HttpRequestLauncher, type OutgoingHttpRequest } from '../dialog/ports';
import { ExternalApiClient } from './external-api-client';

// Адаптер запуска исходящего HTTP-запроса через ExternalApiClient (п. 2.6)
@Injectable()
export class ExternalApiHttpRequestLauncher extends HttpRequestLauncher {
  constructor(private readonly apiClient: ExternalApiClient) {
    super();
  }

  launch(request: OutgoingHttpRequest, pending: PendingHttpRequest): void {
    this.apiClient.send(
      request,
      pending.timeoutSec,
      pending.retryCount,
      pending.retryIntervalSec,
    );
  }
}

// Заглушка порта HttpRequestLauncher (оставлена для тестов без реальных HTTP-вызовов)
@Injectable()
export class NoopHttpRequestLauncher extends HttpRequestLauncher {
  private readonly logger = new Logger(NoopHttpRequestLauncher.name);

  launch(request: OutgoingHttpRequest): void {
    this.logger.debug(`HTTP-запрос ${request.id} пропущен (NoopHttpRequestLauncher)`);
  }
}
