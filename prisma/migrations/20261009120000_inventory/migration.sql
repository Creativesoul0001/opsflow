-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'ORDER_DEDUCTION', 'ORDER_RELEASE');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "cost_price" INTEGER,
    "reorder_threshold" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stocks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_sequences" (
    "organization_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_sequences_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "notes" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "reason" TEXT,
    "order_id" UUID,
    "transfer_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_name_key" ON "product_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "product_categories_organization_id_archived_at_idx" ON "product_categories"("organization_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "products_organization_id_status_idx" ON "products"("organization_id", "status");

-- CreateIndex
CREATE INDEX "products_organization_id_category_id_idx" ON "products"("organization_id", "category_id");

-- CreateIndex
CREATE INDEX "products_organization_id_name_idx" ON "products"("organization_id", "name");

-- CreateIndex
CREATE INDEX "products_organization_id_created_at_idx" ON "products"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_status_idx" ON "warehouses"("organization_id", "status");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_is_primary_idx" ON "warehouses"("organization_id", "is_primary");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocks_product_id_warehouse_id_key" ON "inventory_stocks"("product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_stocks_organization_id_product_id_idx" ON "inventory_stocks"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_stocks_organization_id_warehouse_id_idx" ON "inventory_stocks"("organization_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_stocks_product_id_quantity_idx" ON "inventory_stocks"("product_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_number_key" ON "stock_transfers"("organization_id", "number");

-- CreateIndex
CREATE INDEX "stock_transfers_organization_id_created_at_idx" ON "stock_transfers"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_organization_id_from_warehouse_id_idx" ON "stock_transfers"("organization_id", "from_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_organization_id_to_warehouse_id_idx" ON "stock_transfers"("organization_id", "to_warehouse_id");

-- CreateIndex
-- Idempotency guard for order integration: at most one ORDER_DEDUCTION and one
-- ORDER_RELEASE per product per warehouse per order. A NULL `order_id` never
-- conflicts with another NULL, so receipts and manual adjustments stay unlimited.
CREATE UNIQUE INDEX "stock_movements_order_product_warehouse_type_key" ON "stock_movements"("order_id", "product_id", "warehouse_id", "type");

-- CreateIndex
-- Same guard for transfers: at most one TRANSFER_OUT and one TRANSFER_IN per
-- product per warehouse per transfer.
CREATE UNIQUE INDEX "stock_movements_transfer_product_warehouse_type_key" ON "stock_movements"("transfer_id", "product_id", "warehouse_id", "type");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_product_id_created_at_idx" ON "stock_movements"("organization_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_warehouse_id_created_at_idx" ON "stock_movements"("organization_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_created_at_idx" ON "stock_movements"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE INDEX "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_sequences" ADD CONSTRAINT "stock_transfer_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- Phase 3 left `order_items.product_id` addressable-but-unlinked because the
-- products table did not exist yet. Order history was never broken, and now that
-- products are archived rather than deleted the reference can be enforced.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Domain invariants for the Inventory module.
--
-- Prisma has no way to express CHECK constraints, so they are declared here and
-- deliberately kept out of schema.prisma (Prisma ignores them, so they never
-- cause drift). They are the last line of defence: the service layer already
-- rejects every one of these cases with a field-level validation error before
-- writing, which is what a member actually sees.
--
-- Maintainers: `prisma migrate diff --script --output` overwrites
-- `20261009120000_inventory/migration.sql`. If you ever regenerate that file, run
--
--     cmd /c "type prisma\sql\inventory-domain-invariants.sql >> prisma\migrations\20261009120000_inventory\migration.sql"
--
-- afterwards so these constraints are not silently dropped.

-- Prices are minor currency units held in int4; a selling price or a purchase
-- cost can never be negative, and a reorder threshold is a count.
ALTER TABLE "products"
    ADD CONSTRAINT "products_amounts_non_negative"
    CHECK (
        "unit_price" >= 0
        AND "reorder_threshold" >= 0
        AND ("cost_price" IS NULL OR "cost_price" >= 0)
    );

-- SKUs are the natural key a member types, so guard the shape rather than
-- trusting the service: printable, no whitespace, bounded.
ALTER TABLE "products"
    ADD CONSTRAINT "products_sku_format"
    CHECK ("sku" ~ '^[A-Za-z0-9._-]{1,64}$');

-- A product is archived exactly when `archived_at` is stamped, so the status
-- filter, the archive guard and the archive action can never disagree.
ALTER TABLE "products"
    ADD CONSTRAINT "products_archived_matches_status"
    CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "warehouses"
    ADD CONSTRAINT "warehouses_archived_matches_status"
    CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- Stock is a count of whole units, never negative. The service refuses a
-- change that would drive a balance below zero *before* writing the movement,
-- which is what the member sees; this is the backstop underneath it.
ALTER TABLE "inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_quantity_non_negative"
    CHECK ("quantity" >= 0);

-- Every movement must explain itself: the resulting balance is exactly the
-- previous balance plus the signed change, and neither side may go negative.
-- Together these make the ledger replayable — the first movement's
-- `quantity_before` plus every `quantity` reproduces the current stock row.
ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_ledger_consistent"
    CHECK (
        "quantity_after" = "quantity_before" + "quantity"
        AND "quantity_before" >= 0
        AND "quantity_after" >= 0
    );

-- Movement types are only allowed to reference the record that caused them, so
-- an order deduction can never be attributed to a transfer (or to nothing).
ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_reference_matches_type"
    CHECK (
        (CASE WHEN "type" IN ('ORDER_DEDUCTION', 'ORDER_RELEASE') THEN 1 ELSE 0 END) =
        (CASE WHEN "order_id" IS NOT NULL THEN 1 ELSE 0 END)
        AND
        (CASE WHEN "type" IN ('TRANSFER_OUT', 'TRANSFER_IN') THEN 1 ELSE 0 END) =
        (CASE WHEN "transfer_id" IS NOT NULL THEN 1 ELSE 0 END)
    );

-- Transfer numbers are allocated from `stock_transfer_sequences` and formatted
-- as `TR-000001`; guard the shape so a hand-written INSERT cannot corrupt it.
ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_number_format"
    CHECK ("number" ~ '^TR-[0-9]{6,}$');

-- A transfer is a movement between two *different* places. Enforced here
-- because the service would otherwise have to re-read the row it is writing.
ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_warehouses_distinct"
    CHECK ("from_warehouse_id" <> "to_warehouse_id");

ALTER TABLE "stock_transfer_sequences"
    ADD CONSTRAINT "stock_transfer_sequences_last_number_non_negative"
    CHECK ("last_number" >= 0);

-- Exactly one primary warehouse per organization, enforced by the database so a
-- race between two reuse-and-demote updates cannot leave two primaries behind.
-- Prisma cannot express a partial unique index, hence raw SQL.
CREATE UNIQUE INDEX "warehouses_one_primary_per_organization"
    ON "warehouses"("organization_id")
    WHERE "is_primary" AND "status" = 'ACTIVE' AND "archived_at" IS NULL;
