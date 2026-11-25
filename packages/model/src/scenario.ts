import { z } from 'zod';
import { blockSchema, type Block } from './blocks';
import { getOutputs } from './outputs';

// Текущая версия формата JSON сценария (п. 3.3)
export const SCENARIO_FORMAT_VERSION = 1 as const;

// Источник перехода: идентификатор блока и имя его выхода
export const transitionSourceSchema = z.object({
  blockId: z.string(),
  output: z.string(),
});

export type TransitionSource = z.infer<typeof transitionSourceSchema>;

// Направленный переход между выходом одного блока и целевым блоком
export const transitionSchema = z.object({
  source: transitionSourceSchema,
  target: z.string(),
});

export type Transition = z.infer<typeof transitionSchema>;

// Схема сценария с проверкой структурной целостности графа
export const scenarioSchema = z
  .object({
    formatVersion: z.literal(SCENARIO_FORMAT_VERSION),
    blocks: z.array(blockSchema),
    transitions: z.array(transitionSchema),
  })
  .superRefine((scenario, ctx) => {
    const blocksById = new Map<string, Block>();

    // Проверка уникальности идентификаторов блоков
    scenario.blocks.forEach((block, index) => {
      if (blocksById.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocks', index, 'id'],
          message: `Дублируется идентификатор блока: "${block.id}"`,
        });
      } else {
        blocksById.set(block.id, block);
      }
    });

    // Проверка ссылочной целостности и уникальности выходов переходов
    const usedOutputs = new Set<string>();
    scenario.transitions.forEach((transition, index) => {
      const sourceBlock = blocksById.get(transition.source.blockId);

      if (!sourceBlock) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transitions', index, 'source', 'blockId'],
          message: `Переход из несуществующего блока: "${transition.source.blockId}"`,
        });
      } else {
        const validOutputs = getOutputs(sourceBlock);
        if (!validOutputs.includes(transition.source.output)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transitions', index, 'source', 'output'],
            message: `У блока "${sourceBlock.id}" (${sourceBlock.type}) нет выхода "${transition.source.output}"`,
          });
        } else {
          const outputKey = `${sourceBlock.id}\0${transition.source.output}`;
          if (usedOutputs.has(outputKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['transitions', index, 'source'],
              message: `Из выхода "${transition.source.output}" блока "${sourceBlock.id}" уже существует переход`,
            });
          } else {
            usedOutputs.add(outputKey);
          }
        }
      }

      if (!blocksById.has(transition.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transitions', index, 'target'],
          message: `Переход на несуществующий блок: "${transition.target}"`,
        });
      }
    });
  });

export type Scenario = z.infer<typeof scenarioSchema>;

// Разбор и проверка структуры сценария; при ошибке бросает ZodError
export function parseScenario(json: unknown): Scenario {
  return scenarioSchema.parse(json);
}

// Заготовка пустого сценария для нового проекта
export function emptyScenario(): Scenario {
  return {
    formatVersion: SCENARIO_FORMAT_VERSION,
    blocks: [
      {
        id: 'entry',
        type: 'ENTRY_POINT',
        title: 'Старт',
        x: 0,
        y: 0,
      },
    ],
    transitions: [],
  };
}
