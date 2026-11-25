import type { PrismaClient } from '@chatbot/db';
import type { ChatEvent } from '@chatbot/model';
import type { EventQueue } from '@chatbot/queue';
import { Logger } from '@nestjs/common';
import type { HttpResultSink } from './external-api-client';

const ENQUEUE_ATTEMPTS = 3;
const ENQUEUE_RETRY_DELAY_MS = 200;

// Приёмник результата HTTP-запроса: обновляет http_request и ставит событие в очередь диалога,
// чтобы ответ обрабатывался в том же порядке, что и остальные события (п. 2.2)
export class QueueHttpResultSink implements HttpResultSink {
  private readonly logger = new Logger(QueueHttpResultSink.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: EventQueue,
  ) {}

  async onResponse(requestId: string, status: number, body: string): Promise<void> {
    await this.finish(requestId, 'RESPONSE_RECEIVED', {
      status: 'SUCCEEDED',
      responseCode: status,
      responseBody: body,
    });
  }

  async onFailure(requestId: string, code: number, message: string): Promise<void> {
    await this.finish(requestId, 'REQUEST_FAILED', {
      status: code === 0 ? 'TIMED_OUT' : 'FAILED',
      responseCode: code === 0 ? null : code,
      error: message,
    });
  }

  private async finish(
    requestId: string,
    type: ChatEvent['type'],
    data: Record<string, unknown>,
  ): Promise<void> {
    const request = await this.prisma.httpRequest.findUnique({
      where: { id: requestId },
      include: { dialogContext: true },
    });
    if (!request) throw new Error(`HTTP-запрос ${requestId} не найден`);
    const context = request.dialogContext;
    // Сначала фиксируется результат (SENT -> итоговый статус), затем событие в очередь
    const updated = await this.prisma.httpRequest.updateMany({
      where: { id: requestId, status: 'SENT' },
      data,
    });
    // Запрос уже завершён другим путём (например, восстановлением): событие не дублируется
    if (updated.count === 0) return;
    const event: ChatEvent = {
      type,
      channel: context.channel,
      botId: context.botId,
      chatId: context.chatId,
      userId: context.userId,
      requestId,
    };
    const jobId = `http-${requestId}-${type}-${request.attempt}`;
    // Повтор с тем же jobId идемпотентен
    for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
      try {
        await this.queue.enqueue(event, jobId);
        return;
      } catch (error) {
        if (attempt === ENQUEUE_ATTEMPTS) {
          this.logger.error(
            `Не удалось поставить событие ${type} запроса ${requestId} в очередь`,
            error,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, ENQUEUE_RETRY_DELAY_MS));
      }
    }
  }
}
