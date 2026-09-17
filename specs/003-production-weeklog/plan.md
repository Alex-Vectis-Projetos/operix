# Plano de Implementação Técnica — Spec 003: Conclusão de OP, WEEKLOG, Validação em Lote e Retificação Versionada (Revisão Pós-Remediação Final)

**Fatia**: R1 — Operação Móvel  
**Branch**: `feat/003-production-weeklog`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-17  
**Total de Cenários Planejados**: 67 cenários de aceitação formal (+ 5 testes estruturais = 72 testes no total)  

---

## 1. Visão Geral da Abordagem Técnica

A implementação técnica da Spec 003 atende a todas as deliberações de remediação arquitetural:
1. **Modelagem Canônica e Execução Versionada**:
   - `ProductionOrder.executionSequence` e `WeeklogEntry.executionSequence` com constraint estrutural `@@unique([productionOrderId, executionSequence])`.
   - `rectificationOriginEntryId` como self-FK relacional (`onDelete: Restrict`).
2. **Identidade Determinística de Cabeçalho (Sem Nulos)**:
   - `@@unique([workspaceId, startsOn, clientId, siteKey])`.
   - `operationalSiteKey` canônico em `ProductionOrder` (sem fallback silencioso "default"; 422 `OPERATIONAL_SITE_REQUIRED` se ausente).
   - `Workspace.timezone` formal (formato IANA, fallback universal `"UTC"`).
3. **Submissão e Validation Round Versionada (Ciclo em Duas Fases)**:
   - `WeeklogValidation` modela cada Validation Round versionada (`validationSequence Int`, `@@unique([weeklogId, validationSequence])`).
   - **Fase A (Submissão — T05)**: `POST /api/weeklogs/:id/submit-for-validation` transiciona o lote para `pending_validation`, abrindo a rodada com `status: "pending"`, `submittedAt: now()` (server-side, sem DEFAULT no banco), `submittedBy: ctx.actorUserId` e congelando o `coverageSnapshot`.
   - **Imutabilidade Estrita de Coverage**: O `coverageSnapshot` não é alterado após o submit por novas ordens ou retries.
   - **Fase B (Conclusão — T06)**: `POST /api/weeklogs/:id/validate` completa **a mesma rodada** para `status: "validated"`, preenchendo `validatorUserId`, `validationMethod`, `validatedAt` e `signatureStoragePath`.
   - **Preservação Histórica Pré-T05**: Migration forward-only corretiva mantém validações legadas com `status = 'validated'`, `submittedBy = NULL` e `submittedAt = NULL` (tornando a coluna nullable, sem inventar auditoria inexistente).
   - Ciclo de vida de `ClientAccessGrant`: `status` (`active` / `revoked`), `grantedAt`, `revokedAt`, `revokedBy`, com integridade referencial `(clientId, workspaceId)` no PostgreSQL. Grants revogados retornam HTTP 403 `VALIDATOR_REVOKED`.
   - Bloqueio estrito de auto-validação em lote (`VALIDATOR-BATCH-SELF-01`): na validação do lote, o backend verifica `ctx.actorUserId` contra o `technicianUserId` de **todas** as entradas no `coverageSnapshot`. Se o ator executou qualquer item, a validação é sumariamente rejeitada com HTTP 403 Forbidden.
   - Eliminação de `finalValue` (congelamento de `totalAmount` e `currencyCode`; moeda obrigatória sem default EUR, retornando 422 `CURRENCY_REQUIRED` se ausente).
4. **OPs Diretas com Serviços Estruturados e Decimais**:
   - `ProductionOrder.performedServices` tipado via Zod com decimais representados como strings normalizadas.
   - O backend utiliza `Prisma.Decimal` para recalcular e persistir valores (`quantity`, `unitPrice`, `total`). O tipo primitivo `number` do JavaScript não é aceito como autoridade monetária.
