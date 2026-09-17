# Decisões de Arquitetura e Design — Spec 003 (Revisão Pós-Remediação Final)

**Data**: 2026-09-17  
**Fatia**: R1 — Operação Móvel: Conclusão de OP, WEEKLOG, Validação em Lote e Retificação Versionada  
**Branch**: `feat/003-production-weeklog`  
**Base**: `develop/operix-core`  

---

## 1. Matriz Canônica de Decisões de Engenharia

| Decisão | Tópico de Arquitetura | Resumo da Decisão Adotada |
|---|---|---|
| **DEC-001** | **Semântica e Modelo Canônico** | Adota-se a **Opção C**: `Weeklog` (cabeçalho de lote) e `WeeklogEntry` (item executado) tornam-se a única Fonte da Verdade. A tabela legada `service_orders` é mantida estritamente como projeção downstream através do **Downstream Legacy Projection Adapter** no `weeklogService` (*Expand-Contract*). |
| **DEC-002** | **Execução Versionada e Retificação** | Substituição da constraint frágil por **execução versionada**: `ProductionOrder.executionSequence` e `WeeklogEntry.executionSequence` com **`@@unique([productionOrderId, executionSequence])`**. Cada reabertura formal para retificação incrementa a sequência na OP. |
| **DEC-003** | **Linhagem Estrutural de Retificação** | O campo `rectificationOriginEntryId` é uma foreign key auto-referenciada formal no PostgreSQL apontando para `WeeklogEntry.id` com `onDelete: Restrict`. A nova entrada aponta obrigatoriamente para a entrada imediatamente anterior que originou o retrabalho. |
| **DEC-004** | **Identidade Determinística de Cabeçalho** | O cabeçalho `Weeklog` não utiliza campos nulos em sua chave de unicidade: **`@@unique([workspaceId, startsOn, clientId, siteKey])`**. `clientId` é obrigatório para finalizar a OP; a oficina/local é extraída de `ProductionOrder.operationalSiteKey` (não-nula; erro 422 se ausente). `week`/`yearReference` são campos derivados de exibição. |
| **DEC-005** | **Fuso Horário Canônico no Workspace** | O modelo `Workspace` recebe a coluna `timezone String @default("UTC")` (formato IANA). O fallback canônico é estritamente `"UTC"`. `Weeklog.timezone` armazena o snapshot utilizado. O timestamp UTC de `startsOn` (Domingo 00:00) deriva do fuso horário configurado no workspace. |
| **DEC-006** | **Granularidade de Validação e `submitForValidation`** | O **WEEKLOG é validado e assinado como documento semanal em lote**. Criação do endpoint `POST /api/weeklogs/:id/submit-for-validation` que transiciona `open` $\rightarrow$ `pending_validation` e congela o `coverageSnapshot` da rodada. `WeeklogValidation` versionado via `validationSequence Int` (`@@unique([weeklogId, validationSequence])`). Assinatura em lote estritamente em PNG. |
| **DEC-007** | **Validador Externo e Ciclo de Vida do Grant** | O validador externo deve possuir conta autenticada e vínculo no modelo `ClientAccessGrant` (`status`, `grantedAt`, `revokedAt`, `revokedBy`), com integridade multi-tenant garantida por foreign key composta com `(clientId, workspaceId)`. Grants revogados são rejeitados com HTTP 403. |
| **DEC-008** | **Proibição de Auto-Validação em Lote** | **Regra Estrita (`VALIDATOR-BATCH-SELF-01`)**: Na validação em lote, o backend verifica se `ctx.actorUserId` coincide com o `technicianUserId` de **qualquer** entrada coberta pelo lote. Se o validador tiver executado qualquer item da rodada, a validação é recusada com HTTP 403 Forbidden, mesmo em Personal Workspaces. |
| **DEC-009** | **Autoridade de Identidade Server-Side** | O identificador `validatorUserId` é extraído exclusivamente do token JWT (`RequestContext`). Nome, cargo e matrícula do validador são resolvidos server-side. O cliente HTTP não possui autoridade para declarar identidades auditáveis no payload. |
| **DEC-010** | **Remoção de `finalValue` e Imutabilidade Financeira** | A validação do WEEKLOG não altera valores monetários (`finalValue` é eliminado). `WeeklogEntry` congela `totalAmount` (`Decimal(12, 2)`) e `currencyCode` (ISO-4217, herdado da `BudgetRevision` ou de `ProductionOrder.currencyCode`; finalização sem moeda retorna HTTP 422). Divergências comerciais pertencem à Spec 004. |
| **DEC-011** | **Serviços Estruturados com Decimais em OPs Diretas** | Ordens de produção sem orçamento prévio exigem `performedServices` com decimais representados como strings normalizadas. O backend utiliza `Prisma.Decimal` para recalcular e persistir valores, sem uso de floats JavaScript. OPs diretas sem serviços retornam HTTP 422 `DIRECT_OP_NO_SERVICES`. |
| **DEC-012** | **Máquina de Estados Formal do Cabeçalho** | Ciclo de vida: `open` $\xrightarrow{\text{submit}}$ `pending_validation` $\xrightarrow{\text{validate}}$ `validated` $\xrightarrow{\text{rectify}}$ `rectification_pending` $\xrightarrow{\text{re-submit}}$ `pending_validation`. O estado `closed` é reservado para a Spec 004 (comando `closeWeeklog` não implementado nesta spec). |
| **DEC-013** | **Integridade de Tenant no PostgreSQL** | Foreign keys compostas no PostgreSQL impedem vazamento de tenant: `(weeklogId, workspaceId)`, `(productionOrderId, workspaceId)`, `(rectificationOriginEntryId, workspaceId)` e `(clientId, workspaceId)`. |
| **DEC-014** | **Downstream Legacy Projection Adapter (ServiceOrder)** | Toda autoridade de escrita pertence a `weeklogService`. A tabela `service_orders` é uma projeção downstream alimentada via adapter. Cada `WeeklogEntry` aponta para sua projeção por `legacyServiceOrderId`. Retificações geram novas linhas de projeção. Rotas legadas tornam-se read-only ou delegam para o serviço canônico. |
| **DEC-015** | **Backfill Não-Destrutivo com Dry-Run (T08)** | O script `scripts/backfill-legacy-service-orders.ts` realiza o mapeamento idempotente de `service_orders` históricas para os modelos canônicos, suportando `--dry-run`, gerando relatório de mapeamento e sem sobrescrever registros históricos. Na interface, exibe-se o selo *Legacy Archive* como fallback. |
| **DEC-016** | **Delegação da Finalização Legada** | `POST /api/production-orders/:id/finalize` é o comando canônico. O handler legado `PATCH /api/production-orders/:id` com `status: "delivered"` delega obrigatoriamente ao `finalizeProductionOrder`. |
| **DEC-017** | **Concorrência, Lock Pessimista e Tratamento Externo de P2002** | Bloqueio pessimista com `SELECT ... FOR UPDATE` na OP em `prisma.$transaction(isolationLevel: ReadCommitted)`. Colisões `P2002` são capturadas **fora** da transação abortada, realizando re-leitura segura em nova operação e distinguindo colisão na sequência da PO de colisão no cabeçalho do Weeklog. |
| **DEC-018** | **Governança da Assinatura Gráfica (Apenas PNG)** | Upload prévio em staging MinIO (`tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/temp_{uuid}.png`). Suporta estritamente PNG (validação de magic bytes `89 50 4E 47`, limite 1 MB; SVGs são rejeitados). A validação em lote move o arquivo para o caminho definitivo e congela o registro. Mutações pós-validação retornam HTTP 409. |

