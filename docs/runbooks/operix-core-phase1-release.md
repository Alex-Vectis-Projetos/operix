# Operix Core — Phase 1 Release Runbook

## 1. Overview & Scope
This runbook governs the deployment, verification, and contingency rollback for **Operix Core — Phase 1 (Release Candidate 1)** across staging and production environments.

- **Artifacts Included**:
  - Backend API: Express server (`qw-nexus-api`)
  - Frontend SPA: React + Vite application
  - Database: PostgreSQL with Prisma schema & versioned migrations (11 migrations)
  - Object Storage: MinIO / S3 compatible storage for documents, import artifacts, and validation signatures

---

## 2. Pre-Deployment Checklist
Prior to triggering deployment, verify:
- [ ] Database backup snapshot completed and validated for recovery (Local rehearsal verified: `LOCAL_DATABASE_RESTORE_REHEARSED`; staging execution pending: `STAGING_BACKUP_RESTORE_PENDING_EXTERNAL_ACCESS`).
- [ ] Git commit SHA corresponds to approved Phase 1 Release Candidate (`feat/005-essential-finance`).
- [ ] Environment variables verified in target environment secret manager (see Section 3).
- [ ] Staging prerequisites available: VPS SSH/panel access, PostgreSQL 16 endpoint, DNS/routing, S3/MinIO credentials, runtime secrets, authorized accounts (`STAGING_BLOCKED_EXTERNAL_DEPENDENCY`).
- [ ] Active maintenance window scheduled or traffic drain prepared.
- [ ] Zero uncommitted migrations; migration status reports clean up to `20260923140000_spec005_essential_finance_domain`.

---

## 3. Environment & Runtime Configuration Checklist

The following environment variables MUST be configured in the target environment:

### Backend Runtime Variables
- `DATABASE_URL`: PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/operix?schema=public`)
- `JWT_SECRET`: Secret key (minimum 32 characters) for signing and verifying session bearer tokens
- `PORT`: HTTP port for Express server (default: `3000` or environment port)
- `CORS_ORIGIN`: Allowed origins for frontend access
- `MINIO_ENDPOINT`: Host/IP for MinIO / S3 storage
- `MINIO_PORT`: Port for MinIO service
- `MINIO_USE_SSL`: `true` or `false`
- `MINIO_ROOT_USER`: S3 access key
- `MINIO_ROOT_PASSWORD`: S3 secret key
- `MINIO_DEFAULT_BUCKET`: Default bucket name (e.g. `operix-documents`)
- `STRIPE_SECRET_KEY`: Stripe API key for SaaS subscription billing
- `NODE_ENV`: `production` or `staging`

### Frontend Runtime Variables
- `VITE_API_URL`: Base URL pointing to the deployed Backend API (e.g. `https://api.operix-staging.com`)

*Security Rule: NEVER commit or log actual secret values.*

---

## 4. Deployment Order & Execution Steps

### Step 4.1. Database Backup & Snapshot (MANDATORY)
Perform a full snapshot or dump prior to applying migrations:
```bash
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -F c -b -v -f "operix_backup_pre_phase1_$(date +%Y%m%d%H%M%S).dump"
```

### Step 4.2. Database Migration Deployment
Run Prisma migrations in forward-only deployment mode:
```bash
cd backend
npx prisma migrate deploy --schema=prisma/schema.prisma
```
Verify status:
```bash
npx prisma migrate status --schema=prisma/schema.prisma
```
*Expected*: 11 migrations applied; database schema is up to date.

### Step 4.3. Backend API Deployment
1. Build production bundle:
   ```bash
   npm --prefix backend run build
   ```
2. Start or restart backend service:
   ```bash
   node backend/dist/index.js
   ```
3. Verify server health:
   ```bash
   curl -f http://localhost:<PORT>/api/health || curl -f http://localhost:<PORT>/
   ```

### Step 4.4. Frontend SPA Deployment
1. Build frontend production assets:
   ```bash
   npm run build
   ```
2. Deploy static output (`dist/`) to target web server, CDN, or S3/Nginx host.

---

## 5. Post-Deployment Smoke Verification
Run authenticated smoke checks:
1. **Health Check**: Verify `/api/health` returns status OK.
2. **Authentication**: Log in with an admin user; confirm valid JWT returned in `Authorization: Bearer <token>`.
3. **Workspace Access**: Verify active workspace loaded and capabilities derived.
4. **Finance V2 Overview**: Access `/financial`; verify per-currency cards (Expected, Received, Expenses, Settled Obligations, Available) load without console errors.
5. **Operational Flow**: Verify existing Production Orders, WEEKLOGs, and PaymentLists load.
6. **Technician Scope**: Log in with a linked company technician; verify view is restricted to "Meus Repasses & Pagamentos" with no company summary or expense ledger.
7. **Client Scope**: Verify client user cannot access internal finance (explicit access-denied screen).

---

## 6. Rollback & Contingency Plan

### 6.1. Rollback Triggers
Initiate rollback if any of the following occur during or immediately after deployment:
- Database migration fails or reports data corruption.
- Backend API crashes on startup or health checks fail.
- Critical cross-tenant data leak or security regression detected.
- Frontend bundle fails to load or critical workflows (Production, Finance) are blocked.

### 6.2. Application Rollback (Zero DB Change Preferred)
If the database migration succeeded and the issue is restricted to application code:
1. Re-deploy the previous known stable frontend SPA build.
2. Re-deploy the previous known stable backend API service.
3. Because Spec 005 schema changes are additive and forward-only (new tables for `expenses`, `distributions`, `financial_obligations`, `obligation_payments`), the prior application version remains compatible with the database schema.

### 6.3. Database Rollback Policy (Forward-Only)
- **CRITICAL**: Operix Core does NOT support manual or automated DOWN migrations.
- If database rollback is strictly necessary due to catastrophic schema or corruption issues:
  1. Halt application traffic immediately (maintenance page).
  2. Restore the pre-deployment database backup created in Step 4.1:
     ```bash
     pg_restore -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -c -v "operix_backup_pre_phase1_<TIMESTAMP>.dump"
     ```
  3. Deploy previous application version corresponding to the restored database state.
  4. Perform smoke test before re-opening traffic.

---

## 7. Operational Contacts & Escalation Roles

| Role | Responsibility | Contact Placeholder |
|---|---|---|
| **Release Lead** | Coordinates deployment and executes runbook | release-lead@operix.local |
| **Database Administrator** | Executes backup snapshot and verifies migrations | dba-team@operix.local |
| **Backend Engineer** | Monitors API health and resolves runtime errors | backend-oncall@operix.local |
| **Frontend Engineer** | Verifies UI assets and client telemetry | frontend-oncall@operix.local |
| **Product / Homologation Lead** | Conducts business acceptance smoke | product-lead@operix.local |
