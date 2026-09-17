# Findings de Discovery e Auditoria Técnica — Spec 003 (Revisão Pós-Remediação Final)

**Fatia**: R1 — Operação Móvel: Conclusão de OP, WEEKLOG, Validação em Lote e Retificação Versionada  
**Branch**: `feat/003-production-weeklog`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-17  

---

## 1. Classificação dos Findings

Cada achado técnico é classificado conforme a evidência:
- **CONFIRMED**: Verificado diretamente no código-fonte ativo (`backend/`, `src/`) ou no schema do banco de dados.
- **INFERRED**: Derivado logicamente da análise cruzada de fluxos e regras de negócio documentadas.
- **RUNTIME REQUIRED**: Comportamento que depende de execução em runtime/ambiente para observação empírica de performance ou concorrência sob carga.

---

## 2. Inventário de Findings

### FINDING-001: Ausência de RequestContext e Vulnerabilidade BOLA/IDOR nas Rotas de ServiceOrder
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/serviceOrders.ts`
- **Linhas**: 1-4, 298-313, 421-422, 446-447, 489-490, 526-531, 549-550
- **Comportamento Observado**:
  As rotas `/service-orders` utilizam apenas `requireAuth`, sem aplicar `resolveRequestContext`. O tenant é recebido via query param (`req.query.workspace_id`) ou body param (`req.body.workspace_id`). Qualquer usuário autenticado na plataforma pode forjar o identificador `workspace_id` para listar, criar, alterar ou apagar ordens de serviço de outros workspaces. Além disso, técnicos com `membershipRole: "technician"` não têm seu escopo restrito no servidor (`scope: "own"`), podendo inspecionar a produção de outros técnicos simplesmente omitindo o filtro `assigned_user_id`.
- **Risco**: Crítico (BOLA/IDOR — CWE-639 / OWASP API1). Vazamento de dados operacionais e financeiros entre empresas clientes.
- **Reuso**: Substituir por `resolveRequestContext` e aplicar `assertTenantAccess(ctx, resource.workspaceId)` e `assertObjectAccess(ctx, resource)`.
- **Decisão Necessária**: DEC-001 (Migração mandatória para `RequestContext` e autorização por objeto).

---

### FINDING-002: Mutação no Banco Durante Requisição de Leitura HTTP GET ("Reconciliação Persistente")
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/serviceOrders.ts`
- **Linhas**: 353-383
- **Comportamento Observado**:
  No endpoint `GET /service-orders`, o backend itera sobre a lista de `service_orders` retornadas e executa `prisma.serviceOrder.update` em loop para gravar identificadores de `payment_orders` no JSON da ordem de serviço ("reconciliação persistente"). Isso gera mutações no banco durante uma chamada de leitura, violando a especificação HTTP.
- **Risco**: Alto. Concorrência indesejada, locks no PostgreSQL e degradação de latência em operações de leitura.
- **Reuso**: Eliminar integralmente qualquer mutação derivada dentro de `GET`.
- **Decisão Necessária**: DEC-002 (Erradicação de side effects em endpoints de leitura).

---

### FINDING-003: Acoplamento Prematuro de Efeitos Financeiros na Validação Operacional
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/serviceOrders.ts`
- **Linhas**: 216-296, 463-484, 503-521
- **Comportamento Observado**:
  Quando um `ServiceOrder` é atualizado via `PUT` ou `PATCH` com status validado, os handlers chamam `createPaymentOrderFromValidatedWeeklog`. Essa função gera um código de lista (`listName = L010132`), insere uma linha na tabela `payment_orders` e oculta o registro da tela de WEEKLOG. Isso acopla indevidamente a conferência operacional de oficina com o faturamento comercial multissemanas da Spec 004.
- **Risco**: Crítico de Domínio. Desfiguração da fronteira entre WEEKLOG e Lista de Pagamento.
- **Reuso**: Remover completamente a chamada a `createPaymentOrderFromValidatedWeeklog` e a geração de `PaymentOrder` na Spec 003. O ciclo da Spec 003 encerra-se em **WEEKLOG VALIDATED**.
- **Decisão Necessária**: DEC-003 (Separação estrita: Validação de WEEKLOG encerra-se sem criação de dados financeiros ou listas).

---

### FINDING-004: Incompatibilidade da Constraint de Unicidade com Retificações na Mesma Semana
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/productionOrders.ts` (L585-618)
- **Comportamento Observado**:
  A restrição de unicidade sem suporte a versionamento impedia que uma mesma `ProductionOrder` fosse re-finalizada dentro do mesmo período semanal caso sofresse retificação e retrabalho rápido. Se uma ordem fosse concluída na segunda-feira, reprovada na terça e re-finalizada na quinta da mesma semana, a inserção da segunda entrada falhava por violação de unicidade.
- **Risco**: Alto. Bloqueio de fluxo operacional de oficina em retificações ágeis de mesmo período semanal.
- **Reuso**: Adotar **execução versionada** com `executionSequence` (`@@unique([productionOrderId, executionSequence])`) e foreign key relacional auto-referenciada em `rectificationOriginEntryId`.
- **Decisão Necessária**: DEC-004 (Execução versionada na retificação e constraint por sequência de execução).

---

