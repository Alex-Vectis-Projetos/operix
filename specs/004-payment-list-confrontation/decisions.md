# Decisões Arquiteturais e de Domínio — Spec 004 (Hardening Final Pré-Test-First)

**Fatia**: R2 — Lista de Pagamento, Importação Externa, Confronto Operacional e Fronteira Financeira  
**Branch**: `feat/004-payment-list-confrontation`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-18 (Hardening Final Pré-Test-First)  

---

## 1. Contexto das Decisões

A presente especificação formaliza as decisões de design técnico e de negócio para a vertical de **Lista de Pagamento, Importação Externa de Documentos, Confronto Comercial e Fronteira Financeira**, incorporando o hardening dos invariantes estruturais identificados na revisão final antes do início do ciclo *Test-First* (T01/T02).

As decisões respeitam rigorosamente:
1. O **Contrato Fase 1 / ANEXO I** (requisitos de R2).
2. O **Modelo de Domínio Core** (`docs/project/DOMAIN.md`).
3. As diretrizes da reunião com o cliente Alex Souza (`docs/Reunião Alex Operix 2.txt` e `docs/audit/meeting-2-delta.md`).
4. A **Constituição Operix** (`AGENTS.md`).

---

## 2. Inventário de Decisões Formais

### DEC-001: Modelo Canônico de Domínio para a Lista de Pagamento (`PaymentList` e `PaymentListItem`)
- **Problema**: O modelo legado utiliza `payment_orders` (uma linha desnormalizada por carro) com uma coluna textual solta `list_name`, sem cabeçalho, sem chaves estrangeiras e sem integridade referencial com o WEEKLOG.
- **Decisão**:
  1. Criar o modelo canônico de cabeçalho `PaymentList`:
     - Identificado por UUID e por código legível `listNumber` (ex.: `"L000142"`).
     - Pertence obrigatoriamente a um `workspaceId` (not null) e a um `clientId` (not null).
     - Possui restrição de unicidade composta: `@@unique([id, workspaceId])` para viabilizar foreign keys compostas de tenant em tabelas filhas, além de `@@unique([workspaceId, listNumber])`.
     - Totalizadores agregados auditáveis: `sourceDocumentTotal` (declarado no documento) e `recognizedTotal` (total efetivamente aceito após decisões do confronto).
  2. Criar o modelo relacional de itens `PaymentListItem`:
     - Chave composta de tenant: `(paymentListId, workspaceId) REFERENCES payment_lists(id, workspaceId) ON DELETE CASCADE`.
     - Unicidade composta para integridade de confronto: `@@unique([id, paymentListId, workspaceId])` e `@@unique([id, workspaceId])`.
     - Vínculo relacional com a execução original: `weeklogEntryId String?` (nullable para acomodar itens lançados pelo cliente que não existam na produção da oficina).
     - Snapshot dos dados do item comercial: `carName`, `licensePlate`, `vin`, `servicesSnapshot Json`, `totalAmount Decimal(12, 2)`.
- **Justificativa**: Garante integridade referencial ACID, isolamento de tenant em nível de banco e separação estrita entre o cabeçalho comercial e as linhas declaradas.

---

### DEC-002: Máquina de Estados e Ciclo de Vida Estrito da Lista de Pagamento
- **Problema**: A proposta anterior continha inconsistência permitindo que a lista saltasse de `under_review` diretamente para `pending`, sem passar por `confronted`.
- **Decisão**:
  A entidade `PaymentList.status` obedecerá a uma máquina de estados rigorosa e sequencial:
  $$\text{draft} \longrightarrow \text{under\_review} \longrightarrow \text{confronted} \longrightarrow \text{pending} \longrightarrow \text{paid}$$
  - `draft`: Lista recém-criada manual ou via OCR, em conferência preliminar.
  - `under_review`: Lista em processo de auditoria de veículos e serviços contra os WEEKLOGs.
  - `confronted`: Todas as divergências foram confrontadas e chanceladas pelo gestor com desfechos terminais.
  - `pending`: Estado canônico do contrato onde a lista é considerada **Reconhecida** e entra na projeção de receita **Esperada** ($\text{Esperado} = \sum \text{Lista Pendente}$). **É expressamente proibido saltar diretamente para `pending` sem passar por `confronted`**.
  - `paid`: Estado canônico onde o pagamento foi confirmado pelo gestor com base no recebimento bancário ($\text{Recebido} = \sum \text{Lista Paga}$).
  - `cancelled`: Lista descartada ou cancelada antes da liquidação.
