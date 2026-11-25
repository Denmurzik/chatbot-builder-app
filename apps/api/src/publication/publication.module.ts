import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnvironmentService } from '../common/environment.service';
import {
  CompositeMessengerAdminPort,
  MessengerAdminPort,
} from '../common/messenger-admin.port';
import { ValidatorModule } from '../validation/validator.module';
import { BotService } from './bot.service';
import { PublicationController } from './publication.controller';

// Модуль управления ботами, подключениями и публикацией (UC-A-25…A-28, UC-A-32, SD-6)
// Зависит только от порта MessengerAdminPort; адаптеры мессенджеров подключаются в AppModule
@Module({})
export class PublicationModule {
  static register(options: { imports?: ModuleMetadata['imports'] } = {}): DynamicModule {
    return {
      module: PublicationModule,
      imports: [AuthModule, ValidatorModule, ...(options.imports ?? [])],
      controllers: [PublicationController],
      providers: [
        BotService,
        EnvironmentService,
        { provide: MessengerAdminPort, useClass: CompositeMessengerAdminPort },
      ],
      exports: [BotService],
    };
  }
}
