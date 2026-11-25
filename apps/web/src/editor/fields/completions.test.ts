import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  buildCompletions,
  buildTemplateCompletions,
  createExpressionCompletionSource,
  createTemplateCompletionSource,
} from './completions';

describe('buildCompletions', () => {
  it('возвращает переменные диалога, env.* и операторы с русскими подписями', () => {
    const items = buildCompletions(['tries', 'status'], ['API_URL', 'BOT_TOKEN']);
    const byLabel = new Map(items.map((item) => [item.label, item]));

    // Переменные диалога
    expect(byLabel.get('tries')).toMatchObject({ label: 'tries', type: 'variable' });
    expect(byLabel.get('status')).toMatchObject({ label: 'status', type: 'variable' });

    // Переменные окружения в формате {{env.ИМЯ}}
    expect(byLabel.get('{{env.API_URL}}')).toMatchObject({
      label: '{{env.API_URL}}',
      detail: expect.any(String),
    });
    expect(byLabel.get('{{env.BOT_TOKEN}}')).toMatchObject({
      label: '{{env.BOT_TOKEN}}',
      detail: expect.any(String),
    });

    // Операторы сравнения, логические и булевы литералы с русскими пояснениями
    const expectedOps = ['==', '!=', '<', '<=', '>', '>=', '&&', '||', '!', 'true', 'false'];
    for (const op of expectedOps) {
      const entry = byLabel.get(op);
      expect(entry, `отсутствует оператор/литерал ${op}`).toBeDefined();
      expect(entry?.detail).toBeTruthy();
      expect(entry?.detail).toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('работает при пустом envNames и убирает дубликаты переменных', () => {
    const items = buildCompletions(['tries', 'tries', ''], []);
    const varLabels = items.filter((item) => item.type === 'variable').map((item) => item.label);
    expect(varLabels).toEqual(['tries']);
    expect(items.some((item) => item.label.startsWith('{{env.'))).toBe(false);
  });
});

describe('buildTemplateCompletions', () => {
  it('возвращает переменные и env.* для подстановки в шаблон', () => {
    const items = buildTemplateCompletions(['name', 'city'], ['SUPPORT_EMAIL']);
    expect(items.map((item) => item.label)).toEqual(['name', 'city', 'env.SUPPORT_EMAIL']);
  });

  it('не добавляет подсказки env.*, когда envNames пуст', () => {
    const items = buildTemplateCompletions(['name'], []);
    expect(items.map((item) => item.label)).toEqual(['name']);
  });
});

describe('createExpressionCompletionSource', () => {
  it('предлагает подсказки при вводе начала идентификатора', () => {
    const source = createExpressionCompletionSource(['tries', 'total'], ['LIMIT']);
    const state = EditorState.create({ doc: 'tr' });
    const ctx = new CompletionContext(state, 2, false);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.options.some((opt) => opt.label === 'tries')).toBe(true);
  });
});

describe('createTemplateCompletionSource', () => {
  it('активируется после {{ и вставляет {{имя}}', () => {
    const source = createTemplateCompletionSource(['userName'], ['HOST']);
    const state = EditorState.create({ doc: 'Привет, {{' });
    const ctx = new CompletionContext(state, 'Привет, {{'.length, false);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result?.from).toBe('Привет, {{'.length);
    const userOpt = result?.options.find((opt) => opt.label === 'userName');
    expect(userOpt).toBeDefined();
    expect(userOpt?.apply).toBe('userName}}');
  });

  it('не дублирует закрывающие }}, если они уже стоят после курсора', () => {
    const source = createTemplateCompletionSource(['userName'], []);
    const state = EditorState.create({ doc: 'Привет, {{}}' });
    const ctx = new CompletionContext(state, 'Привет, {{'.length, false);
    const result = source(ctx);
    const userOpt = result?.options.find((opt) => opt.label === 'userName');
    expect(userOpt?.apply).toBe('userName');
  });

  it('не активируется вне конструкции {{', () => {
    const source = createTemplateCompletionSource(['userName'], []);
    const state = EditorState.create({ doc: 'Привет, мир' });
    const ctx = new CompletionContext(state, 6, false);
    expect(source(ctx)).toBeNull();
  });
});
