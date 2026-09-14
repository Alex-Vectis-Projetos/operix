# Operix — Agent Instructions & Engineering Constitution

## 1. Mission & Philosophy
Stabilize, secure, and evolve the existing Operix brownfield system. 
- **Preserve reusable implementation**: Leverage the existing React/Vite SPA, Express API, Prisma models, MinIO S3 integration, and third-party adapters.
- **Do not rewrite for aesthetic reasons**: Avoid big-bang horizontal rewrites.
- **Vertical Slice Engineering**: Refactor, stabilize, and test end-to-end along complete vertical business slices.
- **No Mock Data / No Fake CRUDs**: Every capability must have real server-side authority, schema-backed persistence, and automated test coverage.

## 2. Current Scope & Contracting Phases
- **R0 — Foundation & Authority (Current P0)**: RequestContext, server-side tenant isolation, object authorization, MinIO ownership, Prisma baseline.
- **R1 — Mobile Operational Flow**: Orçamento (Budget) $\rightarrow$ Produção $\rightarrow$ WEEKLOG $\rightarrow$ Retificação.
- **R2 — Commercial Reconciliation & Essential Finance**: Payment List $\rightarrow$ Import/OCR $\rightarrow$ Confronto $\rightarrow$ Canonical Financial Projections.
- **Out of Scope (Deferred/Future)**: R3/R4, Marketplace, generic automation engine, standalone autonomous AI agents, SaaS multi-tenant billing platform. Do NOT implement these opportunistically.

## 3. Hierarchy of Source of Truth
When conflicts arise, resolve them strictly in this order:

### For Product & Business Requirements:
1. **Active Specification** (`specs/<spec-id>/spec.md`)
2. **Accepted ADRs** (`docs/adr/`)
3. **Core Domain Model** (`docs/project/DOMAIN.md`)
4. **Project Master Scope** (`docs/project/PROJECT.md`)
5. **Historical Audit & Meeting Records** (`docs/audit/`, `docs/Reunião Alex Operix 2.txt`)

### For Current System State:
1. **Source Code** (`backend/src/`, `src/`)
2. **Database Schema** (`backend/prisma/schema.prisma`)
3. **Automated Test Suites** (`tests/`, `*.test.ts`)
4. **Audit Diagnostic Reports** (`docs/audit/`)

*Never assume current behavior reflects desired business rules; never assume a documentation draft reflects actual code without verifying active implementation.*

## 4. Inviolable Architectural & Security Rules

1. **Server-Side Tenant & Object Authorization (Zero Trust / CWE-639 / OWASP API1)**:
   - NEVER trust `workspaceId`, `userId`, `role`, or entity IDs passed in query parameters or request bodies.
   - All tenant and identity claims MUST be resolved on the server from the verified JWT bearer session into `RequestContext`.
   - Every read/write operation MUST enforce tenant boundaries and object ownership deny-by-default.
2. **No New Supabase Dependencies**:
   - Do NOT add imports from `@/integrations/supabase/client`.
   - Whenever touching a vertical slice, eliminate its Supabase/noop dependencies completely.
3. **No Business State in LocalStorage**:
   - `localStorage` is permitted strictly for non-critical client preferences (theme, UI sidebar collapse, transient UI filters).
   - Business entities (Budgets, Production, WEEKLOG, Lists, Invoices) MUST be persisted in PostgreSQL via API.
4. **Expand-Contract Database Migrations**:
   - NEVER execute destructive `prisma db push` in shared, staging, or production environments.
   - All schema evolutions MUST be versioned Prisma migrations.
   - Destructive field removals must follow Expand $\rightarrow$ Migrate $\rightarrow$ Contract.
5. **Idempotency & Transactional Integrity**:
   - Operations that produce derived business events (e.g., concluding an OP to generate WEEKLOG) MUST be idempotent and atomic, backed by composite unique constraints or explicit retry/recovery states.
6. **No Secrets or PII in Logs**:
   - NEVER log bearer tokens, JWTs, signed URLs, passwords, API keys, or raw provider payloads.

## 5. The 7-Step Engineering Loop
Every agent and engineer must follow this structured cycle before declaring work done:

```text
1. UNDERSTAND ──> Read active spec, ADRs, and DOMAIN.md. Locate active files, DB models, and legacy paths.
2. PLAN       ──> Produce or update plan.md. List exact files, migrations, risk analysis, and tests.
3. TEST FIRST ──> Write failing unit/integration tests for critical business/tenant invariants.
4. IMPLEMENT  ──> Implement strictly the planned slice. No unrelated changes.
5. VERIFY     ──> Run quality gates: lint, typecheck, unit tests, integration tests.
6. SELF-REVIEW──> Check diff for: tenancy leaks, any-types, silent failures, localStorage, missing tests.
7. HANDOFF    ──> Update tasks.md, record remaining risks/open questions, and obtain human approval.
```

## 6. Definition of Done (DoD) Checklist
A task is NOT done until ALL of the following criteria are satisfied:
- [ ] UI consumes authoritative API endpoints (no mock data, no silent noop facades).
- [ ] Server validates inputs strictly (Zod schemas).
- [ ] Authentication and `RequestContext` enforced.
- [ ] Tenant isolation verified (Workspace A cannot read/mutate Workspace B).
- [ ] Object-level authorization enforced (`own` vs `team` vs `all`).
- [ ] Persistence is transactional and survives page reloads.
- [ ] Error handling is explicit (no silent catches returning null).
- [ ] Retries are idempotent (no duplicate records).
- [ ] No sensitive data in logs.
- [ ] Automated tests pass (unit + integration).
- [ ] Typecheck passes with zero errors (`npm run typecheck`).
- [ ] Linter passes with zero errors (`npm run lint`).
- [ ] Legacy Supabase/noop code removed for the migrated capability.
