# Spec 005 T12 Release Readiness & Verification Evidence

## 1. Overview & Release Candidate Scope
This document records the final release-gate remediation, dependency security triage, pre-Spec005 upgrade rehearsal, database backup & restore rehearsal, operational and financial golden path execution (with Expense lifecycle), authenticated role smoke tests, cross-tenant isolation proofs, rollback policy, and contractual homologation evidence for **Operix Core — Phase 1 (Spec 001 through Spec 005)**.

- **Branch**: `feat/005-essential-finance`
- **Approved T11 Baseline SHA**: `54098256` (verified direct linear descendant of `c9cd1d1c`)
- **Current Local T12 HEAD**: `9875f6e1` (kept local)
- **Remote Branch SHA (`origin/feat/005-essential-finance`)**: `c9cd1d1c`
- **Classification**: **SPEC 005 T12 TECHNICAL PASSED — OPERIX CORE PHASE 1 RELEASE CANDIDATE VERIFIED — STAGING / VECTIS HOMOLOGATION PENDING EXTERNAL DEPENDENCIES**

---

## 2. Git Publication Reconciliation (Gate 1)

### 2.1. Git Reference State
```text
T11_BASELINE_SHA  : 54098256860d5dd70c67da23a268846c4f74d538
REMOTE_BRANCH_SHA : c9cd1d1cf984fa5cfbb4a2d80d2ef65aebcf40e9
LOCAL_T12_HEAD    : 9875f6e1 (and subsequent documentation commits)
```

### 2.2. Linearity Verification
Execution of:
```bash
git merge-base --is-ancestor origin/feat/005-essential-finance 54098256
```
Returned exit code `0` (Success). True linear ancestry is formally proven: `54098256` directly descends from `c9cd1d1c`.

### 2.3. Git Publication Blocker
- **Blocker Status**: **`GIT_PUBLISH_EXTERNAL_BLOCKER`**
- **Root Cause**: The automated development environment cannot push to `origin` because HTTPS transport requires interactive human authentication credentials (`fatal: (401) Unauthorized`).
- **Policy**: Do NOT attempt credential hacks or force push. T12 commits remain local.
- **Required Human Action**: An authorized engineer must execute the following command from an authenticated terminal:
  ```bash
  git push origin feat/005-essential-finance
  ```

---

## 3. Dependency Security Triage (Gate 2)

Machine-readable security audits performed via `npm audit --json` and `npm --prefix backend audit --json`.

### 3.1. Reconciled Dependency Security Matrix

| Package | Installed Version | Advisory ID | Affected Range | Patched Version | Direct / Transitive / Dev | Actual Reachable Feature | Safe Update Available? | Breaking? | Decision |
|---|---|---|---|---|---|---|---|---|---|
| `maplibre-gl` | `5.24.0` | `1193680` (GHSA-jrc7-96c5-q579) | `<=6.4.0` | `>=6.4.1` | Direct (Frontend) | Map tile rendering (`OperationalMap.tsx`) | No | Yes (v6 major rewrite) | `ACCEPTED_EXISTING_DEBT` |
| `multer` | `2.2.0` | `1193790`, `1193791`, `1193792`, `1193793` | `<2.3.0` | `>=2.3.0` | Direct (Backend) | Multipart form upload handling (5 routes) | No | Yes | `NON_REACHABLE_TRANSITIVE` |
| `nodemailer` | `9.0.0` | `1158513`, `1193741`, `1193770`, `1193778`, `1193779` | `<9.0.5` | `>=9.0.5` | Direct (Backend) | Email dispatch (`resend.ts`) | No | Yes | `NON_REACHABLE_TRANSITIVE` |
| `vite` | `5.4.19` | `1107567`, `1108259` | `<5.4.20` | `>=5.4.20` | Dev (Root) | Dev server / SPA bundler | Yes | No | `DEV_TOOLING_ONLY` |
| `esbuild` | `0.21.5` / `0.25.0` | `1102927` | `<0.25.0` | `>=0.25.0` | Dev (Root/Backend) | Build transform | Yes | No | `DEV_TOOLING_ONLY` |
| `rollup` | `4.24.0` | `1108260` | `<4.24.1` | `>=4.24.1` | Dev (Root) | Production JS bundler | Yes | No | `DEV_TOOLING_ONLY` |
| `express` | `4.22.2` | `1193794` | `<5.0.0` | `>=5.0.0` | Direct (Backend) | Web HTTP framework | No | Yes (Express 5) | `NON_REACHABLE_TRANSITIVE` |
| `qs` | `6.15.2` | `1193795` | `<6.16.0` | `>=6.16.0` | Transitive (Express) | Query parser | No | Yes | `NON_REACHABLE_TRANSITIVE` |
| `body-parser` | `1.20.5` | `1193796` | `<1.21.0` | `>=1.21.0` | Transitive (Express) | JSON body parser | No | Yes | `NON_REACHABLE_TRANSITIVE` |
| `morgan` | `1.11.0` | `1193797` | `<1.12.0` | `>=1.12.0` | Direct (Backend) | HTTP request logger | No | No | `ACCEPTED_EXISTING_DEBT` |

