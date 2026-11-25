import { describe, expect, it } from 'vitest';
import { extract, parseJsonPath, toText } from './json-path';

describe('json-path', () => {
  describe('parseJsonPath', () => {
    it('разбирает допустимые пути из п. 2.7', () => {
      expect(parseJsonPath('$')).toEqual([]);
      expect(parseJsonPath('$.slots')).toEqual(['slots']);
      expect(parseJsonPath('$.slots[0].time')).toEqual(['slots', 0, 'time']);
      expect(parseJsonPath("$['clinic-id']")).toEqual(['clinic-id']);
      expect(parseJsonPath('$.data.items[2].doctor.name')).toEqual([
        'data',
        'items',
        2,
        'doctor',
        'name',
      ]);
    });

    it.each([
      '$.slots[*]',
      '$.*',
      '$..time',
      '$.slots[?(@.free)]',
      '$.slots[0:2]',
      'slots.time',
      '',
      '$.slots[-1]',
      '$.slots[]',
      '$.',
    ])('бросает ошибку на неподдерживаемый или некорректный синтаксис "%s"', (badPath) => {
      expect(() => parseJsonPath(badPath)).toThrow(Error);
    });
  });

  describe('extract', () => {
    const sample = {
      'clinic-id': 'cl-42',
      slots: [
        { time: '10:00', free: true },
        { time: '11:00', free: false },
      ],
      data: {
        items: [{}, {}, { doctor: { name: 'Иванов И.И.' } }],
      },
      empty: null,
    };

    it('находит значения для всех примеров из п. 2.7', () => {
      expect(extract(sample, '$.slots')).toEqual({ found: true, value: sample.slots });
      expect(extract(sample, '$.slots[0].time')).toEqual({ found: true, value: '10:00' });
      expect(extract(sample, "$['clinic-id']")).toEqual({ found: true, value: 'cl-42' });
      expect(extract(sample, '$.data.items[2].doctor.name')).toEqual({
        found: true,
        value: 'Иванов И.И.',
      });
      expect(extract(sample, '$.empty')).toEqual({ found: true, value: null });
    });

    it('возвращает found: false при применении индекса к объекту', () => {
      expect(extract(sample, '$.data[0]')).toEqual({ found: false });
    });

    it('возвращает found: false при выходе индекса за границы или отсутствии поля', () => {
      expect(extract(sample, '$.slots[5].time')).toEqual({ found: false });
      expect(extract(sample, '$.missing.field')).toEqual({ found: false });
      expect(extract(sample, '$.empty.nested')).toEqual({ found: false });
    });
  });

  describe('toText', () => {
    it('преобразует значения согласно п. 2.7', () => {
      expect(toText('строка')).toBe('строка');
      expect(toText(42)).toBe('42');
      expect(toText(true)).toBe('true');
      expect(toText(false)).toBe('false');
      expect(toText([1, 'a'])).toBe('[1,"a"]');
      expect(toText({ k: 'v' })).toBe('{"k":"v"}');
      expect(toText(null)).toBe('');
      expect(toText(undefined)).toBe('');
    });
  });
});