---

## 2. Detalhamento Técnico das Regras de Domínio e Concorrência

### 2.1. Tabela de Transições da Máquina de Estados de `Weeklog`

| Estado Atual | Evento / Gatilho | Condição de Guarda | Próximo Estado | Efeito Colateral |
|---|---|---|---|---|
| `open` | `finalizeProductionOrder` | OP com `clientId`, `operationalSiteKey` e serviços estruturados | `open` | Cria `WeeklogEntry(sequence)` e atualiza `startsOn`/`endsOn`. |
| `open` | `submitForValidation` | Ao menos 1 entrada existente no lote | `pending_validation` | Congela `coverageSnapshot` com os itens da rodada. |
| `pending_validation` | `validateWeeklogBatch` (Todos aprovados) | Todas as entries da coverage aprovadas | `validated` | Cria `WeeklogValidation(seq)`, move assinatura PNG e congela o lote. |
| `pending_validation` | `validateWeeklogBatch` (Com retificação) | Ao menos 1 item com retificação solicitada | `rectification_pending` | Cria `WeeklogValidation(seq)` com cobertura parcial; reabre OPs reprovadas. |
| `validated` | `rectifyWeeklogEntry` (Contestação pós-validação)| Justificativa formal obrigatória | `rectification_pending` | Reabre a OP para retrabalho técnico (`executionSequence + 1`). |
| `rectification_pending`| `finalizeProductionOrder` (Retrabalho) | Nova execução sequence+1 concluída | `open` ou `rectification_pending` | Adiciona nova `WeeklogEntry` vinculada à anterior via `rectificationOriginEntryId`. |
| `rectification_pending`| `submitForValidation` | Retrabalhos concluídos e prontos para inspeção | `pending_validation` | Congela novo `coverageSnapshot` da rodada de re-conferência. |
| `validated` | *Spec 004 Commercial Handover* | Lote auditado e pronto para faturamento | `closed` | *Estado reservado para a Spec 004 (não implementado nesta spec)*. |