5. **Máquina de Estados Estrita (Fronteira com Spec 004)**:
   - Ciclo: `open` $\xrightarrow{\text{submit}}$ `pending_validation` $\xrightarrow{\text{validate}}$ `validated` $\xrightarrow{\text{rectify}}$ `rectification_pending` $\xrightarrow{\text{re-submit}}$ `pending_validation`.
   - O estado `closed` é reservado para a Spec 004. O comando `closeWeeklog` não é implementado na Spec 003.
6. **Projeção Downstream Legada e Backfill Não-Destrutivo**:
   - `WeeklogEntry.legacyServiceOrderId` mantendo compatibilidade com `service_orders` via **Downstream Legacy Projection Adapter**.
   - Backfill em T08 via script dedicado idempotente (`scripts/backfill-legacy-service-orders.ts`) com `--dry-run`, relatório detalhado e sem sobrescrever registros históricos.
7. **Tratamento de Concorrência e P2002 Fora da Transação**:
   - Bloqueio pessimista via `SELECT ... FOR UPDATE` na OP dentro de `prisma.$transaction`.
   - Falhas de colisão `P2002` são capturadas **fora** da transação abortada do PostgreSQL, realizando re-leitura segura em nova operação e distinguindo race na sequência da PO de race no cabeçalho do Weeklog.
8. **Governança da Assinatura Gráfica (Apenas PNG)**:
   - Suporte estrito a PNG (validação de magic bytes `89 50 4E 47 0D 0A 1A 0A` e limite de 1 MB). O formato SVG é removido para mitigar riscos de segurança (XSS/XML). Mutações pós-validação retornam HTTP 409.

---

## 2. Camada de Banco de Dados e Migrações (Expand-Contract)

### 2.1. Alterações Estruturais no Schema Prisma (`backend/prisma/schema.prisma`)
1. **`Workspace`**:
   - Adição de `timezone String @default("UTC")`.
2. **`ClientAccessGrant`**:
   - Modelo para governança de validadores do cliente:
     - `id`, `workspaceId`, `userId`, `clientId`, `role` (`validator`, `manager`).
     - `status String @default("active")` (`active`, `revoked`).
     - `grantedAt DateTime @default(now())`.
     - `revokedAt DateTime?`.
     - `revokedBy String?`.
     - `createdAt DateTime @default(now())`.
   - Foreign keys compostas:
     - `(workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE`.
     - `(clientId, workspaceId) REFERENCES clients(id, workspaceId) ON DELETE CASCADE`.
   - Constraint: `@@unique([workspaceId, userId, clientId])`.
3. **`ProductionOrder`**:
   - Adição de `executionSequence Int @default(1)`.
   - Adição de `rectificationOriginId String?`.
   - Adição de `operationalSiteKey String?`.
   - Adição de `currencyCode String?`.
   - Adição de `performedServices Json?`.
   - Constraint: `@@unique([id, workspaceId])`.
4. **`Weeklog`**:
   - Modelo para cabeçalho semanal:
     - `id`, `workspaceId`, `startsOn`, `endsOn`, `clientId`, `siteKey`, `week`, `weekNumber`, `yearReference`, `status`, `timezone`, `createdAt`, `updatedAt`.
   - Constraints: `@@unique([workspaceId, startsOn, clientId, siteKey])`, `@@unique([id, workspaceId])`.
5. **`WeeklogEntry`**:
   - Modelo para itens de execução:
     - `id`, `weeklogId`, `workspaceId`, `productionOrderId`, `executionSequence`, `budgetId`, `budgetRevisionId`, `legacyServiceOrderId`, `technicianUserId`, `technicianName`, `clientId`, `clientName`, dados do veículo, `servicesSnapshot`, `totalAmount Decimal(12, 2)`, `currencyCode String` (sem default EUR), `deliveredAt`, campos de revisão e de retificação.
   - Foreign keys compostas:
     - `(weeklogId, workspaceId) REFERENCES weeklogs(id, workspaceId) ON DELETE CASCADE`.
     - `(productionOrderId, workspaceId) REFERENCES production_orders(id, workspaceId) ON DELETE RESTRICT`.
     - `(rectificationOriginEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId) ON DELETE RESTRICT`.
     - `(clientId, workspaceId) REFERENCES clients(id, workspaceId) ON DELETE RESTRICT`.
   - Constraints: `@@unique([productionOrderId, executionSequence])`, `@@unique([id, workspaceId])`.
