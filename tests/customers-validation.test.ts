import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/lib/api/errors';
import {
  assignCustomerSchema,
  coerceCustomerListQuery,
  createCustomerSchema,
  customerNoteSchema,
  parseCustomerId,
  updateCustomerSchema,
} from '@/lib/customers/validation';

/**
 * CRM write contracts.
 *
 * These assertions pin the boundary between an untrusted request and the
 * database: what a client may set, what it may not, and how a form's `''` is
 * distinguished from "leave this field alone".
 */

const VALID_UUID = '018f6a2c-5b3c-7c1e-9a4d-2f7b8c9d0e1f';

describe('createCustomerSchema', () => {
  it('accepts a minimal customer and applies defaults', () => {
    const parsed = createCustomerSchema.parse({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' });

    expect(parsed.status).toBe('ACTIVE');
    expect(parsed.customerType).toBe('INDIVIDUAL');
  });

  it('trims names and lowercases the email', () => {
    const parsed = createCustomerSchema.parse({
      firstName: '  Ada  ',
      lastName: '  Lovelace ',
      email: '  Ada@Example.COM ',
    });

    expect(parsed.firstName).toBe('Ada');
    expect(parsed.email).toBe('ada@example.com');
  });

  it('treats an empty optional field as cleared rather than ""', () => {
    const parsed = createCustomerSchema.parse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '',
      companyName: '   ',
      notes: '',
    });

    expect(parsed.phone).toBeNull();
    expect(parsed.companyName).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('rejects a client that tries to set the owning organization', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      organizationId: '11111111-1111-4111-8111-111111111111',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a client that tries to archive through a status field', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      status: 'ARCHIVED',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown key instead of silently dropping it', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      archivedAt: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });

  it('does not mangle markup-shaped names, because output is escaped not filtered', () => {
    // Blocking characters like `<` would reject legitimate names while giving no
    // real protection: React escapes every interpolation, and no component
    // renders customer text as raw HTML (see the guard test below). Keeping the
    // value verbatim leaves the data honest and the rendering safe.
    const parsed = createCustomerSchema.parse({
      firstName: 'Ada <script>alert(1)</script>',
      lastName: "O'Brien-Smith",
      email: 'ada@example.com',
    });

    expect(parsed.firstName).toBe('Ada <script>alert(1)</script>');
    expect(parsed.lastName).toBe("O'Brien-Smith");
  });

  it.each([
    ['missing first name', { lastName: 'Lovelace', email: 'ada@example.com' }],
    ['blank first name', { firstName: '   ', lastName: 'Lovelace', email: 'ada@example.com' }],
    ['missing email', { firstName: 'Ada', lastName: 'Lovelace' }],
    ['malformed email', { firstName: 'Ada', lastName: 'Lovelace', email: 'not-an-email' }],
    [
      'unknown status',
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', status: 'DELETED' },
    ],
    [
      'non-uuid assignee',
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', assignedUserId: 'user-1' },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(createCustomerSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a phone containing letters', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: 'call me maybe',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a phone that is too short to be real', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '12',
    });

    expect(result.success).toBe(false);
  });

  it('accepts common international phone formats', () => {
    const result = createCustomerSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+44 (20) 7946-0958',
    });

    expect(result.success).toBe(true);
  });
});

describe('updateCustomerSchema', () => {
  it('accepts a partial patch', () => {
    expect(updateCustomerSchema.safeParse({ firstName: 'Augusta' }).success).toBe(true);
  });

  it('rejects an empty patch instead of silently doing nothing', () => {
    const result = updateCustomerSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Provide at least one field to update.');
  });

  it('rejects organizationId', () => {
    expect(
      updateCustomerSchema.safeParse({ organizationId: '11111111-1111-4111-8111-111111111111' })
        .success,
    ).toBe(false);
  });

  it('cannot be used to un-archive a customer', () => {
    expect(updateCustomerSchema.safeParse({ archivedAt: null }).success).toBe(false);
    expect(updateCustomerSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('assignCustomerSchema', () => {
  it('accepts null to unassign', () => {
    expect(assignCustomerSchema.safeParse({ assignedUserId: null }).success).toBe(true);
  });

  it('accepts a uuid', () => {
    expect(assignCustomerSchema.safeParse({ assignedUserId: VALID_UUID }).success).toBe(true);
  });

  it('requires the key to be present so clearing is explicit', () => {
    expect(assignCustomerSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an organizationId override', () => {
    expect(
      assignCustomerSchema.safeParse({
        assignedUserId: VALID_UUID,
        organizationId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });
});

describe('customerNoteSchema', () => {
  it('rejects an empty or whitespace-only note', () => {
    expect(customerNoteSchema.safeParse({ body: '' }).success).toBe(false);
    expect(customerNoteSchema.safeParse({ body: '   ' }).success).toBe(false);
  });

  it('accepts a normal note', () => {
    expect(customerNoteSchema.safeParse({ body: 'Renewal agreed.' }).success).toBe(true);
  });

  it('rejects a note beyond the cap', () => {
    expect(customerNoteSchema.safeParse({ body: 'x'.repeat(2_001) }).success).toBe(false);
  });
});

describe('parseCustomerId', () => {
  it('returns a well-formed uuid unchanged', () => {
    expect(parseCustomerId(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each([
    '',
    'not-a-uuid',
    '12345',
    '../../etc/passwd',
    "11111111-1111-4111-8111-111111111111' OR 1=1--",
    '11111111-1111-4111-8111-111111111111; DROP TABLE customers',
  ])('raises a ValidationError for %j', (value) => {
    expect(() => parseCustomerId(value)).toThrow(ValidationError);
  });
});

describe('coerceCustomerListQuery', () => {
  it('applies defaults for an empty query', () => {
    expect(coerceCustomerListQuery({})).toEqual({
      page: 1,
      limit: 20,
      search: undefined,
      status: undefined,
      type: undefined,
      assignedTo: undefined,
      includeArchived: false,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('falls back to the first page when the page number is nonsense', () => {
    expect(coerceCustomerListQuery({ page: 'banana' }).page).toBe(1);
    expect(coerceCustomerListQuery({ page: '-3' }).page).toBe(1);
  });

  it('caps the page size so one request cannot return the whole table', () => {
    expect(coerceCustomerListQuery({ limit: '5000' }).limit).toBe(20);
    expect(coerceCustomerListQuery({ limit: '50' }).limit).toBe(50);
  });

  it('splits comma-separated status and type filters', () => {
    const parsed = coerceCustomerListQuery({ status: 'ACTIVE,LEAD', type: 'BUSINESS' });

    expect(parsed.status).toEqual(['ACTIVE', 'LEAD']);
    expect(parsed.type).toEqual(['BUSINESS']);
  });

  it('drops unknown filter values rather than failing the page', () => {
    expect(coerceCustomerListQuery({ status: 'NOT_A_STATUS' }).status).toBeUndefined();
    expect(coerceCustomerListQuery({ sort: 'password' }).sort).toBe('createdAt');
    expect(coerceCustomerListQuery({ order: 'sideways' }).order).toBe('desc');
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads includeArchived=%s as %s', (input, expected) => {
    expect(coerceCustomerListQuery({ includeArchived: input }).includeArchived).toBe(expected);
  });

  it('collapses repeated params by taking the first value', () => {
    expect(coerceCustomerListQuery({ status: ['ACTIVE', 'LEAD'] }).status).toEqual(['ACTIVE']);
  });

  it('tolerates a null query object', () => {
    expect(coerceCustomerListQuery(undefined).page).toBe(1);
  });
});