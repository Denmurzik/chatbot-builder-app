import { describe, expect, it } from 'vitest';
import { describeError, maskSecrets } from './dialog.service';

describe('maskSecrets', () => {
  it('заменяет секрет во всех режимах', () => {
    const masks = [{ value: 'abc def', mask: '***' }];
    expect(maskSecrets('http://x/?k=abc%20def', masks, 'URL')).toBe('http://x/?k=***');
    expect(maskSecrets('Bearer abc def', masks, 'HEADER')).toBe('Bearer ***');
    expect(maskSecrets('{"k":"abc def"}', masks, 'JSON')).toBe('{"k":"***"}');
  });

  it('секрет с одиночным суррогатом не бросает исключение', () => {
    const masks = [{ value: 'ab\ud800cd', mask: '***' }];
    expect(() => maskSecrets('http://x/?k=ab%EF%BF%BDcd', masks, 'URL')).not.toThrow();
    expect(maskSecrets('http://x/?k=ab%EF%BF%BDcd', masks, 'URL')).toBe('http://x/?k=***');
  });
});

describe('describeError', () => {
  it('берёт первую непустую строку сообщения', () => {
    expect(describeError(new Error('\n\nпервая\nвторая'))).toBe('первая');
  });
});
