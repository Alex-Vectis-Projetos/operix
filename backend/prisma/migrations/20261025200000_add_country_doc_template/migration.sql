-- AlterTable
ALTER TABLE "country_document_requirements" ADD COLUMN IF NOT EXISTS "template_storage_path" TEXT;
ALTER TABLE "country_document_requirements" ADD COLUMN IF NOT EXISTS "template_file_name" TEXT;
