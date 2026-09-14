# Inventário Funcional Brownfield — Operix

**Fase**: 3 — Current State & Root Cause  
**Data**: 2026-09-05  
**Status**: Concluída  
**Escopo**: diagnóstico somente; nenhum código de produto, schema ou infraestrutura foi alterado.

## 1. Critério e limites da avaliação

O inventário combina quatro camadas de evidência: rota/componente de UI, chamada efetiva do frontend, contrato/implementação da API e persistência. A classificação considera ainda a possibilidade de validar o fluxo em runtime:

- `FUNCIONAL`: fluxo ponta a ponta executado com sucesso no ambiente desta auditoria.
- `PARCIAL`: existe implementação material, mas uma parte necessária do fluxo está ausente, fragmentada ou comprovadamente inconsistente.
- `QUEBRADA`: há evidência estática de chamada inócua, contrato inexistente ou dependência não portada que impede o comportamento esperado.
- `SOMENTE UI`: estado/comportamento permanece no navegador e não constitui uma capacidade persistida do produto.
- `NÃO LOCALIZADA`: requisito esperado sem implementação identificável no repositório.
- `NÃO TESTADA`: cadeia estática coerente, porém não executável neste ambiente.

`NÃO TESTADA` não significa funcional. Pela definição estrita acima, nenhuma funcionalidade recebeu `FUNCIONAL`, pois não havia dependências instaladas, serviços ativos ou credenciais locais. A análise de causa segue princípios de diagnóstico brownfield e migração incremental (Strangler Fig); os critérios de qualidade e risco foram orientados por ISO/IEC 25010 e OWASP API Security Top 10 2023, especialmente compatibilidade, confiabilidade, segurança e autorização em nível de objeto.

### 1.1 Recuperação do estado existente

- Branch `main`, sincronizada com `origin/main` no início da Fase 3.
- `git status --short` indicava apenas `?? docs/audit/`; não havia diff rastreado nos artefatos da especificação.
- Foram lidos antes da análise: `spec.md`, `plan.md`, `tasks.md`, `findings.md`, `open-questions.md`, `repository-inventory.md` e `architecture-and-data-model.md`.
- Este relatório continua as Fases 1 e 2; não repete inventário estrutural nem altera decisões anteriores.

### 1.2 Evidência de runtime

| Verificação | Resultado | Consequência |
|---|---|---|
| `.env` raiz e `backend/.env` | Ausentes | Sem credenciais/configuração para banco, JWT, MinIO, SMTP, Stripe, IA, clima e mapas. |
| `node_modules` raiz/backend | Ausentes | Frontend, backend e testes não puderam ser iniciados sem instalar dependências. |
| Docker daemon | Indisponível; pipe do engine não encontrado | A composição local não pôde provisionar PostgreSQL, MinIO e aplicações. |
| `http://localhost:4000` e `:8080` | Timeout | Nenhuma API/UI ativa para ensaio ponta a ponta. |
| Testes automatizados | 3 arquivos frontend; nenhum backend | Cobertura insuficiente para substituir validação funcional em runtime. |

## 2. Resultado consolidado

| Status | Total | Percentual |
|---|---:|---:|
| `FUNCIONAL` | 0 | 0,0% |
| `PARCIAL` | 28 | 21,4% |
| `QUEBRADA` | 36 | 27,5% |
| `SOMENTE UI` | 4 | 3,1% |
| `NÃO LOCALIZADA` | 3 | 2,3% |
| `NÃO TESTADA` | 60 | 45,8% |
| **Total** | **131** | **100%** |

Na coluna `Mig.`, as marcações significam: **A** = frontend ainda usa Supabase, mas já existe capacidade REST equivalente; **B** = backend/domínio persistente ausente; **C** = capacidade encontrada apenas no legado Supabase; **D** = fluxo órfão ou migração mista que exige decisão de domínio/contrato. Célula vazia indica que o bloqueio principal não é uma migração Supabase funcional.

## 3. Matriz funcional

