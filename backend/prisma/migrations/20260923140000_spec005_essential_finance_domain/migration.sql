CREATE TYPE "ExpenseStatus" AS ENUM ('effective', 'reversed');
CREATE TYPE "DistributionStatus" AS ENUM ('active', 'cancelled');
CREATE TYPE "FinancialObligationStatus" AS ENUM ('pending', 'paid', 'cancelled', 'reversed');
CREATE TYPE "ObligationPaymentStatus" AS ENUM ('effective', 'reversed');
CREATE TYPE "DistributionAllocationMode" AS ENUM ('fixed', 'percentage');
CREATE TYPE "FinancialParticipantKind" AS ENUM ('person', 'workspace', 'client');
CREATE TYPE "ExpenseContextKind" AS ENUM ('payment_list', 'production_order', 'technician_person', 'client', 'document');

ALTER TABLE "people" ADD CONSTRAINT "people_id_workspace_id_key" UNIQUE ("id", "workspace_id");
ALTER TABLE "documents" ADD CONSTRAINT "documents_id_workspace_id_key" UNIQUE ("id", "workspace_id");

CREATE TABLE "expenses" (
  "id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "currency_code" TEXT NOT NULL, "category" TEXT NOT NULL, "occurred_on" DATE NOT NULL,
  "description" TEXT, "status" "ExpenseStatus" NOT NULL DEFAULT 'effective',
  "context_kind" "ExpenseContextKind", "payment_list_id" TEXT, "production_order_id" TEXT,
  "technician_person_id" TEXT, "client_id" TEXT, "document_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by_user_id" TEXT NOT NULL,
  "reversed_at" TIMESTAMP(3), "reversed_by_user_id" TEXT, "reversal_reason" TEXT,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "expenses_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT "expenses_context_xor" CHECK (("payment_list_id" IS NOT NULL)::int + ("production_order_id" IS NOT NULL)::int + ("technician_person_id" IS NOT NULL)::int + ("client_id" IS NOT NULL)::int + ("document_id" IS NOT NULL)::int <= 1),
  CONSTRAINT "expenses_context_kind_match" CHECK (("context_kind" IS NULL AND "payment_list_id" IS NULL AND "production_order_id" IS NULL AND "technician_person_id" IS NULL AND "client_id" IS NULL AND "document_id" IS NULL) OR ("context_kind" = 'payment_list' AND "payment_list_id" IS NOT NULL) OR ("context_kind" = 'production_order' AND "production_order_id" IS NOT NULL) OR ("context_kind" = 'technician_person' AND "technician_person_id" IS NOT NULL) OR ("context_kind" = 'client' AND "client_id" IS NOT NULL) OR ("context_kind" = 'document' AND "document_id" IS NOT NULL)),
  CONSTRAINT "expenses_reversal_audit" CHECK (("status" = 'effective' AND "reversed_at" IS NULL AND "reversed_by_user_id" IS NULL AND "reversal_reason" IS NULL) OR ("status" = 'reversed' AND "reversed_at" IS NOT NULL AND "reversed_by_user_id" IS NOT NULL AND "reversal_reason" IS NOT NULL))
);

CREATE TABLE "distributions" (
  "id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "payment_list_id" TEXT NOT NULL, "payment_list_item_id" TEXT,
  "participant_kind" "FinancialParticipantKind" NOT NULL, "participant_person_id" TEXT, "participant_workspace_id" TEXT, "participant_client_id" TEXT,
  "allocation_mode" "DistributionAllocationMode" NOT NULL, "fixed_amount" DECIMAL(12,2), "percentage" DECIMAL(5,2), "resolved_amount" DECIMAL(12,2) NOT NULL, "currency_code" TEXT NOT NULL,
  "status" "DistributionStatus" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by_user_id" TEXT NOT NULL,
  "cancelled_at" TIMESTAMP(3), "cancelled_by_user_id" TEXT, "cancellation_reason" TEXT,
  CONSTRAINT "distributions_pkey" PRIMARY KEY ("id"), CONSTRAINT "distributions_id_workspace_id_key" UNIQUE ("id", "workspace_id"), CONSTRAINT "distributions_resolved_amount_positive" CHECK ("resolved_amount" > 0),
  CONSTRAINT "distributions_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT "distributions_participant_xor" CHECK (("participant_kind" = 'person' AND "participant_person_id" IS NOT NULL AND "participant_workspace_id" IS NULL AND "participant_client_id" IS NULL) OR ("participant_kind" = 'workspace' AND "participant_person_id" IS NULL AND "participant_workspace_id" = "workspace_id" AND "participant_client_id" IS NULL) OR ("participant_kind" = 'client' AND "participant_person_id" IS NULL AND "participant_workspace_id" IS NULL AND "participant_client_id" IS NOT NULL)),
  CONSTRAINT "distributions_allocation_xor" CHECK (("allocation_mode" = 'fixed' AND "fixed_amount" IS NOT NULL AND "fixed_amount" > 0 AND "percentage" IS NULL) OR ("allocation_mode" = 'percentage' AND "fixed_amount" IS NULL AND "percentage" IS NOT NULL AND "percentage" > 0 AND "percentage" <= 100)),
  CONSTRAINT "distributions_cancellation_audit" CHECK (("status" = 'active' AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL) OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL))
);

