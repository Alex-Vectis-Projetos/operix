-- AlterForeignKey: production_orders_budget_revision_id_budget_id_fkey (SET NULL -> RESTRICT)
ALTER TABLE "production_orders" DROP CONSTRAINT "production_orders_budget_revision_id_budget_id_fkey";
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_revision_id_budget_id_fkey" FOREIGN KEY ("budget_revision_id", "budget_id") REFERENCES "budget_revisions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraint de integridade de linhagem: budget_id e budget_revision_id devem ser ambos NULL (OP direta) ou ambos NOT NULL (OP originada de Budget)
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_lineage_check" CHECK (
  ("budget_id" IS NULL AND "budget_revision_id" IS NULL)
  OR
  ("budget_id" IS NOT NULL AND "budget_revision_id" IS NOT NULL)
);

-- AlterForeignKey: Replace simple FK budgets.current_revision_id with composite FK ON DELETE RESTRICT
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_current_revision_id_fkey";
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_current_revision_id_id_fkey" FOREIGN KEY ("current_revision_id", "id") REFERENCES "budget_revisions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterForeignKey: Replace simple FK budgets.approved_revision_id with composite FK ON DELETE RESTRICT
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_approved_revision_id_fkey";
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_revision_id_id_fkey" FOREIGN KEY ("approved_revision_id", "id") REFERENCES "budget_revisions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;
