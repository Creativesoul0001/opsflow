import 'server-only';

import NextAuth, { type NextAuthConfig, type Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { verifyPassword } from '@/lib/auth/password';

const log = logger.child('auth');

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

/**
 * Auth.js credentials sign-in.
 *
 * On success we return a minimal identifier set. Organization membership and
 * permissions are deliberately *not* placed in the JWT: they change during a
 * session, and every org-scoped request re-reads them from Postgres (see
 * `loadAuthorizationContext`). This keeps session tokens small and makes
 * revocation immediate.
 */
async function authorize(rawCredentials: unknown) {
  const parsed = credentialsSchema.safeParse(rawCredentials);
  if (!parsed.success) return null;

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true, passwordHash: true, status: true },
  });

  // Always run a verification so that a missing account and a wrong password
  // take comparable time, reducing user-enumeration signal.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin',
  );

  if (!user || !passwordOk) {
    log.warn('Failed sign-in attempt', { email: parsed.data.email });
    return null;
  }

  if (user.status !== 'ACTIVE') {
    log.warn('Sign-in blocked for suspended user', { userId: user.id });
    return null;
  }

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Auth.js configuration.
 *
 * Built inside a function rather than at module scope so that importing this
 * module (which route modules do during `next build`) does not require runtime
 * secrets to be present.
 */
function buildConfig(): NextAuthConfig {
  return {
    secret: env().AUTH_SECRET,
    // Credentials is an unmanaged provider, so sessions are stateless JWTs
    // sealed in an httpOnly cookie. No session table is required.
    session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
    pages: { signIn: '/login', error: '/login' },
    trustHost: env().AUTH_TRUST_HOST,
    providers: [
      Credentials({
        name: 'Email and password',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        authorize,
      }),
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user) {
          token['userId'] = user.id;
          token['email'] = user.email ?? token.email;
          token['name'] = user.name ?? token.name;
        }
        return token;
      },
      session({ session, token }) {
        const userId = token['userId'];
        // Narrow the JWT value rather than stringifying blindly: a tampered or
        // legacy token must not yield "[object Object]" as a user id.
        if (typeof userId === 'string' && userId.length > 0) {
          session.user.id = userId;
        }
        return session;
      },
    },
  };
}

type AuthInstance = ReturnType<typeof NextAuth>;

let instance: AuthInstance | undefined;

function getAuth(): AuthInstance {
  instance ??= NextAuth(buildConfig());
  return instance;
}

/**
 * Thin lazy delegates.
 *
 * These mirror the library signatures rather than forwarding a spread, because
 * `auth` is an overloaded function whose overloads TypeScript cannot resolve
 * through `(...args) => target(...args)`.
 */

/** Reads the current session. Returns `null` when signed out. */
export async function auth(): Promise<Session | null> {
  return await getAuth().auth();
}

type SignInOptions = { redirectTo?: string; redirect?: boolean } & Record<string, unknown>;

/** Signs in with a provider. The return value is a redirect URL we discard. */
export async function signIn(
  provider?: string,
  options?: FormData | SignInOptions,
  authorizationParams?: string[][] | Record<string, string> | string | URLSearchParams,
): Promise<unknown> {
  return await getAuth().signIn(provider, options, authorizationParams);
}

/** Invalidates the session and clears its cookie. */
export async function signOut(options?: {
  redirectTo?: string;
  redirect?: boolean;
}): Promise<unknown> {
  return await getAuth().signOut(options);
}

/**
 * Auth.js route handlers, resolved lazily for the same reason. The signature
 * mirrors the library's own `AppRouteHandlers`: one `NextRequest` in, one
 * `Response` out.
 */
export const handlers: {
  GET: (req: NextRequest) => Promise<Response>;
  POST: (req: NextRequest) => Promise<Response>;
} = {
  GET: (req) => getAuth().handlers.GET(req),
  POST: (req) => getAuth().handlers.POST(req),
};
