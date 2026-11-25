import type { PrismaClient } from '@chatbot/db';
import type { EventQueue } from '@chatbot/queue';
import { Module } from '@nestjs/common';
import { loadAllowedHosts } from '../config';
import { HttpRequestLauncher } from '../dialog/ports';
import { EVENT_QUEUE, PRISMA } from '../infra/tokens';
import { ExternalApiClient } from './external-api-client';
import { HttpRequestExecutor } from './http-request-executor';
import { ExternalApiHttpRequestLauncher } from './http-request-launcher';
import { QueueHttpResultSink } from './queue-http-result-sink';
import { ResponseParser } from './response-parser';

@Module({
  providers: [
    {
      provide: QueueHttpResultSink,
      inject: [PRISMA, EVENT_QUEUE],
      useFactory: (prisma: PrismaClient, queue: EventQueue) =>
        new QueueHttpResultSink(prisma, queue),
    },
    {
      provide: ExternalApiClient,
      inject: [QueueHttpResultSink],
      useFactory: (sink: QueueHttpResultSink) => new ExternalApiClient(sink, loadAllowedHosts()),
    },
    ResponseParser,
    HttpRequestExecutor,
    { provide: HttpRequestLauncher, useClass: ExternalApiHttpRequestLauncher },
  ],
  exports: [
    ExternalApiClient,
    QueueHttpResultSink,
    ResponseParser,
    HttpRequestExecutor,
    HttpRequestLauncher,
  ],
})
export class HttpModule {}
