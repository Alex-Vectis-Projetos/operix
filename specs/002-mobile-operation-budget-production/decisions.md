# Decisões de Arquitetura e Design — Spec 002 (Final Cleanup)

**Data**: 2026-09-14  
**Status**: Ready for Implementation  
**Fatia**: R1 — Operação Móvel: Orçamento → Revisões → Aprovação → Produção  

---

## 1. Cardinalidade Budget → ProductionOrder (1:0..1) e Constraint Composta

### Problema
Garantir estruturalmente que um `Budget` possua no máximo uma `ProductionOrder` operacional e que o `budgetRevisionId` registrado na ordem pertença comprovadamente ao mesmo `budgetId`.

### Decisão
1. **Cardinalidade 1:0..1**: Um `Budget` pode possuir no máximo UMA `ProductionOrder`.
2. **Garantia Estrutural no Banco**:
   - `ProductionOrder.budgetId` possui constraint `@@unique([budgetId])`.
   - `BudgetRevision` possui constraint `@@unique([id, budgetId])`.
   - `ProductionOrder` possui foreign key composta referenciando `(budget_revision_id, budget_id) REFERENCES budget_revisions(id, budget_id)`.
   - **Efeito**: É impossível no nível do PostgreSQL que uma ordem aponte para um `budgetId` X com uma revisão que pertença ao `budgetId` Y.
3. **Primeira Aprovação**:
   - A primeira aprovação cria a `ProductionOrder` vinculada.
4. **Re-Aprovações Subsequentes (Mesmo Budget, OP Aberta)**:
   - Se uma nova revisão for aprovada enquanto a ordem estiver em andamento (`status != 'delivered'`), o backend mantém a mesma `ProductionOrder`, atualizando apenas os campos da whitelist permitida.
   - Nenhuma segunda ordem é criada.
5. **Fronteira com Ordem Finalizada (`delivered`)**:
   - Se a OP vinculada já estiver com status `delivered`, a tentativa de aprovação retorna HTTP 422 Unprocessable Entity, exigindo o fluxo de Retificação (escopo de transição na Spec 003).

---

## 2. Whitelist de Campos Atualizáveis na Re-Aprovação de OP

### Problema
Impedir que uma re-aprovação de orçamento sobrescreva acidentalmente o progresso operacional, status de execução, apontamento de técnico ou fotos já realizadas na oficina.

### Decisão
Quando uma nova `BudgetRevision` for aprovada para uma `ProductionOrder` aberta existente, aplica-se uma **whitelist estrita**:

#### Campos PERMITIDOS para Atualização:
1. `budgetRevisionId`: Atualizado para o ID da nova revisão aprovada;
2. `notes`: Atualizado com os novos dados estruturados do orçamento;
3. Atributos de identificação veicular e cliente (se alterados na nova revisão):
   - `brand`, `model`, `color`, `licensePlate`, `vin`;
   - `clientId`, `clientName`;
4. Metadados comerciais derivados:
   - `platform`: Atualizado com o novo valor total (ex.: `Orçamento ORC-001 · Total 1500.00 EUR`);
   - `insurer`: Atualizado com o novo catálogo resumido de intervenções;
   - `dueAt`: Atualizado caso a nova revisão tenha repactuado a data limite.

#### Campos ESTRITAMENTE PROIBIDOS de Sobrescrita:
- `status`: Preservado integralmente (se estiver `in_production` ou `paused`, permanece como está);
- `startedAt`, `finishedAt`, `deliveredAt`: Timestamps de execução já ocorridos são intocáveis;
- `technicianUserId`, `technicianName`: O técnico já designado para a execução física não é alterado;
- `priority`: A prioridade de oficina não é rebaixada;
- `photos`, documentos, timeline e eventos operacionais já anexados à ordem são 100% preservados.

---

## 3. Modelo de Estados e Eliminação de `Budget.status`

### Problema
Manter `Budget.status` e `BudgetRevision.status` em paralelo criava duplicidade semântica e risco de dessincronização de estado.

### Decisão
1. **Remoção de `Budget.status`**:
   - O agregador `Budget` **não possui coluna `status`**.
   - O estado do ciclo de vida pertence exclusivamente à revisão: `BudgetRevision.status` (`draft` | `submitted` | `approved` | `rejected`).
2. **Ponteiros de Estado Canônicos em `Budget`**:
   - `currentRevisionId`: Aponta para a revisão mais recente em trabalho (rascunho ou submetida);
   - `approvedRevisionId`: Aponta para a revisão atualmente aprovada e vigente (ou `null` se nenhuma foi aprovada).
3. **Semântica Derivada do Agregador**:
   - Se `approvedRevisionId !== null`: o orçamento possui versão aprovada contratada;
   - Se `approvedRevisionId === null`: o orçamento está em fase de proposta/negociação;
   - Uma revisão aprovada mantém seu status como `approved` permanentemente no banco.
   - Criar uma Revisão 2 (rascunho) altera apenas `currentRevisionId` para apontar para a Revisão 2, mantendo a Revisão 1 intacta e apontada por `approvedRevisionId`.

