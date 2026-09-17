# ADR-003: Modelo Canônico de Domínio para o WEEKLOG, Validação em Lote e Retificação Versionada

**Status**: Accepted for Spec 003  
**Data**: 2026-09-17  
**Decisores**: EverGreen Engineering Team & Operix Core Architecture  
**Fatia Afetada**: R1 — Operação Móvel (Conclusão de OP, WEEKLOG, Validação e Retificação)  

---

## 1. Contexto

Na arquitetura brownfield da Operix:
1. O termo **WEEKLOG** é exibido na navegação da interface (`/service-orders`) como a consolidação semanal de reparos executados pela oficina.
2. Contudo, no banco de dados (`backend/prisma/schema.prisma`), existe apenas a tabela `service_orders`, na qual cada registro armazena a execução individual de **um único veículo**, com colunas desnormalizadas (`car_name`, `license_plate`, `service_1_name`..`service_4_price`, `total`, `week`).
3. Não existe no banco de dados uma entidade agregadora de lote semanal (`Weeklog`), nem governança formal de estados para o lote.
4. Informações de validação, fotos, históricos de aceite e dados de retificativa foram concentrados no campo JSON `distribution_snapshot.operational_document`.
5. Durante a validação, o sistema disparava precocemente a criação de uma `PaymentOrder` e gerava um identificador `listName` (`L010132`), confundindo o **WEEKLOG** (realidade física executada) com a **Lista de Pagamento** (documento comercial do cliente que agrupa múltiplos veículos e várias semanas para faturamento).
6. Na consulta (`GET /service-orders`), rotinas de escrita ("reconciliação persistente") mutavam o banco durante leituras e ocultavam itens validados.
7. A retificação não reabria a ordem nem mantinha histórico versionado, sobrescrevendo in-place os dados da mesma linha.

---

## 2. Decisão

### 2.1. Separação Semântica e Autoridade Canônica
- **WEEKLOG (Agregador de Lote)**: Representa a **realidade física e técnica executada**, agrupada pelo período semanal (`startsOn`), workspace, cliente e local operacional (`siteKey`).
- **WeeklogEntry (Item de Execução)**: Representa o snapshot congelado do trabalho realizado em um veículo individual.
- **WeeklogValidation (Aceite Formal do Lote Versionado)**: Contrato de validação no nível do `Weeklog`, registrando a assinatura do lote, a sequência da validação (`validationSequence`) e o carimbo do validador.
- **Lista de Pagamento (*PaymentList*)**: Escopo estrito da Spec 004. A Spec 003 encerra-se em **WEEKLOG VALIDATED**. O estado `closed` permanece reservado para a transição comercial da Spec 004.

### 2.2. Execução Versionada na Retificação
Para suportar múltiplas finalizações da mesma `ProductionOrder` (inclusive na mesma semana operacional após retrabalho):
- `ProductionOrder.executionSequence Int @default(1)`
- `WeeklogEntry.executionSequence Int @default(1)`
- **Constraint Canônica**:
  ```prisma
  @@unique([productionOrderId, executionSequence])
  ```
- A primeira execução nasce com `executionSequence = 1`.
- A reabertura para retificação incrementa a sequência na OP (`executionSequence: current + 1`).
- A nova `WeeklogEntry` aponta para a entrada imediatamente anterior via foreign key relacional:
  `rectificationOriginEntryId` referenciando `WeeklogEntry.id` com `onDelete: Restrict`.

### 2.3. Identidade Determinística do Cabeçalho WEEKLOG (Zero Campos Nulos)
O cabeçalho do lote `Weeklog` **NÃO** utiliza campos nulos em sua chave de unicidade:
```prisma
@@unique([workspaceId, startsOn, clientId, siteKey])
```
- `workspaceId`: UUID do workspace (not null).
- `startsOn`: Timestamp UTC correspondente ao Domingo 00:00:00.000 calculado no fuso horário do workspace (not null).
- `clientId`: UUID do cliente operacional contratante (not null; finalização de OP exige vínculo com cliente, retornando HTTP 422 se ausente).
- `siteKey`: String normalizada extraída da fonte canônica `ProductionOrder.operationalSiteKey` (not null; ausência de siteKey resolvível retorna HTTP 422 `OPERATIONAL_SITE_REQUIRED`, eliminando fallbacks silenciosos como `"default"`).
- `week`, `weekNumber`, `yearReference` são campos derivados/display mantidos para conveniência visual, não compondo a chave primária de identidade.

### 2.4. Fuso Horário Canônico no Workspace
- O modelo `Workspace` recebe `timezone String @default("UTC")` (formato IANA, ex: `"Europe/Paris"`, `"America/Sao_Paulo"`).
- Fallback canônico obrigatório: estritamente `"UTC"`.
- O modelo `Weeklog` armazena `timezone String` como snapshot do fuso horário utilizado no cálculo de `startsOn` e `endsOn`.

