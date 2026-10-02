# AGENTS.md — Operix Engineering Control Plane

Primary instructions for any coding agent working in this repository.

The repository is the memory. Do not reconstruct project history when the answer already exists in versioned artifacts. Load the smallest context needed for the current task.

## 1. Context loading order

Default:
1. Read this `AGENTS.md`.
2. Read the current spec/task artifacts only.
3. Inspect the exact code paths and tests touched.
4. Read `docs/ai/OPENAI_AGENT_CONTEXT.md` only for cross-spec/domain context.
5. Read historical specs/ADRs only when referenced or when a contradiction is discovered.
6. Do not read meeting transcripts by default. Frozen specs/acceptance are the normal execution authority.

For Phase 1 reconciliation, prefer:
- `specs/phase1-business-flow-reconciliation/spec.md`
- `specs/phase1-business-flow-reconciliation/decisions.md`
- `specs/phase1-business-flow-reconciliation/acceptance.md`
- `specs/phase1-business-flow-reconciliation/plan.md`
- `specs/phase1-business-flow-reconciliation/tasks.md`

Acceptance IDs are semantic compression. Read the named acceptance definition instead of asking prompts to restate it.

## 2. Source-of-truth hierarchy

Unless a human explicitly overrides:
1. Current approved specification / acceptance contract.
2. Current approved ADRs / decisions.
3. Current canonical code + versioned migrations.
4. Prior approved specs and regression evidence.
5. `docs/ai/OPENAI_AGENT_CONTEXT.md`.
6. Historical reports / handoffs.
7. Meeting transcripts / raw notes.

Never silently resolve a conflict between higher-priority sources. Stop the affected work, report the conflict concisely, and propose the smallest deterministic resolution.

## 3. Canonical architecture

`React / Vite`
→ authenticated API transport
→ `Express`
→ `RequestContext / AuthZ`
→ focused domain services
→ `Prisma / PostgreSQL`
+ MinIO/adapters where needed.

Engineering direction:
- brownfield selective redesign, not rewrite;
- reuse existing code where sound;
- no parallel authority;
- Git is source of truth;
- spec-first and test-first;
- preserve tenant isolation, auditability, idempotency and historical evidence.

Do not reintroduce:
- Supabase as parallel domain authority;
- localStorage as business authority;
- client-controlled tenant/audit fields;
- Float money in canonical backend logic;
- legacy Finance models as current authority.

## 4. Non-negotiable invariants

### Tenant
`RequestContext.activeWorkspaceId` is tenant authority.
Never trust body/query/header tenant IDs as owning authority without server validation.
Foreign concrete resource IDs should normally not leak existence.

### Money
Backend:
- Prisma `Decimal`;
- `Decimal(12,2)` where applicable;
- explicit ISO currency;
- HTTP monetary values as decimal strings where possible.
Never use floating-point arithmetic for canonical money.

### Canonical business flow
`Budget / direct ProductionOrder`
→ `Production`
→ `WEEKLOG`
→ `Validation`
→ `PaymentList`
→ `Invoice / Finance`
→ `Payments / Distribution`

WEEKLOG != PaymentList.
PaymentList is commercial recognition authority.
Finance consumes canonical PaymentList state.

### Finance
- `pending` contributes to Expected.
- `paid` contributes to Received.
- a paid List must not remain in Expected.
- pre-invoice/non-authoritative states have zero revenue effect.
- Available per currency = Received - effective Expenses - effective settled ObligationPayments.
- no FX/cross-currency total in Phase 1.
- Distribution has zero cash effect.
- settlement is cash movement and must not duplicate Expense.

### WEEKLOG
- operational week: Sunday 00:00 through Saturday 23:59:59.999 in workspace timezone;
- persisted in UTC;
- validation rounds are versioned;
- coverage snapshots are immutable after submission;
- rectification preserves lineage/history;
- later execution must not rewrite historical validation evidence.

## 5. Authorization

Use server-side authorization primitives.

