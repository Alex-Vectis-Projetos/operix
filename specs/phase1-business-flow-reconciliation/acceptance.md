# Acceptance Criteria — Phase 1 Business Flow Reconciliation

This document formalizes the 19 normative acceptance criteria for the Phase 1 Business Flow Reconciliation across Specs 003, 004, and 005.

---

## Group 1: Week Boundary, Auto-Closure & Coverage

### WEEK-AUTO-CLOSE-01: Automatic Transition of Expired Open WEEKLOG
- **Given** an open `Weeklog` with `endsOn` timestamp strictly in the past (`endsOn < NOW()`),
- **When** the auto-close runner executes (or when triggered by background check),
- **Then** the `Weeklog` status transitions to `pending_validation`,
- **And** an initial `pending` validation round is established if none exists,
- **And** the transition is recorded with timestamp and reason.

### WEEK-BOUNDARY-ROLLFORWARD-01: Late Vehicle Finalization Belongs to Next Week
- **Given** an operational week boundary that has expired (Saturday 23:59:59.999),
- **When** a `ProductionOrder` is finalized at a timestamp after that boundary,
- **Then** it is assigned exclusively to the subsequent operational week's `Weeklog`,
- **And** it cannot enter the expired week's coverage.

### WEEK-NO-UNFINISHED-01: Unfinished Vehicles Excluded from Closed Week
- **Given** a `ProductionOrder` in status `in_progress` or `ready` during an operational week,
- **When** that week reaches its Saturday boundary and transitions to `pending_validation`,
- **Then** the unfinished order is NOT included in the closed `Weeklog`,
- **And** it remains active in production until finalized in a later week.

### WEEK-CATCHUP-01: Downtime & Server Restart Catch-Up
- **Given** one or more open `Weeklog` records whose `endsOn` passed while the backend was offline,
- **When** the API server boots up and executes the startup reconciliation runner,
- **Then** all expired open `Weeklog` records are safely promoted to `pending_validation`,
- **And** no duplicate validation rounds or erroneous state transitions are created.

### WEEK-CLOSE-IDEMPOTENT-01: Closure Idempotency
- **Given** an expired `Weeklog` that has already transitioned to `pending_validation`,
- **When** the auto-close runner is executed repeatedly or concurrently,
- **Then** the operation succeeds with no-op (`idempotent: true`),
- **And** no duplicate rounds, claims, or audit logs are produced.

### WEEK-PROJECTION-01: Concise Business Projection
- **Given** a `Weeklog` with finalized entries,
- **When** requested via the business projection endpoint / dialog,
- **Then** each entry returns concise operational fields:
  - `serviceLocation` (Site/Local)
  - `deliveredAt` (Completion Date)
  - `brand` and `model` (Vehicle description)
  - `licensePlate` (Plate)
  - `vin` (Chassis / VIN)
  - `serviceNames` (Concatenated operational services)
  - `totalAmount` (Recognized monetary total)
- **And** raw part/panel breakdown grids are not required for business sign-off.

---

## Group 2: WEEKLOG Validation & Automatic Draft List Handoff

### LIST-AUTO-01: Complete Validation Automatically Generates Draft PaymentList
- **Given** a `Weeklog` in `pending_validation` with all entries marked as approved,
- **When** the validation round is signed and submitted,
- **Then** the `Weeklog` status becomes `validated`,
- **And** exactly one `PaymentList` is automatically created with:
  - `status: "draft"`
  - `sourceType: "weeklog_auto"`
  - `originWeeklogId: weeklog.id`
  - items corresponding to all approved `WeeklogEntry` rows.

### LIST-AUTO-IDEMPOTENT-01: Automatic Creation Idempotency & Concurrency Safety
- **Given** a `Weeklog` undergoing validation,
- **When** duplicate validation requests occur concurrently or are retried,
- **Then** only one `PaymentList` is created,
- **And** subsequent calls return the existing `PaymentList` without creating duplicate items or claims.

### LIST-PARTIAL-NO-AUTO-01: Incomplete / Rectification Validation Does Not Create List
- **Given** a `Weeklog` validation where one or more entries are disputed or rejected,
- **When** the round is submitted,
- **Then** the `Weeklog` transitions to `rectification_pending`,
- **And** NO `PaymentList` is generated until all rectifications are fully resolved.

