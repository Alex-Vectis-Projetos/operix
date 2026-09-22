# Cenários de Aceite Comportamentais — Spec 004 (Hardening Final Pré-Test-First)

**Fatia**: R2 — Lista de Pagamento, Importação Externa, Confronto Operacional e Fronteira Financeira  
**Branch**: `feat/004-payment-list-confrontation`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-18 (Hardening Final Pré-Test-First)  

**T12 verification (2026-09-22)**: the 47 formal acceptance criteria execute through the current integration suites, with 47/47 green, zero skipped and zero todo. Additional hardening and frontend suites are recorded in `handoff.md`.

---

## 1. Convenções e Metodologia

Os cenários de aceite são formalizados no formato comportamental estruturado (*Given-When-Then*). Cada cenário possui um identificador unívoco rastreável e define os invariantes que devem ser comprovados por testes de integração automatizados antes que a fatia seja considerada pronta (*Definition of Done*).

---

## 2. Cenários de Aceite

### Grupo 1: Domínio da Lista de Pagamento & Invariantes de Tenancy

#### `LIST-MULTIWEEK-01`: Agregação Multissemanas Autoritativa em Única Lista
- **Given**:
  - Três lotes `Weeklog` validados distintos para o mesmo `workspaceId` e `clientId`:
    - Lote A da semana W29 contendo `WeeklogEntry` A1 (€ 500,00).
    - Lote B da semana W30 contendo `WeeklogEntry` B1 (€ 350,00).
    - Lote C da semana W32 contendo `WeeklogEntry` C1 (€ 600,00).
- **When**:
  - O gestor cria uma `PaymentList` comercial consolidando as entradas A1, B1 e C1.
- **Then**:
  - A API retorna HTTP 201 com a `PaymentList` criada.
  - O cabeçalho registra `itemCount = 3` e `sourceDocumentTotal = 1450.00`.
  - Os itens mantêm seus vínculos relacionais individuais com suas respectivas `WeeklogEntry` de semanas distintas.
  - Nenhum dado dos cabeçalhos semanais originais de Weeklog é alterado.

#### `LIST-TENANT-01`: Isolamento Estrito de Tenant em Listas Comerciais
- **Given**:
  - Usuário autenticado pertencente exclusivamente ao Workspace A.
  - Uma `PaymentList` existente pertencente ao Workspace B com ID `list-b-uuid`.
- **When**:
  - O usuário tenta consultar `GET /api/payment-lists/list-b-uuid`.
  - O usuário tenta alterar o status via `PATCH /api/payment-lists/list-b-uuid/status`.
  - O usuário tenta incluir itens de uma `WeeklogEntry` do Workspace B em uma lista do Workspace A.
- **Then**:
  - Todas as requisições de leitura e mutação retornam HTTP 404 (ou 403 Forbidden) deny-by-default.
  - Nenhuma informação do Workspace B vaza para o Workspace A.
  - A tentativa de cruzar chaves de tenants distintos falha com erro de integridade referencial.

#### `LIST-TECH-OWN-01`: Restrição de Escopo de Técnico (`scope: own`) e Ocultação de Faturamento Global
- **Given**:
  - Usuário autenticado com papel `membershipRole = "technician"` vinculado ao Workspace A.
  - Uma `PaymentList` do Workspace A contendo:
    - 2 itens executados pelo técnico autenticado (valor total dos serviços reconhecidos: € 800,00).
    - 5 itens executados por outros técnicos (valor total: € 3.200,00).
    - Faturamento total da empresa na lista: € 4.000,00.
- **When**:
  - O técnico consulta a lista via `GET /api/payment-lists/:id`.
- **Then**:
  - A resposta da API é sanitizada no servidor:
    - Apenas os 2 itens atribuídos ao técnico são retornados na lista de itens.
    - O técnico visualiza o valor de seus próprios itens (€ 800,00).
    - Métricas de faturamento global da empresa (`sourceDocumentTotal`, `recognizedTotal`), margem de lucro e itens de outros técnicos não estão presentes no payload JSON.
    - Não há cálculo de repasse ou comissão antecipada (delegação para a Spec 005).

