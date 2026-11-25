import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { emptyScenario, parseScenario } from './scenario';
import { eventTypeSchema } from './events';
import { NotImplementedError } from './errors';

// Пример сценария из п. 3.3 спецификации, дополненный блоками до валидного графа
function createSpecExampleScenario() {
  return {
    formatVersion: 1,
    blocks: [
      { id: 'b1', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
      {
        id: 'b2',
        type: 'TEXT_INPUT',
        title: 'ФИО',
        x: 240,
        y: 0,
        question: 'Как вас зовут?',
        variableName: 'fio',
      },
      {
        id: 'b3',
        type: 'HTTP_REQUEST',
        title: 'Слоты',
        x: 480,
        y: 0,
        method: 'GET',
        url: '{{env.API_URL}}/slots?clinic={{clinic}}',
        headers: [{ name: 'Authorization', value: 'Bearer {{env.API_KEY}}', secret: false }],
        body: '',
        variableName: 'slotsResponse',
        errorVariable: 'slotsError',
        timeoutSec: 10,
        retryCount: 2,
        retryIntervalSec: 5,
        errorStrategy: 'EXIT_ERROR',
        suspendText: null,
        responseMappings: [{ jsonPath: '$.items', variableName: 'slots' }],
      },
      {
        id: 'b4',
        type: 'TEXT_MESSAGE',
        title: 'Успех',
        x: 720,
        y: -80,
        text: 'Слоты загружены',
      },
      {
        id: 'b5',
        type: 'TEXT_MESSAGE',
        title: 'Ошибка',
        x: 720,
        y: 80,
        text: 'Сервис недоступен',
      },
      { id: 'b6', type: 'EXIT_POINT', title: 'Конец', x: 960, y: 0 },
    ],
    transitions: [
      { source: { blockId: 'b1', output: 'default' }, target: 'b2' },
      { source: { blockId: 'b2', output: 'default' }, target: 'b3' },
      { source: { blockId: 'b3', output: 'success' }, target: 'b4' },
      { source: { blockId: 'b3', output: 'error' }, target: 'b5' },
      { source: { blockId: 'b4', output: 'default' }, target: 'b6' },
      { source: { blockId: 'b5', output: 'default' }, target: 'b6' },
    ],
  };
}

function expectZodError(input: unknown): ZodError {
  try {
    parseScenario(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return error as ZodError;
  }
  throw new Error('Ожидалась ошибка валидации ZodError, но parseScenario завершился успешно');
}

describe('parseScenario', () => {
  it('принимает пример п. 3.3, дополненный до валидного графа', () => {
    const raw = createSpecExampleScenario();
    const parsed = parseScenario(raw);
    expect(parsed).toEqual(raw);
  });

  it('emptyScenario возвращает валидный сценарий с одной точкой входа', () => {
    const scenario = emptyScenario();
    expect(scenario).toEqual({
      formatVersion: 1,
      blocks: [{ id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
      transitions: [],
    });
    expect(parseScenario(scenario)).toEqual(scenario);
  });

  it('отклоняет дубль id блока', () => {
    const raw = {
      formatVersion: 1,
      blocks: [
        { id: 'b1', type: 'ENTRY_POINT', title: 'Старт 1', x: 0, y: 0 },
        { id: 'b1', type: 'EXIT_POINT', title: 'Конец', x: 100, y: 0 },
      ],
      transitions: [],
    };
    const err = expectZodError(raw);
    expect(err.issues.some((i) => i.path.join('.') === 'blocks.1.id')).toBe(true);
  });

  it('отклоняет переход на несуществующий блок', () => {
    const raw = {
      formatVersion: 1,
      blocks: [{ id: 'b1', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
      transitions: [{ source: { blockId: 'b1', output: 'default' }, target: 'missing' }],
    };
    const err = expectZodError(raw);
    expect(err.issues.some((i) => i.path.join('.') === 'transitions.0.target')).toBe(true);
  });

  it('отклоняет переход из выхода, которого нет у блока', () => {
    const raw = {
      formatVersion: 1,
      blocks: [
        { id: 'b1', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'b2', type: 'EXIT_POINT', title: 'Конец', x: 100, y: 0 },
      ],
      transitions: [{ source: { blockId: 'b1', output: 'yes' }, target: 'b2' }],
    };
    const err = expectZodError(raw);
    expect(err.issues.some((i) => i.path.join('.') === 'transitions.0.source.output')).toBe(true);
  });

  it('отклоняет два перехода из одного выхода', () => {
    const raw = {
      formatVersion: 1,
      blocks: [
        { id: 'b1', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'b2', type: 'EXIT_POINT', title: 'Конец 1', x: 100, y: 0 },
        { id: 'b3', type: 'EXIT_POINT', title: 'Конец 2', x: 100, y: 100 },
      ],
      transitions: [
        { source: { blockId: 'b1', output: 'default' }, target: 'b2' },
        { source: { blockId: 'b1', output: 'default' }, target: 'b3' },
      ],
    };
    const err = expectZodError(raw);
    expect(err.issues.some((i) => i.path.join('.') === 'transitions.1.source')).toBe(true);
  });

  it('отклоняет formatVersion: 2', () => {
    const raw = { ...createSpecExampleScenario(), formatVersion: 2 };
    const err = expectZodError(raw);
    expect(err.issues.some((i) => i.path.join('.') === 'formatVersion')).toBe(true);
  });

  it('отклоняет неизвестный type блока', () => {
    const raw = {
      formatVersion: 1,
      blocks: [{ id: 'b1', type: 'UNKNOWN_BLOCK', title: 'Неизвестный', x: 0, y: 0 }],
      transitions: [],
    };
    expectZodError(raw);
  });

  it('отклоняет повтор варианта в OPTION_CHOICE', () => {
    const raw = {
      formatVersion: 1,
      blocks: [
        {
          id: 'b1',
          type: 'OPTION_CHOICE',
          title: 'Выбор',
          x: 0,
          y: 0,
          question: 'Выберите',
          options: ['Да', 'Да'],
          variableName: 'ans',
        },
      ],
      transitions: [],
    };
    expectZodError(raw);
  });

  it('отклоняет пустой вариант в OPTION_CHOICE', () => {
    const rawEmptyItem = {
      formatVersion: 1,
      blocks: [
        {
          id: 'b1',
          type: 'OPTION_CHOICE',
          title: 'Выбор',
          x: 0,
          y: 0,
          question: 'Выберите',
          options: ['Да', ''],
          variableName: 'ans',
        },
      ],
      transitions: [],
    };
    expectZodError(rawEmptyItem);

    const rawEmptyList = {
      formatVersion: 1,
      blocks: [
        {
          id: 'b1',
          type: 'OPTION_CHOICE',
          title: 'Выбор',
          x: 0,
          y: 0,
          question: 'Выберите',
          options: [],
          variableName: 'ans',
        },
      ],
      transitions: [],
    };
    expectZodError(rawEmptyList);
  });

  it('отклоняет значение "else" у SWITCH', () => {
    const raw = {
      formatVersion: 1,
      blocks: [
        {
          id: 'b1',
          type: 'SWITCH',
          title: 'Переключатель',
          x: 0,
          y: 0,
          variableName: 'status',
          values: ['ok', 'else'],
        },
      ],
      transitions: [],
    };
    expectZodError(raw);
  });

  it('отклоняет id блока с пробелом', () => {
    const raw = {
      formatVersion: 1,
      blocks: [{ id: 'block 1', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
      transitions: [],
    };
    expectZodError(raw);
  });

  it('отклоняет нецелые координаты x и y', () => {
    const raw = {
      formatVersion: 1,
      blocks: [{ id: 'b1', type: 'ENTRY_POINT', title: 'Старт', x: 10.5, y: 0 }],
      transitions: [],
    };
    expectZodError(raw);
  });
});

describe('события и ошибки', () => {
  it('EventType поддерживает VERSION_PUBLISHED', () => {
    expect(eventTypeSchema.parse('VERSION_PUBLISHED')).toBe('VERSION_PUBLISHED');
  });

  it('NotImplementedError наследует Error и сохраняет имя', () => {
    const err = new NotImplementedError('ScenarioValidator.validate');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(err.name).toBe('NotImplementedError');
    expect(err.message).toContain('ScenarioValidator.validate');
  });
});
