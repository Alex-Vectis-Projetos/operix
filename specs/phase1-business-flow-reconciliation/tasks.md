# Task Breakdown — Phase 1 Business Flow Reconciliation (R01D Frozen)

## Pre-Release Phase Checklist

- [x] **R00: Audit & Diagnostics Baseline**
  - [x] Verify Git baseline on `cf0b8a55` (tag: `v1.0.0-rc1`).
  - [x] Verify PostgreSQL 16 connection and database migrations.
  - [x] Complete domain comparison against Alex / VECTIS meetings.

- [x] **R01 / R01D: Specification, Contract Hardening & RED Acceptance Baseline**
  - [x] Update `spec.md` with canonical invoicing order, direct PO preservation, and 23-delta matrix.
  - [x] Update `decisions.md` with frozen claim storage semantics (ADR-002), forward-only migration strategy, delegation model, and single canonical order.
  - [x] Update `acceptance.md` defining all 46 normative acceptance scenarios across 10 groups.
  - [x] Update `tests/integration/phase1-business-flow-reconciliation.test.ts` to test observable behaviors on canonical routes.
  - [x] Verify intentional RED for absent behaviors and GREEN for preserved invariants.

- [x] **R02: Spec 002 — Budget Client Authority, Rejection Refinement, Client Delegation & Production Timeline**
  - [x] Ban technician self-approval in `backend/src/routes/budgets.ts` (throw `403 TECH_SELF_APPROVAL_FORBIDDEN`).
  - [x] Enforce granular `ClientAccessGrant` capabilities: `budget.approve`, `weeklog.validate`, `payment_list.review`, `invoice.view`, `client.collaborators.manage`.
  - [x] Enforce client `siteKey` operational scope restriction (`403 SITE_SCOPE_UNAUTHORIZED`).
  - [x] Implement client representative delegation endpoints: `POST /api/clients/:clientId/collaborators`, `PATCH /:grantId`, `DELETE /:grantId` with same-client boundary, capability ceiling, and zero Finance access.
  - [x] Preserve direct ProductionOrder creation (`DIRECT-PO-PRESERVED-01`).
  - [x] Implement `GET /api/production-orders/:id/timeline` strictly from persisted canonical facts (zero fabricated pause/resume events).

- [x] **R03: Spec 003 — Week Boundary Auto-Closure & Startup Catch-Up Engine**
  - [x] Implement `reconcileExpiredWeeklogs` in `backend/src/services/weeklogService.ts`.
  - [x] Implement `runStartupCatchup` in `backend/src/lib/weekCloseRunner.ts`.
  - [x] Register 60-second periodic interval runner in `backend/src/index.ts`.
  - [x] Implement concise operational projection: `GET /api/weeklogs/:id/projection`.
  - [x] Verify external WEEKLOG upload and commit on canonical route `/api/external-operational-imports`.

- [x] **R04 / R04.1: Spec 004 / ADR-002 — Source-Aware Provisional Claims, Multiweek Absorption, Manual List Coexistence & Auto-Draft PaymentList Handoff**
  - **R04 Pre-Flight Note A (Tenant-safe composite FKs)**: `originWeeklogId`, `originWeeklogValidationId`, and `supersededByPaymentListId` strictly preserve Spec004 composite tenant FK architecture `(origin_weeklog_id, workspace_id) REFERENCES weeklogs(id, workspace_id)`, `(origin_weeklog_validation_id, workspace_id) REFERENCES weeklog_validations(id, workspace_id)`, and `(superseded_by_payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id)`.
  - **R04 Pre-Flight Note B (Auto-list validation-cycle authority)**: Audit confirmed that one Weeklog can legitimately produce multiple valid `WeeklogValidation` rounds due to rectification/re-finalization. Therefore, `originWeeklogId` remains provenance only, and `originWeeklogValidationId` is the exactly-once handoff idempotency authority backed by partial unique index `unique_active_auto_payment_list_origin_validation`.
  - [x] Add `PaymentList` schema additions: `sourceType`, `originWeeklogId`, `originWeeklogValidationId`, `supersededByPaymentListId`, status values (`ready_for_billing`, `superseded`), and partial unique index `unique_active_auto_payment_list_origin_validation`.
  - [x] Execute forward-only claim constraint migration replacing `payment_list_entry_claims_status_check` and `payment_list_entry_claims_lifecycle_check`, preserving `unique_active_or_consumed_weeklog_entry_claim` and adding `unique_provisional_weeklog_entry_claim`.
  - [x] Hook `createAuthoritativeDraftListFromWeeklog` inside `validateWeeklogBatch` and external import commit with `provisional` claims.
  - [x] Implement ADR-002 claim absorption in confrontation service for external multiweek lists (`LIST-EXTERNAL-AUTO-ABSORB-01`).
  - [x] Implement manual list coexistence: absorb provisional claims without 409 error (`LIST-MANUAL-AUTO-COEXIST-01`).
  - [x] Implement authorized billing operator review transition to `ready_for_billing` (cancellation permitted strictly pre-invoice; remove `pending` $\rightarrow$ `cancelled`).
  - [x] Filter validated weeklogs from default `GET /api/weeklogs` active queue (`includeTransferred=true`).
  - [x] **R04.1 Hardening**:
    - [x] Forward-only migration `20261002180000_spec006_r04_1_provenance_restrict` enforcing `ON DELETE RESTRICT` for commercial provenance (`LIST-PROVENANCE-IMMUTABLE-01`).
    - [x] Internal manager gate for `ready_for_billing`, promoting claims `provisional -> reserved`, idempotent execution, zero Finance effect, and pre-invoice cancellation (`LIST-INTERNAL-READY-FOR-BILLING-01`).

- [ ] **R05: Spec 005 / ADR-004 — Explicit Invoice Commands & Direct Internal Billing**
  - [ ] Implement `POST /api/payment-lists/:id/invoice/create`.
  - [ ] Implement `POST /api/payment-lists/:id/invoice/associate`.
  - [ ] Enforce strict state transition to `pending` upon invoice command.
  - [ ] Transition claims from `reserved` to immutable `consumed`.
  - [ ] Verify Finance V2 revenue projections: `pending` (Expected = Total, Received = 0) $\rightarrow$ `paid` (Expected = 0, Received = Total).

- [ ] **R06: Importer UX Preservation & Contractual UI Release Gates**
  - [ ] Connect interactive document controls (rotation, zoom, editable grid, bulk downward apply) in frontend importer using existing `PATCH /api/external-operational-imports/:id/rows`.
  - [ ] Execute Operix brand hygiene audit: purge residual "Nexus" and "WorkNexus" strings (`UI-BRAND-OPERIX-01`).
  - [ ] Verify light mode contrast and mobile/tablet responsive layouts.
  - [ ] Hide generic automation engine from active navigation.

- [ ] **R07: End-to-End Homologation, Browser Recording & Staging Sign-Off**
  - [ ] Run full 46-scenario acceptance suite to green.
  - [ ] Execute browser subagent recording full operational flow.
  - [ ] Compile final homologation report for human sign-off.
