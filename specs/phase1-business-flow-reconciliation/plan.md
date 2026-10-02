# Implementation Plan — Phase 1 Business Flow Reconciliation (R02–R05)

## 1. Overview & Strategy
This plan structures the subsequent implementation phases (R02–R05) to reconcile Operix Core with the confirmed business flow. Each phase represents a targeted vertical slice with strict rollback boundaries and zero horizontal rewrites.

---

## 2. Phase Breakdown

### Phase R02: Week Boundary Auto-Closure & Startup Catch-Up
- **Objective**: Ensure that once Saturday 23:59:59.999 passes, open weeklogs automatically freeze and become `pending_validation`, and late vehicles roll forward to the next operational week.
- **Components to Modify/Add**:
  - `backend/src/services/weeklogService.ts`: Add `reconcileExpiredWeeklogs(workspaceId?: string)`.
  - `backend/src/lib/weekCloseRunner.ts`: Background runner with setInterval and startup hook.
  - `backend/src/index.ts`: Register runner on server startup.
  - `backend/src/services/productionOrderService.ts`: In `finalizeProductionOrder`, ensure late deliveries roll forward to the next operational week.
- **Verification Gates**:
  - `WEEK-AUTO-CLOSE-01`, `WEEK-BOUNDARY-ROLLFORWARD-01`, `WEEK-NO-UNFINISHED-01`, `WEEK-CATCHUP-01`, `WEEK-CLOSE-IDEMPOTENT-01` turn GREEN.

### Phase R03: WEEKLOG Validation to Automatic Draft PaymentList
- **Objective**: Complete signature and validation of all entries in a WEEKLOG automatically generates exactly one draft `PaymentList`, moves the WEEKLOG out of active queue into history, and preserves permanent evidence.
- **Components to Modify/Add**:
  - `backend/src/services/weeklogService.ts`: In `validateWeeklogBatch`, atomically trigger `createAutoPaymentListFromValidatedWeeklog(tx, workspaceId, weeklogId)`.
  - `backend/src/services/paymentListService.ts`: Expose auto-creation internal helper supporting `sourceType = 'weeklog_auto'`.
  - Query filtering: Update `listWeeklogs` in `weeklogService.ts` and `useWeeklogs.ts` to support active queue (`status != 'validated'`) vs history (`status == 'validated'`).
- **Verification Gates**:
  - `LIST-AUTO-01`, `LIST-AUTO-IDEMPOTENT-01`, `LIST-PARTIAL-NO-AUTO-01`, `LIST-WEEKLOG-PRESERVE-01`, `LIST-ACTIVE-QUEUE-01` turn GREEN.

### Phase R04: Source-Aware Claims & External Import Reconciliation
- **Objective**: Harmonize automatic draft list claims with external import confrontation so that imported client statements (VECTIS PDF) can reconcile without claim unique constraint collisions. Format concise projections.
- **Components to Modify/Add**:
  - `backend/prisma/schema.prisma`: Add `sourceType` and optional `originWeeklogId` to `PaymentList`.
  - Migration: Versioned forward-only migration adding fields and adjusting claim status indexes for provisional auto-drafts.
  - `backend/src/services/confrontationService.ts`: Update candidate entry matching to allow reconciling against auto-draft list items.
  - UI Projections: Concise presentation in `WeeklogValidationDialog.tsx` and `PaymentListDetail.tsx` (Vehicle, Plate, VIN, Site, Delivery Date, Services summary, Total).
- **Verification Gates**:
  - `WEEK-PROJECTION-01`, `LIST-PROJECTION-01`, `LIST-MANUAL-PRESERVED-01`, `LIST-IMPORT-PRESERVED-01`, `LIST-MULTIWEEK-PRESERVED-01` turn GREEN.

### Phase R05: Minimal Invoice Handoff Boundary
- **Objective**: Allow an eligible `PaymentList` (`confronted`, `pending`, `paid`) to create a draft `BillingInvoice` or associate an existing invoice.
- **Components to Modify/Add**:
  - `backend/src/routes/paymentLists.ts`:
    - `POST /api/payment-lists/:id/invoice`
    - `POST /api/payment-lists/:id/associate-invoice`
  - `backend/src/services/paymentListService.ts`: Implement `generateDraftInvoiceForList` and `associateInvoiceForList`.
  - Frontend: Add invoice handoff buttons and dialog in `PaymentListDetail.tsx`.
- **Verification Gates**:
  - `LIST-INVOICE-HANDOFF-01`, `FIN-AUTO-DRAFT-NO-EFFECT-01`, `FIN-PENDING-PAID-PRESERVED-01`, `CROSS-TENANT-RECONCILIATION-01` turn GREEN.

---

## 3. Rollback & Risk Analysis
- **Zero Schema Destruction**: All migration changes are additive (`sourceType`, `originWeeklogId`).
- **Graceful Runner Degradation**: If the background runner fails, manual validation endpoints remain functional.
- **Finance Boundary Protection**: No auto-created draft list can impact the Spec 005 ledger.