---

### 2.2. Algoritmo de Concorrência e Tratamento de P2002 Fora da Transação

```typescript
// Implementação em backend/src/services/weeklogService.ts:

export async function finalizeProductionOrder(
  ctx: RequestContext,
  orderId: string,
): Promise<{ order: any; entry: any; idempotent: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Bloqueio pessimista da ProductionOrder
      const lockedOrders = await tx.$queryRaw<Array<{
        id: string;
        workspaceId: string;
        status: string;
        executionSequence: number;
        clientId: string | null;
        operationalSiteKey: string | null;
        currencyCode: string | null;
      }>>`
        SELECT id, workspace_id as "workspaceId", status, execution_sequence as "executionSequence",
               client_id as "clientId", operational_site_key as "operationalSiteKey"
        FROM production_orders
        WHERE id = ${orderId}
        FOR UPDATE
      `;
      const order = lockedOrders[0];
      if (!order) throw new NotFoundError("Ordem de produção não encontrada.");
      assertTenantAccess(ctx, order.workspaceId);

      // 2. Se já finalizada na sequência corrente -> Retorno Idempotente imediato
      if (order.status === "delivered") {
        const existingEntry = await tx.weeklogEntry.findUnique({
          where: {
            productionOrderId_executionSequence: {
              productionOrderId: order.id,
              executionSequence: order.executionSequence,
            },
          },
        });
        if (existingEntry) return { order, entry: existingEntry, idempotent: true };
      }

      // 3. Validações de pré-condição estritas
      if (!order.clientId) {
        throw new UnprocessableEntityError("CLIENT_REQUIRED: A ordem exige vínculo com cliente canônico para ser finalizada.");
      }
      if (!order.operationalSiteKey || !order.operationalSiteKey.trim()) {
        throw new UnprocessableEntityError("OPERATIONAL_SITE_REQUIRED: A ordem exige local operacional resolvido (operationalSiteKey).");
      }

      // 4. Execução da transição atômica
      const updatedOrder = await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: "delivered", deliveredAt: new Date() },
      });
      const weeklog = await upsertWeeklogHeader(tx, ctx, updatedOrder);
      const entry = await tx.weeklogEntry.create({
        data: buildWeeklogEntryData(updatedOrder, weeklog),
      });
      await syncDownstreamLegacyServiceOrderProjection(tx, updatedOrder, entry);
      return { order: updatedOrder, entry, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error: any) {
    // 5. Tratamento de colisão P2002 FORA da transação abortada
    if (error.code === "P2002") {
      const target = String(error.meta?.target || "");
      // Caso A: Race condition na mesma ProductionOrder
      if (target.includes("production_order_id") || target.includes("execution_sequence")) {
        const freshOrder = await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
        const recoveredEntry = await prisma.weeklogEntry.findUniqueOrThrow({
          where: {
            productionOrderId_executionSequence: {
              productionOrderId: orderId,
              executionSequence: freshOrder.executionSequence,
            },
          },
        });
        return { order: freshOrder, entry: recoveredEntry, idempotent: true };
      }
      // Caso B: Race condition na criação do cabeçalho Weeklog por OPs distintas
      if (target.includes("starts_on") || target.includes("client_id") || target.includes("site_key")) {
        // Retry em nova operação limpa: o cabeçalho agora já existe e será reutilizado
        return await finalizeProductionOrder(ctx, orderId);
      }
    }
    throw error;
  }
}
```
