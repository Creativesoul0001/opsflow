import 'server-only';

import { compare, hash } from 'bcryptjs';

/**
 * bcrypt cost factor. 12 is the current interactive-login recommendation and
 * keeps a hash in the ~250 ms range on modern hardware. Raise it as hardware
 * improves; existing hashes remain verifiable because the cost is stored in
 * the hash string itself.
 */
const BCRYPT_COST = 12;

/** Produces a salted bcrypt hash. Never log or return the result to a client. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_COST);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` for malformed or missing hashes instead of throwing, so a
 * corrupted record cannot turn a failed login into a 500.
 */
export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await compare(plain, storedHash);
  } catch {
    return false;
  }
}
