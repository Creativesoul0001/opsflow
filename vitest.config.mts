import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

// Next.js loads `.env` for the app and the API routes, but Vitest runs outside
// that pipeline. Reading the same file here keeps tests from validating against
// a different environment than production — and lets DB-backed tests see
// DATABASE_URL instead of silently skipping.
const localEnv = loadEnv('test', projectRoot, '');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    env: localEnv,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/generated/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside the React Server Components graph. Unit
      // tests run in plain Node, so map it to an inert module.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
