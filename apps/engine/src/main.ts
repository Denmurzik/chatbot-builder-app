import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Engine — автономное приложение без HTTP-сервера: только воркеры очереди
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error('Не удалось запустить engine', error);
  process.exit(1);
});
