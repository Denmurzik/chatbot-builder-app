import { Module } from '@nestjs/common';
import { VK_ADMIN_ADAPTER } from '../common/messenger-admin.port';
import { VkAdminAdapter } from './vk-admin.adapter';
import { VkApiClient } from './vk-api.client';
import { VkPollingService } from './vk-polling.service';
import { VkWebhookController } from './vk-webhook.controller';

// Приём обновлений VK: Callback API и Bots Long Poll -> очередь событий
@Module({
  controllers: [VkWebhookController],
  providers: [
    VkApiClient,
    VkPollingService,
    VkAdminAdapter,
    { provide: VK_ADMIN_ADAPTER, useExisting: VkAdminAdapter },
  ],
  exports: [VkApiClient, VkPollingService, VkAdminAdapter, VK_ADMIN_ADAPTER],
})
export class VkModule {}
