-- Extend confrontation outcomes without overloading unrelated mismatch statuses.
ALTER TYPE "ConfrontationStatus" ADD VALUE IF NOT EXISTS 'ambiguous_match';

-- A result must belong to the same run, payment list, and workspace.
ALTER TABLE "payment_list_confrontation_results"
DROP CONSTRAINT "payment_list_confrontation_results_run_id_fkey";

ALTER TABLE "payment_list_confrontation_results"
ADD CONSTRAINT "payment_list_confrontation_results_run_scope_fkey"
FOREIGN KEY ("run_id", "payment_list_id", "workspace_id")
REFERENCES "payment_list_confrontation_runs"("id", "payment_list_id", "workspace_id")
ON DELETE CASCADE
ON UPDATE CASCADE;

DROP INDEX "payment_list_confrontation_results_run_id_idx";

CREATE INDEX "payment_list_confrontation_results_run_scope_idx"
ON "payment_list_confrontation_results"("run_id", "payment_list_id", "workspace_id");

-- Released claims cannot simultaneously carry consumption evidence.
ALTER TABLE "payment_list_entry_claims"
DROP CONSTRAINT "payment_list_entry_claims_lifecycle_check";

ALTER TABLE "payment_list_entry_claims"
ADD CONSTRAINT "payment_list_entry_claims_lifecycle_check"
CHECK (
  ("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL)
  OR
  ("status" = 'released' AND "released_at" IS NOT NULL AND "consumed_at" IS NULL)
) NOT VALID;

ALTER TABLE "payment_list_entry_claims"
VALIDATE CONSTRAINT "payment_list_entry_claims_lifecycle_check";
