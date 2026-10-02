-- AlterTable
ALTER TABLE "client_access_grants" ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY['weeklog.validate']::TEXT[],
ADD COLUMN "site_key" TEXT;
