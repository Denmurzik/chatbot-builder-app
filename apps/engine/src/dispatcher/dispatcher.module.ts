import { Module } from '@nestjs/common';
import { EventDispatcher } from './event-dispatcher';

// DialogService предоставляется глобально из DialogModule.register(...) в AppModule
@Module({
  providers: [EventDispatcher],
  exports: [EventDispatcher],
})
export class DispatcherModule {}