- **Justificativa**: Garante que nenhuma lista seja faturada ou considerada esperada no financeiro sem ter concluído o confronto operacional.

---

### DEC-003: Ciclo de Vida Semântico de Claims (`reserved`, `consumed`, `released`) e Integridade Composta
- **Problema**: A formulação anterior binária (`active | released`) não distinguia uma lista em elaboração de uma lista já faturada/paga, criando risco de liberação indevida de execuções pagas. Além disso, um partial unique index direto em `payment_list_items` filtrando por `status != 'cancelled'` é impossível no PostgreSQL porque `status` pertence à tabela pai.
- **Decisão**:
  1. **Tabela Canônica de Reserva**: Criar `payment_list_entry_claims` com:
     `workspaceId UUID`, `paymentListId UUID`, `weeklogEntryId UUID`, `status VARCHAR(16) DEFAULT 'reserved'`.
  2. **Integridade Composta de Tenant/Lista**:
     - `FOREIGN KEY (paymentListId, workspaceId) REFERENCES payment_lists(id, workspaceId) ON DELETE CASCADE`
     - `FOREIGN KEY (weeklogEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId) ON DELETE RESTRICT`
     - Proíbe claims apontando para `WeeklogEntry` ou `PaymentList` cross-tenant.
  3. **Estados Semânticos do Claim**:
     - `reserved`: A `WeeklogEntry` está temporariamente reservada por uma lista em elaboração (`draft`, `under_review` ou `confronted`).
     - `consumed`: A execução foi comercialmente reconhecida de forma terminal quando a lista avança para `pending`. **Uma vez consumida, jamais pode voltar para `released` sem comando administrativo excepcional fora da Spec 004**.
     - `released`: A execução foi liberada (cancelamento da lista ou desfecho `REJECT_ITEM` terminal que retira o item do faturamento).
  4. **Garantia Estrutural Anti-Double-Billing**:
     ```sql
     CREATE UNIQUE INDEX unique_active_or_consumed_weeklog_entry_claim
     ON payment_list_entry_claims (workspace_id, weeklog_entry_id)
     WHERE status IN ('reserved', 'consumed');
     ```
  5. **Regras de Transição**:
     - Inclusão em lista: $\rightarrow$ `reserved`. Tentativas concorrentes colidem com HTTP 409 Conflict (`WEEKLOG_ENTRY_ALREADY_CLAIMED`).
     - Lista cancelada (`cancelled`): todas as suas claims `reserved` $\rightarrow$ `released`.
     - Desfecho `REJECT_ITEM` terminal: claim associada $\rightarrow$ `released` (se e somente se o trabalho não foi reconhecido nessa lista).
     - Lista avançando para `pending`: todas as claims de itens aceitos (`exact_match`, `accept_difference`) transicionam para $\rightarrow$ `consumed`.
     - Lista em `paid`: claims permanecem `consumed`.
     - Decisão `CONTEST` ou `REQUEST_RECTIFICATION`: claim permanece `reserved` até o desfecho comercial.
- **Justificativa**: Elimina brechas de faturamento duplicado tanto concorrente quanto histórico pós-liquidação.

---

