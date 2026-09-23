# T03/T04 canonical schema and forward-migration evidence

Scope is deliberately limited to the canonical persistence boundary. No `/api/finance/v2` route, service, UI, or legacy-authority behavior was added in this checkpoint.

## Canonical persistence contract

- `Expense`, `Distribution`, `FinancialObligation`, `ObligationPayment`, and `FinanceIdempotency` use PostgreSQL `DECIMAL(12,2)` for monetary facts and explicit three-letter uppercase currency codes.
- The frozen status, allocation, participant, and expense-context enums are persisted as PostgreSQL enums.
- Context and participant links are explicit, tenant-scoped foreign keys. A composite foreign key prevents an expense/distribution from citing a List, item, operation, person, client, or document from another workspace.
- A `Distribution` has one `FinancialObligation`; an obligation has one `ObligationPayment`. Both lineage links include the workspace in their database foreign key, preventing cross-tenant chaining.
- State-dependent checks require reversal/cancellation/settlement audit evidence. Money-history user references use `ON DELETE RESTRICT`; a referenced actor cannot be deleted.
- `FinanceIdempotency` has one scoped uniqueness boundary: `(workspace_id, actor_user_id, action_namespace, idempotency_key)`.
- The migration adds only new objects and supporting composite uniqueness to `people`/`documents`; it does not alter or delete legacy finance data or Spec004 commercial lifecycle data.

## Executed 2026-09-23

- Prisma schema validation and client generation completed successfully.
- A disposable local PostgreSQL 16 fixture (`operix_spec005_test@127.0.0.1:55432`) replayed all **11** repository migrations, including `20260923140000_spec005_essential_finance_domain`; `prisma migrate status` reported the database current.
- `tests/integration/essential-finance-schema.test.ts`: **7/7 passed**. It verifies metadata-level Decimal precision and non-null tenancy, deployed objects, currency/amount/context checks, participant/allocation bounds, tenant-scoped foreign keys, lifecycle audit checks, one-obligation/one-payment enforcement, parent/actor delete restriction, and idempotency scope uniqueness.
- The 33-scenario normative suite is intentionally still incomplete at this T03/T04 boundary: **1 passed / 32 failed / 0 skipped / 0 todo**. The sole green is `FIN-NO-FLOAT-01`, now satisfied by the canonical `Expense.amount Decimal` schema. The other 32 tests remain `404` at the unimplemented v2 HTTP surface; no route was introduced to make them green.

## Deferred service invariants

The database protects local shape, audit state, and tenant lineage. Command-layer work in T05–T08 remains responsible for payment-list currency equality, resolved allocation arithmetic against List/item totals, authorization, idempotent response replay, and the transactionally coupled obligation/payment state transition.

## Prisma drift review

`prisma migrate diff --from-url <replayed-db> --to-schema-datamodel backend/prisma/schema.prisma --script` reports no table, column, enum, precision, or index-shape discrepancy for the canonical models. Its remaining output is expected from the raw PostgreSQL foreign keys and checks that encode the bounded tagged-union/composite-tenant links and immutable actor references (plus pre-existing Prisma-generated constraint-name normalizations). Prisma cannot infer those raw foreign keys because the optional tagged-union fields intentionally share `workspace_id`; the database, migration, and integration suite remain the source of truth for these constraints. No destructive or legacy drift was reported.

## Final closure verification — 2026-09-23

- **Root typecheck classification:** `npm run typecheck` fails at both T03/T04 HEAD and detached T02 checkpoint `c22f027d` with the identical diagnostic: `src/components/payment-lists/PaymentListDetail.tsx(101,1453)`, `TS2322`, `string` not assignable to `PaymentListTransitionStatus`. The T03/T04 product diff and commit history contain no change to that file. This is **PRE-EXISTING T02 CHECKPOINT QUALITY DEBT**, not a T03/T04 regression; the earlier T01/T02 root-typecheck PASS claim was not reproducible from the locked checkpoint.
- A new localhost-only PostgreSQL 16 fixture with a new ephemeral credential replayed all **11** migrations successfully. Prisma validate passed and migration status was current. PostgreSQL metadata confirmed the canonical CHECK constraints, unique constraints, composite tenant foreign keys, and `ON DELETE RESTRICT` history-preservation actions for all five Spec005 tables.
- Prisma diff reported no modeled structural drift. Its output is limited to the intentional raw foreign keys described above and constraint/index naming normalizations (including two pre-existing Spec004 names).
- Spec005 schema suite: **7/7 PASS**. Normative baseline: **33 discovered; 1 PASS (`FIN-NO-FLOAT-01`); 32 expected RED; 0 skip; 0 todo; 0 harness defects; no false green.** The remaining RED classification is **24 RED-MISSING-ROUTE** and **8 RED-AUTHORIZATION**.
- Explicit serial regressions: Spec001 **17/17**, Spec002 **59/59**, Spec003 **137/137**, Spec004 **127/127** — **340/340 PASS**.
- Quality gates: backend typecheck PASS; backend build PASS; Prisma validate PASS; root lint has **0 errors** and one pre-existing `react-hooks/exhaustive-deps` warning at `src/components/production/ProductionBoard.tsx:164`; frontend Vite production build PASS.
- Cleanup: detached T02 verification worktree and disposable PostgreSQL container were removed. No credentials were persisted or committed. No T05 work was started.
