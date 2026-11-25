import type { BlockType } from '@chatbot/model';

// Свободный идентификатор блока: тип в нижнем регистре + номер (до 40 символов)
export function nextBlockId(type: BlockType, nodes: readonly { id: string }[]): string {
  const base = type.toLowerCase();
  const used = new Set(nodes.map((node) => node.id));
  let n = 1;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
