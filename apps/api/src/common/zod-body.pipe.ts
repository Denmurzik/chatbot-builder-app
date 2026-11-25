import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodTypeAny } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

// Преобразует ошибки Zod в плоский список {path, message} для ответа 400
export function formatZodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

// Формирует единый ответ 400 Bad Request для ошибок валидации Zod
export function createValidationException(
  error: ZodError,
  message = 'Ошибка валидации',
): BadRequestException {
  return new BadRequestException({
    message,
    issues: formatZodIssues(error),
  });
}

// Пайп NestJS для валидации тела запроса по схеме Zod
export class ZodBodyPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(
    private readonly schema: TSchema,
    private readonly errorMessage = 'Ошибка валидации',
  ) {}

  transform(value: unknown): TSchema['_output'] {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw createValidationException(result.error, this.errorMessage);
    }
    return result.data;
  }
}
