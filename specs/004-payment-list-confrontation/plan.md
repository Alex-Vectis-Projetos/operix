# Plano de Implementação Técnica — Spec 004 (Hardening Final Pré-Test-First)

**Fatia**: R2 — Lista de Pagamento, Importação Externa, Confronto Operacional e Fronteira Financeira  
**Branch**: `feat/004-payment-list-confrontation`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-18 (Hardening Final Pré-Test-First)  

---

## 1. Abordagem de Engenharia e Fatias Verticais

A implementação da Spec 004 seguirá estritamente o ciclo de engenharia em 7 passos da Constituição Operix (`UNDERSTAND` $\rightarrow$ `PLAN` $\rightarrow$ `TEST FIRST` $\rightarrow$ `IMPLEMENT` $\rightarrow$ `VERIFY` $\rightarrow$ `SELF-REVIEW` $\rightarrow$ `HANDOFF`). 

O plano divide a entrega em **fatias verticais progressivas e auditáveis**:
1. **Fatia Relacional & Migração Forward-Only**:
   - Modelos canônicos: `PaymentList` (com `@@unique([id, workspaceId])` e `@@unique([workspaceId, listNumber])`), `PaymentListItem` (com `@@unique([id, paymentListId, workspaceId])`), `PaymentListEntryClaim`, `PaymentListConfrontationRun`, `PaymentListConfrontationResult`, `ExternalListImport`, `ExternalListImportItem`, `ExternalOperationalImport`, `ExternalOperationalImportItem`, `TenantSequenceCounter`.
   - Evolução de `WeeklogEntry`: inclusão de `sourceType` ("production_order" | "external_import") com XOR estrutural e unicidade em `externalImportItemId`.
   - `20260921140000_spec004_import_staging_unblock`: proveniência nullable antes da promoção, authority revisada por staging e FKs compostas de cliente tenant-safe, sem alterar dados existentes.
2. **Fatia de Storage & Ingestão com Staging Relacional**:
   - Upload governado no MinIO, cálculo SHA-256 e persistência em `ExternalListImport` + `ExternalListImportItem` (preservando `rawTotalText`).
   - O serviço T05 cria cabeçalho sem path fictício quando a promoção falha; depois de promoção bem-sucedida, persiste `storagePath`, `fileSha256`, `mimeType` e `sizeBytes`. Antes de marcar `reviewed` ou materializar, valida moeda ISO, cliente do tenant e todos os campos revisados exigidos.
   - Para WEEKLOG externo, `reviewedDeliveredAt` determina a semana operacional porque a Spec 003 usa `WeeklogEntry.deliveredAt` como instante canônico. `reviewedTechnicianUserId` é validado via `Membership`/`AppUser` pelo serviço: a identidade atual não possui chave composta segura compatível com o `User.id` operacional.
   - Retry de extração é explícito e condicionado a `failed` sem linhas de staging; a mudança condicional de estado serializa concorrência, reutiliza o objeto original e bloqueia qualquer substituição de dados revisados. A evidência dinâmica permanece pendente enquanto o PostgreSQL local de testes estiver indisponível.
3. **Fatia de Domínio da Lista, Numeração Atômica & Claims Semânticos**:
   - Máquina de estados formal: `draft` $\rightarrow$ `under_review` $\rightarrow$ `confronted` $\rightarrow$ `pending` $\rightarrow$ `paid`.
   - Alocador sequencial monotônico via lock pessimista no PostgreSQL.
   - Garantia de Anti-Double-Billing via partial unique index em `payment_list_entry_claims` (`WHERE status IN ('reserved', 'consumed')`).
4. **Fatia do Motor de Confronto Comercial Versionado**:
   - Rodadas em `PaymentListConfrontationRun` com pareamento único por run.
   - Algoritmo tríade (veículo, serviços, valores) gravando em `PaymentListConfrontationResult`.
   - Idempotência e bloqueio de rerun automático caso existam decisões humanas ativas.
   - Bloqueio de avanço para `pending` em caso de disputas abertas (`CONTEST` ou `REQUEST_RECTIFICATION`).
