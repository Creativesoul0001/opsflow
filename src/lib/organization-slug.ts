/**
 * Converts an organization name into a URL-safe slug.
 * Falls back to `org` when the name contains no alphanumeric characters.
 */
export function slugifyOrganizationName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  return slug || 'org';
}

/**
 * Produces a slug that `exists` reports as free.
 *
 * The clean slug is tried first so tenant URLs stay readable; only on a
 * collision do we fall back to a short random suffix. `randomUUID` is used
 * rather than `Math.random` because the value lands in a unique column and a
 * predictable suffix would let an attacker squat a tenant's likely slug.
 */
export async function generateUniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyOrganizationName(name);
  if (!(await exists(base))) return base;

  const { randomUUID } = await import('node:crypto');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomUUID().slice(0, 8)}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Astronomically unlikely; surfaces as a unique-constraint violation rather
  // than an infinite loop.
  throw new Error(`Unable to allocate a unique slug for organization "${name}"`);
}
