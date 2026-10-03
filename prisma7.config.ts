import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 does not load `.env` files automatically. We use Node's built-in
 * loader (Node >= 20.12) instead of adding a dotenv dependency, tolerating a
 * missing file so CI can inject real environment variables instead.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file present; rely on the ambient process environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
