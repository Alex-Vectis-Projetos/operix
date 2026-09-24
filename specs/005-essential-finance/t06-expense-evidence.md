# T06 canonical Expense evidence

## Scope and product diff

T06 adds only the canonical Expense lifecycle under `/api/finance/v2`: `POST /expenses`, `GET /expenses`, `GET /expenses/:expenseId`, and `POST /expenses/:expenseId/reverse`. The product diff is limited to `backend/src/services/expenseService.ts` and `backend/src/routes/financeV2.ts`; the focused integration suite and synchronized normative harness are test-only changes. There are no schema, migration, frontend, package, legacy-runtime, Distribution, Obligation, or settlement changes.

The approved schema was used unchanged. `Expense` has `id`, `workspaceId`, Decimal(12,2) `amount`, `currencyCode`, `category`, `occurredOn` (`@db.Date`), optional `description`, `status`, the five optional typed context foreign-key columns, creation audit fields, and reversal audit fields. Its `@@index([workspaceId, status, occurredOn])` is retained. `FinanceIdempotency` retains its unique `(workspaceId, actorUserId, actionNamespace, idempotencyKey)` constraint. Fresh validation reports exactly 11 migrations and no migration 12.

## HTTP and authority contract

Create accepts only the strict DTO `{ amount: decimal-string, currencyCode: three-uppercase-ASCII-letter string, category, occurredOn: YYYY-MM-DD, description?, context? }` and requires `Idempotency-Key`. It returns 201 for the first request and 200 with `idempotent: true` for a matching replay. Numeric, scientific, locale-formatted, over-precision money, malformed/invalid calendar dates, lowercase currency, and client-supplied authority/audit/status fields are rejected with 422.

List returns `{ items }` in deterministic `occurredOn DESC, createdAt DESC, id ASC` order. Detail is scoped by `(id, activeWorkspaceId)` so absent and foreign IDs both return 404. Reverse accepts only `{ reason }`, requires `Idempotency-Key`, conditionally changes the original effective row to `reversed`, and returns the same resource. There is no update or delete Expense route and no hard delete.

All workspace and actor values are derived from `RequestContext`; request body/query values are never authority. Owner/admin is allowed, including the owner of a personal workspace. Linked technician and client capability requests receive 403; an unauthenticated request receives 401. Foreign context objects and foreign Expense IDs receive 404 without existence leakage.

## Exact values, contexts, audit, and idempotency

Money is parsed as `Prisma.Decimal`, bounded by the approved Decimal(12,2) capacity, and serialized at the response boundary as a two-decimal string. It is never passed through JavaScript `Number`. The business date is semantically checked then persisted as the requested UTC calendar date and returned as `YYYY-MM-DD`.

The optional context is a strict one-of tagged union: `payment_list`, `production_order`, `technician_person`, `client`, or `document`. Each target is read using `id + activeWorkspaceId`; all five same-workspace kinds are covered by real HTTP tests and a foreign PaymentList is rejected without an Expense write.

Creation records server `workspaceId` and `createdByUserId`. Reversal retains the same row and immutable monetary/context/creation fields, then records server `reversedAt`, `reversedByUserId`, and the validated reason. Create and reverse hash normalized input with SHA-256 and use the approved scoped idempotency record. Same key and normalized request replays the resource; a changed request produces `409 IDEMPOTENCY_KEY_REUSED`. A conditional `updateMany(... status: effective)` protects the reversal state transition. Concurrent create and matching concurrent reverse requests converge to one Expense/resource state.

## Finance and legacy integration

Real HTTP creation of EUR `3000.00` against a paid EUR `5000.00` list changes the summary from expenses `50.10`, available `4949.90` to expenses `3050.10`, available `1949.90`; reversal restores the original row's contribution and summary returns to `50.10` / `4949.90`. Reversed-only currency facts remain excluded by the existing T05 summary semantics.

The concurrency test snapshots `FinancialRecord`, `PaymentList.status`, `recognizedTotal`, and `sourceDocumentTotal` around Expense create/reverse. They remain unchanged: T06 creates no `FinancialRecord`, `PaymentOrder`, or `ServiceOrderDistribution`, and proves `FIN-NO-SPEC004-MUTATION-01` through a successful canonical mutation rather than fixture-only seeding.

## Executable verification — 2026-09-23

- Fresh disposable PostgreSQL 16 at localhost:55433: all 11 migrations applied; `prisma validate` and `migrate status` PASS.
- `essential-finance-expenses.test.ts`: **7/7 PASS**, 0 skip, 0 todo.
- T05 summary regression: **8/8 PASS**. Schema regression: **7/7 PASS**.
- Spec001 **17/17**, Spec002 **59/59**, Spec003 **137/137**, Spec004 **127/127**: **340/340 PASS** on the explicit serial regression commands.
- Whole non-normative suite, serial (`--maxWorkers=1 --minWorkers=1`): **381/381 PASS** across **85/85** suites, 0 failed, 0 skipped. The earlier parallel invocation can skip the isolated T06 suite because unrelated suites share destructive fixture cleanup; the serial result is the authoritative aggregate gate.
- Normative acceptance: **33 discovered; 21 GREEN; 12 legitimate future RED; 0 skip; 0 todo; 0 harness defects; no false GREEN or false RED.** Newly GREEN: `EXPENSE-CREATE-01`, `EXPENSE-DECIMAL-01`, `EXPENSE-LINKAGE-01`, `EXPENSE-AUDIT-01`, `EXPENSE-TENANT-01`, `EXPENSE-IDOR-01`, and `FIN-NO-SPEC004-MUTATION-01`. Remaining future RED: `DIST-MANUAL-01`, `DIST-NO-AUTO-RULE-01`, `DIST-PARTICIPANT-01`, `DIST-AUDIT-01`, `DIST-TENANT-01`, `OBLIGATION-CREATE-01`, `OBLIGATION-NO-FIXED-CADENCE-01`, `OBLIGATION-PAY-01`, `OBLIGATION-PAY-IDEMPOTENT-01`, `OBLIGATION-TENANT-01`, `OBLIGATION-AUDIT-01`, and `FIN-TECH-OWN-01`.
- Backend typecheck/build, root typecheck, and frontend production build PASS. Lint has 0 errors and only the pre-existing `src/components/production/ProductionBoard.tsx:164` `react-hooks/exhaustive-deps` warning.
- Source audit found no unsafe authority use, `Number`, `parseFloat`, `parseInt`, legacy writes, or Expense deletion. `Decimal#toFixed(2)` is response serialization only. Router inventory is the existing `GET /summary` plus exactly the four T06 Expense routes.

The disposable database container is removed after the final local checkpoints; no credentials are persisted.
