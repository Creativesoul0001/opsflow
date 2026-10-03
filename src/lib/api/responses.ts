import { NextResponse } from 'next/server';

import { toAppError, type AppError, type ErrorCode } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const log = logger.child('api');

/** Uniform success envelope: `{ "data": ... }`. */
export interface SuccessBody<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Authenticated responses must never be cached by intermediaries.
  'cache-control': 'no-store',
} as const;

export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse<SuccessBody<T>> {
  return NextResponse.json(meta ? { data, meta } : { data }, {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export function created<T>(data: T): NextResponse<SuccessBody<T>> {
  return NextResponse.json({ data }, { status: 201, headers: JSON_HEADERS });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: JSON_HEADERS });
}

/**
 * Converts any thrown value into a safe JSON error response. Exposed messages
 * are forwarded; non-exposed errors are logged with their cause and replaced
 * with a generic message.
 */
export function toErrorResponse(error: unknown): NextResponse<ErrorBody> {
  const appError: AppError = toAppError(error);

  if (appError.expose) {
    if (appError.status >= 500) {
      log.error(appError.message, { code: appError.code, cause: appError.cause });
    } else {
      log.debug(appError.message, { code: appError.code, status: appError.status });
    }
  } else {
    log.error('Unhandled error escaped a route handler', {
      code: appError.code,
      cause: appError.cause,
      stack: appError.stack,
    });
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'An unexpected error occurred.',
      ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
    },
  };

  const headers: Record<string, string> = { ...JSON_HEADERS };
  if ('retryAfterSeconds' in appError && typeof appError.retryAfterSeconds === 'number') {
    headers['retry-after'] = String(appError.retryAfterSeconds);
  }

  return NextResponse.json(body, { status: appError.status, headers });
}

type RouteHandler<Context> = (request: Request, context: Context) => Promise<Response>;

/**
 * Wraps a route handler so thrown errors become consistent JSON responses
 * instead of Next.js's default HTML error page.
 */
export function route<Context = unknown>(handler: RouteHandler<Context>): RouteHandler<Context> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
