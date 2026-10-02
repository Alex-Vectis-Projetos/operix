-- Spec 006 R04: Step 1 - Add new PaymentListStatus enum values and commit
ALTER TYPE "PaymentListStatus" ADD VALUE IF NOT EXISTS 'ready_for_billing';
ALTER TYPE "PaymentListStatus" ADD VALUE IF NOT EXISTS 'superseded';
