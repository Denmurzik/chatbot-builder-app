import { EventQueue } from '@chatbot/queue';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config';

export const EVENT_QUEUE = Symbol('EVENT_QUEUE');

// Глобальный модуль очереди событий (производитель; потребляет её engine)
@Global()
@Module({
  providers: [
    {
      provide: EVENT_QUEUE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): EventQueue => {
        const redisUrl = process.env.REDIS_URL?.trim();
        if (!redisUrl) throw new Error('Не задана переменная окружения REDIS_URL');
        return new EventQueue(redisUrl, config.queuePrefix ? { prefix: config.queuePrefix } : {});
      },
    },
  ],
  exports: [EVENT_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(EVENT_QUEUE) private readonly queue: EventQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
