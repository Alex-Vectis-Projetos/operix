# Task Breakdown — Phase 1 Business Flow Reconciliation (R01C Frozen)

## Pre-Release Phase Checklist

- [x] **R00: Audit & Diagnostics Baseline**
  - [x] Verify Git baseline on `cf0b8a55` (tag: `v1.0.0-rc1`).
  - [x] Verify PostgreSQL 16 connection and database migrations.
  - [x] Complete domain comparison against Alex / VECTIS meetings.

- [x] **R01 / R01C: Specification, Contract Hardening & RED Acceptance Baseline**
  - [x] Update `spec.md` with canonical invoicing order, direct PO preservation, and 23-delta matrix.
  - [x] Update `decisions.md` with frozen claim storage semantics (ADR-002), delegation model, and single canonical order.
  - [x] Update `acceptance.md` defining all 41 normative acceptance scenarios across 10 groups.
  - [x] Update `tests/integration/phase1-business-flow-reconciliation.test.ts` to test observable behaviors on canonical routes.
  - [x] Verify intentional RED for absent behaviors and GREEN for preserved invariants.

- [ ] **R02: Spec 002 — Budget Client Authority, Rejection Refinement, Client Delegation & Production Timeline**
  - [ ] Ban technician self-approval in `backend/src/routes/budgets.ts` (throw `403 TECH_SELF_APPROVAL_FORBIDDEN`).
  - [ ] Validate `ClientAccessGrant` capability `budget.approve` matching `budget.clientId` (`CROSS_CLIENT_FORBIDDEN`).
  - [ ] Enforce client siteKey/locationId scope restriction where present (`SITE_SCOPE_UNAUTHORIZED`).
  - [ ] Implement client representative delegation endpoint: `POST /api/clients/:clientId/collaborators`.
  - [ ] Preserve direct ProductionOrder creation (`DIRECT-PO-PRESERVED-01`).
  - [ ] Implement `GET /api/production-orders/:id/timeline` from canonical facts.

- [ ] **R03: Spec 003 — Week Boundary Auto-Closure & Startup Catch-Up Engine**
  - [ ] Implement `reconcileExpiredWeeklogs` in `backend/src/services/weeklogService.ts`.
  - [ ] Implement `runStartupCatchup` in `backend/src/lib/weekCloseRunner.ts`.
  - [ ] Register 60-second periodic interval runner in `backend/src/index.ts`.
  - [ ] Implement concise operational projection: `GET /api/weeklogs/:id/projection`.
  - [ ] Verify external WEEKLOG upload and commit on canonical route `/api/external-operational-imports`.

- [ ] **R04: Spec 004 / ADR-002 — Source-Aware Provisional Claims, Multiweek Absorption, Manual List Coexistence & Auto-Draft PaymentList Handoff**
  - [ ] Add `provisional` claim status to `PaymentListEntryClaim` with partial unique index.
  - [ ] Hook `createAuthoritativeDraftListFromWeeklog` inside `validateWeeklogBatch` and external import commit.
  - [ ] Implement ADR-002 claim absorption in confrontation service for external multiweek lists.
  - [ ] Implement manual list coexistence: absorb provisional claims without 409 error (`LIST-MANUAL-AUTO-COEXIST-01`).
  - [ ] Implement authorized billing operator review transition to `ready_for_billing`.
  - [ ] Filter validated weeklogs from default `GET /api/weeklogs` active queue (`includeTransferred=true`).

- [ ] **R05: Spec 005 / ADR-004 — Explicit Invoice Commands & Direct Internal Billing**
  - [ ] Implement `POST /api/payment-lists/:id/invoice/create`.
  - [ ] Implement `POST /api/payment-lists/:id/invoice/associate`.
  - [ ] Enforce strict state transition to `pending` upon invoice command.
  - [ ] Transition claims from `reserved` to immutable `consumed`.
  - [ ] Verify Finance V2 revenue projections (`Expected` starts at `pending`).

- [ ] **R06: Importer UX Preservation & Contractual UI Release Gates**
  - [ ] Connect interactive document controls (rotation, zoom, editable grid, bulk downward apply) in frontend importer.
  - [ ] Execute Operix brand hygiene audit: purge residual "Nexus" and "WorkNexus" strings (`UI-BRAND-OPERIX-01`).
  - [ ] Verify light mode contrast and mobile/tablet responsive layouts.
  - [ ] Hide generic automation engine from active navigation.

- [ ] **R07: End-to-End Homologation, Browser Recording & Staging Sign-Off**
  - [ ] Run full 41-scenario acceptance suite to green.
  - [ ] Execute browser subagent recording full operational flow.
  - [ ] Compile final homologation report for human sign-off.
