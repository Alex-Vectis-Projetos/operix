-- CreateTable
CREATE TABLE "operational_confrontation_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period" TEXT,
    "payment_list_id" TEXT,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT,
    "file_sha256" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "granularity_used" TEXT NOT NULL,
    "mapping_confirmed" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "results_snapshot" JSONB NOT NULL,
    "decisions" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_confrontation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operational_confrontation_runs_id_workspace_id_key" ON "operational_confrontation_runs"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "operational_confrontation_runs_workspace_id_client_id_idx" ON "operational_confrontation_runs"("workspace_id", "client_id");

-- CreateIndex
CREATE INDEX "operational_confrontation_runs_workspace_id_created_at_idx" ON "operational_confrontation_runs"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "operational_confrontation_runs" ADD CONSTRAINT "operational_confrontation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_confrontation_runs" ADD CONSTRAINT "operational_confrontation_runs_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_confrontation_runs" ADD CONSTRAINT "operational_confrontation_runs_payment_list_id_worksp_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