---

## 4. Relações Prisma e Integridade Estrutural

### Decisão
Definir relações formais no schema Prisma com nomes explícitos e chaves estrangeiras:
- `Budget.workspace`: `Workspace` via `workspaceId`;
- `Budget.client`: `Client?` via `clientId`;
- `Budget.createdBy`: `User` via `createdById`;
- `Budget.technician`: `User?` via `technicianUserId`;
- `Budget.currentRevision`: `BudgetRevision?` via `currentRevisionId` (`onDelete: SetNull`);
- `Budget.approvedRevision`: `BudgetRevision?` via `approvedRevisionId` (`onDelete: SetNull`);
- `Budget.revisions`: `BudgetRevision[]`;
- `Budget.photos`: `BudgetPhoto[]`;
- `ProductionOrder.budget`: `Budget?` via `budgetId` (`@unique`);
- `ProductionOrder.budgetRevision`: `BudgetRevision?` via relação composta `(budgetRevisionId, budgetId)`.

---

## 5. Idempotência Concorrente Real para Migração do LocalStorage

### Problema
Um índice simples `@@index([workspaceId, legacyLocalId])` não impedia que duas requisições concorrentes de sync criassem orçamentos duplicados para o mesmo item legado.

### Decisão
1. Alterar a constraint para **`@@unique([workspaceId, legacyLocalId])`** no modelo `Budget`.
2. Como PostgreSQL suporta múltiplos valores `NULL` em índices únicos, orçamentos criados diretamente na plataforma (onde `legacyLocalId` é nulo) não sofrem restrição.
3. Se um cliente enviar o mesmo `legacyLocalId` em paralelo ou após falha de rede, a segunda inserção é rejeitada ou resolvida via `upsert`, garantindo zero duplicidade estrutural.

---

## 6. Aprovação e Rejeição com `revisionId` Explícito

### Problema
Aprovar ou rejeitar implicitamente "a revisão corrente" criava condições de corrida onde uma alteração simultânea aprovava dados não revisados pelo operador.

### Decisão
1. Os endpoints de aprovação e rejeição exigem obrigatoriamente o identificador da revisão:
   - `POST /api/budgets/:id/revisions/:revisionId/approve`
   - `POST /api/budgets/:id/revisions/:revisionId/reject`
2. **Tratamento de Estado Divergente**:
   - Se o `revisionId` enviado não for a revisão corrente aguardando decisão, ou se a revisão já estiver em estado incompatível (ex.: já aprovada ou cancelada), o backend rejeita a chamada com **HTTP 409 Conflict**.
   - A resposta informa o estado atualizado para que o cliente recarregue os dados antes de prosseguir.

---

## 7. Personal Workspace Canônico (ADR-002)

### Decisão
Conforme o [ADR-002](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/adr/002-personal-workspace-lifecycle.md):
1. `ownerUserId` aponta estritamente para `AppUser.id` (chave estrangeira para `app_users.id`).
2. Adicionar coluna `type String @default("company")` em `Workspace`.
3. Adicionar índice único parcial garantindo **no máximo 1 personal workspace por técnico**:
   ```sql
   CREATE UNIQUE INDEX "workspaces_owner_user_id_personal_key" 
   ON "workspaces"("owner_user_id") WHERE "type" = 'personal';
   ```
4. O provisionamento é idempotente (upsert/transação protegida pelo índice).
5. O cabeçalho `X-Workspace-Id` é um seletor não-confiável: o backend sempre valida `Membership` ativa antes de autorizar qualquer operação.

---

## 8. Chaves de Storage com IDs Canônicos (UUIDs)

### Problema
Utilizar código humano de exibição (como `ORC-2026-0001`) nos caminhos do MinIO causava instabilidade caso o código fosse formatado ou modificado.

### Decisão
Todos os caminhos do MinIO utilizam estritamente identificadores UUID canônicos:
- Fotos de Orçamento: `tenants/{workspaceId}/budgets/{budgetId}/{photoId}.jpg`
- Fotos de Produção: `tenants/{workspaceId}/production-orders/{orderId}/{photoId}.jpg`
- Assinatura Digital: `tenants/{workspaceId}/budgets/{budgetId}/signatures/{revisionId}.png`

---

## 9. Canonicidade Operacional de `Client` em R1

### Decisão
- `Client` (`model Client` / tabela `clients`) é a entidade canônica operacional em R1.
- `BillingClient` continua restrito a faturamento/fiscal.
- Rotas `GET /api/clients` e `POST /api/clients` validam tenant no servidor.
- Associações cross-tenant de `clientId` são rejeitadas com erro 403 Forbidden.

---

## 10. Governança de Qualidade, Baseline e Linter

### Decisão
- **T00 Baseline Gate**: Obrigatório validar histórico de migrations do zero antes de aplicar a nova migration.
- **Linter**: Critério de **0 novos erros de linter** em relação à branch `develop/operix-core`.
- Como `OrderDetailDialog.tsx` é alterado nesta fatia, todos os seus erros de lint existentes são saneados.
