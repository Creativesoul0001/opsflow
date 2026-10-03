import { signOut } from '@/lib/auth/config';

import { noContent, route } from '@/lib/api/responses';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Ends the current session and clears the session cookie. */
export const POST = route(async (request: Request): Promise<Response> => {
  await enforceRateLimit({ name: 'auth:logout', identifier: clientIp(request), limit: 30 });

  await signOut({ redirect: false });
  return noContent();
});
