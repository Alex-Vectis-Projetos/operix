-- Workspace Branding (Name, Logo URL, Typography & Brand Config)
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "brand_config" JSONB DEFAULT '{}'::jsonb;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
