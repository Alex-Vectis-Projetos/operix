-- CreateTable
CREATE TABLE "profit_distribution_rules" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "site_key" TEXT,
    "client_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_distribution_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_distribution_shares" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "participant_type" TEXT NOT NULL,
    "person_id" TEXT,
    "percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "profit_distribution_shares_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "distributions" ADD COLUMN "rule_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "profit_distribution_rules_id_workspace_id_key" ON "profit_distribution_rules"("id", "workspace_id");
CREATE INDEX "profit_distribution_rules_workspace_id_is_active_idx" ON "profit_distribution_rules"("workspace_id", "is_active");
CREATE INDEX "profit_distribution_shares_rule_id_idx" ON "profit_distribution_shares"("rule_id");

-- AddForeignKey
ALTER TABLE "profit_distribution_rules" ADD CONSTRAINT "profit_distribution_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_distribution_shares" ADD CONSTRAINT "profit_distribution_shares_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "profit_distribution_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
