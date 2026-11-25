import { checkTemplate, parseExpression, parseJsonPath } from '@chatbot/engine-core';
import {
  availableVariables,
  blockDialogReads,
  extractEnvRefs,
  getOutputs,
  type Block,
  type BlockType,
  type Scenario,
  type ValidationError,
} from '@chatbot/model';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

export type { ValidationError } from '@chatbot/model';

// Допустимый идентификатор переменной сценария (п. 2.10)
const VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Блоки, которые выполняются в автопроходе без ожидания пользователя или внешней системы (п. 2.3, 2.10)
const NON_WAITING_BLOCK_TYPES = new Set<BlockType>([
  'ENTRY_POINT',
  'TEXT_MESSAGE',
  'ASSIGNMENT',
  'CONDITION',
  'SWITCH',
]);

// Русские подписи стандартных выходов блоков для сообщений об ошибках
const OUTPUT_LABELS: Record<string, string> = {
  default: 'Далее',
  yes: 'Да',
  no: 'Нет',
  else: 'Иначе',
  noOptions: 'Нет вариантов',
  success: 'Успех',
  error: 'Ошибка',
};

function blockLabel(block: Block): string {
  const name = block.title.trim() || block.id;
  return `Блок «${name}»`;
}

function outputLabel(output: string): string {
  return OUTPUT_LABELS[output] ?? output;
}

/**
 * Класс модели BCE: ScenarioValidator — смысловая проверка сценария и подключений бота.
 * Реализует UC-A-24, UC-A-27, SD-6 (п. 2.10).
 */
@Injectable()
export class ScenarioValidator {
  constructor(private readonly prisma: PrismaService) {}

  validate(scenario: Scenario, envVars?: ReadonlyArray<{ name: string }>): ValidationError[] {
    return [
      ...this.checkSingleEntryPoint(scenario),
      ...this.checkOutputsConnected(scenario),
      ...this.checkRequiredFields(scenario),
      ...this.checkLoops(scenario),
      ...this.checkUnreachableBlocks(scenario),
      ...this.checkUnwrittenVariables(scenario),
      ...this.checkMissingEnvVariables(scenario, envVars),
    ];
  }

  checkSingleEntryPoint(scenario: Scenario): ValidationError[] {
    const entryPoints = scenario.blocks.filter((block) => block.type === 'ENTRY_POINT');
    if (entryPoints.length === 0) {
      return [
        {
          rule: 'single_entry_point',
          severity: 'ERROR',
          message: 'В сценарии должна быть точка входа',
        },
      ];
    }
    if (entryPoints.length > 1) {
      return entryPoints.slice(1).map((block) => ({
        rule: 'single_entry_point',
        severity: 'ERROR' as const,
        blockId: block.id,
        message: 'В сценарии должна быть ровно одна точка входа',
      }));
    }
    return [];
  }

  checkOutputsConnected(scenario: Scenario): ValidationError[] {
    const connected = new Set<string>();
    for (const transition of scenario.transitions) {
      connected.add(`${transition.source.blockId}\0${transition.source.output}`);
    }

    const errors: ValidationError[] = [];
    for (const block of scenario.blocks) {
      const requiredOutputs = getOutputs(block).filter((output) => {
        // Для HTTP-блока со стратегией SUSPEND выход «Ошибка» не используется (п. 2.9, 2.10)
        if (block.type === 'HTTP_REQUEST' && block.errorStrategy === 'SUSPEND' && output === 'error') {
          return false;
        }
        return true;
      });

      for (const output of requiredOutputs) {
        if (!connected.has(`${block.id}\0${output}`)) {
          errors.push({
            rule: 'outputs_connected',
            severity: 'ERROR',
            blockId: block.id,
            message: `${blockLabel(block)}: не подключён выход «${outputLabel(output)}»`,
          });
        }
      }
    }

    return errors;
  }

