-- AlterTable
ALTER TABLE "client_access_grants" ALTER COLUMN "capabilities" SET DEFAULT ARRAY[]::TEXT[];
