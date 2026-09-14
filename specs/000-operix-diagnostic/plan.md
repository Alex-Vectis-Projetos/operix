# Implementation Plan: Diagnóstico Técnico Brownfield Operix

**Branch**: `000-operix-diagnostic` | **Date**: 2026-09-05 | **Spec**: [spec.md](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/specs/000-operix-diagnostic/spec.md)  

---

## 1. Sumário Executivo

A Operix está em um estado de transição arquitetural crítico (*Brownfield Migration*):
- **Origem**: Aplicação prototipada no Lovable com forte acoplamento ao Backend-as-a-Service (BaaS) Supabase (PostgREST, Auth, Realtime, Edge Functions, Storage).
- **Destino**: Arquitetura desacoplada em VPS própria com Docker, Node.js/Express, Prisma ORM, PostgreSQL e MinIO (compatível com S3).
- **Metodologia de Auditoria**: O diagnóstico é estruturado em **4 Camadas** (Current State, Root Cause, Stabilization Backlog, Target-State Gap) divididas em **7 Fases Sequenciais**, garantindo a diferenciação estrita entre correção do sistema atual e novas demandas de produto.

---

## 2. Estrutura do Plano de Diagnóstico (7 Fases)

### Fase 1 — Inventário do Repositório (CONCLUÍDA ✅)
- [x] Mapeamento de diretórios, 890 arquivos, 131.240 LOC globais.
- [x] Levantamento de dependências no frontend e backend.
- [x] Auditoria de configurações de ambiente, docker-compose e imagens Docker.
- [x] Identificação de débitos de transição (`noopSupabaseFacade`, sondas `127.0.0.1:7777`).
- [x] Entregável: `docs/audit/repository-inventory.md`.

### Fase 2 — Arquitetura e Modelo de Dados (CONCLUÍDA ✅)
- [x] Mapeamento dos 44 modelos do Prisma ORM e confronto com 192 migrações Supabase.
- [x] Auditoria de Identidade e Acesso: separação entre **Colaboradores** (`Person`), **Utilizadores** (`User`/`AppUser`) e **Técnicos Externos**.
- [x] Diagnóstico da fragmentação de entidades de Clientes (`Client`, `BillingClient`, `Person`).
- [x] Mapeamento do ciclo operacional/financeiro (Produção → WEEKLOG → Lista L0xxxxx → Faturamento → Reconciliação).
- [x] Auditoria de segurança: vazamento multi-tenant (IDOR/BOLA) e endpoints públicos de OCR/IA.
- [x] Matriz de porte das 28 Edge Functions (17 portadas, 1 parcial, 7 não portadas, 3 desativadas).
- [x] Entregável: `docs/audit/architecture-and-data-model.md`.

### Fase 3 — Inventário Funcional: Current State & Root Cause (CONCLUÍDA ✅)
- [x] Varredura exaustiva tela a tela das 29 rotas de páginas (`src/pages/`) e seus 204 componentes.
- [x] Classificação de cada módulo na Camada 1 (`FUNCIONAL`, `PARCIAL`, `QUEBRADA`, `SOMENTE UI`, `NÃO LOCALIZADA`, `NÃO TESTADA`).
- [x] Diagnóstico de Causa-Raiz na Camada 2 para cada item degradado (Supabase legado, rota ausente, contrato divergente, permissão, etc.).
- [x] Auditoria do Core Funcional:
  1. Cadastros (Pessoas, Utilizadores, Clientes, Locais, Requisitos por País)
  2. Orçamento / Vistoria (Ficha PDR, Danos, Fotos, Precificação)
  3. Produção & Workflow (Kanban, Status de Reparo, Galeria)
  4. WEEKLOG (Organização Semanal, Pastas por Veículo, Retificações)
  5. Listas Operacionais & Confronto OS x OP
  6. Faturamento (Emissão, Vínculo de Listas, PDF, E-mail SMTP)
  7. Pagamentos (Ordens de Pagamento, Transferências, Recibos)
  8. Repartição Financeira & Contabilidade (Regras de Lucro, Snapshot, DRE)
  9. Radar de Granizo (Hail Events, Mapas, Roteirização ORS)
  10. Assinaturas & Stripe (Checkout, Customer Portal, Webhooks)
  11. Gestão de Frotas (Veículos, Motoristas, Viagens, Combustível)
- [x] Entregável: `docs/audit/functional-inventory.md`.

### Fase 4A — Auditoria Estática de Fluxos, Contratos de API e Bugs (CONCLUÍDA ✅)
- [x] Catalogação sistemática dos 189 endpoints REST (`backend/src/routes/*.ts`).
- [x] Análise de compatibilidade de 226 call sites REST, payloads e schemas disponíveis.
- [x] Separação explícita entre bugs estaticamente confirmados e hipóteses que requerem reprodução.
- [x] Entregável: `docs/audit/api-contracts-and-bugs.md`.

### Fase 4B — Reprodução Controlada (PENDENTE ⏳)
- [ ] Reproduzir contratos, concorrência, atomicidade e isolamento em ambiente sanitizado.
- [ ] Registrar requests/responses e stack traces reais, sem inferência de runtime.

### Fase 5 — Segurança, Performance e Dívida Técnica
- [ ] Auditoria de autorização e tenant isolation em toda a API Express.
- [ ] Análise de assinaturas de Webhooks e proteção de segredos.
- [ ] Identificação de queries N+1, monólitos de código (`ModulePages.tsx`, `billing.ts`) e ausência de testes.
- [ ] Entregável: `docs/audit/security-and-technical-debt.md`.

### Fase 6 — Gap Analysis: Current State vs Target State
- [ ] Comparação estruturada do código existente com os requisitos novos do cliente:
  - Ficha visual PDR por peça do veículo
  - Fotos por peça
  - Estimativa assistida por IA de quantidade/tamanho dos danos
  - Consolidação do total de danos
  - Preço/forfait manual
  - Documentos white-label e multilíngues
  - Separação e sincronização entre Colaboradores internos e Utilizadores
  - Evolução do módulo Colaboradores/RH e compliance
  - Vínculo opcional entre pessoa operacional e conta de acesso
- [ ] Classificação de gaps: `NÃO IMPLEMENTADA`, `PARCIALMENTE IMPLEMENTADA`, `REQUER REDESENHO`.
- [ ] Entregável: `docs/audit/gap-analysis.md`.

### Fase 7 — Backlog Consolidado e Roadmap Estratégico
- [ ] **Seção A: Correções e Estabilização do Sistema Atual** (Backlog P0, P1, P2 com causas, dependências, esforço e critérios de aceite).
- [ ] **Seção B: Novas Funcionalidades e Evolução do Produto** (Roadmap de engenharia para entrega dos requisitos alvo).
- [ ] Entregável: `docs/audit/stabilization-and-evolution-roadmap.md`.

---

## 3. Entregáveis Planejados em `docs/audit/`

1. `docs/audit/repository-inventory.md` (Fase 1 — Concluído ✅)
2. `docs/audit/architecture-and-data-model.md` (Fase 2 — Concluído ✅)
3. `docs/audit/functional-inventory.md` (Fase 3 — Concluído ✅)
4. `docs/audit/api-contracts-and-bugs.md` (Fase 4)
5. `docs/audit/security-and-technical-debt.md` (Fase 5)
6. `docs/audit/gap-analysis.md` (Fase 6)
7. `docs/audit/stabilization-and-evolution-roadmap.md` (Fase 7)