### 2.5. Granularidade de Validação, Validation Round Versionada e `submitForValidation`
- O modelo `WeeklogValidation` atua como a **Validation Round (Rodada de Validação) Versionada** do lote semanal, identificada por `validationSequence Int` com a constraint `@@unique([weeklogId, validationSequence])`.
- **Ciclo de Vida da Rodada em Duas Fases**:
  1. **Submissão (`submitForValidation`)**:
     - O endpoint `POST /api/weeklogs/:id/submit-for-validation` transiciona o cabeçalho `Weeklog.status` de `open` (ou `rectification_pending`) para `pending_validation`.
     - Cria a rodada em estado pendente (`status = "pending"`).
     - **Campos da Fase Pendente**:
       - `validationSequence`: Sequência incremental da rodada no lote.
       - `coverageSnapshot`: Snapshot JSON contendo a lista congelada de `entryIds`, totalizadores de itens e total monetário das ordens ativas submetidas.
       - `submittedAt`: Timestamp gerado estritamente server-side (`DateTime?`, sem DEFAULT no banco).
       - `submittedBy`: Identificador do ator responsável pela submissão (`ctx.actorUserId`), extraído com autoridade do `RequestContext`.
       - `status`: `"pending"`.
     - **Imutabilidade Estrita de Coverage**: O `coverageSnapshot` é estritamente imutável após a criação da rodada. Finalizações de novas ordens para a mesma semana ou retries de submissão não alteram o snapshot congelado. A API não oferece caminhos de sobrescrita de cobertura.
  2. **Conclusão/Chancela (T06 — `validateWeeklogBatch`)**:
     - O endpoint `POST /api/weeklogs/:id/validate` completa **a mesma rodada** que foi aberta no submit.
     - **Campos de Conclusão**:
       - `status`: Transiciona para `"validated"` (ou reflete o desfecho da rodada).
       - `validatorUserId`: Identificador do validador autenticado (`ctx.actorUserId`).
       - `validationMethod`: Método de chancela (`"authenticated_confirmation"` ou `"drawn_signature"`).
       - `validatedAt`: Carimbo temporal server-side da conferência.
       - `signatureStoragePath`: Caminho do arquivo definitivo no MinIO (se assinatura desenhada).
- **Preservação Semântica de Registros Legados (Pré-T05)**:
  - Registros de validação históricos anteriores à introdução de rodadas de submissão já possuíam `validatorUserId`, `validationMethod` e `validatedAt`.
  - A migration corretiva forward-only garante que essas linhas históricas permaneçam com `status = 'validated'`, sem criar falsas atribuições de submissão (`submittedBy IS NULL`) e sem inventar carimbos temporais de submissão (`submittedAt IS NULL`), tornando `submittedAt` nullable e eliminando o `DEFAULT CURRENT_TIMESTAMP`.
- Cada `WeeklogEntry` mantém status individual de inspeção física (`pending`, `approved`, `rejected`, `rectification_requested`).
- A assinatura gráfica é capturada para o documento do lote semanal (estritamente em formato PNG, rejeitando SVG para eliminar superfícies de ataque XSS/XML).

### 2.6. Validador Externo, Ciclo de Vida do Grant e Não-Auto-Validação
- Validadores externos devem possuir conta autenticada vinculada via `ClientAccessGrant`:
  - Campos de ciclo de vida: `status` (`"active"` | `"revoked"`), `grantedAt`, `revokedAt`, `revokedBy`.
  - Garantia estrutural de integridade de tenant: `(clientId, workspaceId)` vinculado via chave estrangeira composta.
  - Grants revogados (`status === "revoked"` ou `revokedAt != null`) são rejeitados com HTTP 403 `VALIDATOR_REVOKED`.
- O `validatorUserId` é extraído exclusivamente do token JWT (`RequestContext`).
- **Regra de Não-Auto-Validação em Lote (`VALIDATOR-BATCH-SELF-01`)**: Na validação do lote, o backend verifica se `ctx.actorUserId` coincide com o `technicianUserId` de **qualquer** entrada coberta pelo lote. Se o validador tiver executado qualquer item da rodada, a validação é sumariamente rejeitada com HTTP 403 Forbidden, mesmo em Personal Workspaces.

### 2.7. Imutabilidade Financeira e Remoção de `finalValue`
- A validação de WEEKLOG **NÃO** altera valores financeiros.
- Cada `WeeklogEntry` congela `totalAmount` (`Decimal(12, 2)`) e `currencyCode` (ISO-4217, herdado de `BudgetRevision.currencyCode` ou `ProductionOrder.currencyCode`).
- Finalização de ordem sem `currencyCode` é rejeitada com HTTP 422 `CURRENCY_REQUIRED` (sem defaults silenciosos).
- Divergências comerciais pertencem à Spec 004 (Lista/Confronto).

### 2.8. Serviços Estruturados em OPs Diretas via `Prisma.Decimal`
- Para ordens sem orçamento (`budgetId == null`), a OP exige o preenchimento de `performedServices` (array tipado com `name`, `description`, `type`, `quantity`, `unitPrice`, `total`).
- Valores numéricos são formatados no JSON como strings normalizadas e manipulados no backend estritamente via `Prisma.Decimal` / `Decimal.js`. Tipos `number` primitivos do JavaScript não são aceitos como autoridade monetária.
- Finalizar OP direta sem serviços estruturados retorna HTTP 422 `DIRECT_OP_NO_SERVICES`.

