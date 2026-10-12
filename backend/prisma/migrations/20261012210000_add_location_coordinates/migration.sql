-- AlterTable
ALTER TABLE "locations" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "is_approximate" BOOLEAN NOT NULL DEFAULT false;
