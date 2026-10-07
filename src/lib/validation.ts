import { z } from 'zod';

import { toAppError, ValidationError, type FieldIssue } from '@/lib/api/errors';

/**
 * Password policy: length is the dominant factor, so we require length first.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[a-z]/, 'Password must include a lowercase letter.')
  .regex(/[A-Z]/, 'Password must include an uppercase letter.')
  .regex(/[0-9]/, 'Password must include a number.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

/**
 * Auth payloads are parsed with `.strict()`.
 *
 * Zod would otherwise silently strip unrecognised keys, which turns a
 * client mistake (or an attempt to smuggle a field such as `roleId` into a
 * registration) into a confusing no-op. Rejecting explicitly surfaces it as a
 * 422 and documents the exact accepted shape.
 */
export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
    email: emailSchema,
    password: passwordSchema,
    organizationName: z
      .string()
      .trim()
      .min(2, 'Organization name must be at least 2 characters.')
      .max(80),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    // Deliberately not `passwordSchema`: existing accounts must still be able
    // to sign in, and rejecting a valid login on policy grounds would leak
    // that policy to an attacker probing the endpoint.
    password: z.string().min(1, 'Password is required.').max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Reads an unknown request body, enforcing a size ceiling before parsing. */
export async function readJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const raw = await readRawBody(request, maxBytes);
  if (raw.trim().length === 0) {
    throw new ValidationError([{ path: '(body)', message: 'Request body must be valid JSON.' }]);
  }
  return JSON.parse(raw) as unknown;
}

/**
 * Like `readJsonBody`, but an absent body is `{}` instead of a 422.
 *
 * `DELETE` is the case that needs it: a client cancelling an order sends no
 * payload at all, while a payload that *is* sent still has to parse.
 */
export async function readOptionalJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const raw = (await readRawBody(request, maxBytes)).trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

/**
 * Enforces the size ceiling and confirms the body is JSON, returning it raw so
 * the two readers above can decide what an empty body means.
 */
async function readRawBody(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new ValidationError([{ path: '(body)', message: 'Request body is too large.' }]);
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new ValidationError([{ path: '(body)', message: 'Request body is too large.' }]);
  }

  try {
    JSON.parse(raw.trim().length === 0 ? 'null' : raw);
  } catch {
    throw new ValidationError([{ path: '(body)', message: 'Request body must be valid JSON.' }]);
  }

  return raw;
}

/** Parses `input` against `schema`, converting Zod issues into our error type. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues: FieldIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  throw new ValidationError(issues);
}

/** Narrows an unknown thrown value to a `ValidationError`. */
export function isValidationError(error: unknown): error is ValidationError {
  return toAppError(error).code === 'VALIDATION_FAILED';
}
