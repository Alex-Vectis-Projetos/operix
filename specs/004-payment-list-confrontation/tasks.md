# Tarefas de Implementação Técnica — Spec 004 (Hardening Final Pré-Test-First)

**Fatia**: R2 — Lista de Pagamento, Importação Externa, Confronto Operacional e Fronteira Financeira  
**Branch**: `feat/004-payment-list-confrontation`  
**Base**: `develop/operix-core`  
**Status**: Discovery & Hardening Concluídos — Pronto para Início de T01/T02 (Test-First)  

---

## 1. Visão Geral das Fases de Entrega

```text
FASE 1: TEST FIRST ──────────> Baseline Red: Claims Semânticos, Runs de Confronto, Coverage e Seed CLI
FASE 2: RELACIONAL ──────────> Migration Forward-Only, Runs, Claims e CLI de Seed Discovery
FASE 3: INGESTÃO & STAGING ──> MinIO Governança, rawTotalText, Validação Obrigatória e Frozen Coverage
FASE 4: DOMÍNIO DE LISTA ────> Numeração Atômica, Moeda Estrita, Claims Tripartite e Paid Authority
FASE 5: CONFRONTO COMERCIAL ─> Rodadas Versionadas, Pareamento Único, Resultados e Bloqueio de Disputas
FASE 6: RETIFICAÇÃO ─────────> Invocação Transacional da Spec 003 e Rastreabilidade de Linhagem
FASE 7: DOWNSTREAM ADAPTER ──> Espelhamento One-Way em payment_orders e Transição de Call Sites Legados
FASE 8: FRONTEND CLIENT ─────> Hooks TanStack Query e Eliminação Estrita do Supabase Client
FASE 9: FRONTEND UI ─────────> Conferência Lado a Lado, Tela de Confronto e Visão do Técnico
FASE 10: QUALITY GATES ──────> Verificação Ponta a Ponta, Lint, Typecheck e Testes A/B
```

---

## 2. Inventário Detalhado de Tarefas

### Fase 1: Baseline de Testes Automatizados (Test First)
- [x] **T01**: Criar suíte de testes de integração `tests/integration/payment-list-invariants.test.ts`:
  - Cenário multissemanas consolidando múltiplos WEEKLOGs (`LIST-MULTIWEEK-01`).
  - Isolamento estrito de tenant A/B (`LIST-TENANT-01`).
  - Restrição de escopo de técnico com sanitização de totais da empresa (`LIST-TECH-OWN-01`).
  - Ciclo semântico de claim: reserva inicial (`LIST-CLAIM-RESERVED-01`).
  - Transição de claim para `consumed` no avanço para `pending` (`LIST-CLAIM-CONSUMED-01`).
  - Liberação de claim para `released` no desfecho `REJECT_ITEM` terminal (`LIST-CLAIM-REJECT-RELEASE-01`).
  - Bloqueio de dupla cobrança em lista cancelada vs nova listagem (`LIST-CANCEL-RELIST-01`).
  - Proibição de refaturamento de entry associada a lista `paid` (`LIST-CLAIM-PAID-NO-RELIST-01`).
  - Tentativa de reivindicação concorrente da mesma entry com colisão no partial unique index (`LIST-DUPLICATE-CONCURRENT-01`).
  - Alocação concorrente de numeração sequencial monotônica `L0xxxxx` (`LIST-NUMBER-CONCURRENT-01`).
  - Script de seed discovery em modo DRY-RUN (`LIST-NUMBER-SEED-DRY-RUN-01`).
  - Ignorar códigos ambíguos de `production_lists` sem workspace no seed (`LIST-NUMBER-SEED-AMBIGUOUS-SKIP-01`).
  - Prevenção de colisão com histórico legado (`LIST-NUMBER-LEGACY-SEED-01`, `LIST-NUMBER-NO-COLLISION-01`, `LIST-NUMBER-MALFORMED-LEGACY-01`).
  - Validação estrita de moeda ISO-4217 de 3 letras maiúsculas (`LIST-CURRENCY-REQUIRED-01`, `LIST-CURRENCY-MISMATCH-01`).
  - Transição estrita de lifecycle exigindo `confronted` antes de `pending` (`LIST-PENDING-01`).
  - Autoridade exclusiva de gestor na liquidação e idempotência (`LIST-PAID-IDEMPOTENT-01`, `LIST-PAID-FORBIDDEN-01`).
  - Rotas legadas em `paymentOrders.ts` tornadas somente-leitura (`LEGACY-PAYMENTORDER-READONLY-01`).
