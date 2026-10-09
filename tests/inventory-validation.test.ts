import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/lib/api/errors';
import { parseOrThrow } from '@/lib/validation';
import {
  coerceProductListQuery,
  coerceStockMovementQuery,
  createProductSchema,
  createWarehouseSchema,
  parseProductId,
  stockAdjustmentSchema,
  stockReceiptSchema,
  stockTransferSchema,
  updateProductSchema,
} from '@/lib/inventory/validation';

/**
 * Input contracts for the Inventory module.
 *
 * The claims these tests prove are the ones the module's security rests on:
 * that a payload cannot set a server-derived field, that money is never parsed
 * through a float, that a receipt cannot be negative, and that a hand-edited URL
 * degrades to a usable page rather than an error screen.
 */

/** Extracts the per-field messages from a `ValidationError`. */
function issues(error: unknown): Record<string, string> {
  const details = (error as { details?: { issues?: { path: string; message: string }[] } }).details;
  return Object.fromEntries((details?.issues ?? []).map((issue) => [issue.path, issue.message]));
}

const uuid = '61000000-0000-4000-8000-000000000001';

/** Runs `schema.parse`, expecting it to fail, and returns the error. */
function parseFailure(schema: { parse: (input: unknown) => unknown }, input: unknown): unknown {
  try {
    schema.parse(input);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the parse to fail, but it succeeded.');
}

describe('inventory validation', () => {
  describe('createProductSchema', () => {
    it('accepts a complete product and converts money to minor units', () => {
      const input = createProductSchema.parse({
        sku: 'BEV-COLA-500',
        name: 'Cola 500ml',
        unitPrice: '12.50',
        costPrice: '8.75',
        reorderThreshold: '10',
        unit: 'pcs',
      });

      expect(input.sku).toBe('BEV-COLA-500');
      expect(input.unitPrice).toBe(1250);
      expect(input.costPrice).toBe(875);
      expect(input.reorderThreshold).toBe(10);
    });

    it('rejects server-derived fields, because stock is not set here', () => {
      expect(() =>
        createProductSchema.parse({
          sku: 'X',
          name: 'X',
          unitPrice: '1.00',
          stock: 500,
          totalStock: 5,
        }),
      ).toThrow();

      // A tenant id in the payload is refused rather than ignored.
      expect(
        parseFailure(createProductSchema, {
          sku: 'X',
          name: 'X',
          unitPrice: '1',
          organizationId: uuid,
          stock: 5,
        }),
      ).toBeInstanceOf(Error);
    });

    it('refuses an organizationId in the payload', () => {
      expect(() =>
        createProductSchema.parse({
          sku: 'X',
          name: 'X',
          unitPrice: '1.00',
          organizationId: uuid,
        }),
      ).toThrow();
    });

    it('rejects a malformed SKU', () => {
      for (const sku of ['', 'has space', 'a'.repeat(65), 'ok/bad']) {
        expect(() => createProductSchema.parse({ sku, name: 'X', unitPrice: '1' })).toThrow();
      }
    });

    it('accepts dots, dashes and underscores in a SKU', () => {
      expect(createProductSchema.parse({ sku: 'a.b-c_1', name: 'X', unitPrice: '1' }).sku).toBe(
        'a.b-c_1',
      );
    });

    it('rejects money that is not a plain decimal', () => {
      for (const unitPrice of ['-1', '1e3', '1,250', '0x10', 'abc', '1.234']) {
        expect(() => createProductSchema.parse({ sku: 'X', name: 'X', unitPrice })).toThrow();
      }
    });

    it('treats an empty cost price as "not tracked"', () => {
      const input = createProductSchema.parse({
        sku: 'X',
        name: 'X',
        unitPrice: '1',
        costPrice: '',
      });
      expect(input.costPrice).toBeNull();
    });

    it('defaults the unit and the threshold when omitted', () => {
      const input = createProductSchema.parse({ sku: 'X', name: 'X', unitPrice: '1' });

      expect(input.unit).toBeUndefined();
      expect(input.reorderThreshold).toBeUndefined();
    });

    it('rejects a negative or fractional reorder threshold', () => {
      expect(() =>
        createProductSchema.parse({ sku: 'X', name: 'X', unitPrice: '1', reorderThreshold: -1 }),
      ).toThrow();
      expect(() =>
        createProductSchema.parse({ sku: 'X', name: 'X', unitPrice: '1', reorderThreshold: 1.5 }),
      ).toThrow();
    });

    it('accepts a null category to mean uncategorised', () => {
      const input = createProductSchema.parse({
        sku: 'X',
        name: 'X',
        unitPrice: '1',
        categoryId: null,
      });

      expect(input.categoryId).toBeNull();
    });
  });

  describe('updateProductSchema', () => {
    it('accepts a partial update and treats an empty string as "not tracked"', () => {
      const input = updateProductSchema.parse({ name: 'Renamed', costPrice: '' });

      expect(input.name).toBe('Renamed');
      expect(input.costPrice).toBeNull();
    });

    it('refuses an empty update rather than no-op-ing', () => {
      expect(() => updateProductSchema.parse({})).toThrow();
    });
  });

  describe('stock operations', () => {
    it('requires a positive quantity for a receipt', () => {
      expect(() =>
        stockReceiptSchema.parse({ productId: uuid, warehouseId: uuid, quantity: 0 }),
      ).toThrow();
      expect(() =>
        stockReceiptSchema.parse({ productId: uuid, warehouseId: uuid, quantity: -5 }),
      ).toThrow();

      const input = stockReceiptSchema.parse({ productId: uuid, warehouseId: uuid, quantity: 5 });
      expect(input.quantity).toBe(5);
    });

    it('accepts a negative quantity for an adjustment but requires a reason', () => {
      const input = stockAdjustmentSchema.parse({
        productId: uuid,
        warehouseId: uuid,
        quantity: -3,
        reason: 'Counted 3 short',
      });

      expect(input.quantity).toBe(-3);

      // Parsed the way a route handler would, a missing reason is a field-level
      // validation error rather than an opaque Zod shape leaking to the client.
      const error = parseFailure(
        { parse: (input) => parseOrThrow(stockAdjustmentSchema, input) },
        {
          productId: uuid,
          warehouseId: uuid,
          quantity: -3,
        },
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(issues(error)).toHaveProperty('reason');
    });

    it('rejects a zero-quantity adjustment', () => {
      expect(() =>
        stockAdjustmentSchema.parse({
          productId: uuid,
          warehouseId: uuid,
          quantity: 0,
          reason: 'x',
        }),
      ).toThrow();
    });

    it('requires a transfer to move between two different warehouses', () => {
      expect(() =>
        stockTransferSchema.parse({
          productId: uuid,
          fromWarehouseId: uuid,
          toWarehouseId: uuid,
          quantity: 1,
        }),
      ).toThrow();

      const other = '62000000-0000-4000-8000-000000000001';
      const input = stockTransferSchema.parse({
        productId: uuid,
        fromWarehouseId: uuid,
        toWarehouseId: other,
        quantity: 1,
      });

      expect(input.fromWarehouseId).not.toBe(input.toWarehouseId);
    });

    it('refuses unexpected keys in a write payload', () => {
      expect(() =>
        stockReceiptSchema.parse({
          productId: uuid,
          warehouseId: uuid,
          quantity: 1,
          quantityAfter: 9999,
        }),
      ).toThrow();
    });
  });

  describe('warehouses', () => {
    it('requires a code and a name', () => {
      expect(() => createWarehouseSchema.parse({ code: 'WH-1' })).toThrow();
      expect(() => createWarehouseSchema.parse({ name: 'Main' })).toThrow();
    });

    it('validates the warehouse code shape', () => {
      expect(() => createWarehouseSchema.parse({ code: 'WH 1', name: 'Main' })).toThrow();
      expect(createWarehouseSchema.parse({ code: 'WH-1', name: 'Main' }).code).toBe('WH-1');
    });

    it('makes the whole address optional', () => {
      const input = createWarehouseSchema.parse({ code: 'WH-1', name: 'Main' });

      expect(input.addressLine1).toBeUndefined();
      expect(input.city).toBeUndefined();
    });
  });

  describe('route ids', () => {
    it('rejects a malformed path id before any database call', () => {
      expect(() => parseProductId('not-a-uuid')).toThrow(ValidationError);
      expect(parseProductId(uuid)).toBe(uuid);
    });
  });

  describe('forgiving list queries', () => {
    it('falls back to defaults for a hand-edited page number', () => {
      // A page number that cannot be parsed at all falls back to its default
      // rather than becoming an error screen the member cannot escape.
      expect(coerceProductListQuery({ page: 'nonsense' }).page).toBe(1);
      expect(coerceProductListQuery({ page: '-3' }).page).toBe(1);

      // A parseable number stays, even when it points past the last page: an
      // out-of-range page is an empty result, not a 422.
      expect(coerceProductListQuery({ page: '9999' }).page).toBe(9999);

      expect(coerceProductListQuery({ limit: '9999' }).limit).toBe(20);
      expect(coerceProductListQuery({ limit: '0' }).limit).toBe(20);
      expect(coerceProductListQuery({ limit: '25' }).limit).toBe(25);
    });

    it('strips unknown keys instead of erroring on them', () => {
      const query = coerceProductListQuery({ page: '2', tracking: 'fbclid=xyz' });

      expect(query.page).toBe(2);
      expect(query).not.toHaveProperty('tracking');
    });

    it('coerces the ledger type filter into a list', () => {
      const query = coerceStockMovementQuery({ type: 'RECEIPT,ADJUSTMENT' });

      expect(query.type).toEqual(['RECEIPT', 'ADJUSTMENT']);
    });

    it('drops an unrecognised movement type rather than matching nothing', () => {
      const query = coerceStockMovementQuery({ type: 'NOT_A_TYPE' });

      expect(query.type).toBeUndefined();
    });

    it('accepts ?stock=low and ?stock=out', () => {
      expect(coerceProductListQuery({ stock: 'low' }).stock).toBe('low');
      expect(coerceProductListQuery({ stock: 'out' }).stock).toBe('out');
      expect(coerceProductListQuery({ stock: 'bogus' }).stock).toBe('all');
    });
  });
});
