-- Spec 006 R04: Step 2 - Commercial Handoff, Source-Aware Claims & Multiweek Absorption

-- 1. Add composite candidate key on weeklog_validations for tenant-safe FK
CREATE UNIQUE INDEX IF NOT EXISTS "weeklog_validations_id_workspace_id_key" ON "weeklog_validations"("id", "workspace_id");

-- 2. Add commercial handoff columns to payment_lists
ALTER TABLE "payment_lists" ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "payment_lists" ADD COLUMN IF NOT EXISTS "origin_weeklog_id" TEXT;
ALTER TABLE "payment_lists" ADD COLUMN IF NOT EXISTS "origin_weeklog_validation_id" TEXT;
ALTER TABLE "payment_lists" ADD COLUMN IF NOT EXISTS "superseded_by_payment_list_id" TEXT;

-- 3. Add composite tenant-safe FKs to payment_lists
ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_origin_weeklog_id_workspace_id_fkey"
FOREIGN KEY ("origin_weeklog_id", "workspace_id") REFERENCES "weeklogs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_origin_weeklog_validation_id_workspace_id_fkey"
FOREIGN KEY ("origin_weeklog_validation_id", "workspace_id") REFERENCES "weeklog_validations"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_superseded_by_payment_list_id_workspace_id_fkey"
FOREIGN KEY ("superseded_by_payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Auto-list indexes: lookup and exactly-once validation-cycle idempotency
CREATE INDEX IF NOT EXISTS "payment_lists_workspace_id_origin_weeklog_validation_id_idx"
ON "payment_lists"("workspace_id", "origin_weeklog_validation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_auto_payment_list_origin_validation"
ON "payment_lists" ("workspace_id", "origin_weeklog_validation_id")
WHERE "source_type" = 'weeklog_auto' AND "status" NOT IN ('cancelled', 'superseded');

-- 5. Add projection fields to payment_list_items
ALTER TABLE "payment_list_items" ADD COLUMN IF NOT EXISTS "vehicle_description" TEXT;
ALTER TABLE "payment_list_items" ADD COLUMN IF NOT EXISTS "service_location" TEXT;

-- 6. Update payment_list_entry_claims status check & lifecycle constraints to include 'provisional'
ALTER TABLE "payment_list_entry_claims" DROP CONSTRAINT IF EXISTS "payment_list_entry_claims_status_check";

ALTER TABLE "payment_list_entry_claims" ADD CONSTRAINT "payment_list_entry_claims_status_check"
CHECK ("status" IN ('provisional', 'reserved', 'consumed', 'released'));

ALTER TABLE "payment_list_entry_claims" DROP CONSTRAINT IF EXISTS "payment_list_entry_claims_lifecycle_check";

ALTER TABLE "payment_list_entry_claims" ADD CONSTRAINT "payment_list_entry_claims_lifecycle_check"
CHECK (
  ("status" = 'provisional' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL)
  OR
  ("status" = 'released' AND "released_at" IS NOT NULL AND "consumed_at" IS NULL)
);

-- 7. Unique partial index for provisional claims
CREATE UNIQUE INDEX IF NOT EXISTS "unique_provisional_weeklog_entry_claim"
ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
WHERE "status" = 'provisional';
