-- CreateTable
CREATE TABLE "vehicle_inspections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "budget_id" TEXT,
    "production_order_id" TEXT,
    "client_signed_at" TIMESTAMP(3),
    "signature_storage_path" TEXT,
    "acknowledged_pre_existing" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_damage_points" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "coord_x" DECIMAL(5,2) NOT NULL,
    "coord_y" DECIMAL(5,2) NOT NULL,
    "car_part_code" TEXT NOT NULL,
    "damage_type" TEXT NOT NULL,
    "dent_count" INTEGER,
    "contracted" BOOLEAN NOT NULL DEFAULT true,
    "estimated_amount" DECIMAL(12,2),
    "photo_storage_path" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_damage_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_tasks" (
    "id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "service_category" TEXT NOT NULL DEFAULT 'pdr',
    "car_part_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commercial_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "primary_technician_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completion_notes" TEXT,
    "after_photo_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_task_contributions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "share_percent" DECIMAL(5,2) NOT NULL,
    "arbitrated_by" TEXT NOT NULL,
    "arbitrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_task_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_inspections_workspace_id_budget_id_idx" ON "vehicle_inspections"("workspace_id", "budget_id");

-- CreateIndex
CREATE INDEX "vehicle_inspections_workspace_id_production_order_id_idx" ON "vehicle_inspections"("workspace_id", "production_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_inspections_id_workspace_id_key" ON "vehicle_inspections"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "vehicle_damage_points_inspection_id_workspace_id_idx" ON "vehicle_damage_points"("inspection_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_damage_points_id_workspace_id_key" ON "vehicle_damage_points"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "production_tasks_production_order_id_status_idx" ON "production_tasks"("production_order_id", "status");

-- CreateIndex
CREATE INDEX "production_tasks_workspace_id_primary_technician_id_idx" ON "production_tasks"("workspace_id", "primary_technician_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_tasks_id_workspace_id_key" ON "production_tasks"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "production_task_contributions_task_id_workspace_id_idx" ON "production_task_contributions"("task_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_task_contributions_task_id_technician_id_key" ON "production_task_contributions"("task_id", "technician_id");

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_damage_points" ADD CONSTRAINT "vehicle_damage_points_inspection_id_workspace_id_fkey" FOREIGN KEY ("inspection_id", "workspace_id") REFERENCES "vehicle_inspections"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_production_order_id_workspace_id_fkey" FOREIGN KEY ("production_order_id", "workspace_id") REFERENCES "production_orders"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_task_contributions" ADD CONSTRAINT "production_task_contributions_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "production_tasks"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
