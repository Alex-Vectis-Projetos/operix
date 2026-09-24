# T08 Canonical Obligation and Settlement Evidence

## 1. Scope and Approved Schema Surface

T08 implements the canonical FinancialObligation and ObligationPayment lifecycle under `/api/finance/v2`.
Product changes are strictly isolated to:
- `backend/src/services/obligationService.ts` (new canonical service)
- `backend/src/routes/financeV2.ts` (6 new HTTP endpoints)
- `backend/src/services/distributionService.ts` (downstream cancellation guard)

No changes were made to `backend/prisma/schema.prisma` or `backend/prisma/migrations/**`. Exactly the approved 11 migrations are applied. No migration 12 was created. No frontend code or legacy runtime code was modified. T09+ work has NOT started.

## 2. Route Surface Inventory

The `/api/finance/v2` router now exposes exactly the approved routes:

| Method | Path | Auth / Scope | Purpose |
|---|---|---|---|
| `POST` | `/api/finance/v2/obligations` | `requireAuth`, `owner`/`admin` | Derive and create pending Obligation from active Distribution |
| `GET`  | `/api/finance/v2/obligations` | `requireAuth`, `owner`/`admin`/`tech` (own) | List obligations in active workspace |
| `GET`  | `/api/finance/v2/obligations/:obligationId` | `requireAuth`, `owner`/`admin`/`tech` (own) | Get obligation detail with linked Distribution and Payment |
| `POST` | `/api/finance/v2/obligations/:obligationId/cancel` | `requireAuth`, `owner`/`admin` | Cancel a pending obligation with audit reason |
| `POST` | `/api/finance/v2/obligations/:obligationId/settle` | `requireAuth`, `owner`/`admin` | Atomically settle full obligation into one ObligationPayment |
| `POST` | `/api/finance/v2/obligations/:obligationId/settlements/:paymentId/reverse` | `requireAuth`, `owner`/`admin` | Reverse effective settlement payment with audit reason |

No unauthorized, unapproved, or future (T09/T10) routes exist.

## 3. Obligation Creation Contract & Derivation

`POST /api/finance/v2/obligations` requires an `Idempotency-Key` header and accepts strictly:
```json
{ "distributionId": "<UUID>" }
```
Derived server-side facts (immutable and authoritative):
- `workspaceId`: resolved strictly from `RequestContext.activeWorkspaceId`
- `amount`: resolved from `Distribution.resolvedAmount`
- `currencyCode`: resolved from `Distribution.currencyCode`
- `status`: initialized to `pending`
- `createdByUserId`: resolved from `RequestContext.actorUserId`
- `distribution`: linked via `Distribution.id`

Client authority is strictly rejected: any client attempts to pass `amount`, `currencyCode`, `dueDate`, `installmentNumber`, or scheduling fields are rejected with HTTP `422 Unprocessable Entity` (`z.object({ distributionId: z.string().uuid() }).strict()`).

### No Fixed Cadence
In accordance with `OBLIGATION-NO-FIXED-CADENCE-01`, obligations are created without requiring `dueDate`, monthly cadence, installment count, or payment schedule.

### Distribution Lineage & Uniqueness Policy
`FinancialObligation` has a database unique constraint `@@unique([distributionId])`.
- Creating an obligation for a non-existent or foreign-workspace distribution returns `404 DISTRIBUTION_NOT_FOUND`.
- Creating an obligation for a non-active distribution returns `422 DISTRIBUTION_NOT_ELIGIBLE`.
- Attempting to create a second non-idempotent obligation for the same distribution returns `409 OBLIGATION_ALREADY_EXISTS`.

## 4. Idempotency & Concurrency Convergence

All state mutations use `FinanceIdempotency` keyed by `(workspaceId, actorUserId, actionNamespace, idempotencyKey)`:
- **Create Idempotency**: First create returns `201 Created` (`idempotent: false`). Replaying the same key with identical payload returns `200 OK` (`idempotent: true`) with the original obligation entity.
- **Payload Reuse Conflict**: Reusing the same key with a different `distributionId` returns `409 IDEMPOTENCY_KEY_REUSED`.
- **Concurrent Creation**: Concurrent identical creation requests serialize via database unique constraints and converge cleanly: one wins `201`, one replays `200`, exactly one row persisted, zero `500` or raw error leaks.

## 5. Authorization Matrix & Boundaries

| Actor Role | Context Scope | Create Obligation | Read All | Read Own | Settle | Cancel | Reverse |
|---|---|---|---|---|---|---|---|
| `owner` / `admin` | Active Workspace | ALLOW (201) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| `technician` (own personal ws) | Personal Workspace | ALLOW (201) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| `technician` (member) | Organization Workspace | DENY (403) | DENY (403) | ALLOW (200) | DENY (403) | DENY (403) | DENY (403) |
| `client` | Active Workspace | DENY (403) | DENY (403) | DENY (403) | DENY (403) | DENY (403) | DENY (403) |
| Foreign Workspace User | Foreign Workspace | DENY (403/404) | DENY (404) | DENY (404) | DENY (404) | DENY (404) | DENY (404) |

