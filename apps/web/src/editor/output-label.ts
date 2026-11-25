import type { BlockType } from '@chatbot/model';
import { ru } from '@/i18n/ru';

// Служебные выходы, имена которых переводим, — только для своих типов блоков
const SERVICE_OUTPUTS: Partial<Record<BlockType, readonly string[]>> = {
  ENTRY_POINT: ['default'],
  TEXT_MESSAGE: ['default'],
  TEXT_INPUT: ['default'],
  ASSIGNMENT: ['default'],
  LIST_CHOICE: ['default', 'noOptions'],
  CONDITION: ['yes', 'no'],
  SWITCH: ['else'],
  HTTP_REQUEST: ['success', 'error'],
};

// Подпись выхода: служебные переводим, варианты и значения показываем как есть
export function outputLabel(type: BlockType, output: string): string {
  const isService = SERVICE_OUTPUTS[type]?.includes(output) ?? false;
  return isService && Object.hasOwn(ru.outputs, output)
    ? ru.outputs[output as keyof typeof ru.outputs]
    : output;
}