### 3.1 Autenticação, workspace e autorização

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F001 | Login | `useAuth` → REST | `/auth/login`; User/JWT | indisponível | NÃO TESTADA | Cadeia coerente sem banco/JWT ativos. | |
| F002 | Registro | `useAuth` → REST | `/auth/register`; User | indisponível | NÃO TESTADA | Não executável sem banco. | |
| F003 | Recuperar/redefinir senha | telas e token REST | `/auth/recover`, `/auth/reset-password` | indisponível | NÃO TESTADA | SMTP/configuração não validada. | |
| F004 | Alterar senha | perfil → REST | `/auth/change-password` | indisponível | NÃO TESTADA | Sessão e banco ausentes. | |
| F005 | Perfil e sessão | `useAuth`/Profile | `/auth/me`; User/Profile | indisponível | NÃO TESTADA | Cadeia coerente, sem runtime. | |
| F006 | Onboarding de workspace | telas → REST | `/workspaces`; Workspace/Membership | indisponível | NÃO TESTADA | Cadeia não executada. | |
| F007 | Contexto/troca de workspace | `useWorkspace` → REST | memberships/workspaces | indisponível | NÃO TESTADA | Sessão ausente. | |
| F008 | Listar membros | UsersPage → REST | `/workspaces/:id/members` | indisponível | NÃO TESTADA | Contrato localizado. | |
| F009 | Criar membro/senha temporária | UsersPage → REST | members + credencial | indisponível | NÃO TESTADA | Envio/uso da credencial não validado. | |
| F010 | Alterar papel de membro | UsersPage → REST | member role | indisponível | NÃO TESTADA | RBAC não testado. | |
| F011 | Convites REST | Topbar/diálogos → REST | invites create/accept/reject/cancel | indisponível | NÃO TESTADA | Fluxo principal localizado. | |
| F012 | Deep link `/join` | `JoinPage` usa Supabase | rota não registrada em `App.tsx` | bloqueado | QUEBRADA | Página inalcançável e contrato legado inócuo. | A |
| F013 | Permissões por papel | editor → REST | roles/permissions | indisponível | NÃO TESTADA | Contrato base localizado. | |
| F014 | Permissões por usuário | `UserPermissionsDialog` → Supabase | tabelas/RPC não portadas | bloqueado | QUEBRADA | Façade noop devolve sucesso/vazio sem persistir. | C |

### 3.2 Pessoas, clientes, locais e documentos cadastrais

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F015 | Listar pessoas | `PeoplePage`/`usePeople` → REST | `/people`; Person | indisponível | PARCIAL | API não isola por workspace. | |
| F016 | CRUD de pessoas | formulários → REST | `/people`; Person | indisponível | PARCIAL | `workspace_id` é confiado ao cliente; IDOR/BOLA. | |
| F017 | Documentos de identidade | painéis → REST/MinIO | `/people/:id/documents` | indisponível | PARCIAL | Exclusão de metadado não remove objeto e falta escopo. | |
| F018 | Anexos de compliance | `PersonDocumentsPanel` | REST + MinIO | indisponível | PARCIAL | Ciclo de vida do objeto é incompleto. | |
| F019 | Vínculo pessoa–usuário | campos separados | `systemAccessUserId` opcional | indisponível | PARCIAL | Sem relação forte ou sincronização transacional. | D |
| F020 | OCR de fatura para cadastro | diálogo de importação | `/extract/invoice` | indisponível | NÃO TESTADA | Provedor IA/credencial ausente. | |
| F021 | Listar clientes fiscais | `ClientsScreen` → REST | `/billing/admin/ops/clients` | indisponível | PARCIAL | `owner` é recusado por verificação estrita de `admin`. | |
| F022 | CRUD de clientes fiscais | `ClientsScreen` → REST | BillingClient | indisponível | PARCIAL | Operações por ID sem autorização tenant robusta. | |
| F023 | Anexos de cliente | tela envia data URL | BillingAttachment | indisponível | PARCIAL | Data URL é gravada como `storagePath`; não usa MinIO. | |
| F024 | Seleção de cliente operacional | telas usam Client/BillingClient | três modelos concorrentes | indisponível | PARCIAL | Identidade de cliente fragmentada e sem sincronização. | D |
| F025 | Listar locais | `LocationsPage`/hook → REST | `/locations`; Location | indisponível | PARCIAL | Consulta não filtra workspace. | |
| F026 | CRUD de locais | formulários → REST | `/locations`; Location | indisponível | PARCIAL | Escopo tenant vem do payload/ID. | |
| F027 | Requisitos documentais por país | página/hook → REST | country document requirements | indisponível | NÃO TESTADA | Contrato localizado, runtime ausente. | |

