# ADR-004: Modelo Canônico de Domínio para a Lista de Pagamento, Importações Externas e Confronto Comercial (Hardening Final Pré-Test-First)

**Status**: Accepted for Spec 004 (Hardened)  
**Data**: 2026-09-18  
**Decisores**: EverGreen Engineering Team & Operix Core Architecture  
**Fatia Afetada**: R2 — Lista de Pagamento, Importação Externa, Confronto Comercial e Fronteira Financeira  

---

## 1. Contexto

Na arquitetura brownfield original do Operix:
1. O termo **LISTA** é exibido na navegação da interface (`/payment-orders`) como o documento comercial de veículos a serem faturados.
2. Contudo, no banco de dados (`backend/prisma/schema.prisma`), não existe uma entidade agregadora de lote de lista de faturamento (`payment_lists`). Existe apenas a tabela `payment_orders`, onde cada registro armazena uma linha individual de veículo com uma coluna textual solta `list_name String?`.
3. Uma tabela separada chamada `production_lists` (`ProductionList`) foi introduzida na Onda 2 para controlar um quadro Kanban de produção com `listName String @unique`, mas sem integridade referencial com `payment_orders` nem com o faturamento.
4. O código identificador de lista (`listName = L010132`) era gerado no legado de forma acoplada a um único técnico e a uma única semana (`L + idTec + seq + semana`), colidindo diretamente com o modelo de negócio validado por Alex Souza, no qual listas de faturamento de grandes clientes são essencialmente **multissemanas** (agrupando reparos de semanas distintas como W29, W30, W31 e W32 na mesma folha).
5. A importação de documentos via OCR em `/api/extract/*` era puramente efêmera, devolvendo JSON direto para o frontend sem governança de arquivos no MinIO, sem cálculo de hash e sem staging persistido.
6. O motor de conciliação (`/finance/reconciliations/run`) executava um hard reset global (`deleteMany({ matchedBy: "auto" })`), destruindo reconciliações de todos os tenants simultaneamente e cruzando dados indiscriminadamente, além de estar incorretamente alocado no módulo Financeiro em vez de no fluxo de conferência da Lista.
7. A validação de divergências disparava a criação automática de linhas na tabela `financial_records` sem `workspaceId`, misturando conferência comercial com contabilidade de caixa.
8. A revisão humana da especificação inicial identificou blockers arquiteturais e fragilidades de invariantes:
   - Partial index PostgreSQL em tabela filha dependendo de status da tabela pai (`PaymentListItem` e `PaymentList.status`).
   - Ciclo de claims binário (`active | released`) vulnerável a double-billing residual de execuções já pagas.
   - Impossibilidade de persistir status de confronto para execuções ausentes na lista do cliente (`UNMATCHED_WEEKLOG`) quando o status residia em `PaymentListItem`.
   - Inexistência de versionamento de rodadas de confronto (`PaymentListConfrontationRun`), com risco de destruição de auditoria humana em re-execuções.
   - Risco de fabricação de ordens de produção fictícias para WEEKLOGs externos importados e ausência de snapshot de cobertura auditável.
   - Dependência de Float em valores de OCR antes da conferência humana.
   - Risco de colisão de numeração ao reiniciar contadores cegamente sem considerar os números legados pré-existentes.

---

## 2. Decisão

### 2.1. Separação Semântica e Autoridade Canônica
- **WEEKLOG (`Weeklog` e `WeeklogEntry`)**: Permanece como a representação imutável da **realidade física e técnica executada**, congelada no encerramento da Spec 003. A Spec 004 não altera cabeçalhos, snapshots ou assinaturas de WEEKLOG.
- **Lista de Pagamento (`PaymentList`)**: Representa o **reconhecimento comercial e o documento de faturamento** auditado com o cliente. Uma Lista consolida veículos executados em **múltiplas semanas operacionais distintas** para o mesmo cliente e workspace.
  - Possui `@@unique([id, workspaceId])` para permitir composite foreign keys de tenant em tabelas filhas e `@@unique([workspaceId, listNumber])`.
  - Registra totalizadores claros: `sourceDocumentTotal` (valor bruto declarado no documento do cliente) e `recognizedTotal` (valor aceito após o encerramento das decisões do confronto).
- **Item da Lista (`PaymentListItem`)**: Representa a linha comercial declarada/reconhecida, com chave composta `(paymentListId, workspaceId)` e vínculo opcional com `WeeklogEntry`.
  - Possui `@@unique([id, paymentListId, workspaceId])` e `@@unique([id, workspaceId])`.
