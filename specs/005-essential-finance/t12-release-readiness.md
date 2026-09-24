# Spec 005 T12 Release Readiness & Verification Evidence

## 1. Overview & Release Candidate Scope
This document records the final verification, security audit, migration rehearsal, and release readiness evidence for **Operix Core — Phase 1 (Spec 001 through Spec 005)**.

- **Branch**: `feat/005-essential-finance`
- **Release Candidate Baseline**: Phase 1 Release Candidate 1 (RC1)
- **Status**: **SPEC 005 T12 TECHNICAL PASSED — OPERIX CORE PHASE 1 RELEASE CANDIDATE VERIFIED — FRESH MIGRATION + AUTHENTICATED LOCAL SMOKE VERIFIED — STAGING / VECTIS HOMOLOGATION PENDING EXTERNAL DEPENDENCIES**

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

## 4. Truly Fresh Environment Rehearsal & Database Verification

### 4.1. Migration Replay from Zero
- Executed against a brand-new, isolated PostgreSQL 16 container (`operix-spec005-t12-fresh` on port `55433`).
- Command: `npx --prefix backend prisma migrate deploy --schema=backend/prisma/schema.prisma`
- Result: **All 11 migrations applied successfully from an empty database**:
  1. `20260814000000_init_baseline`
  2. `20260814130000_add_customer_display_id`
  3. `20260914150000_spec_002_mobile_operation_budget_production`
  4. `20260917000000_add_weeklog_canonical_domain_and_versioned_rectification`
  5. `20260917100000_strengthen_spec002_budget_lineage_constraints`
  6. `20260917110000_spec_003_weeklog_validation_round_lifecycle`
  7. `20260917120000_fix_legacy_weeklog_validation_semantics`
  8. `20260921120000_spec004_payment_list_domain`
  9. `20260921130000_spec004_relational_hardening`
  10. `20260921140000_spec004_import_staging_unblock`
  11. `20260923140000_spec005_essential_finance_domain`
- Status: **11 migrations found; database schema is up to date; no drift; no manual SQL; no migration 12.**
- Schema Validation: `The schema at backend\prisma\schema.prisma is valid 🚀`.

### 4.2. Fresh-DB Verification Run
- Executed against the new database on port `55433`:
  - `essential-finance-schema.test.ts`: **7/7 PASS**
  - `essential-finance-red-baseline.test.ts`: **33/33 PASS**
  - `foundation-security.test.ts`: **7/7 PASS**
  - Total: **47/47 PASS**

### 4.3. Legacy Classifier Execution on Fresh Environment
- `npx tsx backend/scripts/classifyLegacyFinance.ts` (dry-run): Read database, 0 writes, verified `ARCHIVE_ONLY` classification.
- `npx tsx backend/scripts/classifyLegacyFinance.ts --apply` (negative apply control): Returned `Apply mode has no deterministic safe migrations to execute. Classification only.` with zero writes (`NO_SAFE_AUTOMATIC_MIGRATION`).

### 4.4. Container Cleanup
- `operix-spec005-t12-fresh` container stopped, removed, and verified non-existent after verification.

---

## 5. Local Authenticated Runtime HTTP Smoke

Verified against live Express HTTP listener with real network fetch calls:

1. **Owner / Admin HTTP Smoke**:
   - `GET /api/finance/v2/summary`: **200 OK**
   - `GET /api/finance/v2/expenses`: **200 OK**
   - Mutation chain: `POST /api/finance/v2/expenses` (`250.75 BRL`) -> **201 Created** $\rightarrow$ `POST /api/finance/v2/expenses/:id/reverse` -> **200 OK (`status: reversed`)**.
2. **Linked Technician HTTP Smoke**:
   - `GET /api/finance/v2/summary`: **403 Forbidden** (Denied)
   - `GET /api/finance/v2/expenses`: **403 Forbidden** (Denied)
   - `GET /api/finance/v2/distributions`: **200 OK** (Own participant scope only)
3. **Personal Workspace Owner HTTP Smoke**:
   - `GET /api/finance/v2/summary` (Actor with technician global identity who is Owner in personal workspace): **200 OK** (Ownership preserved).
4. **Client HTTP Smoke**:
   - `GET /api/payment-lists` (Operational positive control): **200 OK**
   - `GET /api/finance/v2/summary` (Internal finance denial): **403 Forbidden**
5. **Cross-Tenant HTTP Smoke**:
   - Workspace A user attempting `X-Workspace-Id` spoofing for Workspace B: **403 Forbidden**
   - Workspace A user attempting foreign ID lookup: **404 Not Found** (Zero entity details leaked).

---

## 6. Frontend Runtime & Responsive Status

- **UI Runtime Status**: `UI_RUNTIME_SMOKE_NOT_EXECUTED — AUTOMATED COMPONENT CONTRACTS PASSED`
- **Responsive Claim**: `RESPONSIVE DESIGN COVERED BY COMPONENT/LAYOUT IMPLEMENTATION; MANUAL STAGING HOMOLOGATION REQUIRED`
- **Frontend Verification Evidence**:
  - `tests/unit/finance-ui-contracts.test.tsx`: **10/10 PASS**
  - `tests/unit/finance-v2-client-contracts.test.ts`: **11/11 PASS**
  - All unit suites: **62/62 PASS**
  - Production build: `npm run build` completed successfully (5333 modules transformed).

---

## 7. Automated Test Suites Baseline

- **Prior Specifications Consolidated (Specs 001–004)**: **340/340 PASS (100%)**
  - Spec 001: 17/17 PASS
  - Spec 002: 59/59 PASS
  - Spec 003: 137/137 PASS
  - Spec 004: 127/127 PASS
- **Spec 005 Normative Suite**: **33/33 GREEN (100%)**
- **Spec 005 Vertical Backend Suites**: **41/41 PASS (100%)** (T05: 8/8, T06: 7/7, T07: 7/7, T08: 7/7, T09: 5/5, Schema: 7/7)
- **Consolidated Serial Aggregate**: **454/454 PASS (100%)** across 27 files (`npx vitest run --fileParallelism=false`).
- **Parallel Runner Note**: Concurrency table locking on shared fixture setups occurs during parallel execution; serial aggregate is authoritative and 100% green.

---

## 8. Broadened Secrets & Security Audit

Committed codebase audit verified:
- **Private Keys**: 0 RSA/EC private keys (`BEGIN PRIVATE KEY`)
- **AWS Keys**: 0 AWS AKIA access key patterns
- **Hardcoded JWTs**: 0 hardcoded bearer tokens in product code
- **Database URLs**: 0 real production database credentials
- **Stripe Keys**: 0 live Stripe secret keys (`sk_live_`)
- **Zero-Trust Boundaries**: All endpoints enforce RequestContext authentication and workspace tenancy.

---

## 9. Staging & Homologation Status

- **Staging Target**: `EXTERNAL_DEPENDENCY_BLOCKED`
  - Reason: Staging hosting infrastructure, S3 bucket credentials, and external client accounts are managed outside this repository workspace.
- **VECTIS Homologation**: `AWAITING_VECTIS_HOMOLOGATION`
  - Release candidate handoff guide prepared in [docs/handoff/operix-core-phase1-homologation.md](file:///c:/Users/gusta/Downloads/operix/docs/handoff/operix-core-phase1-homologation.md).
  - Deployment runbook prepared in [docs/runbooks/operix-core-phase1-release.md](file:///c:/Users/gusta/Downloads/operix/docs/runbooks/operix-core-phase1-release.md).
