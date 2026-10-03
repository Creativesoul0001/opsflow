import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/lib/api/errors';
import {
  emailSchema,
  loginSchema,
  parseOrThrow,
  passwordSchema,
  readJsonBody,
  registerSchema,
} from '@/lib/validation';

const validPassword = 'Correct-Horse-9';

describe('emailSchema', () => {
  it('trims and lowercases valid addresses', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it.each(['', 'not-an-email', 'a@b', 'ada@ example.com'])('rejects %j', (input) => {
    expect(emailSchema.safeParse(input).success).toBe(false);
  });

  it('rejects addresses longer than the RFC 5321 limit', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts a compliant password', () => {
    expect(passwordSchema.safeParse(validPassword).success).toBe(true);
  });

  it.each([
    ['too short', 'Abcdefgh1'],
    ['no lowercase', 'ALL-CAPS-ONLY-9'],
    ['no uppercase', 'all-lower-case-9'],
    ['no digit', 'NoDigitsHereAtAll'],
  ])('rejects a password with %s', (_label, input) => {
    expect(passwordSchema.safeParse(input).success).toBe(false);
  });

  it('rejects absurdly long input', () => {
    expect(passwordSchema.safeParse(`${'a1A'.repeat(60)}`).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts any non-empty password so legacy credentials still sign in', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: 'short' });
    expect(result.success).toBe(true);
  });

  it('still requires a password to be present', () => {
    expect(loginSchema.safeParse({ email: 'ada@example.com', password: '' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    password: validPassword,
    organizationName: 'Analytical Engines Ltd',
  };

  it('normalises the payload', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('ada@example.com');
  });

  it('rejects unknown keys from the client', () => {
    const result = registerSchema.safeParse({ ...valid, roleId: 'attacker-chosen' });
    expect(result.success).toBe(false);
  });

  it('requires an organization name', () => {
    const { organizationName: _omitted, ...rest } = valid;
    expect(registerSchema.safeParse(rest).success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data when valid', () => {
    expect(parseOrThrow(loginSchema, { email: 'a@b.co', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
  });

  it('throws a ValidationError carrying one issue per failure', () => {
    try {
      parseOrThrow(registerSchema, { email: 'nope', password: 'weak' });
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const issues = (error as ValidationError).details as { issues: { path: string }[] };
      expect(issues.issues.length).toBeGreaterThan(0);
      expect(issues.issues.map((issue) => issue.path)).toContain('email');
    }
  });
});

describe('readJsonBody', () => {
  const requestWith = (body: string, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

  /** Field-level reasons live in `details`; the top-level message stays generic. */
  async function issueMessages(promise: Promise<unknown>): Promise<string[]> {
    try {
      await promise;
      throw new Error('expected readJsonBody to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const { issues } = (error as ValidationError).details as { issues: { message: string }[] };
      return issues.map((issue) => issue.message);
    }
  }

  it('parses a JSON object', async () => {
    await expect(readJsonBody(requestWith('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('rejects malformed JSON without echoing the payload back', async () => {
    const messages = await issueMessages(readJsonBody(requestWith('{oops')));
    expect(messages.join(' ')).toMatch(/valid JSON/i);
    expect(messages.join(' ')).not.toContain('oops');
  });

  it('rejects an oversized body from the declared header alone', async () => {
    const request = requestWith('{"a":1}', { 'content-length': '999999' });
    expect((await issueMessages(readJsonBody(request))).join(' ')).toMatch(/too large/i);
  });

  it('rejects an oversized body when content-length is absent or lying', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(200) });
    expect((await issueMessages(readJsonBody(requestWith(huge), 32))).join(' ')).toMatch(
      /too large/i,
    );
  });

  it('keeps the public error message free of internal detail', async () => {
    try {
      await readJsonBody(requestWith('{oops'));
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect((error as Error).message).toBe('The submitted data is invalid.');
    }
  });
});
