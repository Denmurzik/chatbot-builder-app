import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, scenarioSchema } from '@chatbot/model';
import { BLOCK_META } from './block-meta';

describe('BLOCK_META', () => {
  it('описывает все 10 типов блоков с уникальными цветом и иконкой', () => {
    expect(Object.keys(BLOCK_META).sort()).toEqual([...BLOCK_TYPES].sort());
    const colors = new Set(BLOCK_TYPES.map((type) => BLOCK_META[type].color));
    const icons = new Set(BLOCK_TYPES.map((type) => BLOCK_META[type].icon));
    expect(colors.size).toBe(BLOCK_TYPES.length);
    expect(icons.size).toBe(BLOCK_TYPES.length);
  });

  it.each(BLOCK_TYPES)('defaults() типа %s проходит scenarioSchema', (type) => {
    const data = BLOCK_META[type].defaults();
    expect(data.type).toBe(type);
    const result = scenarioSchema.safeParse({
      formatVersion: 1,
      blocks: [{ id: 'b1', x: 0, y: 0, ...data }],
      transitions: [],
    });
    expect(result.success).toBe(true);
  });
});
