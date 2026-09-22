# Findings de Discovery e Auditoria Técnica — Spec 004 (Pós-Remediação de Revisão Humana)

**Fatia**: R2 — Lista de Pagamento, Importação Externa, Confronto Operacional e Fronteira Financeira  
**Branch**: `feat/004-payment-list-confrontation`  
**Base**: `develop/operix-core` (com Specs 001, 002 e 003 concluídas)  
**Data**: 2026-09-18 (Remediação de Revisão Humana)  

> **T12 implementation disposition (2026-09-22):** this document preserves the pre-remediation audit evidence. The Spec004 findings about PaymentOrder authority, destructive reconciliation, direct Supabase writes, missing PaymentList aggregation, non-governed import, technician redaction, claims and confrontation versioning are remediated by the canonical implementation and covered by the completed integration/frontend suites. Legacy finance and unrelated Supabase consumers remain outside this historical finding set and are not Spec004 authority.

---

## 1. Classificação dos Findings

Cada achado técnico é classificado conforme a metodologia de evidência:
- **CONFIRMED**: Verificado diretamente no código-fonte ativo (`backend/`, `src/`) ou no schema do banco de dados (`schema.prisma`).
- **INFERRED**: Derivado logicamente da análise cruzada de fluxos de negócio, regras do domínio e transcrições de reuniões com stakeholders.
- **RUNTIME REQUIRED**: Comportamento que depende de execução com massa de dados para observação empírica de locks, concorrência e latência.

---

## 2. Inventário de Findings

### FINDING-001: Ausência de RequestContext e Vulnerabilidade BOLA/IDOR Crítica em `paymentOrders.ts`
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/paymentOrders.ts`
- **Linhas**: 3-4, 63-79, 81-104, 106-117, 119-127, 129-149
- **Comportamento Observado**:
  As rotas de `/payment-orders` utilizam exclusivamente o middleware básico `requireAuth`, sem aplicar `resolveRequestContext`. O tenant é recebido como parâmetro opcional de query (`req.query.workspace_id`) ou de body (`req.body.workspace_id`).
  1. No endpoint `GET /`: se `workspace_id` for omitido pelo cliente, o backend executa `prisma.paymentOrder.findMany` **sem filtro de workspace**, retornando ordens de pagamento de todas as empresas cadastradas na plataforma. Se fornecido, qualquer usuário autenticado pode forjar o ID de outro workspace (BOLA/IDOR — *CWE-639 / OWASP API1*).
  2. No endpoint `POST /`: o `workspaceId` é gravado diretamente do payload do corpo (`b.workspace_id`), permitindo inserção cruzada de itens em workspaces de terceiros.
  3. No endpoint `PATCH /:id`: o comando `prisma.paymentOrder.update({ where: { id }, data })` não realiza qualquer validação de posse ou isolamento de tenant. Qualquer usuário autenticado pode modificar campos, valores e status de qualquer ordem do banco.
  4. No endpoint `DELETE /:id`: soft delete cego sem checagem de tenant.
  5. No endpoint `DELETE /`: exclusão em massa por ano (`where: { createdAt: { gte, lt }, ...(workspace_id ? { workspaceId } : {}) }`). Se `workspace_id` for omitido, **soft-deleta ordens de pagamento de todas as empresas do sistema daquele ano**.
  6. Não há restrição de escopo de técnico (`scope: own`), permitindo que técnicos vejam faturamento e itens de outros técnicos.
- **Risco**: Crítico de Segurança e Integridade (*P0*). Vazamento massivo de faturamento e destruição cross-tenant de dados.
- **Reuso / Ação**: Substituir as rotas legadas por endpoints canônicos governados por `RequestContext`, aplicando `assertTenantAccess(ctx, resource.workspaceId)` e `assertObjectAccess(ctx, resource)` com deny-by-default. Rotas antigas de `paymentOrders.ts` tornam-se read-only / deprecated.

---

### FINDING-002: Reconciliação Global Destrutiva e Ausência Estrutural de Tenant no Modelo `Reconciliation`
- **Classificação**: CONFIRMED
- **Arquivos**: `backend/src/routes/finance.ts` (L161-251, 334-625) e `backend/prisma/schema.prisma` (L932-949)
- **Comportamento Observado**:
  1. No schema relacional (`schema.prisma`), o modelo `Reconciliation` **não possui coluna `workspaceId`**, nem índices de tenant, nem foreign keys formais com integridade referencial:
     ```prisma
     model Reconciliation {
       id               String   @id @default(uuid())
       serviceOrderId   String?  @map("service_order_id")
       paymentOrderId   String?  @map("payment_order_id")
       matchedBy        String   @default("auto") @map("matched_by")
       ...
     }
     ```
  2. No endpoint `POST /finance/reconciliations/run`:
     - Executa HARD RESET destrutivo global: `await prisma.reconciliation.deleteMany({ where: { matchedBy: "auto" } });` — **apaga todas as reconciliações automáticas de todas as empresas do banco simultaneamente**.
     - Apaga globalmente registros em `financial_records` (`deleteMany({ where: { id: { in: orphanIds } } })`).
     - Carrega em memória **todas** as `service_orders` e **todas** as `payment_orders` existentes no PostgreSQL (`prisma.serviceOrder.findMany()`, `prisma.paymentOrder.findMany()`), cruzando dados entre clientes e empresas distintas.
  3. No endpoint `GET /finance/reconciliations`: retorna o histórico de reconciliações de todos os tenants indiscriminadamente.
- **Risco**: Crítico de Segurança, Concorrência e Corrupção de Dados (*P0*). Destruição de dados entre tenants concorrentes.
- **Reuso / Ação**: Proibir terminantemente o uso do motor `/finance/reconciliations/run`. O confronto comercial canônico pertence ao domínio da Lista de Pagamento (`PaymentList`), operando via `PaymentListConfrontationResult`, restrito estritamente a `(workspaceId, clientId)` e desvinculado de mutações contábeis.

---

### FINDING-003: Inexistência de Entidade Canônica de Agregação de Lista (`PaymentList`) e Desacoplamento Estrutural
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/prisma/schema.prisma` (L534-569, 1165-1177)
- **Comportamento Observado**:
  1. No banco de dados não existe a tabela `payment_lists`.
  2. A entidade `PaymentOrder` representa um **item veicular individual** (possui `carName`, `licensePlate`, `services Json`, `total Float`), e possui uma coluna textual solta `listName String?`.
  3. A entidade `ProductionList` (`production_lists`) possui `listName String @unique` e `status String @default("em_elaboracao")`, mas não possui relacionamento formal com `payment_orders`.
  4. Múltiplas `PaymentOrder` compartilham a mesma string `listName` (ex: `"L010132"`).
  5. Não há cabeçalho formal com integridade referencial, moeda obrigatória, snapshot financeiro imutável ou cliente contratante mandatório.
