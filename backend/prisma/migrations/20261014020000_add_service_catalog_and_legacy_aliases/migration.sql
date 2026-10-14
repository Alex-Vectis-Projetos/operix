-- Migration: 20261014020000_add_service_catalog_and_legacy_aliases
-- Spec: CATALOG-001 (Catálogo automotivo global, normalização e enriquecimento)

-- 1. Categorias de Serviço
CREATE TABLE IF NOT EXISTS "service_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_categories_code_key" UNIQUE ("code"),
    CONSTRAINT "service_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 2. Traduções de Categoria
CREATE TABLE IF NOT EXISTS "service_category_translations" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "service_category_translations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_category_translations_category_id_locale_key" UNIQUE ("category_id", "locale"),
    CONSTRAINT "service_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3. Itens do Catálogo de Serviço (Globais ou Locais do Workspace)
CREATE TABLE IF NOT EXISTS "service_catalog_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workspace_id" TEXT,
    "category_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL DEFAULT 'repair',
    "unit_type" TEXT NOT NULL DEFAULT 'service',
    "requires_vehicle_region" BOOLEAN NOT NULL DEFAULT false,
    "requires_quantity" BOOLEAN NOT NULL DEFAULT false,
    "default_stage_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_catalog_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_catalog_items_id_workspace_id_key" UNIQUE ("id", "workspace_id"),
    CONSTRAINT "service_catalog_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_catalog_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "service_catalog_items_category_id_is_active_idx" ON "service_catalog_items"("category_id", "is_active");
CREATE INDEX IF NOT EXISTS "service_catalog_items_workspace_id_is_active_idx" ON "service_catalog_items"("workspace_id", "is_active");

-- Índices parciais para unicidade de code (global vs tenant)
CREATE UNIQUE INDEX IF NOT EXISTS "service_catalog_items_global_code_uq"
  ON "service_catalog_items" ("code") WHERE "workspace_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "service_catalog_items_local_code_uq"
  ON "service_catalog_items" ("workspace_id", "code") WHERE "workspace_id" IS NOT NULL;

-- 4. Traduções dos Itens de Catálogo
CREATE TABLE IF NOT EXISTS "service_catalog_translations" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "service_catalog_translations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_catalog_translations_item_id_locale_key" UNIQUE ("item_id", "locale"),
    CONSTRAINT "service_catalog_translations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "service_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5. Configurações e Preços Sugeridos por Workspace
CREATE TABLE IF NOT EXISTS "workspace_service_configs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "custom_label" TEXT,
    "default_price" DECIMAL(12, 2),
    "currency_code" TEXT,
    "default_stage_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_service_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_service_configs_workspace_id_catalog_item_id_key" UNIQUE ("workspace_id", "catalog_item_id"),
    CONSTRAINT "workspace_service_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_service_configs_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "service_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 6. Aliases de Reconciliação com Catálogo Legado
CREATE TABLE IF NOT EXISTS "legacy_service_aliases" (
    "id" TEXT NOT NULL,
    "legacy_category" TEXT NOT NULL,
    "legacy_label" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "catalog_item_id" TEXT,
    "disposition" TEXT NOT NULL DEFAULT 'service_candidate',
    "target_code" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_service_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legacy_service_aliases_legacy_category_legacy_label_locale_key" UNIQUE ("legacy_category", "legacy_label", "locale"),
    CONSTRAINT "legacy_service_aliases_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "service_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 7. Vínculo Aditivo Opcional em ProductionTask
ALTER TABLE "production_tasks" ADD COLUMN IF NOT EXISTS "catalog_item_id" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'production_tasks_catalog_item_id_fkey'
    ) THEN
        ALTER TABLE "production_tasks"
            ADD CONSTRAINT "production_tasks_catalog_item_id_fkey"
            FOREIGN KEY ("catalog_item_id") REFERENCES "service_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
