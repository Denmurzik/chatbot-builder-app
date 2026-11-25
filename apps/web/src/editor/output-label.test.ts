import { describe, expect, it } from 'vitest';
import { ru } from '@/i18n/ru';
import { outputLabel } from './output-label';

describe('outputLabel', () => {
  it('переводит служебные выходы своих типов', () => {
    expect(outputLabel('CONDITION', 'yes')).toBe(ru.outputs.yes);
    expect(outputLabel('TEXT_MESSAGE', 'default')).toBe(ru.outputs.default);
    expect(outputLabel('HTTP_REQUEST', 'error')).toBe(ru.outputs.error);
  });

  it('значения варианта и переключателя показывает как есть', () => {
    expect(outputLabel('OPTION_CHOICE', 'yes')).toBe('yes');
    expect(outputLabel('SWITCH', 'default')).toBe('default');
    expect(outputLabel('SWITCH', 'error')).toBe('error');
  });

  it('имена из прототипа не дают функцию', () => {
    expect(outputLabel('SWITCH', 'constructor')).toBe('constructor');
    expect(outputLabel('CONDITION', 'toString')).toBe('toString');
  });
});
