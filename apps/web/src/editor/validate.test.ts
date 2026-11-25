import { describe, expect, it } from 'vitest';
import { ru } from '@/i18n/ru';
import { BLOCK_META } from './block-meta';
import type { BlockNode, BlockNodeData } from './convert';
import { expressionIssue, nodeIssues, variableNameIssue } from './validate';

function node(data: BlockNodeData): BlockNode {
  return { id: 'n1', type: 'block', position: { x: 0, y: 0 }, data };
}

describe('variableNameIssue', () => {
  it('принимает латиницу, цифры и _, не начиная с цифры', () => {
    for (const name of ['name', '_x', 'a1', 'User_Name'])
      expect(variableNameIssue(name)).toBeNull();
  });

  it('отклоняет пустые, кириллицу, пробелы и ведущую цифру с подсказкой', () => {
    for (const name of ['', 'имя', 'a b', '1a', 'a-b', 'env.x']) {
      expect(variableNameIssue(name)).toBe(ru.validation.variableName);
    }
  });
});

describe('expressionIssue', () => {
  it('пропускает корректные выражения', () => {
    expect(expressionIssue('tries + 1')).toBeNull();
    expect(expressionIssue('(a < 3) && !b')).toBeNull();
  });

  it('пустое и некорректное выражение — ошибка', () => {
    expect(expressionIssue('  ')).toBe(ru.validation.expressionEmpty);
    expect(expressionIssue('a ==')).toMatch(/Ошибка в выражении/);
    expect(expressionIssue('foo()')).toMatch(/Ошибка в выражении/);
  });
});

describe('nodeIssues', () => {
  it('новый блок с корректными значениями по умолчанию ошибок не даёт', () => {
    for (const type of [
      'TEXT_INPUT',
      'OPTION_CHOICE',
      'LIST_CHOICE',
      'SWITCH',
      'HTTP_REQUEST',
    ] as const) {
      expect(nodeIssues(node(BLOCK_META[type].defaults()))).toEqual([]);
    }
  });

  it('имя переменной проверяется во всех блоках, пишущих переменные', () => {
    const input = { ...BLOCK_META.TEXT_INPUT.defaults(), variableName: 'имя' } as BlockNodeData;
    expect(nodeIssues(node(input))).toEqual([ru.validation.variableName]);
    const http = {
      ...BLOCK_META.HTTP_REQUEST.defaults(),
      errorVariable: 'ошибка',
      responseMappings: [{ jsonPath: '$.a', variableName: 'плохо' }],
    } as BlockNodeData;
    expect(nodeIssues(node(http))).toEqual([ru.validation.variableName]);
  });

  it('переменная со списком в «Выборе из списка» проверяется как имя', () => {
    const list = { ...BLOCK_META.LIST_CHOICE.defaults(), listVariable: 'список' } as BlockNodeData;
    expect(nodeIssues(node(list))).toEqual([ru.validation.variableName]);
  });

  it('выражения Условия и Присваивания проходят parseExpression', () => {
    const cond = { ...BLOCK_META.CONDITION.defaults(), expression: 'a ==' } as BlockNodeData;
    expect(nodeIssues(node(cond))[0]).toMatch(/Ошибка в выражении/);
    const assign = {
      ...BLOCK_META.ASSIGNMENT.defaults(),
      variableName: 'x',
      expression: 'tries + 1',
    } as BlockNodeData;
    expect(nodeIssues(node(assign))).toEqual([]);
    const badAssign = { ...assign, expression: 'x +' } as BlockNodeData;
    expect(nodeIssues(node(badAssign))).toHaveLength(1);
  });
});
