-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "budget_id" TEXT,
ADD COLUMN     "budget_revision_id" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'company';

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "vehicle_plate" TEXT,
    "vehicle_vin" TEXT,
    "vehicle_brand" TEXT,
    "vehicle_model" TEXT,
    "current_revision_number" INTEGER NOT NULL DEFAULT 1,
    "current_revision_id" TEXT,
    "approved_revision_id" TEXT,
    "technician_user_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "legacy_local_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_revisions" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency_code" TEXT NOT NULL DEFAULT 'EUR',
    "budget_type" TEXT NOT NULL DEFAULT 'pdr',
    "client_snapshot" JSONB NOT NULL,
    "vehicle_snapshot" JSONB NOT NULL,
    "dossier_snapshot" JSONB,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "services" JSONB NOT NULL DEFAULT '[]',
    "labor" JSONB NOT NULL DEFAULT '[]',
    "intervention_types" TEXT[],
    "diagnosis" TEXT,
    "technical_description" TEXT,
    "gross_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "signature" JSONB,
    "rejection" JSONB,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_photos" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "caption" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_workspace_id_idx" ON "budgets"("workspace_id");

-- CreateIndex
CREATE INDEX "budgets_vehicle_plate_idx" ON "budgets"("vehicle_plate");

-- CreateIndex
CREATE INDEX "budgets_client_id_idx" ON "budgets"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_workspace_id_code_key" ON "budgets"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_workspace_id_legacy_local_id_key" ON "budgets"("workspace_id", "legacy_local_id");

-- CreateIndex
CREATE INDEX "budget_revisions_budget_id_status_idx" ON "budget_revisions"("budget_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_revisions_budget_id_revision_number_key" ON "budget_revisions"("budget_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "budget_revisions_id_budget_id_key" ON "budget_revisions"("id", "budget_id");

-- CreateIndex
CREATE INDEX "budget_photos_budget_id_idx" ON "budget_photos"("budget_id");

-- CreateIndex
CREATE INDEX "budget_photos_workspace_id_idx" ON "budget_photos"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_budget_id_key" ON "production_orders"("budget_id");

-- ADR-002: Personal Workspace Unique Partial Index (max 1 personal workspace per AppUser)
CREATE UNIQUE INDEX "workspaces_owner_user_id_personal_key" ON "workspaces"("owner_user_id") WHERE "type" = 'personal';

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_revision_id_budget_id_fkey" FOREIGN KEY ("budget_revision_id", "budget_id") REFERENCES "budget_revisions"("id", "budget_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_technician_user_id_fkey" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "budget_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_revision_id_fkey" FOREIGN KEY ("approved_revision_id") REFERENCES "budget_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_photos" ADD CONSTRAINT "budget_photos_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_photos" ADD CONSTRAINT "budget_photos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
