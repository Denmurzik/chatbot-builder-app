import { describe, expect, it } from 'vitest';
import type { Block } from './blocks';
import type { Scenario } from './scenario';
import {
  ENV_VAR_PREFIX,
  TEMPLATE_VAR_REGEX,
  availableVariables,
  blockDialogReads,
  blockReads,
  blockWrites,
  extractEnvRefs,
  extractScenarioEnvRefs,
  extractVariableNames,
} from './variables';

const base = { x: 0, y: 0 };

function makeHttpBlock(overrides: Partial<Extract<Block, { type: 'HTTP_REQUEST' }>> = {}): Block {
  return {
    id: 'http1',
    type: 'HTTP_REQUEST',
    title: 'Запрос',
    ...base,
    method: 'POST',
    url: '{{env.API_URL}}/orders/{{orderId}}',
    headers: [
      { name: 'X-User', value: '{{userId}}', secret: false },
      { name: 'Authorization', value: 'Bearer {{ignoredSecret}}', secret: true },
    ],
    body: '{"item":"{{item}}","key":"{{env.CLIENT_KEY}}"}',
    variableName: 'response',
    errorVariable: 'httpError',
    timeoutSec: 10,
    retryCount: 1,
    retryIntervalSec: 2,
    errorStrategy: 'SUSPEND',
    suspendText: 'Подождите, {{userName}}',
    responseMappings: [
      { jsonPath: '$.id', variableName: 'createdId' },
      { jsonPath: '$.status', variableName: 'orderStatus' },
    ],
    ...overrides,
  };
}

