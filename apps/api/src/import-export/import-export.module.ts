import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';

// Модуль экспорта и импорта сценариев (UC-A-29…A-31); ProjectService и ScenarioEditor приходят из глобального ProjectModule
@Module({
  imports: [AuthModule],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
