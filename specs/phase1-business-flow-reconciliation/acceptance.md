# Acceptance Criteria — Phase 1 Business Flow Reconciliation (R01B Frozen)

## Group 1: Week Boundary, Auto-Closure & Ingestion Guards

### WEEK-AUTO-CLOSE-01: Automatic Expired Week Closure
- **Given** an open Weeklog whose `endsOn` timestamp is in the past (`endsOn < NOW()`),
- **When** the closure runner executes (`reconcileExpiredWeeklogs`),
- **Then** the Weeklog status transitions to `pending_validation`, and an initial validation round is created in `status: 'pending'`.

### WEEK-BOUNDARY-ROLLFORWARD-01: Late Finalization Rollforward
- **Given** an operational week boundary has passed (Saturday 23:59:59.999),
- **When** an individual vehicle is finalized on Sunday or Monday,
- **Then** it is assigned exclusively to the *new* operational week.

### WEEK-NO-UNFINISHED-01: Exclusion of Unfinished Vehicles
- **Given** a production order in status `in_progress` or `paused`,
- **When** the weekly boundary closes,
- **Then** this order does not appear in the closed weeklog's coverage.

### WEEK-CATCHUP-01: Offline / Server Restart Catch-Up
- **Given** a week boundary expired while the backend server was offline,
- **When** the server starts up,
- **Then** the startup hook (`runStartupCatchup`) executes before accepting HTTP requests, safely closing all expired weeks.

### WEEK-CLOSE-IDEMPOTENT-01: Repeated Closure Idempotency
- **Given** an already-closed or pending Weeklog,
- **When** the closure runner executes repeatedly,
- **Then** no duplicate validation rounds or modified states are produced.

### WEEK-PROJECTION-01: Concise Business WEEKLOG Projection
- **Given** a Weeklog with validated entries,
- **When** querying `GET /api/weeklogs/:id/projection`,
- **Then** the payload returns vehicle, license plate, VIN, delivery date, site, joined services summary, and total amount, without panel/damage repair trivia.

---

## Group 2: WEEKLOG Validation & Automatic Draft List Handoff

### LIST-AUTO-01: Automatic Draft PaymentList Creation
- **Given** a Weeklog in `pending_validation` with all entries approved,
- **When** the authorized client signs/validates the batch,
- **Then** exactly one draft `PaymentList` is automatically created with `sourceType = 'weeklog_auto'`, and its entries receive `claimState = 'provisional_auto'`.

### LIST-AUTO-IDEMPOTENT-01: Concurrency & Retry Idempotency
- **Given** concurrent or repeated calls to validate a Weeklog batch,
- **Then** exactly one `PaymentList` is generated without duplicate claims or items.

### LIST-PARTIAL-NO-AUTO-01: Incomplete / Rectification Validation
- **Given** a Weeklog batch where one or more entries are disputed/rejected,
- **When** the validation completes with `rectification_requested`,
- **Then** no `PaymentList` is created and the weeklog enters `rectification_pending`.

### LIST-WEEKLOG-PRESERVE-01: Immutable Audit Evidence
- **Given** an automatically generated PaymentList,
- **Then** the source `WeeklogValidation` signature and audit trail remain completely immutable.

### LIST-ACTIVE-QUEUE-01: Validated Weeklog Queue Exclusion
- **Given** a Weeklog in status `validated`,
- **When** querying the default active queue (`GET /api/weeklogs`),
- **Then** it is omitted from the active queue and accessible only via `?status=validated` or `?history=true`.

---

## Group 3: Projections, Multiweek & ADR-002 Claim Absorption

### LIST-PROJECTION-01: VECTIS-Compatible List Projection
- **Given** an automatically generated `PaymentList`,
- **Then** its items present: vehicle description, completion date, site key, performed services summary, and amount.

### LIST-MANUAL-PRESERVED-01: Manual List Creation
- **Given** an operator creating a manual List via `POST /api/payment-lists`,
- **Then** manual creation remains fully supported alongside auto-generated lists.

### LIST-IMPORT-PRESERVED-01: External Document Import & Confrontation
- **Given** an external spreadsheet or PDF import,
- **Then** external parsing and confrontation against internal entries remain functional.

### LIST-MULTIWEEK-PRESERVED-01: Multiweek Confrontation & Claim Absorption (ADR-002)
- **Given** an external client List spanning entries from multiple operational weeks,
- **When** confrontation commits the external List,
- **Then** provisional claims across the affected auto-draft lists are absorbed into authoritative external claims, and fully absorbed auto-draft lists are marked `superseded`.

---

## Group 4: Invoice Commands & Finance Boundaries

### LIST-INVOICE-HANDOFF-01: Explicit Invoice Create & Associate Commands
- **Given** an eligible PaymentList in `ready_for_billing` or `confronted`,
- **When** calling `POST /api/payment-lists/:id/invoice/create` or `POST /api/payment-lists/:id/invoice/associate`,
- **Then** the invoice is created/linked, `paymentList.invoiceId` is populated, and status transitions to `pending`.

### FIN-AUTO-DRAFT-NO-EFFECT-01: Zero Draft Finance Impact
- **Given** an automatically generated draft `PaymentList`,
- **When** querying `GET /api/finance/v2/summary`,
- **Then** Expected and Received revenues remain zero.

### FIN-PENDING-PAID-PRESERVED-01: Canonical Revenue Transitions
- **Given** a PaymentList transitioning from `ready_for_billing` to `pending` and then `paid`,
- **Then** Expected revenue increments on `pending`, and Received increments on `paid`.

