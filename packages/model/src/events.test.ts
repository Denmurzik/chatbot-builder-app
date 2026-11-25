import { describe, expect, it } from 'vitest';
import { parsePreviewChatId } from './events';

describe('parsePreviewChatId', () => {
  it('разбирает корректный chatId превью', () => {
    expect(parsePreviewChatId('preview:proj-1:sess-1')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
  });

  it('возвращает null без префикса preview:', () => {
    expect(parsePreviewChatId('')).toBeNull();
    expect(parsePreviewChatId('tg:12345')).toBeNull();
    expect(parsePreviewChatId('proj:sess')).toBeNull();
  });

  it('возвращает null при пустом projectId или sessionId', () => {
    expect(parsePreviewChatId('preview::s')).toBeNull();
    expect(parsePreviewChatId('preview:p:')).toBeNull();
    expect(parsePreviewChatId('preview:onlyone')).toBeNull();
    expect(parsePreviewChatId('preview:')).toBeNull();
  });

  it('сохраняет двоеточия внутри sessionId (разделение по первому `:` после префикса)', () => {
    expect(parsePreviewChatId('preview:p:s:x')).toEqual({
      projectId: 'p',
      sessionId: 's:x',
    });
  });
});