describe('variables', () => {
  describe('TEMPLATE_VAR_REGEX и extractVariableNames', () => {
    it('экспортирует регулярное выражение и извлекает имена без дублей в порядке появления', () => {
      expect(TEMPLATE_VAR_REGEX).toBeInstanceOf(RegExp);
      expect(
        extractVariableNames('Привет, {{name}}! URL: {{ env.API_URL }}, снова {{name}}'),
      ).toEqual(['name', 'env.API_URL']);
    });

    it('возвращает пустой массив для строки без переменных и игнорирует некорректные имена', () => {
      expect(extractVariableNames('Обычный текст {{123}} {{a-b}}')).toEqual([]);
    });
  });

  describe('blockWrites (все 10 типов блоков)', () => {
    it('возвращает пустой список для ENTRY_POINT, EXIT_POINT, TEXT_MESSAGE, CONDITION, SWITCH', () => {
      const blocks: Block[] = [
        { id: 'e1', type: 'ENTRY_POINT', title: 'Старт', ...base },
        { id: 'e2', type: 'EXIT_POINT', title: 'Конец', ...base },
        { id: 'm1', type: 'TEXT_MESSAGE', title: 'Сообщение', ...base, text: 'Привет {{name}}' },
        { id: 'c1', type: 'CONDITION', title: 'Условие', ...base, expression: 'age >= 18' },
        {
          id: 's1',
          type: 'SWITCH',
          title: 'Переключатель',
          ...base,
          variableName: 'role',
          values: ['admin', 'user'],
        },
      ];

      for (const block of blocks) {
        expect(blockWrites(block)).toEqual([]);
      }
    });

    it('возвращает variableName для TEXT_INPUT, OPTION_CHOICE, LIST_CHOICE, ASSIGNMENT', () => {
      const textInput: Block = {
        id: 'ti',
        type: 'TEXT_INPUT',
        title: 'Ввод',
        ...base,
        question: 'Имя?',
        variableName: 'name',
      };
      const optionChoice: Block = {
        id: 'oc',
        type: 'OPTION_CHOICE',
        title: 'Выбор',
        ...base,
        question: 'Да или нет?',
        options: ['Да', 'Нет'],
        variableName: 'answer',
      };
      const listChoice: Block = {
        id: 'lc',
        type: 'LIST_CHOICE',
        title: 'Список',
        ...base,
        question: 'Выберите слот',
        listVariable: 'slots',
        labelField: 'time',
        valueField: 'id',
        variableName: 'selectedSlot',
      };
      const assignment: Block = {
        id: 'as',
        type: 'ASSIGNMENT',
        title: 'Счётчик',
        ...base,
        variableName: 'tries',
        expression: 'tries + 1',
      };

      expect(blockWrites(textInput)).toEqual(['name']);
      expect(blockWrites(optionChoice)).toEqual(['answer']);
      expect(blockWrites(listChoice)).toEqual(['selectedSlot']);
      expect(blockWrites(assignment)).toEqual(['tries']);
    });

    it('возвращает variableName, errorVariable и responseMappings[].variableName для HTTP_REQUEST', () => {
      expect(blockWrites(makeHttpBlock())).toEqual([
        'response',
        'httpError',
        'createdId',
        'orderStatus',
      ]);
    });

    it('игнорирует пустые имена и убирает дубликаты', () => {
      const http = makeHttpBlock({
        variableName: 'res',
        errorVariable: '',
        responseMappings: [
          { jsonPath: '$.a', variableName: 'res' },
          { jsonPath: '$.b', variableName: '   ' },
          { jsonPath: '$.c', variableName: 'extra' },
        ],
      });
      expect(blockWrites(http)).toEqual(['res', 'extra']);
    });
  });

  describe('blockReads (все 10 типов блоков)', () => {
    it('возвращает пустой список для ENTRY_POINT и EXIT_POINT', () => {
      expect(blockReads({ id: 'e1', type: 'ENTRY_POINT', title: 'Старт', ...base })).toEqual([]);
      expect(blockReads({ id: 'e2', type: 'EXIT_POINT', title: 'Конец', ...base })).toEqual([]);
    });

    it('извлекает переменные из шаблонов TEXT_MESSAGE, TEXT_INPUT, OPTION_CHOICE', () => {
      expect(
        blockReads({
          id: 'm1',
          type: 'TEXT_MESSAGE',
          title: 'Сообщение',
          ...base,
          text: 'Привет, {{fio}}! Код: {{env.CLINIC_CODE}}',
        }),
      ).toEqual(['fio', 'env.CLINIC_CODE']);

      expect(
        blockReads({
          id: 'ti',
          type: 'TEXT_INPUT',
          title: 'Ввод',
          ...base,
          question: '{{greeting}}, введите телефон',
          variableName: 'phone',
        }),
      ).toEqual(['greeting']);

      expect(
        blockReads({
          id: 'oc',
          type: 'OPTION_CHOICE',
          title: 'Выбор',
          ...base,
          question: 'Филиал для {{city}}?',
          options: ['Центр', 'Север'],
          variableName: 'branch',
        }),
      ).toEqual(['city']);
    });

    it('извлекает listVariable и переменные из question для LIST_CHOICE', () => {
      expect(
        blockReads({
          id: 'lc',
          type: 'LIST_CHOICE',
          title: 'Список',
          ...base,
          question: 'Выберите врача в {{clinic}}',
          listVariable: 'doctors',
          labelField: 'name',
          valueField: 'id',
          variableName: 'doctorId',
        }),
      ).toEqual(['doctors', 'clinic']);
    });

    it('извлекает идентификаторы и {{env.X}} из выражений ASSIGNMENT и CONDITION вне строк и без true/false', () => {
      expect(
        blockReads({
          id: 'as',
          type: 'ASSIGNMENT',
          title: 'Вычисление',
          ...base,
          variableName: 'total',
          expression: 'price * count + 1e2 + "{{ignored}}" + \'alsoIgnored\'',
        }),
      ).toEqual(['price', 'count']);

      expect(
        blockReads({
          id: 'c1',
          type: 'CONDITION',
          title: 'Условие',
          ...base,
          expression:
            'tries < 3 && isReady == true && blocked != false && role == "admin \\"quoted\\"" && token == {{env.ADMIN_TOKEN}}',
        }),
      ).toEqual(['tries', 'isReady', 'blocked', 'role', 'token', 'env.ADMIN_TOKEN']);
    });

    it('не принимает научную нотацию чисел и содержимое строковых литералов за переменные', () => {
      expect(
        blockReads({
          id: 'as_num',
          type: 'ASSIGNMENT',
          title: 'Числа и строки',
          ...base,
          variableName: 'out',
          expression:
            'amount + 1e3 + 2.5e-4 + 1E+5 + "foo {{env.HIDDEN}}" + \'bar {{env.ALSO_HIDDEN}}\' + {{env.VISIBLE}}',
        }),
      ).toEqual(['amount', 'env.VISIBLE']);
    });

    it('извлекает variableName для SWITCH', () => {
      expect(
        blockReads({
          id: 'sw',
          type: 'SWITCH',
          title: 'Переключатель',
          ...base,
          variableName: 'status',
          values: ['ok', 'fail'],
        }),
      ).toEqual(['status']);
    });

    it('извлекает переменные из url, несекретных заголовков, body и suspendText для HTTP_REQUEST', () => {
      expect(blockReads(makeHttpBlock())).toEqual([
        'env.API_URL',
        'orderId',
        'userId',
        'item',
        'env.CLIENT_KEY',
        'userName',
      ]);
    });
  });

  describe('availableVariables', () => {
    it('возвращает переменные из предшествующих блоков в линейной цепочке, без самого блока', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'askName',
            type: 'TEXT_INPUT',
            title: 'Имя',
            ...base,
            question: 'Имя?',
            variableName: 'name',
          },
          {
            id: 'setCount',
            type: 'ASSIGNMENT',
            title: 'Счётчик',
            ...base,
            variableName: 'tries',
            expression: '0',
          },
          {
            id: 'msg',
            type: 'TEXT_MESSAGE',
            title: 'Приветствие',
            ...base,
            text: 'Привет, {{name}}',
          },
        ],
        transitions: [
          { source: { blockId: 'entry', output: 'default' }, target: 'askName' },
          { source: { blockId: 'askName', output: 'default' }, target: 'setCount' },
          { source: { blockId: 'setCount', output: 'default' }, target: 'msg' },
        ],
      };

      expect(availableVariables(scenario, 'entry')).toEqual([]);
      expect(availableVariables(scenario, 'askName')).toEqual([]);
      expect(availableVariables(scenario, 'setCount')).toEqual([
        { name: 'name', sourceBlockId: 'askName' },
      ]);
      expect(availableVariables(scenario, 'msg')).toEqual([
        { name: 'tries', sourceBlockId: 'setCount' },
        { name: 'name', sourceBlockId: 'askName' },
      ]);
    });

    it('при ветвлении Condition обе ветки видят переменные до развилки, но не друг друга', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'askRole',
            type: 'TEXT_INPUT',
            title: 'Роль',
            ...base,
            question: 'Роль?',
            variableName: 'role',
          },
          {
            id: 'cond',
            type: 'CONDITION',
            title: 'Админ?',
            ...base,
            expression: 'role == "admin"',
          },
          {
            id: 'yesWrite',
            type: 'ASSIGNMENT',
            title: 'Ветка да',
            ...base,
            variableName: 'adminFlag',
            expression: 'true',
          },
          {
            id: 'yesEnd',
            type: 'TEXT_MESSAGE',
            title: 'Итог да',
            ...base,
            text: '{{role}} {{adminFlag}}',
          },
          {
            id: 'noWrite',
            type: 'ASSIGNMENT',
            title: 'Ветка нет',
            ...base,
            variableName: 'guestFlag',
            expression: 'true',
          },
          {
            id: 'noEnd',
            type: 'TEXT_MESSAGE',
            title: 'Итог нет',
            ...base,
            text: '{{role}} {{guestFlag}}',
          },
        ],
        transitions: [
          { source: { blockId: 'entry', output: 'default' }, target: 'askRole' },
          { source: { blockId: 'askRole', output: 'default' }, target: 'cond' },
          { source: { blockId: 'cond', output: 'yes' }, target: 'yesWrite' },
          { source: { blockId: 'yesWrite', output: 'default' }, target: 'yesEnd' },
          { source: { blockId: 'cond', output: 'no' }, target: 'noWrite' },
          { source: { blockId: 'noWrite', output: 'default' }, target: 'noEnd' },
        ],
      };

      expect(availableVariables(scenario, 'yesEnd')).toEqual([
        { name: 'adminFlag', sourceBlockId: 'yesWrite' },
        { name: 'role', sourceBlockId: 'askRole' },
      ]);
      expect(availableVariables(scenario, 'noEnd')).toEqual([
        { name: 'guestFlag', sourceBlockId: 'noWrite' },
        { name: 'role', sourceBlockId: 'askRole' },
      ]);
    });

    it('не зависает на цикле Assignment <-> Condition и не включает сам блок', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'init',
            type: 'ASSIGNMENT',
            title: 'Инициализация',
            ...base,
            variableName: 'limit',
            expression: '3',
          },
          {
            id: 'inc',
            type: 'ASSIGNMENT',
            title: 'Шаг',
            ...base,
            variableName: 'tries',
            expression: 'tries + 1',
          },
          {
            id: 'check',
            type: 'CONDITION',
            title: 'Проверка',
            ...base,
            expression: 'tries < limit',
          },
          { id: 'done', type: 'EXIT_POINT', title: 'Конец', ...base },
        ],
        transitions: [
          { source: { blockId: 'entry', output: 'default' }, target: 'init' },
          { source: { blockId: 'init', output: 'default' }, target: 'inc' },
          { source: { blockId: 'inc', output: 'default' }, target: 'check' },
          { source: { blockId: 'check', output: 'yes' }, target: 'inc' },
          { source: { blockId: 'check', output: 'no' }, target: 'done' },
        ],
      };

      expect(availableVariables(scenario, 'inc')).toEqual([
        { name: 'limit', sourceBlockId: 'init' },
      ]);
      expect(availableVariables(scenario, 'check')).toEqual([
        { name: 'tries', sourceBlockId: 'inc' },
        { name: 'limit', sourceBlockId: 'init' },
      ]);
      expect(availableVariables(scenario, 'done')).toEqual([
        { name: 'tries', sourceBlockId: 'inc' },
        { name: 'limit', sourceBlockId: 'init' },
      ]);
    });

    it('возвращает ближайший блок-источник при перезаписи переменной и пустой массив для неизвестного id', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'first',
            type: 'ASSIGNMENT',
            title: 'Первый',
            ...base,
            variableName: 'x',
            expression: '1',
          },
          {
            id: 'second',
            type: 'ASSIGNMENT',
            title: 'Второй',
            ...base,
            variableName: 'x',
            expression: '2',
          },
          { id: 'end', type: 'EXIT_POINT', title: 'Конец', ...base },
        ],
        transitions: [
          { source: { blockId: 'entry', output: 'default' }, target: 'first' },
          { source: { blockId: 'first', output: 'default' }, target: 'second' },
          { source: { blockId: 'second', output: 'default' }, target: 'end' },
        ],
      };

      expect(availableVariables(scenario, 'end')).toEqual([
        { name: 'x', sourceBlockId: 'second' },
      ]);
      expect(availableVariables(scenario, 'missing')).toEqual([]);
    });

    it('в цикле видит переменные, записанные в других блоках цикла, и не зависает на самоцикле', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'msg',
            type: 'TEXT_MESSAGE',
            title: 'Показ',
            ...base,
            text: 'Попытка {{retryNote}}',
          },
          {
            id: 'setNote',
            type: 'ASSIGNMENT',
            title: 'Запись пометки',
            ...base,
            variableName: 'retryNote',
            expression: '"повтор"',
          },
          {
            id: 'selfLoop',
            type: 'ASSIGNMENT',
            title: 'Самоцикл',
            ...base,
            variableName: 'counter',
            expression: 'counter + 1',
          },
        ],
        transitions: [
          { source: { blockId: 'entry', output: 'default' }, target: 'msg' },
          { source: { blockId: 'msg', output: 'default' }, target: 'setNote' },
          { source: { blockId: 'setNote', output: 'default' }, target: 'msg' },
          { source: { blockId: 'selfLoop', output: 'default' }, target: 'selfLoop' },
        ],
      };

      expect(availableVariables(scenario, 'msg')).toEqual([
        { name: 'retryNote', sourceBlockId: 'setNote' },
      ]);
      expect(availableVariables(scenario, 'selfLoop')).toEqual([]);
    });
  });

  describe('blockDialogReads, extractEnvRefs и extractScenarioEnvRefs', () => {
    it('разделяет обычные переменные диалога и ссылки env.* без дубликатов', () => {
      expect(ENV_VAR_PREFIX).toBe('env.');
      const http = makeHttpBlock({
        headers: [
          { name: 'X-User', value: '{{userId}} {{env.API_URL}}', secret: false },
          { name: 'Authorization', value: 'Bearer {{env.IGNORED_SECRET}}', secret: true },
        ],
        suspendText: 'Ждём {{env.CLINIC_NAME}} для {{userName}}',
      });

      expect(blockDialogReads(http)).toEqual(['orderId', 'userId', 'item', 'userName']);
      expect(extractEnvRefs(http)).toEqual(['API_URL', 'CLIENT_KEY', 'CLINIC_NAME']);
    });

    it('извлекает env.* из шаблонов и выражений разных типов блоков и агрегирует по сценарию', () => {
      const scenario: Scenario = {
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', ...base },
          {
            id: 'msg',
            type: 'TEXT_MESSAGE',
            title: 'Привет',
            ...base,
            text: 'Клиника {{env.CLINIC_NAME}} ({{user}})',
          },
          {
            id: 'cond',
            type: 'CONDITION',
            title: 'Проверка',
            ...base,
            expression: 'token == {{env.ADMIN_TOKEN}} && mode != "{{env.IN_STRING}}"',
          },
          makeHttpBlock({
            id: 'http',
            url: '{{env.API_URL}}/{{env.CLINIC_NAME}}',
            body: '{"k":"{{env.CLIENT_KEY}}"}',
          }),
        ],
        transitions: [],
      };

      expect(extractEnvRefs(scenario.blocks[0])).toEqual([]);
      expect(extractEnvRefs(scenario.blocks[1])).toEqual(['CLINIC_NAME']);
      expect(extractEnvRefs(scenario.blocks[2])).toEqual(['ADMIN_TOKEN']);
      expect(blockDialogReads(scenario.blocks[2])).toEqual(['token', 'mode']);
      expect(extractScenarioEnvRefs(scenario)).toEqual([
        'CLINIC_NAME',
        'ADMIN_TOKEN',
        'API_URL',
        'CLIENT_KEY',
      ]);
    });
  });
});
