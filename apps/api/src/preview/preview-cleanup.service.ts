import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

const DEFAULT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// Фоновая очистка просроченных контекстов диалога превью (TTL 24 часа, запуск раз в час)
@Injectable()
export class PreviewCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.pruneExpired().catch((err) => {
        this.logger.error(
          `Ошибка очистки контекстов превью: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Удаляет контексты превью старше ttlMs вместе со связанными HTTP-запросами
  async pruneExpired(ttlMs = DEFAULT_PREVIEW_TTL_MS): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs);
    return this.prisma.client.$transaction(async (tx) => {
      const expired = await tx.dialogContext.findMany({
        where: { channel: 'PREVIEW', updatedAt: { lt: cutoff } },
        select: { id: true },
      });
      if (expired.length === 0) return 0;

      const ids = expired.map((row) => row.id);
      await tx.dialogContext.updateMany({
        where: { id: { in: ids } },
        data: { currentRequestId: null },
      });
      await tx.httpRequest.deleteMany({
        where: { dialogContextId: { in: ids } },
      });
      const deleted = await tx.dialogContext.deleteMany({
        where: { id: { in: ids } },
      });
      return deleted.count;
    });
  }
}
