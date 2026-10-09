import { describe, expect, it } from 'vitest';

import {
  buildProductOrderBy,
  buildProductWhere,
  buildStockMovementOrderBy,
  buildStockMovementWhere,
  buildWarehouseOrderBy,
  buildWarehouseWhere,
  isUuid,
} from '@/lib/inventory/query';
import type { AuthorizationContext } from '@/lib/rbac/guard';
import {
  productListQuerySchema,
  stockMovementQuerySchema,
  warehouseListQuerySchema,
} from '@/lib/inventory/validation';

/**
 * Tenant-scoped query construction for the Inventory module.
 *
 * These are the rules that decide *which rows a caller may see*, so they are
 * tested without a database on purpose: a mistake here would leak one
 * organization's stock to another, and a test that needs a live Postgres would
 * not exercise the boundary as precisely as an assertion on the `where` clause
 * itself.
 *
 * The property under test throughout is that **the organization comes from the
 * verified context, never from the input** — however hostile the query string.
 */

const ORG_A = '91000000-0000-4000-8000-000000000001';
const ORG_B = '91000000-0000-4000-8000-000000000002';

function context(organizationId = ORG_A): AuthorizationContext {
  return {
    userId: '82000000-0000-4000-8000-000000000001',
    email: 'owner@inventory.test',
    name: 'Owner',
    organizationId,
    organizationName: 'Test Org',
    roleKey: 'OWNER',
    roleName: 'Owner',
    permissions: new Set<string>(),
  } as AuthorizationContext;
}