6. **`WeeklogValidation` (Validation Round Versionada)**:
   - Modelo para governança da rodada de submissão e chancela:
     - `id`, `weeklogId`, `workspaceId`, `validationSequence Int @default(1)`.
     - **Fase de Submissão**: `status String @default("pending")` (`pending`, `validated`), `submittedAt DateTime?`, `submittedBy String?`, `coverageSnapshot Json`.
     - **Fase de Conclusão**: `validatorUserId String?`, `validationMethod String?`, `signatureStoragePath String?`, `validatedAt DateTime?`, `auditTrail Json?`.
   - Foreign keys compostas:
     - `(weeklogId, workspaceId) REFERENCES weeklogs(id, workspaceId) ON DELETE CASCADE`.
     - `(workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE`.
   - Constraint: `@@unique([weeklogId, validationSequence])`.

### 2.2. Execução das Migrações
- Migrations versionadas forward-only aplicadas:
  1. `20260917100000_add_weeklog_canonical_domain_and_versioned_rectification`: Modelagem canônica inicial.
  2. `20260917110000_spec_003_weeklog_validation_round_lifecycle`: Ciclo de vida da rodada de validação.
  3. `20260917120000_fix_legacy_weeklog_validation_semantics`: Preservação de semântica histórica pré-T05 (`submitted_at` nullable sem default, legacy status `validated`).
- Validação estrita via `npx prisma validate` e `prisma migrate diff --exit-code` (zero drift).

---

## 3. Camada Backend e Domínio

### 3.1. Utilitário Determinístico de Semana (`backend/src/lib/weekUtils.ts`)
- Suporte a timezone IANA com `date-fns-tz`:
  - `operationalWeekOf(dateInput: Date | string, timezone: string = "UTC"): OperationalWeek`
  - Início: Domingo 00:00:00.000 local convertido para timestamp UTC.
  - Término: Sábado 23:59:59.999 local convertido para timestamp UTC.
  - Derivação determinística de `week` e `yearReference`.
  - Tratamento resiliente de fuso inválido (fallback para `"UTC"`).

### 3.2. Serviço de Domínio `weeklogService.ts` (`backend/src/services/weeklogService.ts`)
- **`finalizeProductionOrder(ctx, orderId)`**:
  - `SELECT id, status, execution_sequence, client_id, operational_site_key, currency_code FROM production_orders WHERE id = ${orderId} FOR UPDATE`.
  - Se `status === "delivered"`, re-lê e retorna a entrada correspondente com HTTP 200 (idempotência).
  - Validações estritas de pré-condição:
    - `clientId` obrigatório (HTTP 422 `CLIENT_REQUIRED`).
    - `operationalSiteKey` obrigatório (HTTP 422 `OPERATIONAL_SITE_REQUIRED`).
    - `currencyCode` obrigatório (HTTP 422 `CURRENCY_REQUIRED`).
    - Serviços estruturados com decimais obrigatórios se OP direta (HTTP 422 `DIRECT_OP_NO_SERVICES`).
  - Executa `prisma.$transaction(isolationLevel: ReadCommitted)`:
    - Atualiza OP para `status = "delivered"`, `deliveredAt = now()`.
    - Upsert do cabeçalho `Weeklog`.
    - Criação de `WeeklogEntry` com `executionSequence = order.executionSequence`.
    - Sincronização downstream em `service_orders` via **Downstream Legacy Projection Adapter** e atualização de `legacyServiceOrderId`.
    - Link de fotos em `documents`.
  - **Tratamento de P2002 Fora da Transação**:
    - Captura o erro `P2002` no bloco `catch` externo.
    - Se colisão for na sequência da PO (`productionOrderId_executionSequence`), executa leitura limpa e retorna com HTTP 200.
    - Se colisão for no cabeçalho do Weeklog (`workspaceId_startsOn_clientId_siteKey`), reexecuta `finalizeProductionOrder` em nova tentativa limpa onde o cabeçalho agora já existe.