- [x] **T02**: Criar suíte de testes do motor de confronto comercial `tests/integration/commercial-confrontation.test.ts`:
  - Estado inicial default `not_evaluated` (`CONFRONT-NOT-EVALUATED-01`).
  - Idempotência de execução de confronto repetido sem alterações (`CONFRONT-IDEMPOTENT-01`).
  - Histórico preservado de rodadas anteriores via `PaymentListConfrontationRun` (`CONFRONT-RERUN-HISTORY-01`).
  - Bloqueio estrito de rerun se houver decisões humanas na rodada ativa (`CONFRONT-RERUN-DECISION-IMMUTABLE-01`).
  - Matching exato por placa/VIN, serviços e valor com pareamento único (`CONFRONT-VEHICLE-01`, `CONFRONT-SERVICE-01`, `CONFRONT-VALUE-01`).
  - Tratamento de veículo declarado na lista ausente na produção (`CONFRONT-AMBIGUOUS-01`).
  - Tratamento de execução de WEEKLOG ausente na lista do cliente sem fabricar item fictício (`CONFRONT-UNMATCHED-WEEKLOG-01`).
  - Registro formal de decisão humana terminal (`CONFRONT-HUMAN-DECISION-01`).
  - Bloqueio de transição para `pending` por disputas em aberto (`LIST-PENDING-BLOCKED-CONTEST-01`, `LIST-PENDING-BLOCKED-RECTIFICATION-01`).
  - Invocação transacional da retificação da Spec 003 sem entidade artificial (`LIST-RECTIFICATION-LINEAGE-01`).
  - Ausência de side-effects contábeis em `financial_records` (`NO-FINANCE-SIDE-EFFECT-04`).
- [x] **T03**: Criar suítes de testes de importação e validação externa `tests/integration/payment-list-import.test.ts` e `tests/integration/external-weeklog-import.test.ts`:
  - Upload e staging relacional em `ExternalListImport` + `ExternalListImportItem` (`IMPORT-LIST-REVIEW-01`, `IMPORT-PROVENANCE-01`).
  - Preservação da formatação textual bruta de valores (`IMPORT-MONEY-RAW-PRESERVED-01`).
  - Proibição de commit automático sem validação humana e campos obrigatórios (`IMPORT-NO-AUTO-COMMIT-01`).
  - Bloqueio de commit cross-tenant (`IMPORT-CROSS-TENANT-01`).
  - Importação de WEEKLOG externo com XOR estrutural e sem OPs falsas (`IMPORT-WEEKLOG-REVIEW-01`, `IMPORT-WEEKLOG-NO-FAKE-PO-01`).
  - Idempotência e proteção concorrente no commit de import operacional (`IMPORT-WEEKLOG-COMMIT-IDEMPOTENT-01`, `IMPORT-WEEKLOG-CONCURRENT-COMMIT-01`).
  - Snapshot congelado de cobertura em `WeeklogValidation` (`IMPORT-WEEKLOG-COVERAGE-01`).
  - Inelegibilidade de entradas tardias para cobertura em validação antiga (`IMPORT-WEEKLOG-LATE-ENTRY-01`).
  - Rejeição de aprovação direta sem evidência auditável (`IMPORT-WEEKLOG-NO-DIRECT-APPROVE-01`).

