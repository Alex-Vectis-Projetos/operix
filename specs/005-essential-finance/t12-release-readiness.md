# Spec 005 T12 Release Readiness & Verification Evidence

## 1. Overview & Release Candidate Scope
This document records the final verification, security audit, migration rehearsal, and release readiness evidence for **Operix Core — Phase 1 (Spec 001 through Spec 005)**.

- **Branch**: `feat/005-essential-finance`
- **T11 Approved Baseline**: `54098256619f3cfa53aff443cdf7e4803c166f39`
- **Release Candidate Version**: Phase 1 Release Candidate 1 (RC1)
- **Status**: **SPEC 005 T12 TECHNICAL PASSED — OPERIX CORE PHASE 1 RELEASE CANDIDATE VERIFIED — STAGING / HOMOLOGATION PENDING EXTERNAL DEPENDENCIES**

---

## 2. Delivered Scope Matrix (Phase 1)

| Functional Domain | Canonical API / Surface | Source of Authority | Access Boundary | Test Coverage | Status |
|---|---|---|---|---|---|
| **Foundation & Tenancy** | `RequestContext`, `/api/auth/*` | Server JWT + DB Membership | Deny-by-default, tenant isolation | Spec 001 (17 tests) | VERIFIED |
| **Budget & Production** | `/api/budgets/*`, `/api/production-orders/*` | PostgreSQL Lineage Constraints | Workspace Owner / Admin / Tech | Spec 002 (59 tests) | VERIFIED |
| **WEEKLOG & Operational Flow** | `/api/weeklogs/*`, Finalization | Monotonic Sequence + DB Unique | Workspace Member / Client Signer | Spec 003 (137 tests) | VERIFIED |
| **Rectification Lifecycle** | `/api/weeklogs/:id/rectifications` | Immutable History + Self-FK | Workspace Admin / Tech | Spec 003 (137 tests) | VERIFIED |
| **PaymentList & Invariants** | `/api/payment-lists/*` | Relational Claims + Monotonic Num | Workspace Admin / Operations | Spec 004 (127 tests) | VERIFIED |
| **Import & Staging** | `/api/payment-lists/import` | MinIO Storage + Staging Items | Workspace Admin | Spec 004 (127 tests) | VERIFIED |
| **Commercial Confrontation** | `/api/payment-lists/:id/confrontation` | Canonical Decision Matrix | Workspace Admin | Spec 004 (127 tests) | VERIFIED |
| **Finance Summary** | `/api/finance/v2/summary` | Projections (PaymentList + Facts) | Workspace Owner / Personal Owner | T05 (8 tests), Normative | VERIFIED |
| **Expenses Ledger** | `/api/finance/v2/expenses` | Immutable Facts + Reversal Audit | Workspace Owner / Personal Owner | T06 (7 tests), Normative | VERIFIED |
| **Manual Distributions** | `/api/finance/v2/distributions` | PaymentList + Target XOR | Workspace Owner / Personal Owner | T07 (7 tests), Normative | VERIFIED |
| **Financial Obligations** | `/api/finance/v2/obligations` | Distribution Lineage + Status Machine | Workspace Owner / Personal Owner | T08 (7 tests), Normative | VERIFIED |
| **Settlement & Reversal** | `/api/finance/v2/obligations/:id/settle` | Atomic ObligationPayment Fact | Workspace Owner / Personal Owner | T08 (7 tests), Normative | VERIFIED |
| **Canonical Finance UI** | `src/pages/FinancialPage.tsx` | Pure TanStack Query V2 Client | Member-aware (Owner vs Tech vs Client)| T11 (10 tests), Unit (62) | VERIFIED |
| **Legacy Authority Retirement**| `/api/financial-records` -> 410 Gone | Archived Legacy Records | Non-executable Archive Only | T09 (5 tests) | RETIRED |

---

## 3. Explicit Intentional Limitations & Out-of-Scope Boundaries

