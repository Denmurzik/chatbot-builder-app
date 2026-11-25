import { SecretVault } from '@chatbot/vault';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { envVarInputListSchema } from '@chatbot/model';
import { EnvironmentService } from './environment.service';

function makeService(): { service: EnvironmentService; vault: SecretVault } {
  const vault = new SecretVault(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  return { service: new EnvironmentService(vault), vault };
}

describe('EnvironmentService.merge', () => {
  it('новый секрет шифруется, маска не раскрывает значение', () => {
    const { service } = makeService();
    const [v] = service.merge('bot-1', [], [{ name: 'API_KEY', secret: true, value: 'super-secret-123' }]);
    expect(v.secret).toBe(true);
    expect(v.value).toBeUndefined();
    expect(v.secretValue?.cipherText).toBeTruthy();
    expect(v.secretValue?.cipherText).not.toContain('super-secret');
    expect(JSON.stringify(service.toView([v]))).not.toContain('super-secret-123');
  });

  it('секрет без значения сохраняет прежний шифротекст', () => {
    const { service } = makeService();
    const first = service.merge('bot-1', [], [{ name: 'API_KEY', secret: true, value: 'abcdef123456' }]);
    const second = service.merge('bot-1', first, [{ name: 'API_KEY', secret: true }]);
    expect(second[0].secretValue).toEqual(first[0].secretValue);
  });

  it('секрет с новым значением перешифровывается', () => {
    const { service } = makeService();
    const first = service.merge('bot-1', [], [{ name: 'API_KEY', secret: true, value: 'abcdef123456' }]);
    const second = service.merge('bot-1', first, [{ name: 'API_KEY', secret: true, value: 'zzzzzz654321' }]);
    expect(second[0].secretValue?.cipherText).not.toBe(first[0].secretValue?.cipherText);
  });

  it('переименование секрета без значения даёт 400', () => {
    const { service } = makeService();
    const first = service.merge('bot-1', [], [{ name: 'API_KEY', secret: true, value: 'abcdef123456' }]);
    expect(() => service.merge('bot-1', first, [{ name: 'NEW_KEY', secret: true }])).toThrowError(
      BadRequestException,
    );
    expect(() => service.merge('bot-1', first, [{ name: 'NEW_KEY', secret: true }])).toThrowError(
      'Введите значение секретной переменной NEW_KEY',
    );
  });

  it('обычная переменная отдаётся со значением, секретная только с маской', () => {
    const { service } = makeService();
    const merged = service.merge(
      'bot-1',
      [],
      [
        { name: 'BASE_URL', secret: false, value: 'https://example.com' },
        { name: 'TOKEN', secret: true, value: 'abcdef123456' },
      ],
    );
    const view = service.toView(merged);
    expect(view[0]).toEqual({ name: 'BASE_URL', secret: false, value: 'https://example.com' });
    expect(view[1]).toMatchObject({ name: 'TOKEN', secret: true });
    expect(view[1]).not.toHaveProperty('value');
  });
});

describe('envVarInputListSchema', () => {
  it('отклоняет плохое имя', () => {
    expect(envVarInputListSchema.safeParse([{ name: 'bad-name', secret: false, value: '1' }]).success).toBe(false);
    expect(envVarInputListSchema.safeParse([{ name: '1ABC', secret: false, value: '1' }]).success).toBe(false);
  });

  it('отклоняет повторяющиеся имена', () => {
    const r = envVarInputListSchema.safeParse([
      { name: 'A', secret: false, value: '1' },
      { name: 'A', secret: false, value: '2' },
    ]);
    expect(r.success).toBe(false);
  });

  it('принимает корректный список', () => {
    expect(envVarInputListSchema.safeParse([{ name: '_A1', secret: true }]).success).toBe(true);
  });
});