### FINDING-005: Identidade de Lote Semanal Frágil com Campos Nulos e Falta de Local Canônico
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/productionOrders.ts` (L588-600)
- **Comportamento Observado**:
  A chave composta de agrupamento continha campos nulos (`clientId`, `platform`), permitindo que no PostgreSQL a restrição de unicidade fosse contornada (já que `NULL != NULL` no padrão SQL ANSI sem `NULLS NOT DISTINCT`). Além disso, não havia exigência de local operacional persistido antes da finalização.
- **Risco**: Médio-Alto. Duplicação de lotes semanais e orfandade de faturamento por ausência de cliente contratante e de oficina canônica.
- **Reuso**: Identidade determinística baseada estritamente em campos não-nulos: `@@unique([workspaceId, startsOn, clientId, siteKey])`, tornando `clientId` e `ProductionOrder.operationalSiteKey` obrigatórios para a finalização (HTTP 422 se ausentes).
- **Decisão Necessária**: DEC-005 (Identidade determinística do lote semanal e siteKey canônico).

---

### FINDING-006: Indeterminismo de Fuso Horário por Ausência de Configuração no Workspace
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/lib/weekUtils.ts` (L9-17, 23-35, 60-90) e `backend/prisma/schema.prisma` (L77-98)
- **Comportamento Observado**:
  O modelo `Workspace` não possui coluna de fuso horário. A função `operationalWeekOf` utiliza instâncias locais de `new Date()` do Node.js, tornando o cálculo de início da semana (Domingo 00:00) e término (Sábado 23:59) dependente do horário da máquina host.
- **Risco**: Médio. Veículos finalizados próximos à meia-noite de sábado para domingo caem em semanas operacionais distintas dependendo da configuração do servidor.
- **Reuso**: Adicionar `timezone String @default("UTC")` em `Workspace`, armazenar snapshot em `Weeklog.timezone` e utilizar `date-fns-tz` com fallback padrão `"UTC"`.
- **Decisão Necessária**: DEC-006 (Fuso horário IANA formal no Workspace e cálculo semanal determinístico).

---

### FINDING-007: Falta de Restrição de Auto-Validação em Lote por Técnicos
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/routes/serviceOrders.ts` (L489-521)
- **Comportamento Observado**:
  Qualquer usuário autenticado com acesso ao workspace podia marcar o serviço como validado. Não existia bloqueio impedindo que o próprio técnico executor validasse o seu próprio trabalho ou chancelasse um lote contendo trabalhos de sua autoria.
- **Risco**: Crítico de Governança e Compliance. Auto-aprovação de serviços sem conferência independente do cliente contratante.
- **Reuso**: Implementar a regra de não-auto-validação no servidor (`VALIDATOR-BATCH-SELF-01`): se o validador tiver executado qualquer entrada coberta pelo lote, o backend recusa com HTTP 403 Forbidden. Validador externo deve possuir grant ativo em `ClientAccessGrant`.
- **Decisão Necessária**: DEC-007 (Proibição estrita de auto-validação em lote e ciclo de vida do grant).

---

### FINDING-008: Inclusão Indevida de `finalValue` no Payload de Validação
- **Classificação**: CONFIRMED
- **Arquivo**: `src/components/service-orders/WeeklogOperationalDocumentDialog.tsx` (L630-651)
- **Comportamento Observado**:
  A interface e o contrato anterior permitiam ao validador alterar arbitrariamente o campo `valor_final` / `finalValue` durante a validação do WEEKLOG. Isso misturava a conferência da execução técnica com a negociação comercial de faturamento, gerando descompasso com os serviços lançados na ordem.
- **Risco**: Alto. Adulteração unilateral de valores de produção sem vínculo com os serviços executados.
- **Reuso**: Remover `finalValue` da validação de WEEKLOG. O `WeeklogEntry` congela `totalAmount` e `currencyCode` (ISO-4217 obrigatório). Discrepâncias comerciais pertencem à Spec 004 (Confronto/Lista); erros técnicos devem ser corrigidos via Retificação.
- **Decisão Necessária**: DEC-008 (Imutabilidade de valores no WEEKLOG e remoção de finalValue da validação).

---

### FINDING-009: OPs Diretas Dependentes de Parsing de Notas por Ausência de Serviços Estruturados
- **Classificação**: CONFIRMED
- **Arquivo**: `backend/src/lib/weekUtils.ts` (L128-164) e `backend/src/routes/productionOrders.ts` (L454-459)
- **Comportamento Observado**:
  Ordens de produção diretas dependiam de anotações manuais no campo de texto livre `ProductionOrder.notes` para extração de serviços via regex. Se o texto fosse formatado livremente, a extração falhava silenciosamente e gerava total zero.
- **Risco**: Médio-Alto. Ordens diretas sem detalhamento de serviços e perda de dados operacionais.
- **Reuso**: Adicionar o campo estruturado `performedServices` em `ProductionOrder` com decimais em strings normalizadas e cálculo em `Prisma.Decimal`, exigindo ao menos um serviço estruturado antes da finalização.
- **Decisão Necessária**: DEC-009 (Serviços estruturados com decimais obrigatórios para ordens de produção diretas).

---

### FINDING-010: Risco de Mutabilidade da Assinatura Pós-Validação e Superfície de Ataque SVG
- **Classificação**: CONFIRMED
- **Arquivo**: `src/lib/budgetPdfUtils.ts` e contratos de storage anteriores
- **Comportamento Observado**:
  Permitia upload de SVG (vetor vulnerável a scripts embutidos XML/XSS) e não congelava o arquivo após a validação do documento.
- **Risco**: Médio de Segurança e Auditoria. Risco de XSS armazenado e adulteração de evidência de assinatura em documento validado.
- **Reuso**: Aceitar estritamente imagens PNG (validação de magic bytes `89 50 4E 47`, limite 1 MB). Vincular o arquivo na transação atômica de validação do lote e bloquear substituição pós-validação (HTTP 409).
- **Decisão Necessária**: DEC-010 (Assinatura estrita em PNG e imutabilidade pós-validação).