describe('inventory query construction', () => {
  describe('isUuid', () => {
    it('accepts a canonical UUID and rejects anything else', () => {
      expect(isUuid(ORG_A)).toBe(true);
      expect(isUuid('not-a-uuid')).toBe(false);
      expect(isUuid('')).toBe(false);
      // A leading SQL fragment is never a valid id, so it can never be passed
      // through to the database as one.
      expect(isUuid("'; DROP TABLE inventory_stocks; --")).toBe(false);
    });
  });

  describe('buildProductWhere', () => {
    it('pins the organization from the context and defaults to unarchived', () => {
      const where = buildProductWhere(context(), productListQuerySchema.parse({}));

      expect(where.organizationId).toBe(ORG_A);
      expect(where).not.toHaveProperty('organizationId', ORG_B);
      expect(where.archivedAt).toBeNull();
    });

    it('ignores a malformed categoryId rather than passing it through', () => {
      const where = buildProductWhere(
        context(),
        productListQuerySchema.parse({ categoryId: 'nonsense' }),
      );

      expect(where.categoryId).toBeUndefined();
    });

    it('treats categoryId=none as the uncategorised filter', () => {
      const where = buildProductWhere(
        context(),
        productListQuerySchema.parse({ categoryId: 'none' }),
      );

      expect(where.categoryId).toBeNull();
    });

    it('accepts a valid categoryId, still scoped to the tenant', () => {
      const category = '71000000-0000-4000-8000-000000000009';
      const where = buildProductWhere(
        context(),
        productListQuerySchema.parse({ categoryId: category }),
      );

      expect(where.organizationId).toBe(ORG_A);
      expect(where.categoryId).toBe(category);
    });

    it('searches name, SKU and description without widening the tenant', () => {
      const where = buildProductWhere(context(), productListQuerySchema.parse({ search: 'cola' }));

      expect(where.organizationId).toBe(ORG_A);
      expect(where.OR).toHaveLength(3);
    });

    it('shows archived rows only when the caller asks for them', () => {
      const archived = buildProductWhere(
        context(),
        productListQuerySchema.parse({ status: 'ARCHIVED' }),
      );

      expect(archived.organizationId).toBe(ORG_A);
      expect(archived.archivedAt).toEqual({ not: null });
    });

    it('can never be steered to another organization by query input', () => {
      // The input type has no organization field at all, which is the point:
      // there is no key a caller could set to select a tenant.
      expect(Object.keys(productListQuerySchema.parse({}))).not.toContain('organizationId');

      const where = buildProductWhere(context(ORG_B), productListQuerySchema.parse({}));
      expect(where.organizationId).toBe(ORG_B);
    });
  });

  describe('buildWarehouseWhere', () => {
    it('pins the organization and defaults to active only', () => {
      const where = buildWarehouseWhere(context(), warehouseListQuerySchema.parse({}));

      expect(where.organizationId).toBe(ORG_A);
      expect(where.archivedAt).toBeNull();
    });

    it('searches name, code and city', () => {
      const where = buildWarehouseWhere(
        context(),
        warehouseListQuerySchema.parse({ search: 'mum' }),
      );

      expect(where.organizationId).toBe(ORG_A);
      expect(where.OR).toHaveLength(3);
    });
  });

  describe('buildStockMovementWhere', () => {
    it('pins the organization, which the ledger depends on', () => {
      const where = buildStockMovementWhere(context(), stockMovementQuerySchema.parse({}));

      expect(where.organizationId).toBe(ORG_A);
    });

    it('filters by type, product, warehouse, order and transfer', () => {
      const product = '71000000-0000-4000-8000-000000000001';
      const warehouse = '72000000-0000-4000-8000-000000000001';
      const order = '61000000-0000-4000-8000-000000000001';
      const transfer = '73000000-0000-4000-8000-000000000001';

      const where = buildStockMovementWhere(
        context(),
        stockMovementQuerySchema.parse({
          type: 'RECEIPT,ADJUSTMENT',
          productId: product,
          warehouseId: warehouse,
          orderId: order,
          transferId: transfer,
        }),
      );

      expect(where.organizationId).toBe(ORG_A);
      expect(where.type).toEqual({ in: ['RECEIPT', 'ADJUSTMENT'] });
      expect(where.productId).toBe(product);
      expect(where.warehouseId).toBe(warehouse);
      expect(where.orderId).toBe(order);
      expect(where.transferId).toBe(transfer);
    });

    it('drops a malformed orderId instead of passing it to the database', () => {
      const where = buildStockMovementWhere(
        context(),
        stockMovementQuerySchema.parse({ orderId: '../../admin' }),
      );

      expect(where.organizationId).toBe(ORG_A);
      expect(where.orderId).toBeUndefined();
    });

    it('never lets an orderId from another tenant into the query', () => {
      const where = buildStockMovementWhere(
        context(),
        stockMovementQuerySchema.parse({ orderId: ORG_B }),
      );

      // The id is a *filter* and the organization predicate still applies, so the
      // worst a forged id can achieve is an empty result set.
      expect(where.organizationId).toBe(ORG_A);
      expect(where.orderId).toBe(ORG_B);
    });
  });

  describe('ordering', () => {
    it('always appends a tiebreaker so paging cannot skip rows', () => {
      const orderBy = buildProductOrderBy('name', 'asc');

      expect(orderBy[0]).toEqual({ name: 'asc' });
      expect(orderBy[1]).toEqual({ id: 'asc' });
    });

    it('sorts warehouses by the requested column', () => {
      expect(buildWarehouseOrderBy('code', 'desc')[0]).toEqual({ code: 'desc' });
      expect(buildWarehouseOrderBy('createdAt', 'asc')[0]).toEqual({ createdAt: 'asc' });
    });

    it('sorts the ledger by date by default and by quantity on request', () => {
      expect(buildStockMovementOrderBy('createdAt', 'desc')[0]).toEqual({ createdAt: 'desc' });
      expect(buildStockMovementOrderBy('quantity', 'asc')[0]).toEqual({ quantity: 'asc' });
    });

    it('falls back to the createdAt sort for an unknown sort key', () => {
      expect(buildProductOrderBy('nonsense' as 'name', 'desc')[0]).toEqual({ createdAt: 'desc' });
    });
  });
});
