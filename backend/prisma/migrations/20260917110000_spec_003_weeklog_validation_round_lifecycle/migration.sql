-- AlterTable
ALTER TABLE "weeklog_validations" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "submitted_by" TEXT,
ALTER COLUMN "validator_user_id" DROP NOT NULL,
ALTER COLUMN "validation_method" DROP NOT NULL,
ALTER COLUMN "validated_at" DROP NOT NULL,
ALTER COLUMN "validated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "weeklog_validations" ADD CONSTRAINT "weeklog_validations_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
