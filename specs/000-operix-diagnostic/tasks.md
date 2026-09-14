# Tasks: Diagnóstico Técnico Brownfield Operix

**Feature Branch**: `000-operix-diagnostic`  
**Status**: CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS (Fases 1, 2, 3, 4A, 5A, 5C, 6, 6.5 e 7 concluídas; 4B/5B não executadas integralmente)  
**Spec**: [spec.md](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/specs/000-operix-diagnostic/spec.md) | **Plan**: [plan.md](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/specs/000-operix-diagnostic/plan.md)  

---

## Fase 1 — Inventário do Repositório (CONCLUÍDA ✅)

- [x] **T01-01**: Criar estrutura Spec-Driven da auditoria (`specs/000-operix-diagnostic/`).
- [x] **T01-02**: Executar varredura estática de arquivos, extensões e contagem de linhas de código (LOC).
- [x] **T01-03**: Mapear dependências do Frontend (`package.json`, Vite, React 18, Radix UI, TanStack Query, Tailwind).
- [x] **T01-04**: Mapear dependências do Backend (`backend/package.json`, Express, Prisma ORM, MinIO S3 SDK, Stripe, Nodemailer).
- [x] **T01-05**: Analisar configurações de containerização e deploy (`docker-compose.yml`, `docker-compose.dev-alex.yml`, `Dockerfile.frontend`, `backend/Dockerfile`, `nginx.conf`).
- [x] **T01-06**: Mapear variáveis de ambiente (`.env.example`, `backend/.env.example`, `docker-compose.yml`).
- [x] **T01-07**: Identificar débitos de transição (acoplamento ao cliente `@/integrations/supabase/client`, `noopSupabaseFacade`, fetchs residuais para `127.0.0.1:7777`).
- [x] **T01-08**: Consolidar relatório inicial da Fase 1 em `docs/audit/repository-inventory.md`.

---

## Fase 2 — Arquitetura e Modelo de Dados (CONCLUÍDA ✅)

- [x] **T02-01**: Mapear esquema Prisma (`backend/prisma/schema.prisma`) e extrair diagrama de entidades e relacionamentos (ERD) com 44 modelos.
- [x] **T02-02**: Auditar modelo de identidade e acesso: `User`, `AppUser`, `Profile`, `UserRole`, `Membership`, `WorkspaceInvite`.
- [x] **T02-03**: Investigar separação conceitual e técnica entre **Colaboradores** (`Person`), **Utilizadores** (`User`/`AppUser`) e **Técnicos Externos** (`Person(type="technician")`).
- [x] **T02-04**: Auditar entidades de clientes e locais: `Client` vs `BillingClient` vs `Person(type="client")` vs `Location`.
- [x] **T02-05**: Auditar entidades operacionais: `ServiceOrder` (OS/WEEKLOG), `ProductionOrder` (OP), `ProductionPhoto`, `ProductionList`.
- [x] **T02-06**: Auditar entidades financeiras: `BillingInvoice`, `BillingSupplier`, `BillingAttachment`, `PaymentOrder`, `FinancialRecord`, `Reconciliation`, `ProfitRule`, `ProfitRuleItem`, `ServiceOrderDistribution`, `FinancialIntegrityIssue`, `FinancialIntegritySnapshot`.
- [x] **T02-07**: Mapear 192 migrações em `supabase/migrations/` e verificar quais tabelas/funções/triggers não foram portadas para o Prisma (Fleet, Automação, IA, Realtime).
- [x] **T02-08**: Auditar arquitetura de autenticação, geração/validação de JWT e RBAC (`backend/src/middleware/auth.ts`, `backend/src/lib/permissionPolicy.ts`).
- [x] **T02-09**: Auditar arquitetura de armazenamento de arquivos (`MinIO` S3 SDK com 10 buckets vs `Supabase Storage`).
- [x] **T02-10**: Mapear 28 Edge Functions em `supabase/functions/` e classificar status de porte para o backend Express (17 portadas, 1 parcial, 7 não portadas, 3 desativadas).
- [x] **T02-11**: Consolidar relatório em `docs/audit/architecture-and-data-model.md`.

---

## Fase 3 — Inventário Funcional: Current State & Root Cause (CONCLUÍDA ✅)

