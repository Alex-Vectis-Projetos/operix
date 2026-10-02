# Task Breakdown — Phase 1 Business Flow Reconciliation (R01B)

## Pre-Release Phase Checklist

- [x] **R00: Audit & Diagnostics Baseline**
  - [x] Verify Git baseline on `cf0b8a55` (tag: `v1.0.0-rc1`).
  - [x] Verify PostgreSQL 16 connection and database migrations.
  - [x] Complete domain comparison against Alex / VECTIS meetings.

- [x] **R01 / R01B: Specification & RED Acceptance Baseline**
  - [x] Write `spec.md` with full 23-delta classification matrix across Specs 002–005.
  - [x] Write `decisions.md` with frozen ADR-001 through ADR-007.
  - [x] Write `acceptance.md` defining all 38 normative acceptance scenarios.
  - [x] Create comprehensive integration test suite covering all groups.
  - [x] Verify intentional RED for absent behaviors and GREEN for preserved invariants.

- [ ] **R02: Week Boundary Engine, Auto-Close Runner & Production Timeline**
  - [ ] Implement `reconcileExpiredWeeklogs` in `backend/src/services/weeklogService.ts`.
  - [ ] Implement `runStartupCatchup` in `backend/src/lib/weekCloseRunner.ts`.
  - [ ] Register 60-second periodic interval runner in `backend/src/index.ts`.
  - [ ] Prevent late finalization ingestion into expired weeklogs.
  - [ ] Implement `GET /api/production-orders/:id/timeline`.

- [ ] **R03: Budget Client Authority & Client Governance Scope**
  - [ ] Ban technician self-approval in `backend/src/routes/budgets.ts` (throw `403 TECH_SELF_APPROVAL_FORBIDDEN`).
  - [ ] Validate `ClientAccessGrant` capability `budget.approve` matching `budget.clientId`.
  - [ ] Enforce client siteKey/locationId scope restriction where present.
  - [ ] Enforce strict re-approval for modified budget revisions.

- [ ] **R04: Source-Aware Claim Architecture & Automatic Draft List Handoff (Atomic)**
  - [ ] Add `sourceType`, `originWeeklogId`, and `supersededByPaymentListId` to `PaymentList`.
  - [ ] Add `claimState` to `PaymentListEntryClaim` (`provisional_auto`, `locked_external`, `locked_internal`, `consumed`).
  - [ ] Hook `createAuthoritativeDraftListFromWeeklog` inside `validateWeeklogBatch`.
  - [ ] Implement ADR-002 claim absorption in confrontation service for external multiweek lists.
  - [ ] Implement direct internal list approval (`POST /api/payment-lists/:id/approve` $\rightarrow$ `ready_for_billing`).
  - [ ] Filter validated weeklogs from default `GET /api/weeklogs` active queue.

- [ ] **R05: External WEEKLOG Intake & Importer UX Contract**
  - [ ] Implement `POST /api/weeklogs/external-import/upload` and staging review table.
  - [ ] Implement commit transition producing `status: 'validated'` with import audit evidence.
  - [ ] Wire external validated weeklog to auto-draft list handoff.
  - [ ] Connect interactive document controls (rotation, zoom, editable grid, bulk downward apply) in frontend importer.

- [ ] **R06: Concise Operational Projections (WEEKLOG + List)**
  - [ ] Implement `GET /api/weeklogs/:id/projection` with joined services summary.
  - [ ] Format `PaymentList` items with canonical VECTIS field mapping.
  - [ ] Update frontend tables to hide part-level damage trivia by default.

- [ ] **R07: Explicit Invoice Handoff & Contractual UI Release Gates**
  - [ ] Implement `POST /api/payment-lists/:id/invoice/create`.
  - [ ] Implement `POST /api/payment-lists/:id/invoice/associate`.
  - [ ] Execute light mode contrast audit (WCAG 2.1 AA).
  - [ ] Execute mobile ($\le 430\text{px}$) and tablet ($768\text{px} - 1024\text{px}$) responsiveness audit.
  - [ ] Execute Operix brand hygiene audit (purge residual "Nexus" occurrences).
  - [ ] Hide generic automation module from active navigation.
  - [ ] Full quality gate verification (`vitest`, typecheck, lint).