#### `LIST-CLAIM-RESERVED-01`: Associação Inicial com Claim em Status Reserved
- **Given**:
  - Uma `WeeklogEntry` validada W1 disponível para faturamento no Workspace A.
- **When**:
  - O gestor cria uma `PaymentList` L1 em status `draft` vinculando a entrada W1.
- **Then**:
  - É criada uma linha em `payment_list_entry_claims` com `workspaceId`, `paymentListId = L1.id`, `weeklogEntryId = W1.id` e `status = 'reserved'`.
  - A entrada W1 passa a ser considerada reservada para a lista L1.

#### `LIST-CLAIM-CONSUMED-01`: Transição de Claim para Consumed no Avanço para Pending
- **Given**:
  - Uma `PaymentList` L1 contendo a entrada W1 com claim em status `reserved`.
  - A lista L1 conclui o confronto em status `confronted` com o item W1 reconhecido.
- **When**:
  - O gestor valida a lista para faturamento comercial (`PATCH /api/payment-lists/l1/status` com `toStatus: 'pending'`).
- **Then**:
  - A lista L1 transiciona para `status = 'pending'`.
  - A claim correspondente a W1 em `payment_list_entry_claims` é atualizada para `status = 'consumed'` com `consumedAt = now()`.
  - Uma vez consumida, a claim jamais pode retornar para `released` ou ser incluída em outra lista.

#### `LIST-CLAIM-REJECT-RELEASE-01`: Liberação de Claim para Released no Desfecho REJECT_ITEM
- **Given**:
  - Uma `PaymentList` L1 em conferência contendo um item associado à entrada W1 com claim `reserved`.
- **When**:
  - No confronto, o gestor registra a decisão terminal `decision = 'reject_item'` (glosa comercial confirmada de que o serviço não é faturado nesta lista).
- **Then**:
  - A claim associada a W1 transiciona para `status = 'released'` com `releasedAt = now()` e `releasedReason = 'rejected_in_confrontation'`.
  - O item não compõe o `recognizedTotal` da lista L1.
  - A entrada W1 torna-se novamente elegível para reserva em uma lista futura corrigida.

#### `LIST-CANCEL-RELIST-01`: Liberação de Execução após Cancelamento de Lista
- **Given**:
  - Uma `PaymentList` L1 contendo a `WeeklogEntry` W1 com claim `reserved`.
- **When**:
  - O gestor cancela a lista L1 (`PATCH /api/payment-lists/l1/status` com `toStatus: 'cancelled'`).
- **Then**:
  - O status de L1 passa para `cancelled`.
  - Todas as claims da lista com `status = 'reserved'` transicionam atomicamente para `status = 'released'` com `releasedAt = now()`.
  - Uma nova lista L2 é criada associando W1 com sucesso (HTTP 201), gerando nova claim `reserved`.

#### `LIST-CLAIM-PAID-NO-RELIST-01`: Proibição de Refaturamento de Execução em Lista Paga
- **Given**:
  - Uma `WeeklogEntry` W1 associada à `PaymentList` L1 que atingiu o status `paid` (com claim `status = 'consumed'`).
- **When**:
  - Um usuário tenta associar a entrada W1 a uma nova `PaymentList` L2.
- **Then**:
  - O backend rejeita a tentativa com HTTP 409 Conflict (`CODE: WEEKLOG_ENTRY_ALREADY_CLAIMED`).
  - O partial unique index `WHERE status IN ('reserved', 'consumed')` impede fisicamente a inserção no PostgreSQL.

#### `LIST-DUPLICATE-CONCURRENT-01`: Tentativa de Claim Concorrente da Mesma Entrada
- **Given**:
  - Uma `WeeklogEntry` validada W1 disponível para listagem.
