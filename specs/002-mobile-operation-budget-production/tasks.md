# Tarefas de Execução — Spec 002: Mobile Operation Flow (Final Cleanup)

**Status**: Ready for Implementation  
**Fatia**: R1 — Operação Móvel: Orçamento → Revisões → Aprovação → Produção  

---

## T00: Database Migration Baseline Gate
- **Descrição**: Auditar a integridade do histórico de migrações em `backend/prisma/migrations`. Executar `prisma migrate deploy` contra um banco PostgreSQL descartável temporário para comprovar se o histórico atual é reproduzível a partir do zero. Caso falhe por ausência da migração de baseline das 44 tabelas iniciais, estabelecer o baseline formalmente antes de gerar a migration da Spec 002.
- **DoD**:
  - [x] Histórico de migrações auditado e validado contra banco descartável do zero;
  - [x] Baseline reproduzível estabelecido sem erros (`20260814000000_init_baseline`);
  - [x] Nenhuma migration gerada sobre um histórico inconsistente;
  - [x] Procedimento de dry-run documentado em `docs/runbooks/prisma-migration-baseline.md`.
- **Status de Auditoria**: `T00 PASSED — READY FOR T01` (Zero drift verificado entre banco descartável e `schema.prisma`).

---

## T01: Modelagem e Migração de Orçamentos, Revisões e Fotos
- **Descrição**: Atualizar `backend/prisma/schema.prisma` adicionando os modelos `Budget`, `BudgetRevision`, `BudgetPhoto`, o campo `type` em `Workspace`, as chaves estrangeiras `currentRevisionId` e `approvedRevisionId`, e as colunas `budgetId` (`@unique`) e `budgetRevisionId` em `ProductionOrder` com relação composta. Criar e aplicar migração versionada.
- **DoD**:
  - [x] Modelos `Budget`, `BudgetRevision`, `BudgetPhoto` definidos com campos monetários em `Decimal(12, 2)` e `currencyCode: "EUR"`;
  - [x] Relações explícitas com `Workspace`, `Client`, `User` e `ProductionOrder`;
  - [x] Chaves estrangeiras de retorno `currentRevisionId` e `approvedRevisionId` em `Budget`;
  - [x] Relação composta garantindo que `budgetRevisionId` pertença ao mesmo `budgetId` na `ProductionOrder`;
  - [x] Constraint `@@unique([workspaceId, code])` e `@@unique([workspaceId, legacyLocalId])` em `Budget`;
  - [x] Índice único parcial para personal workspaces no PostgreSQL (`workspaces_owner_user_id_personal_key`);
  - [x] `npx prisma generate` executa sem erros.
- **Status de Auditoria**: `T01 PASSED` (Migração `20260914150000_spec_002_mobile_operation_budget_production` aplicada com ZERO drift verificado).

---

## T02: Criação da Suíte de Testes Automatizados da Fatia (Test-First)
- **Descrição**: Criar arquivo `tests/integration/budget-production-flow.test.ts` cobrindo todas as invariantes e cenários comportamentais antes de implementar os endpoints.
- **DoD**:
  - [x] Testes cobrindo:
    - Isolamento de tenant A vs B em orçamentos, revisões e ordens (`TENANT-01`);
    - Cardinalidade 1:0..1: re-aprovação com OP aberta atualiza a mesma OP conforme a whitelist estrita (`PO-01`, `PO-02`);
    - Imutabilidade de revisão aprovada: edição gera revisão 2 em rascunho e preserva a 1 intacta (`REVISION-01`, `REVISION-02`);
    - Ponteiros `currentRevisionId` vs `approvedRevisionId` sem coluna `status` duplicada em `Budget`;
    - Rejeição de `clientId` de outro workspace (`CLIENT-01`);
    - Regras de atribuição de técnico (`TECH-OWN-01`);
    - Execução do fluxo completo por técnico independente em personal workspace (`PERSONAL-01`, `PERSONAL-UNIQUE-01`);
    - Idempotência concorrente de migração de `localStorage` (`SYNC-01`);
    - Integridade composta de linhagem da OP (`PO-03`);
    - Concorrência de aprovação dupla simultânea (`CONCURRENT-01`);
    - Fluxo de OP direta (`DIRECT-OP-01`);
  - [x] Testes rodam com `vitest run` confirmando o comportamento esperado:
    - Grupo A (Estrutural/Invariantes de Banco): 7 testes **GREEN**;
    - Grupo B (Comportamental/Serviços não implementados): 8 testes **RED** esperados.
- **Status de Auditoria**: `T02 RED BASELINE ESTABLISHED — READY FOR T03-T08`.

---