- **`submitForValidation(ctx, weeklogId)`**:
  - Valida permissões e existência de ao menos 1 entrada no lote.
  - Transiciona status do cabeçalho de `"open"` para `"pending_validation"`.
  - Congela o `coverageSnapshot` contendo a lista e IDs das entradas submetidas nesta rodada.
  - Idempotente se chamado repetidas vezes com a mesma cobertura.
- **`reviewWeeklogEntry(ctx, weeklogId, entryId, outcome)`**:
  - Marca entrada como `approved` ou `rejected` com motivo.
  - Bloqueia auto-validação por executores (`technicianUserId === ctx.actorUserId`).
- **`validateWeeklogBatch(ctx, weeklogId, payload)`**:
  - Exige grant ativo em `client_access_grants` para o `clientId` do lote (grants revogados retornam HTTP 403 `VALIDATOR_REVOKED`).
  - **Regra de Não-Auto-Validação em Lote (`VALIDATOR-BATCH-SELF-01`)**: Verifica se `ctx.actorUserId` coincide com o `technicianUserId` de **qualquer** entrada no `coverageSnapshot`. Se positivo, retorna HTTP 403 Forbidden.
  - Cria `WeeklogValidation` com `validationSequence = current + 1`.
  - Atualiza status do cabeçalho para `"validated"` (ou `"rectification_pending"` se houver itens reprovados).
  - Move assinatura gráfica em PNG do staging para o caminho canônico no MinIO.
  - Bloqueia mutação in-place pós-validação (HTTP 409).
- **`rectifyWeeklogEntry(ctx, weeklogId, entryId, payload)`**:
  - Exige justificativa formal.
  - Altera status da entrada para `rectification_requested`.
  - Atualiza o cabeçalho do Weeklog para `rectification_pending`.
  - Incrementa `ProductionOrder.executionSequence` e reabre a OP (`status: "in_production"`).
  - Aponta `ProductionOrder.rectificationOriginId = entryId`.
  - Valida regras TECH-ASSIGN se houver indicação de novo técnico.

### 3.3. Rotas da API (`backend/src/routes/weeklogs.ts` e `productionOrders.ts`)
- `POST /api/production-orders/:id/finalize`: Comando canônico.
- `PATCH /api/production-orders/:id`: Delega para `finalizeProductionOrder` caso `status === "delivered"`.
- `GET /api/weeklogs`, `GET /api/weeklogs/:id`, `GET /api/weeklogs/:id/entries/:entryId`.
- `POST /api/weeklogs/:id/submit-for-validation`: Submissão de lote para conferência.
- `POST /api/weeklogs/:id/entries/:entryId/review`: Inspeção individual.
- `POST /api/weeklogs/:id/validate`: Validação em lote.
- `POST /api/weeklogs/:id/signature-upload`: Upload em staging MinIO (apenas PNG, limite 1 MB).
- `POST /api/weeklogs/:id/entries/:entryId/rectify`: Solicitação de retificação.
- Saneamento de `backend/src/routes/serviceOrders.ts`: Aplicação de `RequestContext`, remoção de writes em `GET` e de criação de `PaymentOrder`.

---

## 4. Camada de Storage e Governança

- Staging: `tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/temp_{uuid}.png`.
- Definitivo: `tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/{validationId}.png`.
- Allowlist: `ALLOWED_STORAGE_BUCKETS = ["production-photos", "uploads"]`.
- Validação binária estrita: Magic numbers `89 50 4E 47 0D 0A 1A 0A` e limite de 1 MB. SVGs são sumariamente rejeitados.
- Presigned URLs de download temporárias (15 minutos).

---

## 5. Camada Frontend (React 18 + Vite)

