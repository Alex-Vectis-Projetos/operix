-- Add stage tracking, routing and pause tracking to production_orders
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "current_stage" TEXT DEFAULT 'awaiting_start';
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "recommended_route" JSONB;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "stage_history" JSONB;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "paused_reason" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "paused_previous_stage" TEXT;

-- Safe backfill for existing production orders
UPDATE "production_orders"
SET "current_stage" = CASE
  WHEN "status" = 'delivered' THEN 'finished'
  WHEN "status" = 'finished' THEN 'finished'
  WHEN "status" = 'paused' THEN 'awaiting_start'
  WHEN "status" = 'in_production' THEN 'disassembly'
  ELSE 'awaiting_start'
END
WHERE "current_stage" IS NULL OR "current_stage" = 'awaiting_start';