5. **Fatia de Linhagem e Retificação**:
   - Integração da decisão `REQUEST_RECTIFICATION` com `rectifyWeeklogEntry` da Spec 003, auditando `reopenedProductionOrderId` e `targetExecutionSequence`.
6. **Fatia de Projeção Downstream & Transição de Call Sites Legados**:
   - Sincronização estritamente unidirecional com a tabela legada `payment_orders`.
   - Sanitização de `backend/src/routes/paymentOrders.ts` (somente-leitura / deprecated).
   - Desativação do endpoint destrutivo `/finance/reconciliations/run`.
7. **Fatia de Adaptação do Frontend**:
   - Erradicação de 100% dos imports de `@/integrations/supabase/client`.
   - Hooks TanStack Query apontando para as rotas REST canônicas.
   - Interface de conferência lado a lado e tela de confronto comercial integrada em Operações.

---

## 2. Estratégia de Banco de Dados e Migração Forward-Only

### 2.1. Princípio Expand-Contract
- Nenhuma coluna ou tabela legada (`payment_orders`, `production_lists`, `reconciliations`) será deletada nesta migração.
- A migração será estritamente **forward-only** (`prisma migrate dev` gerando arquivo versionado sequencial).
- O schema adicionará as tabelas canônicas mantendo compatibilidade com as tabelas legadas através do Downstream Adapter.

### 2.2. DDL Essencial da Migração
1. **Criação dos Enums**:
   - `PaymentListStatus`: `draft`, `under_review`, `confronted`, `pending`, `paid`, `cancelled`.
   - `ConfrontationStatus`: `not_evaluated`, `exact_match`, `ambiguous_match`, `value_difference`, `service_discrepancy`, `vehicle_not_found`, `unmatched_weeklog`.
   - `ConfrontationDecision`: `none`, `accept_difference`, `contest`, `request_rectification`, `reject_item`.
   - `ImportStatus`: `uploaded`, `extracting`, `extracted`, `under_review`, `reviewed`, `committed`, `failed`, `discarded`.
2. **Criação da Tabela `payment_lists`**:
   - `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.
   - `list_number VARCHAR(16) NOT NULL`, `client_id UUID NOT NULL`.
   - `currency_code VARCHAR(3) NOT NULL` (sem default; 3 letras maiúsculas ISO-4217).
   - `status payment_list_status NOT NULL DEFAULT 'draft'`.
   - `item_count INT NOT NULL DEFAULT 0`.
   - `source_document_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00`.
   - `recognized_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00`.
   - Constraints:
     - `UNIQUE (workspace_id, list_number)`
     - `UNIQUE (id, workspace_id)` (para composite FKs de tenant em filhas).
3. **Criação da Tabela `payment_list_items`**:
   - `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `payment_list_id UUID NOT NULL`.
   - `weeklog_entry_id UUID REFERENCES weeklog_entries(id) ON DELETE RESTRICT`.
   - `car_name`, `license_plate`, `vin`, `services_snapshot JSONB NOT NULL`.
   - `total_amount NUMERIC(12, 2) NOT NULL`.
   - Constraints:
     - `UNIQUE (id, workspace_id)`
     - `UNIQUE (id, payment_list_id, workspace_id)`
     - `FOREIGN KEY (payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id) ON DELETE CASCADE`.