### Linked Technician Own Scope (FIN-TECH-OWN Closure)
Technician identity is resolved strictly through `RequestContext.technicianPersonId` (database UUID foreign key linkage), NEVER through name, email, or legacy profile IDs.
- `GET /obligations`: Filters to distributions where `participantPersonId == ctx.technicianPersonId`.
- `GET /obligations/:id`: Returns `200` for own obligation, `404` for other technician's obligation.
- Exposes only own status and payment evidence. Does NOT leak workspace aggregate financial summaries (`GET /summary` returns `403`).
- Technicians cannot mutate obligations (`settle` and `cancel` return `403`).

### Participant != Authorization
Creating a Person participant who has no `User` or `AppUser` membership succeeds for economic entitlement and obligation creation, but provisions zero credentials, accounts, or application access.

### Client Internal Denial
Clients retain full operational access (`200 OK` on operational endpoints like `/api/payment-lists`), but receive `403 Forbidden` on `/api/finance/v2/obligations` and `/api/finance/v2/summary`.

### Personal Workspace Owner Authority
A user whose global role is `technician` who owns an active personal workspace (`type: personal`) retains full owner authority to create, list, cancel, settle, and reverse obligations within their personal workspace.

## 6. Cancellation Invariants

`POST /api/finance/v2/obligations/:id/cancel` requires `{ "reason": "<string>" }` and `Idempotency-Key`.
- Only `pending` obligations may be cancelled.
- Atomically updates status to `cancelled`, recording `cancelledAt`, `cancelledByUserId`, and `cancellationReason`.
- Does NOT delete the row. Does NOT affect cash or Available.
- Does NOT cancel or mutate the source `Distribution` (remains `active` with same amount/currency/participant).
- Cancelled obligations can NEVER be settled (`409 OBLIGATION_NOT_SETTLEABLE`).
- Cancellation idempotency: replaying same key/reason returns `200` (`idempotent: true`). Reusing key with different reason returns `409 IDEMPOTENCY_KEY_REUSED`. New key on cancelled obligation returns `409 OBLIGATION_NOT_CANCELLABLE`.
- Concurrent cancellations converge cleanly to a single state transition without errors.

## 7. Settlement Atomicity & Cash Effects

`POST /api/finance/v2/obligations/:id/settle` accepts strictly `{}` (`emptySchema.strict()`) and `Idempotency-Key`.
- **Full Settlement Only**: Rejects partial amounts, installments, remaining amounts, paid dates, or custom amounts (`422 Unprocessable Entity`). No partial settlement exists.
- **Atomicity**: In a single database transaction:
  1. `FinancialObligation.status` transitions from `pending` to `paid`, stamping `paidAt` and `paidByUserId`.
  2. Exactly one `ObligationPayment` is inserted with `status = effective`, `amount = obligation.amount`, `currencyCode = obligation.currencyCode`, `paidAt`, and `paidByUserId`.
- There is never an observable intermediate state with a paid obligation without a payment, or an effective payment for a pending obligation.
- **Summary Cash Effect**:
  - Prior to settlement: Available = Received - Expenses = 5000.00 - 3000.00 = 2000.00 (`settledObligationPayments = 0.00`).
  - Pending obligations have ZERO cash reservation effect.
  - After settlement: Available = 0.00 (`settledObligationPayments = 2000.00`).
- **Settlement Idempotency**:
  - Replaying the same key returns `200 OK` with original payment evidence, exactly 1 payment record, Available remains 0.00 (cash is deducted once).
- **Second Non-Idempotent Settlement**:
  - Calling settle with a new key on an already paid obligation returns `409 OBLIGATION_NOT_SETTLEABLE`. Payment count remains 1, Available remains unchanged.
- **Concurrent Settlement Protection**:
  - Two simultaneous settlement calls with distinct valid idempotency keys execute under real concurrency: exactly one succeeds (`200 OK`), the other receives a deterministic conflict (`409`), exactly one `ObligationPayment` is created, Available is reduced exactly once.

## 8. Payment Reversal & Audit Preservation

`POST /api/finance/v2/obligations/:id/settlements/:paymentId/reverse` requires `{ "reason": "<string>" }` and `Idempotency-Key`.
- **Audit Preservation**: The `ObligationPayment` record is NEVER deleted. Its status transitions to `reversed`, stamping `reversedAt`, `reversedByUserId`, and `reversalReason`.
- `FinancialObligation.status` transitions to `reversed`, stamping `reversedAt`, `reversedByUserId`, and `reversalReason`.
- **Available Restoration**: Reversal restores Available immediately from 0.00 to 2000.00 (`settledObligationPayments` becomes 0.00). No compensating `Expense` is created.
- **No Reopen Invariant**: A reversed obligation does NOT reopen to `pending`. Attempting to settle a reversed obligation returns `409 OBLIGATION_NOT_SETTLEABLE`. Reversal is terminal. If business correction is needed, a new Distribution/Obligation flow must be initiated.
- **Reversal Idempotency**: Replay returns `200 OK`, cash restored once. Same key with different reason returns `409`. New key on reversed payment returns `409`.
- **Concurrent Reversal Protection**: Simultaneous reversal calls converge to exactly one reversal transition and one conflict (`[200, 409]`).

