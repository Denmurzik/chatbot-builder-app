import { createPrismaClient, type PrismaClient } from '@chatbot/db';
import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config';

// Обёртка над PrismaClient с управлением подключением в жизненном цикле NestJS
@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}

// Глобальный модуль доступа к PostgreSQL через Prisma
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