### DEC-004: Numeração Sequencial Monotônica (`L0xxxxx`) com Descoberta Determinística de Seed
- **Problema**: Reiniciar contadores em `L000001` colidiria com o histórico legado. Executar heurísticas silenciosas na migração SQL traria riscos imprevisíveis em staging e produção.
- **Decisão**:
  1. O formato segue estritamente `L` seguido de 6 dígitos decimais (`L000001` a `L999999`), escopado por tenant.
  2. Geração atômica via lock pessimista `SELECT ... FOR UPDATE` em `TenantSequenceCounter`.
  3. **Ferramenta de Seed Discovery Segura e Determinística**:
     - O seed discovery é um script/CLI explícito (`scripts/seed-legacy-counters.ts`), **NUNCA** uma heurística embutida em migração SQL.
     - **Modo Padrão DRY-RUN**: Relata sem alterar o banco (`--apply` obrigatório para persistir).
     - **Escopo Estritamente Determinístico**:
       - Registros em `payment_orders` com `workspaceId` válido e formato `^L(\d{6})$`: elegíveis para cálculo de `seed = MAX(legacyNumber)`.
       - Registros em `production_lists` que **não possuam vínculo determinístico comprovado** com um workspace: **SÃO IGNORADOS / PULADOS** (não atribuir por adivinhação).
     - Relatório gerado: `scanned`, `validFormat`, `deterministicallyScoped`, `ambiguous`, `malformed`, `seedByWorkspace`.
     - Se nenhum código for encontrado, o seed do workspace é `0`, gerando `L000001`.
- **Justificativa**: Evita colisão catastrófica com histórico e garante 100% de previsibilidade e auditabilidade no deploy.

---

### DEC-005: Pipeline de Importação Externa com Staging Relacional e Preservação Monetária Bruta
- **Problema**: O uso de `rawTotal Float` impõe arredondamentos incorretos de ponto flutuante antes da conferência humana e descaracteriza a moeda textual original.
- **Decisão**:
  1. **Armazenamento MinIO**: `tenants/{workspaceId}/lists/imports/{id}/original_{fileName}` com hash SHA-256 e metadados.
  2. **Modelagem de Staging Relacional**:
     - `ExternalListImport`: cabeçalho do arquivo, hash, mimeType, lifecycle (`uploaded`, `extracting`, `extracted`, `under_review`, `reviewed`, `committed`, `failed`, `discarded`). O campo `rawOcrResult Json?` é opcional como backup.
     - `ExternalListImportItem`: linhas relacionais individuais com:
       - `rawTotalText String?`: preserva a string textual exata extraída pela IA (ex: `"€ 1.250,50"`, `"1250.50"`).
       - `reviewedTotal Decimal(12, 2)?`: valor após parser com tratamento de localidade e conferência humana.
       - `fieldConfidence Json?`, `rawLicensePlate`, `rawVin`, `rawServices Json`.
  3. **Dados Obrigatórios após Revisão Humana (Sem Defaults Silenciosos)**:
     - Antes de efetivar (`commit`), cada linha deve possuir: `workspaceId`, `clientId`, `operationalSiteKey`, `currencyCode` (exatamente 3 letras maiúsculas `^[A-Z]{3}$`), identificador veicular (VIN ou Placa), serviços estruturados válidos, `totalAmount > 0`, `technicianUserId` e data de execução.
     - Se qualquer dado obrigatório estiver ausente, o item permanece em `staged`/`under_review` e o commit é rejeitado com HTTP 422 estruturado.
- **Justificativa**: Fidelidade contábil e auditoria fiscal completa desde a imagem original até o faturamento.

---

