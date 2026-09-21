-- CreateEnum
CREATE TYPE "PaymentListStatus" AS ENUM ('draft', 'under_review', 'confronted', 'pending', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "ConfrontationStatus" AS ENUM ('not_evaluated', 'exact_match', 'value_difference', 'service_discrepancy', 'vehicle_not_found', 'unmatched_weeklog');

-- CreateEnum
CREATE TYPE "ConfrontationDecision" AS ENUM ('none', 'accept_difference', 'contest', 'request_rectification', 'reject_item');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'extracting', 'extracted', 'under_review', 'reviewed', 'committed', 'failed', 'discarded');

-- AlterTable
ALTER TABLE "weeklog_entries" ADD COLUMN     "external_import_item_id" TEXT,
ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT 'production_order',
ALTER COLUMN "production_order_id" DROP NOT NULL;

-- Safe backfill existing weeklog_entries before constraint application
UPDATE "weeklog_entries"
SET "source_type" = 'production_order'
WHERE "source_type" IS NULL OR "source_type" = '';

-- CreateTable
CREATE TABLE "payment_lists" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "list_number" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "status" "PaymentListStatus" NOT NULL DEFAULT 'draft',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "source_document_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "recognized_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "issue_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "document_id" TEXT,
    "invoice_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "confronted_by" TEXT,
    "confronted_at" TIMESTAMP(3),
    "validated_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_list_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_list_id" TEXT NOT NULL,
    "weeklog_entry_id" TEXT,
    "legacy_payment_order_id" TEXT,
    "car_name" TEXT,
    "license_plate" TEXT,
    "vin" TEXT,
    "technician_user_id" TEXT,
    "technician_name" TEXT,
    "operational_site_key" TEXT,
    "services_snapshot" JSONB NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_list_entry_claims" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_list_id" TEXT NOT NULL,
    "weeklog_entry_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "released_reason" TEXT,

    CONSTRAINT "payment_list_entry_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_list_confrontation_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_list_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'started',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payment_list_confrontation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_list_confrontation_results" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_list_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "payment_list_item_id" TEXT,
    "weeklog_entry_id" TEXT,
    "status" "ConfrontationStatus" NOT NULL DEFAULT 'not_evaluated',
    "decision" "ConfrontationDecision" NOT NULL DEFAULT 'none',
    "difference_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "reopened_production_order_id" TEXT,
    "target_execution_sequence" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_list_confrontation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_list_imports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_list_id" TEXT,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "raw_ocr_result" JSONB,
    "error_message" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_list_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_list_import_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "raw_license_plate" TEXT,
    "raw_vin" TEXT,
    "raw_car_name" TEXT,
    "raw_client" TEXT,
    "raw_technician" TEXT,
    "raw_platform" TEXT,
    "raw_services" JSONB,
    "raw_total_text" TEXT,
    "field_confidence" JSONB,
    "reviewed_license_plate" TEXT,
    "reviewed_vin" TEXT,
    "reviewed_car_name" TEXT,
    "reviewed_technician_user_id" TEXT,
    "reviewed_services" JSONB,
    "reviewed_total" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'staged',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "external_list_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sequence_counters" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "sequence_type" TEXT NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_sequence_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_operational_imports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "raw_ocr_result" JSONB,
    "error_message" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_operational_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_operational_import_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "raw_license_plate" TEXT,
    "raw_car_name" TEXT,
    "raw_technician" TEXT,
    "raw_week" TEXT,
    "raw_services" JSONB,
    "raw_total_text" TEXT,
    "field_confidence" JSONB,
    "reviewed_license_plate" TEXT,
    "reviewed_car_name" TEXT,
    "reviewed_technician_user_id" TEXT,
    "reviewed_services" JSONB,
    "reviewed_total" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'staged',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "external_operational_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_lists_workspace_id_status_idx" ON "payment_lists"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "payment_lists_client_id_status_idx" ON "payment_lists"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_lists_id_workspace_id_key" ON "payment_lists"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_lists_workspace_id_list_number_key" ON "payment_lists"("workspace_id", "list_number");