- **Risco**: Alto. Integridade referencial frágil, orfandade de itens, impossibilidade de lock atômico no lote e inconsistências de status entre itens e listas.
- **Reuso / Ação**: Criar o modelo canônico `PaymentList` (cabeçalho agregado do lote comercial com `@@unique([id, workspaceId])`) e `PaymentListItem` (itens reconhecidos/faturados com composite FK de tenant).

---

### FINDING-004: Incompatibilidade do Gerador Legado `L0xxxxx` com Listas Multissemanas e Risco de Colisão com Números Históricos
- **Classificação**: CONFIRMED
- **Arquivo**: Histórico git (`backend/src/routes/serviceOrders.ts`, commit `cd5c141` / `a6a5007`) e `backend/src/routes/productionWorkflow.ts`
- **Comportamento Observado**:
  1. A rotina legada gerava o código da lista concatenando `L + idTec(2d) + seq(2d) + week(2d)` (ex.: `L010132`).
  2. Isso é conceitualmente incompatível com a realidade do negócio validada por Alex Souza: a Lista é multissemanas (agrega semanas distintas) e multitécnico.
  3. Além disso, o banco de dados brownfield já possui códigos atribuídos no formato `L0xxxxx` nas tabelas `payment_orders` e `production_lists`. Se um novo gerador reiniciar cegamente em `L000001`, colidirá com dados históricos ou gerará inconsistências graves.
