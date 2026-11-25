import { describe, expect, it } from 'vitest';
import { scenarioSchema, type Scenario } from '@chatbot/model';
import {
  connectEdges,
  flowToScenario,
  pruneEdges,
  safeOutputs,
  scenarioToFlow,
  type BlockNode,
} from './convert';

const scenario: Scenario = {
  formatVersion: 1,
  blocks: [
    { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
    { id: 'msg', type: 'TEXT_MESSAGE', title: 'Привет', x: 100, y: 20, text: 'Здравствуйте' },
    {
      id: 'name',
      type: 'TEXT_INPUT',
      title: 'Имя',
      x: 200,
      y: 40,
      question: 'Имя?',
      variableName: 'name',
    },
    {
      id: 'opt',
      type: 'OPTION_CHOICE',
      title: 'Выбор',
      x: 300,
      y: 60,
      question: 'Что дальше?',
      options: ['Запись', 'Отмена'],
      variableName: 'choice',
    },
    {
      id: 'lst',
      type: 'LIST_CHOICE',
      title: 'Врач',
      x: 400,
      y: 80,
      question: 'Врач?',
      listVariable: 'doctors',
      labelField: 'name',
      valueField: 'id',
      variableName: 'doctor',
    },
    {
      id: 'asg',
      type: 'ASSIGNMENT',
      title: 'Счёт',
      x: 500,
      y: 100,
      variableName: 'n',
      expression: 'n + 1',
    },
    { id: 'cnd', type: 'CONDITION', title: 'Проверка', x: 600, y: 120, expression: 'n > 1' },
    {
      id: 'sw',
      type: 'SWITCH',
      title: 'Ветка',
      x: 700,
      y: 140,
      variableName: 'choice',
      values: ['a', 'b'],
    },
    {
      id: 'http',
      type: 'HTTP_REQUEST',
      title: 'Запрос',
      x: 800,
      y: 160,
      method: 'POST',
      url: 'https://example.com',
      headers: [{ name: 'X-Key', value: 'v', secret: false }],
      body: '{}',
      variableName: 'resp',
      errorVariable: 'err',
      timeoutSec: 10,
      retryCount: 0,
      retryIntervalSec: 1,
      errorStrategy: 'SUSPEND',
      suspendText: 'Подождите',
      responseMappings: [{ jsonPath: '$.id', variableName: 'id' }],
    },
    { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 900, y: 180 },
  ],
  transitions: [
    { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
    { source: { blockId: 'opt', output: 'Запись' }, target: 'lst' },
    { source: { blockId: 'opt', output: 'Отмена' }, target: 'exit' },
    { source: { blockId: 'sw', output: 'else' }, target: 'http' },
    { source: { blockId: 'http', output: 'success' }, target: 'exit' },
  ],
};

describe('конвертация сценария и графа', () => {
  it('исходный сценарий валиден', () => {
    expect(scenarioSchema.safeParse(scenario).success).toBe(true);
  });

  it('flowToScenario(scenarioToFlow(s)) равен s для всех 10 типов блоков', () => {
    const { nodes, edges } = scenarioToFlow(scenario);
    expect(flowToScenario(nodes, edges)).toEqual(scenario);
  });

  it('ручка ребра = имя выхода, данные узла содержат только поля блока', () => {
    const { nodes, edges } = scenarioToFlow(scenario);
    expect(edges.find((e) => e.source === 'opt' && e.target === 'exit')?.sourceHandle).toBe(
      'Отмена',
    );
    expect(Object.keys(nodes[0]!.data).sort()).toEqual(['title', 'type']);
  });

  it('округляет x и y до целых', () => {
    const { nodes, edges } = scenarioToFlow(scenario);
    const moved = nodes.map((n) => (n.id === 'msg' ? { ...n, position: { x: 10.6, y: 3.4 } } : n));
    const block = flowToScenario(moved, edges).blocks.find((b) => b.id === 'msg')!;
    expect([block.x, block.y]).toEqual([11, 3]);
  });

  it('смена options убирает ребро исчезнувшего выхода', () => {
    const { nodes, edges } = scenarioToFlow(scenario);
    const changed: BlockNode[] = nodes.map((n) =>
      n.id === 'opt' && n.data.type === 'OPTION_CHOICE'
        ? { ...n, data: { ...n.data, options: ['Запись'] } }
        : n,
    );
    const pruned = pruneEdges(changed, edges);
    expect(pruned.some((e) => e.source === 'opt' && e.sourceHandle === 'Отмена')).toBe(false);
    expect(pruned.some((e) => e.source === 'opt' && e.sourceHandle === 'Запись')).toBe(true);
    expect(flowToScenario(changed, edges).transitions).toHaveLength(4);
  });

  it('новое соединение заменяет ребро из того же выхода', () => {
    const { edges } = scenarioToFlow(scenario);
    const next = connectEdges(edges, { source: 'opt', sourceHandle: 'Запись', target: 'exit' });
    const fromHandle = next.filter((e) => e.source === 'opt' && e.sourceHandle === 'Запись');
    expect(fromHandle).toHaveLength(1);
    expect(fromHandle[0]!.target).toBe('exit');
    expect(next).toHaveLength(edges.length);
  });

  it('safeOutputs убирает повторы и «else» из значений переключателя', () => {
    expect(
      safeOutputs({
        type: 'SWITCH',
        title: '',
        variableName: 'v',
        values: ['a', 'a', 'else', 'b'],
      }),
    ).toEqual(['a', 'b', 'else']);
    expect(
      safeOutputs({
        type: 'OPTION_CHOICE',
        title: '',
        question: '',
        variableName: 'v',
        options: ['x', 'x', 'y'],
      }),
    ).toEqual(['x', 'y']);
  });
});