- **When**:
  - Duas requisições paralelas tentam criar listas distintas (L1 e L2) reivindicando W1 ao mesmo tempo.
- **Then**:
  - Exatamente uma das requisições obtém sucesso (HTTP 201).
  - A requisição concorrente colide no partial unique index e recebe HTTP 409 Conflict.
  - O banco de dados registra exatamente uma claim com `status = 'reserved'`.

#### `LIST-NUMBER-CONCURRENT-01`: Alocação Concorrente de Numeração Sequencial Monotônica
- **Given**:
  - Um workspace cujo último código gerado foi `L000100`.
- **When**:
  - Dez requisições de criação de lista são disparadas simultaneamente em paralelo (`Promise.all`).
- **Then**:
  - Todas as 10 requisições têm sucesso (HTTP 201).
  - São alocados exatamente os 10 códigos sequenciais seguintes: `L000101` até `L000110` sem nenhuma colisão, duplicação ou gap de corrida.

#### `LIST-NUMBER-SEED-DRY-RUN-01`: CLI de Seed Discovery em Modo Padrão DRY-RUN
- **Given**:
  - Um banco brownfield com registros legados em `payment_orders` (`L000450`).
- **When**:
  - O operador executa o script `scripts/seed-legacy-counters.ts` sem a flag `--apply`.
- **Then**:
  - O script emite um relatório detalhado (`scanned`, `validFormat`, `seedByWorkspace = 450`).
  - A tabela `tenant_sequence_counters` **permanece inalterada** (zero mutações sem `--apply`).

#### `LIST-NUMBER-SEED-AMBIGUOUS-SKIP-01`: Ignorar Códigos sem Workspace Determinístico no Seed
- **Given**:
  - Linhas em `production_lists` com código `list_name = "L000999"` cujo registro não possui coluna `workspace_id` ou vínculo determinístico com nenhum workspace.
- **When**:
  - O script de seed discovery é executado.
- **Then**:
  - O código `L000999` é classificado como `ambiguous / untrusted` e **não é atribuído** a nenhum workspace.
  - O relatório registra o código como pulado, evitando contaminação arbitrária de contadores.

#### `LIST-NUMBER-LEGACY-SEED-01`: Descoberta de Maior Código Legado Compatível como Seed
- **Given**:
  - Um workspace legado contendo ordens antigas em `payment_orders` com `list_name = "L000250"` vinculadas deterministamente ao workspace.
- **When**:
  - O script de seed discovery é executado com a flag `--apply`.
- **Then**:
  - O sistema define o seed do workspace como `250` (`MAX(legacyNumber)`).
  - A primeira `PaymentList` canônica criada no workspace recebe o código `L000251`.

#### `LIST-NUMBER-NO-COLLISION-01`: Prevenção de Colisão com Histórico Legado
- **Given**:
  - Um workspace com códigos legados esparsos no banco (`L000010`, `L000050`).
- **When**:
  - Novas listas canônicas são geradas consecutivamente.
- **Then**:
  - Nenhuma lista canônica recebe código igual a qualquer código pré-existente no tenant.

#### `LIST-NUMBER-MALFORMED-LEGACY-01`: Tratamento de Códigos Legados Fora do Padrão
- **Given**:
  - Um workspace com registros históricos contendo nomes textuais arbitrários (`"LISTA-EXTRA"`, `"W32-SOUZA"`, `"L1023"`).
- **When**:
  - O algoritmo de seed discovery é executado.
- **Then**:
  - O algoritmo ignora códigos que não obedecem estritamente a `^L(\d{6})$`.
  - Se nenhum código no padrão de 6 dígitos for localizado, o seed inicial é definido como `0`, gerando `L000001`.

#### `LIST-CURRENCY-REQUIRED-01`: Rejeição de Criação de Lista sem Moeda Válida (3 Letras Maiúsculas)
- **Given**:
  - Payload de criação de `PaymentList` omitindo o campo `currencyCode`, enviando minúsculas (`"eur"`), números ou formato inválido.