### 3.3 Orçamento e vistoria PDR

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F028 | CRUD de orçamento | `BudgetPanel` → `localStorage` | sem entidade no Prisma | navegador | SOMENTE UI | Orçamento não é persistido no backend. | |
| F029 | Cálculo PDR manual | estado React/`localStorage` | sem contrato de domínio | navegador | SOMENTE UI | Regra permanece no cliente. | |
| F030 | Aprovação/assinatura | estado local | sem trilha/auditoria no banco | navegador | SOMENTE UI | Aprovação não é evidência transacional. | |
| F031 | PDF de orçamento | gerador client-side | arquivo local | indisponível | NÃO TESTADA | Existem testes unitários, mas execução não disponível. | |
| F032 | OCR de ordem de produção | `BudgetDialog` → REST | `/extract/production-order` | indisponível | PARCIAL | Extração existe, mas endpoint não exige autenticação. | |
| F033 | Converter orçamento em OP | `BudgetPanel` → REST | ProductionOrder; orçamento em `notes` | indisponível | PARCIAL | Sem modelo de orçamento; dados estruturados serializados em texto. | |
| F034 | Retorno para correção | ação local/atualização de OP | ProductionOrder | indisponível | PARCIAL | Estado de orçamento e OP não compartilha máquina de estados persistida. | |
| F035 | Ficha visual por peça | não localizada | não localizada | n/a | NÃO LOCALIZADA | Não há mapa visual persistente de peças/danos. | |
| F036 | Fotos vinculadas por peça | não localizada | não localizada | n/a | NÃO LOCALIZADA | Fotos de produção não possuem vínculo de peça PDR. | |
| F037 | Estimativa IA por foto | não localizada | não localizada | n/a | NÃO LOCALIZADA | OCR documental não equivale a estimativa visual de danos. | |

### 3.4 Produção

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F038 | Quadro/lista de OPs | página/hooks → REST | `/production-orders` | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F039 | CRUD de OP | diálogos/hooks → REST | ProductionOrder | indisponível | NÃO TESTADA | Banco/API não executados. | |
| F040 | Alteração de status | UI → REST | ProductionOrder.status | indisponível | NÃO TESTADA | Máquina de estados não validada. | |
| F041 | Etapas de execução | `OrderDetailDialog` | serializadas em `notes` | indisponível | PARCIAL | Estrutura operacional sem modelo/contrato próprio. | D |
| F042 | Galeria de fotos | hook → REST/MinIO | ProductionPhoto | indisponível | NÃO TESTADA | Cadeia estática completa. | |
| F043 | Entrega gera WEEKLOG | update de OP | `upsertWeeklogFromProduction` | indisponível | PARCIAL | Falha do hook é capturada; entrega confirma sem WEEKLOG, sem transação. | |
| F044 | Excluir/retornar OP | UI → REST | delete/update ProductionOrder | indisponível | NÃO TESTADA | Fluxo não executado. | |
| F045 | Isolamento tenant em OP | hooks/API | ProductionOrder.workspaceId | indisponível | PARCIAL | Backend confia `workspace_id` e IDs do cliente. | |

### 3.5 WEEKLOG e listas operacionais

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F046 | Importar WEEKLOG por OCR | `ServiceOrdersPage` → REST | `/extract/service-order` | indisponível | NÃO TESTADA | Provedor IA não configurado. | |
| F047 | Listar/criar WEEKLOG | página → REST | ServiceOrder | indisponível | PARCIAL | Lista aceita workspace do cliente sem comprovar membership. | |
| F048 | Editar WEEKLOG | tabela/diálogo → REST | ServiceOrder | indisponível | PARCIAL | Atualização por ID sem isolamento horizontal suficiente. | |
| F049 | Checklist de validação | UI → REST | campos de ServiceOrder | indisponível | NÃO TESTADA | Contrato localizado. | |
| F050 | Validação gera lista de pagamento | update → hook backend | ServiceOrder/PaymentList | indisponível | PARCIAL | Ganhos do técnico ainda vêm do Supabase e falha derivada não reverte validação. | A |
| F051 | Documentos embutidos | `EmbeddedFileManager` → REST | Document + MinIO | indisponível | NÃO TESTADA | Cadeia REST localizada. | |
| F052 | Fotos herdadas da produção | vínculos OP/OS | ProductionPhoto/ServiceOrder | indisponível | PARCIAL | Identidade WEEKLOG/OS e vínculo dependem de texto/chaves frágeis. | |
| F053 | Excluir por ano | ação de página → REST | exclusão em lote | indisponível | PARCIAL | Autorização e atomicidade não verificadas. | |
| F054 | Agregação de lista de produção | página/hook → REST | ProductionList | indisponível | NÃO TESTADA | Contrato localizado. | |
| F055 | Detalhe de lista | tela → REST | ProductionList/items | indisponível | NÃO TESTADA | Sem runtime. | |
| F056 | Status do workflow | UI/hook → REST | status persistido | indisponível | NÃO TESTADA | Há teste isolado, não ponta a ponta. | |
| F057 | Ler/criar lista de pagamento | hooks parcialmente REST | PaymentList | indisponível | PARCIAL | Partes auxiliares ainda dependem de Supabase. | A |

