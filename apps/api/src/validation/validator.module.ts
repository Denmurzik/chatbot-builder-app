import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScenarioValidator } from './scenario-validator';
import { ValidationController } from './validation.controller';

// Модуль проверки сценария (UC-A-24, UC-A-27, спринт 2)
@Module({
  imports: [AuthModule],
  controllers: [ValidationController],
  providers: [ScenarioValidator],
  exports: [ScenarioValidator],
})
export class ValidatorModule {}
