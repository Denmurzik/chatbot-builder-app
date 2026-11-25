import { describe, expect, it } from 'vitest';
import { buildCompletions } from './completions';
import { operatorDoc, variableInfoText } from './docs';

describe('docs', () => {
  it('у каждого оператора и литерала есть сигнатура, описание и пример', () => {
    for (const label of ['==', '!=', '<', '<=', '>', '>=', '&&', '||', '!', 'true', 'false']) {
      const doc = operatorDoc(label);
      expect(doc, label).toBeDefined();
      expect(doc!.description).toMatch(/[А-Яа-яЁё]/);
      expect(doc!.example.length).toBeGreaterThan(0);
    }
  });

  it('подсказка оператора «<» имеет info с примером «tries < 3»', () => {
    const item = buildCompletions([], []).find((c) => c.label === '<')!;
    expect(typeof item.info).toBe('function');
    const node = (item.info as () => Node)();
    expect(node.textContent).toContain('tries < 3');
  });

  it('подсказка переменной: из блока и тестовое значение', () => {
    const item = buildCompletions(['name'], [], {
      testValues: { name: 'Аня' },
      sources: { name: 'Вопрос' },
    }).find((c) => c.label === 'name')!;
    const text = (item.info as () => Node)().textContent;
    expect(text).toContain('из блока «Вопрос»');
    expect(text).toContain('тестовое значение: Аня');
  });

  it('variableInfoText без тестового значения', () => {
    expect(variableInfoText(undefined, undefined)).toMatch(/нет тестового значения/);
  });
});
