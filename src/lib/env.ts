import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Parsing is lazy and cached: Next.js evaluates route handlers and pages at
 * runtime, so importing this module must not throw during `next build` on a
 * machine that has no database credentials.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url('APP_URL must be a valid URL').default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters (generate with: openssl rand -base64 32)'),
  /**
   * Auth.js validates the incoming Host header against this. It defaults to true
   * because OpsFlow runs behind proxies (and on localhost) in every supported
   * environment; set it to `false` only when the app is reachable directly on a
   * host you fully control.
   */
  AUTH_TRUST_HOST: z.stringbool().default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  REDIS_URL: z.string().optional(),
});

export type ServerEnv = Readonly<z.infer<typeof serverEnvSchema>>;

/**
 * Public, non-sensitive variables that may be referenced by client components.
 * Never add secrets here — it is inlined into the browser bundle.
 */
export type PublicEnv = Readonly<{
  APP_NAME: string;
  APP_VERSION: string;
  APP_URL: string;
}>;

export class EnvironmentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super('Invalid server environment configuration');
    this.name = 'EnvironmentError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

let cached: ServerEnv | undefined;

/** Returns the validated server environment, or throws `EnvironmentError`. */
export function env(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvironmentError(formatIssues(parsed.error));
  }

  cached = Object.freeze(parsed.data);
  return cached;
}

/** Non-throwing variant for health checks and diagnostics. */
export function safeEnv(): { ok: true; env: ServerEnv } | { ok: false; problems: string[] } {
  const result = envSchemaResult();
  return result.ok ? { ok: true, env: result.env } : { ok: false, problems: result.problems };
}

function envSchemaResult(): { ok: true; env: ServerEnv } | { ok: false; problems: string[] } {
  try {
    return { ok: true, env: env() };
  } catch (error) {
    if (error instanceof EnvironmentError) return { ok: false, problems: [...error.problems] };
    return { ok: false, problems: ['Unknown environment error'] };
  }
}

export function publicEnv(): PublicEnv {
  return Object.freeze({
    APP_NAME: process.env['NEXT_PUBLIC_APP_NAME'] ?? 'OpsFlow',
    APP_VERSION: process.env['npm_package_version'] ?? '0.1.0',
    APP_URL: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
  });
}
