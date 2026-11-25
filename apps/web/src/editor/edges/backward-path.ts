export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Допуск: вход цели может быть левее выхода источника на столько пикселей и связь остаётся прямой
export const BACKWARD_TOLERANCE = 10;
const STUB = 24;
const DROP = 40;
const RADIUS = 8;

// Связь назад — только если вход цели левее выхода источника (с допуском) и левее всего
// блока-источника. Блоки вплотную или внахлёст (вход над телом источника) — прямая связь
export function isBackward(source: Point, target: Point, sourceRect: Rect): boolean {
  return target.x < source.x - BACKWARD_TOLERANCE && target.x < sourceRect.x;
}

// Ломаная с округлёнными углами: на каждом внутреннем изломе угол срезается дугой радиуса radius
function roundedPolyline(points: Point[], radius: number): string {
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const from = {
      x: corner.x - ((corner.x - prev.x) / inLen) * r,
      y: corner.y - ((corner.y - prev.y) / inLen) * r,
    };
    const to = {
      x: corner.x + ((next.x - corner.x) / outLen) * r,
      y: corner.y + ((next.y - corner.y) / outLen) * r,
    };
    d += ` L ${from.x} ${from.y} Q ${corner.x} ${corner.y} ${to.x} ${to.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

// Связь назад «как в n8n»: от выхода вправо, вниз под оба блока, влево, вверх и вправо в вход.
// Возвращает путь и точку подписи (середина нижнего отрезка)
export function backwardEdgePath(
  sourcePoint: Point,
  targetPoint: Point,
  sourceRect: Rect,
  targetRect: Rect,
): { path: string; labelX: number; labelY: number } {
  const bottom =
    Math.max(sourceRect.y + sourceRect.height, targetRect.y + targetRect.height) + DROP;
  const exitX = sourcePoint.x + STUB;
  const entryX = targetPoint.x - STUB;
  const points: Point[] = [
    sourcePoint,
    { x: exitX, y: sourcePoint.y },
    { x: exitX, y: bottom },
    { x: entryX, y: bottom },
    { x: entryX, y: targetPoint.y },
    targetPoint,
  ];
  return {
    path: roundedPolyline(points, RADIUS),
    labelX: (exitX + entryX) / 2,
    labelY: bottom,
  };
}
