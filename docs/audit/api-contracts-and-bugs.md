# Fase 4A — Auditoria Estática de Contratos, Fluxos e Bugs

**Branch**: `000-operix-diagnostic`  
**Data**: 2026-09-05  
**Escopo**: auditoria estática; nenhum código de produto alterado; nenhuma afirmação de reprodução em runtime

## 1. Resultado executivo

A API Express expõe **189 endpoints** em 26 arquivos/famílias de rotas, incluindo `/api/health`. Foram confrontados **226 call sites REST de primeira parte no frontend**: 219 usos de `apiRequest()` e 7 `fetch()` diretos. A análise identificou **29 bugs estaticamente confirmados**, **8 hipóteses que exigem reprodução**, **7 grupos de contratos divergentes**, **9 capacidades chamadas pelo frontend sem endpoint Express equivalente**, **13 fluxos Supabase com substituto REST total ou parcial** e **5 fronteiras transacionais críticas inconsistentes**.

Os candidatos preliminares P0 concentram-se em isolamento multi-tenant e integridade financeira: reconstrução global de reconciliações, CRUD financeiro sem escopo de workspace, acesso horizontal a OS/OP/ordens de pagamento/documentos/storage e efeitos derivados não atômicos na sequência OP → WEEKLOG → pagamento → financeiro. Prioridade não substitui decisão de negócio nem teste de exploração autorizado.

### 1.1 Método, semântica e limites

O percurso auditado foi: **UI → hook/serviço → método/path/payload → autenticação/permissão → Zod ou validação equivalente → handler → Prisma/modelos → efeitos derivados**. Uma ocorrência foi marcada como:

- **BUG ESTATICAMENTE CONFIRMADO** quando a incompatibilidade ou violação decorre diretamente de caminhos de código alcançáveis e contratos declarados.
- **HIPÓTESE DE BUG — REQUER REPRODUÇÃO** quando depende de concorrência, configuração, dados, provedor externo ou comportamento temporal.

Não houve execução da aplicação, requisição ofensiva, acesso a segredos, banco, MinIO, Stripe ou provedores externos. Portanto, não há stack trace real e nenhum foi inventado. A análise usa como referencial: separação de tenants e autorização por objeto do OWASP API Security Top 10 (API1/API5), propriedades ACID para unidade de trabalho, segurança e idempotência dos métodos HTTP (RFC 9110), qualidade funcional/confiabilidade/segurança da ISO/IEC 25010 e migração incremental pelo padrão Strangler Fig.

## 2. Catálogo dos endpoints Express

Convenções: `Auth` = JWT via `requireAuth`; `Admin` = papel global `admin`; `WA` = verificação de membership do workspace; `Body/query` = valores aceitos do cliente sem prova de membership. “Validação parcial” significa Zod em apenas parte da família ou coerções manuais.