- **When**:
  - O cliente dispara `POST /api/payment-lists`.
- **Then**:
  - O backend rejeita a requisição com HTTP 422 Unprocessable Entity (`CODE: CURRENCY_REQUIRED`).
  - Nenhum default silencioso é aplicado pelo servidor.

#### `LIST-CURRENCY-MISMATCH-01`: Rejeição de Mistura de Moedas em Única Lista
- **Given**:
  - Uma `PaymentList` configurada com `currencyCode = "EUR"`.
  - Uma `WeeklogEntry` ou item de importação configurado em `currencyCode = "BRL"`.
- **When**:
  - O usuário tenta associar o item à lista em EUR.
- **Then**:
  - O backend rejeita a operação com HTTP 422 Unprocessable Entity (`CODE: CURRENCY_MISMATCH`).

---

### Grupo 2: Importação Externa de Documentos & Proveniência

#### `IMPORT-LIST-REVIEW-01`: Upload com Proveniência MinIO e Staging Relacional
- **Given**:
  - Usuário gestor autenticado com arquivo PDF de lista de cliente (`fatura_pdr_32.pdf`).
- **When**:
  - O usuário faz upload em `POST /api/payment-lists/imports`.
- **Then**:
  - O arquivo é armazenado no MinIO sob `tenants/{workspaceId}/lists/imports/{id}/original_fatura_pdr_32.pdf`.
  - É calculada e persistida a hash SHA-256 do arquivo em `external_list_imports`.
  - As linhas extraídas pela IA são persistidas na tabela relacional `external_list_import_items` com status `staged`.
  - A API retorna HTTP 201 com proveniência e linhas editáveis, sem criar `PaymentList` ou `PaymentOrder`.

#### `IMPORT-MONEY-RAW-PRESERVED-01`: Preservação de Texto Monetário Bruto de OCR sem Conversão Float Prematura
- **Given**:
  - Um documento escaneado contendo uma linha com valor textual `"€ 1.250,50"`.
- **When**:
  - A extração por IA conclui o processamento do arquivo.
- **Then**:
  - A linha criada em `external_list_import_items` registra `rawTotalText = "€ 1.250,50"`.
  - O campo `reviewedTotal` permanece nulo até a confirmação do operador com parser de localidade.
  - Nenhum valor em float é usado como autoridade contábil.

#### `IMPORT-PROVENANCE-01`: Auditoria e Rastreabilidade de Arquivo Original
- **Given**:
  - Um import de lista efetivado em `PaymentList`.
- **When**:
  - O gestor inspeciona a lista criada via API.
- **Then**:
  - A lista referencia formalmente o `ExternalListImport` de origem.
  - É possível auditar quem fez o upload, data/hora, hash SHA-256 e obter a URL assinada para download do PDF original arquivado no MinIO.

#### `IMPORT-NO-AUTO-COMMIT-01`: Proibição de Commit Automático sem Validação Humana e Campos Obrigatórios
- **Given**:
  - Um documento enviado para extração OCR processado com sucesso.
  - Uma das linhas de staging possui `reviewedVin = null` e `reviewedLicensePlate = null` (identidade veicular insuficiente).
- **When**:
  - O operador tenta comitar o import via `POST /api/payment-lists`.
- **Then**:
  - A requisição falha com HTTP 422 (`MISSING_REQUIRED_STAGING_FIELDS`).
  - Nenhuma `PaymentList` ou item de produção é criado.

#### `IMPORT-CROSS-TENANT-01`: Bloqueio de Commit Cross-Tenant de Staging
- **Given**:
  - Um registro de staging existente no Workspace B.
- **When**:
  - Um usuário do Workspace A tenta comitar aquele import via `POST /api/payment-lists` com o `importId` do Workspace B.
