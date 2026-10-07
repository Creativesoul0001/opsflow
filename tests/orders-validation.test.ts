import { describe, expect, it } from 'vitest';
import type { ZodError, ZodType } from 'zod';

import { ValidationError, type FieldIssue } from '@/lib/api/errors';
import {
  assignOrderSchema,
  cancelOrderSchema,
  changeOrderStatusSchema,
  coerceOrderListQuery,
  createOrderSchema,
  orderLineSchema,
  orderNoteSchema,
  orderListQuerySchema,
  parseOrderId,
  updateOrderSchema,
} from '@/lib/orders/validation';

/**
 * The write contracts for Orders.
 *
 * Two properties are load-bearing and are asserted from every angle below:
 *
 *  * **strict** — a client cannot smuggle `organizationId`, `orderNumber`,
 *    `subtotal` or `total` into a payload, because those are server-derived;
 *  * **money is a string** — a decimal text amount, never a JSON number, so a
 *    form round-trips without a float.
 */

function zodIssues(error: unknown): { path: string; message: string }[] {
  return (error as ZodError).issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function parseIssues<T>(schema: ZodType<T>, input: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(input);
  return result.success ? [] : zodIssues(result.error);
}

function firstMessage<T>(schema: ZodType<T>, input: unknown): string {
  return parseIssues(schema, input)[0]?.message ?? '';
}

/** Every key a hostile client might try to supply instead of the server. */
const SERVER_DERIVED_KEYS = [
  'organizationId',
  'orderNumber',
  'subtotal',
  'discount_minor',
  'tax',
  'total',
  'status',
  'createdBy',
  'id',
];

function validItem() {
  return { productName: 'Consulting', quantity: 2, unitPrice: '125.50' };
}

function validCreate() {
  return { customerId: '11111111-1111-4111-8111-111111111111', items: [validItem()] };
}

describe('createOrderSchema is strict about server-derived fields', () => {
  it('accepts a minimal, well-formed payload', () => {
    const parsed = createOrderSchema.parse(validCreate());
    expect(parsed.items[0]).toMatchObject({ quantity: 2, unitPrice: '125.50' });
    expect(parsed.discount).toBeUndefined();
    expect(parsed.taxRate).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it.each(SERVER_DERIVED_KEYS)('rejects a client-supplied %s', (key) => {
    const result = createOrderSchema.safeParse({ ...validCreate(), [key]: 'anything' });

    expect(result.success).toBe(false);
    // Zod reports an unrecognized key against the *object* it appeared in, and
    // names the key in the message, so the message is what pins the cause.
    const issue = zodIssues(result.error)[0];
    expect(issue?.path).toBe('');
    expect(issue?.message).toContain(key);
    expect(issue?.message).toMatch(/unrecognized/i);
  });

  it('accepts no `status`, so an order can only be born pending', () => {
    expect(createOrderSchema.safeParse({ ...validCreate(), status: 'DELIVERED' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown customer id shape', () => {
    expect(firstMessage(createOrderSchema, { ...validCreate(), customerId: '42' })).toMatch(
      /not a valid id/i,
    );
  });

  it('requires at least one line item', () => {
    expect(firstMessage(createOrderSchema, { ...validCreate(), items: [] })).toMatch(
      /at least one line item/i,
    );
  });

  it('caps the line count so a payload cannot be unbounded', () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...validItem(),
      productName: `Item ${index}`,
    }));

    expect(firstMessage(createOrderSchema, { ...validCreate(), items })).toMatch(/at most 100/i);
  });

  it('treats an empty discount or tax rate as "none"', () => {
    const parsed = createOrderSchema.parse({ ...validCreate(), discount: '', taxRate: '' });
    expect(parsed.discount).toBeNull();
    expect(parsed.taxRate).toBeNull();
  });

  it('keeps money as text rather than a JSON number', () => {
    // A number would have to survive a float; the schema's job is to refuse it.
    expect(createOrderSchema.safeParse({ ...validCreate(), discount: 10 }).success).toBe(false);

    const parsed = createOrderSchema.parse({ ...validCreate(), discount: '10.00' });
    expect(parsed.discount).toBe('10.00');
  });

  it('coerces a numeric quantity sent as a string by a form', () => {
    const parsed = createOrderSchema.parse({
      ...validCreate(),
      items: [{ ...validItem(), quantity: '3' }],
    });

    expect(parsed.items[0]?.quantity).toBe(3);
    expect(typeof parsed.items[0]?.quantity).toBe('number');
  });

  it('rejects zero, fractional and over-large quantities', () => {
    expect(firstMessage(orderLineSchema, { ...validItem(), quantity: 0 })).toMatch(/at least 1/i);
    expect(firstMessage(orderLineSchema, { ...validItem(), quantity: 1.5 })).toMatch(
      /whole number/i,
    );
    expect(firstMessage(orderLineSchema, { ...validItem(), quantity: 1_000_001 })).toMatch(
      /at most/i,
    );
    expect(firstMessage(orderLineSchema, { ...validItem(), quantity: 'lots' })).toBeTruthy();
  });

  it('rejects a line with an empty name or a missing price', () => {
    expect(firstMessage(orderLineSchema, { ...validItem(), productName: '  ' })).toMatch(
      /required/i,
    );
    expect(firstMessage(orderLineSchema, { ...validItem(), unitPrice: '' })).toMatch(/required/i);
    expect(firstMessage(orderLineSchema, { ...validItem(), unitPrice: '  ' })).toMatch(/required/i);
    // A badly shaped amount such as "12,50" passes the *shape* check here and is
    // caught by `computeOrderTotals`, which owns every money rule in one place.
    expect(orderLineSchema.safeParse({ ...validItem(), unitPrice: '12,50' }).success).toBe(true);
  });

  it('rejects a non-uuid line product id', () => {
    expect(orderLineSchema.safeParse({ ...validItem(), productId: 'not-a-product' }).success).toBe(
      false,
    );
    expect(orderLineSchema.safeParse({ ...validItem(), productId: null }).success).toBe(true);
  });

  it('rejects line-level unknown keys too', () => {
    expect(orderLineSchema.safeParse({ ...validItem(), lineTotal: '250.00' }).success).toBe(false);
  });

  it('trims and caps notes', () => {
    const parsed = createOrderSchema.parse({ ...validCreate(), notes: '  deliver to the dock  ' });
    expect(parsed.notes).toBe('deliver to the dock');

    expect(firstMessage(createOrderSchema, { ...validCreate(), notes: 'x'.repeat(5_001) })).toMatch(
      /at most 5000/i,
    );
  });
});

describe('updateOrderSchema', () => {
  it('refuses an empty patch instead of treating it as a no-op', () => {
    expect(firstMessage(updateOrderSchema, {})).toMatch(/at least one field/i);
  });

  it('accepts a single money field', () => {
    expect(updateOrderSchema.parse({ taxRate: '5' })).toEqual({ taxRate: '5' });
  });

  it('accepts clearing the tax rate with an explicit null', () => {
    expect(updateOrderSchema.parse({ taxRate: null })).toEqual({ taxRate: null });
  });

  it('stays strict, so status and notes cannot sneak in here', () => {
    expect(updateOrderSchema.safeParse({ status: 'SHIPPED' }).success).toBe(false);
    expect(updateOrderSchema.safeParse({ notes: 'x' }).success).toBe(false);
  });

  it('still requires a valid customer id when it is being changed', () => {
    expect(firstMessage(updateOrderSchema, { customerId: 'nope' })).toMatch(/not a valid id/i);
  });
});

describe('operation schemas', () => {
  it('changes status through an explicit, closed enum', () => {
    expect(changeOrderStatusSchema.parse({ status: 'SHIPPED' })).toEqual({ status: 'SHIPPED' });
    expect(firstMessage(changeOrderStatusSchema, { status: 'ARCHIVED' })).toBeTruthy();
    expect(firstMessage(changeOrderStatusSchema, {})).toBeTruthy();
    expect(changeOrderStatusSchema.safeParse({ status: 'PENDING', note: 'x' }).success).toBe(false);
  });

  it('allows cancellation with no reason, and refuses unknown keys', () => {
    // An absent optional key stays absent; either shape means "no reason".
    expect(cancelOrderSchema.parse({}).reason ?? null).toBeNull();
    expect(cancelOrderSchema.parse({ reason: 'Customer changed their mind' })).toEqual({
      reason: 'Customer changed their mind',
    });
    expect(cancelOrderSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(cancelOrderSchema.parse({ reason: '   ' }).reason).toBeNull();
  });

  it('requires the assignment key so clearing is an explicit choice', () => {
    expect(firstMessage(assignOrderSchema, {})).toBeTruthy();
    expect(assignOrderSchema.parse({ assignedUserId: null })).toEqual({ assignedUserId: null });
    expect(assignOrderSchema.safeParse({ assignedUserId: 'someone-else' }).success).toBe(false);
    expect(assignOrderSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty note body after trimming', () => {
    expect(firstMessage(orderNoteSchema, { body: '   ' })).toMatch(/cannot be empty/i);
    expect(orderNoteSchema.parse({ body: ' Keep cold ' })).toEqual({ body: 'Keep cold' });
    expect(firstMessage(orderNoteSchema, { body: 'x'.repeat(2_001) })).toMatch(/at most 2000/i);
    expect(orderNoteSchema.safeParse({ body: 'x', author: 'Ada' }).success).toBe(false);
  });
});

describe('orderListQuerySchema', () => {
  it('defaults to the first page, newest first', () => {
    expect(orderListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
      search: undefined,
      status: undefined,
      customerId: undefined,
      assignedTo: undefined,
    });
  });

  it('falls back instead of failing on a mistyped page or limit', () => {
    for (const page of ['abc', '0', '-3', '99999999']) {
      expect(orderListQuerySchema.parse({ page }).page, page).toBe(1);
    }
    for (const limit of ['lots', '0', '1000']) {
      expect(orderListQuerySchema.parse({ limit }).limit, limit).toBe(20);
    }
    expect(orderListQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(orderListQuerySchema.parse({ limit: '1' }).limit).toBe(1);
  });

  it('falls back on an unknown sort or order rather than 422-ing the page', () => {
    expect(orderListQuerySchema.parse({ sort: 'totalSecrets' }).sort).toBe('createdAt');
    expect(orderListQuerySchema.parse({ order: 'sideways' }).order).toBe('desc');
    expect(orderListQuerySchema.parse({ sort: 'total', order: 'asc' })).toMatchObject({
      sort: 'total',
      order: 'asc',
    });
  });

  it('reads a comma-separated status list, tolerating spaces', () => {
    expect(orderListQuerySchema.parse({ status: 'PENDING' }).status).toEqual(['PENDING']);
    expect(orderListQuerySchema.parse({ status: 'PENDING,CONFIRMED' }).status).toEqual([
      'PENDING',
      'CONFIRMED',
    ]);
    expect(orderListQuerySchema.parse({ status: 'PENDING , SHIPPED' }).status).toEqual([
      'PENDING',
      'SHIPPED',
    ]);
    expect(orderListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });

  it('refuses an unknown status outright', () => {
    expect(orderListQuerySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });

  it('strips unknown keys such as tracking parameters', () => {
    const parsed = orderListQuerySchema.parse({
      organizationId: 'a-tenant-id',
      utm_source: 'newsletter',
      search: 'ada',
    });

    expect(Object.keys(parsed)).not.toContain('organizationId');
    expect(Object.keys(parsed)).not.toContain('utm_source');
    expect(parsed.search).toBe('ada');
  });
});

describe('coerceOrderListQuery', () => {
  it('builds usable defaults from an unusable URL', () => {
    const query = coerceOrderListQuery({ page: 'many', status: 'ARCHIVED', sort: 'chaos' });

    expect(query).toMatchObject({ page: 1, limit: 20, sort: 'createdAt', order: 'desc' });
    expect(query.status).toBeUndefined();
  });

  it('collapses repeated query keys to the first value', () => {
    expect(coerceOrderListQuery({ page: ['2', '7'], limit: ['50', '1'] })).toMatchObject({
      page: 2,
      limit: 50,
    });
  });

  it('keeps a good query intact', () => {
    expect(
      coerceOrderListQuery({ page: '3', search: 'ada', status: 'PENDING,CONFIRMED' }),
    ).toMatchObject({ page: 3, search: 'ada', status: ['PENDING', 'CONFIRMED'] });
  });

  it('never lets a client organizationId survive', () => {
    const parsed = coerceOrderListQuery({ organizationId: 'another-tenant' });
    expect('organizationId' in parsed).toBe(false);
  });

  it('handles null and undefined input', () => {
    expect(coerceOrderListQuery(null)).toMatchObject({ page: 1 });
    expect(coerceOrderListQuery(undefined)).toMatchObject({ page: 1 });
  });
});

describe('parseOrderId', () => {
  it('returns a well-formed id untouched', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseOrderId(id)).toBe(id);
  });

  it('turns a malformed id into a 422 rather than a driver error', () => {
    for (const bad of ['', 'nope', '1', '11111111-1111-4111-8111-1111111111111']) {
      let thrown: unknown;
      try {
        parseOrderId(bad);
      } catch (error) {
        thrown = error;
      }

      expect(thrown, bad).toBeInstanceOf(ValidationError);
      const issues: FieldIssue[] =
        (thrown as { details?: { issues?: FieldIssue[] } }).details?.issues ?? [];
      expect(issues[0]?.path).toBe('id');
    }
  });
});