| Família / arquivo | Qt. | Métodos e paths sob `/api` | Autorização e origem do workspace | Validação, modelos e efeitos | Consumidores principais |
|---|---:|---|---|---|---|
| Índice | 1 | `GET /health` | Público; sem workspace | sem schema; health processual | deploy/healthcheck |
| Auth | 6 | `POST /auth/register`, `/login`, `/change-password`, `/recover`, `/reset-password`; `GET /auth/me` | público, exceto `me` e alteração de senha; contexto deriva do JWT | Zod; `User`, `AppUser`, `Profile`, `UserRole`, tokens e e-mail | `useAuth` |
| Account | 7 | `GET /account/profile`, `/role`, `/workspaces`, `/context`, `/permissions`; `PATCH /account/profile`; `POST /account/notifications/email` | Auth; outro `userId` só para admin; workspace solicitado e verificado nos fluxos de contexto | Zod parcial; identidade, membership, e-mail | perfil, sessão, permissões |
| Workspaces | 5 | `POST /workspaces`; `GET /workspaces/billing-context`, `/:workspaceId/members`; `POST /:workspaceId/members`; `PATCH /:workspaceId/members/:memberId` | Auth + WA; gestão exige owner/admin da membership | Zod; `Workspace`, `Membership`, usuários; onboarding | `useWorkspace`, UsersPage |
| Invites | 6 | `POST/GET /workspaces/:workspaceId/invites`; `GET /invites/incoming`; `PATCH /invites/:inviteId/accept`, `/reject`; `DELETE /invites/:inviteId` | Auth + checks de membership/convite | Zod parcial; `WorkspaceInvite`, membership e e-mail | convites autenticados |
| People | 8 | `GET/POST /people`; `GET/PATCH/DELETE /people/:id`; `GET/POST /people/:personId/documents`; `DELETE /people/:personId/documents/:documentId` | Auth/RBAC global; workspace vem do body e IDs não são scoped | validação manual/parcial; `Person`, `PersonDocument`; exclusão não remove objeto | PeoplePage |
| Locations | 5 | `GET/POST /locations`; `GET/PATCH/DELETE /locations/:id` | Auth; body/ID do cliente, sem WA | validação manual; `Location` | cadastros |
| Country requirements | 5 | `GET /country-document-requirements`, `/countries`; `POST /country-document-requirements`; `PATCH/DELETE /:id` | Auth; catálogo global; DELETE responde 405 | Zod parcial; requisitos globais | PeoplePage |
| Platforms | 3 | `GET/POST /platforms`; `PATCH /platforms/:id` | Auth; workspace por query/body sem WA | validação manual; `Platform` | PlatformsPanel e produção |
| Settings | 2 | `GET/PATCH /settings/company` | Auth; configuração compartilhada sem workspace explícito | Zod/manual; `CompanySettings` | logo e configurações da empresa |
| Service orders / WEEKLOG | 7 | `GET/POST /service-orders`; `PUT/PATCH /service-orders/:id`; `DELETE /service-orders/by-year/:year`, `/:id`; `GET /service-orders/clients` | Auth; workspace por query/body; IDs não scoped | sem Zod consistente; `ServiceOrder`, `ProductionOrder`, `PaymentOrder`, `Document`; GET reconcilia JSON e escritas derivadas | WEEKLOG, dashboards, listas |
| Production orders | 4 | `GET/POST /production-orders`; `PATCH/DELETE /production-orders/:id` | Auth; workspace/ID do cliente sem WA | coerção manual; `ProductionOrder`, `ServiceOrder`, `Document`; entrega tenta gerar WEEKLOG | produção e orçamento |
| Production photos | 3 | `GET/POST /production-orders/:orderId/photos`; `DELETE .../photos/:photoId` | Auth; IDs sem escopo de tenant | multipart/manual; `ProductionPhoto`, storage | galeria de produção |
| Production workflow | 3 | `GET /production-workflow/lists`, `/lists/:listName/items`; `PATCH /lists/:listName/status` | Auth; sem workspace explícito | manual; OS/OP/listas derivadas | listas operacionais |
| Workflow | 1 | `GET /workflow` | Auth; agregação sem workspace explícito | sem schema; múltiplos modelos operacionais | painel operacional |
| Payment orders | 5 | `GET/POST /payment-orders`; `PATCH/DELETE /payment-orders/:id`; `DELETE /payment-orders` | Auth; workspace/query/body e IDs do cliente sem WA | sem Zod; batch por `Promise.all`; `PaymentOrder` | pagamentos, listas, dashboards |
| Finance | 27 | `GET/POST /finance/reconciliations`; `PATCH /reconciliations/:id`; `POST /reconciliations/manual-merge`, `/run`; `GET /confrontation/{candidates,pending,history}`; `POST /confrontation/{merge,reject,validate}`; `GET /summary`, `/profit-rules`, `/aggregation-source`, `/technicians`, `/participation/{summary,detail}`, `/audit/{timeline,integrity-summary,participation-diffs}`, `/integrity/{issues,snapshots}`; `POST /profit-rules`, `/integrity/run`, `/ai-insights`; `DELETE /profit-rules/:id`, `/profit-rules` | Auth, majoritariamente global; `ai-insights` recebe workspace sem WA | validação manual predominante; `Reconciliation`, OS/OP, `FinancialRecord`, regras/distribuições/eventos | FinancialPage e hooks financeiros |
| Financial records | 5 | `GET/POST /financial-records`; `PATCH/DELETE /:id`; `POST /delete-by` | Auth; workspace opcional e IDs/bulk do cliente | validação manual; `FinancialRecord` | contabilidade/dashboard |
| Billing + Stripe | 43 | `POST /billing/webhooks/stripe`; catálogo e VAT; profile/payment methods/subscription events/intelligence/invoices/manual transfers por workspace; checkout/portal/preview/activation/PDF/relatórios; 21 rotas `/billing/admin/*` para métricas, automação, contas, subscriptions, payments, VAT, invoices, webhooks, lifecycle, audit e transferências | webhook público com assinatura Stripe; rotas workspace usam WA; rotas admin usam papel global | Zod amplo; modelos Billing/Stripe; efeitos de Stripe, PDF, SMTP e lifecycle | Settings/Billing/PlatformOwner |
| Billing operacional | 17 | CRUD `/billing/admin/ops/clients`; attachments; suppliers; CRUD/import/send/audit/send-log de invoices; `GET /billing/admin/ops/payments` | Auth global herdado + `requireAdmin`; owner recusado; workspace do input só precisa existir | Zod; `BillingClient`, `BillingInvoice`, attachments/logs; data URL em banco | BillingPage/ReconciliationScreen parcial |
| Documents | 6 | `GET/POST /documents`; `GET /documents/folders`; `PATCH /documents/:id`; `DELETE /documents/batch`, `/:id` | Auth; sem tenant scope | manual; `Document`; metadado separado de objeto | EmbeddedFileManager; tela global ainda legada |
| Storage | 4 | `POST /storage/upload`; `GET /storage/file/:bucket/*`, `/public/:bucket/*`; `DELETE /storage/files` | Auth em upload/private/delete; bucket/path arbitrários; public allowlist | multipart/manual; MinIO; sem vínculo obrigatório a workspace | uploads, fotos, documentos |
| Extract/OCR | 5 | `POST /extract/production-order`, `/service-order`, `/payment-order`, `/invoice`, `/receipt` | **público**; sem workspace | corpo manual; Gemini/OpenAI; custo externo | importadores documentais |
| Weather | 5 | `GET /weather/hail-events`, `/hail-reports`, `/backend-events`; `POST /weather/ingest`, `/hail-reports` | Auth; eventos e ingestão sem restrição administrativa/workspace | parcial; clima, logs e provedor externo | radar de granizo |
| Route | 2 | `POST /route/calculate`, `/geocode` | Auth | Zod/manual; OpenRouteService | Trips/tripActions (legado ainda chama function) |
| Notifications | 4 | `GET /notifications`; `PATCH /notifications/:id`, `/notifications`; `DELETE /notifications` | Auth; userId do JWT | manual; `Notification` | sino/notificações |

