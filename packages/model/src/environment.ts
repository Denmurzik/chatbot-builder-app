import { z } from 'zod';

// Зашифрованное значение секрета и его маска для отображения в интерфейсе (п. 2.13)
export const encryptedSecretSchema = z.object({
  cipherText: z.string(),
  mask: z.string(),
});

export type EncryptedSecret = z.infer<typeof encryptedSecretSchema>;

// Переменная окружения проекта (тестового) или бота (рабочего) (п. 3.3)
export const environmentVariableSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  secret: z.boolean(),
  secretValue: encryptedSecretSchema.optional(),
});

export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;

// Список переменных окружения (JSONB-массив в project.environment / bot.environment)
export const environmentSchema = z.array(environmentVariableSchema);

export type Environment = z.infer<typeof environmentSchema>;

// Вид переменной окружения для клиента: секретное значение наружу не отдаётся, только маска
export const envVarViewSchema = z.discriminatedUnion('secret', [
  z.object({ name: z.string(), secret: z.literal(false), value: z.string() }),
  z.object({ name: z.string(), secret: z.literal(true), mask: z.string() }),
]);

export type EnvVarView = z.infer<typeof envVarViewSchema>;

// Ввод переменной окружения от автора; у секретной значение может отсутствовать (оставить прежнее)
export const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export const envVarInputSchema = z.object({
  name: z.string().regex(ENV_VAR_NAME_PATTERN, 'Имя переменной: заглавные латинские буквы, цифры и _'),
  secret: z.boolean(),
  value: z.string().optional(),
});

export type EnvVarInput = z.infer<typeof envVarInputSchema>;

export const envVarInputListSchema = z.array(envVarInputSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((item, index) => {
    if (seen.has(item.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'name'],
        message: `Переменная ${item.name} задана дважды`,
      });
    }
    seen.add(item.name);
  });
});