- **Then**:
  - A requisição falha com HTTP 404 Not Found (ou 403 Forbidden).
  - O staging do Workspace B permanece intacto.

---

### Grupo 3: Importação Externa de WEEKLOG

#### `IMPORT-WEEKLOG-REVIEW-01`: Staging e Revisão de WEEKLOG Externo
- **Given**:
  - Folha física de WEEKLOG escaneada recebida de oficina parceira que não usa o app.
- **When**:
  - O gestor faz upload na esteira de importação operacional externa.
- **Then**:
  - O documento é salvo no MinIO com governança de tenant.
  - Os itens são populados em `external_operational_import_items` com status `staged` e `rawTotalText` preservado.
  - O gestor revisa e ajusta os dados na interface antes de confirmar.

#### `IMPORT-WEEKLOG-NO-FAKE-PO-01`: Materialização Canônica sem Fabricação de OPs Fictícias
- **Given**:
  - Um lote de WEEKLOG externo revisado pelo gestor.
- **When**:
  - O gestor efetiva o lote externo no sistema.
- **Then**:
  - O backend materializa `Weeklog` e `WeeklogEntry` com flag `sourceType = 'external_import'` e `externalImportItemId` preenchido (`productionOrderId = null`).
  - A constraint CHECK XOR do PostgreSQL é satisfeita.
  - Nenhuma `ProductionOrder` ou orçamento fictício é criado nas tabelas de produção móvel.

#### `IMPORT-WEEKLOG-COMMIT-IDEMPOTENT-01`: Idempotência de Retry no Commit de Importação Operacional Externa
- **Given**:
  - Um lote de WEEKLOG externo já efetivado gerando `WeeklogEntry` com `externalImportItemId = item1.id`.
- **When**:
  - Uma requisição idêntica de efetivação é enviada novamente por falha de rede.
- **Then**:
  - A requisição retorna o lote já existente sem criar entradas duplicadas.
  - A constraint `UNIQUE(external_import_item_id)` garante integridade estrutural.

#### `IMPORT-WEEKLOG-CONCURRENT-COMMIT-01`: Prevenção de Materialização Concorrente Duplicada
- **Given**:
  - Duas requisições paralelas tentando comitar o mesmo lote de `ExternalOperationalImport`.
- **When**:
  - As requisições executam concorrentemente.
- **Then**:
  - Exatamente uma das transações tem sucesso; a concorrente falha ou é resolvida idempotentemente.
  - O banco registra exatamente uma `WeeklogEntry` para cada item de importação externa.

#### `IMPORT-WEEKLOG-COVERAGE-01`: Validação Formal com Snapshot Congelado de Cobertura
- **Given**:
  - Efetivação de WEEKLOG externo pelo gestor autenticado contendo 3 entradas.
- **When**:
  - O backend conclui a transação de materialização.
- **Then**:
  - É criada uma rodada em `WeeklogValidation` com `validationMethod = "external_import_review"`, `status = "validated"`.
  - O campo `coverageSnapshot` contém JSON estruturado com: `schemaVersion`, `sourceType = 'external_import'`, `sourceImportId`, array `entries` com os IDs exatos das 3 entradas e `sha256`.
  - O campo `productionOrderId` permanece ausente/null nas entradas cobertas.

#### `IMPORT-WEEKLOG-LATE-ENTRY-01`: Inelegibilidade de Entradas Tardias para Cobertura em Validação Prévia
- **Given**:
  - Uma rodada de validação de WEEKLOG externo já consolidada com snapshot congelado.
- **When**:
  - Uma nova entrada é inserida manualmente no mesmo lote semanal a posteriori.
- **Then**:
  - A nova entrada possui `validationStatus = "pending"` e não é considerada aprovada.
  - O snapshot congelado da validação anterior comprova que a entrada tardia não fez parte do lote aprovado.