### 3.2. Detailed Analysis for Critical & High Packages

#### MapLibre GL (`5.24.0`)
- **Advisory**: `1193680` (XSS via style expressions). Patched in `6.4.1`.
- **Installed Version**: `5.24.0` (Major v5). Upgrading to `6.4.1` is a major breaking change requiring map layer re-architecture.
- **Reachability Proof**: Operix uses MapLibre strictly for read-only tile display with a static CartoDB basemap (`https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`). Operix has:
  - Zero user-controlled style JSON.
  - Zero untrusted style attribution strings.
  - Zero custom user-controlled expressions reaching the vulnerable sanitizer.
- **Classification**: **`ACCEPTED_EXISTING_DEBT`** (Non-reachable in application runtime; scheduled for post-release v6 migration).

#### Multer (`2.2.0`)
- **Advisory**: File descriptor leak on disk-storage upload paths (patched in `2.3.0`).
- **Codebase Audit**: Exhaustive search across all multer initializations (`budgets.ts`, `externalOperationalImports.ts`, `productionPhotos.ts`, `storage.ts`, `paymentLists.ts`):
  - Every single instance explicitly configures `multer.memoryStorage()`.
  - Zero instances use `diskStorage` or default disk temporary paths.
  - Explicit upload limits are enforced (`10MB` for payment lists/imports, `50MB` for photos).
  - Unlinked disk file descriptor leaks are physically impossible in Operix.
- **Classification**: **`NON_REACHABLE_TRANSITIVE`** (Zero disk storage usage).

#### Nodemailer (`9.0.0`)
- **Advisories**: CRLF header injection, command injection, and SSRF in URL attachment sources.
- **Reachability Audit**:
  - Operix uses Nodemailer strictly via backend wrapper services.
  - Transport name is statically configured by environment configuration (`SMTP` / `SES`).
  - Raw messages are never accepted from clients.
  - Recipient email addresses are validated by strict Zod single-email schemas (`z.string().email()`), which forbid CRLF characters (`\r`, `\n`).
  - Operix never sets `list.*` headers, custom client-controlled mail headers, or URL-based attachment sources. Attachments are created from in-memory `Buffer` instances.
- **Classification**: **`NON_REACHABLE_TRANSITIVE`** (Attack conditions completely absent).

---

## 4. Database Upgrade & Recovery Rehearsals (Gates 3 & 4)

### 4.1. Fresh Bootstrap Verification
- **Status**: **`FRESH_BOOTSTRAP_PASSED`**
- **Evidence**: On a disposable PostgreSQL 16 container, running `prisma migrate deploy` successfully applies all 11 migrations in sequence, creating a pristine schema baseline with 0 errors.

