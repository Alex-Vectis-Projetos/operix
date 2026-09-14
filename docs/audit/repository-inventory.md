# Relatório de Diagnóstico: Inventário do Repositório (Fase 1)

**Projeto**: Operix (QW-Nexus)  
**Data**: 2026-09-05  
**Fase do Diagnóstico**: Fase 1 — Inventário do Repositório  
**Status**: Concluído ✅  
**Referencial Metodológico**: Spec-Driven Brownfield Architecture Audit  

---

## 1. Sumário Executivo

Este documento consolida o **Inventário Físico e Lógico do Repositório da Operix**, constituindo a entrega formal da **Fase 1 do Diagnóstico Técnico Brownfield**. 

A Operix é um sistema de gestão operacional e financeira para empresas de reparação automotiva e PDR (*Paintless Dent Repair*), concebido originalmente no gerador Lovable e acoplado ao ecossistema Supabase. Atualmente, o projeto encontra-se em um estado híbrido de migração para infraestrutura auto-hospedada (VPS Docker com API Node.js/Express, Prisma ORM, PostgreSQL e MinIO).

O objetivo desta etapa foi inventariar exaustivamente 100% dos ativos de software, dependências, infraestrutura de build/deploy, configurações de ambiente e acoplamentos legados, estabelecendo a base factual e quantitativa para as fases subsequentes da auditoria.

---

## 2. Métricas Quantitativas Globais

A varredura estática realizada em todo o espaço de trabalho (excluindo `node_modules`, `.git` e `dist`) revelou a seguinte distribuição de arquivos e volume de código:

### 2.1 Distribuição por Extensão de Arquivo

| Extensão | Quantidade | Descrição / Papel no Repositório |
|---|---|---|
| `.ts` | 321 | Código TypeScript (Lógica Backend, Hooks, Libs, Utilitários, Tipos) |
| `.tsx` | 254 | Componentes e Páginas React (Interface do Usuário) |
| `.sql` | 194 | Migrações DDL e Scripts SQL (192 migrações Supabase + scripts) |
| `.md` | 60 | Documentações técnicas, planos, especificações e relatórios |
| `.jpg` / `.png` / `.jpeg` / `.svg` / `.ico` | 25 | Ativos gráficos, ícones e capturas de referência da Onda 2 |
| `.json` | 16 | Manifestos de pacotes, configurações de TypeScript, lint e specs |
| `.yml` / `.yaml` | 3 | Arquivos de composição Docker (`docker-compose*.yml`) |
| `.conf` | 2 | Configurações de servidor web Nginx |
| `.prisma` | 1 | Esquema relacional central do Prisma ORM (`schema.prisma`) |
| `.mjs` / `.js` | 3 | Scripts auxiliares de auditoria e configurações Vite/ESLint |
| Outros / Configs | 11 | Dockerfiles, `.dockerignore`, `.gitignore`, `.env.example` |
| **Total Geral** | **890** | **Ativos versionados no repositório** |

### 2.2 Volume de Linhas de Código (LOC) por Segmento

| Segmento | Diretório Raiz | Arquivos de Código | Linhas de Código (LOC) | Participação |
|---|---|---|---|---|
| **Frontend SPA** | `src/` | 482 | 89.778 | 68,4% |
| **Backend API** | `backend/src/` & `backend/prisma/` | 49 | 16.945 | 12,9% |
| **Migrações / Edge Functions** | `supabase/` | 239 | 24.517 | 18,7% |
| **Total de Código Efetivo** | — | **770** | **131.240** | **100,0%** |

---

## 3. Topologia e Anatomia de Diretórios

A estrutura física do repositório organiza-se em blocos funcionais bem delineados:

```text
operix/
├── .claude/               # Configurações de contexto e skills do agente
├── .lovable/              # Artefatos legados do gerador Lovable (35 arquivos)
├── .specify/              # Framework Spec-Driven (constituição, templates, workflows)
├── backend/               # API Node.js/Express + Prisma ORM
│   ├── prisma/            # Esquema relacional (schema.prisma: 1.021 linhas) e migrações
│   ├── src/
│   │   ├── config/        # Carregamento e validação de variáveis de ambiente (Zod)
│   │   ├── lib/           # Clientes Prisma, MinIO, JWT, políticas de permissão
│   │   ├── middleware/    # Middlewares de autenticação JWT e validação
│   │   ├── routes/        # 25 módulos de rotas Express (billing, finance, people, etc.)
│   │   └── services/      # Serviços de background (ingestão meteorológica, rotas)
│   └── Dockerfile         # Imagem Docker da API baseada em node:20-alpine
├── deploy/                # Configurações de deploy reverso Nginx
├── docs/                  # Documentações técnicas de engenharia e referências da Onda 2
│   ├── audit/             # [NOVO] Entregáveis consolidados deste diagnóstico
│   └── referencias-onda2/ # Imagens de referência extraídas de especificações
├── public/                # Ativos estáticos públicos (favicons, manifest.json)
├── scripts/               # Scripts utilitários de manutenção (ex.: i18n-audit.mjs)
├── specs/                 # [NOVO] Especificações Spec-Driven da auditoria
│   └── 000-operix-diagnostic/ # spec.md, plan.md, tasks.md, findings.md, open-questions.md
├── src/                   # Frontend React SPA (Vite + TypeScript)
│   ├── agents/            # Lógica de agentes autônomos internos (49 arquivos)
│   ├── ai/                # Integrações locais com IA e assistentes (14 arquivos)
│   ├── components/        # 204 componentes organizados em 27 subdiretórios funcionais
│   ├── config/            # Configurações de marca e constantes de sistema
│   ├── contexts/          # Provedores de contexto React (TenantContext)
│   ├── hooks/             # 79 custom hooks (auth, dados, mutações, workspace)
│   ├── i18n/              # Dicionários de internacionalização
│   ├── integrations/      # Clientes de integração externa (Supabase facade + types)
│   ├── lib/               # 90 módulos utilitários, clientes HTTP (api.ts) e adaptadores
│   └── pages/             # 29 páginas principais e subrotas (legal, onboarding)
├── supabase/              # Preservação de 192 migrações SQL e 28 Edge Functions Deno
├── docker-compose.yml     # Orquestração dos containers (postgres, minio, api, frontend)
├── Dockerfile.frontend    # Multi-stage build (Node 20 -> Nginx 1.27)
├── nginx.conf             # Roteamento SPA do frontend no container Nginx
├── package.json           # Manifesto de dependências do frontend
└── tailwind.config.ts     # Configuração de temas e tokens visuais Tailwind
```

---

## 4. Inventário de Dependências e Stack Tecnológica

### 4.1 Frontend (`package.json`)

- **Core & Runtime**: React 18.3.1, React DOM 18.3.1, TypeScript 5.8.3, Vite 5.4.19.
- **Roteamento & Estado**: `react-router-dom` 6.30.1, `@tanstack/react-query` 5.83.0 (QueryClient centralizado).
- **Design System & UI**: Tailwind CSS 3.4.17, `tailwindcss-animate`, Radix UI (24 primitivas completas: Dialog, Dropdown, Accordion, Tooltip, Popover, Select, Tabs, etc.), `lucide-react` 0.462.0, `sonner` 1.7.4, `cmdk` 1.1.1.
- **Formulários & Validação**: `react-hook-form` 7.61.1, `zod` 3.25.76, `@hookform/resolvers` 3.10.0.
- **Manipulação de Documentos & PDF**: `jspdf` 4.2.1, `jspdf-autotable` 5.0.7, `pdf-lib` 1.17.1, `pdfjs-dist` 4.10.38, `exceljs` 4.4.0.
- **Mapas & Renderização Gráfica**: `leaflet` 1.9.4, `leaflet.markercluster` 1.5.3, `maplibre-gl` 5.24.0, `three` 0.170.0, `@react-three/fiber` 8.18.0, `@react-three/drei` 9.122.0, `recharts` 2.15.4.
- **Pagamentos & Billing**: `@stripe/stripe-js` 9.2.0, `@stripe/react-stripe-js` 6.2.0.
- **Observabilidade**: `@sentry/react` 10.55.0.
- **Dependências Legadas**: `@supabase/supabase-js` 2.99.3 (ainda presente no bundle).
- **Testes & Ferramental**: `vitest` 3.2.4, `jsdom` 20.0.3, `@testing-library/react` 16.0.0, `@playwright/test` 1.57.0.