#### `IMPORT-WEEKLOG-NO-DIRECT-APPROVE-01`: Rejeição de Criação Direta sem Evidência Formal
- **Given**:
  - Tentativa de inserir diretamente uma `WeeklogEntry` com `validationStatus = "approved"` via API sem passar pelo pipeline de validação ou de importação externa auditada.
- **When**:
  - O endpoint de criação é invocado.
- **Then**:
  - A inserção é rejeitada com erro de validação (HTTP 422).

---

### Grupo 4: Motor de Confronto Comercial Versionado & Resultados Desacoplados

#### `CONFRONT-NOT-EVALUATED-01`: Estado Inicial Padrão de Confronto
- **Given**:
  - Uma `PaymentList` recém-efetivada com itens declarados pelo cliente.
- **When**:
  - O motor de confronto ainda não foi executado para a lista.
- **Then**:
  - Qualquer consulta aos resultados de confronto retorna `status = "not_evaluated"`.
  - Nenhum item nasce prematuramente como `exact_match`.

#### `CONFRONT-IDEMPOTENT-01`: Idempotência de Execução de Confronto sem Alterações
- **Given**:
  - Uma `PaymentList` que já executou o confronto gerando a rodada 1 (`sequence = 1`).
- **When**:
  - O gestor dispara novamente `POST /api/payment-lists/:id/confront` sem corpo ou com `{ "mode": "current" }`, sem que nenhuma produção ou item tenha sido alterado.
- **Then**:
  - A API retorna os resultados existentes da rodada 1 com HTTP 200.
  - A resposta informa `idempotent = true` e `mode = "current"`.
  - Nenhuma rodada espúria é criada no banco.

#### `CONFRONT-RERUN-HISTORY-01`: Criação de Nova Rodada Versionada Preservando Histórico
- **Given**:
  - Uma `PaymentList` com rodada 1 concluída onde não há nenhuma decisão humana registrada.
  - Novos WEEKLOGs foram validados na oficina para o mesmo cliente.
- **When**:
  - O gestor autorizado solicita `POST /api/payment-lists/:id/confront` com `{ "mode": "new_round" }`.
- **Then**:
  - É criada a rodada 2 (`sequence = 2`) em `payment_list_confrontation_runs`.
  - A rodada 1 passa para `status = 'superseded'`.
  - Os resultados da rodada 1 permanecem gravados no banco para auditoria histórica imutável.
  - Decisões da rodada 1 não são copiadas para a rodada 2.

#### `CONFRONT-RERUN-DECISION-IMMUTABLE-01`: Bloqueio de Rerun quando Rodada Ativa Possui Decisões Humanas
- **Given**:
  - Uma `PaymentList` cuja rodada ativa possui pelo menos uma divergência com decisão humana registrada (`decision = 'accept_difference'`).
- **When**:
  - Após uma alteração relevante nos insumos, o usuário tenta a recomputação normal via `POST /api/payment-lists/:id/confront` com `mode` ausente ou `"current"`.
- **Then**:
  - O backend bloqueia a operação com HTTP 409 Conflict (`CODE: CONFRONTATION_RERUN_HAS_DECISIONS`).
  - As decisões humanas e os resultados da rodada ativa são integralmente preservados.
  - Uma chamada posterior e autorizada com `{ "mode": "new_round" }` cria a sequência seguinte sem modificar a rodada decidida.

#### `CONFRONT-VEHICLE-01`: Pareamento por Identificador Veicular com Pareamento Único
- **Given**:
  - Entrada de WEEKLOG validada com placa `AA123BB` e VIN `VF3XXXXX`.
  - Item de Lista importado com placa formatada `AA-123-BB` e VIN `VF3XXXXX`.
- **When**:
  - O motor de confronto é executado.
- **Then**:
  - O pareamento identifica match veicular exato e gera `PaymentListConfrontationResult` associando `paymentListItemId` e `weeklogEntryId`.
  - Nenhum dos dois registros pode ser associado a outro par dentro da mesma rodada (`runId`).