**Controle de contagem**: 1+6+7+5+6+8+5+5+3+2+7+4+3+3+1+5+27+5+43+17+6+4+5+5+2+4 = **189**.

## 3. Compatibilidade frontend ↔ backend

### 3.1 Contratos coerentes estaticamente

- Auth (`register/login/me/change/recover/reset`), account profile e convites autenticados usam método, path e chaves compatíveis com os schemas observados.
- Onboarding/workspace membership usa chaves camelCase compatíveis com Zod e aplica verificação de membership.
- Extração de OP/OS/ordem de pagamento usa `imageBase64`, `mimeType`, `fileName`; invoice/receipt usa `fileBase64`; os nomes coincidem com os handlers.
- Checkout e portal Stripe, perfil de faturamento e métodos de pagamento possuem shapes compatíveis; o webhook está montado antes do `requireAuth` e valida a assinatura Stripe.
- A API Finance principal (`apiFinance`) coincide em método/path na maior parte dos fluxos. O defeito é de escopo/modelagem, não de ortografia do contrato.

### 3.2 Sete grupos de contratos divergentes

| ID | Frontend esperado | Backend atual | Classificação | Consequência |
|---|---|---|---|---|
| CT-01 | `POST /extract/detect-discrepancies` | não existe | ENDPOINT AUSENTE | ação falha por 404 quando executada |
| CT-02 | `GET /discrepancies` | não existe | ENDPOINT AUSENTE | consulta falha por 404 |
| CT-03 | `/join?token=...`, lookup/aceite por token/código | convites REST autenticados por `inviteId`; rota `/join` não está registrada | CONTRATO DIVERGENTE | deep link de convite não completa o fluxo |
| CT-04 | `ReconciliationScreen` opera `billing_invoices`, pagamentos e reconciliações do Supabase | `/finance/reconciliations` confronta `ServiceOrder` e `PaymentOrder` | MODELAGEM INCOMPATÍVEL | não há troca mecânica de cliente; exige regra canônica |
| CT-05 | fallback de técnico por `user_roles/profiles` | `/finance/technicians` e members expõem identidades com semânticas distintas | CONTRATO DIVERGENTE | associação pode usar ID de perfil, auth user ou membership errado |
| CT-06 | dashboard agrega clients e discrepancies do esquema legado | REST tem `/service-orders/clients`, mas não `/discrepancies` e não um contrato unificado de cliente | BACKEND INCOMPLETO | métricas ficam incompletas ou vazias |
| CT-07 | `assertDelete` genérico espera semântica Supabase de linhas retornadas | REST possui deletes heterogêneos, `204` ou contagens diferentes | FRONTEND LEGADO | sucesso/ausência não podem ser inferidos pelo mesmo contrato |

