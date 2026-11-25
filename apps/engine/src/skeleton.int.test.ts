import 'reflect-metadata';
import type { ChatEvent } from '@chatbot/model';
import { SecretVault } from '@chatbot/vault';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { DialogService } from './dialog/dialog.service';
import { MessengerGateway, PreviewNotifier } from './dialog/ports';
import { EventDispatcher } from './dispatcher/event-dispatcher';
import { ExternalApiClient } from './http/external-api-client';
import { HttpRequestExecutor } from './http/http-request-executor';
import { ResponseParser } from './http/response-parser';
import { PreviewPublisher } from './preview/preview-publisher';

describe('Каркас модулей Engine (skeleton)', () => {
  let moduleRef: TestingModule;
  const prevPolling = process.env.TELEGRAM_POLLING;
  const prevVaultKey = process.env.VAULT_KEY;
  const prevVaultHashKey = process.env.VAULT_HASH_KEY;

  beforeAll(async () => {
    process.env.TELEGRAM_POLLING = '0';
    process.env.VAULT_KEY ??= Buffer.alloc(32, 1).toString('base64');
    process.env.VAULT_HASH_KEY ??= Buffer.alloc(32, 2).toString('base64');

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    process.env.TELEGRAM_POLLING = prevPolling;
    process.env.VAULT_KEY = prevVaultKey;
    process.env.VAULT_HASH_KEY = prevVaultHashKey;
  });

  it('AppModule компилируется со всеми модулями и разрешает зависимости каркаса', () => {
    expect(moduleRef.get(DialogService)).toBeInstanceOf(DialogService);
    expect(moduleRef.get(HttpRequestExecutor)).toBeInstanceOf(HttpRequestExecutor);
    expect(moduleRef.get(ResponseParser)).toBeInstanceOf(ResponseParser);
    expect(moduleRef.get(PreviewPublisher)).toBeInstanceOf(PreviewPublisher);
    expect(moduleRef.get(PreviewNotifier)).toBe(moduleRef.get(PreviewPublisher));
    expect(moduleRef.get(EventDispatcher)).toBeInstanceOf(EventDispatcher);
    expect(moduleRef.get(ExternalApiClient)).toBeInstanceOf(ExternalApiClient);
    expect(moduleRef.get(MessengerGateway)).toBeInstanceOf(MessengerGateway);
    expect(moduleRef.get(SecretVault)).toBeInstanceOf(SecretVault);
  });

  it('ResponseParser.parse и ResponseParser.extract работают через @chatbot/engine-core', () => {
    const parser = moduleRef.get(ResponseParser);
    const json = parser.parse('{"data":{"slots":[{"time":"10:00"}]}}');

    expect(parser.extract(json, '$.data.slots[0].time')).toEqual({
      found: true,
      value: '10:00',
    });
    expect(parser.extract(json, '$.data.missing')).toEqual({ found: false });
  });

  it('EventDispatcher.isStale делегирует isStaleResponse, а SecretVault.mask маскирует секрет', () => {
    const dispatcher = moduleRef.get(EventDispatcher);
    const vault = moduleRef.get(SecretVault);
    const event: ChatEvent = {
      type: 'RESPONSE_RECEIVED',
      channel: 'MESSENGER',
      botId: 'bot-1',
      chatId: 'tg:1',
      userId: 'u1',
      requestId: 'req-1',
    };

    expect(dispatcher.isStale(event, null)).toBe(true);
    expect(vault.mask('super-secret-token')).toBe('••••oken');
  });
});
