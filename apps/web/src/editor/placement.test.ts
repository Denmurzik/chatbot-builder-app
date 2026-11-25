import { describe, expect, it } from 'vitest';
import {
  GRID_SIZE,
  NODE_HEIGHT,
  NODE_WIDTH,
  findFreePosition,
  findFreeSpot,
  placeNear,
  snapToGrid,
} from './placement';

type N = { position: { x: number; y: number }; selected?: boolean };

function intersects(a: N, b: { x: number; y: number }): boolean {
  return (
    a.position.x < b.x + NODE_WIDTH &&
    b.x < a.position.x + NODE_WIDTH &&
    a.position.y < b.y + NODE_HEIGHT &&
    b.y < a.position.y + NODE_HEIGHT
  );
}

describe('snapToGrid', () => {
  it('округляет координату к шагу сетки 20', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(9)).toBe(0);
    expect(snapToGrid(10)).toBe(20);
    expect(snapToGrid(37)).toBe(40);
    expect(snapToGrid(-11)).toBe(-20);
  });
});

describe('placeNear', () => {
  it('ставит новый блок справа от источника по сетке 20 без пересечения', () => {
    const source: N = { position: { x: 40, y: 80 } };
    const p = placeNear(source, [source]);
    expect(p.x).toBeGreaterThanOrEqual(source.position.x + NODE_WIDTH);
    expect(p.x % GRID_SIZE).toBe(0);
    expect(p.y % GRID_SIZE).toBe(0);
    expect(intersects(source, p)).toBe(false);
  });

  it('смещает вниз, если место справа занято', () => {
    const source: N = { position: { x: 0, y: 0 } };
    const first = placeNear(source, [source]);
    const second = placeNear(source, [source, { position: first }]);
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.x % GRID_SIZE).toBe(0);
    expect(second.y % GRID_SIZE).toBe(0);
    expect(intersects({ position: first }, second)).toBe(false);
  });
});

describe('findFreePosition', () => {
  it('без блоков центрирует новый блок с привязкой к сетке 20', () => {
    const p = findFreePosition([], { x: 500, y: 300 });
    expect(p).toEqual({
      x: snapToGrid(500 - NODE_WIDTH / 2),
      y: snapToGrid(300 - NODE_HEIGHT / 2),
    });
    expect(p.x % GRID_SIZE).toBe(0);
    expect(p.y % GRID_SIZE).toBe(0);
  });

  it('ставит блок справа от выбранного без пересечения и по сетке', () => {
    const nodes: N[] = [{ position: { x: 0, y: 0 }, selected: true }];
    const p = findFreePosition(nodes, { x: 0, y: 0 });
    expect(p.x).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect(p.x % GRID_SIZE).toBe(0);
    expect(p.y % GRID_SIZE).toBe(0);
    expect(intersects(nodes[0]!, p)).toBe(false);
  });

  it('при подряд добавленных блоках не накладывает их друг на друга', () => {
    const nodes: N[] = [{ position: { x: 0, y: 0 } }];
    for (let i = 0; i < 12; i += 1) {
      const p = findFreePosition(nodes, { x: 0, y: 0 });
      expect(p.x % GRID_SIZE).toBe(0);
      expect(p.y % GRID_SIZE).toBe(0);
      expect(nodes.some((n) => intersects(n, p))).toBe(false);
      nodes.push({ position: p });
    }
  });
});

describe('findFreeSpot', () => {
  it('занятое место сдвигает вниз по сетке, свободное оставляет как есть', () => {
    const occupied = [{ position: { x: 0, y: 0 }, measured: { width: 320, height: 160 } }];
    expect(findFreeSpot([], { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    const spot = findFreeSpot(occupied, { x: 20, y: 20 });
    expect(spot.x % 20).toBe(0);
    expect(spot.y % 20).toBe(0);
    expect(spot.y).toBeGreaterThanOrEqual(160 + 40);
  });
});
