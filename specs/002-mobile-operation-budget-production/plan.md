# Plano de Implementação — Spec 002: Mobile Operation Flow (Final Cleanup)

**Data**: 2026-09-14  
**Status**: Ready for Implementation  
**Branch**: `feat/002-mobile-operation-budget-production`  
**Base**: `develop/operix-core`  

---

## 1. Arquivos Envolvidos

### Arquivos a Criar:
- `docs/adr/002-personal-workspace-lifecycle.md`: Registro formal da decisão de ciclo de vida do personal workspace.
- `backend/prisma/migrations/20260914_002_budget_and_production_flow/migration.sql`: Migração versionada do PostgreSQL criando `budgets`, `budget_revisions`, `budget_photos`, adicionando colunas `budget_id` (@unique) e `budget_revision_id` em `production_orders` com FK composta, e `type` em `workspaces` com índice único parcial.
- `backend/src/routes/budgets.ts`: Router Express para o ciclo de vida do orçamento (criação, consulta, histórico de revisões, rejeição com `revisionId`, aprovação com `revisionId`, fotos e sync de localStorage).
- `backend/src/services/budgetService.ts`: Serviço de domínio: cálculo decimal, geração concorrente de código (`code`), imutabilidade de revisões aprovadas, auditoria, whitelist de campos de re-aprovação e aprovação transacional idempotente (1:0..1 com `ProductionOrder`).
- `backend/src/routes/clients.ts`: Router Express para clientes operacionais (`model Client`), protegido por `RequestContext`.
- `src/lib/apiBudgets.ts`: Camada cliente HTTP com tipagem estrita para a API de orçamentos, revisões e fotos.
- `src/hooks/useBudgets.ts`: Hook TanStack Query gerenciando cache, sincronização e mutations com feedback visual (toast).
- `tests/integration/budget-production-flow.test.ts`: Suíte de testes de integração automatizados ponta a ponta.

### Arquivos a Alterar:
- `backend/prisma/schema.prisma`:
  - Adição dos modelos `Budget`, `BudgetRevision`, `BudgetPhoto`;
  - Remoção de `Budget.status` em favor de `currentRevisionId` e `approvedRevisionId`;
  - Adição de `type String @default("company")` em `Workspace`;
  - Adição de `budgetId String? @unique` e `budgetRevisionId String?` em `ProductionOrder` com relação composta;
  - Adição de `@@unique([workspaceId, legacyLocalId])` em `Budget`.
- `backend/src/server.ts`: Registro dos routers `/api/budgets` e `/api/clients`.
- `backend/src/routes/productionOrders.ts`:
  - Aplicação de `resolveRequestContext`;
  - Eliminação de confiança em `workspace_id` do cliente;
  - Aplicação de `assertTenantAccess`, `assertObjectAccess`, `TECH-ASSIGN-01` e `TECH-ASSIGN-02`.
- `backend/src/routes/productionPhotos.ts`:
  - Proteção por `resolveRequestContext` e `assertTenantAccess`.
- `backend/src/routes/storage.ts`:
  - Chaves determinísticas no MinIO baseadas em UUIDs canônicos;
  - Bloqueio de caminhos arbitrários;
  - Presigned URLs temporárias com TTL de 15 minutos (sem JWT na query string).
- `src/components/production/BudgetPanel.tsx`:
  - Migração de `localStorage` para o hook `useBudgets`;
  - Diálogo de sincronização assistida e idempotente com banner de confirmação.
- `src/components/production/BudgetDialog.tsx`:
  - Atualização do formulário para salvar e versionar via API remota;
  - Aprovação e rejeição enviando `revisionId` explícito;
  - Autocomplete de clientes consumindo `/api/clients`;
  - Ajustes de CSS responsivo para telas de 360px.
- `src/components/production/OrderDetailDialog.tsx`:
  - Leitura a partir de `order.budgetId` e da revisão aprovada;
  - Fallback retroativo para leitura de `notes` em ordens legadas;
  - Saneamento dos erros de linter existentes no arquivo.
- `src/hooks/useProductionPhotos.ts`:
  - Adequação do upload para a rota com governança de tenant.

---

## 2. Schema e Migração Relacional (Expand-Contract)

