# Operix Phase 1 — Release & Rollback Package (Spec 006 — R07)

**Document Reference**: `specs/phase1-business-flow-reconciliation/release-package.md`  
**Target Release**: Phase 1 Business Flow Reconciliation (Release Candidate)  
**Approved Baseline SHA**: `68cef6ee8cabadfbb5b57e060fc5b9d6b773de31`  
**Current Phase**: Spec 006 R07 — Release Verification & Homologation Gate  

---

## 1. Executive Summary & Release Report

Phase 1 consolidates and reconciles the brownfield business flow across Specs 001 through 006 into a single, canonical, tenant-isolated architecture:
$$\text{Budget} \longrightarrow \text{Production} \longrightarrow \text{WEEKLOG} \longrightarrow \text{Validation} \longrightarrow \text{PaymentList} \longrightarrow \text{Invoice/Finance}$$

### Automated Verification Status
- **Spec 006 Reconciliation Acceptance Suite**: `69/69 PASS (100% GREEN)`
- **Core Domain Regressions**:
  - `budget-production-flow.test.ts`: 59/59 PASS
  - `weeklog-operational-flow.test.ts`: 99/99 PASS
  - `external-weeklog-import.test.ts`: 12/12 PASS
  - `commercial-confrontation.test.ts`: 24/24 PASS
  - `payment-list-invariants.test.ts`: 21/21 PASS
  - `payment-list-import.test.ts`: 18/18 PASS
  - `essential-finance-*.test.ts`: 60/60 PASS
  - `service-orders-legacy-sanitization.test.ts`: 17/17 PASS
  - `legacy-payment-order-transition.test.ts`: 6/6 PASS
  - `tests/unit/`: 65/65 PASS
- **Typechecks**: Frontend `PASS`, Backend `PASS`
- **Builds**: Frontend `PASS`, Backend `PASS`
- **Lint**: `PASS (0 errors, 1 warning)`
- **Prisma Schema Status**: Valid, 16 forward-only migrations, zero drift.
- **Fresh Migration Rehearsal**: 16/16 migrations applied from zero on disposable PostgreSQL schema with zero drift and verified authenticated smoke.

---

## 2. Infrastructure Inventory & Discovery

### Environment Assessment
- **Local Environment**: Windows 11 host, Node.js v22.13.0, PostgreSQL 16 active on port `5432`.
- **Docker Engine**: Docker Desktop daemon is not currently active on the local development host.
- **Remote Infrastructure**:
  - Production domain documented in Nginx templates: `operix-pro.com` / `www.operix-pro.com` (`deploy/nginx/operix-pro.com.conf`).
  - **Isolated Staging Target**: No isolated staging VPS host or remote staging credentials are configured in repository remotes or environment files.
  - **INFRASTRUCTURE BLOCKER RECORDED**: Per AGENTS.md and R07 pre-flight mandates, production environments must never be mutated or used as ad-hoc staging. Because a dedicated, isolated remote staging environment is not currently provisioned, live multi-user staging browser certification remains deferred until an isolated staging server is provisioned.

---

## 3. Staging Deployment Procedure

When provisioning the isolated staging server (e.g. `staging.operix-pro.com`):

