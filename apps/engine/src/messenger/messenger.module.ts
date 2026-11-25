import { Module } from '@nestjs/common';
import { MessengerGateway } from '../dialog/ports';
import { CompositeMessengerGateway } from './composite-messenger-gateway';
import { TelegramMessengerGateway } from './messenger-gateway';
import { VkMessengerGateway } from './vk-messenger-gateway';

@Module({
  providers: [
    TelegramMessengerGateway,
    VkMessengerGateway,
    { provide: MessengerGateway, useClass: CompositeMessengerGateway },
  ],
  exports: [TelegramMessengerGateway, VkMessengerGateway, MessengerGateway],
})
export class MessengerModule {}
