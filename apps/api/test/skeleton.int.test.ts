import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ImportExportController } from '../src/import-export/import-export.controller';
import { ImportExportService } from '../src/import-export/import-export.service';
import { PreviewGateway } from '../src/preview/preview.gateway';
import { PreviewSubscriber } from '../src/preview/preview-subscriber';
import { ProjectController } from '../src/projects/project.controller';
import { ScenarioEditor } from '../src/projects/scenario-editor';
import { PublicationController } from '../src/publication/publication.controller';
import { ScenarioValidator } from '../src/validation/scenario-validator';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

describe('Каркас модулей API (skeleton)', () => {
  let db: IsolatedTestDb;
  let moduleRef: TestingModule;
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING,
    VK_POLLING: process.env.VK_POLLING,
    VAULT_KEY: process.env.VAULT_KEY,
    VAULT_HASH_KEY: process.env.VAULT_HASH_KEY,
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  }, 120000);

  afterAll(async () => {
    await moduleRef?.close();
    await db?.destroy();
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('AppModule компилируется со всеми модулями и разрешает зависимости каркаса', () => {
    expect(moduleRef.get(ScenarioValidator)).toBeInstanceOf(ScenarioValidator);
    expect(moduleRef.get(PublicationController)).toBeInstanceOf(PublicationController);
    expect(moduleRef.get(ImportExportController)).toBeInstanceOf(ImportExportController);
    expect(moduleRef.get(ImportExportService)).toBeInstanceOf(ImportExportService);
    expect(moduleRef.get(PreviewGateway)).toBeInstanceOf(PreviewGateway);
    expect(moduleRef.get(PreviewSubscriber)).toBeInstanceOf(PreviewSubscriber);
    expect(moduleRef.get(ProjectController)).toBeInstanceOf(ProjectController);
    expect(moduleRef.get(ScenarioEditor)).toBeInstanceOf(ScenarioEditor);
  });

  it('PublicationController.isTokenInUse работает и возвращает false для неизвестного хеша', async () => {
    const controller = moduleRef.get(PublicationController);

    await expect(controller.isTokenInUse('TELEGRAM', 'non-existent-hash')).resolves.toBe(false);
  });
});