### DEC-006: Ingestão de WEEKLOG Externo com Discriminador XOR, Unicidade Estrutural e Frozen Coverage
- **Problema**: Folhas de oficinas parceiras precisam ser importadas sem criar OPs fictícias, sem duplicar entries em retries de commit e com prova cabal de validação auditável.
- **Decisão**:
  1. **XOR Estrutural em `WeeklogEntry`**:
     - `sourceType VARCHAR(32) NOT NULL DEFAULT 'production_order'`
     - `productionOrderId UUID NULL`
     - `externalImportItemId UUID NULL REFERENCES external_operational_import_items(id) ON DELETE RESTRICT`
     - Constraint CHECK XOR: exatamente um dos dois deve estar preenchido.
  2. **Unicidade Estrutural contra Duplicidade em Retries**:
     ```sql
     CREATE UNIQUE INDEX unique_external_import_item_entry
     ON weeklog_entries (external_import_item_id)
     WHERE external_import_item_id IS NOT NULL;
     ```
     O commit de importação operacional externa é rigorosamente idempotente.
  3. **Frozen Coverage Snapshot da Validação**:
     O registro em `WeeklogValidation` com `validationMethod = "external_import_review"` congela a lista exata de entradas aprovadas:
     ```json
     {
       "schemaVersion": "1.0",
       "sourceType": "external_import",
       "sourceImportId": "uuid-do-import",
       "sha256": "hash-do-pdf",
       "entries": [
         {
           "entryId": "uuid-entry-1",
           "externalImportItemId": "uuid-item-1",
           "executionSequence": 1,
           "sourceType": "external_import"
         }
       ]
     }
     ```
     Nenhuma entrada criada posteriormente é considerada coberta por essa validação.
  4. **Compatibilidade de `ValidationMethod`**:
     A adição de `"external_import_review"` expande retrocompativelmente a tipagem sem alterar as regras da Spec 003 para ordens de produção (`production_order`).
- **Justificativa**: Evita fraudes de domínio (OPs falsas) e garante rastreabilidade jurídica absoluta.

---

### DEC-007: Confronto Comercial Versionado via `PaymentListConfrontationRun` e Integridade Estrutural
- **Problema**: Reruns do confronto poderiam apagar decisões humanas ou duplicar pares de matching. Além disso, `PaymentListItem` e `WeeklogEntry` devem comprovar vínculo estrito com o tenant e com a lista.
- **Decisão**:
  1. **Modelo Agregador de Execução Versionada (`PaymentListConfrontationRun`)**:
     - Tabela `payment_list_confrontation_runs`: `id UUID PRIMARY KEY`, `workspaceId UUID`, `paymentListId UUID`, `sequence INT NOT NULL`, `status VARCHAR(16)`, `startedAt TIMESTAMP`, `completedAt TIMESTAMP`.
     - Cada execução do confronto gera uma rodada identificada por `sequence` (1, 2, 3...).
  2. **Entidade de Resultados Desacoplada (`PaymentListConfrontationResult`)**:
     - Vinculada obrigatoriamente a uma rodada via `runId UUID REFERENCES payment_list_confrontation_runs(id) ON DELETE CASCADE`.
     - Integridade Composta Estrutural:
       - `(paymentListItemId, paymentListId, workspaceId) REFERENCES payment_list_items(id, paymentListId, workspaceId)` (quando not null).
       - `(weeklogEntryId, workspaceId) REFERENCES weeklog_entries(id, workspaceId)` (quando not null).
       - Proibido pareamento cross-tenant ou cross-lista.
     - Validação de Aplicação: Antes de associar, o backend comprova:
       `WeeklogEntry.clientId == PaymentList.clientId`.
  3. **Unicidade de Par dentro da Mesma Run**:
     ```sql
     CREATE UNIQUE INDEX unique_run_item_match
     ON payment_list_confrontation_results (run_id, payment_list_item_id)
     WHERE payment_list_item_id IS NOT NULL;

     CREATE UNIQUE INDEX unique_run_entry_match
     ON payment_list_confrontation_results (run_id, weeklog_entry_id)
     WHERE weeklog_entry_id IS NOT NULL;
     ```
     Um item ou entry não pode ser pareado duas vezes na mesma execução. Casos ambíguos não são resolvidos por "primeiro encontrado", mas classificados como ambiguidade exigindo decisão humana.
  4. **Idempotência e Bloqueio de Rerun com Decisões**:
     - Invocar `POST /payment-lists/:id/confront` repetidamente sem alterações retorna a rodada ativa existente.
     - Se a rodada ativa contiver **decisões humanas registradas** (`decision != 'none'`), um novo rerun é **estritamente bloqueado** (HTTP 409 `CONFRONTATION_RERUN_HAS_DECISIONS`), preservando as decisões humanas e o histórico imutável.