## 9. Downstream Lineage & Cross-Domain Guards

- **Distribution Downstream Guard**: `POST /distributions/:id/cancel` is blocked (`409 DISTRIBUTION_NOT_CANCELLABLE`) if a linked `FinancialObligation` exists with status `pending`, `paid`, or `reversed`. Source distribution is protected against orphaned downstream payable commitments.
- **Cancelled Obligation Does Not Cancel Distribution**: Cancelling an obligation leaves the source distribution active and unchanged.
- **Spec004 Commercial Immutability**: Across all T08 commands (create, settle, reverse), `PaymentList` (status, recognizedTotal, sourceDocumentTotal, itemCount), `PaymentListItem`, `PaymentListEntryClaim`, and `PaymentListConfrontationRun` records remain strictly immutable.
- **Zero Legacy / Expense Side Effects**: T08 commands produce ZERO writes to `Expense`, `FinancialRecord`, `PaymentOrder`, or `ServiceOrderDistribution`.

## 10. Executable Verification Summary — 2026-09-24

### Fresh Database Replay
- Disposable PostgreSQL 16 container (`operix-spec005-t08-final`) on `127.0.0.1:55432`.
- Exactly 11 migrations applied: `Prisma validate` PASS, `Prisma migrate status` PASS (0 pending, schema up to date).

### Test Suite Execution Results

| Suite | File | Tests / Result | Notes |
|---|---|---|---|
| **Focused T08** | `tests/integration/essential-finance-obligations.test.ts` | **7/7 PASS** | Covers all 29 requirements A through AC |
| **T07 Regression** | `tests/integration/essential-finance-distributions.test.ts` | **7/7 PASS** | Downstream guard tested with real T08 commands |
| **T06 Regression** | `tests/integration/essential-finance-expenses.test.ts` | **7/7 PASS** | Zero regressions |
| **T05 Regression** | `tests/integration/essential-finance-summary.test.ts` | **8/8 PASS** | Zero regressions |
| **Schema Regression** | `tests/integration/essential-finance-schema.test.ts` | **7/7 PASS** | Zero regressions |
| **Normative Core** | `tests/integration/essential-finance-red-baseline.test.ts` | **33/33 GREEN** | All 33 normative scenarios passing (0 RED, 0 skip, 0 todo) |
| **Spec 001** | `tests/integration/foundation-security.test.ts`, `tenant-isolation.test.ts` | **17/17 PASS** | Serial independent run |
| **Spec 002** | `tests/integration/budget-production-flow.test.ts` | **59/59 PASS** | Serial independent run |
| **Spec 003** | `weeklog-operational-flow.test.ts`, `service-orders-legacy-sanitization.test.ts`, `weeklog-frontend-contracts.test.ts` | **137/137 PASS** | Serial independent run |
| **Spec 004** | 8 files (schema, invariants, import, confrontation, transition, unit) | **127/127 PASS** | Serial independent run |
| **Specs 001–004 Consolidated** | Serial independent suite runs | **340/340 PASS** | 100% stable baseline preserved |
| **Full Serial Aggregate** | Entire non-normative test suite (23 files) | **395/395 PASS** | Zero failures across entire repository |

### Normative 33 Anti-Vacuous Audit
All 33 scenarios in `tests/integration/essential-finance-red-baseline.test.ts` verified:
- Real HTTP product endpoints reached with authenticated `RequestContext`.
- Real database assertions on PostgreSQL models.
- Meaningful fixtures and positive controls for authorization checks.
- 0 false GREEN, 0 false RED, 0 harness defects.

### Newly GREEN Scenarios (T08 Completion)
1. `OBLIGATION-CREATE-01`: Pending payable derived from active Distribution without cash movement.
2. `OBLIGATION-NO-FIXED-CADENCE-01`: Created without schedule, cadence, or installment constraints.
3. `OBLIGATION-PAY-01`: Atomically settles full obligation into effective ObligationPayment.
4. `OBLIGATION-PAY-IDEMPOTENT-01`: Replays settlement identically without duplicate cash reduction.
5. `OBLIGATION-TENANT-01`: Rejects foreign workspace access with 404.
6. `OBLIGATION-AUDIT-01`: Preserves payment record and reversal audit on reversal.
7. `FIN-TECH-OWN-01`: Linked technician sees own Distribution and Obligation payment status; denied aggregate summary.

### Quality and Security Gates
- Backend typecheck: `tsc --noEmit` **PASS** (code 0).
- Backend build: `tsc -p tsconfig.json` **PASS** (code 0).
- Root lint: `eslint .` **0 errors**, 1 known warning (`ProductionBoard.tsx:164`).
- Frontend build: `vite build` **PASS** (code 0, production bundle built).
- Security source audit: No client control of `workspaceId`, `amount`, `currencyCode`, `paidAt`, `paidBy`, or audit fields. No unsafe floating point math. Zero legacy projection writes.
- Docker cleanup: All temporary test containers removed.
