/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS-скрипт запуска */
// Запускает prisma с переменными из корневого .env (prisma читает .env только из cwd пакета)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Извлекает значение переменной: снимает кавычки или убирает inline-комментарий « #…»
function parseValue(raw) {
  const quoted = /^(['"])(.*)\1(?:\s+#.*)?$/.exec(raw);
  if (quoted) return quoted[2];
  return raw.replace(/(?:^|\s)#.*$/, '').trim();
}

// Минимальный разбор [export ]KEY=VALUE; уже заданные переменные окружения не перезаписываются
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = parseValue(match[2]);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnv(path.resolve(__dirname, '../../../.env'));

const bin = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});
process.exit(result.status ?? 1);
