import { ru } from '@/i18n/ru';

const t = ru.fieldInput;

// Описание оператора, литерала или вида переменной для панели справа от списка подсказок
export interface DocEntry {
  signature: string;
  description: string;
  example: string;
}

type DocKey = keyof typeof t.docs;

// Сигнатура и пример не переводятся: это запись на языке выражений (п. 2.5)
const SIGNATURES: Record<DocKey, { signature: string; example: string }> = {
  '==': { signature: 'a == b', example: 'name == "Аня"' },
  '!=': { signature: 'a != b', example: 'status != "ok"' },
  '<': { signature: 'a < b', example: 'tries < 3' },
  '<=': { signature: 'a <= b', example: 'tries <= 3' },
  '>': { signature: 'a > b', example: 'score > 10' },
  '>=': { signature: 'a >= b', example: 'score >= 10' },
  '&&': { signature: 'a && b', example: 'done && paid' },
  '||': { signature: 'a || b', example: 'done || skipped' },
  '!': { signature: '!a', example: '!done' },
  true: { signature: 'true', example: 'flag == true' },
  false: { signature: 'false', example: 'flag == false' },
  '+': { signature: 'a + b', example: 'tries + 1' },
  '-': { signature: 'a - b', example: 'total - 5' },
  '*': { signature: 'a * b', example: 'price * 2' },
  '/': { signature: 'a / b', example: 'total / 2' },
  '%': { signature: 'a % b', example: 'tries % 2' },
};

export function operatorDoc(label: string): DocEntry | undefined {
  if (!Object.prototype.hasOwnProperty.call(SIGNATURES, label)) return undefined;
  const key = label as DocKey;
  return { ...SIGNATURES[key], description: t.docs[key] };
}

// Строка про переменную: «из блока „…“, тестовое значение: …»
export function variableInfoText(
  source: string | undefined,
  testValue: string | undefined,
): string {
  const parts: string[] = [source === undefined ? t.variableInfo : t.fromBlock(source)];
  parts.push(testValue === undefined ? t.testValueNone : t.testValueIs(testValue));
  return parts.join(', ');
}

function line(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

// DOM для панели info подсказки CodeMirror
export function docNode(entry: DocEntry): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-doc';
  root.append(
    line('cm-doc-signature', entry.signature),
    line('cm-doc-description', entry.description),
    line('cm-doc-label', t.docExample),
    line('cm-doc-example', entry.example),
  );
  return root;
}

export function variableNode(name: string, text: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-doc';
  root.append(line('cm-doc-signature', name), line('cm-doc-description', text));
  return root;
}
