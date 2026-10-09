import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { parseOrThrow } from '@/lib/validation';
import {
  createProductCategorySchema,
  createProductSchema,
  createWarehouseSchema,
  productListQuerySchema,
  stockAdjustmentSchema,
  stockReceiptSchema,
  stockTransferSchema,
} from '@/lib/inventory/validation';
import type { AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import {
  archiveProduct,
  archiveWarehouse,
  createProduct,
  createProductCategory,
  createWarehouse,
  getProduct,
  listProducts,
  updateProduct,
} from '@/lib/services/inventory.service';
import {
  adjustStock,
  listLowStock,
  receiveStock,
  transferStock,
} from '@/lib/services/stock.service';

/**
 * Inventory service behaviour against a real PostgreSQL database.
 *
 * The stock ledger is the one part of this module that a mock cannot test: the
 * claims being proved are about what Postgres returns when two transactions race
 * for the same row, about a unique index refusing a second deduction, and about
 * a transaction rolling back so the balance and the movement never disagree.
 *
 * Runs against a throwaway database per run and skips when `DATABASE_URL` is
 * absent, so `npm run verify` stays hermetic.
 */

const ENABLED = Boolean(process.env.DATABASE_URL);

/** Extracts the per-field messages from a `ValidationError`. */
function issues(error: unknown): Record<string, string> {
  const details = (error as { details?: { issues?: { path: string; message: string }[] } }).details;
  return Object.fromEntries((details?.issues ?? []).map((issue) => [issue.path, issue.message]));
}

/** Runs `operation`, expecting it to fail, and returns the error. */
async function failure(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail, but it succeeded.');
}

describe.skipIf(!ENABLED)('inventory service (database)', () => {
  const ORG_A = '91000000-0000-4000-8000-000000000011';
  const ORG_B = '91000000-0000-4000-8000-000000000012';
  const ORGS = [ORG_A, ORG_B];

  let ownerA: AuthorizationContext;
  let ownerB: AuthorizationContext;
  /** Holds read + create but no stock adjustment, transfer or archive. */
  let lookupA: AuthorizationContext;

  const userIds: string[] = [];

  /** A context that holds every permission. */
  function asOwner(organizationId: string, name: string): AuthorizationContext {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase()}-inventory@inventory.test`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'OWNER',
      roleName: 'Owner',
      permissions: new Set<string>(Object.values(PERMISSIONS)),
    } as AuthorizationContext;
  }

  /** A context with an explicit permission set, to test enforcement. */
  function asMember(
    organizationId: string,
    name: string,
    permissions: string[],
  ): AuthorizationContext {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase()}-inventory@inventory.test`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'EMPLOYEE',
      roleName: 'Employee',
      permissions: new Set<string>(permissions),
    } as AuthorizationContext;
  }

  async function addMember(
    organizationId: string,
    userId: string,
    email: string,
    name: string,
    roleKey: string,
  ) {
    await db.user.create({
      data: { id: userId, email, name, passwordHash: 'not-used-in-these-tests' },
    });

    const role = await db.role.findFirstOrThrow({ where: { key: roleKey } });
    await db.organizationMembership.create({
      data: { organizationId, userId, roleId: role.id },
    });

    return userId;
  }

  async function seedOrganization(
    id: string,
    name: string,
    userId: string,
    email: string,
    roleKey: string,
  ) {
    await db.organization.create({
      data: {
        id,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-8)}`,
      },
    });

    await addMember(id, userId, email, name, roleKey);
  }

  const productFor = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    // Parsed the way a route handler would: the service's contract is the
    // schema's *output*, and money has already become integer minor units.
    createProduct(
      context,
      parseOrThrow(createProductSchema, {
        sku: `SKU-${randomUUID().slice(0, 8)}`,
        name: `Product ${randomUUID().slice(0, 6)}`,
        unitPrice: '99.00',
        ...overrides,
      }),
    );

  /** Receipts are parsed too, so the service sees an integer quantity. */
  const receiptFor = (
    context: AuthorizationContext,
    productId: string,
    warehouseId: string,
    quantity: number,
  ) =>
    receiveStock(context, parseOrThrow(stockReceiptSchema, { productId, warehouseId, quantity }));

  const adjustmentFor = (
    context: AuthorizationContext,
    productId: string,
    warehouseId: string,
    quantity: number,
    reason: string,
  ) =>
    adjustStock(
      context,
      parseOrThrow(stockAdjustmentSchema, { productId, warehouseId, quantity, reason }),
    );

  const transferFor = (
    context: AuthorizationContext,
    productId: string,
    fromWarehouseId: string,
    toWarehouseId: string,
    quantity: number,
  ) =>
    transferStock(
      context,
      parseOrThrow(stockTransferSchema, { productId, fromWarehouseId, toWarehouseId, quantity }),
    );

  const productsFor = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    listProducts(context, productListQuerySchema.parse({ limit: 100, ...overrides }));

  /** Creates an active warehouse; the first one in an org becomes the primary. */
  const createWarehouseFor = (context: AuthorizationContext, label: string) =>
    createWarehouse(
      context,
      parseOrThrow(createWarehouseSchema, {
        code: `WH-${randomUUID().slice(0, 6)}`,
        name: label,
      }),
    );

  beforeAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: ORGS } } });
    await db.user.deleteMany({ where: { email: { endsWith: '@inventory.test' } } });

    ownerA = asOwner(ORG_A, 'Ada');
    ownerB = asOwner(ORG_B, 'Grace');
    lookupA = asMember(ORG_A, 'Lookup', [
      PERMISSIONS.INVENTORY_READ,
      PERMISSIONS.INVENTORY_PRODUCT_CREATE,
    ]);

    await seedOrganization(ORG_A, 'Inventory Harness A', ownerA.userId, ownerA.email, 'OWNER');
    await seedOrganization(ORG_B, 'Inventory Harness B', ownerB.userId, ownerB.email, 'OWNER');
    await addMember(ORG_A, lookupA.userId, lookupA.email, 'Lookup', 'EMPLOYEE');

    for (const context of [ownerA, ownerB, lookupA]) {
      await db.user.update({ where: { id: context.userId }, data: { name: context.name } });
    }

    userIds.push(ownerA.userId, ownerB.userId, lookupA.userId);
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: ORGS } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  });

  describe('SKU uniqueness', () => {
    it('allows the same SKU in two organizations but not within one', async () => {
      const sharedSku = `SHARED-${randomUUID().slice(0, 8)}`;

      await productFor(ownerA, { sku: sharedSku, name: 'A product' });

      // The same catalogue entry may legitimately exist in a second tenant.
      const inB = await productFor(ownerB, { sku: sharedSku, name: 'B product' });
      expect(inB.sku).toBe(sharedSku);

      const error = await failure(() => productFor(ownerA, { sku: sharedSku, name: 'Clash' }));

      expect(error).toBeInstanceOf(ValidationError);
      expect(issues(error)['sku']).toContain('already used');
    });

    it('updates the SKU without colliding with itself', async () => {
      const sku = `SELF-${randomUUID().slice(0, 8)}`;
      const product = await productFor(ownerA, { sku });

      // A no-op update to the same SKU must not look like a collision with
      // itself, which is what a unique constraint on the row's own value would
      // do if the write path did not exclude the record being updated.
      const updated = await updateProduct(ownerA, product.id, { sku });
      expect(updated.sku).toBe(sku);

      const renamed = `RENAMED-${randomUUID().slice(0, 6)}`;
      const moved = await updateProduct(ownerA, product.id, { sku: renamed });
      expect(moved.sku).toBe(renamed);
    });
  });

  describe('stock receipts and adjustments', () => {
    it('records a receipt and writes one movement', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Receipts');

      const movement = await receiptFor(ownerA, product.id, warehouse.id, 10);

      expect(movement.type).toBe('RECEIPT');
      expect(movement.quantity).toBe(10);
      expect(movement.quantityBefore).toBe(0);
      expect(movement.quantityAfter).toBe(10);

      const stock = await db.inventoryStock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      });

      expect(stock.quantity).toBe(10);
    });

    it('accumulates further receipts onto the same balance', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Accumulate');

      await receiptFor(ownerA, product.id, warehouse.id, 5);

      const second = await receiptFor(ownerA, product.id, warehouse.id, 7);

      expect(second.quantityBefore).toBe(5);
      expect(second.quantityAfter).toBe(12);
    });

    it('refuses an adjustment that would drive the balance negative', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Refuse');

      await receiptFor(ownerA, product.id, warehouse.id, 3);

      const error = await failure(() =>
        adjustStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: -4,
          reason: 'Counted short',
        }),
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(issues(error)['quantity']).toContain('Not enough stock');

      // The refused adjustment wrote no movement, so the balance never moved.
      const movements = await db.stockMovement.findMany({
        where: { productId: product.id, warehouseId: warehouse.id },
      });

      expect(movements).toHaveLength(1);
      expect(movements[0]?.quantityAfter).toBe(3);
    });

    it('records a negative adjustment with its reason on the ledger', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Negative');

      await receiptFor(ownerA, product.id, warehouse.id, 8);

      const movement = await adjustmentFor(
        ownerA,
        product.id,
        warehouse.id,
        -3,
        'Damaged in transit',
      );

      expect(movement.quantity).toBe(-3);
      expect(movement.quantityBefore).toBe(8);
      expect(movement.quantityAfter).toBe(5);
      expect(movement.reason).toBe('Damaged in transit');
    });

    it('refuses a receipt for another organization product', async () => {
      const product = await productFor(ownerB);
      const warehouse = await createWarehouseFor(ownerB, 'Foreign');

      const error = await failure(() =>
        receiveStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 1,
        }),
      );

      expect(error).toBeInstanceOf(ValidationError);
    });

    it('refuses a receipt into an archived warehouse', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Retired');

      // Archived through the service so the database invariant holding
      // "archivedAt and status move together" is respected, exactly as it would
      // be for a real member action.
      await archiveWarehouse(ownerA, warehouse.id);

      const error = await failure(() => receiptFor(ownerA, product.id, warehouse.id, 1));

      expect(error).toBeInstanceOf(ValidationError);
      expect(issues(error)['warehouseId']).toContain('archived');
    });
  });

  describe('transfers', () => {
    it('moves stock between two warehouses, writing both movements', async () => {
      const product = await productFor(ownerA);
      const from = await createWarehouseFor(ownerA, 'Transfer from');
      const to = await createWarehouseFor(ownerA, 'Transfer to');

      await receiptFor(ownerA, product.id, from.id, 20);

      const transfer = await transferFor(ownerA, product.id, from.id, to.id, 6);

      expect(transfer.quantity).toBe(6);
      expect(transfer.movements).toHaveLength(2);
      expect(transfer.movements[0]?.type).toBe('TRANSFER_OUT');
      expect(transfer.movements[0]?.quantity).toBe(-6);
      expect(transfer.movements[1]?.type).toBe('TRANSFER_IN');
      expect(transfer.movements[1]?.quantity).toBe(6);

      const balances = await db.inventoryStock.findMany({
        where: { productId: product.id },
      });
      const total = balances.reduce((sum, row) => sum + row.quantity, 0);

      // The organization's total stock is conserved by a transfer.
      expect(total).toBe(20);
    });

    it('refuses a transfer larger than the source balance', async () => {
      const product = await productFor(ownerA);
      const from = await createWarehouseFor(ownerA, 'Too small');
      const to = await createWarehouseFor(ownerA, 'Hoping');

      await receiptFor(ownerA, product.id, from.id, 4);

      const error = await failure(() => transferFor(ownerA, product.id, from.id, to.id, 5));

      expect(error).toBeInstanceOf(ValidationError);
      expect(issues(error)['quantity']).toContain('Not enough stock');

      // Nothing moved, and no movement row was written for either warehouse.
      expect(await db.stockMovement.count({ where: { productId: product.id } })).toBe(1);
    });

    it('refuses a transfer to a warehouse in another organization', async () => {
      const product = await productFor(ownerA);
      const from = await createWarehouseFor(ownerA, 'Ours');
      const foreign = await createWarehouseFor(ownerB, 'Theirs');

      await receiptFor(ownerA, product.id, from.id, 2);

      const error = await failure(() => transferFor(ownerA, product.id, from.id, foreign.id, 1));

      expect(error).toBeInstanceOf(ValidationError);
    });

    it('numbers transfers per organization in order', async () => {
      const product = await productFor(ownerA);
      const from = await createWarehouseFor(ownerA, 'Numbered from');
      const to = await createWarehouseFor(ownerA, 'Numbered to');

      await receiptFor(ownerA, product.id, from.id, 30);

      const first = await transferFor(ownerA, product.id, from.id, to.id, 1);
      const second = await transferFor(ownerA, product.id, from.id, to.id, 1);

      expect(first.number).toMatch(/^TR-\d{6}$/);
      expect(second.number > first.number).toBe(true);
    });
  });

  describe('concurrent stock updates', () => {
    it('never loses one of two simultaneous adjustments', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Race');

      await receiptFor(ownerA, product.id, warehouse.id, 100);

      // Two adjustments at once, each adding ten. Under a naive read-then-write
      // both would compute 110 and one would be lost.
      await Promise.all([
        adjustStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 10,
          reason: 'Count A',
        }),
        adjustStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 10,
          reason: 'Count B',
        }),
      ]);

      const movements = await db.stockMovement.findMany({
        where: { productId: product.id, type: 'ADJUSTMENT' },
      });

      // Both wrote a movement, and the ledger still replays to the balance.
      expect(movements).toHaveLength(2);

      const stock = await db.inventoryStock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      });

      expect(stock.quantity).toBe(120);
    });

    it('never lets two simultaneous adjustments under the same product lose one', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Race two');

      await receiptFor(ownerA, product.id, warehouse.id, 50);

      await Promise.all([
        adjustStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: -5,
          reason: 'Damage',
        }),
        adjustStock(ownerA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 5,
          reason: 'Restock',
        }),
      ]);

      const stock = await db.inventoryStock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      });

      expect(stock.quantity).toBe(50);
    });
  });

  describe('cross-organization access denial', () => {
    it('returns 404 for another organization product id', async () => {
      const product = await productFor(ownerB);

      const error = await failure(() => getProduct(ownerA, product.id));
      expect(error).toBeInstanceOf(NotFoundError);
    });

    it('never lists another organization products', async () => {
      const product = await productFor(ownerB, { sku: `FOREIGN-${randomUUID().slice(0, 8)}` });

      const { products } = await productsFor(ownerA);

      expect(products.find((row) => row.id === product.id)).toBeUndefined();
      expect(products.every((row) => row.id !== product.id)).toBe(true);
    });

    it('cannot archive another organization product', async () => {
      const product = await productFor(ownerB);

      const error = await failure(() => archiveProduct(ownerA, product.id));
      expect(error).toBeInstanceOf(NotFoundError);
    });
  });

  describe('RBAC enforcement', () => {
    it('refuses a product create without the permission', async () => {
      const reader = asMember(ORG_A, 'Bare', [PERMISSIONS.INVENTORY_READ]);

      await expect(productFor(reader)).rejects.toThrow(/does not allow/);
    });

    it('refuses a receipt without the stock permission', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Denied');

      await expect(
        receiveStock(lookupA, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 1,
        }),
      ).rejects.toThrow(/does not allow/);
    });

    it('refuses a transfer without the transfer permission', async () => {
      const product = await productFor(ownerA);
      const from = await createWarehouseFor(ownerA, 'Transfer denied from');
      const to = await createWarehouseFor(ownerA, 'Transfer denied to');

      await expect(transferFor(lookupA, product.id, from.id, to.id, 1)).rejects.toThrow(
        /does not allow/,
      );
    });
  });

  describe('low-stock reporting', () => {
    it('flags products at or below the threshold and nothing above it', async () => {
      const low = await productFor(ownerA, { reorderThreshold: 10 });
      const healthy = await productFor(ownerA, { reorderThreshold: 5 });
      const noThreshold = await productFor(ownerA, { reorderThreshold: 0 });

      const warehouse = await createWarehouseFor(ownerA, 'Levels');

      // Exactly at the threshold counts as low.
      await receiptFor(ownerA, low.id, warehouse.id, 10);
      await receiptFor(ownerA, healthy.id, warehouse.id, 6);
      // Never received at all: with a threshold of zero there is no reorder
      // point configured, so it is never reported as low.
      expect(noThreshold.reorderThreshold).toBe(0);

      const { rows } = await listLowStock(ownerA, { limit: 100 });

      const flagged = rows.map((row) => row.productId);
      expect(flagged).toContain(low.id);
      expect(flagged).not.toContain(healthy.id);
      expect(flagged).not.toContain(noThreshold.id);
    });

    it('reports a product with nothing anywhere as out of stock', async () => {
      const empty = await productFor(ownerA, { reorderThreshold: 5 });

      const { rows } = await listLowStock(ownerA, { limit: 100, level: 'out' });

      expect(rows.map((row) => row.productId)).toContain(empty.id);
    });
  });

  describe('archiving', () => {
    it('keeps the stock and its movements after archiving', async () => {
      const product = await productFor(ownerA);
      const warehouse = await createWarehouseFor(ownerA, 'Archive keeps');

      await receiptFor(ownerA, product.id, warehouse.id, 9);

      const archived = await archiveProduct(ownerA, product.id);

      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archivedAt).not.toBeNull();

      const stock = await db.inventoryStock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      });

      // The ledger and the balance survive an archive; nothing is destroyed.
      expect(stock.quantity).toBe(9);
    });

    it('refuses a second archive', async () => {
      const product = await productFor(ownerA);

      await archiveProduct(ownerA, product.id);

      const error = await failure(() => archiveProduct(ownerA, product.id));
      expect(error).toBeInstanceOf(ConflictError);
    });

    it('drops an archived product from the active picker but keeps it readable', async () => {
      // Created through the service so the payload is parsed the way a route
      // handler parses it; the category is only scaffolding for this assertion.
      const category = await createProductCategory(
        ownerA,
        parseOrThrow(createProductCategorySchema, {
          name: `Grouping ${randomUUID().slice(0, 6)}`,
        }),
      );

      const product = await productFor(ownerA, { categoryId: category.id });
      await archiveProduct(ownerA, product.id);

      const active = await productsFor(ownerA, { status: 'ACTIVE' });
      expect(active.products.find((row) => row.id === product.id)).toBeUndefined();

      // Still readable directly: archiving removes it from the catalogue, not
      // from the record the order lines and movements point at.
      const read = await getProduct(ownerA, product.id);
      expect(read.id).toBe(product.id);
    });
  });
});
