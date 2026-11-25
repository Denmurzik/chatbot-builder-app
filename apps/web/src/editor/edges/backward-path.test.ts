import { describe, expect, it } from 'vitest';
import { backwardEdgePath, isBackward } from './backward-path';

const sourceRect = { x: 400, y: 0, width: 280, height: 100 };
const targetRect = { x: 100, y: 20, width: 280, height: 160 };

describe('backwardEdgePath', () => {
  it('нижний отрезок ниже обоих блоков на 40, подпись — в его середине', () => {
    const { path, labelX, labelY } = backwardEdgePath(
      { x: 680, y: 50 },
      { x: 100, y: 100 },
      sourceRect,
      targetRect,
    );
    // низ цели (180) ниже низа источника (100): 180 + 40
    expect(labelY).toBe(220);
    expect(labelX).toBe((704 + 76) / 2);
    expect(path.startsWith('M 680 50')).toBe(true);
    expect(path.endsWith('L 100 100')).toBe(true);
    // Путь доходит до нижнего уровня и содержит дуги скругления
    expect(path).toContain('220');
    expect(path).toContain('Q');
  });

  it('учитывает более низкий источник', () => {
    const { labelY } = backwardEdgePath(
      { x: 680, y: 50 },
      { x: 100, y: 100 },
      { x: 400, y: 0, width: 280, height: 300 },
      targetRect,
    );
    expect(labelY).toBe(340);
  });
});

describe('isBackward', () => {
  // Источник: блок x=200…400, выход справа (x=400)
  const source = { x: 400, y: 0 };
  const rect = { x: 200, y: 0, width: 200, height: 100 };

  it('вход правее выхода или чуть левее (до 10 px) — прямая связь', () => {
    expect(isBackward(source, { x: 440, y: 0 }, rect)).toBe(false);
    expect(isBackward(source, { x: 400, y: 0 }, rect)).toBe(false);
    expect(isBackward(source, { x: 390, y: 0 }, rect)).toBe(false);
  });

  it('блоки вплотную или внахлёст (вход над телом источника) — прямая связь', () => {
    // Эхо: «Ввод» шириной 213 стоит на x=200, следующий блок — на x=400
    expect(
      isBackward({ x: 417, y: 94 }, { x: 395, y: 94 }, { x: 200, y: 0, width: 213, height: 109 }),
    ).toBe(false);
  });

  it('вход левее всего блока-источника — связь назад', () => {
    expect(isBackward(source, { x: 150, y: 0 }, rect)).toBe(true);
    // Последний «Ввод» (x=600) возвращается в «Эхо» (вход x=395)
    expect(
      isBackward({ x: 797, y: 94 }, { x: 395, y: 94 }, { x: 600, y: 0, width: 192, height: 109 }),
    ).toBe(true);
  });

  it('петля на себя — связь назад', () => {
    expect(isBackward(source, { x: 194, y: 0 }, rect)).toBe(true);
  });

  it('блок ещё не измерен (прямоугольник шириной 0 у выхода) — назад только левее выхода больше чем на 10', () => {
    const fallback = { x: 400, y: -40, width: 0, height: 80 };
    expect(isBackward(source, { x: 395, y: 0 }, fallback)).toBe(false);
    expect(isBackward(source, { x: 389, y: 0 }, fallback)).toBe(true);
  });
});
