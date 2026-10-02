# Acceptance Criteria — Phase 1 Business Flow Reconciliation (R01D Frozen)

## Group 1: Week Boundary, Auto-Closure & Ingestion Guards

### WEEK-AUTO-CLOSE-01: Automatic Expired Week Closure
- **Given** an open Weeklog whose `endsOn` timestamp is in the past (`endsOn < NOW()`),
- **When** the closure runner executes (`reconcileExpiredWeeklogs`),
- **Then** the Weeklog status transitions to `pending_validation`, and an initial validation round is created in `status: 'pending'`.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-BOUNDARY-ROLLFORWARD-01: Late Finalization Rollforward
- **Given** an operational week boundary has passed (Saturday 23:59:59.999),
- **When** an individual vehicle is finalized on Sunday or Monday,
- **Then** it is assigned exclusively to the *new* operational week.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-NO-UNFINISHED-01: Exclusion of Unfinished Vehicles
- **Given** a production order in status `in_progress` or `paused`,
- **When** the weekly boundary closes,
- **Then** this order does not appear in the closed weeklog's coverage.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-CATCHUP-01: Offline / Server Restart Catch-Up
- **Given** a week boundary expired while the backend server was offline,
- **When** the server starts up,
- **Then** the startup hook (`runStartupCatchup`) executes before accepting HTTP requests, safely closing all expired weeks.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-CLOSE-IDEMPOTENT-01: Repeated Closure Idempotency
- **Given** an already-closed or pending Weeklog,
- **When** the closure runner executes repeatedly,
- **Then** no duplicate validation rounds or modified states are produced.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-PROJECTION-01: Concise Business WEEKLOG Projection
- **Given** a Weeklog with validated entries,
- **When** querying `GET /api/weeklogs/:id/projection`,
- **Then** the payload returns vehicle, license plate, VIN, delivery date, site, joined services summary, and total amount, without panel/damage repair trivia.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-AUTO-CLOSE-MANUAL-RACE-01: Concurrent Manual Submit and Auto-Close Race
- **Given** an expired open Weeklog,
- **When** manual submission and the auto-close runner execute concurrently,
- **Then** they converge safely without duplicating validation rounds or producing constraint failures.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-AUTO-CLOSE-CONCURRENT-RUNNERS-01: Multi-Instance Runner Concurrency
- **Given** multiple background runners executing `reconcileExpiredWeeklogs` simultaneously,
- **When** processing the same expired weeklog,
- **Then** `SKIP LOCKED` pessimistic locking ensures exactly one runner executes the state transition and round creation.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-AUTO-CLOSE-NEXT-SEQUENCE-01: Incremental Validation Sequence Preservation
- **Given** a Weeklog that already possesses historical validation rounds (e.g. sequence 1),
- **When** the auto-close runner executes,
- **Then** `validationSequence` is monotonically incremented (e.g. sequence 2) rather than hardcoding sequence 1.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-AUTO-CLOSE-COVERAGE-FREEZE-01: Immutable Coverage Snapshot and System Submitter Semantics
- **Given** an auto-closed Weeklog,
- **When** the validation round is created,
- **Then** its `coverageSnapshot` is frozen immutably with all eligible entries, and `submittedBy` remains `null` (never inventing a fabricated human user).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-PROJECTION-CROSS-TENANT-01: Projection Workspace Boundary Isolation
- **Given** a Weeklog in Workspace B,
- **When** queried by an authenticated actor from Workspace A,
- **Then** the request is rejected with `404 Not Found` without leaking resource existence.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### WEEK-PROJECTION-CLIENT-SITE-SCOPE-01: Client Collaborator Projection Site-Scope Governance
- **Given** a client collaborator with `weeklog.validate` capability scoped to `siteKey = 'site-lyon'`,
- **When** accessing a projection for `'site-lyon'`, the request succeeds (`200 OK`); when accessing `'site-paris'`, it is rejected with `403 Forbidden` (`SITE_SCOPE_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 2: WEEKLOG Validation & Automatic Draft List Handoff

### LIST-AUTO-01: Automatic Draft PaymentList Creation
- **Given** a Weeklog in `pending_validation` with all entries approved,
- **When** the authorized client signs/validates the batch,
- **Then** exactly one draft `PaymentList` is automatically created with `sourceType = 'weeklog_auto'`, bound to `originWeeklogValidationId` (and `originWeeklogId`), and its entries receive `status = 'provisional'`.
- **Status**: `RED` (Proves missing auto-draft trigger).

### LIST-AUTO-IDEMPOTENT-01: Concurrency & Validation-Cycle Idempotency
- **Given** concurrent or repeated calls to validate a Weeklog batch for the same validation round,
- **Then** exactly one `PaymentList` is generated for that validation cycle without duplicate claims or items.
- **Status**: `RED` (Proves missing auto-draft idempotency).

### LIST-PARTIAL-NO-AUTO-01: Incomplete / Rectification Validation
- **Given** a Weeklog batch where one or more entries are disputed/rejected,
- **When** the validation completes with `rectification_requested`,
- **Then** no `PaymentList` is created and the weeklog enters `rectification_pending`.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-WEEKLOG-PRESERVE-01: Immutable Audit Evidence
- **Given** an automatically generated PaymentList,
- **Then** the source `WeeklogValidation` signature and audit trail remain completely immutable.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-ACTIVE-QUEUE-01: Validated Weeklog Queue Exclusion
- **Given** a Weeklog in status `validated`,
- **When** querying the default active queue (`GET /api/weeklogs`),
- **Then** it is omitted from the active queue and accessible only via `?includeTransferred=true` or history filters.
- **Status**: `RED` (Proves missing active queue filter).

---

## Group 3: Projections, Multiweek & ADR-002 Claim Coexistence

### LIST-PROJECTION-01: VECTIS-Compatible List Projection
- **Given** an automatically generated `PaymentList`,
- **Then** its items present: vehicle description, completion date, site key, performed services summary, and amount.
- **Status**: `RED` (Proves missing draft list projection).

### LIST-MANUAL-PRESERVED-01: Manual List Creation
- **Given** an operator creating a manual List via `POST /api/payment-lists`,
- **Then** manual creation remains fully supported alongside auto-generated lists.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-MANUAL-AUTO-COEXIST-01: Coexistence of Manual List & Auto-Draft
- **Given** entries held by an auto-draft list with provisional claims (`status = 'provisional'`),
- **When** an operator manually creates a PaymentList selecting those entries,
- **Then** the manual list is created successfully (`201 Created`), the provisional claims transition to `released` with `released_reason = 'absorbed_by_manual_list:<id>'`, and the manual list acquires `reserved` claims without 409 collision or duplicate billing.
- **Status**: `RED` (Proves missing manual absorption logic).

### LIST-IMPORT-PRESERVED-01: External Document Import & Confrontation
- **Given** an external spreadsheet or PDF import,
- **Then** external parsing and confrontation against internal entries remain functional.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-MULTIWEEK-PRESERVED-01: Multiweek List Creation Preserved
- **Given** an operator or external import creating a List covering entries across multiple operational weeks,
- **When** calling `POST /api/payment-lists`,
- **Then** the list is created successfully without artificial single-week constraints.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-EXTERNAL-AUTO-ABSORB-01: Multiweek External Confrontation Absorption (ADR-002)
- **Given** an external client List spanning entries from multiple operational weeks currently held by auto-draft provisional claims,
- **When** confrontation commits the external List,
- **Then** provisional claims across the affected auto-draft lists are absorbed into authoritative external `reserved` claims, and fully absorbed auto-draft lists are marked `superseded`.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### LIST-PROVENANCE-IMMUTABLE-01: Commercial Provenance Relational Invariants (ON DELETE RESTRICT)
- **Given** an originating draft PaymentList linked to Weeklog, WeeklogValidation, and superseding parent,
- **When** attempting to delete the referenced Weeklog, WeeklogValidation, or parent PaymentList,
- **Then** deletion is strictly rejected by PostgreSQL foreign key constraints (`ON DELETE RESTRICT`).
- **Status**: `GREEN` (ALIGNED — Verified by integration test).

### LIST-INTERNAL-READY-FOR-BILLING-01: Internal Operator Ready for Billing & Claims Transition
- **Given** an auto-draft PaymentList with provisional claims,
- **When** evaluated for `ready_for_billing`,
- **Then** client review capability cannot perform it (`403 FORBIDDEN_ROLE`), internal manager authorization transitions status to `ready_for_billing` and claims from `provisional` to `reserved`, transition is idempotent, Finance impact remains zero, and pre-invoice cancellation correctly releases claims.
- **Status**: `GREEN` (ALIGNED — Verified by integration test).

---

## Group 4: Canonical Invoice Order & Finance Boundaries

### LIST-INVOICE-HANDOFF-01: Explicit Invoice Create & Associate Commands
- **Given** an eligible PaymentList in `ready_for_billing` or `confronted`,
- **When** calling `POST /api/payment-lists/:id/invoice/create` or `POST /api/payment-lists/:id/invoice/associate`,
- **Then** the invoice is created/linked, `paymentList.invoiceId` is populated, status transitions to `pending`, and claims transition to `consumed` (immutable). PaymentList MUST NOT transition to `pending` before this command. Post-invoice cancellation (`pending` $\rightarrow$ `cancelled`) is forbidden in Phase 1.
- **Status**: `RED` (Proves missing `/invoice/create` and `/invoice/associate` command routes).

### FIN-AUTO-DRAFT-NO-EFFECT-01: Zero Draft Finance Impact
- **Given** an automatically generated draft `PaymentList`,
- **When** querying `GET /api/finance/v2/summary`,
- **Then** Expected and Received revenues remain zero.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### FIN-PENDING-PAID-PRESERVED-01: Canonical Revenue Transitions
- **Given** a PaymentList transitioning from `ready_for_billing` to `pending` and then `paid`,
- **Then** `pending` sets Expected = Total, Received = 0; transitioning to `paid` sets Expected = 0, Received = Total (transitions FROM Expected TO Received; never counted in both buckets).
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 5: Multi-Tenant Zero Trust Boundary

### CROSS-TENANT-RECONCILIATION-01: Workspace Isolation
- **Given** Workspace A and Workspace B,
- **Then** no weeklog, production order, claim, or list can be viewed, modified, or claimed across tenant boundaries.
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 6: Budget Authority & Client Governance (Spec 002)

### BUDGET-TECH-NO-SELF-APPROVE-01: Strict Technician Self-Approval Prohibition
- **Given** a Budget created or assigned to a technician,
- **When** that technician attempts to invoke `/approve` or `/reject` on their own Budget,
- **Then** the system returns `403 Forbidden` (`TECH_SELF_APPROVAL_FORBIDDEN`).
- **Status**: `RED` (Superseded old `TECH-BUDGET-APPROVE-OWN` — Proves missing self-approval block).

### BUDGET-CLIENT-APPROVE-01: Client Collaborator Formal Approval
- **Given** a submitted Budget in `pending_approval`,
- **When** an authorized Client Collaborator with `budget.approve` approves the revision,
- **Then** the revision transitions to `approved`, and the linked `ProductionOrder` is generated/updated.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-CLIENT-REJECT-01: Client Collaborator Formal Rejection
- **Given** a submitted Budget in `pending_approval`,
- **When** the Client Collaborator rejects the revision with a reason (engineering audit refinement),
- **Then** the revision transitions to `rejected`, and no production order can be delivered.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-REVISION-REAPPROVAL-01: Mandatory Re-Approval for Modified Budgets
- **Given** an approved Budget that is edited to create a new revision,
- **Then** the new revision enters `draft`/`pending_approval` and cannot originate finalization until approved by the client.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-CROSS-CLIENT-01: Cross-Client Budget Approval Blocked
- **Given** a Client Collaborator belonging to Client A,
- **When** attempting to approve a Budget belonging to Client B,
- **Then** the request is rejected with `403 Forbidden` (`CROSS_CLIENT_FORBIDDEN`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-WORKSPACE-ADMIN-NO-CLIENT-APPROVAL-01: Workspace Admin Cannot Bypass Client Budget Approval
- **Given** a Workspace Owner or Admin lacking an active ClientAccessGrant for Client A,
- **When** calling `POST /api/budgets/:id/revisions/:revId/approve`,
- **Then** the request is rejected with `403 Forbidden` (`VALIDATOR_GRANT_REQUIRED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-SITE-SCOPE-ALLOW-01: Site-Scoped Budget Approval Allowed
- **Given** a Client Collaborator whose grant is scoped to `siteKey = 'site-lyon'`,
- **When** approving a Budget revision whose operational platform/site matches `'site-lyon'`,
- **Then** approval succeeds (`200 OK`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### BUDGET-SITE-SCOPE-DENY-01: Site-Scoped Budget Approval Denied on Mismatch
- **Given** a Client Collaborator whose grant is scoped to `siteKey = 'site-lyon'`,
- **When** attempting to approve a Budget revision whose operational platform/site is `'site-paris'`,
- **Then** the request is rejected with `403 Forbidden` (`SITE_SCOPE_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### DIRECT-PO-PRESERVED-01: Direct Production Order Creation Preserved
- **Given** an authorized workspace user creating a ProductionOrder directly without a `budgetId`,
- **When** calling `POST /api/production-orders`,
- **Then** the production order is created in status `new_vehicle` without forcing budget approval.
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 7: Client Collaborator Governance Scope

### CLIENT-GOVERNANCE-CAPABILITIES-01: Granular Role Capabilities Column
- **Given** a `ClientAccessGrant`,
- **Then** permissions are evaluated against granular capabilities (`budget.approve`, `weeklog.validate`, `payment_list.review`, `invoice.view`, `client.collaborators.manage`).
- **Status**: `GREEN` (ALIGNED — Schema migration applied and runtime resolver active).

### CLIENT-CAPABILITY-BUDGET-APPROVE-01: Budget Approval Capability Enforcement
- **Given** a Client Collaborator session lacking `budget.approve`,
- **When** calling `POST /api/budgets/:id/revisions/:revId/approve`,
- **Then** the request is rejected with `403 Forbidden` (`CAPABILITY_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### CLIENT-CAPABILITY-WEEKLOG-VALIDATE-01: Weeklog Validation Capability Enforcement
- **Given** a Client Collaborator session lacking `weeklog.validate`,
- **When** calling `POST /api/weeklogs/:id/validate`,
- **Then** the request is rejected with `403 Forbidden` (`CAPABILITY_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### CLIENT-CAPABILITY-PAYMENT-LIST-REVIEW-01: Payment List Review Capability Enforcement
- **Given** a Client Collaborator session lacking `payment_list.review`,
- **When** calling canonical review actions such as `PATCH /api/payment-lists/:id/status` or `POST /api/payment-lists/:id/confront`,
- **Then** the request is rejected with `403 Forbidden` (`CAPABILITY_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by real HTTP route test).

### CLIENT-CAPABILITY-INVOICE-VIEW-01: Invoice View Capability Enforcement
- **Given** a Client Collaborator session evaluated for `invoice.view`,
- **When** authority is asserted,
- **Then** the capability model validates the grant; canonical route-level enforcement remains deferred to R05.
- **Status**: `INFRASTRUCTURE_GREEN / ROUTE_WIRING_PENDING_R05` (Model & resolver active; canonical route deferred to R05).

### CLIENT-COLLABORATORS-MANAGE-01: Client Representative Delegation
- **Given** an authorized client representative with `client.collaborators.manage`,
- **When** delegating a new collaborator for Client A via `POST /api/clients/:clientId/collaborators`,
- **Then** the grant is created successfully within client boundary; cross-client delegation returns `403 Forbidden` (`CROSS_CLIENT_FORBIDDEN`), internal Finance access cannot be granted (`422/403 INVALID_CLIENT_CAPABILITY`), and capability escalation is blocked.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### CLIENT-FOCUS-DEFAULT-DENY-01: Newly Created Grant Default Deny
- **Given** a newly created ClientAccessGrant where capabilities are omitted,
- **Then** capabilities default to `[]` (empty array), preventing any ungranted validation or approval actions.
- **Status**: `GREEN` (ALIGNED — Verified by migration and test).

### CLIENT-COLLABORATOR-REINVITE-01: Atomic Collaborator Re-Invite / Reactivation
- **Given** a previously revoked ClientAccessGrant for a user and client,
- **When** reinvited via `POST /api/clients/:clientId/collaborators`,
- **Then** the grant is reactivated atomically with new capabilities and siteKey without unique constraint failure.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### CLIENT-SITE-SCOPE-DENIAL-01: Platform / Local Operational Scope
- **Given** a Client Collaborator with a grant scoped to `siteKey = 'site-lyon'`,
- **When** attempting to validate or approve an entity for `siteKey = 'site-paris'`,
- **Then** the request is rejected with `403 Forbidden` (`SITE_SCOPE_UNAUTHORIZED`).
- **Status**: `GREEN` (ALIGNED — Verified by test).

### CLIENT-NO-FINANCE-LEDGER-01: Internal Ledger Isolation
- **Given** an authenticated Client Collaborator session,
- **When** attempting to access `/api/finance/v2/*`,
- **Then** the request is denied with `403 Forbidden`.
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 8: External WEEKLOG Intake via Canonical Imports Router

### EXT-WEEKLOG-REVIEW-01: External WEEKLOG Staging Review
- **Given** an uploaded external WEEKLOG file via `POST /api/external-operational-imports`,
- **Then** rows are staged in status `extracted` and editable via `PATCH /api/external-operational-imports/:id/rows`.
- **Status**: `GREEN` (ALIGNED — Verified against canonical route).

### EXT-WEEKLOG-VALIDATED-01: Commit to Validated State
- **Given** staged external WEEKLOG entries reviewed and confirmed,
- **When** committing via `POST /api/external-operational-imports/:id/commit`,
- **Then** the generated `Weeklog` is marked `status = 'validated'` with audit trail `external_import_review_committed`.
- **Status**: `GREEN` (ALIGNED — Verified against canonical route).

### EXT-WEEKLOG-AUTO-LIST-01: Automatic Draft List from External WEEKLOG Commit
- **Given** a successfully committed external WEEKLOG via `POST /api/external-operational-imports/:id/commit`,
- **Then** it triggers the same commercial handoff, creating a draft `PaymentList` with provisional claims for those entries.
- **Status**: `GREEN` (ALIGNED — Verified by test).

### EXT-WEEKLOG-AUTO-LIST-IDEMPOTENT-01: External WEEKLOG Handoff Idempotency
- **Given** a repeated or concurrent commit on the same external operational import,
- **Then** exactly 1 draft `PaymentList` exists for those entries.
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 9: Importer UX & Production Timeline

### IMPORT-UX-CONTRACT-01: Interactive Document Controls & Bulk Edit
- **Given** the external import review interface and API,
- **Then** document preview controls (zoom, rotation) and editable row drafts exist in UI (`PaymentListImportDialog.tsx`), and applying values downward to remaining rows is supported and persisted via batch row mutations on `PATCH /api/external-operational-imports/:id/rows`.
- **Status**: `GREEN` (ALIGNED — Verified observable UI contract and batch row API).

### PRODUCTION-HISTORY-01: Chronological Fact Timeline
- **Given** a production order that progressed through creation, production, finalization, weeklog ingestion, and rectification,
- **When** querying `GET /api/production-orders/:id/timeline`,
- **Then** an ordered sequence of real domain events is returned based strictly on canonical facts (zero fabricated pause/resume events).
- **Status**: `GREEN` (ALIGNED — Verified by test).

---

## Group 10: Contractual UI Release Gates

### UI-LIGHT-MODE-01: Light Mode Usability Gate
- **Then** light mode passes minimum WCAG 2.1 AA contrast requirements across all core tables and forms.
- **Status**: `STATIC_GREEN / RUNTIME_PENDING` (Automated CSS check passes; browser homologation in R07).

### UI-MOBILE-CORE-01: Mobile Core Responsiveness Gate
- **Then** technician vehicle inspection, photo upload, and budget creation render without clipping on viewport $\le 430\text{px}$.
- **Status**: `STATIC_GREEN / RUNTIME_PENDING` (Automated HTML viewport check passes; browser homologation in R07).

### UI-TABLET-CORE-01: Tablet Core Responsiveness Gate
- **Then** manager WEEKLOG review and confrontation split-view render cleanly on viewport $768\text{px} - 1024\text{px}$.
- **Status**: `STATIC_GREEN / RUNTIME_PENDING` (Automated CSS responsive classes check passes; browser homologation in R07).

### UI-BRAND-OPERIX-01: Operix Brand Hygiene Gate
- **Then** zero occurrences of "Nexus" or "WorkNexus" exist in active UI views, titles, and manifest.
- **Status**: `RED` (Proves residual Nexus strings in `index.html`).

### UI-AUTOMATION-HIDDEN-01: Automation Module Hidden Gate
- **Then** the deferred generic automation engine is absent from the main application navigation.
- **Status**: `GREEN` (ALIGNED — Verified by test).