- [x] **T03-01**: Auditar módulo **Cadastros** (Pessoas, Utilizadores, Clientes, Locais, Requisitos Documentais por País).
- [x] **T03-02**: Auditar módulo **Orçamento / Vistoria** (Ficha PDR, Danos na Lataria, Precificação, Geração PDF).
- [x] **T03-03**: Auditar módulo **Produção** (Quadro Kanban/Lista de OPs, Status de Reparo, Galeria de Fotos).
- [x] **T03-04**: Auditar módulo **WEEKLOG** (Agrupamento Semanal, Pastas por Veículo, Sincronização Automática com Produção).
- [x] **T03-05**: Auditar módulo **Listas Operacionais** (Criação de Listas, Status, Agrupamento).
- [x] **T03-06**: Auditar módulo **Confronto de Listas (OS x OP)** (Motor de Reconciliação, Detecção de Discrepâncias, Abas Financeiras).
- [x] **T03-07**: Auditar módulo **Faturamento** (Emissão de Faturas, Vínculo com Listas/OPs, Numeração Sequencial, Geração de PDF, Envio de E-mail via SMTP).
- [x] **T03-08**: Auditar módulo **Pagamentos** (Ordens de Pagamento, Comprovantes de Transferência Bancária, Recibos via OCR).
- [x] **T03-09**: Auditar módulo **Repartição Financeira & Contabilidade** (Regras de Lucro, Snapshot Imutável de Distribuição, DRE/Despesas).
- [x] **T03-10**: Auditar módulo **Radar de Granizo & PDR** (Ingestão de Clima Tomorrow.io/NOAA, Mapas MapLibre/Leaflet, Roteirização ORS).
- [x] **T03-11**: Auditar módulo **Assinaturas & Stripe** (Checkout Embedded, Customer Portal, Webhooks).
- [x] **T03-12**: Auditar módulo **Gestão de Frotas / Veículos** (Veículos, Motoristas, Viagens, Combustível).
- [x] **T03-13**: Classificar cada funcionalidade na Camada 1 (`FUNCIONAL`, `PARCIAL`, `QUEBRADA`, `SOMENTE UI`, `NÃO LOCALIZADA`, `NÃO TESTADA`) e Camada 2 (`ROOT CAUSE`).
- [x] **T03-14**: Consolidar relatório em `docs/audit/functional-inventory.md`.

---

## Fase 4A — Auditoria Estática de Fluxos, Contratos e Bugs (CONCLUÍDA ✅)

- [x] **T04A-01**: Catalogar os 189 endpoints REST (`backend/src/routes/*.ts`) com método, path, autenticação, origem do workspace, validação e persistência.
- [x] **T04A-02**: Confrontar 226 call sites REST do frontend com os contratos Express e validadores disponíveis.
- [x] **T04A-03**: Mapear mutações silenciosas do `noopSupabaseFacade` e os 13 fluxos legados com substituto REST total ou parcial.
- [x] **T04A-04**: Auditar estaticamente OCR/extração, Stripe, storage, billing e a cadeia OP → WEEKLOG → pagamento → financeiro.
- [x] **T04A-05**: Separar 29 bugs estaticamente confirmados de 8 hipóteses dependentes de runtime, sem fabricar stack traces.
- [x] **T04A-06**: Consolidar `docs/audit/api-contracts-and-bugs.md`.

## Fase 4B — Reprodução Controlada dos Contratos e Bugs (PENDENTE ⏳)

- [x] **T04B-00**: Validar o handover, inventariar nomes de variáveis, definir laboratório/dataset e produzir `handover-validation.md` + `runtime-test-plan.md`, sem executar testes.
- [ ] **T04B-01**: Preparar ambiente sanitizado com dois workspaces e contas por papel.
- [ ] **T04B-02**: Reproduzir contratos divergentes, endpoints ausentes e caminhos de erro com evidências reais de request/response.
- [ ] **T04B-03**: Executar testes autorizados de concorrência, atomicidade, idempotência e isolamento horizontal.
- [ ] **T04B-04**: Registrar somente stack traces realmente produzidos pelo ambiente de teste e revisar prioridades/confiança.

---

## Fase 5A — Segurança, Performance e Dívida Técnica Estática (CONCLUÍDA ✅)

- [x] **T05A-01**: Auditar autenticação, autorregistro, recuperação/troca de senha, JWT, RBAC, convites, CORS, Helmet, logging, rate limiting e payloads.
- [x] **T05A-02**: Rastrear estaticamente entrada → validação → persistência → privilégio do autorregistro público de `admin`, sem exploração runtime.
- [x] **T05A-03**: Construir matriz de isolamento multi-tenant para os 20 domínios prioritários e identificar a causa sistêmica.
- [x] **T05A-04**: Auditar storage/documentos, OCR/IA, Stripe, SMTP, clima, scheduler, telemetria e supply chain.
- [x] **T05A-05**: Classificar configuração sensível sem exibir valores: segredo ativo desconhecido, historicamente exposto, variável pública intencional ou placeholder.
- [x] **T05A-06**: Auditar estaticamente N+1, queries globais, payloads em memória, PDFs, polling, jobs, índices, bundle e hotspots.
- [x] **T05A-07**: Consolidar dívida técnica D1–D7 e mapear cada item relevante ao impacto A–D na Fase 2.
- [x] **T05A-08**: Revisar perguntas em `BUSINESS`, `ENGINEERING`, `RUNTIME`, `PRODUCT` e `SECURITY`.
- [x] **T05A-09**: Consolidar `docs/audit/security-performance-and-technical-debt.md`.

