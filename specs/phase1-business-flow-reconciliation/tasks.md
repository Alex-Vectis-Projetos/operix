# Task Tracking — Phase 1 Business Flow Reconciliation

## R00 / R01: Audit, Contract Freeze & Red Acceptance Tests (CURRENT)
- [x] **T01-AUDIT**: Audit existing implementation of Weeklog lifecycle, boundaries, validation, PaymentList creation, claims, and invoice handoffs.
- [x] **T02-CONTRACT**: Document exact deltas and architectural decisions in `spec.md`, `decisions.md`, `acceptance.md`, `plan.md`.
- [x] **T03-RED-TESTS**: Add comprehensive RED acceptance test suite proving missing behavior without regressing existing green suites.
- [ ] **T04-HANDOFF-APPROVAL**: Obtain user approval for the frozen contract before implementing product code.

---

## R02: Week Boundary & Auto-Close Runner
- [ ] **T05-AUTO-CLOSE-SERVICE**: Implement `reconcileExpiredWeeklogs` in `weeklogService.ts`.
- [ ] **T06-RUNNER-SCHEDULE**: Implement idempotent background runner and server boot catch-up in `weekCloseRunner.ts` and `index.ts`.
- [ ] **T07-ROLLFORWARD-GUARD**: Update `finalizeProductionOrder` to roll forward late deliveries to the next operational week.
- [ ] **T08-VERIFY-R02**: Verify `WEEK-AUTO-CLOSE-01`, `WEEK-BOUNDARY-ROLLFORWARD-01`, `WEEK-NO-UNFINISHED-01`, `WEEK-CATCHUP-01`, `WEEK-CLOSE-IDEMPOTENT-01` pass.

---

## R03: Complete WEEKLOG Validation to Automatic Draft PaymentList
- [ ] **T09-AUTO-LIST-CREATION**: Implement transactional auto-creation of draft `PaymentList` upon complete validation in `validateWeeklogBatch`.
- [ ] **T10-AUTO-LIST-IDEMPOTENCY**: Implement idempotency guard preventing duplicate lists/items/claims on repeated validation calls.
- [ ] **T11-PARTIAL-GUARD**: Ensure `rectification_pending` holds list creation.
- [ ] **T12-ACTIVE-QUEUE-FILTER**: Update `listWeeklogs` to support default active queue (excluding validated) and history filter.
- [ ] **T13-VERIFY-R03**: Verify `LIST-AUTO-01`, `LIST-AUTO-IDEMPOTENT-01`, `LIST-PARTIAL-NO-AUTO-01`, `LIST-WEEKLOG-PRESERVE-01`, `LIST-ACTIVE-QUEUE-01` pass.

---

## R04: Source-Aware Claims & External Import Reconciliation
- [ ] **T14-SCHEMA-EXPAND**: Add `sourceType` and `originWeeklogId` to `PaymentList` via versioned migration.
- [ ] **T15-CONFRONTATION-HARMONIZE**: Update confrontation engine to resolve external imports against auto-draft lists without claim collision.
- [ ] **T16-CONCISE-PROJECTIONS**: Update WEEKLOG and PaymentList frontend projections to mirror the VECTIS sample.
- [ ] **T17-VERIFY-R04**: Verify `WEEK-PROJECTION-01`, `LIST-PROJECTION-01`, `LIST-MANUAL-PRESERVED-01`, `LIST-IMPORT-PRESERVED-01`, `LIST-MULTIWEEK-PRESERVED-01` pass.

---

## R05: Minimal Invoice Handoff Boundary
- [ ] **T18-INVOICE-ROUTES**: Implement `POST /api/payment-lists/:id/invoice` and `POST /api/payment-lists/:id/associate-invoice`.
- [ ] **T19-INVOICE-UI**: Add invoice generation/association modal and action buttons in `PaymentListDetail.tsx`.
- [ ] **T20-FINANCE-VERIFICATION**: Verify draft list zero ledger impact and pending/paid transitions.
- [ ] **T21-VERIFY-R05**: Verify `LIST-INVOICE-HANDOFF-01`, `FIN-AUTO-DRAFT-NO-EFFECT-01`, `FIN-PENDING-PAID-PRESERVED-01`, `CROSS-TENANT-RECONCILIATION-01` pass.
- [ ] **T22-FINAL-HOMOLOGATION**: Complete full Phase 1 regression test suite and documentation sign-off.
