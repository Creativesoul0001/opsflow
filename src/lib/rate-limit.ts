import { RateLimitError } from '@/lib/api/errors';
import { env } from '@/lib/env';

/**
 * Fixed-window rate limiting.
 *
 * Phase 1 ships a single-process in-memory store. `RateLimitStore` is the
 * seam for a shared Redis implementation when OpsFlow runs more than one
 * instance; until then, limits apply per process rather than cluster-wide,
 * which is documented in README under "Known limitations".
 */
export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

interface Window {
  count: number;
  resetAt: number;
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();

  /** Not `async`: the interface is async so a Redis store can drop in later. */
  hit(key: string, limit: number, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, fresh);
      this.evict(now);
      return Promise.resolve(fresh);
    }

    existing.count += 1;
    return Promise.resolve(existing);
  }

  /** Drops expired windows so a long-running process cannot leak memory. */
  private evict(now: number): void {
    if (this.windows.size < 1_000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

let store: RateLimitStore | undefined;

function getStore(): RateLimitStore {
  store ??= new MemoryRateLimitStore();
  return store;
}

export interface RateLimitOptions {
  /** Stable bucket name, e.g. `auth:login`. */
  name: string;
  /** Unique subject, usually an IP address or a user id. */
  identifier: string;
  limit?: number;
  windowMs?: number;
}

/**
 * Records a hit and throws `RateLimitError` once the limit is exceeded.
 * Bypassed entirely when `RATE_LIMIT_ENABLED=false`, which is useful for
 * local load testing but must not be set in production.
 */
export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  const config = env();
  if (!config.RATE_LIMIT_ENABLED) return;

  const limit = options.limit ?? config.RATE_LIMIT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const { count, resetAt } = await getStore().hit(
    `${options.name}:${options.identifier}`,
    limit,
    windowMs,
  );

  if (count > limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
  }
}

/** Best-effort client IP from proxy headers. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}
