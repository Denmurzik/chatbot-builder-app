import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreviewCleanupService } from './preview-cleanup.service';
import { PreviewGateway } from './preview.gateway';
import { PreviewSubscriber } from './preview-subscriber';

// Модуль превью сценария: Socket.IO-шлюз, подписчик Redis pub/sub и очистка старых контекстов (UC-A-20…A-23)
@Module({
  imports: [AuthModule],
  providers: [PreviewSubscriber, PreviewGateway, PreviewCleanupService],
})
export class PreviewModule {}