- `src/lib/apiWeeklogs.ts`: Cliente tipado com esquemas Zod.
- `src/hooks/useWeeklogs.ts`: Hooks TanStack Query com invalidação de cache coordenada.
- `OrderDetailDialog.tsx`: Botão de finalização com feedback de loading e validação de `clientId`, `operationalSiteKey` e serviços antes do disparo.
- `WeeklogValidationDialog.tsx`:
  - Botão de submissão do lote para validação (`submitForValidation`).
  - Visualização de itens e conferência individual.
  - Canvas HTML5 para captura de assinatura manuscrita do lote (exportação em PNG).
  - Alternativa de confirmação eletrônica autenticada.
  - Fluxo de retificação com justificativa formal.
  - Bloqueio de inputs em registros validados.

---

## 6. Estratégia de Testes Automatizados (45 Cenários)

Arquivo: `tests/integration/weeklog-operational-flow.test.ts`  
Suíte completa cobrindo rigorosamente os **45 cenários de aceitação**:
1. `FINALIZE-01`: Conclusão atômica de OP criando `Weeklog` e `WeeklogEntry`.
2. `FINALIZE-IDEMPOTENT-01`: Retry de finalização retornando HTTP 200 com a mesma entrada.
3. `FINALIZE-CONCURRENT-01`: Finalizações concorrentes protegidas por lock pessimista.
4. `TENANT-01`: Bloqueio cross-tenant em leitura e validação.
5. `TECH-OWN-01`: Filtro de escopo restrito (`scope: own`) para técnicos.
6. `WEEK-GROUP-01`: Agrupamento semanal canônico.
7. `WEEK-BOUNDARY-01`: Virada semanal respeitando timezone do workspace.
8. `SNAPSHOT-01`: Imutabilidade do snapshot de serviços e valores.
9. `VALIDATE-01`: Validação em lote gerando `WeeklogValidation` versionado.
10. `VALIDATE-FORBIDDEN-01`: Bloqueio de validador sem grant formal.
11. `SIGNATURE-01`: Upload e vinculação de assinatura gráfica no MinIO.
12. `CONFIRMATION-01`: Validação autenticada sem assinatura gráfica.
13. `VALIDATED-IMMUTABLE-01`: Bloqueio de mutação in-place em item/lote validado.
14. `RECTIFICATION-01`: Reabertura de OP e preservação de histórico.
15. `RECTIFICATION-REASON-01`: Rejeição de retificação sem motivo formal.
16. `RECTIFICATION-REVALIDATE-01`: Exigência de nova validação para retrabalho.
17. `NO-FINANCE-SIDE-EFFECT-01`: Validação sem criação de `PaymentOrder` ou `listName`.
18. `RELOAD-01`: Persistência relacional sobrevive a page reload.
19. `RECTIFICATION-SAME-WEEK-01`: Retificação na mesma semana gerando sequence 2 no mesmo lote.
20. `RECTIFICATION-NEXT-WEEK-01`: Retificação em semana posterior alocando na nova semana.
21. `RECTIFICATION-MULTIPLE-01`: Múltiplas retificações com cadeia auditável de self-FKs.
22. `FINALIZE-RETRY-CURRENT-EXECUTION-01`: Retry retornando a execução correspondente à sequência ativa.
23. `WEEK-GROUP-CLIENT-01`: Segregação de lotes por cliente.
24. `WEEK-GROUP-LOCATION-01`: Segregação de lotes por local operacional (`siteKey`).
25. `WEEK-GROUP-CONCURRENT-01`: Criação concorrente de cabeçalho compartilhada sem colisão.
26. `WEEK-DST-SPRING-01`: Transição de horário de verão de primavera sem perda de boundary.
27. `WEEK-DST-FALL-01`: Transição de horário de verão de outono com consistência UTC.
28. `WEEK-YEAR-BOUNDARY-01`: Boundary em virada de ano civil.
29. `WEEK-INVALID-TIMEZONE-01`: Fallback seguro para UTC em caso de timezone inválido.
30. `VALIDATOR-CLIENT-SCOPE-01`: Validador chancelando com sucesso lote de seu cliente.
31. `VALIDATOR-OTHER-CLIENT-01`: Bloqueio de validador tentando validar cliente de terceiro.
32. `VALIDATOR-SELF-01`: Bloqueio estrito de auto-validação por técnico executor em revisão individual.
33. `PERSONAL-TECH-SELF-VALIDATE-01`: Bloqueio de auto-validação em Personal Workspace.
34. `DIRECT-OP-WEEKLOG-01`: OP direta com `performedServices` gerando snapshot.
35. `DIRECT-OP-NO-SERVICES-01`: Rejeição de finalização de OP direta sem serviços estruturados.
36. `LEGACY-FINALIZE-01`: Delegação de `PATCH /production-orders/:id` para `finalizeProductionOrder`.
37. `RECTIFICATION-FORGED-TECH-01`: Bloqueio de técnico forjado em retificação.
38. `RECTIFICATION-VALIDATOR-ASSIGN-FORBIDDEN-01`: Rejeição de atribuição de técnico por validador do cliente.
39. `SIGNATURE-IMMUTABLE-AFTER-VALIDATION-01`: Bloqueio de re-upload de assinatura pós-validação.
40. `SUBMIT-VALIDATION-01`: Transição `open` $\rightarrow$ `pending_validation` congelando `coverageSnapshot` da rodada.
41. `SUBMIT-VALIDATION-IDEMPOTENT-01`: Idempotência de chamadas redundantes de submissão para validação.
42. `VALIDATOR-REVOKED-01`: Rejeição com HTTP 403 de validador com `ClientAccessGrant` revogado.
43. `DIRECT-OP-NO-SITE-01`: Rejeição com HTTP 422 de finalização de OP sem `operationalSiteKey` persistido.
44. `FINALIZE-NO-CURRENCY-01`: Rejeição com HTTP 422 de finalização de OP sem `currencyCode` resolvido.
45. `VALIDATOR-BATCH-SELF-01`: Bloqueio estrito com HTTP 403 de auto-validação em lote se o validador executou qualquer item da rodada.