Preserve:
- workspace boundary;
- object boundary;
- client boundary;
- capability boundary;
- optional `siteKey` scope;
- revocation semantics.

Current client-safe capabilities:
- `budget.approve`
- `weeklog.validate`
- `payment_list.review`
- `invoice.view`
- `client.collaborators.manage`

Client collaborators never receive internal Finance ledger authority.

Do not create route aliases merely to satisfy tests. Test canonical active routes.

## 6. Migration policy

Use versioned forward-only Prisma/PostgreSQL migrations.

Default:
- expand-contract;
- additive fields;
- safe backfills;
- tenant-safe foreign keys;
- historical rows preserved;
- replayable from fresh PostgreSQL.

Never:
- use `prisma db push` for release changes;
- edit already-published migrations to rewrite history;
- drop historical evidence by convenience.

If an approved task says no migration but implementation appears to require one, stop and report first.

For schema work verify:
- `prisma validate`;
- `prisma migrate status`;
- fresh PostgreSQL replay when risk justifies it.

## 7. Git controller

Policy:
- `main` = frozen production;
- `develop/operix-core` = integration;
- feature/fix branch per workstream;
- no force push;
- no published-history rewrite;
- no production/main merge before staging/regression/migrations/homologation.

Per phase:
1. Verify branch / HEAD / worktree.
2. Confirm approved baseline.
3. Implement only current phase.
4. Run focused tests.
5. Run required regressions.
6. Run quality gates.
7. Commit atomically.
8. Do not push/deploy unless explicitly requested.
9. Stop for human review before next phase.

Do not stage untracked reference/sample assets unless explicitly requested.

## 8. Test controller

Do not weaken tests merely to obtain GREEN.

Classify failures:
- intended RED for future phase;
- regression;
- harness defect;
- environment/external dependency;
- contract ambiguity.

Already-GREEN behavior should not be rewritten without a new failing acceptance proving a defect.

Concurrency/idempotency/security changes should use real PostgreSQL behavior when the race matters.

## 9. Token/context economy

Prefer repository references over prompt repetition.

Do not restate entire specs in reports or implementation notes.
Use acceptance IDs and ADR IDs.
Do not narrate routine successful commands.
Do not print large successful logs.

Report by exception:
- failed checks;
- architecture decisions;
- migrations;
- authorization/security changes;
- new risks;
- unresolved ambiguity.

Aggregate routine success:
- `59/59 PASS`
- `typecheck PASS`
- `build PASS`

For review:
- inspect baseline SHA → new SHA diff;
- compare against named acceptance IDs;
- expand beyond the diff only when hidden coupling/risk requires it.

## 10. Phase completion report controller

A final report is mandatory but concise:

```text
PHASE RESULT

Phase:
Baseline SHA:
Commit SHA:

Scope completed:
- ...

Acceptance:
- current-phase: X/X GREEN
- remaining intentional RED: N
- runtime/homologation pending: N

Regression:
- suite/spec: X/X PASS

Quality:
- frontend typecheck: PASS/FAIL
- backend typecheck: PASS/FAIL
- frontend build: PASS/FAIL
- backend build: PASS/FAIL
- lint: PASS/FAIL
- migrations: current/replay status

Architecture / migrations:
- only material changes

Risks / unresolved:
- none
or
- concise blockers

Git status:
- ...

Next allowed phase:
- ...
```

Detailed command logs are required only when a gate fails or the user explicitly requests them.

## 11. Stop conditions

Stop before continuing when:
- current work changes a frozen business rule;
- migration contradicts policy;
- high-priority sources conflict;
- tenant isolation would weaken;
- audit/history would be destroyed;
- tests would need weakening;
- scope crosses into a future phase without approval;
- push/deploy/production action was not explicitly authorized.

## 12. Broader context

For cross-spec semantics, actors, Finance, WEEKLOG, PaymentList, legacy boundaries and current execution state, read:

`docs/ai/OPENAI_AGENT_CONTEXT.md`

Do not load it for every local task unless necessary.