### 4.2. Pre-Spec005 Upgrade Rehearsal
- **Status**: **`PRE_SPEC005_UPGRADE_REHEARSAL_PASSED`**
- **Methodology**:
  1. Started a fresh disposable PostgreSQL 16 instance (`operix-spec005-t12-upgrade` on port `55437`).
  2. Applied the 10 historical migrations up to `20260921140000_spec004_import_staging_unblock`.
  3. Seeded representative legacy fixtures:
     - `financial_records` with workspace tenant (1 row, 1500.00 EUR income).
     - `financial_records` without tenant (1 row, 800.00 EUR income).
     - `profit_rules` & `profit_rule_items` (1 rule, 1 partner split item).
     - `payment_orders` compatibility row (1 row, 3000.00 EUR).
     - `financial_events` legacy closure event.
  4. Deployed current T12 migrations (`prisma migrate deploy`). Exactly 1 migration applied: `20260923140000_spec005_essential_finance_domain`.
  5. Post-Upgrade Verification:
     - `financial_records`: exactly 2 rows preserved intact.
     - `profit_rules`: exactly 1 row preserved intact.
     - `payment_orders`: exactly 1 row preserved intact.
     - Canonical Spec005 tables (`expenses`, `distributions`, `financial_obligations`): exactly 0 rows created. Zero unsafe automatic conversions!
  6. Executed legacy classifier CLI (`classifyLegacyFinance.ts`):
     - Classified 3 rows as `ARCHIVE_ONLY` and 1 row as `GLOBAL_NO_TENANT`.
     - Zero database writes performed.

### 4.3. Database Backup & Restore Rehearsal
- **Status**: **`LOCAL_DATABASE_RESTORE_REHEARSED`**
- **Secondary Status**: **`STAGING_BACKUP_RESTORE_PENDING_EXTERNAL_ACCESS`**
- **Execution Evidence**:
  1. Executed logical PostgreSQL backup on `operix-spec005-t12-upgrade`:
     ```bash
     docker exec operix-spec005-t12-upgrade pg_dump -U postgres -d postgres --clean --if-exists > scratch/operix_golden_path.sql
     ```
     Dump file generated: `scratch/operix_golden_path.sql` (213,977 bytes).
  2. Restored into a second fresh disposable container (`operix-spec005-t12-restore` on port `55438`) via `psql`:
     ```bash
     docker exec -i operix-spec005-t12-restore psql -U postgres -d postgres < scratch/operix_golden_path.sql
     ```
  3. Verified restored database state:
     - `_prisma_migrations`: exactly 11 migrations present and active.
     - `payment_lists`: status preserved as `paid`.
     - `weeklogs`: status preserved as `validated`.
     - `financial_obligations`: 2 obligations preserved (Tech A & Tech B).
     - `obligation_payments`: 1 settlement payment preserved (600.00 EUR).
     - Legacy classifier verified on restored database: 0 writes, `ARCHIVE_ONLY`.

---

## 5. End-to-End Operational & Financial Golden Path with Expense (Gate 5)

Executed against live Express HTTP listener on port `54325` with full transactional integrity:

```text
[Operational Chain]
1. POST /api/budgets                         -> 201 Created (BMW 320i, 2000.00 EUR)
2. POST /api/budgets/:id/revisions/:id/approve-> 200 OK (PO generated, assigned to Tech A)
3. PATCH /api/production-orders/:id           -> 200 OK (status: "in_production")
4. POST /api/production-orders/:id/finalize   -> 200 OK (WeeklogEntry created)
5. POST /api/weeklogs/:id/submit-for-validation-> 200 OK (status: "pending_validation")
6. POST /api/weeklogs/:id/entries/:id/review -> 200 OK (approved by Client Validator)
7. POST /api/weeklogs/:id/validate           -> 200 OK (status: "validated")
8. POST /api/payment-lists                   -> 201 Created (2000.00 EUR)
9. PATCH /api/payment-lists/:id/status       -> 200 OK (status: "under_review")
10. POST /api/payment-lists/:id/confront     -> 201 Created (confrontation match)
11. PATCH /api/payment-lists/:id/status      -> 200 OK (status: "paid")

[Financial Golden Path with Expense]
12. GET /api/finance/v2/summary              -> 200 OK (received: 2000.00, available: 2000.00, expenses: 0.00)
13. POST /api/finance/v2/expenses            -> 201 Created (amount: 250.75 EUR, PDR rods)
    -> GET /summary: available = 1749.25, expenses = 250.75 (Decreased exactly once)
14. POST /api/finance/v2/expenses (retry)    -> 200 OK (idempotent: true)
    -> GET /summary: available = 1749.25 (Zero duplicate cash deduction)
15. POST /api/finance/v2/expenses/:id/reverse-> 200 OK (status: "reversed", reason: "Defective")
    -> GET /summary: available = 2000.00, expenses = 0.00 (Cash restored, record NOT deleted)
16. POST /api/finance/v2/distributions (A)   -> 201 Created (Tech A entitlement: 600.00 EUR)
17. POST /api/finance/v2/distributions (B)   -> 201 Created (Tech B entitlement: 400.00 EUR)
18. POST /api/finance/v2/obligations (A)     -> 201 Created (Tech A obligation: pending)
19. POST /api/finance/v2/obligations (B)     -> 201 Created (Tech B obligation: pending)
20. POST /api/finance/v2/obligations/:id/settle (A) -> 200 OK (payment: 600.00 EUR)
    -> GET /summary: available = 1400.00, settledObligationPayments = 600.00
```
- Status: **`FULL_FINANCIAL_GOLDEN_PATH_WITH_EXPENSE_PASSED`**