4. **Criação da Tabela `payment_list_entry_claims` (Anti-Double-Billing)**:
   - `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `payment_list_id UUID NOT NULL`, `weeklog_entry_id UUID NOT NULL`.
   - `status VARCHAR(16) NOT NULL DEFAULT 'reserved'`.
   - `claimed_at TIMESTAMP NOT NULL DEFAULT NOW()`, `consumed_at TIMESTAMP`, `released_at TIMESTAMP`, `released_reason TEXT`.
   - Constraints e Partial Unique Index:
     - `FOREIGN KEY (payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id) ON DELETE CASCADE`.
     - `FOREIGN KEY (weeklog_entry_id, workspace_id) REFERENCES weeklog_entries(id, workspace_id) ON DELETE RESTRICT`.
     - `CREATE UNIQUE INDEX unique_active_or_consumed_weeklog_entry_claim ON payment_list_entry_claims (workspace_id, weeklog_entry_id) WHERE status IN ('reserved', 'consumed');`
5. **Criação da Tabela `payment_list_confrontation_runs`**:
   - `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `payment_list_id UUID NOT NULL`, `sequence INT NOT NULL DEFAULT 1`.
   - `status VARCHAR(16) NOT NULL DEFAULT 'started'`, `started_at TIMESTAMP NOT NULL DEFAULT NOW()`, `completed_at TIMESTAMP`.
   - Constraints:
     - `UNIQUE (payment_list_id, sequence)`
     - `UNIQUE (id, payment_list_id, workspace_id)`
     - `FOREIGN KEY (payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id) ON DELETE CASCADE`.
