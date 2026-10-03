import { describe, expect, it } from 'vitest';

import {
  AppError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  ERROR_CODES,
  NotFoundError,
  RateLimitError,
  ValidationError,
  toAppError,
} from '@/lib/api/errors';
import { ZodError } from 'zod';

describe('error status and code mapping', () => {
  it.each([
    [new ValidationError([]), 422, ERROR_CODES.VALIDATION_FAILED],
    [new AuthorizationError(), 403, ERROR_CODES.FORBIDDEN],
    [new NotFoundError(), 404, ERROR_CODES.NOT_FOUND],
    [new ConflictError(), 409, ERROR_CODES.CONFLICT],
    [new RateLimitError(30), 429, ERROR_CODES.RATE_LIMITED],
  ])('maps %o to the expected status and code', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });
});

describe('toAppError', () => {
  it('passes AppError instances through unchanged', () => {
    const original = new NotFoundError('gone');
    expect(toAppError(original)).toBe(original);
  });

  it('converts a ZodError into field-level validation issues', () => {
    const zodError = new ZodError([
      { code: 'custom', path: ['email'], message: 'Enter a valid email address.' },
    ]);

    const mapped = toAppError(zodError);
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(mapped.status).toBe(422);
    expect(mapped.details).toEqual({
      issues: [{ path: 'email', message: 'Enter a valid email address.' }],
    });
  });

  it('maps a Prisma unique-constraint violation to a 409', () => {
    const mapped = toAppError({ code: 'P2002', meta: { target: ['email'] } });
    expect(mapped).toBeInstanceOf(ConflictError);
    expect(mapped.status).toBe(409);
  });

  it('maps a Prisma missing-record error to a 404', () => {
    expect(toAppError({ code: 'P2025' })).toBeInstanceOf(NotFoundError);
  });

  it('maps an unknown Prisma error to a non-exposed database error', () => {
    const mapped = toAppError({ code: 'P9999', message: 'relation "orders" does not exist' });
    expect(mapped).toBeInstanceOf(DatabaseError);
    expect(mapped.expose).toBe(false);
  });

  it('hides unexpected errors behind a generic, non-exposed error', () => {
    const boom = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    const mapped = toAppError(boom);

    expect(mapped.status).toBe(500);
    expect(mapped.expose).toBe(false);
    expect(mapped.message).not.toContain('10.0.0.5');
    expect(mapped.cause).toBe(boom);
  });

  it.each([['a string'], [42], [null], [undefined], [Symbol('x')]])(
    'normalises a thrown %s without leaking it',
    (thrown) => {
      const mapped = toAppError(thrown);
      expect(mapped).toBeInstanceOf(AppError);
      expect(mapped.expose).toBe(false);
    },
  );
});

describe('RateLimitError', () => {
  it('carries the retry delay for the Retry-After header', () => {
    expect(new RateLimitError(45).retryAfterSeconds).toBe(45);
  });
});
