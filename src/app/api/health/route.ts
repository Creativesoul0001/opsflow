import { NextResponse } from 'next/server';

import { ok } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { safeEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness / readiness probe.
 *
 * Returns 200 only when the process can reach Postgres with valid
 * configuration, so an orchestrator can use it as a readiness gate. Individual
 * checks are reported, but failure detail is limited to whether configuration
 * or connectivity is at fault — never the underlying message.
 */
export async function GET(): Promise<NextResponse> {
  const environment = safeEnv();

  if (!environment.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Service is not configured correctly.',
          details: { invalidVariables: environment.problems },
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const startedAt = performance.now();

  try {
    await db.$queryRaw`SELECT 1`;
    const databaseLatencyMs = Math.round(performance.now() - startedAt);

    return ok({
      status: 'ok',
      version: process.env['npm_package_version'] ?? '0.1.0',
      environment: environment.env.NODE_ENV,
      checks: { database: { status: 'up', latencyMs: databaseLatencyMs } },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Service is temporarily unavailable.',
          details: { checks: { database: { status: 'down' } } },
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
