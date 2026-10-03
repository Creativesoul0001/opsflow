import 'server-only';

import { env } from '@/lib/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys whose values must never reach the log sink.
 *
 * Matching is case- and separator-insensitive, so `AUTH_SECRET`, `authSecret`
 * and `auth-secret` are all treated as the same key — otherwise a differently
 * styled variable name would leak a secret past the filter.
 */
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authsecret',
  'authorization',
  'cookie',
  'setcookie',
  'sessiontoken',
  'connectionstring',
  'databaseurl',
  'apikey',
]);

const REDACTED = '[redacted]';

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 4) return '[max-depth]';
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));
  if (!isRecord(input)) return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = isRedactedKey(key) ? REDACTED : redact(value, depth + 1);
  }
  return out;
}

function minimumLevel(): Level | 'silent' {
  const level = env().LOG_LEVEL;
  return level;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function build(scope?: string): Logger {
  function write(level: Level, message: string, context?: Record<string, unknown>): void {
    const min = minimumLevel();
    if (min === 'silent') return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[min]) return;

    const safeContext = context ? (redact(context) as Record<string, unknown>) : undefined;
    const payload = {
      level,
      time: new Date().toISOString(),
      ...(scope ? { scope } : {}),
      message,
      ...(safeContext ?? {}),
    };

    // Structured JSON keeps production logs machine-parseable; development gets
    // a compact line that is easier to eyeball.
    const line =
      process.env['NODE_ENV'] === 'production'
        ? JSON.stringify(payload)
        : `${payload.time} ${level.toUpperCase().padEnd(5)} ${scope ? `[${scope}] ` : ''}${message}${
            safeContext && Object.keys(safeContext).length > 0
              ? ` ${JSON.stringify(safeContext)}`
              : ''
          }`;

    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  return {
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    child: (childScope) => build(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const logger = build();