- **Justificativa**: Assegura idempotência, previne perda acidental de trabalho de auditoria e garante integridade referencial máxima no banco.

---

### DEC-008: Modelo de Decisão Humana Formal e Semântica de Disputas Abertas
- **Problema**: Tratar `CONTEST` e `REQUEST_RECTIFICATION` como desfechos resolvidos permitia que listas com litígios fossem validadas para faturamento.
- **Decisão**:
  1. Ações humanas possíveis:
     - `ACCEPT_DIFFERENCE`: Aceite da divergência com justificativa formal. **Terminal**. Compõe `recognizedTotal`.
     - `REJECT_ITEM`: Glosa do item. **Terminal**. Item permanece registrado para auditoria fiscal, mas excluído de `recognizedTotal`, e sua claim é liberada (`released`).
     - `CONTEST`: Contestação com cliente. **Não-Terminal (Aberto)**.
     - `REQUEST_RECTIFICATION`: Retrabalho na oficina. **Não-Terminal (Aberto)**.
  2. **Bloqueio Inviolável de Pending**:
     - A transição para `pending` retorna HTTP 409 `UNRESOLVED_DISPUTES_BLOCK_PENDING` se houver qualquer item em `CONTEST` ou `REQUEST_RECTIFICATION`.
- **Justificativa**: Garante integridade jurídica e financeira do faturamento.

---

### DEC-009: Linhagem da Retificação na Lista sem Entidade Sintética
- **Problema**: Invenção de entidade inexistente `rectificationId`.
- **Decisão**:
  A ação `REQUEST_RECTIFICATION` invoca `rectifyWeeklogEntry` da Spec 003. Em `PaymentListConfrontationResult`, gravam-se os dados reais da esteira móvel: `reopenedProductionOrderId`, `targetExecutionSequence`, `decidedBy` e `decidedAt`.
- **Justificativa**: Fidelidade ao modelo de domínio canônico estabelecido na Spec 003.

---

### DEC-010: Escopo de Técnico (`scope: own`) Restrito a Itens Reconhecidos
- **Problema**: Exposição indevida de faturamento global e simulação de fórmulas prematuras de repasse.
- **Decisão**:
  Técnicos vinculados recebem JSON sanitizado contendo estritamente seus itens reconhecidos. Faturamento total da empresa, margens e rateios são ocultados no backend. Zero fórmulas de repasse na Spec 004.
- **Justificativa**: Atendimento estrito à regra `scope: own` e fronteira limpa com a Spec 005.

---

### DEC-011: Autoridade Estrita de Moeda (Formato ISO-4217 de 3 Letras Maiúsculas)
- **Problema**: Defaults silenciosos como "EUR" e imprecisão na definição do formato da moeda.
- **Decisão**:
  1. `PaymentList.currencyCode` é obrigatório e sem default no schema.
  2. O código de moeda deve ser estritamente formado por **3 letras ASCII maiúsculas**, validado por regex: `^[A-Z]{3}$` (ex.: `"EUR"`, `"BRL"`, `"USD"`).
  3. Ausência de moeda retorna HTTP 422 `CURRENCY_REQUIRED`.
  4. Mistura de moedas em uma lista retorna HTTP 422 `CURRENCY_MISMATCH`.
- **Justificativa**: Elimina riscos de conversão errônea e atende à regra de Zero Defaults Silenciosos.

---

