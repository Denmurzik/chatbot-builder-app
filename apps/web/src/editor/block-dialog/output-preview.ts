import { MapScope, ExpressionError, evaluate, render, toBoolean } from '@chatbot/engine-core';
import { ru } from '@/i18n/ru';
import type { BlockNodeData } from '../convert';

// Предпросмотр результата блока по тестовым значениям из колонки «Вход»
export interface BlockPreview {
  // Строки «подпись: значение»
  rows: { label: string; value: string }[];
  // Кнопки вариантов
  buttons: string[];
  // Имя выхода, который сработает (для Условия и Переключателя)
  branch?: string;
  error?: string;
}

function errorText(error: unknown): string {
  return error instanceof ExpressionError ? error.message : ru.fieldInput.expressionErrorGeneric;
}

const p = ru.blockDialog;

export function previewBlock(
  data: BlockNodeData,
  testValues: Record<string, string>,
): BlockPreview {
  const scope = new MapScope(testValues);
  const result: BlockPreview = { rows: [], buttons: [] };
  try {
    switch (data.type) {
      case 'TEXT_MESSAGE':
        result.rows.push({ label: p.previewText, value: render(data.text, scope, 'TEXT') });
        break;
      case 'TEXT_INPUT':
      case 'LIST_CHOICE':
        result.rows.push({ label: p.previewQuestion, value: render(data.question, scope, 'TEXT') });
        break;
      case 'OPTION_CHOICE':
        result.rows.push({ label: p.previewQuestion, value: render(data.question, scope, 'TEXT') });
        result.buttons = data.options.filter((option) => option.trim() !== '');
        break;
      case 'ASSIGNMENT':
        result.rows.push({
          label: data.variableName,
          value: String(evaluate(data.expression, scope)),
        });
        break;
      case 'CONDITION':
        result.branch = toBoolean(evaluate(data.expression, scope)) ? 'yes' : 'no';
        break;
      case 'SWITCH': {
        const value = scope.get(data.variableName);
        if (value === undefined) {
          result.error = p.previewError(p.unknownVariable(data.variableName));
          break;
        }
        result.branch = data.values.includes(value) ? value : 'else';
        break;
      }
      case 'HTTP_REQUEST': {
        result.rows.push({
          label: p.previewUrl,
          value: `${data.method} ${render(data.url, scope, 'URL')}`,
        });
        const headers = data.headers
          .filter((header) => header.name.trim() !== '')
          .map(
            (header) =>
              `${header.name}: ${
                header.secret
                  ? (header.secretMask ?? header.secretValue?.mask ?? p.secretMask)
                  : render(header.value, scope, 'HEADER')
              }`,
          );
        if (headers.length > 0)
          result.rows.push({ label: p.previewHeaders, value: headers.join('\n') });
        if (data.body.trim() !== '') {
          result.rows.push({ label: p.previewBody, value: render(data.body, scope, 'JSON') });
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    return { rows: [], buttons: [], error: p.previewError(errorText(error)) };
  }
  return result;
}