## Fase 5B — Validação dinâmica de segurança e performance (CONDICIONADA À 4B ⏳)

- [ ] **T05B-01**: Reproduzir somente em laboratório sanitizado a extensão dos achados marcados `REQUER REPRODUÇÃO 4B`.
- [ ] **T05B-02**: Medir query count, memória, bundle e concorrência para os itens `REQUER BENCHMARK 4B`, sem testes de carga ofensivos.
- [ ] **T05B-03**: Atualizar confiança/prioridade apenas com evidência coletada e preservar isolamento de produção.

## Fase 5C — Consolidação do Target State do Cliente (CONCLUÍDA ✅)

- [x] **T05C-01**: Ler integralmente e conferir visualmente as 14 páginas de `Relatorio_Plano_de_Ataque_QW_Nexus.pdf`.
- [x] **T05C-02**: Separar rigorosamente afirmações do cliente (TARGET STATE) das evidências do código/auditoria (CURRENT STATE).
- [x] **T05C-03**: Extrair 53 requisitos rastreáveis com comportamento, aceite, prioridade do cliente, fonte, current state e classificação.
- [x] **T05C-04**: Confrontar preliminarmente current×target sem executar a Gap Analysis da Fase 6.
- [x] **T05C-05**: Registrar separadamente CLIENT PRIORITY e TECHNICAL DEPENDENCY, incluindo os gates estruturais da Fase 5A.
- [x] **T05C-06**: Substituir a hipótese de sincronização automática Colaborador↔Utilizador e revisar individualmente as open questions.
- [x] **T05C-07**: Consolidar `docs/audit/client-target-state.md` e atualizar tasks/findings/open-questions.

---

## Fase 6 — Gap Analysis: Current State vs Target State (CONCLUÍDA ✅)

- [x] **T06-01**: Confrontar integralmente os 53 requisitos `CTS-001`–`CTS-053` com o current state das Fases 1–5A.
- [x] **T06-02**: Classificar cada CTS em uma categoria principal da taxonomia ampliada, natureza do trabalho, reutilização e impacto arquitetural.
- [x] **T06-03**: Diferenciar preconditions e dependencies nos gates G1–G9 e cruzar decisões BUSINESS/open questions sem inventar respostas.
- [x] **T06-04**: Produzir o Foundation Dependency Map, separar fundação de feature e agrupar os 53 CTS em clusters sem cronograma ou estimativa.
- [x] **T06-05**: Consolidar `docs/audit/gap-analysis.md` e validar mecanicamente completude, contagens, gates, dependências 4B e impacto estrutural.

---

## Fase 6.5 — Decision Brief + Minimum Viable 4B (CONCLUÍDA ✅)

- [x] **T06.5-01**: Registrar as novas informações como `PREMISSA EVERGREEN — VALIDAR COM CLIENTE`, sem atribuí-las a Alex ou tratá-las como evidência do código.
- [x] **T06.5-02**: Reclassificar as 13 questões BUSINESS entre premissa, decisão ainda necessária, não bloqueante e definível durante implementação.
- [x] **T06.5-03**: Reduzir a pauta executiva a seis decisões e oito confirmações de premissas em `docs/audit/alex-decision-brief.md`.
- [x] **T06.5-04**: Reduzir os 74 casos 4B a quatro cenários consolidados, cobrindo os 14 CTS prioritários em `docs/audit/minimum-runtime-validation.md`.
- [x] **T06.5-05**: Classificar três cenários como `MUST RUN BEFORE PROPOSAL` e um como `SHOULD RUN IF LAB AVAILABLE`, sem executar runtime.
- [x] **T06.5-06**: Indicar clusters fecháveis/condicionais e limites para prioridade, esforço e prazo antes da Fase 7.

---

## Fase 7 — Backlog Consolidado, Roadmap e Relatório Final (CONCLUÍDA ✅)

- [x] **T07-01**: Estruturar Backlog A de Estabilização/Correção, com causa raiz, impacto, correção, target, aceite, dependências, prioridade, esforço e confiança.
- [x] **T07-02**: Estruturar Backlog B de Novas Funcionalidades/Evolução, separado dos defeitos atuais e com decisão de portfólio para módulos sem CTS.
- [x] **T07-03**: Consolidar `docs/audit/stabilization-and-evolution-roadmap.md` com 40 itens e roadmap técnico por dependências/fatias verticais.
- [x] **T07-04**: Criar `docs/audit/final-diagnostic-report.md` como documento mestre para cliente e engenharia.
- [x] **T07-05**: Revisar evidência estática, observação manual, hipóteses runtime e gaps estruturais sem inventar execução 4B/5B.
- [x] **T07-06**: Atualizar `tasks.md`, `findings.md` e `open-questions.md` e marcar o diagnóstico como `CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS`.