  checkRequiredFields(scenario: Scenario): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const block of scenario.blocks) {
      errors.push(...this.checkBlockFields(block));
    }
    return errors;
  }

  async checkConnections(botId: string): Promise<ValidationError[]> {
    const count = await this.prisma.client.messengerConnection.count({ where: { botId } });
    if (count === 0) {
      return [
        {
          rule: 'connections',
          severity: 'ERROR',
          message: 'У бота нет подключения к мессенджеру',
        },
      ];
    }
    return [];
  }

  checkBlockFields(block: Block): ValidationError[] {
    const errors: ValidationError[] = [];

    const checkRequired = (value: string, fieldLabel: string): boolean => {
      if (value.trim().length === 0) {
        errors.push({
          rule: 'required_field',
          severity: 'ERROR',
          blockId: block.id,
          message: `${blockLabel(block)}: не заполнено обязательное поле «${fieldLabel}»`,
        });
        return false;
      }
      return true;
    };

    const checkVarName = (value: string, fieldLabel: string): void => {
      if (!checkRequired(value, fieldLabel)) {
        return;
      }
      if (!VARIABLE_NAME_REGEX.test(value)) {
        errors.push({
          rule: 'variable_name',
          severity: 'ERROR',
          blockId: block.id,
          message: `${blockLabel(block)}: некорректное имя переменной «${value}» в поле «${fieldLabel}»`,
        });
      }
    };

    const checkTemplateField = (value: string, fieldLabel: string): void => {
      if (value.length === 0) {
        return;
      }
      const err = checkTemplate(value);
      if (err !== null) {
        errors.push({
          rule: 'template',
          severity: 'ERROR',
          blockId: block.id,
          message: `${blockLabel(block)}: ошибка в шаблоне поля «${fieldLabel}»: ${err}`,
        });
      }
    };

    const checkExpressionField = (value: string, fieldLabel: string): void => {
      if (!checkRequired(value, fieldLabel)) {
        return;
      }
      try {
        parseExpression(value);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'недопустимое выражение';
        errors.push({
          rule: 'expression',
          severity: 'ERROR',
          blockId: block.id,
          message: `${blockLabel(block)}: ошибка в выражении поля «${fieldLabel}»: ${reason}`,
        });
      }
    };

    switch (block.type) {
      case 'ENTRY_POINT':
      case 'EXIT_POINT':
        break;

      case 'TEXT_MESSAGE':
        if (checkRequired(block.text, 'Текст сообщения')) {
          checkTemplateField(block.text, 'Текст сообщения');
        }
        break;

      case 'TEXT_INPUT':
        if (checkRequired(block.question, 'Текст вопроса')) {
          checkTemplateField(block.question, 'Текст вопроса');
        }
        checkVarName(block.variableName, 'Имя переменной');
        break;

      case 'OPTION_CHOICE':
        if (checkRequired(block.question, 'Текст вопроса')) {
          checkTemplateField(block.question, 'Текст вопроса');
        }
        if (block.options.length === 0 || block.options.some((opt) => opt.trim().length === 0)) {
          errors.push({
            rule: 'required_field',
            severity: 'ERROR',
            blockId: block.id,
            message: `${blockLabel(block)}: не заполнено обязательное поле «Варианты ответа»`,
          });
        }
        checkVarName(block.variableName, 'Имя переменной');
        break;

      case 'LIST_CHOICE':
        if (checkRequired(block.question, 'Текст вопроса')) {
          checkTemplateField(block.question, 'Текст вопроса');
        }
        checkVarName(block.listVariable, 'Переменная списка');
        checkRequired(block.labelField, 'Поле подписи');
        checkRequired(block.valueField, 'Поле значения');
        checkVarName(block.variableName, 'Имя переменной');
        break;

      case 'ASSIGNMENT':
        checkVarName(block.variableName, 'Имя переменной');
        checkExpressionField(block.expression, 'Выражение');
        break;

      case 'CONDITION':
        checkExpressionField(block.expression, 'Условие');
        break;

      case 'SWITCH':
        checkVarName(block.variableName, 'Имя переменной');
        if (block.values.length === 0 || block.values.some((val) => val.trim().length === 0)) {
          errors.push({
            rule: 'required_field',
            severity: 'ERROR',
            blockId: block.id,
            message: `${blockLabel(block)}: не заполнено обязательное поле «Значения переключателя»`,
          });
        }
        break;

      case 'HTTP_REQUEST':
        if (checkRequired(block.url, 'URL')) {
          checkTemplateField(block.url, 'URL');
        }
        checkVarName(block.variableName, 'Переменная ответа');
        checkVarName(block.errorVariable, 'Переменная ошибки');
        for (const header of block.headers) {
          checkRequired(header.name, 'Имя заголовка');
          if (!header.secret) {
            checkTemplateField(header.value, `Заголовок «${header.name || 'без имени'}»`);
          }
        }
        checkTemplateField(block.body, 'Тело запроса');
        if (block.suspendText !== null) {
          checkTemplateField(block.suspendText, 'Текст при приостановке');
        }
        for (const mapping of block.responseMappings) {
          if (checkRequired(mapping.jsonPath, 'jsonPath')) {
            try {
              parseJsonPath(mapping.jsonPath);
            } catch (err) {
              const reason = err instanceof Error ? err.message : 'некорректный jsonPath';
              errors.push({
                rule: 'json_path',
                severity: 'ERROR',
                blockId: block.id,
                message: `${blockLabel(block)}: ${reason}`,
              });
            }
          }
          checkVarName(mapping.variableName, 'Переменная маппинга');
        }
        break;
    }

    return errors;
  }

  // Поиск циклов в подграфе блоков без ожидания алгоритмом Тарьяна (SCC)
  checkLoops(scenario: Scenario): ValidationError[] {
    const nonWaitingById = new Map<string, Block>();
    const orderById = new Map<string, number>();

    scenario.blocks.forEach((block, idx) => {
      if (NON_WAITING_BLOCK_TYPES.has(block.type)) {
        nonWaitingById.set(block.id, block);
        orderById.set(block.id, idx);
      }
    });

    const adj = new Map<string, string[]>();
    const selfLoop = new Set<string>();
    for (const id of nonWaitingById.keys()) {
      adj.set(id, []);
    }
    for (const transition of scenario.transitions) {
      const from = transition.source.blockId;
      const to = transition.target;
      if (nonWaitingById.has(from) && nonWaitingById.has(to)) {
        adj.get(from)!.push(to);
        if (from === to) {
          selfLoop.add(from);
        }
      }
    }

    let nextIndex = 0;
    const indexMap = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycleRoots: Block[] = [];

    const strongConnect = (v: string): void => {
      indexMap.set(v, nextIndex);
      lowLink.set(v, nextIndex);
      nextIndex += 1;
      stack.push(v);
      onStack.add(v);

      for (const w of adj.get(v) ?? []) {
        if (!indexMap.has(w)) {
          strongConnect(w);
          lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
        } else if (onStack.has(w)) {
          lowLink.set(v, Math.min(lowLink.get(v)!, indexMap.get(w)!));
        }
      }

      if (lowLink.get(v) === indexMap.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);

        if (component.length > 1 || (component.length === 1 && selfLoop.has(component[0]))) {
          // Выбираем первый по порядку блок цикла для стабильного blockId
          component.sort((a, b) => orderById.get(a)! - orderById.get(b)!);
          cycleRoots.push(nonWaitingById.get(component[0])!);
        }
      }
    };

    for (const id of nonWaitingById.keys()) {
      if (!indexMap.has(id)) {
        strongConnect(id);
      }
    }

    cycleRoots.sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!);

    return cycleRoots.map((block) => ({
      rule: 'loop_without_wait',
      severity: 'WARNING',
      blockId: block.id,
      message: `${blockLabel(block)}: обнаружен цикл без блоков ожидания`,
    }));
  }

  // Поиск блоков, недостижимых из единственной точки входа (BFS вперёд по переходам)
  checkUnreachableBlocks(scenario: Scenario): ValidationError[] {
    const entryPoints = scenario.blocks.filter((block) => block.type === 'ENTRY_POINT');
    if (entryPoints.length !== 1) {
      return [];
    }

    const adj = new Map<string, string[]>();
    for (const transition of scenario.transitions) {
      const targets = adj.get(transition.source.blockId);
      if (targets) {
        targets.push(transition.target);
      } else {
        adj.set(transition.source.blockId, [transition.target]);
      }
    }

    const entryId = entryPoints[0]!.id;
    const visited = new Set<string>([entryId]);
    const queue: string[] = [entryId];

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      for (const next of adj.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const warnings: ValidationError[] = [];
    for (const block of scenario.blocks) {
      if (!visited.has(block.id)) {
        warnings.push({
          rule: 'unreachableBlock',
          severity: 'WARNING',
          blockId: block.id,
          message: 'Блок недостижим из точки входа',
        });
      }
    }
    return warnings;
  }

  // Поиск переменных диалога, которые читаются в блоке, но не задаются ни на одном пути до него
  checkUnwrittenVariables(scenario: Scenario): ValidationError[] {
    const warnings: ValidationError[] = [];
    for (const block of scenario.blocks) {
      const reads = blockDialogReads(block);
      if (reads.length === 0) continue;

      const available = new Set(availableVariables(scenario, block.id).map((v) => v.name));
      for (const name of reads) {
        if (!available.has(name)) {
          warnings.push({
            rule: 'unwrittenVariable',
            severity: 'WARNING',
            blockId: block.id,
            message: `Переменная «${name}» используется, но не задаётся до этого блока`,
          });
        }
      }
    }
    return warnings;
  }

  // Поиск ссылок на переменные окружения {{env.X}}, отсутствующие в переданном окружении
  checkMissingEnvVariables(
    scenario: Scenario,
    envVars?: ReadonlyArray<{ name: string }>,
  ): ValidationError[] {
    if (envVars === undefined) {
      return [];
    }

    const defined = new Set(envVars.map((v) => v.name));
    const warnings: ValidationError[] = [];
    for (const block of scenario.blocks) {
      for (const name of extractEnvRefs(block)) {
        if (!defined.has(name)) {
          warnings.push({
            rule: 'missingEnvVariable',
            severity: 'WARNING',
            blockId: block.id,
            message: `Переменная окружения «env.${name}» не задана в окружении`,
          });
        }
      }
    }
    return warnings;
  }
}
