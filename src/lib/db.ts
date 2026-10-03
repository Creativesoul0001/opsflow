import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const log = logger.child('prisma');

/**
 * Prisma is created lazily on first property access.
 *
 * Two reasons: importing a module must not open a database connection (route
 * modules are imported during `next build` when collecting page data, and
 * opening a pool there would fail or leak), and a single client must be reused
 * across dev hot reloads or every edit would add another pool.
 */
let client: PrismaClient | undefined;
let poolConfig: { connectionString: string; max: number } | undefined;

function getClient(): PrismaClient {
  if (client) return client;

  const url = env().DATABASE_URL;
  // Cache the pool configuration so repeated instantiations reuse the same one.
  if (!poolConfig || poolConfig.connectionString !== url) {
    poolConfig = { connectionString: url, max: 10 };
  }

  // Only warn/error are surfaced, so the logger needs no `query`/`info` levels.
  const levels: Array<'warn' | 'error'> =
    env().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];

  const created = new PrismaClient({
    adapter: new PrismaPg(poolConfig),
    log: levels.map((level) => ({ emit: 'event' as const, level })),
  });

  for (const level of levels) {
    created.$on(level, (event) => log[level](event.message, { target: event.target }));
  }

  client = created;
  return created;
}

/**
 * A Proxy exposes the full Prisma model API while deferring construction until
 * the first real call.
 *
 * The target is only a placeholder; every lookup is forwarded to the lazily
 * created client. Reflect results are narrowed to `unknown` so no `any` leaks
 * out, and each method is bound to the real client so `this` stays correct
 * through the proxy.
 */
const proxyTarget: object = {};

export const db = new Proxy(proxyTarget, {
  get(_target, property): unknown {
    const instance: object = getClient();
    const value = Reflect.get(instance, property) as unknown;
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property): boolean {
    const instance: object = getClient();
    return Reflect.has(instance, property);
  },
}) as unknown as PrismaClient;
