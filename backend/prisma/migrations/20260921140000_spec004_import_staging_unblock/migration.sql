-- Spec 004 T05: make provenance lifecycle representable without fake storage keys.
ALTER TABLE "external_list_imports"
  ALTER COLUMN "storage_path" DROP NOT NULL,
  ALTER COLUMN "file_sha256" DROP NOT NULL,
  ALTER COLUMN "mime_type" DROP NOT NULL,
  ALTER COLUMN "size_bytes" DROP NOT NULL,
  ADD COLUMN "reviewed_client_id" TEXT,
  ADD COLUMN "reviewed_currency_code" TEXT;

ALTER TABLE "external_operational_imports"
  ALTER COLUMN "storage_path" DROP NOT NULL,
  ALTER COLUMN "file_sha256" DROP NOT NULL,
  ALTER COLUMN "mime_type" DROP NOT NULL,
  ALTER COLUMN "size_bytes" DROP NOT NULL;

ALTER TABLE "external_operational_import_items"
  ADD COLUMN "raw_vin" TEXT,
  ADD COLUMN "raw_client_name" TEXT,
  ADD COLUMN "raw_currency_code" TEXT,
  ADD COLUMN "raw_operational_site_key" TEXT,
  ADD COLUMN "raw_delivered_at_text" TEXT,
  ADD COLUMN "reviewed_vin" TEXT,
  ADD COLUMN "reviewed_client_id" TEXT,
  ADD COLUMN "reviewed_currency_code" TEXT,
  ADD COLUMN "reviewed_operational_site_key" TEXT,
  ADD COLUMN "reviewed_delivered_at" TIMESTAMP(3);

ALTER TABLE "external_list_imports"
  ADD CONSTRAINT "external_list_imports_reviewed_client_id_workspace_id_fkey"
  FOREIGN KEY ("reviewed_client_id", "workspace_id")
  REFERENCES "clients"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_operational_import_items"
  ADD CONSTRAINT "external_operational_import_items_reviewed_client_id_workspace_id_fkey"
  FOREIGN KEY ("reviewed_client_id", "workspace_id")
  REFERENCES "clients"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