### 3.3 Nove capacidades ativamente chamadas sem endpoint Express equivalente

| Capacidade chamada | Origem | Situação estática |
|---|---|---|
| `POST /extract/detect-discrepancies` | `src/hooks/usePaymentOrders.ts:250` | endpoint ausente |
| `GET /discrepancies` | `src/hooks/usePaymentOrders.ts:277` | endpoint ausente |
| `extract-fleet-document` | páginas de Vehicles/FuelLogs/Drivers | Edge Function legada; sem Express equivalente |
| `ai-orchestrator` | fluxos IA | sem Express equivalente |
| `ai-action` | fluxos IA | sem Express equivalente |
| `run-automation-engine` | automação | sem Express equivalente |
| `agent-chat` | dois clientes de agente | sem Express equivalente |
| `company-lookup` | cadastro empresarial | sem Express equivalente |
| `reset-system` | administração | sem Express equivalente |

`calculate-route` não entra na contagem: há substituto REST em `POST /api/route/calculate`, embora consumidores permaneçam no legado.

## 4. Matriz dos 13 fluxos Supabase com substituto REST

| # | Fluxo legado | Substituto REST | Cobertura / incompatibilidade | Esforço |
|---:|---|---|---|---|
| 1 | `ReconciliationScreen`: billing invoices/payments/reconciliations | `/billing/admin/*` + `/finance/reconciliations` | parcial; domínios de reconciliação distintos, requer decisão | alto |
| 2 | `PlatformsPanel`: consulta `service_orders` | `GET /service-orders?workspace_id=` | equivalente de leitura, apesar do nome enganoso | médio |
| 3 | `RevenueChart`: `payment_orders` | `GET /payment-orders?workspace_id=` | substituto direto após adaptar envelope | baixo |
| 4 | `PaymentOrdersTable`: update/delete | `PATCH/DELETE /payment-orders/:id` | unitário; batch exige várias chamadas e atomicidade | médio |
| 5 | `useDashboardData`: SO, payment, finance, roles, clients, discrepancies | quatro famílias REST | parcial; cliente fragmentado e discrepancies ausente | alto |
| 6 | `useFinancialEvents`: `financial_events` | `GET /finance/audit/timeline` | filtros e shape diferem | médio |
| 7 | `usePaymentLists`: `payment_orders` | `GET /payment-orders` | substituto direto | baixo |
| 8 | `useServiceOrderPhotos`: documents/storage | `/documents` + `/storage/file` | exige adaptar metadado/URL e tenant | médio |
| 9 | `useTechnicianEarnings`: rules/profiles | `/finance/profit-rules` + `/finance/technicians` | parcial; regras são globais e identidade difere | médio/alto |
| 10 | `useUserAvatar`: profiles | `GET/PATCH /account/profile` | resposta vem em `{ profile }` | baixo |
| 11 | `assertDelete`: delete genérico | deletes REST por entidade | não há equivalência genérica segura | médio/alto |
| 12 | `getTechnicianForRecord`: roles/profiles | `/finance/technicians` ou workspace members | decisão de identidade necessária | médio |
| 13 | `JoinPage`: token/código/RPC | invites REST por `inviteId` | incompatível com deep link público atual | alto |

## 5. Cadeia transacional crítica

