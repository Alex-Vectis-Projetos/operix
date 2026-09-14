# Operix — Arquitetura de Software e Padrões de Sistema

**Padrão Metodológico**: Spec-Driven Architecture, Clean Architecture & Domain-Driven Design (DDD).

---

## 1. Topologia e Stack Tecnológica

O sistema segue uma arquitetura em camadas bem definida, sem dispersão de stack:

```text
┌───────────────────────────────────────────────────────────┐
│              Frontend SPA (React 18 + Vite)                │
│    TanStack Query (Estado Remoto) · Tailwind CSS / Radix  │
└─────────────────────────────┬─────────────────────────────┘
                              │ HTTP / REST (Bearer JWT)
                              ▼
┌───────────────────────────────────────────────────────────┐
│                   Backend API (Node.js 20)                 │
│                                                           │
│  [HTTP Layer]           Express Router · Zod Validation   │
│                                │                          │
│  [Security Layer]       Auth Middleware · RequestContext  │
│                                │                          │
│  [Application Layer]    Domain Services · Idempotency     │
│                                │                          │
│  [Infrastructure Layer] Prisma ORM · MinIO S3 · Adapters  │
└─────────────────────────────┬─────────────────────────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
   ┌───────────────────────┐     ┌───────────────────────┐
   │ PostgreSQL 16 (Rel.)  │     │ MinIO Object Storage  │
   │  44 Modelos Prisma    │     │  Buckets Particionados│
   └───────────────────────┘     └───────────────────────┘
```

---

## 2. O `RequestContext` Server-Side (P0 de Segurança)

Para erradicar falhas do tipo BOLA/IDOR (OWASP API1), o backend não confia em identificadores enviados pelo cliente. Toda requisição autenticada passa pelo middleware que constrói o `RequestContext`:

```typescript
export interface RequestContext {
  /** ID do usuário autenticado no JWT */
  readonly actorUserId: string;

  /** Papel global da plataforma (platform_admin | user) */
  readonly platformRole: "platform_admin" | "user";

  /** Workspace ativo resolvido no servidor (se aplicável) */
  readonly activeWorkspaceId?: string;

  /** Papel do usuário dentro do workspace ativo (owner | admin | technician | member) */
  readonly membershipRole?: "owner" | "admin" | "technician" | "member";

  /** ID do registro de Person correspondente ao técnico */
  readonly technicianPersonId?: string;

  /** Escopo de operação da requisição */
  readonly scope: "workspace" | "technician_personal";

  /** Capacidades e permissões avaliadas */
  readonly capabilities: ReadonlyArray<string>;
}
```

### Invariantes de Autorização:
- Se `scope === 'technician_personal'`, as operações são filtradas estritamente por `technicianPersonId` ou `actorUserId`.
- Se `scope === 'workspace'`, o `activeWorkspaceId` deve ser validado contra as membresias ativas do usuário antes de qualquer consulta ao banco.
- Consultas Prisma **nunca** utilizam cláusulas `where` desprovidas do contexto de tenant obrigatório.

---

## 3. Modelo de Storage e Documentos (MinIO / S3)

O MinIO é utilizado para armazenamento de evidências fotográficas, PDFs de orçamento e listas de faturamento:

### Regras de Governança de Storage:
1. **Ownership por Entidade e Tenant**:
   Todo objeto salvo possui vínculo com um `workspaceId` (ou contexto pessoal) e um `entityId` (`production_order`, `budget`, `payment_list`).
2. **Caminhos Gerados pelo Servidor**:
   O cliente nunca define a chave de objeto (*object key*). O backend gera chaves determinísticas no formato:
   `tenants/{workspaceId}/{entityType}/{entityId}/{uuid}.{ext}`
3. **Download Protegido com URLs Assinadas**:
   - Proibido expor URLs públicas para documentos privados;
   - Proibido passar tokens JWT em query string de download;
   - Downloads utilizam Presigned URLs geradas pelo MinIO com TTL curto (máximo de 15 minutos).
4. **Validação de Conteúdo Real**:
   Uploads inspecionam o *magic number* do buffer para validar o tipo MIME real, barrando arquivos executáveis mascarados.

---

## 4. Organização Modular Alvo do Código

À medida que cada fatia vertical for migrada, o código deve convergir para uma estrutura modular com fronteiras claras:

### Backend:
```text
backend/src/
├── config/              # Variáveis de ambiente validadas com Zod
├── middleware/          # JWT, RequestContext, ErrorHandler
├── modules/
│   ├── tenancy/         # Workspaces, Memberships, Policies
│   ├── budgets/         # Orçamentos, Revisões, Danos
│   ├── production/      # Ordens de Produção, Fotos, Timeline
│   ├── weeklogs/        # Consolidação semanal, Idempotência
│   ├── payment-lists/   # Listas de faturamento, Importação
│   └── finance/         # Conciliação, Despesas, Repasses
├── integrations/        # Adapters (MinIO, SMTP, OCR, Clima)
└── shared/              # Utilitários de banco, erros e logging
```

### Frontend:
```text
src/
├── app/                 # Configuração de rotas e providers
├── features/            # Fatias verticais de UI (components, hooks, api)
│   ├── budgets/
│   ├── production/
│   ├── weeklogs/
│   ├── payment-lists/
│   └── finance/
├── components/ui/       # Design system e primitivos compartilhados
└── lib/                 # Cliente de API e utilitários
```
