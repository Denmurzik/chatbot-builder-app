import { extract as extractJsonPath, toText } from '@chatbot/engine-core';
import { Injectable } from '@nestjs/common';

/**
 * Класс модели BCE: ResponseParser — разбор JSON-ответа внешнего API и извлечение полей по jsonPath.
 * Реализует UC-U-14, UC-U-15, SD-3; логика jsonPath реализована в спринте 1 (@chatbot/engine-core),
 * интеграция в цикл HTTP-исполнителя — спринт 2.
 */
@Injectable()
export class ResponseParser {
  // Разбирает тело ответа внешнего API как JSON
  parse(body: string): unknown {
    return JSON.parse(body) as unknown;
  }

  // Извлекает значение из разобранного JSON по пути jsonPath (делегирует @chatbot/engine-core)
  extract(json: unknown, path: string): { found: true; value: unknown } | { found: false } {
    return extractJsonPath(json, path);
  }

  // Преобразует извлечённое JSON-значение в строковое представление для переменной диалога
  toText(value: unknown): string {
    return toText(value);
  }
}