## T03: Provisionamento e Ciclo de Vida do Personal Workspace (ADR-002)
- **Descrição**: Implementar a lógica de provisionamento de Personal Workspace para técnicos independentes no serviço de autenticação/workspaces e no middleware `requestContext` (lazy-provisioning para técnicos autônomos sem workspace ativo), garantindo no máximo 1 personal workspace por `AppUser`.
- **DoD**:
  - [x] Criação de workspace com `type = "personal"` e `ownerUserId` vinculado ao `AppUser.id`;
  - [x] Proteção contra múltiplos workspaces pessoais via índice único parcial;
  - [x] Resolução automática no `requestContext` na ausência de cabeçalho `X-Workspace-Id`;
  - [x] Validação server-side estrita de `X-Workspace-Id` (seletor não-confiável);
  - [x] Teste automatizado cobrindo o ciclo de vida do personal workspace (`PERSONAL-LIFE-01`, `PERSONAL-RES-01`).
- **Status de Auditoria**: `T03 PASSED` (`provisionPersonalWorkspace` + `POST /api/workspaces/personal` + auto-resolução no `requestContext`).

---

## T04: Endpoints de Clientes Operacionais (`/api/clients`)
- **Descrição**: Criar rotas leves de leitura e criação para o modelo `Client` em `backend/src/routes/clients.ts`, protegidas por `resolveRequestContext`.
- **DoD**:
  - [x] `GET /api/clients`: retorna clientes filtrados por `ctx.activeWorkspaceId` e status ativo;
  - [x] `POST /api/clients`: cadastra cliente validando payload com Zod e associando a `ctx.activeWorkspaceId`;
  - [x] Rejeição estrita de vinculação cross-tenant de clientes (`CLIENT-CRUD-01`, `CLIENT-ISOLATION-01`).
- **Status de Auditoria**: `T04 PASSED` (Router montado em `/api/clients`, isolamento estrito com 404 para evitar enumeração e 100% de testes verdes).

---

## T05: Serviço de Domínio de Orçamentos (`budgetService.ts`)
- **Descrição**: Implementar `backend/src/services/budgetService.ts` com a lógica de negócio: cálculo decimal, geração concorrente segura de código (`code`), imutabilidade de revisões aprovadas, auditoria, whitelist de campos de re-aprovação e aprovação transacional idempotente (1:0..1 com `ProductionOrder`).
- **DoD**:
  - [x] Geração atômica de código sequencial por workspace (`generateBudgetCode`);
  - [x] Criação de revisão rascunho ao editar orçamento aprovado sem mutar a versão anterior (`updateBudgetRevision`);
  - [x] Aprovação transacional (`prisma.$transaction`) exigindo `revisionId` explícito (409 em caso de estado divergente);
  - [x] Re-aprovação aplica estritamente a whitelist permitida sem sobrescrever status operacional, timestamps de execução, apontamento de técnico ou fotos (`approveBudgetRevision`);
  - [x] Rejeição de aprovação com erro 422 se a OP já estiver finalizada (`delivered`);
  - [x] Todos os cálculos monetários processados com `Prisma.Decimal` (`calculateRevisionTotals`).
- **Status de Auditoria**: `T05 PASSED` (8 testes unitários e comportamentais de domínio no Grupo C 100% GREEN: `DECIMAL-01`, `SERVICE-BUDGET-01`, `SERVICE-CLIENT-CROSS-01`, `SERVICE-REVISION-IMMUTABLE-01`, `SERVICE-APPROVE-TRANSACTION-01`, `SERVICE-DELIVERED-LOCK-01`, `SERVICE-REJECT-01`, `SERVICE-SYNC-LOCAL-01`).

---

## T06: Endpoints da API de Orçamentos e Revisões com `revisionId` Explícito (`/api/budgets`)
- **Descrição**: Criar rotas REST em `backend/src/routes/budgets.ts` protegidas por `resolveRequestContext` e validação Zod, exigindo `revisionId` explícito em aprovações e rejeições.
- **DoD**:
  - [x] `GET /api/budgets`: lista orçamentos do workspace ativo com filtros;
  - [x] `POST /api/budgets`: cria orçamento e primeira revisão;
  - [x] `GET /api/budgets/:id`: retorna orçamento com revisão ativa;
  - [x] `GET /api/budgets/:id/revisions`: retorna histórico de revisões;
  - [x] `PUT /api/budgets/:id/revisions/:revisionId`: atualiza rascunho ou gera nova revisão;
  - [x] `POST /api/budgets/:id/revisions/:revisionId/reject`: registra rejeição com motivo formal;
  - [x] `POST /api/budgets/:id/revisions/:revisionId/approve`: aprova revisão indicada e integra com OP;
  - [x] `POST /api/budgets/:id/photos`: upload e metadados de `BudgetPhoto` usando UUID canônico;
  - [x] `GET /api/budgets/:id/photos`: listagem com presigned URLs temporárias;
  - [x] `POST /api/budgets/sync-local`: migração idempotente de orçamentos do `localStorage`;
  - [x] Todos os endpoints validam `assertTenantAccess` e `assertObjectAccess`.
- **Status de Auditoria**: `T06 PASSED` (100% dos 8 testes de aceitação comportamental do Grupo B GREEN: `BUDGET-API-01`, `REVISION-01`, `REVISION-02`, `REJECT-01`, `APPROVE-01`, `PO-02`, `CONCURRENT-01`, `TENANT-01`. Total na suíte: 31/31 GREEN).