### 3.6 Pagamentos, confronto, reconciliação e faturamento

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F058 | Editar ordem de pagamento | tabela → Supabase | REST equivalente existe | bloqueado | QUEBRADA | Mutação resolve via noop sem persistir. | A |
| F059 | Pagar/lote de pagamentos | tabela → Supabase | REST equivalente existe | bloqueado | QUEBRADA | Falso sucesso silencioso. | A |
| F060 | Excluir em lote | `assertedDelete` → Supabase | REST delete existe | bloqueado | QUEBRADA | Exclusão não alcança backend. | A |
| F061 | Ações legadas de discrepância | hook chama `/extract/detect-discrepancies` e `/discrepancies` | endpoints inexistentes; novos ficam em `/finance` | bloqueado | QUEBRADA | Contrato do frontend divergiu após migração. | A |
| F062 | Candidatos, mesclar e rejeitar confronto | `FinancialPage` → REST | `/finance/confrontation/*` | indisponível | NÃO TESTADA | Cadeia coerente. | |
| F063 | Pendências, validação e histórico | `FinancialPage` → REST | confrontation pending/validate/history | indisponível | NÃO TESTADA | Sem runtime. | |
| F064 | Reconciliação automática/manual | tela → REST | `/finance/reconciliations/*` | indisponível | NÃO TESTADA | Contratos localizados. | |
| F065 | Corrigir/limpar reconciliação | tela → REST | reconciliation update/clear | indisponível | NÃO TESTADA | Não executado. | |
| F066 | Tela legada de reconciliação no Billing | `ReconciliationScreen` → Supabase | REST financeiro existe | bloqueado | QUEBRADA | Tela paralela permanece ligada ao noop. | A |
| F067 | CRUD de faturas | Billing UI → REST | BillingInvoice | indisponível | PARCIAL | `owner` pode ser bloqueado por `requireAdmin`. | |
| F068 | Importar fatura por OCR | diálogo → REST | `/extract/invoice` | indisponível | NÃO TESTADA | IA/credencial ausente; endpoint público. | |
| F069 | Gerar PDF de fatura | tela → REST | endpoint PDF | indisponível | NÃO TESTADA | Renderizador/armazenamento não executados. | |
| F070 | Enviar fatura por e-mail | tela → REST | SMTP/log de envio | indisponível | NÃO TESTADA | SMTP ausente. | |
| F071 | Pagamentos administrativos | Billing UI → REST | billing payments CRUD | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F072 | Próximos vencimentos/lembretes | telas → REST | reminders/upcoming | indisponível | NÃO TESTADA | Scheduler/SMTP não validados. | |
| F073 | Relatórios PDF/e-mail | Billing UI → REST | reports | indisponível | NÃO TESTADA | Dependências externas ausentes. | |

### 3.7 Financeiro e contabilidade

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F074 | Regras de lucro | tela → REST | ProfitRule/ProfitRuleItem | indisponível | PARCIAL | Escopo tenant e precedência das regras são frágeis. | |
| F075 | Snapshot de repartição | UI principal REST; auxiliares Supabase | ServiceOrderDistribution | indisponível | PARCIAL | Migração mista e imutabilidade não demonstrada em runtime. | A |
| F076 | Resumo/detalhe de participante | tela → REST | distributions/participants | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F077 | Detalhe financeiro do técnico | tela → REST | FinancialRecord | indisponível | PARCIAL | Payload às vezes omite workspace e serializa estrutura em categoria/notas. | |
| F078 | Lançamentos contábeis manuais | módulos → REST | accounting entries | indisponível | NÃO TESTADA | Contrato localizado. | |
| F079 | Espelho contábil de combustível | hook retorna lista vazia | modelos/rotas de frota ausentes | bloqueado | QUEBRADA | Capacidade deliberadamente desativada até porte de frota. | B |
| F080 | OCR e gravação de recibo | tela → REST | `/extract/receipt` + accounting | indisponível | NÃO TESTADA | IA não configurada. | |
| F081 | Integridade financeira | tela → REST | snapshots/issues | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F082 | Análise financeira por IA | tela → REST | endpoint financeiro | indisponível | NÃO TESTADA | Credencial IA ausente. | |