| Fronteira | Estado e efeito derivado | Unidade transacional observada | Risco estático |
|---|---|---|---|
| Orçamento → OP | orçamento fica em `localStorage`; aprovação cria OP e serializa orçamento em `notes`; mapa orçamento/OP volta ao navegador | nenhuma unidade de persistência de domínio | perda entre navegadores, ausência de unicidade/auditoria; duplicidade concorrente é hipótese |
| OP entregue → WEEKLOG/OS | OP é atualizada; depois `upsertWeeklogFromProduction()` procura/cria/atualiza OS, documentos/pastas e liga IDs | operações sequenciais; exceção retorna `action: "skipped"` e preserva sucesso primário | OP entregue pode existir sem WEEKLOG ou vínculo completo |
| WEEKLOG validado → PaymentOrder/List | OS é persistida; hook procura pagamento, calcula lista, cria PaymentOrder e escreve metadados na OS | check-then-create e escritas separadas; falha derivada é capturada | OS validada sem pagamento; corrida pode duplicar pagamentos/list names |
| Payment/List → Billing | modelos usam IDs escalares fragmentados; billing operacional trabalha com invoice/client próprios | não há unidade de trabalho vertical única demonstrada | vínculo pode ficar sem integridade referencial e sem fonte canônica |
| Reconciliação → ajuste financeiro/evento | status de reconciliação é alterado; diferença cria `FinancialRecord`; evento é emitido em outra etapa | sem transação única; ajuste pode nascer com `workspaceId` nulo | reconciliação, ledger e auditoria podem divergir |
| Regra de lucro → distribuição | regra, itens, recalculo e snapshot são feitos dentro de `prisma.$transaction` | atômica localmente | implementação é global: `ProfitRule`/distribuições não têm tenant; atomicidade não corrige escopo |

Invariantes estruturais ausentes agravam a cadeia: `PaymentOrder.serviceOrderId` e `ProductionOrder.serviceOrderId` não são `@unique` nem relações; `Reconciliation` não possui `workspaceId` nem FKs; `ProfitRule` e `ServiceOrderDistribution` não possuem workspace; `FinancialRecord` aceita workspace opcional e referências escalares. Logo, o banco não consegue impedir vários estados inválidos que os handlers tentam evitar por `findFirst`.

## 6. Bugs estaticamente confirmados

Cada linha contém o conjunto mínimo solicitado. “Atual” é comportamento inferido/provado pelo código, não observado em runtime.