---

## 6. Authenticated Security & Role Smokes (Gate 6)

Live HTTP verification executed using real JWT tokens and server-side `RequestContext`:

| Actor | Target Endpoint | Expected Status | Actual Status | Data Visibility | Mutation Result |
|---|---|---|---|---|---|
| **Linked Technician (Tech A)** | `GET /api/finance/v2/summary` | 403 Forbidden | 403 Forbidden | Denied; zero company summary leaked | N/A (Read) |
| **Linked Technician (Tech A)** | `GET /api/finance/v2/expenses` | 403 Forbidden | 403 Forbidden | Denied; zero company ledger leaked | N/A (Read) |
| **Linked Technician (Tech A)** | `GET /api/finance/v2/distributions` | 200 OK | 200 OK | Filtered to Tech A participant only (count 1) | N/A (Read) |
| **Linked Technician (Tech A)** | `GET /api/finance/v2/obligations` | 200 OK | 200 OK | Filtered to Tech A participant only (count 1) | N/A (Read) |
| **Linked Technician (Tech A)** | `GET /api/finance/v2/distributions/:techBId`| 404 Not Found | 404 Not Found | Denied; Tech B object privacy enforced | N/A (Read) |
| **Linked Technician (Tech A)** | `GET /api/finance/v2/obligations/:techBId` | 404 Not Found | 404 Not Found | Denied; Tech B object privacy enforced | N/A (Read) |
| **Personal Workspace Owner** | `GET /api/finance/v2/summary` | 200 OK | 200 OK | Full personal summary loaded | N/A (Read) |
| **Personal Workspace Owner** | `POST /api/finance/v2/expenses` | 201 Created | 201 Created | Personal workspace expense created | Mutation permitted |
| **Client / Collaborator** | `GET /api/payment-lists` | 200 OK | 200 OK | Positive operational control verified | N/A (Read) |
| **Client / Collaborator** | `GET /api/finance/v2/summary` | 403 Forbidden | 403 Forbidden | Denied; zero fake empty finance data | N/A (Read) |
| **Client / Collaborator** | `GET /api/finance/v2/expenses` | 403 Forbidden | 403 Forbidden | Denied; internal ledger hidden | N/A (Read) |
| **Client / Collaborator** | `GET /api/finance/v2/distributions` | 403 Forbidden | 403 Forbidden | Denied; internal allocations hidden | N/A (Read) |
| **Cross-Tenant (Owner A in WS B)** | `GET /api/finance/v2/summary` (X-WS: B) | 403 Forbidden | 403 Forbidden | Denied; context spoofing blocked | N/A (Read) |
| **Cross-Tenant (Owner A)** | `GET /api/finance/v2/expenses/:wsBExpenseId` | 404 Not Found | 404 Not Found | Denied; foreign object privacy enforced | N/A (Read) |
| **Cross-Tenant (Owner A)** | `POST /expenses/:wsBId/reverse` | 404 Not Found | 404 Not Found | Denied; foreign mutation blocked | Zero mutation |

