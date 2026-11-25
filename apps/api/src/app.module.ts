import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config';
import { ImportExportModule } from './import-export/import-export.module';
import { PreviewModule } from './preview/preview.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectModule } from './projects/project.module';
import { PublicationModule } from './publication/publication.module';
import { QueueModule } from './queue/queue.module';
import { TelegramModule } from './telegram/telegram.module';
import { ValidatorModule } from './validation/validator.module';
import { VaultModule } from './vault/vault.module';
import { VkModule } from './vk/vk.module';

// Корневой модуль HTTP API приложения
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    VaultModule,
    AuthModule,
    ProjectModule.register({ imports: [TelegramModule, VkModule] }),
    QueueModule,
    TelegramModule,
    VkModule,
    ValidatorModule,
    PublicationModule.register({ imports: [TelegramModule, VkModule] }),
    ImportExportModule,
    PreviewModule,
  ],
})
export class AppModule {}