### 3.8 Granizo, mapas e frota

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F083 | Mapa/eventos de granizo | Dashboard/OperationalMap → REST | `/weather/hail-events`; HailEvent | indisponível | NÃO TESTADA | Mapas e dados externos não executados. | |
| F084 | Ingestão meteorológica | admin/serviço → REST | `/weather/ingest` | indisponível | NÃO TESTADA | Tomorrow.io/NOAA sem credenciais. | |
| F085 | Relatório de granizo | tela → REST | `/weather/reports` | indisponível | NÃO TESTADA | Sem runtime. | |
| F086 | Radar/chuva | mapa/provedor externo | backend weather | indisponível | NÃO TESTADA | Chaves e rede indisponíveis. | |
| F087 | Telemetria de geolocalização | `useGeolocation` → Supabase | sem POST REST equivalente | bloqueado | QUEBRADA | Evento é descartado pelo noop. | B |
| F088 | Indicador realtime | Dashboard exibe “Realtime activo” | Supabase realtime desabilitado | bloqueado | SOMENTE UI | Texto não representa canal realtime ativo. | |
| F089 | Veículos | módulo → Supabase | modelo/rota ausentes | bloqueado | QUEBRADA | Domínio de frota não portado. | B |
| F090 | Motoristas | módulo → Supabase | modelo/rota ausentes | bloqueado | QUEBRADA | Backend ausente. | B |
| F091 | Atribuições | módulo → Supabase | modelo/rota ausentes | bloqueado | QUEBRADA | Backend ausente. | B |
| F092 | Viagens e rotas | módulo misto/Supabase function | só calculadora de rota REST | bloqueado | QUEBRADA | Persistência de viagem ausente; migração órfã. | D |
| F093 | Combustível | módulo → Supabase | modelo/rota ausentes | bloqueado | QUEBRADA | Backend ausente. | B |
| F094 | Documentos de frota | módulo misto | MinIO genérico sem domínio de frota | bloqueado | QUEBRADA | Metadados/entidade não portados. | D |
| F095 | Relatórios de frota | módulo → Supabase | backend ausente | bloqueado | QUEBRADA | Sem fonte persistente portada. | B |
| F096 | OCR de documento de frota | UI/edge legada | `extract-fleet-document` não portado | bloqueado | QUEBRADA | Função backend ausente. | B |

### 3.9 Stripe, assinatura e plataforma

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F097 | Perfil e métodos de cobrança | telas → REST | billing profile/payment methods | indisponível | NÃO TESTADA | Stripe/DB ausentes. | |
| F098 | Visão da assinatura | SubscriptionPage → REST | subscription endpoints | indisponível | NÃO TESTADA | Sem chave Stripe. | |
| F099 | Checkout | CheckoutPage → REST | checkout session | indisponível | NÃO TESTADA | Integração externa não executada. | |
| F100 | Customer Portal | tela → REST | portal session | indisponível | NÃO TESTADA | Stripe ausente. | |
| F101 | Webhook Stripe | chamada externa | webhook + persistência | indisponível | NÃO TESTADA | Secret/assinatura e endpoint público não exercitados. | |
| F102 | Transferência manual | plataforma → REST | manual transfer | indisponível | NÃO TESTADA | Sem banco/Stripe. | |
| F103 | Administração financeira da plataforma | PlatformOwnerPage → REST | platform routes | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F104 | Ciclo de vida de assinatura | jobs/webhook → REST | status/subscription | indisponível | NÃO TESTADA | Scheduler e eventos externos ausentes. | |

### 3.10 Marketplace, automação e IA

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F105 | Listar marketplace | `useMarketplace` → Supabase | backend/Prisma ausentes | bloqueado | QUEBRADA | Capacidade existe apenas no legado. | C |
| F106 | CRUD de anúncios | `useMarketplace` → Supabase | backend/Prisma ausentes | bloqueado | QUEBRADA | Mutações viram falso sucesso. | C |
| F107 | Fotos de anúncios | MinIO + insert Supabase | metadados não persistem | bloqueado | QUEBRADA | Upload e registro estão em arquiteturas diferentes. | C |
| F108 | Regras de automação | `useAutomationEngine` → Supabase | domínio backend ausente | bloqueado | QUEBRADA | Tabelas/regras não portadas. | B |
| F109 | Execuções/dead-letter | hook → Supabase | backend ausente | bloqueado | QUEBRADA | Observabilidade da automação indisponível. | B |
| F110 | Executar engine genérica | invoke edge function | `run-automation-engine` não portado | bloqueado | QUEBRADA | Função legada bloqueada. | B |
| F111 | Automação específica de billing | Billing UI → REST | `/billing/admin/automation/run` | indisponível | NÃO TESTADA | É fluxo distinto da engine genérica. | |
| F112 | Inferência IA genérica | `useAIOrchestrator` → Supabase | orquestrador backend ausente | bloqueado | QUEBRADA | Edge function não portada. | B |
| F113 | Histórico/outputs de IA | hook → Supabase | tabelas/backend ausentes | bloqueado | QUEBRADA | Sem persistência portada. | B |
| F114 | Ações sugeridas por IA | hook → Supabase | `ai-action` não portado | bloqueado | QUEBRADA | Sem executor seguro no backend. | B |
| F115 | Copiloto operacional | componente global misto | várias tabelas Supabase ausentes | bloqueado | QUEBRADA | Fluxo órfão retorna vazio pela façade. | D |

