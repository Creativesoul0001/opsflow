import { created, route } from '@/lib/api/responses';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { registerWithOrganization } from '@/lib/services/auth.service';
import { parseOrThrow, readJsonBody, registerSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Account + organization registration.
 *
 * Creates the user, their first organization and the OWNER membership in a
 * single transaction. The caller is not signed in automatically — the client
 * redirects to `/login` so that sign-in stays on a single, rate-limited path.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  await enforceRateLimit({ name: 'auth:register', identifier: clientIp(request), limit: 5 });

  const body = parseOrThrow(registerSchema, await readJsonBody(request));
  const account = await registerWithOrganization(body);

  return created({
    userId: account.userId,
    email: account.email,
    organizationId: account.organizationId,
  });
});
