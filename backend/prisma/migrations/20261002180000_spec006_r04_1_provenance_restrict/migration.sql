-- Spec 006 R04.1 Hardening: Commercial Provenance Invariants (ON DELETE RESTRICT)

-- 1. Drop existing foreign key constraints on payment_lists
ALTER TABLE "payment_lists" DROP CONSTRAINT IF EXISTS "payment_lists_origin_weeklog_id_workspace_id_fkey";
ALTER TABLE "payment_lists" DROP CONSTRAINT IF EXISTS "payment_lists_origin_weeklog_validation_id_workspace_id_fkey";
ALTER TABLE "payment_lists" DROP CONSTRAINT IF EXISTS "payment_lists_superseded_by_payment_list_id_workspace_id_fkey";

-- 2. Re-create foreign keys with ON DELETE RESTRICT
ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_origin_weeklog_id_workspace_id_fkey"
FOREIGN KEY ("origin_weeklog_id", "workspace_id") REFERENCES "weeklogs"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_origin_weeklog_validation_id_workspace_id_fkey"
FOREIGN KEY ("origin_weeklog_validation_id", "workspace_id") REFERENCES "weeklog_validations"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_superseded_by_payment_list_id_workspace_id_fkey"
FOREIGN KEY ("superseded_by_payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
