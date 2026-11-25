import { describe, expect, it } from 'vitest';
import { parseExpression } from '@chatbot/engine-core';
import {
  conditionToExpression,
  expressionToCondition,
  type ConditionModel,
} from './condition-model';

describe('conditionToExpression', () => {
  it('объединяет строки через И', () => {
    const model: ConditionModel = {
      join: 'and',
      rows: [
        { variable: 'age', op: 'gte', value: '18' },
        { variable: 'city', op: 'eq', value: 'Москва' },
      ],
    };
    expect(conditionToExpression(model)).toBe('age >= 18 && city == "Москва"');
  });

  it('объединяет строки через ИЛИ', () => {
    const model: ConditionModel = {
      join: 'or',
      rows: [
        { variable: 'a', op: 'lt', value: '3' },
        { variable: 'b', op: 'neq', value: 'x' },
      ],
    };
    expect(conditionToExpression(model)).toBe('a < 3 || b != "x"');
  });

  it('«пусто» и «не пусто» — сравнение с пустой строкой', () => {
    expect(
      conditionToExpression({
        join: 'and',
        rows: [
          { variable: 'x', op: 'empty', value: '' },
          { variable: 'y', op: 'notEmpty', value: '' },
        ],
      }),
    ).toBe('x == "" && y != ""');
  });

  it('экранирует кавычки и обратную косую в строках, числа оставляет как есть', () => {
    expect(
      conditionToExpression({
        join: 'and',
        rows: [
          { variable: 'q', op: 'eq', value: 'он сказал "да"\\' },
          { variable: 'n', op: 'gt', value: '-2.5' },
          { variable: 'z', op: 'eq', value: '007' },
        ],
      }),
    ).toBe('q == "он сказал \\"да\\"\\\\" && n > -2.5 && z == "007"');
  });

  it('пропускает строки без переменной', () => {
    expect(
      conditionToExpression({
        join: 'and',
        rows: [
          { variable: '', op: 'eq', value: '1' },
          { variable: 'a', op: 'eq', value: '1' },
        ],
      }),
    ).toBe('a == 1');
  });

  it('ссылка на env сохраняется', () => {
    expect(
      conditionToExpression({
        join: 'and',
        rows: [{ variable: '{{env.MODE}}', op: 'eq', value: 'prod' }],
      }),
    ).toBe('{{env.MODE}} == "prod"');
  });

  it('результат проходит parseExpression для всех операторов', () => {
    const ops = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'notEmpty'] as const;
    const expr = conditionToExpression({
      join: 'or',
      rows: ops.map((op) => ({ variable: 'v', op, value: 'a"b' })),
    });
    expect(() => parseExpression(expr)).not.toThrow();
  });
});

describe('expressionToCondition', () => {
  it('разбирает И, ИЛИ, числа и строки', () => {
    expect(expressionToCondition('age >= 18 && city == "Москва"')).toEqual({
      join: 'and',
      rows: [
        { variable: 'age', op: 'gte', value: '18' },
        { variable: 'city', op: 'eq', value: 'Москва' },
      ],
    });
    expect(expressionToCondition("a < 3 || b != 'x'")).toEqual({
      join: 'or',
      rows: [
        { variable: 'a', op: 'lt', value: '3' },
        { variable: 'b', op: 'neq', value: 'x' },
      ],
    });
  });

  it('сравнение с пустой строкой — «пусто» / «не пусто»', () => {
    expect(expressionToCondition('x == "" && y != ""')).toEqual({
      join: 'and',
      rows: [
        { variable: 'x', op: 'empty', value: '' },
        { variable: 'y', op: 'notEmpty', value: '' },
      ],
    });
  });

  it('круговое преобразование сохраняет модель, включая кавычки', () => {
    const model: ConditionModel = {
      join: 'or',
      rows: [
        { variable: 'q', op: 'eq', value: 'он сказал "да"\\' },
        { variable: 'n', op: 'lte', value: '-2.5' },
        { variable: 'z', op: 'eq', value: '007' },
        { variable: '{{env.MODE}}', op: 'neq', value: 'a && b' },
      ],
    };
    expect(expressionToCondition(conditionToExpression(model))).toEqual(model);
  });

  it('&& и || внутри строки не считаются объединением', () => {
    expect(expressionToCondition('a == "x && y"')).toEqual({
      join: 'and',
      rows: [{ variable: 'a', op: 'eq', value: 'x && y' }],
    });
  });

  it('выражения вне конструктора дают null', () => {
    expect(expressionToCondition('(a < 3) && !b')).toBeNull();
    expect(expressionToCondition('a == 1 && b == 2 || c == 3')).toBeNull();
    expect(expressionToCondition('a + 1 == 3')).toBeNull();
    expect(expressionToCondition('a == b')).toBeNull();
    expect(expressionToCondition('!a')).toBeNull();
    expect(expressionToCondition('a ==')).toBeNull();
  });

  it('экранирования \n \t \b \f \v разбираются и пишутся обратно без потерь', () => {
    const model: ConditionModel = {
      join: 'and',
      rows: [{ variable: 'a', op: 'eq', value: 'x\ny\tz\b\f\v' }],
    };
    expect(expressionToCondition(conditionToExpression(model))).toEqual(model);
  });

  it('неизвестное экранирование не переписывается молча: режим «Выражение»', () => {
    expect(expressionToCondition('a == "x\\qy"')).toBeNull();
  });

  it('число с ведущими нулями и экспонентой — режим «Выражение»', () => {
    expect(expressionToCondition('a == 007')).toBeNull();
    expect(expressionToCondition('a == 1e5')).toBeNull();
    expect(expressionToCondition('a == 0.5')).toEqual({
      join: 'and',
      rows: [{ variable: 'a', op: 'eq', value: '0.5' }],
    });
  });

  it('пустое выражение — пустая модель', () => {
    expect(expressionToCondition('  ')).toEqual({
      join: 'and',
      rows: [{ variable: '', op: 'eq', value: '' }],
    });
  });
});