- **Risco**: Alto de Domínio e Concorrência. Colisão com histórico e quebra de multissemanas.
- **Reuso / Ação**: Implementar gerador atômico monotônico por tenant via `TenantSequenceCounter` com lock pessimista no PostgreSQL. O seed inicial por workspace deve ser descoberto inspecionando o maior código compatível `L0xxxxx` já utilizado no banco para aquele tenant (`seed = MAX(legacyNumber)`), avançando para `seed + 1`.

---

### FINDING-005: Extração OCR Efêmera, Ausência de Staging Relacional Editável e Inexistência de Proveniência
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/extract.ts` (L105-380)
- **Comportamento Observado**:
  1. Os endpoints `/api/extract/service-order` e `/api/extract/payment-order` recebem `imageBase64` no payload HTTP JSON e devolvem JSON volátil para a tela.
  2. Zero persistência no MinIO dentro do pipeline de extração, sem hash SHA-256 e sem vínculo com tenant.
  3. Não existe persistência de staging no banco: se o usuário recarregar a página, a extração é perdida e novos créditos de IA devem ser pagos.
  4. Além disso, armazenar o staging apenas como um JSON bruto (`rawOcrResult Json`) impediria edição relacional linha a linha, validações de tipagem e rastreamento de revisões campo a campo.
- **Risco**: Médio-Alto. Custo desnecessário de IA, impossibilidade de auditoria fiscal e falta de staging relacional robusto.
- **Reuso / Ação**: Desenhar pipeline canônico de duas tabelas: `ExternalListImport` (metadados do arquivo, MinIO path, hash SHA-256, status do lifecycle) e `ExternalListImportItem` (linhas relacionais editáveis com raw value, reviewed value, field confidence e validação de decimais). `rawOcrResult` torna-se backup opcional (`Json?`), sobrevivendo inclusive a falhas de OCR.

---

### FINDING-006: Mutações Diretas do Frontend via Supabase Client em `PaymentOrdersTable.tsx`
- **Classificação**: CONFIRMED
- **Arquivo**: `src/components/payment-orders/PaymentOrdersTable.tsx` (L3, 204-256, 368)
- **Comportamento Observado**:
  O frontend importa `@/integrations/supabase/client` e executa mutações diretas no banco de dados via Supabase (`paymentMutation` e `batchStatusMutation`), contornando a API Express, sem auditoria, sem `RequestContext` e sem verificação de autoridade server-side.
- **Risco**: Crítico de Governança (*Violação da Constituição Operix / AGENTS.md*).
- **Reuso / Ação**: Erradicar integralmente as chamadas a `supabase` em `PaymentOrdersTable.tsx`. Criar endpoints REST autoritativos no backend (`PATCH /api/payment-lists/:id/status`).

---

### FINDING-007: Existência de Duas Reconciliações Concorrentes e Desconexão com WEEKLOG Canônico
- **Classificação**: CONFIRMED
- **Arquivos**: `src/components/billing/ReconciliationScreen.tsx` e `backend/src/routes/finance.ts` (L627-860)
- **Comportamento Observado**:
  1. A tela `ReconciliationScreen.tsx` (módulo Billing) interage com a tabela `billing_reconciliations` do Supabase. Essa tela está quebrada.
  2. O backend `finance.ts` confronta `service_orders` com `payment_orders`.
  3. Nenhum dos motores conecta-se com `Weeklog` e `WeeklogEntry` da Spec 003.
  4. O confronto está incorretamente inserido em `FinancialPage.tsx`, quando a regra de negócio estabelece que se trata de uma atividade de conferência operacional da Lista antes do faturamento.
- **Risco**: Alto de Arquitetura. Desalinhamento entre o domínio canônico e as rotas de confronto.
- **Reuso / Ação**: Descontinuar `ReconciliationScreen` legada; realocar os componentes de confronto para o fluxo de Operações/Lista; conectar o confronto diretamente a `WeeklogEntry` (executado) e `PaymentListItem` (reconhecido), persistindo resultados em `PaymentListConfrontationResult`.

---

### FINDING-008: Efeitos Financeiros Automáticos Indevidos em Validação de Confronto Legada
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/finance.ts` (L861-872)
- **Comportamento Observado**:
  No endpoint legado `POST /finance/confrontation/validate`, quando uma divergência é validada com diferença de valor (`Math.abs(diff) > 0.01`), o código cria automaticamente uma linha em `financial_records` sem `workspaceId`, antecipando mutações contábeis que pertencem estritamente à Spec 005.