-- CreateIndex
CREATE INDEX "payment_list_items_workspace_id_payment_list_id_idx" ON "payment_list_items"("workspace_id", "payment_list_id");

-- CreateIndex
CREATE INDEX "payment_list_items_weeklog_entry_id_idx" ON "payment_list_items"("weeklog_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_items_id_workspace_id_key" ON "payment_list_items"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_items_id_payment_list_id_workspace_id_key" ON "payment_list_items"("id", "payment_list_id", "workspace_id");

-- CreateIndex
CREATE INDEX "payment_list_entry_claims_workspace_id_payment_list_id_idx" ON "payment_list_entry_claims"("workspace_id", "payment_list_id");

-- CreateIndex
CREATE INDEX "payment_list_entry_claims_workspace_id_weeklog_entry_id_idx" ON "payment_list_entry_claims"("workspace_id", "weeklog_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_entry_claims_id_workspace_id_key" ON "payment_list_entry_claims"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "payment_list_confrontation_runs_workspace_id_payment_list_i_idx" ON "payment_list_confrontation_runs"("workspace_id", "payment_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_confrontation_runs_payment_list_id_sequence_key" ON "payment_list_confrontation_runs"("payment_list_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_confrontation_runs_id_payment_list_id_workspac_key" ON "payment_list_confrontation_runs"("id", "payment_list_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_confrontation_runs_id_workspace_id_key" ON "payment_list_confrontation_runs"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "payment_list_confrontation_results_workspace_id_payment_lis_idx" ON "payment_list_confrontation_results"("workspace_id", "payment_list_id");

-- CreateIndex
CREATE INDEX "payment_list_confrontation_results_run_id_idx" ON "payment_list_confrontation_results"("run_id");

-- CreateIndex
CREATE INDEX "payment_list_confrontation_results_weeklog_entry_id_idx" ON "payment_list_confrontation_results"("weeklog_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_list_confrontation_results_id_workspace_id_key" ON "payment_list_confrontation_results"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "external_list_imports_workspace_id_status_idx" ON "external_list_imports"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_list_imports_id_workspace_id_key" ON "external_list_imports"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "external_list_import_items_workspace_id_import_id_idx" ON "external_list_import_items"("workspace_id", "import_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_list_import_items_id_workspace_id_key" ON "external_list_import_items"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_sequence_counters_workspace_id_sequence_type_key" ON "tenant_sequence_counters"("workspace_id", "sequence_type");

-- CreateIndex
CREATE INDEX "external_operational_imports_workspace_id_status_idx" ON "external_operational_imports"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_operational_imports_id_workspace_id_key" ON "external_operational_imports"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "external_operational_import_items_workspace_id_import_id_idx" ON "external_operational_import_items"("workspace_id", "import_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_operational_import_items_id_workspace_id_key" ON "external_operational_import_items"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_external_import_item_id_workspace_id_fkey" FOREIGN KEY ("external_import_item_id", "workspace_id") REFERENCES "external_operational_import_items"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_lists" ADD CONSTRAINT "payment_lists_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_items" ADD CONSTRAINT "payment_list_items_payment_list_id_workspace_id_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_items" ADD CONSTRAINT "payment_list_items_weeklog_entry_id_workspace_id_fkey" FOREIGN KEY ("weeklog_entry_id", "workspace_id") REFERENCES "weeklog_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_entry_claims" ADD CONSTRAINT "payment_list_entry_claims_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_entry_claims" ADD CONSTRAINT "payment_list_entry_claims_payment_list_id_workspace_id_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_entry_claims" ADD CONSTRAINT "payment_list_entry_claims_weeklog_entry_id_workspace_id_fkey" FOREIGN KEY ("weeklog_entry_id", "workspace_id") REFERENCES "weeklog_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_runs" ADD CONSTRAINT "payment_list_confrontation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_runs" ADD CONSTRAINT "payment_list_confrontation_runs_payment_list_id_workspace__fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_results" ADD CONSTRAINT "payment_list_confrontation_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_results" ADD CONSTRAINT "payment_list_confrontation_results_payment_list_id_workspa_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_results" ADD CONSTRAINT "payment_list_confrontation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payment_list_confrontation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_results" ADD CONSTRAINT "payment_list_confrontation_results_payment_list_item_id_pa_fkey" FOREIGN KEY ("payment_list_item_id", "payment_list_id", "workspace_id") REFERENCES "payment_list_items"("id", "payment_list_id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_list_confrontation_results" ADD CONSTRAINT "payment_list_confrontation_results_weeklog_entry_id_worksp_fkey" FOREIGN KEY ("weeklog_entry_id", "workspace_id") REFERENCES "weeklog_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_list_imports" ADD CONSTRAINT "external_list_imports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_list_imports" ADD CONSTRAINT "external_list_imports_payment_list_id_workspace_id_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_list_import_items" ADD CONSTRAINT "external_list_import_items_import_id_workspace_id_fkey" FOREIGN KEY ("import_id", "workspace_id") REFERENCES "external_list_imports"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sequence_counters" ADD CONSTRAINT "tenant_sequence_counters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_operational_imports" ADD CONSTRAINT "external_operational_imports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_operational_import_items" ADD CONSTRAINT "external_operational_import_items_import_id_workspace_id_fkey" FOREIGN KEY ("import_id", "workspace_id") REFERENCES "external_operational_imports"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual SQL Constraints & Invariants (Spec 004 Hardening)
-- ---------------------------------------------------------------------------

-- 1. Anti-double-billing Partial Unique Index (Section 5 / ADR-004)
CREATE UNIQUE INDEX "unique_active_or_consumed_weeklog_entry_claim"
ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
WHERE "status" IN ('reserved', 'consumed');

-- 2. Claim Status Check & Lifecycle Consistency Check (Section 6)
ALTER TABLE "payment_list_entry_claims"
ADD CONSTRAINT "payment_list_entry_claims_status_check"
CHECK ("status" IN ('reserved', 'consumed', 'released'));

ALTER TABLE "payment_list_entry_claims"
ADD CONSTRAINT "payment_list_entry_claims_lifecycle_check"
CHECK (
  ("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL)
  OR
  ("status" = 'released' AND "released_at" IS NOT NULL)
);

-- 3. Confrontation Results Item or Entry Check (Section 8)
ALTER TABLE "payment_list_confrontation_results"
ADD CONSTRAINT "payment_list_confrontation_results_item_or_entry_check"
CHECK (
  "payment_list_item_id" IS NOT NULL
  OR "weeklog_entry_id" IS NOT NULL
);

-- 4. Match Uniqueness per Confrontation Run (Section 9)
CREATE UNIQUE INDEX "unique_run_payment_list_item"
ON "payment_list_confrontation_results" ("run_id", "payment_list_item_id")
WHERE "payment_list_item_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_run_weeklog_entry"
ON "payment_list_confrontation_results" ("run_id", "weeklog_entry_id")
WHERE "weeklog_entry_id" IS NOT NULL;

-- 5. WeeklogEntry Source XOR Check (Section 13)
ALTER TABLE "weeklog_entries"
ADD CONSTRAINT "weeklog_entries_source_xor_check"
CHECK (
  (
    "source_type" = 'production_order'
    AND "production_order_id" IS NOT NULL
    AND "external_import_item_id" IS NULL
  )
  OR
  (
    "source_type" = 'external_import'
    AND "production_order_id" IS NULL
    AND "external_import_item_id" IS NOT NULL
  )
);

-- 6. External Import Item Uniqueness (Section 15)
CREATE UNIQUE INDEX "unique_external_import_item_entry"
ON "weeklog_entries" ("external_import_item_id")
WHERE "external_import_item_id" IS NOT NULL;
