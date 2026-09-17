-- 1. Alter column submitted_at: drop default and make nullable first so it can receive NULL
ALTER TABLE "weeklog_validations" ALTER COLUMN "submitted_at" DROP DEFAULT;
ALTER TABLE "weeklog_validations" ALTER COLUMN "submitted_at" DROP NOT NULL;

-- 2. For historical legacy validations that have validatorUserId, validationMethod, validatedAt:
-- set status to 'validated' and nullify submitted_at so we don't fabricate submission timestamps
UPDATE "weeklog_validations"
SET "status" = 'validated',
    "submitted_at" = NULL
WHERE "status" = 'pending'
  AND "submitted_by" IS NULL
  AND "validator_user_id" IS NOT NULL
  AND "validation_method" IS NOT NULL
  AND "validated_at" IS NOT NULL;