| ID | Pri. / módulo / classe | Esperado × atual | Causa-raiz; frontend; backend; persistência | Evidência | Dependência / confiança |
|---|---|---|---|---|---|
| B4A-001 | P0 Finance — AUTORIZAÇÃO INCORRETA | reconciliação por tenant × consultas globais | ausência de workspace no contrato; FinancialPage chama REST; handlers carregam OS/OP/reconciliações globais; `Reconciliation` sem workspace | `finance.ts` rotas de reconciliation/confrontation; `schema.prisma:674` | definir tenant do confronto / alta |
| B4A-002 | P0 Finance — EFEITO DERIVADO NÃO ATÔMICO | rebuild restrito × `/reconciliations/run` apaga todas as reconciliações automáticas e recria globalmente | rotina destrutiva global autenticada; modelos financeiros globais | `finance.ts`, `deleteMany({source:"auto"})` na rotina run | tenant + política admin / alta |
| B4A-003 | P0 Finance — AUTORIZAÇÃO INCORRETA | ledger scoped × CRUD/bulk aceita workspace opcional e IDs do cliente | rota não deriva tenant da sessão; `FinancialRecord.workspaceId` opcional | `financialRecords.ts`; `schema.prisma:648` | tenant canônico / alta |
| B4A-004 | P0 Pagamentos — AUTORIZAÇÃO INCORRETA | pagamentos do workspace ativo × query/body/ID controlam escopo | sem WA; frontend REST envia workspace; Prisma filtra valor informado | `paymentOrders.ts:63-145` | middleware tenant / alta |
| B4A-005 | P0 WEEKLOG — AUTORIZAÇÃO INCORRETA | OS scoped e ID imutável × query escolhe workspace, update/delete usam ID; PUT pode criar ID arbitrário | sem WA e upsert-style PUT; `ServiceOrder` recebe workspace do body | `serviceOrders.ts:298-565` | regra de upsert e tenant / alta |
| B4A-006 | P0 Produção — AUTORIZAÇÃO INCORRETA | OP scoped × workspace/ID não são autorizados | sem WA; GET/POST/PATCH/DELETE confiam no cliente | `productionOrders.ts` handlers REST | tenant canônico / alta |
| B4A-007 | P0 Documentos — AUTORIZAÇÃO INCORRETA | metadados por tenant × list/update/delete globais por entidade/ID | `Document` não é filtrado por membership | `documents.ts:35-125` | modelo de ownership / alta |
| B4A-008 | P0 Storage — AUTORIZAÇÃO INCORRETA | objeto limitado ao tenant/bucket permitido × usuário autenticado escolhe bucket/path | não há prefixo/ACL de domínio; private GET e delete aceitam alvo arbitrário | `storage.ts:52-139` | política de buckets/paths / alta |
| B4A-009 | P1 Pessoas — AUTORIZAÇÃO INCORRETA | pessoas do tenant × list/detail/write por ID/body global | RBAC global substitui autorização por objeto | `people.ts` handlers; `Person.workspaceId` | decisão de papel plataforma / alta |
| B4A-010 | P1 Locais — AUTORIZAÇÃO INCORRETA | locais do tenant × CRUD global/ID | workspace é confiado ao payload | `locations.ts` handlers | tenant canônico / alta |
| B4A-011 | P1 Fotos — AUTORIZAÇÃO INCORRETA | foto pertencente à OP autorizada × orderId/photoId não são scoped | falta encadeamento membership → OP → foto | `productionPhotos.ts` | ownership de objeto / alta |
| B4A-012 | P1 Plataformas — AUTORIZAÇÃO INCORRETA | plataforma por tenant × query/body/ID sem WA | autorização apenas por login | `platforms.ts` | política global versus tenant / alta |
| B4A-013 | P1 Clima/logs — AUTORIZAÇÃO INCORRETA | logs sensíveis restritos × `/weather/backend-events` é global e ingest pode ser disparada por qualquer autenticado | ausência de admin/workspace policy | `weather.ts` | definir operadores autorizados / alta |
| B4A-014 | P1 OCR/IA — AUTORIZAÇÃO INCORRETA | serviço caro autenticado/limitado × cinco endpoints públicos | router não usa `requireAuth`, quota ou workspace | `extract.ts:6,101,242,378,531` | política de quota e tamanho / alta |
| B4A-015 | P1 Billing — AUTORIZAÇÃO INCORRETA | owner administra faturamento ou regra explícita × `requireAdmin` aceita somente `admin` | papel global estrito conflita com papel owner observado na aplicação | `billingOperations.ts:116-122` | DECISÃO DE NEGÓCIO NECESSÁRIA / alta |
| B4A-016 | P1 Billing ops — AUTORIZAÇÃO INCORRETA | admin restrito aos tenants delegados × workspace apenas precisa existir e IDs são globais | `ensureWorkspaceExists` não prova membership; list sem workspace retorna tudo | `billingOperations.ts:417,505,568,877,941,1080` | papel plataforma / alta |
| B4A-017 | P1 Billing docs — MODELAGEM INCOMPATÍVEL | anexo em object storage × data URL inteira gravada como `storagePath` | contrato mistura conteúdo e localização; frontend envia data URL; DB persiste string | `billingOperations.ts:62,754,1119` | política documental / alta |
| B4A-018 | P0 Payment UI — FRONTEND LEGADO | edição/pagamento/delete persistem × noop Supabase retorna sucesso sem mutação | UI ainda chama facade; REST equivalente existe mas não é usado | `PaymentOrdersTable.tsx:211-368`; `supabase/client.ts` | migrar fluxo vertical / alta |
| B4A-019 | P1 Discrepâncias — ENDPOINT AUSENTE | detectar/listar discrepâncias × paths não montados | hook ativo chama REST inexistente; não há handler/modelo correspondente | `usePaymentOrders.ts:250,277` | definir domínio/contrato / alta |
| B4A-020 | P1 Reconciliação UI — MODELAGEM INCOMPATÍVEL | tela e API compartilham ledger × tela usa billing legado, API usa OS/PaymentOrder | duas reconciliações conceitualmente distintas | `ReconciliationScreen.tsx`; `finance.ts` | DECISÃO DE NEGÓCIO NECESSÁRIA / alta |
| B4A-021 | P1 Documentos UI — FRONTEND LEGADO | tela global persiste em REST/MinIO × continua em Supabase noop | migração por componente, não por capacidade | página `/documents`, `EmbeddedFileManager.tsx`, `documents.ts` | consolidar contrato / alta |
| B4A-022 | P2 Receita — FRONTEND LEGADO | gráfico lê pagamentos REST × `RevenueChart` usa Supabase noop | substituto `/payment-orders` existe | `RevenueChart` e `paymentOrders.ts` | adaptar envelope/filtros / alta |
| B4A-023 | P1 Convites — CONTRATO DIVERGENTE | link `/join?token=` resolve convite × rota UI não registrada e API aceita inviteId autenticado | legado por token/código não corresponde ao REST atual | `JoinPage.tsx:10,144`; configuração de rotas; `invites.ts` | DECISÃO DE NEGÓCIO NECESSÁRIA / alta |
| B4A-024 | P1 Orçamento — BACKEND INCOMPLETO | orçamento auditável e compartilhado × estado em localStorage e texto em OP.notes | inexiste entidade Budget/PDR; frontend é fonte temporária | `BudgetPanel.tsx:81-192,281-290,500-517`; schema | modelo de orçamento / alta |
| B4A-025 | P0 OP→WEEKLOG — EFEITO DERIVADO NÃO ATÔMICO | entrega e WEEKLOG confirmam juntos × OP confirma e erro derivado vira `skipped` | sequência fora de transação com catch | `productionOrders.ts:274-527,583,619-625` | política de consistência / alta |
| B4A-026 | P0 WEEKLOG→Pagamento — EFEITO DERIVADO NÃO ATÔMICO | validação e pagamento/lista confirmam juntos × check/create/update separados e falha não reverte OS | ausência de transação/outbox e restrição única | `serviceOrders.ts:238-267` e handlers PATCH/PUT | invariantes/idempotência / alta |
| B4A-027 | P0 Reconciliação→Ledger — EFEITO DERIVADO NÃO ATÔMICO | validar, ajustar e auditar atomicamente × status, `FinancialRecord` e evento são etapas separadas; ajuste sem workspace | unidade de trabalho incompleta | `finance.ts:862` e fluxo validate | tenant + regra contábil / alta |
| B4A-028 | P1 Batches — EFEITO DERIVADO NÃO ATÔMICO | lote tudo-ou-nada ou resultados explícitos × POSTs usam `Promise.all` sem transação | commits parciais possíveis quando um item falha | `paymentOrders.ts:88`; `serviceOrders.ts:427` | semântica do lote / alta |
| B4A-029 | P0 Núcleo financeiro — MODELAGEM INCOMPATÍVEL | banco impõe tenant/FKs/idempotência × refs escalares, workspace ausente/opcional e sem unique | integridade depende de convenção em handlers | `schema.prisma:514,550,648,674,692,720` | migração de dados e domínio / alta |

