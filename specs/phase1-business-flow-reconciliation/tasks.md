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

- [ ] **R02: Spec 002 — Budget Client Authority, Rejection Refinement, Client Delegation & Production Timeline**
  - [ ] Ban technician self-approval in `backend/src/routes/budgets.ts` (throw `403 TECH_SELF_APPROVAL_FORBIDDEN`).
  - [ ] Enforce granular `ClientAccessGrant` capabilities: `budget.approve`, `weeklog.validate`, `payment_list.review`, `invoice.view`, `client.collaborators.manage`.
  - [ ] Enforce client `siteKey` operational scope restriction (`403 SITE_SCOPE_UNAUTHORIZED`).
  - [ ] Implement client representative delegation endpoints: `POST /api/clients/:clientId/collaborators`, `PATCH /:grantId`, `DELETE /:grantId` with same-client boundary, capability ceiling, and zero Finance access.
  - [ ] Preserve direct ProductionOrder creation (`DIRECT-PO-PRESERVED-01`).
  - [ ] Implement `GET /api/production-orders/:id/timeline` strictly from persisted canonical facts (zero fabricated pause/resume events).

- [ ] **R03: Spec 003 — Week Boundary Auto-Closure & Startup Catch-Up Engine**
  - [ ] Implement `reconcileExpiredWeeklogs` in `backend/src/services/weeklogService.ts`.
  - [ ] Implement `runStartupCatchup` in `backend/src/lib/weekCloseRunner.ts`.
  - [ ] Register 60-second periodic interval runner in `backend/src/index.ts`.
  - [ ] Implement concise operational projection: `GET /api/weeklogs/:id/projection`.
  - [ ] Verify external WEEKLOG upload and commit on canonical route `/api/external-operational-imports`.

- [ ] **R04: Spec 004 / ADR-002 — Source-Aware Provisional Claims, Multiweek Absorption, Manual List Coexistence & Auto-Draft PaymentList Handoff**
  - [ ] Add `PaymentList` schema additions: `sourceType`, `originWeeklogId`, `supersededByPaymentListId`, status values (`ready_for_billing`, `superseded`), and partial unique index `unique_active_auto_payment_list_origin_weeklog`.
  - [ ] Execute forward-only claim constraint migration replacing `payment_list_entry_claims_status_check` and `payment_list_entry_claims_lifecycle_check`, preserving `unique_active_or_consumed_weeklog_entry_claim` and adding `unique_provisional_weeklog_entry_claim`.
  - [ ] Hook `createAuthoritativeDraftListFromWeeklog` inside `validateWeeklogBatch` and external import commit with `provisional` claims.
  - [ ] Implement ADR-002 claim absorption in confrontation service for external multiweek lists (`LIST-EXTERNAL-AUTO-ABSORB-01`).
  - [ ] Implement manual list coexistence: absorb provisional claims without 409 error (`LIST-MANUAL-AUTO-COEXIST-01`).
  - [ ] Implement authorized billing operator review transition to `ready_for_billing` (cancellation permitted strictly pre-invoice; remove `pending` $\rightarrow$ `cancelled`).
  - [ ] Filter validated weeklogs from default `GET /api/weeklogs` active queue (`includeTransferred=true`).

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