The following capabilities are deliberately out of scope for Phase 1 Essential Finance:
1. **No Accounting ERP**: Operix Core provides operational and cash reconciliation tracking, not double-entry general ledger accounting or tax accruals.
2. **Current-State Only (No Historical As-Of Reporting)**: Projections reflect current operational and settlement state; no retro-dated balance sheet views.
3. **No FX / Multi-Currency Aggregation**: Each currency bucket is independent. Cross-currency totals (e.g. BRL + USD + EUR) are strictly forbidden.
4. **No Partial Settlement / Installments**: Obligation settlements are full cash-out events deriving from the exact resolved distribution amount.
5. **Manual Distribution Only**: Automatic profit calculation rule engines (`ProfitRule`) are deprecated and retired from the active UI.
6. **No Safe Automatic Migration of Legacy Data**: Ambiguous legacy financial records without explicit currency or tenant context remain read-only archive facts (`NO_SAFE_AUTOMATIC_MIGRATION`).
7. **SaaS Billing & Stripe Kept Separate**: Workspace subscription billing is distinct from operational customer invoicing and essential finance.
8. **Responsive Web Only**: No native mobile application artifacts are provided.

---

## 4. Fresh Environment Rehearsal & Database Verification

### 4.1. Migration Replay from Zero
- Executed against disposable PostgreSQL 16 container (`operix_local:55432`).
- Command: `npx prisma migrate status --schema=backend/prisma/schema.prisma`
- Result: **11 migrations found in prisma/migrations. Database schema is up to date!**
- Drift: Zero drift.
- Migration Count: Exactly 11 forward-only migrations. No migration 12.

### 4.2. Schema Validation
- Command: `npx prisma validate --schema=backend/prisma/schema.prisma`
- Result: `The schema at backend\prisma\schema.prisma is valid 🚀`
- Git Diff: `git diff 46afcf20..HEAD -- backend/prisma` is completely **empty**.

### 4.3. Pre-Spec005 Upgrade Path
- Immediately prior migration: `20260921140000_spec004_import_staging_unblock`
- Spec005 migration: `20260923140000_spec005_essential_finance_domain`
- All legacy financial tables (`financial_records`, `financial_events`, `profit_rules`, `reconciliations`) are preserved intact as non-authoritative read-only archives.

### 4.4. Legacy Classifier Execution
- Command: `npx tsx backend/scripts/classifyLegacyFinance.ts`
- Result: Mode `dry-run`, zero database writes, explicit `ARCHIVE_ONLY` classification for historical profit rules and financial records.
- Negative Apply Control: `npx tsx backend/scripts/classifyLegacyFinance.ts --apply` confirmed `NO_SAFE_AUTOMATIC_MIGRATION` (zero writes performed).

---

## 5. Automated Regression Test Results

### 5.1. Summary Overview
- **Prior Specs Consolidated (Spec 001–004)**: **340/340 PASS (100%)**
- **Spec 005 Normative Suite**: **33/33 GREEN (100%)**
- **Spec 005 Backend Vertical Suites**: **41/41 PASS (100%)**
- **Unit & Contract Suites**: **62/62 PASS (100%)**
- **Full Serial Aggregate**: **454/454 PASS (100%)** across 27 files

### 5.2. Breakdown by Specification Suite