- **Fronteira Financeira (Spec 005)**: A Lista de Pagamento nos status `pending` e `paid` atua estritamente como fonte canônica de derivação para as fórmulas de caixa ($\text{Esperado} = \sum \text{Lista em 'pending'}$ e $\text{Recebido} = \sum \text{Lista em 'paid'}$). A Spec 004 **NÃO** gera escrituração contábil automática em `financial_records`, não realiza liquidações parciais e não mantém campos como `totalPaid` ou `amountPaid`.

### 2.2. Ciclo de Vida Semântico de Claims (*Anti-Double-Billing*) via `PaymentListEntryClaim`
Para assegurar que uma execução física aprovada jamais seja cobrada em duplicidade e distinguir execuções em elaboração de execuções liquidadas:
- Adota-se a entidade canônica de reserva `PaymentListEntryClaim` com chave composta de tenant e partial unique index no PostgreSQL:
  ```sql
  CREATE UNIQUE INDEX unique_active_or_consumed_weeklog_entry_claim
  ON payment_list_entry_claims (workspace_id, weeklog_entry_id)
  WHERE status IN ('reserved', 'consumed');
  ```
- **Integridade Composta**:
  - `(paymentListId, workspaceId) REFERENCES payment_lists(id, workspaceId) ON DELETE CASCADE`
  - `(weeklogEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId) ON DELETE RESTRICT`
- **Estados Semânticos**:
  - `reserved`: Entrada temporariamente reservada por uma lista em elaboração (`draft`, `under_review` ou `confronted`).
  - `consumed`: Entrada comercialmente reconhecida e faturada quando a lista avança para `pending`. **Uma vez consumida, jamais pode retornar para `released`**.
  - `released`: Entrada liberada (no cancelamento da lista ou desfecho terminal `REJECT_ITEM` que retira o trabalho do faturamento).

### 2.3. Numeração Monotônica (`L0xxxxx`) com Descoberta Determinística de Seed
- A numeração segue o padrão `L` seguido de 6 dígitos decimais (`L000001` a `L999999`), escopada por tenant.
- A alocação é atômica via lock pessimista `SELECT ... FOR UPDATE` no modelo `TenantSequenceCounter`.
- **Script Seguro de Seed Discovery**:
  - O seed discovery é um script explícito (`scripts/seed-legacy-counters.ts`), **nunca** uma heurística embutida em migração SQL.
  - **Modo Padrão DRY-RUN**: Emite relatório de conferência sem alterar o banco (`--apply` obrigatório para gravar).
  - Apenas códigos com `workspaceId` determinístico comprovado em `payment_orders` compõem o seed: $\text{seed} = \max(\text{legacyNumbers})$.
  - Registros em `production_lists` sem workspace comprovado são **ignorados/pulados**.

### 2.4. Ciclo de Vida Estrito da Lista e Bloqueio por Disputas Abertas
A máquina de estados da `PaymentList` obedece à sequência linear obrigatória:
$$\text{draft} \longrightarrow \text{under\_review} \longrightarrow \text{confronted} \longrightarrow \text{pending} \longrightarrow \text{paid}$$
- **Proibição de Bypass**: É proibido transicionar diretamente de `under_review` para `pending`. A lista deve atingir `confronted`.
- **Invariante de Bloqueio por Disputas Abertas**: As decisões humanas `CONTEST` (contestação com o cliente) e `REQUEST_RECTIFICATION` (retrabalho na oficina) são desfechos **não-terminais (abertos)**. Uma lista **NÃO PODE** avançar para `pending` enquanto houver itens nessas condições (HTTP 409 `UNRESOLVED_DISPUTES_BLOCK_PENDING`).

### 2.5. Pipeline de Importação Externa com Staging Relacional e Preservação Monetária Bruta
- Uploads físicos (PDFs/imagens) são arquivados no MinIO sob `tenants/{workspaceId}/lists/imports/{id}/original_{fileName}` com hash SHA-256.
- A ingestão é modelada em duas entidades:
  1. `ExternalListImport`: cabeçalho do arquivo, hash, mimeType, lifecycle e backup opcional `rawOcrResult Json?`.
  2. `ExternalListImportItem`: linhas relacionais individuais com `rawTotalText String?` (preservando o texto monetário bruto do documento, e.g. `"€ 1.250,50"`), `reviewedTotal Decimal(12, 2)?` após parser com suporte a localidade, e scores de confiança por campo.
- A efetivação exige confirmação humana explícita (*Zero Auto-Commit*) com todos os campos obrigatórios validados (identificação veicular, serviços estruturados, moeda ISO-4217, total maior que zero).

