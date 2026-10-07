-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderActivityType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'CANCELLED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "tax_rate" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "assigned_user_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequences" (
    "organization_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "order_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "OrderActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_organization_id_status_idx" ON "orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "orders_organization_id_status_created_at_idx" ON "orders"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_organization_id_customer_id_idx" ON "orders"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_customer_id_created_at_idx" ON "orders"("organization_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_organization_id_assigned_user_id_idx" ON "orders"("organization_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_created_at_idx" ON "orders"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_order_number_key" ON "orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_organization_id_order_id_idx" ON "order_items"("organization_id", "order_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_position_idx" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_items_organization_id_product_id_idx" ON "order_items"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "order_activities_organization_id_order_id_created_at_idx" ON "order_activities"("organization_id", "order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_activities_order_id_created_at_idx" ON "order_activities"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sequences" ADD CONSTRAINT "order_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_activities" ADD CONSTRAINT "order_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_activities" ADD CONSTRAINT "order_activities_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_activities" ADD CONSTRAINT "order_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