### 2.9. Máquina de Estados do Cabeçalho WEEKLOG
O `Weeklog.status` obedece às seguintes transições formais:
- `open` $\xrightarrow{\text{submitForValidation}}$ `pending_validation`
- `pending_validation` $\xrightarrow{\text{validateWeeklogBatch (todos aprovados)}}$ `validated`
- `pending_validation` $\xrightarrow{\text{validateWeeklogBatch (itens com retificação)}}$ `rectification_pending`
- `validated` $\xrightarrow{\text{rectifyWeeklogEntry (contestação pós-validação)}}$ `rectification_pending`
- `rectification_pending` $\xrightarrow{\text{re-finalize + submitForValidation}}$ `pending_validation`
- `closed`: **Estado reservado para a Spec 004**. O comando `closeWeeklog` não é implementado na Spec 003.

### 2.10. Integridade Relacional e Isolamento Multi-Tenant no PostgreSQL
- Constraints compostas no PostgreSQL impedem vazamento de tenant:
  - `(weeklogId, workspaceId) REFERENCES weeklogs(id, workspaceId) ON DELETE CASCADE`
  - `(productionOrderId, workspaceId) REFERENCES production_orders(id, workspaceId) ON DELETE RESTRICT`
  - `(rectificationOriginEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId) ON DELETE RESTRICT`
  - `(clientId, workspaceId) REFERENCES clients(id, workspaceId) ON DELETE CASCADE`

### 2.11. Downstream Legacy Projection Adapter (ServiceOrder)
- `Weeklog` e `WeeklogEntry` são a única Fonte da Verdade (*Single Source of Truth*).
- A tabela `service_orders` é mantida como projeção downstream através do **Downstream Legacy Projection Adapter** no `weeklogService`.
- Cada `WeeklogEntry` aponta para sua projeção através de `legacyServiceOrderId`.
- Execuções retificadas geram novas linhas de projeção legada, sem sobrescrever a execução original.
- Rotas legadas (`/service-orders`) tornam-se read-only ou delegam mutações para o `weeklogService`.

### 2.12. Concorrência e Tratamento de P2002 Fora da Transação
- A finalização concorrente utiliza `SELECT ... FOR UPDATE` na `ProductionOrder` dentro de `prisma.$transaction(isolationLevel: ReadCommitted)`.
- Se a ordem já estiver entregue na sequência corrente, retorna imediatamente a entrada existente com HTTP 200.
- **Tratamento de P2002**:
  - Em PostgreSQL, uma colisão de unique constraint coloca a transação em estado abortado. Consultas de recuperação **NUNCA** são executadas dentro da mesma transação abortada.
  - O erro `P2002` é capturado **fora** do bloco `$transaction`.
  - Em uma **nova operação isolada**, o backend analisa o alvo do erro:
    - Se a colisão for na sequência da PO (`productionOrderId_executionSequence`): executa nova leitura de `WeeklogEntry` e retorna a entrada criada concorrentemente com HTTP 200.
    - Se a colisão for no cabeçalho do Weeklog (`workspaceId_startsOn_clientId_siteKey`): dispara nova tentativa de finalização (onde o cabeçalho agora já existe no banco e será reutilizado sem colisão).

### 2.13. Governança da Assinatura Gráfica (Apenas PNG)
- Upload prévio em rota dedicada para caminho temporário no MinIO (`tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/temp_{uuid}.png`).
- Validação estrita de magic numbers de PNG (`89 50 4E 47 0D 0A 1A 0A`) e limite máximo de 1 MB. SVGs são sumariamente rejeitados.
- A validação do lote move o arquivo para o caminho definitivo (`tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/{validationId}.png`) e congela o registro `WeeklogValidation`.
- Modificações ou deleções pós-validação retornam HTTP 409 Conflict.

---

## 3. Consequências

### Positivas:
- Suporte determinístico a retificações múltiplas no mesmo período semanal via `executionSequence`.
- Identidade de lote estruturada sem campos nulos (`workspaceId`, `startsOn`, `clientId`, `siteKey`).
- Fuso horário IANA formal no workspace com fallback universal para `"UTC"`.
- Assinatura em lote versionada (`WeeklogValidation`) com PNG governado e seguro.
- Isolamento multi-tenant garantido estruturalmente por foreign keys compostas no PostgreSQL.
- Tratamento resiliente de concorrência e P2002 compatível com o comportamento transacional do PostgreSQL.
- Eliminação completa de efeitos colaterais financeiros prematuros e de mutações em requisições `GET`.

### Trade-offs:
- Exige criação da tabela `client_access_grants` com campos de ciclo de vida para validadores externos.
- Exige script de backfill com suporte a dry-run para mapeamento histórico em T08.