### 3.11 Documentos, dashboard, configurações e governança

| ID | Funcionalidade | UI / chamada | API / persistência | Runtime | Status | Causa ou gap | Mig. |
|---:|---|---|---|---|---|---|:---:|
| F116 | Gestor global de documentos | `/documents` em `ModulePages` → Supabase | `/documents` REST já existe | bloqueado | QUEBRADA | Tela principal não usa a abstração REST existente. | A |
| F117 | Gestor embutido por entidade | `EmbeddedFileManager` → REST | Document + MinIO | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F118 | KPIs do dashboard | hooks principais → REST | endpoints agregados | indisponível | NÃO TESTADA | Banco/API ausentes. | |
| F119 | Gráfico de receita | `RevenueChart` → Supabase | PaymentOrder REST existe | bloqueado | QUEBRADA | Consulta é neutralizada pela façade. | A |
| F120 | Feed de eventos | Dashboard → REST | backend events | indisponível | NÃO TESTADA | Contrato localizado. | |
| F121 | Notificações | Topbar/hooks → REST | notifications | indisponível | NÃO TESTADA | Sem runtime. | |
| F122 | Configurações da empresa | Settings/Profile → REST | workspace/company settings | indisponível | NÃO TESTADA | Cadeia localizada. | |
| F123 | Credenciais temporárias | `TempCredentialsCard` → Supabase | backend específico ausente | bloqueado | QUEBRADA | Operações não persistem. | B |
| F124 | Reset do sistema | Settings invoca edge | `reset-system` não portado | bloqueado | QUEBRADA | Função legada bloqueada/ausente. | B |
| F125 | Perfil/avatar | REST principal com fallback Supabase | Profile + armazenamento | indisponível | PARCIAL | Fallback legado mascara falhas e ciclo do objeto não foi validado. | |
| F126 | Privacidade e sessões | telas/hooks → Supabase | backend ausente | bloqueado | QUEBRADA | RPCs/tabelas de privacidade não portados. | C |
| F127 | Auditoria | `AuditPage` → Supabase | backend de auditoria não equivalente | bloqueado | QUEBRADA | Tabelas de auditoria/segurança legadas. | C |
| F128 | Recuperação/soft delete | hooks → RPC Supabase | backend ausente | bloqueado | QUEBRADA | RPCs não portadas. | C |
| F129 | Segurança e compliance | dashboard/hooks → Supabase | backend ausente | bloqueado | QUEBRADA | Indicadores e ações não têm fonte portada. | B |
| F130 | Consentimento | `ConsentGate`/`useConsent` → Supabase | backend ausente | bloqueado | QUEBRADA | Consentimento não é persistido. | C |
| F131 | Landing, termos e privacidade pública | rotas públicas estáticas | sem persistência necessária | indisponível | NÃO TESTADA | Build/UI não executados. | |

## 4. Causas-raiz transversais

