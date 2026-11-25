import type { Block } from './blocks';

// Возвращает список имён выходов блока в зависимости от его типа и настроек
export function getOutputs(block: Block): string[] {
  switch (block.type) {
    case 'ENTRY_POINT':
    case 'TEXT_MESSAGE':
    case 'TEXT_INPUT':
    case 'ASSIGNMENT':
      return ['default'];
    case 'EXIT_POINT':
      return [];
    case 'OPTION_CHOICE':
      return [...block.options];
    case 'LIST_CHOICE':
      return ['default', 'noOptions'];
    case 'CONDITION':
      return ['yes', 'no'];
    case 'SWITCH':
      return [...block.values, 'else'];
    case 'HTTP_REQUEST':
      return ['success', 'error'];
  }
}
