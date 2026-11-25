import { describe, expect, it } from 'vitest';
import { parseScenario } from '@chatbot/model';
import { TEMPLATES } from './templates';

describe('шаблоны сценариев', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('«%s» проходит parseScenario', (_id, t) => {
    const scenario = t.build();
    expect(() => parseScenario(scenario)).not.toThrow();
    expect(scenario.blocks.some((b) => b.type === 'ENTRY_POINT')).toBe(true);
  });

  it('координаты кратны 20, раскладка слева направо', () => {
    for (const t of TEMPLATES) {
      const scenario = t.build();
      const byId = new Map(scenario.blocks.map((b) => [b.id, b]));
      for (const b of scenario.blocks) {
        expect(b.x % 20).toBe(0);
        expect(b.y % 20).toBe(0);
      }
      for (const tr of scenario.transitions) {
        expect(byId.get(tr.target)!.x).toBeGreaterThan(byId.get(tr.source.blockId)!.x);
      }
    }
  });

  it('есть «Пустой сценарий» и «Запись к врачу» без HTTP', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['empty', 'doctor']);
    expect(TEMPLATES[1]!.build().blocks.some((b) => b.type === 'HTTP_REQUEST')).toBe(false);
  });
});
