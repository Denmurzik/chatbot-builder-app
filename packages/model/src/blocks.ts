import { z } from 'zod';
import { encryptedSecretSchema } from './environment';

// Все типы блоков сценария согласно диаграмме «Классы: блоки сценария»
export const BLOCK_TYPES = [
  'ENTRY_POINT',
  'EXIT_POINT',
  'TEXT_MESSAGE',
  'TEXT_INPUT',
  'OPTION_CHOICE',
  'LIST_CHOICE',
  'ASSIGNMENT',
  'CONDITION',
  'SWITCH',
  'HTTP_REQUEST',
] as const;

export const blockTypeSchema = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof blockTypeSchema>;

// Идентификатор блока ограничен 40 ASCII-символами, чтобы помещаться в 64 байта callback_data Telegram
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export const blockIdSchema = z
  .string()
  .regex(
    BLOCK_ID_PATTERN,
    'Идентификатор блока должен содержать от 1 до 40 символов: латиница, цифры, "_" или "-"',
  );

// Методы HTTP-запроса (HttpMethod на диаграмме)
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const httpMethodSchema = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

// Стратегии обработки ошибок HTTP-запроса (ErrorStrategy на диаграмме)
export const ERROR_STRATEGIES = ['EXIT_ERROR', 'SUSPEND'] as const;
export const errorStrategySchema = z.enum(ERROR_STRATEGIES);
export type ErrorStrategy = z.infer<typeof errorStrategySchema>;

// Заголовок HTTP-запроса (HttpHeader)
export const httpHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
  secret: z.boolean(),
  secretValue: encryptedSecretSchema.optional(),
  // Маска секретного заголовка, передаваемая клиенту вместо шифротекста
  secretMask: z.string().optional(),
});

export type HttpHeader = z.infer<typeof httpHeaderSchema>;

// Правило извлечения поля из JSON-ответа (ResponseMapping)
export const responseMappingSchema = z.object({
  jsonPath: z.string(),
  variableName: z.string(),
});

export type ResponseMapping = z.infer<typeof responseMappingSchema>;

// Проверка списка вариантов: непустой список непустых уникальных строк
function createUniqueOptionsSchema(forbidValues: readonly string[] = []) {
  return z
    .array(
      z.string().refine((item) => item.trim().length > 0, {
        message: 'Вариант не может быть пустым',
      }),
    )
    .min(1, 'Список вариантов не может быть пустым')
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (forbidValues.includes(item)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `Значение "${item}" зарезервировано и не может использоваться в списке`,
          });
        }
        if (seen.has(item)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `Повторяющийся вариант: "${item}"`,
          });
        } else {
          seen.add(item);
        }
      });
    });
}

// Базовые поля любого блока (Block на диаграмме)
const baseBlockShape = {
  id: blockIdSchema,
  title: z.string(),
  x: z.number().int(),
  y: z.number().int(),
};

export const entryPointBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('ENTRY_POINT'),
});
export type EntryPointBlock = z.infer<typeof entryPointBlockSchema>;

export const exitPointBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('EXIT_POINT'),
});
export type ExitPointBlock = z.infer<typeof exitPointBlockSchema>;

export const textMessageBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('TEXT_MESSAGE'),
  text: z.string(),
});
export type TextMessageBlock = z.infer<typeof textMessageBlockSchema>;

export const textInputBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('TEXT_INPUT'),
  question: z.string(),
  variableName: z.string(),
});
export type TextInputBlock = z.infer<typeof textInputBlockSchema>;

export const optionChoiceBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('OPTION_CHOICE'),
  question: z.string(),
  options: createUniqueOptionsSchema(),
  variableName: z.string(),
});
export type OptionChoiceBlock = z.infer<typeof optionChoiceBlockSchema>;

export const listChoiceBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('LIST_CHOICE'),
  question: z.string(),
  listVariable: z.string(),
  labelField: z.string(),
  valueField: z.string(),
  variableName: z.string(),
});
export type ListChoiceBlock = z.infer<typeof listChoiceBlockSchema>;

export const assignmentBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('ASSIGNMENT'),
  variableName: z.string(),
  expression: z.string(),
});
export type AssignmentBlock = z.infer<typeof assignmentBlockSchema>;

export const conditionBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('CONDITION'),
  expression: z.string(),
});
export type ConditionBlock = z.infer<typeof conditionBlockSchema>;

export const switchBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('SWITCH'),
  variableName: z.string(),
  values: createUniqueOptionsSchema(['else']),
});
export type SwitchBlock = z.infer<typeof switchBlockSchema>;

export const httpRequestBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal('HTTP_REQUEST'),
  method: httpMethodSchema,
  url: z.string(),
  headers: z.array(httpHeaderSchema),
  body: z.string(),
  variableName: z.string(),
  errorVariable: z.string(),
  timeoutSec: z.number().int().positive(),
  retryCount: z.number().int().min(0),
  retryIntervalSec: z.number().int().min(0),
  errorStrategy: errorStrategySchema,
  suspendText: z.string().nullable(),
  responseMappings: z.array(responseMappingSchema),
});
export type HttpRequestBlock = z.infer<typeof httpRequestBlockSchema>;

// Размеченное объединение всех 10 типов блоков сценария
export const blockSchema = z.discriminatedUnion('type', [
  entryPointBlockSchema,
  exitPointBlockSchema,
  textMessageBlockSchema,
  textInputBlockSchema,
  optionChoiceBlockSchema,
  listChoiceBlockSchema,
  assignmentBlockSchema,
  conditionBlockSchema,
  switchBlockSchema,
  httpRequestBlockSchema,
]);

export type Block = z.infer<typeof blockSchema>;
