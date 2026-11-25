import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DialogModule } from './dialog/dialog.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { EventDispatcher } from './dispatcher/event-dispatcher';
import { HttpRequestExecutor } from './http/http-request-executor';
import { HttpModule } from './http/http.module';
import { InfraModule } from './infra/infra.module';
import { MessengerModule } from './messenger/messenger.module';
import { PreviewModule } from './preview/preview.module';

// Корневой модуль приложения engine: связывает порты DialogModule с адаптерами и координирует порядок запуска
@Module({
  imports: [
    InfraModule,
    MessengerModule,
    HttpModule,
    PreviewModule,
    DialogModule.register({ imports: [MessengerModule, HttpModule, PreviewModule] }),
    DispatcherModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(
    private readonly executor: HttpRequestExecutor,
    private readonly dispatcher: EventDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Незавершённые HTTP-запросы от прошлого запуска переводятся в FAILED до старта воркеров (п. 1.5)
    await this.executor.recoverAfterRestart();
    await this.dispatcher.start();
  }
}
