import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_CONFIG, type ApiConfig } from './config';
import { configureApp } from './configure-app';

// Точка входа HTTP-сервера @chatbot/api
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