### Fase 2: Schema Prisma e Migração Forward-Only
- [x] **T04**: Atualizar `backend/prisma/schema.prisma` com os modelos canônicos e aplicar migração forward-only:
  - `PaymentList` com `@@unique([id, workspaceId])`, `@@unique([workspaceId, listNumber])`, `sourceDocumentTotal`, `recognizedTotal` e `currencyCode` sem default.
  - `PaymentListItem` com composite keys `@@unique([id, paymentListId, workspaceId])` e `@@unique([id, workspaceId])`.
  - `PaymentListEntryClaim` com status (`reserved`, `consumed`, `released`) e partial unique index `WHERE status IN ('reserved', 'consumed')`.
  - `PaymentListConfrontationRun` com sequência e status de rodada.
  - `PaymentListConfrontationResult` com `runId`, composite FKs e índices de unicidade de matching.
  - `ExternalListImport` e `ExternalListImportItem` (com `rawTotalText String?`).
  - `ExternalOperationalImport` e `ExternalOperationalImportItem` (com `rawTotalText String?`).
  - `TenantSequenceCounter`.
  - Flexibilização de `WeeklogEntry` com discriminador `sourceType` ("production_order" | "external_import") e chave única `externalImportItemId`.
  - Migration forward-only `20260921120000_spec004_payment_list_domain` aplicada com checks e partial indexes.
  - Hardening forward-only `20260921130000_spec004_relational_hardening`: FK de resultado para `(runId, paymentListId, workspaceId)`, estado `ambiguous_match` e lifecycle de claims estrito; upgrade real preservando duas `WeeklogEntry` da Spec 003 e FKs cross-tenant cobertos estruturalmente.
### Fase 3: Storage MinIO & Ingestão Externa (Staging Relacional)
- [x] **T05**: Implementar ingestão externa governada e staging relacional (validação PostgreSQL concluída em banco local descartável):
  - `backend/src/services/externalListImportService.ts`: upload MinIO, hash SHA-256, extração IA preservando `rawTotalText` e persistência em `ExternalListImportItem`.
  - `backend/src/services/externalOperationalImportService.ts`: esteira de WEEKLOG externo com staging revisável, sem materialização em `Weeklog` + `WeeklogEntry`. A materialização idempotente, `coverageSnapshot` congelado e `WeeklogValidation` formal permanecem em fatia posterior autorizada.
  - Endpoints REST de importação e edição interativa de staging.
  - Antes de promoção física, `storagePath` e metadados derivados podem permanecer `NULL`; após promoção bem-sucedida, o serviço preenche a proveniência real. Antes de `reviewed`/commit, valida cliente tenant-safe, moeda ISO, técnico membro, `reviewedOperationalSiteKey` e `reviewedDeliveredAt`.
  - Testes de T05 usam adapters sintéticos controlados para storage/extração; a validação de acurácia e cobertura com documentos reais aguarda amostras do cliente.

### Fase 4: Domínio de Lista de Pagamento, Numeração Atômica & Claims
- [x] **T06.5**: Materializar importação operacional externa revisada sem ampliar o schema:
  - `POST /api/external-operational-imports/:id/commit` bloqueia o import, revalida authority revisada e cria/reutiliza `Weeklog` por `(workspace, client, site, semana operacional)`.
  - Cria somente `WeeklogEntry(sourceType='external_import', productionOrderId=null, externalImportItemId)` e rodada `WeeklogValidation(external_import_review)` com cobertura congelada, aprovando exclusivamente as entradas cobertas.
  - Retry/concurrency retornam a mesma materialização sem duplicar; isolamento cross-tenant, rollback, reuso de cabeçalho e imutabilidade de rodada são cobertos. Fecha os cenários de aceitação 23–29; T07 permanece estritamente fora do escopo.
- [x] **T06**: Implementar serviço canônico `backend/src/services/paymentListService.ts` e o seed discovery determinístico `scripts/seed-legacy-counters.ts` (DRY-RUN por default):
  - Alocador atômico sequencial `L0xxxxx` com lock pessimista via `TenantSequenceCounter`.
  - Criação de lista e gestão de claims em `PaymentListEntryClaim` (`reserved` $\rightarrow$ `consumed` OU `reserved` $\rightarrow$ `released`; `consumed` é terminal).
  - Governança estrita da máquina de estados: `draft` $\rightarrow$ `under_review` $\rightarrow$ `confronted` $\rightarrow$ `pending` $\rightarrow$ `paid`.
  - Autoridade restrita para `paid` (`owner`/`admin`), operação idempotente sem mutações em `financial_records`.
  - Liberação de claims no cancelamento da lista.
  - Validação estrita de `currencyCode` (3 letras maiúsculas ISO-4217).
  - Endpoints REST: `GET /api/payment-lists`, `GET /api/payment-lists/:id`, `POST /api/payment-lists`, `PATCH /api/payment-lists/:id/status`.