1. **Migração sem fronteira explícita**: o frontend contém simultaneamente REST, Supabase e fluxos mistos. A façade noop elimina sintomas de rede, mas também transforma operações críticas em falso sucesso.
2. **Backend incompleto por domínio**: frota, marketplace, automação genérica, IA operacional, consentimento, recuperação e partes de segurança/compliance ainda não têm equivalente Express/Prisma.
3. **Tenant scope não é invariante de servidor**: várias rotas aceitam `workspace_id` do cliente ou consultam por ID sem validar membership, criando risco sistêmico de BOLA/IDOR.
4. **Modelagem fragmentada**: `Client`, `BillingClient` e `Person(type=client)`, bem como `User`, `AppUser`, `Profile` e `Person`, não compartilham uma identidade canônica nem sincronização transacional.
5. **Efeitos derivados não atômicos**: entrega de OP → WEEKLOG e validação de WEEKLOG → lista de pagamento podem falhar depois de a operação principal ser confirmada.
6. **Dados estruturados em campos textuais/localStorage**: orçamento, etapas e detalhes financeiros são serializados em `notes`, `category` ou navegador, impedindo integridade referencial, consulta e auditoria confiáveis.
7. **Ausência de ambiente reproduzível imediatamente utilizável**: dependências, segredos e daemon Docker indisponíveis impediram comprovação ponta a ponta; compose contém contextos absolutos já registrados na Fase 1.
8. **Baixa proteção por teste**: três testes frontend e nenhum teste backend não cobrem contratos, autorização tenant, transações, webhooks ou efeitos financeiros.

## 5. Migração Supabase — inventário dos 48 importadores frontend

Foram localizados **48 arquivos** que importam `@/integrations/supabase/client`. A classificação abaixo é exclusiva por arquivo e orienta causa, não prioridade de implementação.

### A — Frontend pode ser religado a backend REST existente (13)

- `src/components/billing/ReconciliationScreen.tsx`
- `src/components/dashboard/PlatformsPanel.tsx`
- `src/components/dashboard/RevenueChart.tsx`
- `src/components/payment-orders/PaymentOrdersTable.tsx`
- `src/hooks/useDashboardData.ts`
- `src/hooks/useFinancialEvents.ts`
- `src/hooks/usePaymentLists.ts`
- `src/hooks/useServiceOrderPhotos.ts`
- `src/hooks/useTechnicianEarnings.ts`
- `src/hooks/useUserAvatar.ts`
- `src/lib/assertDelete.ts`
- `src/lib/getTechnicianForRecord.ts`
- `src/pages/JoinPage.tsx`

### B — Backend/domínio persistente ausente (22)

- `src/components/fleet/AssignmentsModule.tsx`
- `src/components/fleet/DriversModule.tsx`
- `src/components/fleet/FleetReportsModule.tsx`
- `src/components/fleet/FloatingTripButton.tsx`
- `src/components/fleet/FuelLogsModule.tsx`
- `src/components/fleet/VehiclesModule.tsx`
- `src/components/permissions/UserPermissionsDialog.tsx`
- `src/components/platform/SecurityDashboard.tsx`
- `src/components/settings/TempCredentialsCard.tsx`
- `src/hooks/useAIOrchestrator.ts`
- `src/hooks/useAutomationEngine.ts`
- `src/hooks/useCompliance.ts`
- `src/hooks/useGeolocation.ts`
- `src/hooks/useImpersonation.tsx`
- `src/hooks/useSoftDelete.ts`
- `src/hooks/useTechnicianSubscription.ts`
- `src/lib/companySearch.ts`
- `src/lib/deviceFingerprint.ts`
- `src/lib/operationalBus/OperationalEventBus.ts`
- `src/lib/securityLog.ts`
- `src/pages/AuditPage.tsx`
- `src/pages/FleetPage.tsx`

### C — Capacidade somente no legado Supabase (3)

- `src/components/legal/ConsentGate.tsx`
- `src/hooks/useConsent.tsx`
- `src/hooks/useMarketplace.ts`

### D — Órfão ou migração mista; requer decisão de contrato/domínio (7)

- `src/components/fleet/FleetDocumentsModule.tsx`
- `src/components/fleet/TripsModule.tsx`
- `src/hooks/useAccountingExpensesByPeriod.ts`
- `src/hooks/useOperationalCopilot.ts`
- `src/lib/fleet/tripActions.ts`
- `src/lib/realtime/RealtimeHub.ts`
- `src/pages/ModulePages.tsx`

### E — Diagnóstico/infra auxiliar, fora de migração funcional imediata (3)

- `src/components/agent/AgentDiagnosticsView.tsx`
- `src/lib/observability/RuntimeHealthMonitor.ts`
- `src/lib/runtimeDiagnostics.ts`

**Síntese**: 45 dos 48 importadores (A–D) participam de capacidades funcionais que ainda exigem migração, religação ou decisão explícita; dentro desse conjunto, 7 são fluxos órfãos/mistos. Os 3 restantes são auxiliares de diagnóstico/infra. A remoção indiscriminada dos imports não é solução: a fronteira REST e a persistência de cada domínio precisam ser definidas antes.

## 6. Dez maiores bloqueadores atuais

