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
    // Database-backed suites issue dozens of real transactions, and a cold
    // Postgres on a busy machine can easily take longer than Vitest's 5s
    // default. An abandoned query is worse than a slow one: it leaves the
    // connection mid-protocol and fails the whole file in `afterAll`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Two database-backed files opening their own pools at the same time drive
    // the test connection into a protocol desync (Postgres 08P01), which shows
    // up as a failure in `beforeAll` of whichever file loses the race. Test
    // files therefore run one at a time: the suites are I/O bound anyway, so
    // this trades a little wall-clock time for a run that does not flake.
    fileParallelism: false,
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
