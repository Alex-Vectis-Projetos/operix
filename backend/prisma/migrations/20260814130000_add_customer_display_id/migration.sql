-- Migration: add_customer_display_id (não destrutiva)
-- Objetivo: adicionar ID comercial sequencial C-00001 por workspace ao BillingClient
-- Não apaga nenhum dado, não altera PKs, não modifica UUIDs existentes.

ALTER TABLE "billing_clients"
ADD COLUMN IF NOT EXISTS "customer_display_num" INTEGER;

ALTER TABLE "billing_clients"
ADD COLUMN IF NOT EXISTS "customer_display_id" TEXT;

-- Garante unicidade de C-XXXXX por workspace
CREATE UNIQUE INDEX IF NOT EXISTS "billing_clients_workspace_id_customer_display_num_key"
  ON "billing_clients" ("workspace_id", "customer_display_num");

-- Garante que o display_id formatado é único global
CREATE UNIQUE INDEX IF NOT EXISTS "billing_clients_customer_display_id_key"
  ON "billing_clients" ("customer_display_id");
