import { type INestApplication, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';

// Общая настройка HTTP и WebSocket приложения: лимит JSON и YAML 1 МБ, cookie-parser, Socket.IO и префикс /api (кроме webhook/*)
export function configureApp(app: INestApplication): void {
  const expressApp = app as NestExpressApplication;
  expressApp.useBodyParser('json', { limit: '1mb' });
  expressApp.useBodyParser('text', {
    type: ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/plain'],
    limit: '1mb',
  });
  app.use(cookieParser());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook/(.*)', method: RequestMethod.ALL }],
  });
}