### 3.1. Prerequisites
- Ubuntu 22.04 LTS / Debian 12
- Docker Engine >= 24.0 & Docker Compose v2
- Isolated PostgreSQL 16 instance (dedicated database `operix_staging`)
- Dedicated MinIO / S3 bucket (`operix-staging-documents`)
- Clean TLS certificates (Let's Encrypt / Certbot)

### 3.2. Deployment Steps
1. **Clone Approved Baseline**:
   ```bash
   git clone https://github.com/qwork-alex/operix.git /opt/operix-staging
   cd /opt/operix-staging
   git checkout 68cef6ee8cabadfbb5b57e060fc5b9d6b773de31
   ```
2. **Environment Configuration**:
   Create `/opt/operix-staging/.env` populated according to Section 6 (Checklist). Ensure `NODE_ENV=production`, `PORT=4000`, `FRONTEND_PORT=8080`.
3. **Run Forward-Only Migrations**:
   ```bash
   node backend/node_modules/prisma/build/index.js migrate deploy --schema backend/prisma/schema.prisma
   node backend/node_modules/prisma/build/index.js migrate status --schema backend/prisma/schema.prisma
   ```
4. **Build & Start Services**:
   ```bash
   docker compose -f docker-compose.yml up -d --build
   ```
5. **Verify Service Health**:
   ```bash
   curl -f http://127.0.0.1:4000/healthz || exit 1
   curl -f http://127.0.0.1:8080/healthz || exit 1
   ```

---

## 4. Migration & Schema Governance Procedure

1. **Policy**: Forward-only migrations strictly (`prisma migrate deploy`). Never run `prisma db push` on staging or production.
2. **Reversibility Principle**: All 16 migrations are additive or use expand-contract patterns.
3. **Execution Order**:
   - `20260814000000_init_baseline` through `20260923140000_spec005_essential_finance_domain` (Baseline foundation)
   - `20261002150000_spec006_r02_client_access_governance` (Client capability column & site scoping)
   - `20261002160000_spec006_r02_default_deny_capabilities` (Default deny empty array)
   - `20261002170000_spec006_r04_payment_list_status_enum` (Status values `ready_for_billing`, `superseded`)
   - `20261002170100_spec006_r04_commercial_handoff_claims` (Status check & partial unique constraints)
   - `20261002180000_spec006_r04_1_provenance_restrict` (Relational foreign key hardening `ON DELETE RESTRICT`)

---

## 5. Rollback Procedure & Disaster Recovery

In the event of an unrecoverable failure during release deployment:

### 5.1. Database Rollback Plan
1. **Pre-Deployment Snapshot**:
   Before deploying, create an atomic physical and logical backup:
   ```bash
   pg_dump -Fc -h $DB_HOST -U $DB_USER -d $DB_NAME -f /var/backups/operix_pre_r07_$(date +%Y%m%d_%H%M%S).dump
   ```
2. **Restoration Protocol**:
   If migration corruption occurs:
   ```bash
   # Terminate active client connections
   psql -h $DB_HOST -U $DB_USER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'operix_staging';"
   # Drop and recreate clean database
   dropdb -h $DB_HOST -U $DB_USER operix_staging
   createdb -h $DB_HOST -U $DB_USER operix_staging
   # Restore logical dump
   pg_restore -h $DB_HOST -U $DB_USER -d operix_staging /var/backups/operix_pre_r07_*.dump
   ```

### 5.2. Application Rollback Plan
1. Reset Git working tree to the prior approved release tag/SHA (`d20f955bdcf38ebe860a85be482c097cd5957c4d` for R05 or `cf0b8a55` for RC1).
2. Restart application containers:
   ```bash
   docker compose restart
   ```

---

## 6. Environment & Configuration Checklist (Zero Secrets)

All production and staging environments must define the following variables:

| Variable | Description | Allowed Staging / Prod Format |
|----------|-------------|-------------------------------|
| `NODE_ENV` | Environment identifier | `production` |
| `PORT` / `API_PORT` | Express backend listening port | `4000` |
| `FRONTEND_PORT` | Vite / Nginx frontend port | `8080` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://<user>:<pwd>@<host>:5432/<db>?schema=public` |
| `JWT_SECRET` | Cryptographic secret for access tokens | High-entropy 64+ char alphanumeric |
| `JWT_EXPIRES_IN` | Token duration | `7d` |
| `CORS_ORIGIN` | Allowed web frontend origin | `https://staging.operix-pro.com` |
| `PUBLIC_APP_URL` | Canonical application URL | `https://staging.operix-pro.com` |
| `VITE_API_URL` | Client API endpoint prefix | `https://staging.operix-pro.com/api` |
| `MINIO_ENDPOINT` | MinIO / S3 object storage host | `http://minio:9000` or cloud endpoint |
| `MINIO_ROOT_USER` | Storage administrator user | Distinct operational username |
| `MINIO_ROOT_PASSWORD` | Storage access secret | High-entropy password |
| `EMAIL_FROM` | Transactional email sender | `noreply@operix-pro.com` |
| `SMTP_HOST` / `SMTP_PORT` | Transactional email delivery | Standard TLS SMTP coordinates |

---

## 7. Known Scope Boundaries & Limitations (Phase 1)

1. **No Cross-Currency (FX) Totals**: Multi-currency displays maintain separate buckets (`EUR`, `USD`, `BRL`, `CHF`). Phase 1 forbids synthetic cross-currency aggregation.
2. **Internal Ledger Isolation**: Client collaborators never possess access to internal Finance ledgers, expenses, or distributions.
3. **Pre-Invoice Cancellation Only**: Pre-invoice cancellation (`ready_for_billing` $\rightarrow$ `cancelled`) safely releases claims. Post-invoice cancellation (`pending` $\rightarrow$ `cancelled`) is explicitly forbidden in Phase 1 to preserve billing auditability.
4. **Generic Automation Module**: Retained in codebase for future phases but strictly hidden from active navigation and menus (`UI-AUTOMATION-HIDDEN-01`).

---

## 8. Deferred Phase 2 / Evolution Items

- Evolution of multi-rate dynamic currency conversion (FX engine).
- Advanced automated recurring billing subscriptions.
- Granular technician subcontractor self-invoicing module.
- Generic rule automation visual workflow designer.

---

## 9. Homologation Manifest & Execution Matrix

Refer to [r07-homologation-manifest.md](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/specs/phase1-business-flow-reconciliation/r07-homologation-manifest.md) for the 20 test flows.

| Flow ID | Target Scenario | Automated / Static Status | Live Browser / Staging Status |
|---------|-----------------|---------------------------|-------------------------------|
| **FLOW-01** | Login & Workspace Selection | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-02** | Client Collaborator Authorization | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-03** | Budget Create -> Client Approval | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-04** | Direct ProductionOrder | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-05** | Production Finalization | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-06** | WEEKLOG Weekly Flow | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-07** | Client Validation & Signature | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-08** | Auto PaymentList Generation | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-09** | External List Confrontation | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-10** | Ready for Billing Transition | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-11** | Invoice Create & Associate | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-12** | Invoice Client View & PDF | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-13** | Pending -> Finance Expected | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-14** | Paid -> Finance Received | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-15** | Expense & Available Smoke | `GREEN` (Integration tested) | Pending isolated staging |
| **FLOW-16** | Light Mode Usability Gate | `STATIC_GREEN` | Pending live browser sign-off |
| **FLOW-17** | Mobile Viewport ($\le 430\text{px}$) | `STATIC_GREEN` | Pending live browser sign-off |
| **FLOW-18** | Tablet Viewport ($768 - 1024\text{px}$) | `STATIC_GREEN` | Pending live browser sign-off |
| **FLOW-19** | Importer Document Review | `GREEN` (UI contract tested) | Pending isolated staging |
| **FLOW-20** | Brand & Navigation Hygiene | `GREEN` (Scrubbed & tested) | Pending isolated staging |

---

## 10. Release Classification

**Current Official Classification**:  
$$\mathbf{TECHNICAL\ RC\ —\ HOMOLOGATION\ PENDING}$$

**Rationale**:
1. All canonical backend, database, migration, and contract release gates are 100% GREEN (zero functional defects).
2. Fresh PostgreSQL 16 migration replay completed with zero drift.
3. Isolated remote staging environment is not yet provisioned; per AGENTS.md safety invariant, production must not be used for homologation.
4. Runtime UI gates (`UI-LIGHT-MODE-01`, `UI-MOBILE-CORE-01`, `UI-TABLET-CORE-01`) remain `STATIC_GREEN / RUNTIME_HOMOLOGATION_PENDING` until executed against the live deployed staging environment.