CREATE TABLE "financial_obligations" ("id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "distribution_id" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL, "currency_code" TEXT NOT NULL, "status" "FinancialObligationStatus" NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by_user_id" TEXT NOT NULL, "paid_at" TIMESTAMP(3), "paid_by_user_id" TEXT, "cancelled_at" TIMESTAMP(3), "cancelled_by_user_id" TEXT, "cancellation_reason" TEXT, "reversed_at" TIMESTAMP(3), "reversed_by_user_id" TEXT, "reversal_reason" TEXT, CONSTRAINT "financial_obligations_pkey" PRIMARY KEY ("id"), CONSTRAINT "financial_obligations_distribution_id_key" UNIQUE ("distribution_id"), CONSTRAINT "financial_obligations_id_workspace_id_key" UNIQUE ("id", "workspace_id"), CONSTRAINT "financial_obligations_amount_positive" CHECK ("amount" > 0), CONSTRAINT "financial_obligations_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'));
CREATE TABLE "obligation_payments" ("id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "obligation_id" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL, "currency_code" TEXT NOT NULL, "status" "ObligationPaymentStatus" NOT NULL DEFAULT 'effective', "paid_at" TIMESTAMP(3) NOT NULL, "paid_by_user_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reversed_at" TIMESTAMP(3), "reversed_by_user_id" TEXT, "reversal_reason" TEXT, CONSTRAINT "obligation_payments_pkey" PRIMARY KEY ("id"), CONSTRAINT "obligation_payments_obligation_id_key" UNIQUE ("obligation_id"), CONSTRAINT "obligation_payments_amount_positive" CHECK ("amount" > 0), CONSTRAINT "obligation_payments_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'), CONSTRAINT "obligation_payments_reversal_audit" CHECK (("status" = 'effective' AND "reversed_at" IS NULL AND "reversed_by_user_id" IS NULL AND "reversal_reason" IS NULL) OR ("status" = 'reversed' AND "reversed_at" IS NOT NULL AND "reversed_by_user_id" IS NOT NULL AND "reversal_reason" IS NOT NULL)));
CREATE TABLE "finance_idempotency" ("id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "actor_user_id" TEXT NOT NULL, "action_namespace" TEXT NOT NULL, "idempotency_key" TEXT NOT NULL, "request_hash" TEXT NOT NULL, "resource_type" TEXT NOT NULL, "resource_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "finance_idempotency_pkey" PRIMARY KEY ("id"), CONSTRAINT "finance_idempotency_scope_key" UNIQUE ("workspace_id", "actor_user_id", "action_namespace", "idempotency_key"));

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_list_scope_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_production_order_scope_fkey" FOREIGN KEY ("production_order_id", "workspace_id") REFERENCES "production_orders"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_person_scope_fkey" FOREIGN KEY ("technician_person_id", "workspace_id") REFERENCES "people"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_client_scope_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_document_scope_fkey" FOREIGN KEY ("document_id", "workspace_id") REFERENCES "documents"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversed_by_user_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_list_scope_fkey" FOREIGN KEY ("payment_list_id", "workspace_id") REFERENCES "payment_lists"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_item_scope_fkey" FOREIGN KEY ("payment_list_item_id", "payment_list_id", "workspace_id") REFERENCES "payment_list_items"("id", "payment_list_id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_person_scope_fkey" FOREIGN KEY ("participant_person_id", "workspace_id") REFERENCES "people"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_client_scope_fkey" FOREIGN KEY ("participant_client_id", "workspace_id") REFERENCES "clients"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_cancelled_by_user_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_paid_by_user_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_cancelled_by_user_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_reversed_by_user_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "obligation_payments" ADD CONSTRAINT "obligation_payments_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "obligation_payments" ADD CONSTRAINT "obligation_payments_paid_by_user_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "obligation_payments" ADD CONSTRAINT "obligation_payments_reversed_by_user_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "finance_idempotency" ADD CONSTRAINT "finance_idempotency_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_idempotency" ADD CONSTRAINT "finance_idempotency_actor_user_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_distribution_fkey" FOREIGN KEY ("distribution_id", "workspace_id") REFERENCES "distributions"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "obligation_payments" ADD CONSTRAINT "obligation_payments_obligation_fkey" FOREIGN KEY ("obligation_id", "workspace_id") REFERENCES "financial_obligations"("id", "workspace_id") ON DELETE RESTRICT;
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_audit_state" CHECK (("status" = 'pending' AND "paid_at" IS NULL AND "paid_by_user_id" IS NULL AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "reversed_at" IS NULL AND "reversed_by_user_id" IS NULL AND "reversal_reason" IS NULL) OR ("status" = 'paid' AND "paid_at" IS NOT NULL AND "paid_by_user_id" IS NOT NULL AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "reversed_at" IS NULL AND "reversed_by_user_id" IS NULL AND "reversal_reason" IS NULL) OR ("status" = 'cancelled' AND "paid_at" IS NULL AND "paid_by_user_id" IS NULL AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "reversed_at" IS NULL AND "reversed_by_user_id" IS NULL AND "reversal_reason" IS NULL) OR ("status" = 'reversed' AND "paid_at" IS NOT NULL AND "paid_by_user_id" IS NOT NULL AND "reversed_at" IS NOT NULL AND "reversed_by_user_id" IS NOT NULL AND "reversal_reason" IS NOT NULL));

CREATE INDEX "expenses_workspace_id_status_occurred_on_idx" ON "expenses"("workspace_id", "status", "occurred_on");
CREATE INDEX "distributions_workspace_id_payment_list_id_status_idx" ON "distributions"("workspace_id", "payment_list_id", "status");
CREATE INDEX "financial_obligations_workspace_id_status_idx" ON "financial_obligations"("workspace_id", "status");
CREATE INDEX "obligation_payments_workspace_id_status_idx" ON "obligation_payments"("workspace_id", "status");