---

## T07: Proteção e Adequação de `productionOrders.ts` ao RequestContext
- **Descrição**: Refatorar `backend/src/routes/productionOrders.ts` para eliminar a dependência de `workspace_id` do cliente e aplicar `resolveRequestContext`.
- **DoD**:
  - [ ] `resolveRequestContext` aplicado em 100% das rotas;
  - [ ] `GET /` e `POST /` utilizam `req.ctx.activeWorkspaceId`;
  - [ ] `PATCH /:id` e `DELETE /:id` validam tenant e permissão de objeto;
  - [ ] Validação das regras de atribuição de técnico `TECH-ASSIGN-01` e `TECH-ASSIGN-02`;
  - [ ] Suporte à criação de ordem direta com `budgetId: null`.

---

## T08: Governança de Storage e Upload de Fotos com UUIDs Canônicos (`storage.ts` e `productionPhotos.ts`)
- **Descrição**: Refatorar rotas de storage e fotos para garantir autorização server-side, chaves no MinIO com UUIDs canônicos e eliminação de tokens JWT na query string.
- **DoD**:
  - [ ] Backend gera chaves com prefixo seguro `tenants/{workspaceId}/budgets/{budgetId}/{photoId}.jpg` e `tenants/{workspaceId}/production-orders/{orderId}/{photoId}.jpg`;
  - [ ] URLs temporárias de download geradas via presigned URL (máximo 15 min de TTL);
  - [ ] Upload e exclusão validam que a entidade pertence ao tenant ativo;
  - [ ] Bloqueio comprovado de acesso cross-tenant a arquivos.

---

## T09: Sincronização Assistida e Idempotente do LocalStorage (`legacyLocalId`)
- **Descrição**: Implementar rota `POST /api/budgets/sync-local` e componente frontend com banner/diálogo para migração controlada de dados legados do `localStorage` protegida por `@@unique([workspaceId, legacyLocalId])`.
- **DoD**:
  - [ ] Banner exibido apenas quando orçamentos locais são detectados;
  - [ ] Confirmação explícita do usuário antes do envio;
  - [ ] Backend garante idempotência concorrente via chave única no PostgreSQL;
  - [ ] Chaves locais são limpas/arquivadas apenas após confirmação 200/201 do servidor.

---

## T10: Cliente Frontend e Hook de Orçamentos (`apiBudgets.ts` e `useBudgets.ts`)
- **Descrição**: Criar cliente HTTP no frontend e hook TanStack Query para orçamentos, eliminando `localStorage` como fonte da verdade.
- **DoD**:
  - [ ] `apiBudgets.ts` tipado para listar, criar, revisar, rejeitar, aprovar e enviar fotos com `revisionId` explícito;
  - [ ] `useBudgets.ts` fornece queries e mutations com toast e invalidação automática de cache;
  - [ ] Sincronização de tipos de estado e revisão com o backend.

---

## T11: Adaptação das Telas `BudgetPanel.tsx` e `BudgetDialog.tsx`
- **Descrição**: Conectar as telas de orçamento à API remota, migrando o salvamento para o PostgreSQL, enviando `revisionId` explícito nas aprovações/rejeições e apontando o autocomplete de clientes para `/api/clients`.
- **DoD**:
  - [ ] Orçamentos listados em `BudgetPanel.tsx` vêm da API;
  - [ ] `BudgetDialog.tsx` salva e versiona via API remota;
  - [ ] Assinatura salva imagem no MinIO e metadados no banco;
  - [ ] Autocomplete de cliente busca de `/api/clients` com criação rápida;
  - [ ] Ajustes de CSS responsivo para visualização sem quebras em 360px.

---

## T12: Adaptação de `OrderDetailDialog.tsx` e Saneamento de Linter
- **Descrição**: Atualizar `OrderDetailDialog.tsx` para ler dados diretamente da revisão aprovada via `order.budgetId`, mantendo fallback para `notes` em ordens legadas, e corrigir todos os erros pré-existentes de lint do arquivo.
- **DoD**:
  - [ ] Exibição prioritária a partir da relação com `BudgetRevision`;
  - [ ] Fallback preservado para ordens legadas com orçamento em `notes`;
  - [ ] Todos os erros de linter em `OrderDetailDialog.tsx` corrigidos.

---

## T13: Validação Final dos Quality Gates e Linter
- **Descrição**: Executar toda a suíte de testes, typecheck e linter, verificando ausência de regressões e integridade de tenant.
- **DoD**:
  - [ ] Todos os testes em `tests/integration/budget-production-flow.test.ts` passam (100%);
  - [ ] `npm run typecheck` conclui com zero erros;
  - [ ] `npm run lint` conclui com 0 novos erros em relação ao baseline de `develop/operix-core`;
  - [ ] Nenhuma informação confidencial registrada em logs.