### Fase 5: Motor de Confronto Comercial Versionado
- [x] **T07**: Implementar serviço de confronto `backend/src/services/confrontationService.ts`:
  - Criação de rodadas versionadas `PaymentListConfrontationRun`.
  - `POST /api/payment-lists/:id/confront` aceita somente `mode: "current" | "new_round"` (default `current`); retries correntes são idempotentes e uma nova rodada é ação explícita de `owner`/`admin`, sem copiar ou sobrescrever decisões históricas.
  - Verificação de idempotência e bloqueio de recomputação corrente caso existam decisões humanas ativas (`decision != 'none'`); `new_round` é permitido somente em `under_review`/`confronted`.
  - Algoritmo de normalização e pareamento único por Veículo (VIN / Placa), Serviços e Valor.
  - Persistência em `PaymentListConfrontationResult` com status default `not_evaluated`.
  - Endpoint de execução: `POST /api/payment-lists/:id/confront` com o contrato de modo explícito congelado em DEC-017.
  - Endpoint de decisão humana: `PATCH /api/payment-lists/:id/confrontation/:resultId/decision`. Se `reject_item`, libera a claim para `released`.
  - Validação de invariante: bloqueio de transição para `pending` caso existam disputas em aberto (`CONTEST` ou `REQUEST_RECTIFICATION`).
  - Concluído com matching determinístico VIN/placa/serviços/Decimal, resultados desacoplados (`unmatched_weeklog`), decisão serializada por `resultId`, totais reconhecidos e concorrência PostgreSQL. T08 permanece responsável exclusivamente por retificação operacional e linhagem de OP.

### Fase 6: Integração de Retificação da Lista com a Spec 003
- [x] **T08**: Implementar integração da ação `REQUEST_RECTIFICATION` no `confrontationService.ts`:
  - Resolução da `WeeklogEntry` original. Se `sourceType == 'external_import'`, recusar com HTTP 422.
  - Invocação transacional de `rectifyWeeklogEntry` da Spec 003.
  - Registro de `reopenedProductionOrderId` e `targetExecutionSequence` em `PaymentListConfrontationResult`.
  - Concluído em transação única com o comando canônico da Spec003; entradas externas são rejeitadas sem fabricar OP e retries recuperam a mesma linhagem.

### Fase 7: Downstream Legacy Adapter & Transição de Call Sites Legados
- [ ] **T09**: Implementar `backend/src/services/downstreamPaymentOrderAdapter.ts`:
  - Espelhamento estritamente unidirecional de `PaymentListItem` na tabela legada `payment_orders`.
  - Sanitização de `backend/src/routes/paymentOrders.ts`: aplicar `RequestContext`, converter mutações legadas para HTTP 410 Gone / 409 Conflict e tornar rotas de leitura seguras.
  - Desativação do endpoint destrutivo `/finance/reconciliations/run`.

### Fase 8: Frontend Client & Eliminação do Supabase Client
- [ ] **T10**: Implementar cliente de API e hooks TanStack Query:
  - Criar `src/hooks/usePaymentLists.ts` e `src/hooks/useConfrontation.ts`.
  - Erradicar 100% dos imports de `@/integrations/supabase/client` em `PaymentOrdersTable.tsx`.
  - Adaptar chamadas de mutação para as rotas REST autoritativas Express.

### Fase 9: Interface de Revisão e Confronto Comercial em Operações
- [ ] **T11**: Adaptar interface em `src/pages/PaymentOrdersPage.tsx`:
  - Tela de conferência lado a lado: visualizador de documento (zoom/rotação) + tabela editável de staging relacional.
  - Integração dos componentes de confronto ([FusaoManualTab.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/confronto/FusaoManualTab.tsx), [PendentesTab.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/confronto/PendentesTab.tsx), [HistoricoTab.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/confronto/HistoricoTab.tsx)) dentro da visualização da Lista em Operações.
  - Aplicação estrita da visão do técnico (`scope: own`): ocultação de faturamento global e margens.

### Fase 10: Quality Gates, Verificação e Handoff
- [ ] **T12**: Executar suíte completa de validação:
  - Execução de 100% dos testes unitários e de integração (`npm run test:run`).
  - Verificação de tipos TypeScript (`npm run typecheck`).
  - Verificação de formatação e linter (`npm run lint`).
  - Testes de isolamento A/B e regressão de segurança.