### LIST-WEEKLOG-PRESERVE-01: Signed WEEKLOG Evidence Immutability
- **Given** a `Weeklog` that was successfully validated and triggered an automatic draft List,
- **When** inspect persistence,
- **Then** the `Weeklog`, its entries, signatures, and validation history remain permanently unchanged,
- **And** no destructive deletion or overwriting occurs.

### LIST-ACTIVE-QUEUE-01: Validated WEEKLOG Exits Active Queue into History
- **Given** a validated `Weeklog`,
- **When** the default active `Weeklog` queue is queried (`GET /api/weeklogs`),
- **Then** the validated `Weeklog` does not appear in the active list,
- **And** it is accessible when filtered by `status=validated` or `history=true`.

---

## Group 3: PaymentList Projections, Multiweek & External Import Reconciliation

### LIST-PROJECTION-01: Generated List Conforms to VECTIS Projection
- **Given** an automatically created `PaymentList`,
- **When** queried or exported,
- **Then** each list item carries:
  - Vehicle brand/model, license plate, VIN
  - Completion date (`deliveredAt`)
  - Operational site/local
  - Performed service names summary
  - Canonical recognized amount.

### LIST-MANUAL-PRESERVED-01: Manual PaymentList Flow Remains Intact
- **Given** an authorized user creating a manual `PaymentList` via `POST /api/payment-lists`,
- **When** valid parameters and entries are supplied,
- **Then** the list is created with `sourceType: "manual"` and existing Spec 004 lifecycle behavior is unchanged.

### LIST-IMPORT-PRESERVED-01: External Import & Anti-Double-Billing Coexistence
- **Given** a validated `Weeklog` with an auto-generated draft `PaymentList`,
- **When** an external PDF payment list (e.g. VECTIS PDF) is imported for the same client and coverage,
- **Then** confrontation can reconcile the external items against the auto-draft list or its entries without unique constraint violations,
- **And** entries cannot be double-billed across two active paid lists.

### LIST-MULTIWEEK-PRESERVED-01: Multiweek List Support Preserved
- **Given** an imported or manual `PaymentList` spanning entries from multiple operational weeks,
- **When** submitted or confronted,
- **Then** all multiweek items and cross-week claims are preserved without regression.

---

## Group 4: Invoice Handoff & Finance Boundaries

### LIST-INVOICE-HANDOFF-01: Eligible List Exposes Invoice Create / Associate Handoff
- **Given** a `PaymentList` in `confronted`, `pending`, or `paid` status,
- **When** the operator invokes the invoice handoff endpoint:
  - `POST /api/payment-lists/:id/invoice` to generate a draft `BillingInvoice`, or
  - `POST /api/payment-lists/:id/associate-invoice` with an existing `invoiceId`,
- **Then** `PaymentList.invoiceId` is populated with the referenced invoice,
- **And** foreign workspace invoice linking is strictly rejected (404/403).

### FIN-AUTO-DRAFT-NO-EFFECT-01: Draft List Does Not Mutate Expected or Received
- **Given** an automatically created `PaymentList` in `draft` status,
- **When** the Spec 005 Finance summary is calculated (`GET /api/finance/v2/summary`),
- **Then** `Expected` revenue remains 0.00 (or unchanged),
- **And** `Received` revenue remains 0.00 (or unchanged).

### FIN-PENDING-PAID-PRESERVED-01: Finance Driven Strictly by Pending & Paid
- **Given** a `PaymentList` that progresses through its lifecycle:
  - At `pending`: recognized total contributes to `Expected`,
  - At `paid`: recognized total transitions from `Expected` to `Received`,
- **Then** financial metrics match the canonical Spec 005 ledger.

---

## Group 5: Multi-Tenant Zero Trust Boundary

### CROSS-TENANT-RECONCILIATION-01: Strict Workspace Scoping
- **Given** Workspace A and Workspace B,
- **When** any reconciliation operation (auto-close, validation, auto-list, invoice handoff) is performed in Workspace A,
- **Then** no records in Workspace B are queried, modified, or linked,
- **And** cross-tenant entity references return 404 / deny-by-default.