---

## 7. Fases de Execução

```text
FASE 1: CONTRATOS & BANCO DE DADOS (T01)
  - Schema Prisma: Workspace.timezone, ClientAccessGrant (status, grantedAt, revokedAt, revokedBy),
    ProductionOrder (executionSequence, rectificationOriginId, operationalSiteKey, currencyCode, performedServices),
    Weeklog (startsOn, clientId, siteKey, status: open/pending_validation/validated/rectification_pending),
    WeeklogEntry (executionSequence, legacyServiceOrderId, currencyCode, totalAmount),
    WeeklogValidation (validationSequence, coverageSnapshot, signatureStoragePath)
  - Migration versionada PostgreSQL

FASE 2: TESTES DE INTEGRAÇÃO TEST-FIRST (T02)
  - weeklog-operational-flow.test.ts implementando os 45 cenários RED

FASE 3: UTILITÁRIO DE SEMANA & BACKEND CORE (T03, T04)
  - weekUtils com timezone IANA
  - weeklogService: finalizeProductionOrder com lock pessimista, validação de siteKey/currencyCode e P2002 retry externo

FASE 4: API CANÔNICA, SUBMISSÃO, VALIDAÇÃO EM LOTE E RETIFICAÇÃO (T05, T06, T07)
  - Router /api/weeklogs com RequestContext e escopo own
  - Endpoint submitForValidation congelando coverageSnapshot
  - Validação em lote versionada (sequence+1), bloqueio batch-self-validation e staging de assinatura MinIO (PNG exclusivo)
  - Ciclo de retificação versionada com sequence+1 e self-FK

FASE 5: SANEAMENTO LEGADO, BACKFILL & FRONTEND UX (T08, T09, T10)
  - Saneamento de serviceOrders.ts e Downstream Legacy Projection Adapter
  - Script idempotente scripts/backfill-legacy-service-orders.ts com --dry-run, relatório e documentação de rollback
  - apiWeeklogs, useWeeklogs, botão finalizar em OP
  - WeeklogValidationDialog com submitForValidation, canvas HTML5 (PNG) e histórico imutável

FASE 6: QUALITY GATES & VERIFICAÇÃO INTEGRADA (T11)
  - 45 testes verdes
  - npm run typecheck (0 erros)
  - npm run lint (0 novos erros)
  - npm run build (0 erros)
```