## 7. Hipóteses de bug — requerem reprodução

Estas hipóteses **não** são contadas como bugs confirmados.

| ID | Pri. / módulo / classe | Esperado × hipótese atual | Causa possível; camadas | Evidência estática | Reprodução/dependência / confiança |
|---|---|---|---|---|---|
| H4A-001 | P1 Orçamento — OUTRO | um clique gera uma OP × retries/abas podem gerar duplicatas | idempotência só no mapa local; API não recebe chave única | `BudgetPanel.tsx:500-517`; `ProductionOrder` sem unique | concorrência/retry com DB / média |
| H4A-002 | P1 OP→WEEKLOG — OUTRO | uma OP gera um WEEKLOG/pasta × check-then-create concorrente pode duplicar | `findFirst` seguido de create sem unique | `productionOrders.ts:91,134,220,274+` | duas entregas simultâneas / média |
| H4A-003 | P0 WEEKLOG→Pagamento — OUTRO | uma OS gera um pagamento/lista × corrida pode duplicar ambos | `findFirst` + create; sem unique em `serviceOrderId`/listName | `serviceOrders.ts:238-267`; schema | concorrência controlada / alta |
| H4A-004 | P1 Stripe — OUTRO | replay é idempotente × algum evento pode repetir efeito/log | depende de event IDs, estado real e ordem de entrega | webhook assinado e branches em `billing.ts` | replay sandbox Stripe / baixa |
| H4A-005 | P1 Convites — OUTRO | um convite pendente por destino/workspace × requisições simultâneas podem duplicar | falta de invariante única precisa ser confirmada com migração/dados | `invites.ts`; `WorkspaceInvite` | chamadas concorrentes / média |
| H4A-006 | P1 Billing — OUTRO | display IDs sequenciais únicos × concorrência pode colidir | geração sequencial exige inspeção sob isolamento real/constraints | `billingOperations.ts` geração de identificadores | transações paralelas / média |
| H4A-007 | P2 Payloads — OUTRO | payload inválido retorna 4xx × rotas sem Zod podem produzir 500/coerções | depende do error middleware e do driver | payment/OS/OP/finance com casts manuais | matriz de payloads inválidos / média |
| H4A-008 | P1 Arquivos — OUTRO | upload e metadado têm lifecycle único × falha intermediária pode deixar objeto órfão | MinIO e Prisma são recursos separados, sem compensação universal | upload/storage + criação de documentos/fotos | induzir falha de DB após upload / média |

