-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "currency_code" TEXT,
ADD COLUMN     "execution_sequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "operational_site_key" TEXT,
ADD COLUMN     "performed_services" JSONB,
ADD COLUMN     "rectification_origin_id" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "client_access_grants" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'validator',
    "status" TEXT NOT NULL DEFAULT 'active',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeklogs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3) NOT NULL,
    "client_id" TEXT NOT NULL,
    "site_key" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "week" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "year_reference" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weeklogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeklog_entries" (
    "id" TEXT NOT NULL,
    "weeklog_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "execution_sequence" INTEGER NOT NULL DEFAULT 1,
    "budget_id" TEXT,
    "budget_revision_id" TEXT,
    "legacy_service_order_id" TEXT,
    "technician_user_id" TEXT NOT NULL,
    "technician_name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL DEFAULT '',
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "license_plate" TEXT,
    "vin" TEXT,
    "services_snapshot" JSONB NOT NULL DEFAULT '[]',
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL,
    "validation_status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewer_user_id" TEXT,
    "rejection_reason" TEXT,
    "is_rectification" BOOLEAN NOT NULL DEFAULT false,
    "rectification_origin_entry_id" TEXT,
    "rectification_reason" TEXT,
    "rectification_requested_by" TEXT,
    "rectification_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weeklog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeklog_validations" (
    "id" TEXT NOT NULL,
    "weeklog_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "validation_sequence" INTEGER NOT NULL DEFAULT 1,
    "validator_user_id" TEXT NOT NULL,
    "validation_method" TEXT NOT NULL,
    "signature_storage_path" TEXT,
    "coverage_snapshot" JSONB NOT NULL,
    "audit_trail" JSONB NOT NULL DEFAULT '[]',
    "validated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weeklog_validations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_access_grants_workspace_id_user_id_idx" ON "client_access_grants"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "client_access_grants_client_id_status_idx" ON "client_access_grants"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_access_grants_workspace_id_user_id_client_id_key" ON "client_access_grants"("workspace_id", "user_id", "client_id");

-- CreateIndex
CREATE INDEX "weeklogs_workspace_id_status_idx" ON "weeklogs"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weeklogs_workspace_id_starts_on_client_id_site_key_key" ON "weeklogs"("workspace_id", "starts_on", "client_id", "site_key");

-- CreateIndex
CREATE UNIQUE INDEX "weeklogs_id_workspace_id_key" ON "weeklogs"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "weeklog_entries_workspace_id_validation_status_idx" ON "weeklog_entries"("workspace_id", "validation_status");

-- CreateIndex
CREATE INDEX "weeklog_entries_technician_user_id_idx" ON "weeklog_entries"("technician_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "weeklog_entries_production_order_id_execution_sequence_key" ON "weeklog_entries"("production_order_id", "execution_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "weeklog_entries_id_workspace_id_key" ON "weeklog_entries"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "weeklog_validations_workspace_id_weeklog_id_idx" ON "weeklog_validations"("workspace_id", "weeklog_id");

-- CreateIndex
CREATE UNIQUE INDEX "weeklog_validations_weeklog_id_validation_sequence_key" ON "weeklog_validations"("weeklog_id", "validation_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_workspace_id_key" ON "clients"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_id_workspace_id_key" ON "production_orders"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_rectification_origin_id_workspace_id_fkey" FOREIGN KEY ("rectification_origin_id", "workspace_id") REFERENCES "weeklog_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_grants" ADD CONSTRAINT "client_access_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_grants" ADD CONSTRAINT "client_access_grants_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_grants" ADD CONSTRAINT "client_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklogs" ADD CONSTRAINT "weeklogs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklogs" ADD CONSTRAINT "weeklogs_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_weeklog_id_workspace_id_fkey" FOREIGN KEY ("weeklog_id", "workspace_id") REFERENCES "weeklogs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_production_order_id_workspace_id_fkey" FOREIGN KEY ("production_order_id", "workspace_id") REFERENCES "production_orders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_legacy_service_order_id_fkey" FOREIGN KEY ("legacy_service_order_id") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_entries" ADD CONSTRAINT "weeklog_entries_rectification_origin_entry_id_workspace_id_fkey" FOREIGN KEY ("rectification_origin_entry_id", "workspace_id") REFERENCES "weeklog_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_validations" ADD CONSTRAINT "weeklog_validations_weeklog_id_workspace_id_fkey" FOREIGN KEY ("weeklog_id", "workspace_id") REFERENCES "weeklogs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_validations" ADD CONSTRAINT "weeklog_validations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weeklog_validations" ADD CONSTRAINT "weeklog_validations_validator_user_id_fkey" FOREIGN KEY ("validator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
