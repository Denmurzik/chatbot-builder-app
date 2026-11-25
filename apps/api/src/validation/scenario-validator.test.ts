import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Scenario } from '@chatbot/model';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.module';
import { ScenarioValidator } from './scenario-validator';

function createValidator(connectionCount = 0): ScenarioValidator {
  const prisma = {
    client: {
      messengerConnection: {
        count: vi.fn().mockResolvedValue(connectionCount),
      },
    },
  } as unknown as PrismaService;
  return new ScenarioValidator(prisma);
}

function loadJsonScenario(relPath: string): Scenario {
  const fullPath = path.resolve(__dirname, '../../../..', relPath);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as Scenario;
}

describe('ScenarioValidator', () => {
  it('валидные эталонные сценарии (Эхо, doctor-no-http, doctor-with-http) проходят без ошибок', () => {
    const validator = createValidator();

    expect(validator.validate(loadJsonScenario('apps/api/scripts/echo-scenario.json'))).toEqual([]);
    expect(
      validator.validate(loadJsonScenario('packages/engine-core/examples/doctor-no-http.json')),
    ).toEqual([]);
    expect(
      validator.validate(loadJsonScenario('packages/engine-core/examples/doctor-with-http.json')),
    ).toEqual([]);
  });

  it('single_entry_point: 0 или >1 точек входа дают ERROR', () => {
    const validator = createValidator();

    const noEntry: Scenario = {
      formatVersion: 1,
      blocks: [{ id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 0, y: 0 }],
      transitions: [],
    };
    expect(validator.validate(noEntry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'single_entry_point', severity: 'ERROR' }),
      ]),
    );

    const twoEntries: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'e1', type: 'ENTRY_POINT', title: 'Старт 1', x: 0, y: 0 },
        { id: 'e2', type: 'ENTRY_POINT', title: 'Старт 2', x: 0, y: 100 },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'e1', output: 'default' }, target: 'exit' },
        { source: { blockId: 'e2', output: 'default' }, target: 'exit' },
      ],
    };
    expect(validator.validate(twoEntries)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'single_entry_point',
          severity: 'ERROR',
          blockId: 'e2',
        }),
      ]),
    );
  });

  it('outputs_connected: неподключённые выходы (обычный, noOptions, error при EXIT_ERROR) дают ERROR', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'q1',
          type: 'TEXT_INPUT',
          title: 'Вопрос',
          x: 100,
          y: 0,
          question: 'Как дела?',
          variableName: 'ans',
        },
        {
          id: 'list1',
          type: 'LIST_CHOICE',
          title: 'Список',
          x: 200,
          y: 0,
          question: 'Выберите:',
          listVariable: 'items',
          labelField: 'name',
          valueField: 'id',
          variableName: 'choice',
        },
        {
          id: 'http_exit',
          type: 'HTTP_REQUEST',
          title: 'Запрос',
          x: 300,
          y: 0,
          method: 'GET',
          url: 'https://example.com',
          headers: [],
          body: '',
          variableName: 'res',
          errorVariable: 'err',
          timeoutSec: 5,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'EXIT_ERROR',
          suspendText: null,
          responseMappings: [],
        },
        {
          id: 'http_suspend',
          type: 'HTTP_REQUEST',
          title: 'Запрос с паузой',
          x: 400,
          y: 0,
          method: 'GET',
          url: 'https://example.com',
          headers: [],
          body: '',
          variableName: 'res2',
          errorVariable: 'err2',
          timeoutSec: 5,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'SUSPEND',
          suspendText: 'Подождите',
          responseMappings: [],
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: 500, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'q1' },
        { source: { blockId: 'list1', output: 'default' }, target: 'http_exit' },
        { source: { blockId: 'http_exit', output: 'success' }, target: 'http_suspend' },
        { source: { blockId: 'http_suspend', output: 'success' }, target: 'exit' },
      ],
    };

    const errors = validator.validate(scenario);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'outputs_connected',
          severity: 'ERROR',
          blockId: 'q1',
          message: 'Блок «Вопрос»: не подключён выход «Далее»',
        }),
        expect.objectContaining({
          rule: 'outputs_connected',
          severity: 'ERROR',
          blockId: 'list1',
        }),
        expect.objectContaining({
          rule: 'outputs_connected',
          severity: 'ERROR',
          blockId: 'http_exit',
        }),
      ]),
    );
    // У HTTP_REQUEST со стратегией SUSPEND выход error не обязателен
    expect(errors.some((e) => e.rule === 'outputs_connected' && e.blockId === 'http_suspend')).toBe(
      false,
    );
  });

  it('required_field: пустые обязательные поля дают ERROR с указанием блока', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg', type: 'TEXT_MESSAGE', title: 'Пустое', x: 100, y: 0, text: '   ' },
        {
          id: 'http',
          type: 'HTTP_REQUEST',
          title: 'API',
          x: 200,
          y: 0,
          method: 'GET',
          url: '',
          headers: [],
          body: '',
          variableName: 'resp',
          errorVariable: 'err',
          timeoutSec: 5,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'SUSPEND',
          suspendText: null,
          responseMappings: [],
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 300, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'http' },
        { source: { blockId: 'http', output: 'success' }, target: 'exit' },
      ],
    };

    const errors = validator.validate(scenario);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'required_field', severity: 'ERROR', blockId: 'msg' }),
        expect.objectContaining({ rule: 'required_field', severity: 'ERROR', blockId: 'http' }),
      ]),
    );
  });

  it('variable_name: некорректное имя переменной даёт ERROR', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'inp',
          type: 'TEXT_INPUT',
          title: 'Ввод',
          x: 100,
          y: 0,
          question: 'Имя?',
          variableName: '1bad-var',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'inp' },
        { source: { blockId: 'inp', output: 'default' }, target: 'exit' },
      ],
    };

    expect(validator.validate(scenario)).toEqual([
      expect.objectContaining({ rule: 'variable_name', severity: 'ERROR', blockId: 'inp' }),
    ]);
  });

  it('expression: синтаксически неверное или запрещённое выражение даёт ERROR', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'assign',
          type: 'ASSIGNMENT',
          title: 'Счётчик',
          x: 100,
          y: 0,
          variableName: 'x',
          expression: 'process.exit(1)',
        },
        {
          id: 'cond',
          type: 'CONDITION',
          title: 'Проверка',
          x: 200,
          y: 0,
          expression: 'x ==',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 300, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'assign' },
        { source: { blockId: 'assign', output: 'default' }, target: 'cond' },
        { source: { blockId: 'cond', output: 'yes' }, target: 'exit' },
        { source: { blockId: 'cond', output: 'no' }, target: 'exit' },
      ],
    };

    const errors = validator.validate(scenario).filter((e) => e.severity === 'ERROR');
    expect(errors).toEqual([
      expect.objectContaining({ rule: 'expression', severity: 'ERROR', blockId: 'assign' }),
      expect.objectContaining({ rule: 'expression', severity: 'ERROR', blockId: 'cond' }),
    ]);
  });

  it('template: сломанный шаблон в сообщении или HTTP-блоке даёт ERROR', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'msg', type: 'TEXT_MESSAGE', title: 'Текст', x: 100, y: 0, text: 'Привет, {{name' },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
      ],
    };

    expect(validator.validate(scenario)).toEqual([
      expect.objectContaining({ rule: 'template', severity: 'ERROR', blockId: 'msg' }),
    ]);
  });

  it('json_path: некорректный jsonPath в responseMappings даёт ERROR', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'http',
          type: 'HTTP_REQUEST',
          title: 'Запрос',
          x: 100,
          y: 0,
          method: 'GET',
          url: 'https://example.com',
          headers: [],
          body: '',
          variableName: 'resp',
          errorVariable: 'err',
          timeoutSec: 5,
          retryCount: 0,
          retryIntervalSec: 0,
          errorStrategy: 'SUSPEND',
          suspendText: null,
          responseMappings: [{ jsonPath: 'items[0]', variableName: 'first' }],
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'http' },
        { source: { blockId: 'http', output: 'success' }, target: 'exit' },
      ],
    };

    expect(validator.validate(scenario)).toEqual([
      expect.objectContaining({ rule: 'json_path', severity: 'ERROR', blockId: 'http' }),
    ]);
  });

  it('loop_without_wait: цикл Присваивание→Условие→Присваивание даёт WARNING, а цикл через Ввод — нет', () => {
    const validator = createValidator();

    const tightLoop: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'assign',
          type: 'ASSIGNMENT',
          title: 'Шаг',
          x: 100,
          y: 0,
          variableName: 'i',
          expression: 'i + 1',
        },
        {
          id: 'cond',
          type: 'CONDITION',
          title: 'Проверка',
          x: 200,
          y: 0,
          expression: 'i < 5',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 300, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'assign' },
        { source: { blockId: 'assign', output: 'default' }, target: 'cond' },
        { source: { blockId: 'cond', output: 'yes' }, target: 'assign' },
        { source: { blockId: 'cond', output: 'no' }, target: 'exit' },
      ],
    };

    expect(validator.validate(tightLoop).filter((e) => e.rule === 'loop_without_wait')).toEqual([
      expect.objectContaining({
        rule: 'loop_without_wait',
        severity: 'WARNING',
        blockId: 'assign',
      }),
    ]);

    const loopWithWait: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'inp',
          type: 'TEXT_INPUT',
          title: 'Ввод',
          x: 100,
          y: 0,
          question: 'Пароль?',
          variableName: 'pwd',
        },
        {
          id: 'cond',
          type: 'CONDITION',
          title: 'Проверка',
          x: 200,
          y: 0,
          expression: 'pwd == "ok"',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 300, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'inp' },
        { source: { blockId: 'inp', output: 'default' }, target: 'cond' },
        { source: { blockId: 'cond', output: 'yes' }, target: 'exit' },
        { source: { blockId: 'cond', output: 'no' }, target: 'inp' },
      ],
    };

    expect(validator.validate(loopWithWait)).toEqual([]);
  });

  it('checkConnections: при отсутствии подключений возвращает ERROR rule=connections, при наличии — []', async () => {
    const emptyValidator = createValidator(0);
    await expect(emptyValidator.checkConnections('bot-1')).resolves.toEqual([
      {
        rule: 'connections',
        severity: 'ERROR',
        message: 'У бота нет подключения к мессенджеру',
      },
    ]);

    const connectedValidator = createValidator(1);
    await expect(connectedValidator.checkConnections('bot-1')).resolves.toEqual([]);
  });

  it('unreachableBlock: недостижимые из точки входа блоки дают WARNING (только при 1 точке входа)', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
        { id: 'orphan', type: 'TEXT_MESSAGE', title: 'Оторванный', x: 0, y: 200, text: 'Привет' },
        { id: 'orphan_exit', type: 'EXIT_POINT', title: 'Выход 2', x: 200, y: 200 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'exit' },
        { source: { blockId: 'orphan', output: 'default' }, target: 'orphan_exit' },
      ],
    };

    const issues = validator.validate(scenario);
    expect(issues).toEqual([
      {
        rule: 'unreachableBlock',
        severity: 'WARNING',
        blockId: 'orphan',
        message: 'Блок недостижим из точки входа',
      },
      {
        rule: 'unreachableBlock',
        severity: 'WARNING',
        blockId: 'orphan_exit',
        message: 'Блок недостижим из точки входа',
      },
    ]);

    // При 0 точках входа unreachableBlock не срабатывает
    const noEntry: Scenario = {
      formatVersion: 1,
      blocks: [{ id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 0, y: 0 }],
      transitions: [],
    };
    expect(validator.validate(noEntry).filter((i) => i.rule === 'unreachableBlock')).toEqual([]);
  });

  it('unwrittenVariable: чтение незаданной переменной диалога даёт WARNING, заданной — без предупреждений', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'inp',
          type: 'TEXT_INPUT',
          title: 'Ввод имени',
          x: 100,
          y: 0,
          question: 'Как вас зовут?',
          variableName: 'name',
        },
        {
          id: 'msg',
          type: 'TEXT_MESSAGE',
          title: 'Приветствие',
          x: 200,
          y: 0,
          text: 'Привет, {{name}}! Возраст: {{age}}, API: {{env.API_URL}}',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 300, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'inp' },
        { source: { blockId: 'inp', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
      ],
    };

    // Без envVars проверяются только переменные диалога: age не задана, name задана, env.API_URL игнорируется
    expect(validator.validate(scenario)).toEqual([
      {
        rule: 'unwrittenVariable',
        severity: 'WARNING',
        blockId: 'msg',
        message: 'Переменная «age» используется, но не задаётся до этого блока',
      },
    ]);
  });

  it('missingEnvVariable: при переданном envVars незаданные env.* дают WARNING, без envVars — не проверяются', () => {
    const validator = createValidator();

    const scenario: Scenario = {
      formatVersion: 1,
      blocks: [
        { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
        {
          id: 'msg',
          type: 'TEXT_MESSAGE',
          title: 'Сообщение',
          x: 100,
          y: 0,
          text: '{{env.DEFINED_VAR}} и {{env.MISSING_VAR}}',
        },
        { id: 'exit', type: 'EXIT_POINT', title: 'Выход', x: 200, y: 0 },
      ],
      transitions: [
        { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
        { source: { blockId: 'msg', output: 'default' }, target: 'exit' },
      ],
    };

    expect(validator.validate(scenario)).toEqual([]);
    expect(validator.validate(scenario, [{ name: 'DEFINED_VAR' }])).toEqual([
      {
        rule: 'missingEnvVariable',
        severity: 'WARNING',
        blockId: 'msg',
        message: 'Переменная окружения «env.MISSING_VAR» не задана в окружении',
      },
    ]);
    expect(
      validator.validate(scenario, [{ name: 'DEFINED_VAR' }, { name: 'MISSING_VAR' }]),
    ).toEqual([]);
  });
});
