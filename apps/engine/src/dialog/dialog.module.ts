import { DialogEngine } from '@chatbot/engine-core';
import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { ContextRepository } from './context.repository';
import { DialogService } from './dialog.service';

// Модуль исполнения диалогов: зависит только от портов в ./ports; адаптеры подключаются в AppModule
@Module({})
export class DialogModule {
  static register(options: { imports?: ModuleMetadata['imports'] } = {}): DynamicModule {
    return {
      module: DialogModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        { provide: DialogEngine, useFactory: () => new DialogEngine() },
        ContextRepository,
        DialogService,
      ],
      exports: [DialogEngine, DialogService],
    };
  }
}
