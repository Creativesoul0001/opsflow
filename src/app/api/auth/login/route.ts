import { NextResponse } from 'next/server';
import { signIn } from '@/lib/auth/config';

import { AuthenticationError } from '@/lib/api/errors';
import { route } from '@/lib/api/responses';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { parseOrThrow, readJsonBody, loginSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Credential sign-in.
 *
 * Runs on top of Auth.js so password verification, session issuance and cookie
 * handling stay inside the vetted library, while our endpoint adds the things
 * the platform needs: Zod validation, rate limiting and a consistent JSON
 * error envelope. Invalid credentials deliberately return the same 401 with the
 * same message whether the account is unknown, suspended or the password is
 * wrong.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  await enforceRateLimit({ name: 'auth:login', identifier: clientIp(request) });

  const body = parseOrThrow(loginSchema, await readJsonBody(request));

  try {
    await signIn('credentials', {
      email: body.email,
      password: body.password,
      redirect: false,
    });
  } catch (error) {
    // Auth.js signals bad credentials by throwing rather than returning null.
    if (error instanceof NextResponse) throw error;
    throw new AuthenticationError('That email and password combination is not valid.');
  }

  return NextResponse.json(
    { data: { redirectTo: '/dashboard' } },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
});
