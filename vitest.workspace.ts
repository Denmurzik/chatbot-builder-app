import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineWorkspace } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Разрешение пакетов @chatbot/<name> напрямую в исходники для тестов
const workspaceAlias = [
  {
    find: /^@chatbot\/([^/]+)$/,
    replacement: path.resolve(rootDir, 'packages/$1/src/index.ts'),
  },
];

// SWC для сохранения метаданных декораторов NestJS DI в тестах api и engine
const nestSwcPlugin = () =>
  swc.vite({
    module: { type: 'es6' },
  });

export default defineWorkspace([
  {
    root: rootDir,
    test: {
      name: 'packages',
      environment: 'node',
      include: ['packages/*/src/**/*.test.ts', 'apps/mock-clinic/src/**/*.test.ts'],
      exclude: ['**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
    },
    resolve: {
      alias: workspaceAlias,
    },
  },
  {
    root: rootDir,
    plugins: [nestSwcPlugin()],
    test: {
      name: 'api',
      environment: 'node',
      include: ['apps/api/src/**/*.test.ts'],
      exclude: ['**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
    },
    resolve: {
      alias: workspaceAlias,
    },
  },
  {
    root: rootDir,
    plugins: [nestSwcPlugin()],
    test: {
      name: 'engine',
      environment: 'node',
      include: ['apps/engine/src/**/*.test.ts'],
      exclude: ['**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
    },
    resolve: {
      alias: workspaceAlias,
    },
  },
  {
    extends: './apps/web/vite.config.ts',
    root: rootDir,
    test: {
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./apps/web/src/test/setup.ts'],
      include: ['apps/web/src/**/*.test.{ts,tsx}'],
      exclude: ['**/*.int.test.{ts,tsx}', '**/node_modules/**', '**/dist/**'],
    },
    resolve: {
      alias: workspaceAlias,
    },
  },
  {
    root: rootDir,
    plugins: [nestSwcPlugin()],
    test: {
      name: 'integration',
      environment: 'node',
      include: [
        'packages/*/src/**/*.int.test.ts',
        'apps/*/src/**/*.int.test.ts',
        'apps/*/test/**/*.int.test.ts',
      ],
      exclude: ['**/node_modules/**', '**/dist/**'],
      fileParallelism: false,
      testTimeout: 30000,
    },
    resolve: {
      alias: workspaceAlias,
    },
  },
]);
