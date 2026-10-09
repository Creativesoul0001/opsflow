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