| Specification / Suite | Target Test Files | Test Count | Result |
|---|---|---|---|
| **Spec 001** (Foundation & Tenancy) | `foundation-security.test.ts`, `tenant-isolation.test.ts` | 17 | **17/17 PASS** |
| **Spec 002** (Budget -> Production) | `budget-production-flow.test.ts` | 59 | **59/59 PASS** |
| **Spec 003** (WEEKLOG & Rectification) | `weeklog-operational-flow.test.ts`, `service-orders-legacy-sanitization.test.ts`, `tests/unit/weeklog-frontend-contracts.test.ts` | 137 | **137/137 PASS** |
| **Spec 004** (PaymentList & Confrontation) | `payment-list-schema.test.ts`, `payment-list-invariants.test.ts`, `payment-list-import.test.ts`, `commercial-confrontation.test.ts`, `external-weeklog-import.test.ts`, `legacy-payment-order-transition.test.ts`, `tests/unit/payment-list-frontend-contracts.test.ts`, `tests/unit/payment-list-ui-contracts.test.ts` | 127 | **127/127 PASS** |
| **Spec 005 Normative Baseline** | `essential-finance-red-baseline.test.ts` | 33 | **33/33 GREEN** |
| **Spec 005 T09 Legacy Transition** | `essential-finance-legacy-transition.test.ts` | 5 | **5/5 PASS** |
| **Spec 005 T08 Obligations & Settle** | `essential-finance-obligations.test.ts` | 7 | **7/7 PASS** |
| **Spec 005 T07 Manual Distributions** | `essential-finance-distributions.test.ts` | 7 | **7/7 PASS** |
| **Spec 005 T06 Expenses Ledger** | `essential-finance-expenses.test.ts` | 7 | **7/7 PASS** |
| **Spec 005 T05 Finance Summary** | `essential-finance-summary.test.ts` | 8 | **8/8 PASS** |
| **Spec 005 Schema Constraints** | `essential-finance-schema.test.ts` | 7 | **7/7 PASS** |
| **Spec 005 T11 Canonical UI** | `tests/unit/finance-ui-contracts.test.tsx` | 10 | **10/10 PASS** |
| **Spec 005 T10 Frontend Client** | `tests/unit/finance-v2-client-contracts.test.ts` | 11 | **11/11 PASS** |
| **Other Unit Suites** | `apiBudgets.test.ts`, `budgetPdf.test.ts`, `productionWorkflowStatus.test.ts`, `example.test.ts` | 19 | **19/19 PASS** |
| **Consolidated Serial Aggregate** | **All 27 Test Files** | **454** | **454/454 PASS** |

### 5.3. Parallel Runner Debt
- When executing tests in parallel against a single shared test database, `essential-finance-summary.test.ts` experienced unique-constraint collisions on shared fixture email records (`tech@t`).
- In the authoritative serial execution (`--fileParallelism=false`), all 454 tests in all 27 files pass with zero failures.

---

## 6. Security Release Audit

1. **Authentication (Zero-Trust JWT)**: All canonical endpoints require valid bearer tokens. Missing or forged tokens return HTTP 401.
2. **Tenant Isolation & Spoofing**: `workspaceId` headers, query parameters, or body attributes cannot spoof tenancy; claims derive strictly from verified server-side JWT membership. Cross-tenant access returns 403 or 404 (zero data leakage).
3. **IDOR / BOLA Prevention**: Direct entity access checks verify workspace ownership at the database query level. Accessing foreign workspace entities yields 404.
4. **Mass Assignment**: Audit timestamps (`createdAt`, `paidAt`, `reversedAt`), creator identities, and resolved monetary amounts are calculated strictly on the backend.
5. **Money Precision**: All financial amounts use PostgreSQL `Decimal(12, 2)` or `Decimal(15, 2)`. Zero floating point arithmetic is used in domain calculations.
6. **Idempotency**: Composite unique constraints (`@@unique([workspaceId, actorUserId, actionNamespace, idempotencyKey])`) protect financial mutations from double-submit or retry duplication.
7. **Legacy Authority Retirement**: Retired `/financial-records`, `/finance/summary` (v1), and `/finance/reconciliations` return HTTP 410 Gone.
8. **Secrets & Logging**: Source code audit confirmed zero committed passwords, private keys, or production tokens.

---

## 7. Build & Static Quality Gates

- **Root Typecheck**: `npm run typecheck` — **PASS** (0 errors)
- **Backend Typecheck**: `npm --prefix backend run typecheck` — **PASS** (0 errors)
- **Lint**: `npm run lint` — **PASS** (0 errors, 1 known unrelated warning in `ProductionBoard.tsx`)
- **Frontend Production Build**: `npm run build` — **PASS** (5333 modules transformed; bundle generated in 58.39s)
- **Backend Production Build**: `npm --prefix backend run build` — **PASS** (tsc build clean)
- **Prisma Validate**: **PASS**

---

## 8. Staging & External Dependencies Status

- **Classification**: `EXTERNAL_DEPENDENCY_BLOCKED`
- **Reason**: Remote staging environment credentials, MinIO S3 production buckets, and external VECTIS client testing accounts are managed externally and are not provisioned in the local development workspace.
- **Handoff Action**: Staging deployment and VECTIS homologation checklist packaged for deployment engineers in `docs/runbooks/operix-core-phase1-release.md` and `docs/handoff/operix-core-phase1-homologation.md`.
