import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const requireFromWeb = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Разрешаем пакеты @chatbot/<name> напрямую в исходники TypeScript
    alias: [
      // Тесты запускаются из корня монорепозитория — react ищем от apps/web
      ...['react', 'react-dom'].map((name) => ({
        find: new RegExp(`^${name}(/.*)?$`),
        replacement: `${path.dirname(requireFromWeb.resolve(`${name}/package.json`))}$1`,
      })),
      { find: /^@\//, replacement: `${path.resolve(currentDir, 'src')}/` },
      {
        find: /^@chatbot\/([^/]+)$/,
        replacement: path.resolve(currentDir, '../../packages/$1/src/index.ts'),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
  },
});