- **Risco**: Médio-Alto de Fronteira e Multi-Tenancy. Poluição do ledger contábil sem autoridade e sem tenant.
- **Reuso / Ação**: Erradicar a criação automática de `financial_records` no Confronto da Spec 004. O confronto apenas registra a decisão humana na entidade `PaymentListConfrontationResult`.

---

### FINDING-009: Inexistência de Pipeline Estruturado para WEEKLOG Externo e Risco de Fabricação de OPs Fictícias
- **Classificação**: CONFIRMED
- **Arquivos**: `backend/prisma/schema.prisma` (L682-733) e `backend/src/routes/extract.ts`
- **Comportamento Observado**:
  O contrato exige suporte a folhas físicas de WEEKLOG de oficinas parceiras. Contudo, o modelo canônico `WeeklogEntry` exige `productionOrderId String` (not null) com constraint relacional restritiva. Não existe caminho para persistir uma entrada externa sem fabricar uma `ProductionOrder` fictícia.
- **Risco**: Alto de Modelagem. Corrupção da esteira móvel com ordens de produção falsas.
- **Reuso / Ação**: Modelar `ExternalOperationalImport` e `ExternalOperationalImportItem`. Na tabela `WeeklogEntry`, flexibilizar a fonte via discriminador explícito `sourceType` ("production_order" | "external_import") com constraint CHECK XOR estrutural: exatamente um entre `productionOrderId` ou `externalImportItemId` deve ser preenchido. A validação humana do lote externo gera registro formal em `WeeklogValidation` com `validationMethod = "external_import_review"`.

---

### FINDING-010: Exposição Indevida do Faturamento Agregado ao Escopo do Técnico (`scope: own`)
- **Classificação**: CONFIRMED
- **Arquivos**: `src/pages/PaymentOrdersPage.tsx` e `backend/src/routes/paymentOrders.ts`
- **Comportamento Observado**:
  Quando um técnico vinculado acessa `/payment-orders`, os totalizadores do topo e a listagem exibem o valor cheio das ordens e listas da empresa caso o filtro seja manipulado no cliente.
- **Risco**: Alto de Compliance e Privacidade. Violação da regra `scope: own`.
- **Reuso / Ação**: Na projeção de leitura de Lista e Confronto, aplicar autorização por objeto deny-by-default: para `membershipRole === "technician"`, o backend retorna apenas os itens de autoria do técnico, ocultando totais globais e margens da empresa. Não inventar valores de repasse ou deduções contábeis antes da Spec 005.

---

### FINDING-011: Risco de Dupla Cobrança Residual sem Ciclo de Vida Semântico de Claims (`reserved`, `consumed`, `released`)
- **Classificação**: CONFIRMED
- **Arquivos**: `specs/004-payment-list-confrontation/spec.md` e `docs/adr/004-payment-list-domain-model.md`
- **Comportamento Observado**:
  A formulação anterior de claims utilizava apenas status binário `active | released`. Sob esse modelo, uma lista paga (`paid`) ou em faturamento pendente (`pending`) não se distinguia formalmente de uma lista preliminar em elaboração (`draft`), abrindo brechas para que transições indevidas liberassem cobranças já quitadas.
- **Risco**: Crítico de Integridade Financeira. Potencial de refaturamento de serviços já reconhecidos e pagos.
- **Reuso / Ação**: Formalizar a máquina de estados tripartite de claims: `reserved` (reserva temporária em elaboração/confronto), `consumed` (reconhecimento terminal em lista `pending`/`paid` que jamais pode ser cobrado novamente) e `released` (liberação após cancelamento ou rejeição formal). Partial unique index: `WHERE status IN ('reserved', 'consumed')`.

---

### FINDING-012: Inexistência de Versionamento de Execução no Confronto e Risco de Perda de Decisões em Reruns
- **Classificação**: CONFIRMED
- **Arquivos**: `backend/src/routes/finance.ts` e `backend/src/services/confrontationService.ts`
- **Comportamento Observado**:
  Se o endpoint de confronto for disparado novamente para uma lista que já possui decisões humanas registradas (aceites, contestações ou retificações), uma execução ingênua apagaria ou sobrescreveria tais decisões, ou geraria resultados duplicados em tabelas sem controle de versão.
