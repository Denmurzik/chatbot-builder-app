// Разбор и извлечение данных по подмножеству jsonPath из п. 2.7:
// путь    := "$" сегмент*
// сегмент := "." имя | "[" целое "]" | "['" строка "']"

const IDENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*/;
const INDEX_REGEX = /^[0-9]+/;

// Разбирает строку jsonPath на последовательность ключей (string) и индексов массива (number)
export function parseJsonPath(path: string): (string | number)[] {
  if (!path.startsWith('$')) {
    throw new Error(`Некорректный jsonPath "${path}": путь должен начинаться с "$"`);
  }

  const segments: (string | number)[] = [];
  let i = 1;

  while (i < path.length) {
    const ch = path[i];

    if (ch === '.') {
      i += 1;
      const match = IDENT_REGEX.exec(path.slice(i));
      if (!match) {
        throw new Error(`Некорректный jsonPath "${path}": ожидалось имя поля на позиции ${i}`);
      }
      segments.push(match[0]);
      i += match[0].length;
      continue;
    }

    if (ch === '[') {
      i += 1;
      if (i >= path.length) {
        throw new Error(`Некорректный jsonPath "${path}": незакрытая скобка "["`);
      }

      if (path[i] === "'") {
        // Строковый ключ вида ['clinic-id']
        i += 1;
        let key = '';
        let closed = false;
        while (i < path.length) {
          const curr = path[i];
          if (curr === '\\' && i + 1 < path.length) {
            key += path[i + 1];
            i += 2;
            continue;
          }
          if (curr === "'") {
            closed = true;
            i += 1;
            break;
          }
          key += curr;
          i += 1;
        }
        if (!closed || path[i] !== ']') {
          throw new Error(
            `Некорректный jsonPath "${path}": ожидалось закрытие "']" на позиции ${i}`,
          );
        }
        i += 1;
        segments.push(key);
        continue;
      }

      // Целочисленный индекс массива вида [0]
      const indexMatch = INDEX_REGEX.exec(path.slice(i));
      if (!indexMatch || path[i + indexMatch[0].length] !== ']') {
        throw new Error(
          `Некорректный jsonPath "${path}": неподдерживаемый сегмент скобок на позиции ${i}`,
        );
      }
      segments.push(Number(indexMatch[0]));
      i += indexMatch[0].length + 1;
      continue;
    }

    throw new Error(`Некорректный jsonPath "${path}": неожиданный символ "${ch}" на позиции ${i}`);
  }

  return segments;
}

// Извлекает значение из разобранного JSON по пути jsonPath
export function extract(
  json: unknown,
  path: string,
): { found: true; value: unknown } | { found: false } {
  const segments = parseJsonPath(path);
  let current: unknown = json;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { found: false };
    }

    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return { found: false };
      }
      current = current[segment];
    } else {
      if (
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return { found: false };
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return { found: true, value: current };
}

// Преобразует извлечённое JSON-значение в строку для сохранения в переменную диалога (п. 2.7)
export function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