#### `CONFRONT-SERVICE-01`: Detecção de Divergência de Serviços e Glosas
- **Given**:
  - Entrada de WEEKLOG com 3 serviços executados (Martelinho € 400, Pintura € 250, Montagem € 150; Total: € 800).
  - Item de Lista do cliente reconhecendo apenas Martelinho (€ 400).
- **When**:
  - O confronto é executado.
- **Then**:
  - O resultado é persistido com `status = "service_discrepancy"`.
  - `differenceAmount` registra `400.00` EUR a favor da oficina.

#### `CONFRONT-VALUE-01`: Detecção de Diferença Monetária com Mesmos Serviços
- **Given**:
  - Entrada de WEEKLOG com serviço de martelinho executado no valor de € 500,00.
  - Item de Lista do cliente reconhecendo martelinho no valor de € 420,00.
- **When**:
  - O confronto é executado.
- **Then**:
  - O resultado é classificado como `status = "value_difference"`.
  - `differenceAmount` é calculado exatamente como `-80.00` EUR.

#### `CONFRONT-AMBIGUOUS-01`: Veículo Declarado na Lista Ausente na Produção
- **Given**:
  - Item de Lista importado com placa `ZZ999ZZ`.
  - Nenhum WEEKLOG validado do cliente no workspace contém esse veículo.
- **When**:
  - O confronto é executado.
- **Then**:
  - É criada linha em `PaymentListConfrontationResult` com `paymentListItemId` preenchido, `weeklogEntryId = null` e `status = "vehicle_not_found"`.

#### `CONFRONT-UNMATCHED-WEEKLOG-01`: Execução de WEEKLOG Ausente na Lista do Cliente
- **Given**:
  - Entrada de WEEKLOG validada executada pela oficina para o cliente.
  - O documento ou lista enviado pelo cliente não menciona esse veículo.
- **When**:
  - O confronto é executado.
- **Then**:
  - É criada linha em `PaymentListConfrontationResult` com `paymentListItemId = null`, `weeklogEntryId` preenchido e `status = "unmatched_weeklog"`.
  - Nenhum `PaymentListItem` fictício é fabricado para representar a ausência.

#### `CONFRONT-HUMAN-DECISION-01`: Registro Formal de Decisão Humana para Divergência
- **Given**:
  - Um resultado de confronto com `status = "value_difference"` (diferença de -€ 80,00).
- **When**:
  - O gestor registra `decision = "accept_difference"` com nota `"Desconto comercial de frota aprovado"`.
- **Then**:
  - O registro é atualizado com data e ID do gestor autenticado (`decidedBy`, `decidedAt`).
  - O valor reconhecido é computado no `recognizedTotal` da lista.

---

### Grupo 5: Ciclo de Vida, Disputas, Retificação & Liquidação

#### `LIST-PENDING-01`: Transição para Pending Exigindo Status Confronted e Zero Disputas
- **Given**:
  - Uma `PaymentList` em status `confronted` com todos os itens avaliados e com desfechos terminais (`exact_match`, `accept_difference` ou `reject_item`).
- **When**:
  - O gestor aciona a validação comercial (`PATCH /api/payment-lists/:id/status` com `toStatus: 'pending'`).
- **Then**:
  - O status transiciona para `pending`.
  - Todas as claims associadas aos itens aceitos transicionam para `status = 'consumed'`.
  - A lista torna-se imutável e passa a compor a projeção de receita **Esperada** ($\sum \text{Lista em 'pending'}$).

#### `LIST-PENDING-BLOCKED-CONTEST-01`: Bloqueio de Pending por Disputa Aberta (Contestação)
- **Given**:
  - Uma `PaymentList` em status `under_review` contendo um item com decisão `CONTEST` em aberto.
- **When**:
  - O usuário tenta transicionar o status da lista diretamente para `pending`.