### 4.2 Backend (`backend/package.json`)

- **Runtime & Servidor HTTP**: Node.js 20+, Express 4.21.2, `tsx` 4.20.3, TypeScript 5.8.3.
- **Banco de Dados & ORM**: PostgreSQL 16, Prisma ORM 6.10.1 (`@prisma/client` + `prisma` CLI).
- **Autenticação & Segurança**: `jsonwebtoken` 9.0.2 (JWT com expiração de 7 dias), `bcryptjs` 3.0.2, `helmet` 8.1.0, `cors` 2.8.5.
- **Armazenamento de Objetos (Storage)**: `@aws-sdk/client-s3` 3.1069.0 (conectando ao MinIO via S3 API), `multer` 2.2.0 (upload multipart).
- **Comunicação & E-mail**: `nodemailer` 9.0.0 (envio via SMTP transacional).
- **Pagamentos**: `stripe` 18.4.0 (gestão de produtos, subscrições, portal e webhooks).
- **Validação de Esquemas**: `zod` 3.25.67.
- **Logging**: `morgan` 1.10.0.

---

## 5. Inventário de Infraestrutura, Deploy e Armazenamento

### 5.1 Composição Docker (`docker-compose.yml`)

A infraestrutura auto-hospedada é composta por 4 serviços interdependentes:
1. **`postgres`**: Imagem `postgres:16-alpine`. Persistência em volume nomeado `postgres_data`. Healthcheck nativo via `pg_isready`.
2. **`minio`**: Imagem `minio/minio:latest`. Console administrativo exposto na porta local `9001` e API S3 na porta `9000`. Persistência em `minio_data`.
3. **`api`**: Container Node.js executando a aplicação compilada em TypeScript (`node dist/index.js`), porta `4000`. Depende do Postgres e MinIO saudáveis.
4. **`frontend`**: Multi-stage build compilando o bundle Vite e servindo arquivos estáticos através do Nginx 1.27-alpine na porta `80` (repassada para `8080` no host).

### 5.2 Mapeamento de Variáveis de Ambiente e Segredos

A tabela abaixo resume as variáveis identificadas nos manifestos `.env.example` (raiz e backend):

| Variável | Escopo | Finalidade / Serviço Vinculado |
|---|---|---|
| `DATABASE_URL` | Backend | Conexão relacional PostgreSQL (`postgresql://...`) |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Backend | Assinatura e ciclo de vida de tokens de autenticação |
| `CORS_ORIGIN` | Backend | Domínios autorizados para requisições cross-origin |
| `MINIO_ENDPOINT` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Backend | Configuração do serviço de storage compatível com S3 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Backend | Servidor de correio para faturas e convites |
| `STRIPE_SANDBOX_API_KEY` / `STRIPE_WEBHOOK_SECRET` | Backend | Integração com Stripe Billing & Subscrições |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Backend | Extração documental por OCR e assistentes financeiros de IA |
| `TOMORROW_API_KEY` / `METEOSTAT_RAPIDAPI_KEY` / `NASA_API_KEY` | Backend | Ingestão e previsão de eventos meteorológicos (Radar de Granizo) |
| `OPENROUTE_API_KEY` | Backend | Cálculo de rotas e geocodificação de técnicos/oficinas |
| `VITE_API_URL` | Frontend | Endpoint base da API própria (`/api`) |
| `VITE_PAYMENTS_CLIENT_TOKEN` | Frontend | Token público para Stripe Elements |

---

## 6. Sinais de Risco e Débitos Técnicos Críticos Identificados

Durante a varredura minuciosa do repositório, foram detectados os seguintes sinais de risco de alta gravidade:

### 🔴 Risco 1: *Silent Failure Antipattern* no Cliente Supabase
- **Arquivo**: [src/integrations/supabase/client.ts:8-235](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/integrations/supabase/client.ts#L8-L235)
- **Descrição**: O cliente Supabase possui uma trava que intercepta requisições de rede em ambiente dev/docker e instancia um `noopSupabaseFacade()`. Essa fachada resolve qualquer query (`select`, `insert`, `update`, `rpc`, `storage`, `channel`) com `{ data: null, error: null }`.
- **Consequência**: Telas e componentes que ainda dependem do Supabase não emitem erro visual nem crasham; simplesmente renderizam listas em branco ou ignoram cliques do usuário, dando a falsa impressão de estarem "estáveis".
- **Extensão**: 48 arquivos no frontend ainda contêm referências diretas a `@/integrations/supabase/client`.

### 🔴 Risco 2: Sondas de Debug Residuais em Produção/Desenvolvimento
- **Arquivos**: [src/App.tsx:81, 103](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/App.tsx#L81), [src/hooks/useAuth.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useAuth.tsx), [src/hooks/useWorkspace.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useWorkspace.tsx), [src/hooks/usePermission.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/usePermission.tsx), [src/components/ProtectedRoute.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/ProtectedRoute.tsx), [src/components/PermissionGuard.tsx](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/PermissionGuard.tsx) (27 ocorrências no total).
- **Descrição**: Código de instrumentação temporário deixado no repositório disparando `fetch("http://127.0.0.1:7777/event", ...)` a cada transição de rota, verificação de permissão e autenticação.
- **Consequência**: Erros constantes de conexão recusada no console do navegador e desperdício de ciclos de processamento no cliente.

### 🟡 Risco 3: Fragmentação e Duplicação no Modelo de Domínio
- **Arquivo**: [backend/prisma/schema.prisma](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma)
- **Descrição**: Coexistência de múltiplas entidades para conceitos idênticos ou sobrepostos:
  - *Clientes*: `Client` (legado/OS), `BillingClient` (faturas) e `Person(type="client")` (cadastros).
  - *Identidade*: `User` (autenticação), `AppUser` (aplicação), `Profile` (exibição) e `Person` (colaboradores/prestadores).
- **Consequência**: Desconexão de dados entre módulos (ex.: alterar dados de um cliente no cadastro não reflete no faturamento ou nas ordens de serviço).

### 🟡 Risco 4: Acoplamento de Caminhos Absolutos de Deploy
- **Arquivos**: [docker-compose.yml:40, 84](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docker-compose.yml#L40) e [docker-compose.dev-alex.yml:5, 44](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docker-compose.dev-alex.yml#L5)
- **Descrição**: O parâmetro `build.context` aponta para `/home/deploy/apps/nexus/QW-Nexus-`.
- **Consequência**: Impossibilita o build reprodutível em ambientes de desenvolvimento locais ou novos servidores sem edição manual do arquivo.

### 🟡 Risco 5: Ausência de Testes Automatizados no Backend
- **Arquivo**: [backend/package.json](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/package.json)
- **Descrição**: Não há frameworks de teste unitário ou de integração configurados no backend (zero arquivos de teste em `backend/src/`). O frontend possui apenas 3 testes unitários pontuais.

---

## 7. Próximos Passos — Escopo da Fase 2

Com a conclusão do Inventário do Repositório, a auditoria avança para a **Fase 2 — Arquitetura e Modelo de Dados**, que focará em:

1. **Mapeamento do Esquema Relacional Completo**: Gerar o diagrama de entidades e relacionamentos (ERD) a partir de `schema.prisma` e contrastar com as 192 migrações de `supabase/migrations/`.
2. **Auditoria de Domínio de Identidade & Acesso**: Investigar a fundo a diferenciação entre **Colaboradores** (`Person`), **Utilizadores** (`User`/`AppUser`) e **Técnicos Externos**, mapeando como permissões e workspaces são aplicados.
3. **Mapeamento do Fluxo Operacional e Financeiro**: Detalhar as tabelas de OS, Produção, WEEKLOG, Faturas, Pagamentos e Distribuição de Lucros.
4. **Inventário de Funções e Serviços de Background**: Mapear as 28 Edge Functions legadas em relação às rotas Express já implementadas em `backend/src/routes/`.
5. **Auditoria de Storage & Realtime**: Mapear como arquivos (fotos de vistoria, comprovantes, faturas em PDF) e eventos em tempo real estão sendo persistidos e consumidos.