## 8. Riscos estáticos de segurança — limite da Fase 4A

- **BOLA/IDOR multi-tenant**: rotas autenticadas continuam vulneráveis conceitualmente quando autorizam apenas o login e confiam em `workspace_id`/ID do cliente. Isto é constatação de código, não teste de exploração.
- **Broken Function Level Authorization**: operações administrativas ou de alto custo (`weather/ingest`, OCR/IA, finance global) não têm papel/tenant compatível com seu impacto.
- **Unrestricted Resource Consumption**: OCR/IA público não demonstra quota/rate limit/tamanho de payload específico no router.
- **Object storage**: bucket/path escolhidos pelo cliente não demonstram ownership; data URLs fiscais ampliam exposição e retenção no PostgreSQL.
- **Ponto positivo confirmado**: o webhook Stripe usa corpo apropriado e verificação de assinatura antes do processamento; isso não prova idempotência ponta a ponta.

A Fase 5 deverá aprofundar CORS, headers, rate limiting, segredos, criptografia, senhas, dependências, performance e testes. Nada disso foi declarado seguro ou vulnerável sem inspeção correspondente.

## 9. Decisões de negócio necessárias

1. **DECISÃO DE NEGÓCIO NECESSÁRIA — tenant canônico**: workspace deve vir exclusivamente de claim/contexto validado, de header assinado ou pode ser escolhido pelo cliente? Qual papel de plataforma atravessa tenants?
2. **DECISÃO DE NEGÓCIO NECESSÁRIA — atomicidade**: OP/WEEKLOG/pagamento bloqueiam a transição se o derivado falhar, ou adotam estado pendente + outbox/retry/reconciliação?
3. **DECISÃO DE NEGÓCIO NECESSÁRIA — reconciliação**: o objeto canônico confronta OS×PaymentOrder, invoice×payment ou ambos como processos distintos?
4. **DECISÃO DE NEGÓCIO NECESSÁRIA — orçamento**: versão, aprovação, assinatura e vínculo com OP precisam ser imutáveis/auditáveis? Qual chave impede duplicação?
5. **DECISÃO DE NEGÓCIO NECESSÁRIA — identidades**: qual ID representa técnico/colaborador/usuário e quando `Person`, `Profile`, `AppUser` e membership se vinculam?
6. **DECISÃO DE NEGÓCIO NECESSÁRIA — owner/admin**: owner do workspace administra billing operacional ou apenas admin de plataforma?
7. **DECISÃO DE NEGÓCIO NECESSÁRIA — arquivos**: retenção, descarte, versionamento, residência, buckets e trilha por classe documental.
8. **DECISÃO DE NEGÓCIO NECESSÁRIA — convites**: deep link pode consultar convite antes do login? Token deve ser opaco, expirar e ser uso único?

## 10. Acesso necessário para a Fase 4B

Para reproduzir sem usar produção: `.env` de desenvolvimento sanitizado; Docker/serviços executáveis; banco com dados anonimizados de ao menos dois workspaces; contas `owner`, `admin`, membro e usuário externo; MinIO sandbox com buckets de teste; Stripe sandbox + segredo de webhook; SMTP sink; chaves/quota de IA, clima e mapas de teste; e autorização explícita para testes de concorrência, falhas induzidas e isolamento horizontal. Também são necessárias respostas às decisões que alteram o resultado esperado.

## 11. Encerramento da Fase 4A

Esta fase encerra no diagnóstico estático. Não foram iniciadas reprodução 4B, correção de produto, Fase 5, Fase 6 ou Fase 7. As prioridades são preliminares e devem ser convertidas em backlog somente depois da validação de domínio e da reprodução controlada.

### Referencial teórico

- OWASP Foundation. *OWASP API Security Top 10 — 2023* (API1 Broken Object Level Authorization; API4 Unrestricted Resource Consumption; API5 Broken Function Level Authorization).
- ISO/IEC 25010. *Systems and software Quality Requirements and Evaluation — Product quality model*.
- IETF. RFC 9110. *HTTP Semantics* — métodos seguros, idempotência e códigos de resposta.
- Gray, J.; Reuter, A. *Transaction Processing: Concepts and Techniques* — atomicidade, consistência, isolamento e durabilidade.
- Fowler, M. *Strangler Fig Application* — substituição incremental de capacidades legadas por fatias verticais.