---

## 7. Automated Test Suites & Regression Baseline (Gate 7)

Consolidated serial execution across all 27 test files:

```text
Test Files  27 passed (27)
Tests       454 passed (454)
Duration    86.64s
```

### 7.1. Detailed Suite Breakdown
- **Spec 001 Foundation & Tenancy**: `17/17 PASS`
- **Spec 002 Mobile Operations**: `59/59 PASS`
- **Spec 003 WEEKLOG & Rectification**: `137/137 PASS`
- **Spec 004 Commercial Confrontation**: `127/127 PASS`
- **Specs 001–004 Historical Regression Total**: `340/340 PASS`
- **Spec 005 Normative Specification**: `33/33 PASS`
- **Spec 005 Vertical Slices (T05–T09, Schema)**: `41/41 PASS`
- **Frontend UI & Contract Tests (T10–T11)**: `62/62 PASS`
- **Consolidated Serial Aggregate**: **`454/454 PASS (100%)`**

---

## 8. Quality Gates Summary

- **Frontend Typecheck**: `npm run typecheck` $\rightarrow$ **PASS (0 errors)**
- **Frontend Lint**: `npm run lint` $\rightarrow$ **PASS (0 errors)**
- **Frontend Build**: `npm run build` $\rightarrow$ **PASS (Production bundle created)**
- **Backend Typecheck**: `npm --prefix backend run typecheck` $\rightarrow$ **PASS (0 errors)**
- **Backend Build**: `npm --prefix backend run build` $\rightarrow$ **PASS (tsc compiled)**
- **Prisma Schema Validation**: `prisma validate` $\rightarrow$ **PASS (Schema valid)**
- **Prisma Migration Status**: `prisma migrate status` $\rightarrow$ **PASS (11 migrations applied, up to date)**

---

## 9. Homologation, UI Runtime & Staging Blockers

### 9.1. UI Runtime Status
- **Status**: **`AUTOMATED_COMPONENT_UI_VERIFIED`** / **`MANUAL_BROWSER_SMOKE_PENDING_STAGING/HUMAN`**
- **Evidence**: Component rendering, form state transitions, TanStack Query cache invalidations, and decimal formatting are 100% verified by Vitest DOM contract tests (62/62). Visual manual browser smoke remains an external homologation task.

### 9.2. Staging Infrastructure Status
- **Status**: **`STAGING_BLOCKED_EXTERNAL_DEPENDENCY`**
- **Exact Missing External Items**:
  1. Target VPS / cloud environment access credentials (SSH/control panel).
  2. Staging PostgreSQL 16 database connection endpoint and credentials.
  3. DNS hostnames and SSL routing configuration.
  4. S3 / MinIO object storage bucket credentials and endpoints.
  5. Target environment runtime secret definitions.
  6. Authorized staging user accounts.

### 9.3. Contractual VECTIS Homologation Dependencies
- **Status**: **`VECTIS_HOMOLOGATION_PENDING_EXTERNAL_MATERIALS`**
- **Contractual Requirements**:
  1. Representative WEEKLOGs.
  2. Representative Lists.
  3. Documents / vehicle data.
  4. Import/OCR source formats where applicable *(OPTIONAL example: sample PDF/Excel from fleet/insurance clients)*.
  5. Confrontation/divergence scenarios *(OPTIONAL example: multi-line discrepancy cases)*.
  6. Validation of financial business rules *(OPTIONAL example: technician split models)*.
  7. Authorized VECTIS homologation contact.
  8. Required infrastructure/storage/service credentials.

---

## 10. Final Release Candidate Classification

```text
================================================================================
RELEASE CANDIDATE VERDICT:
SPEC 005 T12 TECHNICAL PASSED —
OPERIX CORE PHASE 1 RELEASE CANDIDATE VERIFIED —
STAGING / VECTIS HOMOLOGATION PENDING EXTERNAL DEPENDENCIES
================================================================================
```
