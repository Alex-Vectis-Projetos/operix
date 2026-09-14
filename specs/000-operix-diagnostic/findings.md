# Findings: Diagnóstico Técnico Brownfield Operix

**Branch**: `000-operix-diagnostic` | **Status**: CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS; Fase 7 concluída; 4B/5B não executadas integralmente  
**Data da Auditoria**: 2026-09-05  

Este documento registra todas as evidências materiais e constatações técnicas levantadas no código fonte durante a auditoria.

---

## 1. Arquitetura e Transição Brownfield

### 1.1 Façade Silenciosa do Supabase (*Silent Failure Antipattern*)
- **Evidência**: [src/integrations/supabase/client.ts:8-235](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/integrations/supabase/client.ts#L8-L235) e [src/main.tsx:31-60](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/main.tsx#L31-L60)
- **Constatação**: O arquivo instala uma função `isDevOriginBlockedByCors()` e um fetch blocker que interceptam todas as chamadas `fetch` para domínios Supabase e retornam uma resposta fake 204 `{ data: null, error: { message: "supabase-blocked-in-dev" } }`. Além disso, instancia um `noopSupabaseFacade()` com proxies recursivos que resolvem qualquer cadeia de métodos (`supabase.from().select().eq().then()`) com `{ data: null, error: null }`.
- **Impacto**: Qualquer componente ou hook do frontend que ainda não foi migrado para a API REST própria (`apiRequest`) falha silenciosamente: não emite erro visual, não faz requisição de rede e renderiza listas vazias ou desativa ações, mascarando bugs.
- **Arquivos Afetados**: Pelo menos 48 arquivos no frontend ainda importam `@/integrations/supabase/client` (ex.: [src/pages/ModulePages.tsx:3](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/ModulePages.tsx#L3), [src/pages/FleetPage.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/FleetPage.tsx), [src/pages/AuditPage.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/AuditPage.tsx), [src/lib/realtime/RealtimeHub.ts](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/lib/realtime/RealtimeHub.ts)).

### 1.2 Código Residual de Sondas de Debug em Produção/Desenvolvimento
- **Evidência**: 27 ocorrências de `void fetch("http://127.0.0.1:7777/event", ...)` espalhadas em arquivos centrais:
  - [src/App.tsx:81, 103](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/App.tsx#L81) (em cada mudança e estabilização de rota)
  - [src/components/ProtectedRoute.tsx:25](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/ProtectedRoute.tsx#L25)
  - [src/components/PermissionGuard.tsx:90](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/PermissionGuard.tsx#L90)
  - [src/hooks/useAuth.tsx:126, 147, 176, 193, 216](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useAuth.tsx#L126)
  - [src/hooks/useWorkspace.tsx:82, 109, 147, 199](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useWorkspace.tsx#L82)
  - [src/hooks/usePermission.tsx:71, 94, 118](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/usePermission.tsx#L71)
  - [src/hooks/useDashboardData.ts:39, 102, 137](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useDashboardData.ts#L39)
  - [src/pages/PlatformOwnerPage.tsx:135, 206, 223, 240](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/PlatformOwnerPage.tsx#L135)
  - [src/components/file-manager/EmbeddedFileManager.tsx:62](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/file-manager/EmbeddedFileManager.tsx#L62)
- **Constatação**: Artefato remanescente de sessão prévia de debugging automatizado. Dispara requisições HTTP locais a cada render/navegação, gerando conexões recusadas e poluição do console.

### 1.3 Acoplamento de Caminhos Absolutos no Docker Compose
- **Evidência**: [docker-compose.yml:40, 84](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docker-compose.yml#L40) e [docker-compose.dev-alex.yml:5, 44](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docker-compose.dev-alex.yml#L5)
- **Constatação**: Os arquivos de composição Docker contêm o contexto de build hardcoded para `/home/deploy/apps/nexus/QW-Nexus-/backend` e `/home/deploy/apps/nexus/QW-Nexus-`.
- **Impacto**: O build do docker-compose falha fora do servidor de deploy original se executado em ambiente local ou outra VPS sem ajustar o `context` para caminhos relativos (`./backend` e `./`).

---

## 2. Modelo de Dados e Domínio

### 2.1 Fragmentação e Duplicação na Modelagem de Pessoas e Clientes
- **Evidência**:
  - `model User` ([backend/prisma/schema.prisma:10](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L10)): Conta de autenticação (email, senha com hash).
  - `model AppUser` ([backend/prisma/schema.prisma:27](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L27)): Entidade de usuário da aplicação vinculada a `authUserId`.
  - `model Profile` ([backend/prisma/schema.prisma:43](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L43)): Perfil de usuário com nome, avatar, displayCode.
  - `model Person` ([backend/prisma/schema.prisma:953](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L953)): Entidade de cadastro unificado de pessoas físicas/jurídicas operacionais (`type`: administrative, technician, provider, client) com `systemAccessUserId` opcional e `locationId`.
  - `model Client` ([backend/prisma/schema.prisma:445](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L445)): Entidade legada de cliente consumida por `ServiceOrder` e `PaymentOrder`.
  - `model BillingClient` ([backend/prisma/schema.prisma:254](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L254)): Entidade de cliente comercial/fiscal consumida por `BillingInvoice`.
- **Constatação (Problema de Modelagem)**: Existem 3 representações distintas de "Cliente" no banco de dados (`Client`, `BillingClient`, `Person(type="client")`) e 4 representações de "Usuário/Pessoa" (`User`, `AppUser`, `Profile`, `Person`). Não há unificação conceitual nem sincronização transacional entre elas.

### 2.2 Desconexão entre Colaboradores e Utilizadores
- **Evidência**: 
  - `UsersPage` ([src/pages/ModulePages.tsx:1186](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/ModulePages.tsx#L1186)) cria credenciais de login via `/api/workspaces/:id/members`.
  - `PeoplePage` ([src/pages/PeoplePage.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/PeoplePage.tsx)) cria cadastros civis, locais e documentos de compliance via `/api/people`.
- **Constatação**: Criar um colaborador não gera acesso ao sistema, e convidar um usuário não cria seu registro de colaborador/técnico com documentos de compliance e vínculo à `Location`.

### 2.3 Dualidade WEEKLOG vs Ordem de Serviço (OS)
- **Evidência**:
  - Na UI ([src/components/layout/AppSidebar.tsx:89](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/layout/AppSidebar.tsx#L89)), o item de menu "WEEKLOG" aponta para a rota `/service-orders`.
  - No Backend ([backend/src/routes/productionOrders.ts:274](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionOrders.ts#L274)), salvar uma `ProductionOrder` dispara o hook `upsertWeeklogFromProduction()`, que cria ou atualiza um registro na tabela `service_orders` e cria pastas na tabela `documents` (`type: "folder"`, `entityType: "service_order"`, `module: "orders"`).
- **Constatação**: "WEEKLOG" e "ServiceOrder" são a mesma tabela física no banco (`service_orders`), mas na experiência do usuário e na documentação são tratados ora como ordens de serviço individuais, ora como logs operacionais agrupados por semana de trabalho.

---

## 3. Segurança e Permissões

### 3.1 Risco de Vazamento Multi-Tenant Horizontal (BOLA / IDOR)
- **Evidência**:
  - [backend/src/routes/people.ts:80-100](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/people.ts#L80): `prisma.person.findMany()` não filtra por `workspace_id`.
  - [backend/src/routes/locations.ts:50-70](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/locations.ts#L50): `prisma.location.findMany()` não filtra por `workspace_id`.
  - [backend/src/routes/serviceOrders.ts:299-313](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/serviceOrders.ts#L299): Recebe `?workspace_id=...` via query string sem validar se `req.auth.userId` é membro ativo do workspace.
- **Impacto**: Um usuário autenticado pode acessar pessoas, locais ou ordens de serviço pertencentes a outros clientes/workspaces.

### 3.2 Endpoints Públicos de Extração de IA sem Autenticação
- **Evidência**: [backend/src/routes/extract.ts:6, 101, 242, 360, 480](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/extract.ts#L6)
- **Constatação**: As rotas de extração OCR/IA (`/production-order`, `/service-order`, `/payment-order`, `/invoice`, `/receipt`) não aplicam o middleware `requireAuth`.
- **Impacto**: Exposição pública de endpoints com alto consumo computacional e financeiro (OpenAI/Gemini).

### 3.3 Bloqueio de Usuários com Papel "Owner" em Faturamento Operacional
- **Evidência**: [backend/src/routes/billingOperations.ts:117-122](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/billingOperations.ts#L117)
- **Constatação**: `requireAdmin` verifica estritamente `if (req.auth?.role !== "admin") return false;`. Usuários com role `"owner"` recebem 403 Forbidden.

---

## 4. Edge Functions e Serviços

### 4.1 Status de Migração das Edge Functions
- **Total**: 28 funções em `supabase/functions/`.
- **Portadas para Express**: 17 funções (rotas de billing, reconciliação, extração, ingestão de clima, cálculo de rota).
- **Parcialmente Portadas**: 1 função (`generate-invoice-pdf`).
- **Não Portadas**: 7 funções (`agent-chat`, `ai-action`, `ai-orchestrator`, `extract-fleet-document`, `process-invoice-emails`, `reset-system`, `run-automation-engine`).
- **Desativadas / Obsoletas**: 3 funções (`sentry-tunnel`, `test-invites`, `_shared`).

### 4.2 Armazenamento de Objetos (MinIO)
- **Evidência**: [backend/src/lib/minio.ts:21-32](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/lib/minio.ts#L21)
- **Constatação**: O MinIO está configurado e funcional no backend com 10 buckets estruturados, porém componentes legados de frontend (ex.: `FleetPage.tsx`) continuam chamando o SDK do Supabase Storage.

---

## 5. Inventário Funcional — Fase 3

### 5.1 Resultado e limite de confiança

- **Evidência consolidada**: [docs/audit/functional-inventory.md](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/functional-inventory.md).
- **Constatação**: Foram inventariadas 131 funcionalidades: 0 `FUNCIONAL`, 28 `PARCIAL`, 36 `QUEBRADA`, 4 `SOMENTE UI`, 3 `NÃO LOCALIZADA` e 60 `NÃO TESTADA`.
- **Limite**: A ausência de `.env`, dependências instaladas, Docker daemon e serviços nas portas 4000/8080 impediu validação ponta a ponta. Por isso, cadeias estaticamente coerentes foram classificadas como `NÃO TESTADA`, nunca presumidas funcionais.

### 5.2 Migração Supabase ainda funcionalmente relevante

- **Evidência**: 48 arquivos frontend importam `@/integrations/supabase/client`; 45 participam de fluxos funcionais que exigem religação REST, porte de backend ou decisão de domínio, e 3 são auxiliares de diagnóstico/infra.
- **Distribuição**: 13 podem aproveitar backend REST existente; 22 não possuem backend/domínio persistente equivalente; 3 existem somente no legado Supabase; 7 são fluxos órfãos ou mistos; 3 são componentes de diagnóstico/infra auxiliar.
- **Impacto**: A façade noop não é apenas dívida técnica. Ela invalida o feedback de sucesso de mutações em pagamentos, permissões, marketplace, consentimento, automação, IA, frota, auditoria e recuperação.

### 5.3 Orçamento/PDR não é entidade de domínio persistente

- **Evidência**: `BudgetPanel.tsx` usa `localStorage` e, ao aprovar, serializa o orçamento em `ProductionOrder.notes`; `schema.prisma` não contém entidade de orçamento, vistoria, peça ou dano.
- **Constatação**: CRUD, cálculo e assinatura aparentam capacidade de produto, mas são estado de navegador. Ficha visual por peça, fotos por peça e estimativa IA de danos não foram localizadas.

### 5.4 Efeitos operacionais não atômicos

- **Evidência**: Em `productionOrders.ts`, a falha ao gerar WEEKLOG é capturada e a entrega da OP permanece confirmada. Em `serviceOrders.ts`, a falha ao derivar lista de pagamento não reverte a validação.
- **Impacto**: O sistema admite estados de negócio contraditórios sem mecanismo transacional de recuperação, idempotência ou reconciliação obrigatória.

### 5.5 Fragmentação de telas durante a migração

- **Evidência**: `FinancialPage` usa endpoints REST de confronto/reconciliação, enquanto `BillingPage/ReconciliationScreen` continua no Supabase; `EmbeddedFileManager` usa REST, mas `/documents` continua no Supabase; Payment Orders mistura leitura/criação REST com edição/pagamento/exclusão Supabase.
- **Constatação**: A migração foi executada por trechos técnicos, não por capacidades verticais completas. O mesmo domínio pode parecer operacional em uma tela e falhar silenciosamente em outra.

### 5.6 Backend ausente para módulos expostos

- **Constatação**: Frota, marketplace, automação genérica, IA operacional, consentimento/privacidade, soft delete/recuperação, credenciais temporárias, telemetria e partes de segurança/compliance não possuem equivalente Express/Prisma suficiente.
- **Exemplo crítico**: `FleetPage` expõe veículos, motoristas, atribuições, viagens, combustível, documentos e relatórios; somente a calculadora de rotas foi portada, sem persistência do domínio de frota.

### 5.7 Novas evidências de segurança

- **Extração pública**: `/api/extract/*` não aplica `requireAuth`, expondo consumo de IA/OCR.
- **Anexos fiscais**: `billingOperations.ts` grava data URL diretamente como `storagePath`, sem ciclo de vida de objeto MinIO.
- **Autorização**: `requireAdmin` do faturamento recusa `owner`; múltiplas rotas de pessoas, locais, clientes, OS e OP confiam no `workspace_id` ou ID fornecido pelo cliente.

---

## 6. Auditoria Estática de Contratos e Bugs — Fase 4A

### 6.1 Universo confrontado

- **Evidência consolidada**: `docs/audit/api-contracts-and-bugs.md`.
- **Contagem mecânica**: 189 endpoints Express em 26 famílias/arquivos; 226 call sites REST de primeira parte no frontend (219 `apiRequest()` + 7 `fetch()` diretos).
- **Resultado**: 29 bugs estaticamente confirmados, 8 hipóteses que requerem reprodução, 7 grupos de contratos divergentes e 9 capacidades chamadas sem endpoint Express equivalente.

### 6.2 Causa sistêmica dominante: tenant confiado ao cliente

- **Constatação**: autenticação JWT é aplicada em grande parte da API, mas não equivale a autorização por objeto. People, Locations, Platforms, ServiceOrder, ProductionOrder, PaymentOrder, Documents, Storage e grande parte de Finance aceitam workspace/IDs fornecidos pelo cliente sem demonstrar membership.
- **Impacto**: o risco não é uma coleção de falhas independentes; a raiz é a ausência de um contexto de tenant obrigatório e uniforme entre contrato, middleware, repositório Prisma e constraints.

### 6.3 Integridade transacional do ciclo operacional-financeiro

- **Constatação**: orçamento é local; OP entregue e WEEKLOG são commits separados; WEEKLOG validado e PaymentOrder/lista são commits separados; validação de reconciliação, ajuste financeiro e evento também são separados.
- **Contraponto**: o recálculo de regra de lucro/itens/distribuição usa `prisma.$transaction`, porém continua global porque os modelos de regra e distribuição não possuem `workspaceId`.
- **Impacto**: atomicidade local não compensa ausência de isolamento de tenant nem de invariantes relacionais/únicas.

### 6.4 Migração Supabase por trechos

- **Constatação**: 13 fluxos ainda ligados ao Supabase possuem substituto REST total ou parcial. Sete dependem de adaptação de contrato/modelagem; os casos de reconciliação, dashboard, técnico e convite exigem decisão de domínio, não simples troca de cliente HTTP.
- **Falha demonstrável**: `PaymentOrdersTable` usa o cliente noop para mutações apesar de existirem PATCH/DELETE REST, podendo exibir sucesso sem persistência.

### 6.5 Limite probatório

- **Não executado**: aplicação, banco, MinIO, Stripe, SMTP, IA, clima, mapas, concorrência ou exploração de acesso horizontal.
- **Regra aplicada**: nenhum stack trace foi afirmado; situações dependentes de timing/configuração foram rotuladas `HIPÓTESE DE BUG — REQUER REPRODUÇÃO`.

---

## 7. Validação do Handover e Preparação da Fase 4B

### 7.1 Secrets em texto puro e histórico Git

- **Evidência**: o handover confidencial contém credenciais reais em uma tabela; valores não foram copiados. `.env.development` preenchido permanece rastreado, e commits históricos possuem `.env` com variáveis preenchidas.
- **Classificação**: finding de segurança P0/P1 conforme o perímetro do segredo.
- **Limite**: `keys.txt` não foi localizado no checkout nem na busca nominal do histórico; a alegação do handover exige scanner completo de objetos/branches/artefatos.
- **Backlog**: rotação pós-handover, remoção de `keys.txt` onde existir, secret manager e verificação integral do histórico. Nenhuma rotação/reescrita foi executada.

### 7.2 Autorregistro com papel administrativo

- **Evidência**: `backend/src/routes/auth.ts:14-19,53-115` expõe `POST /auth/register` sem autenticação e aceita `role: "admin"`; `billingOperations.ts` usa esse papel em `requireAdmin`.
- **Constatação estática**: um cliente pode solicitar o papel global privilegiado durante autorregistro. A exploração não foi executada.
- **Prioridade preliminar**: P0; bootstrap do primeiro admin deve ser separado, uso único e auditável.

### 7.3 Ambiente não reproduzível pelo caminho documentado

- **Compose**: quatro serviços estão declarados, porém os contextos de API/frontend são caminhos absolutos inexistentes localmente.
- **Prisma**: Dockerfile gera o client e inicia a API, mas não aplica schema; existe apenas uma migration incremental, insuficiente para banco vazio.
- **Runtime local**: Node/npm e Docker CLI existem; daemon Docker está parado, dependências não estão instaladas e `.env`/`backend/.env` não existem.
- **Consequência**: Fase 4B é condicionalmente viável em laboratório descartável usando build contexts locais e `prisma db push` somente local; ainda não está pronta.

### 7.4 Divergências do handover

- “Supabase não é mais utilizado” diverge dos 48 importadores frontend e dos fluxos funcionais já catalogados.
- MinIO, JWT, Stripe, SMTP, IA, ORS e clima estão implementados estaticamente; operação/credenciais continuam `REQUER RUNTIME`.
- O worker meteorológico usa `setInterval` dentro da API, após 8 segundos e a cada 15 minutos, sem eleição de líder nem flag de desativação.
- NASA/Meteostat aparecem na configuração, mas não são consumidos pelo worker atual; os nomes Stripe/Tomorrow do handover também não coincidem integralmente com o contrato do código.

### 7.5 Entregáveis de preparação

- `docs/audit/handover-validation.md`: comparação, secrets por nome, blockers, comandos e dataset.
- `docs/audit/runtime-test-plan.md`: casos A-L com pré-condições, usuário/workspace, esperado, evidência, risco, mutação e rollback.
- **Status**: nenhum teste 4B foi executado; nenhum código de produto ou Dockerfile foi alterado.

---

## 8. Segurança, Performance e Dívida Técnica — Fase 5A

### 8.1 Resultado consolidado

- **Fonte detalhada**: `docs/audit/security-performance-and-technical-debt.md`.
- **Segurança**: 26 achados — 11 `VULNERABILIDADE ESTATICAMENTE CONFIRMADA`, 13 `RISCO ESTÁTICO` e 2 `REQUER REPRODUÇÃO 4B`.
- **Performance**: 18 achados — 9 `GARGALO ESTATICAMENTE IDENTIFICADO`, 7 `RISCO DE PERFORMANCE` e 2 `REQUER BENCHMARK 4B`.
- **Dívida técnica**: 28 itens agrupados em D1 Arquitetura, D2 Modelagem, D3 Segurança, D4 Manutenibilidade, D5 Testes/Observabilidade, D6 Infraestrutura/Deploy e D7 Migração/Legado.
- **Limite probatório**: análise integralmente estática; nenhum endpoint, container, provedor ou credencial foi utilizado.

### 8.2 Autorregistro e escalada de papel

- **Evidência**: `POST /auth/register` é público, aceita `admin`, persiste esse papel em `User`/`UserRole` e devolve JWT. O middleware relê o papel global no banco.
- **Evidência adicional**: a edição de `Membership.role` também atualiza `User.role` e `UserRole`, acoplando autoridade local e global.
- **Classificação**: vulnerabilidades estaticamente confirmadas P0. A extensão concreta sobre fixtures e provedores permanece `REQUER REPRODUÇÃO 4B`.
- **Impacto Fase 2**: precede qualquer feature; requer bootstrap administrativo separado e papéis de plataforma/workspace independentes.

### 8.3 Causa sistêmica de multi-tenancy

- **Matriz**: 16 dos 20 domínios prioritários têm isolamento inadequado; `Membership` e `BillingInvoice` são parciais; `Workspace` é adequado; `Settings` é isolado por usuário, mas semanticamente desalinhado com empresa/workspace.
- **Causa raiz**: IDs e `workspaceId` controlados pelo cliente, política que calcula `own/team/all` sem aplicar escopo, consultas Prisma não condicionadas ao tenant e chaves opcionais/globais.
- **Decisão arquitetural necessária**: `TenantContext` resolvido no servidor, negação por padrão, autorização de objeto, camada de dados tenant-scoped, constraints compostas e plano de plataforma separado.

### 8.4 Superfícies críticas adicionais

- **Financeiro**: reconciliação apaga e recalcula dados globalmente; também concentra consultas completas e matching em memória.
- **Documentos/Storage**: metadados e objetos não têm ownership uniforme; JWT em query pode chegar a access logs; upload e JSON usam grandes buffers em memória.
- **OCR/IA e clima**: extração pública sem quota e ingestão/logs meteorológicos disponíveis a qualquer autenticado.
- **Stripe**: assinatura do webhook é validada; idempotência persistente do event ID não foi localizada e deve ser testada apenas em sandbox.
- **Sessão**: bcrypt e reset têm controles positivos, mas `localStorage`, ausência de rate limit e hardening incompleto mantêm risco.

### 8.5 Secrets e supply chain

- **Segredos do handover**: `SEGREDO ATIVO DESCONHECIDO`; nenhum valor foi copiado ou testado.
- **Configuração frontend**: `VITE_*`, DSN e hosts públicos não devem ser classificados como senha, mas precisam de governança de ambiente e egress.
- **Backlog obrigatório**: rotação pós-handover, remoção de `keys.txt` onde existir, secret manager, secret scanning e verificação do histórico Git.
- **Supply chain**: não foi localizado gate CI/SCA; builds Docker não são totalmente determinísticos e imagens/dependências precisam de pinning/política.

### 8.6 Gargalos e hotspots

- **Backend**: N+1 em People e ServiceOrder; GET com escrita; reconciliação global/quadrática; billing com transação por linha; clima sequencial; PDF/base64 e uploads em memória; batch sem limite.
- **Frontend**: telas de 1,6k–4,5k linhas, polling duplicado, dependências pesadas e 1.124 ocorrências de `any`; bundle exige benchmark, não estimativa inventada.
- **Testes**: nenhum teste backend localizado; frontend tem 3 arquivos/9 testes e não há gate de segurança/tenant/contrato/performance.
- **Operação**: scheduler está no processo HTTP sem flag, lock, eleição de líder ou proteção de overlap; health/readiness é parcial.

### 8.7 Impacto na Fase 2

- **Antes de novas features (A)**: autoridade/tenant, storage/documentos/financeiro, autorregistro, secrets, baseline Prisma, testes backend/CI e scheduler.
- **Durante estabilização (B)**: hardening JWT, convites, billing/PDF, paginação/N+1, bundle/polling, tipagem e observabilidade.
- **Postergável (C)**: somente melhorias sem efeito em fronteira de segurança, integridade ou reprodutibilidade; nenhum P0 se enquadra.
- **Evolução (D)**: capacidades novas depois de estabilizar as fundações; não substituem correções do estado atual.

### 8.8 Testes prioritários para 4B

Autorregistro privilegiado, papel local→global, matriz A→B dos 16 domínios, reconciliação isolada, colisão/idempotência OP→WEEKLOG→PaymentOrder, documento/storage, replay Stripe sandbox, limites controlados de payload, scheduler com duas réplicas, query count/memória e telemetria/redaction. Todos em dados descartáveis; nenhum em produção.

---

## 9. Consolidação do Target State do Cliente — Fase 5C

### 9.1 Nova fonte primária

- **Fonte**: `docs/Relatorio_Plano_de_Ataque_QW_Nexus.pdf`, produzido por Alex como especificação para implementação, 14 páginas.
- **Tratamento probatório**: o conteúdo define TARGET STATE e prioridade do cliente. Afirmações de que algo funciona, existe ou está indisponível não substituem evidência do CURRENT STATE.
- **Entregável**: `docs/audit/client-target-state.md`.

### 9.2 Requisitos extraídos

- **Total**: 53 requisitos rastreáveis.
- **Classificação**: 7 `CORREÇÃO / RESTAURAÇÃO`; 18 `EVOLUÇÃO`; 14 `REDESENHO`; 13 `PRESERVAR / NÃO ALTERAR`; 1 `REQUER CONFIRMAÇÃO`.
- **Prioridade do cliente**: sequência 01–10 preservada separadamente das dependências técnicas G1–G9.
- **Impacto 5A**: 40 requisitos que implicam mudança ou confirmação dependem de pelo menos um gate estrutural; os 13 de preservação são restrições de mudança e vários ainda exigem runtime para provar o comportamento atual.

### 9.3 Evidências current×target relevantes

- **Produção**: botão “Nova Ordem”, POST e estados existem estaticamente; indisponibilidade declarada exige 4B. O timeline é estaticamente quebrado porque `useProductionTimeline` está desabilitado e retorna lista vazia.
- **Empresas/workspaces**: o hook suporta múltiplos workspaces e há switcher no TopBar, mas não existe aggregate `Company`; `CompanySetting` pertence ao usuário e o isolamento multi-tenant permanece inadequado.
- **Acesso sem empresa**: sidebar filtra permissões, não existência de workspace; módulos não são ocultados conforme o target.
- **Colaboradores**: `Person` mistura internos, técnicos e prestadores e não tem o catálogo/campos completos desejados.
- **Utilizadores**: o comportamento atual já não cria automaticamente Person e User entre si; o target confirma que essa ausência de auto-sync deve ser preservada.
- **Documentos**: catálogo por país existe e deve permanecer; file manager REST é reutilizável, mas ownership/storage e a tela global ainda estão incompletos.
- **Locais**: CRUD, endereço, contato e gerente existem; faltam GPS/link, estados Pausado/Encerrado, tenant forte e vínculo com o mapa. O desaparecimento após salvar requer runtime.
- **Mapa**: existe um único `OperationalMap` com toggles. Operações/Ordens usam ServiceOrder, tabela de cidades e jitter, não GPS real de Location; Equipes depende de eventos de geolocalização sem isolamento comprovado.

### 9.4 Substituições e contradições

- A nova fonte substitui a hipótese anterior de **sincronização automática** Colaborador↔Utilizador. Os fluxos devem permanecer separados nos dois sentidos.
- O vínculo manual/opcional futuro não foi decidido e não deve ser inferido.
- A ausência de auto-sync deixa de ser gap funcional; a fragmentação entre IDs/modelos continua dívida técnica.
- “Preservar o que funciona” é requisito de não regressão, mas o inventário encontrou 0 itens comprovados `FUNCIONAL`; realtime legado permanece inativo.
- “Nova Ordem indisponível” conflita com a presença estática de botão/handler e precisa de 4B; “log existente” conflita com o hook desabilitado e é bug estático.
- A exigência multiempresa contradiz comentários/partes single-workspace e exige empresa/configuração por workspace.
- Cliente dentro de Utilizadores não resolve a entidade canônica entre `Client`, `BillingClient` e identidade de acesso.

### 9.5 Open Questions revisadas

- **5 respondidas por Alex**: sem auto-sync; mapa único; preservar Documentos por País; acesso sem empresa; OP direta sem orçamento.
- **4 parcialmente respondidas**: autoridade Operix×tenant, latência/realtime, destino dos módulos legados e telas de atualização imediata.
- **23 continuam abertas**, incluindo cliente canônico, WEEKLOG, regra financeira do técnico, reconciliações, falha parcial, retenção documental, versões/aprovações PDR e permissões detalhadas.
- **21 não são perguntas para o cliente**: 12 decisões ENGINEERING e 9 políticas SECURITY.

### 9.6 Limite da fase

Até o encerramento da Fase 5C, nenhum código, schema, dado ou integração havia sido alterado e as Fases 4B/5B permaneciam não executadas; a Fase 6 subsequente está registrada na seção 10.

---

## 10. Gap Analysis Current State × Target State — Fase 6

### 10.1 Cobertura e classificação

- **Evidência consolidada**: `docs/audit/gap-analysis.md`.
- **Completude**: 53/53 requisitos `CTS-001`–`CTS-053` analisados individualmente.
- **Categoria principal**: 4 `SEM GAP MATERIAL`, 2 `BUG / RESTAURAÇÃO`, 6 `MIGRAÇÃO INCOMPLETA`, 5 `IMPLEMENTAÇÃO PARCIAL`, 8 `NÃO IMPLEMENTADA`, 14 `REQUER REDESENHO`, 3 `REQUER DECISÃO DE NEGÓCIO` e 11 `REQUER VALIDAÇÃO RUNTIME`.
- **Impacto/reuso**: 31 gaps estruturais; reutilização em 19 ALTA, 22 MÉDIA, 11 BAIXA e 1 INDETERMINADA SEM RUNTIME.

### 10.2 Causa estrutural predominante

- **Constatação**: G7 aparece em 52 CTS, G3 em 45 e G4 em 35. O catálogo depende mais de teste de regressão, `TenantContext` e baseline Prisma do que da ordem visual 01–10 indicada pelo cliente.
- **Conclusão**: 31 CTS não podem ser tratados isoladamente porque afetam autoridade, tenancy, modelo canônico, persistência, segurança, infraestrutura ou fluxo financeiro central.
- **Limite**: a prioridade de Alex é prioridade de produto; não constitui sequência técnica executável.

### 10.3 Fundação, migração e evolução

- **Fundação**: bootstrap administrativo, separação de papel global/workspace, `TenantContext`, baseline Prisma, ownership documental e testes.
- **Migração**: orçamento em `localStorage/notes`, documentos/Supabase noop, telemetria de equipes, preço manual e fluxos híbridos devem ser fechados por fatias verticais.
- **Evolução**: PDR por peça, dano, IA visual, validação humana e documentos multilíngues não podem ser tratados como bugs do produto atual.
- **Preservação**: ausência de auto-sync Colaborador↔Utilizador, mapa único e não remodelagem de Documentos por País permanecem restrições explícitas.

### 10.4 BUSINESS e 4B

- **Decisões**: 33 CTS cruzam alguma decisão BUSINESS aberta; em 3 (`CTS-006`, `CTS-023`, `CTS-049`) a decisão impede fechar o desenho e é a categoria principal.
- **Runtime**: 18 CTS possuem evidência pendente na 4B, mas somente 11 têm runtime como gap principal. Os demais já possuem gap estático, usando G9 apenas para medir comportamento/regressão.
- **Casos sensíveis ao runtime**: criação/estado de OP, troca de contexto, status/acesso, persistência de documentos/locais e layers do mapa podem alterar escopo ou prioridade; 4B não resolve domínio nem segurança estrutural.

### 10.5 Clusters preparados

Foram definidos, sem cronograma ou estimativa: F0 Fundação multiempresa e segurança; F1 Produção; F2 Pessoas/utilizadores/clientes; F3 Documentos/storage; F4 Locais/mapa/radar; F5 PDR/IA/preço; F6 White-label/multilíngue; F7 Portfólio legado/secundário. F7 não possui CTS dedicado e depende de P02, evitando transformar módulos órfãos em compromisso implícito.

### 10.6 Limite da fase

A Fase 6 foi exclusivamente documental e estática. Não foram executadas 4B/5B, runtime, migrations, correções, implementação, escolha arquitetural dependente de BUSINESS, estimativa, cronograma ou proposta comercial.

---

## 11. Decision Brief + Minimum Viable 4B — Fase 6.5

### 11.1 Premissas EverGreen e decisões de Alex

- **Regra probatória**: as novas formulações são `PREMISSA EVERGREEN — VALIDAR COM CLIENTE`; não alteram evidências técnicas nem recebem status “respondida por Alex”.
- **Premissas autônomas para validação**: cliente conceitualmente único (B01), WEEKLOG como consolidação semanal (B06), retenção documental mínima de 180 dias (B09) e gerente do Local como Colaborador (B13).
- **Premissas embutidas em decisões**: autor da ficha/cliente aprovador PDR, autoridade do gestor sobre valor técnico, fluxo financeiro interligado e owner/admin com controle do próprio workspace.
- **Decisões ainda necessárias**: seis — falha OP→WEEKLOG/lista, versão PDR após aprovação, congelamento/reabertura do valor técnico, validação/reabertura da reconciliação, poderes Operix sobre tenants e acesso após desligamento.
- **Não bloqueantes**: B12 já foi respondida; B10 e o restante de B11 podem ser refinados durante implementação.

### 11.2 Redução da Fase 4B

- **Fonte completa**: `docs/audit/runtime-test-plan.md`, 74 casos.
- **Plano mínimo**: `docs/audit/minimum-runtime-validation.md`, 4 cenários consolidados cobrindo os 14 CTS priorizados pela Fase 6.
- **Antes da proposta**: MV4B-01 Produção, MV4B-02 empresa ativa/acesso e MV4B-03 persistência cadastral.
- **Se houver laboratório**: MV4B-04 mapa/Radar/camadas.
- **Demais 70 casos**: preservados para seleção durante implementação ou validações 4B/5B futuras; não são requisito automático de proposta.

### 11.3 Preparação da Fase 7

- **Fecháveis no macro**: F3 Documentos/storage e F6 White-label/multilíngue, sem esforço final e ainda sujeitos à confirmação das premissas aplicáveis.
- **Condicionais**: F0, F1, F2, F4, F5 e F7 por decisões, runtime mínimo ou decisão de portfólio.
- **Priorização já sustentada por evidência estática**: P0 para confiança/tenant/baseline/ownership/testes; P1 candidato para bugs e migrações do produto atual; P2 candidato para evolução local sem impacto de segurança/integridade.
- **Não autorizada**: estimativa, prazo e arquitetura definitiva dos blocos condicionais.

### 11.4 Limite

Até a Fase 6.5, nenhum teste havia sido executado, nenhum código/schema/dado havia sido alterado e nenhuma Fase 4B, 5B ou 7 havia sido iniciada.

---

## 12. Backlog Consolidado, Roadmap e Diagnóstico Final — Fase 7

### 12.1 Resultado consolidado

- **Entregáveis**: `docs/audit/stabilization-and-evolution-roadmap.md` e `docs/audit/final-diagnostic-report.md`.
- **Backlog**: 40 itens — 29 de estabilização/correção e 11 de evolução.
- **Prioridades**: 10 P0, 19 P1, 10 P2 e 1 P3.
- **Estrutura**: Foundation 0/1, cinco verticais, duas evoluções e uma decisão de portfólio.
- **Método**: cada item material contém status atual, evidência, causa raiz, impacto, correção proposta, target state, critério de aceite, dependências, prioridade, esforço e confiança.

### 12.2 Conclusão arquitetural

A Operix possui completude visual superior à completude funcional/arquitetural. Isso decorre da coexistência de REST/Prisma material, 45 fluxos funcionais relacionados ao Supabase, façade noop, estado/localStorage, serialização em `notes`/JSON e módulos sem backend equivalente. Não é correto afirmar que todo o sistema é frontend; também não é correto chamar uma função de produção apenas porque a UI reage.

### 12.3 Decisão recuperar versus reescrever

Recomenda-se recuperar e redesenhar seletivamente por fatias verticais, não reescrever integralmente. UI, API, modelos e integrações oferecem reutilização material; a fundação de autoridade, tenant, banco, testes e ownership deve preceder evolução. Cada fatia fecha UI→API→autorização→modelo→persistência→migração→integrações→testes→retirada do legado correspondente.

### 12.4 Limite probatório final

O acesso manual posterior às fases estáticas forneceu evidência complementar de superfícies visuais, persistência heterogênea e ruído de console, sem generalização por módulo. A 4B/5B integral não foi executada. Permanecem recomendados MV4B-01 Produção, MV4B-02 empresa/acesso e MV4B-03 persistência cadastral no início da implementação; MV4B-04 mapa é recomendada se houver laboratório. Nenhum achado estrutural de autoridade, tenant, baseline, ownership ou domínio canônico depende desses testes para existir.

### 12.5 Estado final

**FASE 7 — CONCLUÍDA. DIAGNÓSTICO CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS.** Nenhum código de produto, schema, migration, dado, deploy, secret ou integração foi alterado nesta fase.
