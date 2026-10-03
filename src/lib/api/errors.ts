import { z } from 'zod';

/**
 * Machine-readable error codes. Clients branch on these rather than on HTTP
 * status alone, so they stay stable even if a status is retuned.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * Base class for every error we deliberately surface. `expose` controls whether
 * `message` and `details` may be sent to the client; anything not exposed is
 * logged server-side and replaced with a generic message.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { expose?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.expose = options.expose ?? true;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(issues: readonly FieldIssue[]) {
    super(ERROR_CODES.VALIDATION_FAILED, 422, 'The submitted data is invalid.', {
      details: { issues },
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication is required.') {
    super(ERROR_CODES.UNAUTHENTICATED, 401, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super(ERROR_CODES.FORBIDDEN, 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(ERROR_CODES.NOT_FOUND, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource already exists.') {
    super(ERROR_CODES.CONFLICT, 409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(ERROR_CODES.RATE_LIMITED, 429, 'Too many requests. Please try again shortly.', {
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }

  readonly retryAfterSeconds: number;
}

export class DatabaseError extends AppError {
  constructor(message = 'A database error occurred.', cause?: unknown) {
    super(ERROR_CODES.DATABASE_ERROR, 500, message, { expose: false, cause });
  }
}

/**
 * Prisma error shapes we can map without importing the runtime (keeps this
 * module dependency-free and unit-testable). Unknown members are handled
 * structurally, since the generated error classes are not exported publicly.
 */
interface PrismaLikeError {
  name?: string;
  code?: string;
  meta?: { target?: unknown; field_name?: unknown };
}

function isPrismaLikeError(error: unknown): error is PrismaLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as PrismaLikeError).code === 'string'
  );
}

/**
 * Normalizes any thrown value into an `AppError`.
 *
 * Anything unrecognised becomes a non-exposed `InternalError`, guaranteeing
 * that stack traces, SQL fragments and driver messages never reach a client.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof z.ZodError) {
    return new ValidationError(
      error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  if (isPrismaLikeError(error)) {
    const code = error.code ?? '';

    if (code === 'P2002') return new ConflictError('A record with these values already exists.');
    if (code === 'P2025') return new NotFoundError();
    if (code === 'P2003')
      return new ValidationError([
        { path: '(root)', message: 'A referenced record does not exist.' },
      ]);

    return new DatabaseError('A database error occurred.', error);
  }

  return new AppError(ERROR_CODES.INTERNAL_ERROR, 500, 'An unexpected error occurred.', {
    expose: false,
    cause: error,
  });
}
