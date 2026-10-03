import { handlers } from '@/lib/auth/config';

/**
 * Auth.js route handlers (session, csrf, providers, callbacks).
 * Credential sign-in and sign-out are exposed as REST endpoints under
 * `/api/auth/*`; this catch-all covers the remaining protocol routes.
 */
export const { GET, POST } = handlers;
