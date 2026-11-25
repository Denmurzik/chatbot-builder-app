import type { BlockNodeData } from './convert';

// Краткое содержимое блока для узла на холсте; пустая строка — показывать нечего
export function blockPreview(data: BlockNodeData): string {
  const d = data as Record<string, unknown>;
  const str = (key: string): string =>
    typeof d[key] === 'string' ? (d[key] as string).trim() : '';
  switch (data.type) {
    case 'TEXT_MESSAGE':
      return str('text');
    case 'TEXT_INPUT':
    case 'OPTION_CHOICE':
    case 'LIST_CHOICE':
      return str('question');
    case 'ASSIGNMENT': {
      const variable = str('variableName');
      const expression = str('expression');
      return variable && expression ? `${variable} = ${expression}` : '';
    }
    case 'CONDITION':
      return str('expression');
    case 'SWITCH':
      return str('variableName');
    case 'HTTP_REQUEST': {
      const url = str('url');
      return url ? `${str('method')} ${url}`.trim() : '';
    }
    default:
      return '';
  }
}