6. **Criação da Tabela `payment_list_confrontation_results`**:
   - `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `payment_list_id UUID NOT NULL`, `run_id UUID NOT NULL`.
   - `payment_list_item_id UUID`, `weeklog_entry_id UUID`.
   - `status confrontation_status NOT NULL DEFAULT 'not_evaluated'`.
   - `decision confrontation_decision NOT NULL DEFAULT 'none'`.
   - `difference_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00`.
   - `reopened_production_order_id UUID`, `target_execution_sequence INT`.
   - Constraints e Unicidade por Rodada:
     - `FOREIGN KEY (run_id, payment_list_id, workspace_id) REFERENCES payment_list_confrontation_runs(id, payment_list_id, workspace_id) ON DELETE CASCADE`.
     - `FOREIGN KEY (payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id) ON DELETE CASCADE`.
     - `FOREIGN KEY (payment_list_item_id, payment_list_id, workspace_id) REFERENCES payment_list_items(id, payment_list_id, workspace_id) ON DELETE RESTRICT`.
     - `FOREIGN KEY (weeklog_entry_id, workspace_id) REFERENCES weeklog_entries(id, workspace_id) ON DELETE RESTRICT`.
     - `CHECK (payment_list_item_id IS NOT NULL OR weeklog_entry_id IS NOT NULL)`
     - `CREATE UNIQUE INDEX unique_run_item_match ON payment_list_confrontation_results (run_id, payment_list_item_id) WHERE payment_list_item_id IS NOT NULL;`
     - `CREATE UNIQUE INDEX unique_run_entry_match ON payment_list_confrontation_results (run_id, weeklog_entry_id) WHERE weeklog_entry_id IS NOT NULL;`
7. **Criação das Tabelas de Staging Relacional**:
   - `external_list_imports` e `external_list_import_items` (com `raw_total_text TEXT NULL` e `reviewed_total NUMERIC(12, 2) NULL`).
   - `external_operational_imports` e `external_operational_import_items` (com `raw_total_text TEXT NULL`).
8. **Evolução de `weeklog_entries` para Suporte a WEEKLOG Externo**:
   - Adicionar `source_type VARCHAR(32) NOT NULL DEFAULT 'production_order'`.
   - Alterar `production_order_id` para nullable.
   - Adicionar `external_import_item_id UUID REFERENCES external_operational_import_items(id) ON DELETE RESTRICT`.
   - Unicidade estrutural: `CREATE UNIQUE INDEX unique_external_import_item_entry ON weeklog_entries (external_import_item_id) WHERE external_import_item_id IS NOT NULL;`
   - Constraint CHECK XOR:
     ```sql
     CHECK (
       (source_type = 'production_order' AND production_order_id IS NOT NULL AND external_import_item_id IS NULL)
       OR
       (source_type = 'external_import' AND production_order_id IS NULL AND external_import_item_id IS NOT NULL)
     )
     ```
9. **Criação da Tabela de Sequências `tenant_sequence_counters`**:
   - `workspace_id UUID`, `sequence_type VARCHAR(32)`, `current_value INT NOT NULL DEFAULT 0`.
   - `UNIQUE (workspace_id, sequence_type)`.
   - Inicialização via script explícito (`scripts/seed-legacy-counters.ts`), sem heurísticas embutidas na migração.

---

## 3. Arquitetura do Backend

### 3.1. Camada de Serviços
- `paymentListService.ts`:
  - `createPaymentList(ctx, payload)`: valida Zod (moeda `^[A-Z]{3}$`), aloca `L0xxxxx` atomicamente com lock pessimista, cria `PaymentList`, `PaymentListItem` e `PaymentListEntryClaim(status='reserved')`, projeta downstream em `payment_orders`.
  - `getPaymentListById(ctx, id)`: leitura autorizada; sanitiza resposta para `technician` (`scope: own`), retornando apenas itens atribuídos ao técnico e ocultando totais consolidados.
  - `transitionListStatus(ctx, id, targetStatus)`:
    - `under_review` $\rightarrow$ `confronted`: exige avaliação de todos os itens.
    - `confronted` $\rightarrow$ `pending`: verifica se há disputas em aberto (`CONTEST` ou `REQUEST_RECTIFICATION`). Se houver, retorna HTTP 409. Se aprovado, transiciona claims ativas para `consumed`.
    - `pending` $\rightarrow$ `paid`: restrito a `owner`/`admin`. Idempotente. Grava `paidAt` e `paidBy`. Zero mutações em `financial_records`.
    - `*` $\rightarrow$ `cancelled`: atualiza todas as claims `reserved` para `status = 'released'`, liberando as entries.
- `confrontationService.ts`:
  - `executeConfrontation(ctx, listId)`:
    - Verifica se a rodada atual possui decisões humanas registradas (`decision != 'none'`). Se houver, bloqueia com HTTP 409 `CONFRONTATION_RERUN_HAS_DECISIONS`.
    - Cria nova `PaymentListConfrontationRun` com `sequence` incrementada.
    - Compara `PaymentListItem` contra `WeeklogEntry` validadas do mesmo `(workspaceId, clientId)`.
    - Garante pareamento único por run sem resolução ambígua cega.
    - Mapeia os 3 casos estruturais (Item+Entry, Item órfão, Entry órfã) em linhas de `PaymentListConfrontationResult`.
  - `applyHumanDecision(ctx, listId, resultId, decision, notes)`: registra a decisão formal. Se `decision == 'reject_item'`, transiciona a claim associada para `released`.
  - `triggerRectificationFromList(ctx, listId, resultId)`:
    - Verifica se a entry associada é `sourceType == 'production_order'`. Se for externa, rejeita com HTTP 422.
    - Invoca `rectifyWeeklogEntry` da Spec 003.
    - Grava `reopenedProductionOrderId` e `targetExecutionSequence` no resultado.
- `externalListImportService.ts`:
  - Ingestão, cálculo de hash SHA-256, MinIO, extração via IA e população em `ExternalListImportItem` (preservando `rawTotalText`).
  - Validação estrita de campos obrigatórios antes do commit.
- `externalOperationalImportService.ts`:
  - T05 entrega ingestão, proveniência e revisão humana relacional; materialização canônica em `Weeklog` + `WeeklogEntry` (`sourceType = 'external_import'`) não pertence a esta fatia. `reviewedOperationalSiteKey` é a key canônica já adotada na Spec 003, sem nova entidade Site.
  - A rodada formal em `WeeklogValidation` com `validationMethod = "external_import_review"` e `coverageSnapshot` congelado é posterior à fatia de staging.
- `downstreamPaymentOrderAdapter.ts`:
  - Espelhamento estritamente unidirecional (`canonical` $\rightarrow$ `payment_orders`).

---

## 4. Transição de Call Sites Legados e Arquitetura do Frontend

### 4.1. Inventário de Transição de Endpoints Legados
| Call Site no Frontend | Endpoint Atual | Classificação | Destino na Spec 004 |
| :--- | :--- | :--- | :--- |
| `apiFinance.ts:93`, `useReconciliation.ts:138` | `POST /finance/reconciliations/run` | **REMOVE IN T10/T11** | Endpoint destrutivo descontinuado sumariamente. |
| `ReconciliationScreen.tsx`, `FinancialPage.tsx:13-31` | `GET/PATCH /finance/reconciliations` | **REPLACE WITH CANONICAL (T11/T12)** | Substituído por `/api/payment-lists/:id/confrontation` em Operações. |
| `usePaymentOrders.ts:110-153`, `PaymentOrdersPage.tsx:218` | `POST/PATCH/DELETE /payment-orders` | **REPLACE WITH CANONICAL (T11)** | Mutações redirecionadas para `/api/payment-lists`. |
| `useAgingAlerts.ts:35`, `useOperationalSignals.ts:86` | `GET /payment-orders` | **READ-ONLY LEGACY** | Mantido como somente-leitura alimentado pelo Downstream Adapter até Spec 005. |
| `BillingPage.tsx:371`, `ImportInvoiceDialog.tsx:629` | Reconciliação de faturas | **SPEC005 FUTURE** | Fronteira preservada para o módulo financeiro e fiscal. |

### 4.2. Adaptação do Frontend
1. **Erradicação Total do Supabase Client**:
   - Remoção de todos os imports de `@/integrations/supabase/client` em [PaymentOrdersTable.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/payment-orders/PaymentOrdersTable.tsx).
   - Adoção de hooks TanStack Query tipados baseados na API REST canônica Express.
2. **Novas Telas em Operações**:
   - [PaymentOrdersPage.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/PaymentOrdersPage.tsx) adaptada para Lista Canônica (rota `/payment-orders`).
   - Visualizador de documento com rotação/zoom integrado à tabela editável de staging para conferência de OCR.
   - Realocação dos componentes de confronto para dentro da visão da Lista em Operações.
3. **Visão do Técnico (`scope: own`)**:
   - Interface exibe apenas os itens reconhecidos de autoria do técnico e o status comercial.
   - Totais consolidados da empresa e botões de decisão administrativa são ocultados no cliente e bloqueados no servidor.

---

## 5. Matriz de Riscos e Mitigações

| Risco Identificado | Severidade | Mitigação Arquitetural |
| :--- | :--- | :--- |
| **Colisão Concorrente ou Histórica na Numeração L0xxxxx** | Alta | Descoberta determinística de seed via CLI com dry-run padrão + lock pessimista `SELECT ... FOR UPDATE` no PostgreSQL. |
| **Double-Billing Concorrente ou Residual Pós-Pagamento** | Alta | Ciclo de vida semântico em `PaymentListEntryClaim` (`reserved`/`consumed`/`released`) com partial unique index `WHERE status IN ('reserved', 'consumed')`. |
| **Sobrescrita Acidental de Decisões de Confronto em Reruns** | Alta | Versionamento de rodadas com `PaymentListConfrontationRun`. Bloqueio de rerun (HTTP 409) se houver decisões humanas na rodada ativa. |
| **Pareamento Duplicado no Mesmo Confronto** | Alta | Constraints únicas `(run_id, payment_list_item_id)` e `(run_id, weeklog_entry_id)`. Casos ambíguos exigem decisão humana. |
| **Perda de Precisão em Valores Extraídos via OCR** | Média | Preservação de `rawTotalText String?` no staging; `reviewedTotal Decimal(12, 2)` após parser com suporte a localidade. |
| **Materialização Múltipla de Entradas Externas em Retries** | Alta | Unicidade estrutural `UNIQUE(external_import_item_id)` em `WeeklogEntry`. Commit de import operacional idempotente. |
| **Aprovação de Faturamento com Disputas Ativas** | Alta | Invariante bloqueando transição para `pending` se houver itens em `CONTEST` ou `REQUEST_RECTIFICATION`. |
| **Poluição Contábil Precoce** | Alta | Proibição absoluta de criação de `financial_records` ou pagamentos parciais por item na Spec 004. |
