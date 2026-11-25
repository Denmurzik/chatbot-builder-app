import { describe, expect, it } from 'vitest';
import { ExpressionError, evaluate, parseExpression, toBoolean } from './expression';
import { ExpressionEvaluator } from './expression-evaluator';
import { MapScope } from './scope';

describe('expression', () => {
  describe('evaluate — вычисления', () => {
    it('вычисляет арифметику над строковой переменной: tries + 1 при tries="2" → 3', () => {
      const scope = new MapScope({ tries: '2' }, {});
      expect(evaluate('tries + 1', scope)).toBe(3);
      expect(evaluate('tries * 3 - 1', scope)).toBe(5);
      expect(evaluate('10 / tries', scope)).toBe(5);
      expect(evaluate('7 % 3', scope)).toBe(1);
      expect(evaluate('-tries', scope)).toBe(-2);
    });

    it('сравнивает строки-числа как числа: "10" < "9" → false', () => {
      const scope = new MapScope({ a: '10', b: '9' }, {});
      expect(evaluate('"10" < "9"', scope)).toBe(false);
      expect(evaluate('a < b', scope)).toBe(false);
      expect(evaluate('a > b', scope)).toBe(true);
      expect(evaluate('a >= 10', scope)).toBe(true);
      expect(evaluate('b <= 9', scope)).toBe(true);
    });

    it('сравнивает нечисловые строки лексикографически: status == "booked"', () => {
      const scope = new MapScope({ status: 'booked' }, {});
      expect(evaluate('status == "booked"', scope)).toBe(true);
      expect(evaluate('status != "cancelled"', scope)).toBe(true);
    });

    it('поддерживает логические операции !a && (b || c) с коротким замыканием', () => {
      const scope = new MapScope({ a: 'false', b: 'false', c: 'true' }, {});
      expect(evaluate('!a && (b || c)', scope)).toBe(true);

      // Короткое замыкание: правая часть с неизвестной переменной не вычисляется
      expect(evaluate('false && unknownVar', scope)).toBe(false);
      expect(evaluate('true || unknownVar', scope)).toBe(true);
    });

    it('подставляет переменные окружения {{env.LIMIT}} > 5', () => {
      const scope = new MapScope({}, { LIMIT: '10' });
      expect(evaluate('{{env.LIMIT}} > 5', scope)).toBe(true);
      expect(evaluate('{{ env.LIMIT }} == 10', scope)).toBe(true);
    });

    it('бросает ExpressionError при обращении к неизвестной переменной', () => {
      const scope = new MapScope({}, {});
      expect(() => evaluate('missingVar + 1', scope)).toThrow(ExpressionError);
      expect(() => evaluate('{{env.MISSING}} > 0', scope)).toThrow(ExpressionError);
    });

    it('не позволяет значению переменной окружения изменить структуру выражения', () => {
      const scope = new MapScope({}, { X: '1 + 2' });
      // Значение env.X — строка "1 + 2", а не код выражения
      expect(evaluate('{{env.X}} == "1 + 2"', scope)).toBe(true);
    });
  });

  describe('безопасность и ограничения (Review Focus 1)', () => {
    const scope = new MapScope({ a: '1', b: '2' }, {});

    it.each([
      'constructor.constructor("x")()',
      'a.b',
      'f(1)',
      'a = 1',
      'this',
      'a[0]',
      'a ? 1 : 2',
      '[1, 2]',
    ])('отклоняет опасное выражение "%s" с ExpressionError("недопустимое выражение")', (expr) => {
      expect(() => parseExpression(expr)).toThrow(ExpressionError);
      expect(() => parseExpression(expr)).toThrow('недопустимое выражение');
      expect(() => evaluate(expr, scope)).toThrow(ExpressionError);
      expect(() => evaluate(expr, scope)).toThrow('недопустимое выражение');
    });

    it('отклоняет выражение длиннее 500 символов', () => {
      const longExpr = '1 + '.repeat(130) + '1';
      expect(longExpr.length).toBeGreaterThan(500);
      expect(() => parseExpression(longExpr)).toThrow(ExpressionError);
      expect(() => evaluate(longExpr, scope)).toThrow(ExpressionError);
    });

    it('отклоняет выражение с глубиной дерева больше 32', () => {
      // Цепочка из 35 унарных отрицаний создаёт глубину > 32
      const deepExpr = '!'.repeat(35) + 'true';
      expect(deepExpr.length).toBeLessThanOrEqual(500);
      expect(() => parseExpression(deepExpr)).toThrow(ExpressionError);
      expect(() => evaluate(deepExpr, scope)).toThrow(ExpressionError);
    });

    it('принимает корректное выражение в parseExpression', () => {
      expect(() => parseExpression('tries + 1 < {{env.LIMIT}} && !done')).not.toThrow();
    });
  });

  describe('toBoolean', () => {
    it('возвращает false для false, 0, "", "false"', () => {
      expect(toBoolean(false)).toBe(false);
      expect(toBoolean(0)).toBe(false);
      expect(toBoolean('')).toBe(false);
      expect(toBoolean('false')).toBe(false);
    });

    it('возвращает true для остальных значений', () => {
      expect(toBoolean(true)).toBe(true);
      expect(toBoolean(1)).toBe(true);
      expect(toBoolean(-1)).toBe(true);
      expect(toBoolean('true')).toBe(true);
      expect(toBoolean('hello')).toBe(true);
      expect(toBoolean('0')).toBe(true);
    });
  });

  describe('ExpressionEvaluator', () => {
    it('делегирует evaluate, extractVariableNames и substitute', () => {
      const evaluator = new ExpressionEvaluator();
      const scope = new MapScope({ tries: '2' }, {});

      expect(evaluator.evaluate('tries + 1', scope)).toBe(3);
      expect(evaluator.extractVariableNames('Привет, {{name}}!')).toEqual(['name']);
      expect(evaluator.substitute('q={{q}}', { q: 'a&b' }, 'URL')).toBe('q=a%26b');
    });

    it('evaluateCondition приводит результат выражения к boolean', () => {
      const evaluator = new ExpressionEvaluator();
      const scope = new MapScope({ tries: '2', empty: '' }, {});

      expect(evaluator.evaluateCondition('tries > 1', scope)).toBe(true);
      expect(evaluator.evaluateCondition('empty', scope)).toBe(false);
    });

    it('evaluateExpression возвращает строковое представление результата', () => {
      const evaluator = new ExpressionEvaluator();
      const scope = new MapScope({ tries: '2' }, {});

      expect(evaluator.evaluateExpression('tries + 1', scope)).toBe('3');
      expect(evaluator.evaluateExpression('tries > 1', scope)).toBe('true');
    });
  });
});