1. Façade Supabase noop converte leitura em vazio e mutação em falso sucesso.
2. Isolamento multi-tenant não é aplicado uniformemente no servidor.
3. Ambiente local não sobe sem dependências, configurações e serviços externos.
4. Frota não possui domínio Express/Prisma, embora sete abas estejam expostas na UI.
5. Orçamento/PDR não possui modelo persistente; dados críticos vivem em localStorage/notes.
6. Clientes e pessoas têm identidades concorrentes sem chave canônica.
7. Pagamentos ainda têm mutações críticas ligadas ao Supabase e rotas legadas inexistentes.
8. Automação genérica e IA operacional continuam dependentes de edge functions/tabelas não portadas.
9. Efeitos OP → WEEKLOG e WEEKLOG → pagamento não são atômicos.
10. Ausência de testes backend e baixa cobertura frontend impedem validar contratos e segurança com rapidez.

## 7. Capacidades recuperáveis sem criar novo backend

As seguintes áreas possuem backend REST existente e o bloqueio predominante está no frontend legado: edição/pagamento/exclusão de ordens de pagamento; confronto/reconciliação da tela legada; gestor global de documentos; gráfico de receita; listas auxiliares e ganhos de técnicos; avatar; detalhes auxiliares de dashboard/financeiro; seleção/aceite do convite após registrar a rota `/join`. Isso não autoriza uma troca mecânica: contratos, autorização tenant e tratamento de erro precisam ser verificados na Fase 4.

## 8. Capacidades sem backend equivalente

Frota persistente; marketplace; automação genérica; IA orquestrada e ações de IA; consentimento/privacidade; soft delete/recuperação; credenciais temporárias; telemetria de geolocalização; relatórios de segurança/compliance; OCR de documentos de frota; reset do sistema. O gestor de anexos/MinIO e a calculadora de rotas são componentes reutilizáveis, mas não substituem os respectivos modelos de domínio.

## 9. Credenciais, acessos e infraestrutura faltantes para validação

- PostgreSQL/`DATABASE_URL` e dados de teste multi-workspace.
- `JWT_SECRET` e contas de teste para `owner`, `admin`, membro e usuário sem acesso.
- MinIO: endpoint, chaves, buckets e política de acesso.
- Stripe: chaves, webhook secret e conta de teste.
- SMTP: host, porta e credenciais.
- Provedores de IA: `GEMINI_API_KEY` e/ou `OPENAI_API_KEY`.
- Clima/mapas/rota: Tomorrow.io, NOAA quando aplicável, ORS e tokens de mapa.
- Docker Desktop/daemon ou serviços equivalentes ativos.
- Dependências npm instaladas na raiz e no backend.

## 10. Evidências principais

- `src/App.tsx:203-233`: rotas registradas; ausência de `/join`.
- `src/integrations/supabase/client.ts:120-185`: façade noop.
- `backend/src/index.ts:58-82`: 25 routers Express montados.
- `src/components/production/BudgetPanel.tsx:35-36,81,141,185,278-290,494-528`: orçamento local e conversão em OP.
- `backend/prisma/schema.prisma:550-582`: ProductionOrder sem entidade de orçamento/PDR.
- `backend/src/routes/productionOrders.ts:274-527`: criação de WEEKLOG com falha tolerada fora de transação.
- `backend/src/routes/serviceOrders.ts:299-520`: CRUD/validação e efeito derivado de pagamento.
- `src/components/payment-orders/PaymentOrdersTable.tsx:204-383`: mutações Supabase residuais.
- `src/hooks/usePaymentOrders.ts:250-277`: chamadas para contratos de discrepância inexistentes.
- `backend/src/routes/finance.ts:162-335,700-886`: reconciliação/confronto REST existentes.
- `backend/src/routes/billingOperations.ts:116-121,452-473,728-777`: papel admin estrito, scope e anexos.
- `backend/src/routes/people.ts:80-100` e `backend/src/routes/locations.ts:50-70`: consultas sem filtro tenant.
- `backend/src/routes/extract.ts:6,101,242,360,480`: extrações sem `requireAuth`.
- `src/pages/FleetPage.tsx:206-212`: sete módulos de frota expostos sobre legado.

## 11. Limite da Fase 3

Esta fase encerra-se no inventário funcional e na explicação das causas-raiz. Não foram executados correções, migrações, mudanças de contrato, criação de CRUD, instalação de dependências ou alteração de código do produto. A reprodução detalhada de payloads, erros e fluxos pertence à Fase 4 e depende do acesso indicado acima.