- **Then**:
  - A API rejeita a requisição com HTTP 409 Conflict (`CODE: UNRESOLVED_DISPUTES_BLOCK_PENDING`).
  - A lista permanece em seu status atual até a resolução comercial do item.

#### `LIST-PENDING-BLOCKED-RECTIFICATION-01`: Bloqueio de Pending por Retificação Pendente
- **Given**:
  - Uma `PaymentList` contendo um item com decisão `REQUEST_RECTIFICATION` em aberto na oficina.
- **When**:
  - O usuário tenta transicionar o status da lista para `pending`.
- **Then**:
  - A API rejeita com HTTP 409 Conflict (`CODE: UNRESOLVED_DISPUTES_BLOCK_PENDING`).

#### `LIST-PAID-IDEMPOTENT-01`: Confirmação Idempotente de Recebimento por Gestor Autorizado
- **Given**:
  - Uma `PaymentList` em status `pending` pertencente ao Workspace A.
  - Usuário autenticado com papel `owner` ou `admin`.
- **When**:
  - O gestor dispara `PATCH /api/payment-lists/:id/status` com `toStatus: 'paid'`.
  - Em seguida, dispara a mesma chamada novamente.
- **Then**:
  - Na primeira chamada, o status transiciona para `paid`, registrando `paidAt = now()` e `paidBy = ctx.actorUserId`.
  - Na segunda chamada, o backend retorna HTTP 200 com a lista inalterada (operação estritamente idempotente).
  - Nenhuma linha é inserida na tabela `financial_records`.

#### `LIST-PAID-FORBIDDEN-01`: Bloqueio de Liquidação por Usuário sem Papel de Gestão
- **Given**:
  - Uma `PaymentList` em status `pending`.
  - Usuário autenticado com papel `technician`.
- **When**:
  - O técnico tenta disparar `PATCH /api/payment-lists/:id/status` com `toStatus: 'paid'`.
- **Then**:
  - A API rejeita a operação com HTTP 403 Forbidden (`CODE: FORBIDDEN_ROLE`).

#### `LIST-RECTIFICATION-LINEAGE-01`: Retificação Comercial Reabrindo OP sem Entidade Sintética
- **Given**:
  - Um item de lista glosado pelo cliente por serviço malfeito associado a uma `WeeklogEntry` originada da `ProductionOrder` PO1.
- **When**:
  - O gestor registra `decision = "request_rectification"` no resultado do confronto.
- **Then**:
  - O backend invoca transacionalmente `rectifyWeeklogEntry` da Spec 003:
    - A `ProductionOrder` PO1 é reaberta com `status = "in_production"` e `executionSequence = 2`.
    - O resultado do confronto registra `reopenedProductionOrderId = PO1.id` e `targetExecutionSequence = 2`.
    - Nenhum `rectificationId` sintético é inventado.

---

### Grupo 6: Compatibilidade Legada & Fronteira Financeira

#### `LEGACY-PAYMENTORDER-READONLY-01`: Proibição de Mutações em Rotas Legadas
- **Given**:
  - Usuário autenticado tentando disparar `POST /api/payment-orders` ou `PATCH /api/payment-orders/:id`.
- **When**:
  - A requisição atinge a rota legada.
- **Then**:
  - A API retorna HTTP 410 Gone ou 409 Conflict, informando que alterações operacionais devem ser realizadas via `/api/payment-lists`.

#### `NO-FINANCE-SIDE-EFFECT-04`: Ausência Estrita de Side-Effects Financeiros Automáticos
- **Given**:
  - Execução ponta a ponta do ciclo da Spec 004: importação, staging, efetivação de lista, confronto, decisão humana e liquidação.
- **When**:
  - O estado da tabela `financial_records` é inspecionado antes e depois de todo o fluxo.
- **Then**:
  - A tabela `financial_records` permanece **estritamente inalterada** (zero inserts, zero updates, zero deletes).
  - Nenhuma rotina de recriação contábil automática é disparada.
