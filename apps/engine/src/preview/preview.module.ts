import { Module } from '@nestjs/common';
import { PreviewNotifier } from '../dialog/ports';
import { PreviewPublisher } from './preview-publisher';

// Модуль публикации событий канала превью в Redis (UC-A-20…A-23, спринт 2)
@Module({
  providers: [
    PreviewPublisher,
    { provide: PreviewNotifier, useExisting: PreviewPublisher },
  ],
  exports: [PreviewPublisher, PreviewNotifier],
})
export class PreviewModule {}