---

## Group 5: Multi-Tenant Zero Trust Boundary

### CROSS-TENANT-RECONCILIATION-01: Workspace Isolation
- **Given** Workspace A and Workspace B,
- **Then** no weeklog, production order, claim, or list can be viewed, modified, or claimed across tenant boundaries.

---

## Group 6: Budget Authority & Client Governance (Spec 002)

### BUDGET-CLIENT-APPROVE-01: Client Collaborator Formal Approval
- **Given** a submitted Budget in `pending_approval`,
- **When** an authorized Client Collaborator with `budget.approve` approves the revision,
- **Then** the revision transitions to `approved`, and the linked `ProductionOrder` is generated/updated.

### BUDGET-CLIENT-REJECT-01: Client Collaborator Formal Rejection
- **Given** a submitted Budget in `pending_approval`,
- **When** the Client Collaborator rejects the revision with a mandatory reason,
- **Then** the revision transitions to `rejected`, and no production order can be delivered.

### BUDGET-TECH-NO-SELF-APPROVE-01: Strict Technician Self-Approval Prohibition
- **Given** a Budget created or assigned to a technician,
- **When** that technician attempts to invoke `/approve` or `/reject` on their own Budget,
- **Then** the system returns `403 Forbidden` (`TECH_SELF_APPROVAL_FORBIDDEN`).

### BUDGET-REVISION-REAPPROVAL-01: Mandatory Re-Approval for Modified Budgets
- **Given** an approved Budget that is edited to create a new revision,
- **Then** the new revision enters `pending_approval` and cannot originate finalization until approved by the client.

### BUDGET-CROSS-CLIENT-01: Cross-Client Budget Approval Blocked
- **Given** a Client Collaborator belonging to Client A,
- **When** attempting to approve a Budget belonging to Client B,
- **Then** the request is rejected with `403 Forbidden` (`CROSS_CLIENT_FORBIDDEN`).

---

## Group 7: Client Collaborator Governance Scope

### CLIENT-GOVERNANCE-CAPABILITIES-01: Granular Role Capabilities
- **Given** a `ClientAccessGrant`,
- **Then** permissions are evaluated against granular capabilities (`budget.approve`, `weeklog.validate`, `payment_list.review`, `invoice.view`).

### CLIENT-GOVERNANCE-LOCAL-SCOPE-01: Platform / Local Operational Scope
- **Given** a Client Collaborator with a grant scoped to `siteKey = 'site-lyon'`,
- **When** attempting to validate or approve an entity for `siteKey = 'site-paris'`,
- **Then** the request is rejected with `403 Forbidden` (`SITE_SCOPE_UNAUTHORIZED`).

### CLIENT-NO-FINANCE-LEDGER-01: Internal Ledger Isolation
- **Given** an authenticated Client Collaborator session,
- **When** attempting to access `/api/finance/v2/*`,
- **Then** the request is denied with `403 Forbidden`.

---

## Group 8: External WEEKLOG Flow

### EXT-WEEKLOG-REVIEW-01: External WEEKLOG Staging Review
- **Given** an uploaded external WEEKLOG file,
- **Then** rows are staged and editable before final commit.

### EXT-WEEKLOG-VALIDATED-01: Commit to Validated State
- **Given** staged external WEEKLOG entries reviewed and confirmed,
- **When** committing the import,
- **Then** the generated `Weeklog` is created in status `validated` with import review audit evidence.

### EXT-WEEKLOG-AUTO-LIST-01: Automatic Draft List from External WEEKLOG
- **Given** a successfully committed external WEEKLOG,
- **Then** it triggers the same commercial handoff, creating a draft `PaymentList` without fake `ProductionOrder` records.

### EXT-WEEKLOG-AUTO-LIST-IDEMPOTENT-01: External WEEKLOG Handoff Idempotency
- **Given** a committed external WEEKLOG,
- **Then** repeated calls produce strictly 1 `PaymentList`.

---

## Group 9: Importer UX & Production Timeline

### IMPORT-UX-CONTRACT-01: Interactive Document Controls & Bulk Edit
- **Given** the external import review interface,
- **Then** the original document is visible with rotate, zoom, column correction, and downward bulk apply.

### PRODUCTION-HISTORY-01: Chronological Fact Timeline
- **Given** a production order that progressed through creation, production, finalization, weeklog ingestion, and rectification,
- **When** querying `GET /api/production-orders/:id/timeline`,
- **Then** an ordered sequence of real domain events is returned.

---

## Group 10: Contractual UI Release Gates

### UI-LIGHT-MODE-01: Light Mode Usability Gate
- **Then** light mode passes minimum WCAG 2.1 AA contrast requirements across all core tables and forms.

### UI-MOBILE-CORE-01: Mobile Core Responsiveness Gate
- **Then** technician vehicle inspection, photo upload, and budget creation render without clipping on viewport $\le 430\text{px}$.

### UI-TABLET-CORE-01: Tablet Core Responsiveness Gate
- **Then** manager WEEKLOG review and confrontation split-view render cleanly on viewport $768\text{px} - 1024\text{px}$.

### UI-BRAND-OPERIX-01: Operix Brand Hygiene Gate
- **Then** zero occurrences of "Nexus" or "WorkNexus" exist in active UI views and titles.

### UI-AUTOMATION-HIDDEN-01: Automation Module Hidden Gate
- **Then** the deferred generic automation engine is absent from the main application navigation.