### 2.6. Ingestão de WEEKLOG Externo com XOR Estrutural, Unicidade e Frozen Coverage
- Folhas de oficinas parceiras são tratadas sem criar ordens de produção falsas:
  1. Cria-se a esteira operacional: `ExternalOperationalImport` e `ExternalOperationalImportItem`.
  2. Na tabela `WeeklogEntry`, aplicam-se `sourceType` ("production_order" | "external_import"), `productionOrderId` nullable e `externalImportItemId`, governados por constraint CHECK XOR no PostgreSQL.
  3. Unicidade estrutural contra retries:
     ```sql
     CREATE UNIQUE INDEX unique_external_import_item_entry
     ON weeklog_entries (external_import_item_id)
     WHERE external_import_item_id IS NOT NULL;
     ```
  4. A validação formal cria rodada em `WeeklogValidation` com `validationMethod = "external_import_review"` e `coverageSnapshot` congelado com lista de IDs e sha256.
  5. A adição de `"external_import_review"` é retrocompatível com a Spec 003.

### 2.7. Motor de Confronto Comercial Versionado via `PaymentListConfrontationRun`
- O motor de confronto opera estritamente no escopo `(workspaceId, clientId)`, avaliando a Tríade Veículo (VIN/Placa), Serviços e Valor.
- **Rodadas Versionadas**: Cada execução gera uma rodada `PaymentListConfrontationRun` (`sequence INT`).
- **Resultados Desacoplados (`PaymentListConfrontationResult`)**:
  - `runId UUID REFERENCES payment_list_confrontation_runs(id) ON DELETE CASCADE`.
  - Integridade composta:
    - `(paymentListItemId, paymentListId, workspaceId) REFERENCES payment_list_items(id, paymentListId, workspaceId)`.
    - `(weeklogEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId)`.
  - Unicidade por rodada: `UNIQUE(run_id, payment_list_item_id)` e `UNIQUE(run_id, weeklog_entry_id)`.
  - Status inicial default: `not_evaluated`.
- **Idempotência e Bloqueio de Rerun**: Reruns com decisões humanas na rodada ativa são bloqueados com HTTP 409 `CONFRONTATION_RERUN_HAS_DECISIONS`.

### 2.8. Linhagem da Retificação Comercial sem Entidade Sintética
- Quando o gestor aciona `REQUEST_RECTIFICATION`, o sistema invoca a transação canônica `rectifyWeeklogEntry` da Spec 003.
- A `ProductionOrder` original é reaberta com `executionSequence + 1`.
- Em `PaymentListConfrontationResult`, gravam-se os campos reais de rastreabilidade: `reopenedProductionOrderId` e `targetExecutionSequence`.

### 2.9. Autoridade Estrita de Moeda (Formato ISO-4217 de 3 Letras Maiúsculas)
- `PaymentList.currencyCode` é obrigatório, sem default no schema e validado por regex `^[A-Z]{3}$` (ex.: `"EUR"`, `"BRL"`).
- Omissão retorna HTTP 422 `CURRENCY_REQUIRED`; moedas divergentes retornam HTTP 422 `CURRENCY_MISMATCH`.

### 2.10. Escopo de Ator e Fronteira de Repasse (`scope: own`)
- Técnicos com papel `technician` visualizam apenas seus próprios itens comerciais reconhecidos e status.
- Faturamento total, margens e rateios são omitidos server-side. Zero fórmulas simuladas de repasse na Spec 004.

### 2.11. Autoridade e Idempotência da Liquidação (`status = 'paid'`)
- A transição para `paid` é restrita exclusivamente a `owner` e `admin`, opera de forma idempotente e possui **zero efeitos em `financial_records`**.

### 2.12. Downstream Legacy Projection Adapter & Transição de Call Sites
- `PaymentList` e `PaymentListItem` são a única fonte da verdade.
- O espelhamento na tabela legada `payment_orders` é estritamente unidirecional.
- O endpoint destrutivo `/finance/reconciliations/run` é sumariamente descontinuado. Rotas antigas de mutação de ordens de pagamento migram para `/api/payment-lists`.

---

## 3. Consequências

### Positivas:
- Prevenção garantida contra dupla cobrança tanto concorrente quanto pós-faturamento através do ciclo tripartite de claims (`reserved`, `consumed`, `released`).
- Rastreabilidade e imutabilidade do trabalho de auditoria humana via rodadas versionadas de confronto (`PaymentListConfrontationRun`).
- Preservação da fidelidade do documento fiscal original com `rawTotalText` e parser com suporte a localidade.
- Integridade referencial máxima assegurada por foreign keys compostas com tenant e lista.
- Continuidade operacional sem riscos de colisão através de script determinístico de seed discovery.
- Fronteira contábil e de segurança limpa com a Spec 005 e conformidade estrita com a Constituição Operix (`AGENTS.md`).

### Negativas / Mitigações:
- Exige migração forward-only abrangente contemplando novas tabelas de cabeçalho, claims, rodadas, resultados e staging relacional.
- Exige manutenção do Downstream Adapter até a desativação completa das views legadas.
