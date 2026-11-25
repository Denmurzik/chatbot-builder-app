import type { PrismaClient } from '@chatbot/db';
import type { ChatEvent } from '@chatbot/model';
import type { EventQueue } from '@chatbot/queue';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_QUEUE, PRISMA } from '../infra/tokens';

export const RESTART_INTERRUPTED_ERROR = 'запрос прерван перезапуском';

/**
 * Класс модели BCE: HttpRequestExecutor — восстановление незавершённых HTTP-запросов
 * после перезапуска engine (п. 1.5). Обработка ответов, стратегий ошибок и возобновления
 * выполняется в DialogEngine (engine-core), а запись и отправка — в DialogService.
 */
@Injectable()
export class HttpRequestExecutor {
  private readonly logger = new Logger(HttpRequestExecutor.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
  ) {}

  // Предполагает один процесс engine: при нескольких процессах SENT-запросы соседа были бы
  // ошибочно сочтены прерванными (несколько процессов engine вне объёма спринта 2)
  // Переводит все http_request в статусе SENT в FAILED и ставит REQUEST_FAILED в очередь (п. 1.5)
  async recoverAfterRestart(): Promise<number> {
    const pending = await this.prisma.httpRequest.findMany({
      where: { status: 'SENT' },
      include: { dialogContext: true },
    });

    let recovered = 0;
    for (const req of pending) {
      const updated = await this.prisma.httpRequest.updateMany({
        where: { id: req.id, status: 'SENT' },
        data: { status: 'FAILED', error: RESTART_INTERRUPTED_ERROR },
      });
      if (updated.count === 0) continue;

      const ctx = req.dialogContext;
      const event: ChatEvent = {
        type: 'REQUEST_FAILED',
        channel: ctx.channel,
        botId: ctx.botId,
        chatId: ctx.chatId,
        userId: ctx.userId,
        requestId: req.id,
      };
      await this.queue.enqueue(event, `http-${req.id}-REQUEST_FAILED-${req.attempt}`);
      recovered += 1;
    }

    if (recovered > 0) {
      this.logger.warn(`Восстановлено прерванных HTTP-запросов после перезапуска: ${recovered}`);
    }
    return recovered;
  }
}