### DEC-012: Fronteira Financeira Estrita (Sem Pagamentos Parciais por Item)
- **Problema**: Existência de `totalPaid`, `amountPaid` e rotas de pagamento por item na proposta inicial.
- **Decisão**:
  1. Expurgados `totalPaid`, `amountPaid` e endpoint de pagamento por item.
  2. A Lista gerencia apenas `pending` (Esperado) e `paid` (Recebido).
  3. Zero mutações na tabela `financial_records`. Distribuições e despesas pertencem à Spec 005.
- **Justificativa**: Coesão arquitetural e fronteira límpida entre faturamento comercial e contabilidade de caixa.

---

### DEC-013: Semântica Clara de Totais da Lista (`sourceDocumentTotal` vs `recognizedTotal`)
- **Problema**: Ambiguidade sobre o significado do total da lista.
- **Decisão**:
  O cabeçalho separa formalmente `sourceDocumentTotal` (bruto declarado no documento) de `recognizedTotal` (reconhecido final após o confronto, excluindo itens com `REJECT_ITEM`). Itens rejeitados permanecem no banco para auditoria.
- **Justificativa**: Transparência fiscal e rastreabilidade contábil.

---

### DEC-014: Autoridade de Liquidação Comercial Restrita a Administradores
- **Problema**: Possibilidade de qualquer usuário liquidar faturamento comercial ou disparar efeitos indevidos.
- **Decisão**:
  1. Apenas usuários com papel `owner` ou `admin` podem executar `PATCH /api/payment-lists/:id/status` para `paid`.
  2. A transição é idempotente: chamadas repetidas em lista já paga retornam HTTP 200 sem novos side-effects.
  3. A liquidação não gera registros em `financial_records`, não cria distribuições, não deduz despesas e não calcula comissões.
- **Justificativa**: Governança financeira segura com autoridade server-side.

---

### DEC-015: Projeção Downstream One-Way para `PaymentOrder` Legado
- **Problema**: Risco de sincronização bidirecional corromper o modelo canônico.
- **Decisão**:
  1. Espelhamento estritamente unidirecional (`canonical` $\rightarrow$ `payment_orders`).
  2. Mutações diretas em tabelas legadas são rejeitadas. Rotas antigas em `paymentOrders.ts` tornam-se somente-leitura / deprecated.
- **Justificativa**: Continuidade operacional para relatórios legados sem comprometer a nova autoridade canônica.

---

### DEC-016: Estratégia de Desativação e Transição de Call Sites Legados no Frontend
- **Problema**: Desativar rotas legadas sem planejar os call sites do frontend causaria quebras silenciosas na aplicação.
- **Decisão**:
  Os call sites identificados são classificados em 4 categorias de transição:
  1. **REMOVE IN T10/T11**: Chamada destrutiva `/finance/reconciliations/run` em `apiFinance.ts:93` e `useReconciliation.ts:138`. Desativada sumariamente no backend.
  2. **REPLACE WITH CANONICAL (T11/T12)**:
     - Componentes de reconciliação (`ReconciliationScreen.tsx`, `FinancialPage.tsx`) migram para `/api/payment-lists/:id/confrontation`.
     - Mutações de ordem de pagamento (`usePaymentOrders.ts:110-153`, `PaymentOrdersPage.tsx:218`) migram para as rotas canônicas `/api/payment-lists`.
  3. **READ-ONLY LEGACY**: Consultas de leitura a `/payment-orders` em `useAgingAlerts.ts:35`, `useOperationalSignals.ts:86`, `usePaymentOrdersForBilling.ts:36` continuam sendo atendidas com segurança via leitura projetada até a Spec 005.
  4. **SPEC005 FUTURE**: Rotas bancárias em `BillingPage.tsx:371` e `ImportInvoiceDialog.tsx:629` serão tratadas na vertical de conciliação bancária da Spec 005.
- **Justificativa**: Transição previsível, sem telas quebradas e sem manutenção de código inseguro.