```sql
-- Migration: 20260914_002_budget_and_production_flow

-- 1. Adicionar tipo ao workspace e índice parcial para personal workspace
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'company';
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_owner_user_id_personal_key" 
ON "workspaces"("owner_user_id") WHERE "type" = 'personal';

-- 2. Tabela agregadora de Orçamentos (sem duplicação de status)
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "vehicle_plate" TEXT,
    "vehicle_vin" TEXT,
    "vehicle_brand" TEXT,
    "vehicle_model" TEXT,
    "current_revision_number" INTEGER NOT NULL DEFAULT 1,
    "current_revision_id" TEXT,
    "approved_revision_id" TEXT,
    "technician_user_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "legacy_local_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "budgets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "budgets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "budgets_technician_user_id_fkey" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 3. Tabela de Revisões Imutáveis
CREATE TABLE "budget_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budget_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency_code" TEXT NOT NULL DEFAULT 'EUR',
    "budget_type" TEXT NOT NULL DEFAULT 'pdr',
    "client_snapshot" JSONB NOT NULL,
    "vehicle_snapshot" JSONB NOT NULL,
    "dossier_snapshot" JSONB,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "services" JSONB NOT NULL DEFAULT '[]',
    "labor" JSONB NOT NULL DEFAULT '[]',
    "intervention_types" TEXT[],
    "diagnosis" TEXT,
    "technical_description" TEXT,
    "gross_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "signature" JSONB,
    "rejection" JSONB,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budget_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "budget_revisions_id_budget_id_key" UNIQUE ("id", "budget_id")
);

-- Chaves estrangeiras de retorno em budgets
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_current_revision_id_fkey" 
FOREIGN KEY ("current_revision_id") REFERENCES "budget_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_revision_id_fkey" 
FOREIGN KEY ("approved_revision_id") REFERENCES "budget_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Tabela de Fotos do Orçamento
CREATE TABLE "budget_photos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budget_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "caption" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budget_photos_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "budget_photos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5. Índices de integridade e unicidade
CREATE UNIQUE INDEX "budgets_workspace_id_code_key" ON "budgets"("workspace_id", "code");
CREATE UNIQUE INDEX "budgets_workspace_id_legacy_local_id_key" ON "budgets"("workspace_id", "legacy_local_id");
CREATE INDEX "budgets_vehicle_plate_idx" ON "budgets"("vehicle_plate");
CREATE UNIQUE INDEX "budget_revisions_budget_id_revision_number_key" ON "budget_revisions"("budget_id", "revision_number");
CREATE INDEX "budget_revisions_budget_id_status_idx" ON "budget_revisions"("budget_id", "status");
CREATE INDEX "budget_photos_budget_id_idx" ON "budget_photos"("budget_id");

-- 6. Vínculo 1:0..1 em production_orders com foreign key composta
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "budget_id" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "budget_revision_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_budget_id_key" ON "production_orders"("budget_id");
CREATE INDEX IF NOT EXISTS "production_orders_budget_revision_id_idx" ON "production_orders"("budget_revision_id");

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_id_fkey" 
FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_budget_revision_id_budget_id_fkey" 
FOREIGN KEY ("budget_revision_id", "budget_id") REFERENCES "budget_revisions"("id", "budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
```

---

## 3. Ordem Sequencial de Implementação (T00 a T13)

```text
FASE 0: Baseline de Migrações
  └─ T00: Database Migration Baseline Gate

FASE 1: Modelagem e Testes Automatizados (Test-First)
  └─ T01: Atualização do schema.prisma e geração da migration versionada
  └─ T02: Escrita da suíte de testes de integração (tests/integration/budget-production-flow.test.ts)

FASE 2: Backend Core & Serviços de Domínio
  └─ T03: Provisionamento e Ciclo de Vida do Personal Workspace (ADR-002)
  └─ T04: Endpoints de Clientes Operacionais (/api/clients)
  └─ T05: Serviço de Domínio de Orçamentos (budgetService.ts) com cardinalidade 1:0..1 e whitelist
  └─ T06: Endpoints da API de Orçamentos e Revisões com revisionId explícito (/api/budgets)
  └─ T07: Proteção e Adequação de productionOrders.ts ao RequestContext
  └─ T08: Governança de Storage e Upload de Fotos com UUIDs canônicos (storage.ts e productionPhotos.ts)

FASE 3: Frontend Integration & Mobile-First
  └─ T09: Sincronização Assistida e Idempotente do LocalStorage (legacyLocalId)
  └─ T10: Cliente Frontend e Hook TanStack Query (apiBudgets.ts e useBudgets.ts)
  └─ T11: Adaptação das Telas BudgetPanel.tsx e BudgetDialog.tsx
  └─ T12: Adaptação de OrderDetailDialog.tsx e Saneamento de Linter
  └─ T13: Validação Final dos Quality Gates e Linter (0 novos erros de lint)
```

---

## 4. Estratégia de Rollout e Rollback Seguro (Não-Destrutivo)

- **Rollout**: A migração é aditiva (*Expand*): cria tabelas e adiciona colunas anuláveis sem quebrar dados existentes.
- **Rollback Seguro**: Em caso de reversão de deploy, reverte-se apenas o código da aplicação. As tabelas e colunas permanecem intactas no banco sem execução de comandos destrutivos (`DROP TABLE`), preservando os dados criados.
