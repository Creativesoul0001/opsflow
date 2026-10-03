import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { redact } from '@/lib/logger';
import { slugifyOrganizationName } from '@/lib/organization-slug';

describe('password hashing', () => {
  // Cost 12 is deliberately slow (~250ms per hash, and each verify is the same
  // order), so a handful of operations can exceed Vitest's 5s default on a busy
  // or slow machine. Keep the number of real hashes small and assert the
  // security properties that matter rather than timing them.
  const BCRYPT_TIMEOUT = 30_000;

  it(
    'produces a bcrypt hash rather than storing the password',
    async () => {
      const hash = await hashPassword('Correct-Horse-9');

      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      expect(hash).not.toContain('Correct-Horse-9');
    },
    BCRYPT_TIMEOUT,
  );

  it(
    'salts each hash so identical passwords differ',
    async () => {
      const [a, b] = await Promise.all([
        hashPassword('Correct-Horse-9'),
        hashPassword('Correct-Horse-9'),
      ]);
      expect(a).not.toBe(b);
    },
    BCRYPT_TIMEOUT,
  );

  it(
    'verifies the correct password and rejects a wrong one',
    async () => {
      const hash = await hashPassword('Correct-Horse-9');

      await expect(verifyPassword('Correct-Horse-9', hash)).resolves.toBe(true);
      await expect(verifyPassword('correct-horse-9', hash)).resolves.toBe(false);
      await expect(verifyPassword('', hash)).resolves.toBe(false);
    },
    BCRYPT_TIMEOUT,
  );

  it(
    'returns false rather than throwing for a missing or corrupt hash',
    async () => {
      await expect(verifyPassword('anything', '')).resolves.toBe(false);
      await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
    },
    BCRYPT_TIMEOUT,
  );
});

describe('log redaction', () => {
  it('masks secret-looking keys at the top level', () => {
    const output = redact({
      email: 'ada@example.com',
      password: 'hunter2',
      passwordHash: '$2b$12$abc',
      AUTH_SECRET: 'super-secret',
    }) as Record<string, unknown>;

    expect(output['email']).toBe('ada@example.com');
    expect(output['password']).toBe('[redacted]');
    expect(output['passwordHash']).toBe('[redacted]');
    expect(output['AUTH_SECRET']).toBe('[redacted]');
  });

  it('masks secrets nested inside objects and arrays', () => {
    const output = redact({ users: [{ token: 'abc' }] }) as { users: { token: string }[] };
    expect(output.users[0]?.token).toBe('[redacted]');
  });
});

describe('organization slugs', () => {
  it.each([
    ['Analytical Engines', 'analytical-engines'],
    ['  Ada & Co.  ', 'ada-co'],
    ['Café Numérique', 'cafe-numerique'],
    ['ALL CAPS', 'all-caps'],
    ['---', 'org'],
  ])('slugifies %j to %j', (input, expected) => {
    expect(slugifyOrganizationName(input)).toBe(expected);
  });

  it('never emits characters that would need URL escaping', () => {
    const slug = slugifyOrganizationName('Ünïcødé / Spaces & Symbols!?');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});