- **Risco**: Alto de Auditoria e Perda de Trabalho Humano.
- **Reuso / Ação**: Introduzir o modelo agregador versionado `PaymentListConfrontationRun` com sequência monotônica (`sequence INT`). Cada resultado vincula-se a uma `runId`. Se houver decisões na rodada ativa, novos confrontos são bloqueados deny-by-default (HTTP 409 `CONFRONTATION_RERUN_HAS_DECISIONS`), preservando o histórico imutável.

---

### FINDING-013: Inventário de Call Sites Legados no Frontend (`/finance/reconciliations/*` e `/payment-orders`)
- **Classificação**: CONFIRMED
- **Arquivos**: `src/lib/apiFinance.ts`, `src/hooks/useReconciliation.ts`, `src/pages/FinancialPage.tsx`, `src/components/billing/ReconciliationScreen.tsx`, `src/hooks/usePaymentOrders.ts`, `src/pages/PaymentOrdersPage.tsx`
- **Comportamento Observado**:
  1. `/finance/reconciliations/run`: Chamado exclusivamente em `apiFinance.ts:93` e `useReconciliation.ts:138`. Esse endpoint executa `deleteMany` global e deve ser sumariamente desativado sem impacto no fluxo canônico da Lista.
  2. `/finance/reconciliations` (GET/PATCH): Consumido por `ReconciliationScreen.tsx` e `FinancialPage.tsx`. Deve ser substituído pelas rotas canônicas de `/api/payment-lists/:id/confrontation`.
  3. Mutações em `/payment-orders` (POST/PATCH/DELETE): Chamadas em `usePaymentOrders.ts:110-153` e `PaymentOrdersPage.tsx:218`. Devem ser redirecionadas para a API canônica de Lista em T11.
  4. Leituras em `/payment-orders` (GET): Consumidas por `useAgingAlerts.ts:35`, `useOperationalSignals.ts:86`, `usePaymentOrdersForBilling.ts:36`. Continuam funcionando como leitura alimentadas pelo `DownstreamPaymentOrderAdapter` até a Spec 005.
- **Risco**: Médio de Quebra de Interface sem Planejamento.
- **Reuso / Ação**: Classificar os pontos em `REMOVE IN T10/T11`, `REPLACE WITH CANONICAL` e `READ-ONLY LEGACY`, garantindo transição sem telas quebradas.

---

### FINDING-014: Uso de Float em `rawTotal` de OCR no Staging e Perda de Precisão Documental
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/extract.ts` (L230-310) e proposta target
- **Comportamento Observado**:
  Modelar a extração inicial com `rawTotal Float` impõe arredondamentos de ponto flutuante IEEE-754 antes da conferência humana e não preserva a formatação original do documento (`"€ 1.250,50"` vs `"1250.50"` vs `"R$ 1.250,50"`).
- **Risco**: Médio de Auditoria Fiscal e Erro de Conversão.
- **Reuso / Ação**: Substituir `rawTotal Float?` por `rawTotalText String?` em `ExternalListImportItem` e `ExternalOperationalImportItem`. Apenas o valor revisado humano `reviewedTotal` utiliza `Decimal(12, 2)` após parser com tratamento de localidade.

---

### FINDING-015: Compatibilidade do Método de Validação (`ValidationMethod`) entre Spec 003 e Spec 004
- **Classificação**: CONFIRMED
- **Arquivos**: `backend/src/services/weeklogService.ts` (L1192, 1213-1214) e `src/lib/apiWeeklogs.ts` (L81)
- **Comportamento Observado**:
  O validador da Spec 003 aceita estritamente `"authenticated_confirmation" | "drawn_signature"`. Ao adicionar `"external_import_review"` para folhas físicas de WEEKLOG, os consumidores existentes não devem sofrer quebras de contrato de tipagem nem bypass de regras para ordens de produção normais.
- **Risco**: Baixo-Médio de Regressão.
- **Reuso / Ação**: Expandir a união de tipos preservando compatibilidade retroativa. A esteira móvel padrão (`sourceType = 'production_order'`) continua exigindo os métodos da Spec 003, enquanto `external_import_review` é exclusivo para materialização de `sourceType = 'external_import'`.
