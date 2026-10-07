-- Domain invariants for the Orders module.
--
-- Prisma has no way to express CHECK constraints, so they are declared here and
-- deliberately kept out of schema.prisma (Prisma ignores them, so they never
-- cause drift). They are the last line of defence: the service layer already
-- rejects every one of these cases with a field-level validation error before
-- writing, which is what a member actually sees.
--
-- Maintainers: `prisma migrate diff --script --output` overwrites
-- `20261004130000_orders/migration.sql`. If you ever regenerate that file, run
--
--     cmd /c "type prisma\sql\order-domain-invariants.sql >> prisma\migrations\20261004130000_orders\migration.sql"
--
-- afterwards so these constraints are not silently dropped.

-- Monetary values are minor currency units held in int4; amounts must never be
-- negative and the stored total must always be reproducible from its parts.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_amounts_non_negative"
    CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0);

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_total_consistent"
    CHECK ("total" = "subtotal" - "discount" + "tax");

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_discount_within_subtotal"
    CHECK ("discount" <= "subtotal");

-- Tax is always derived from `tax_rate` (basis points) server-side.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_tax_rate_valid"
    CHECK ("tax_rate" >= 0 AND "tax_rate" <= 10000);

-- An order is cancelled exactly when `cancelled_at` is stamped, so the
-- timeline and the status filter can never disagree.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_cancelled_at_matches_status"
    CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_amounts_valid"
    CHECK (
        "position" >= 0
        AND "quantity" > 0
        AND "unit_price" >= 0
        AND "discount" >= 0
        AND "total" >= 0
        AND "discount" <= "quantity" * "unit_price"
        AND "total" = "quantity" * "unit_price" - "discount"
    );

-- Order numbers are allocated from `order_sequences` and formatted as
-- `ORD-000000`; guard the shape so a hand-written INSERT cannot corrupt it.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_order_number_format"
    CHECK ("order_number" ~ '^ORD-[0-9]{6,}$');

ALTER TABLE "order_sequences"
    ADD CONSTRAINT "order_sequences_last_number_non_negative"
    CHECK ("last_number" >= 0);
