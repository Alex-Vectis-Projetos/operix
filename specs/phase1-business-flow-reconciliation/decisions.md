# Architecture Decisions — Phase 1 Business Flow Reconciliation (R01B Frozen)

## ADR-001: Week Boundary Auto-Closure & Startup Catch-Up Engine

### Context
In Operix brownfield, week boundaries are computed Sunday 00:00:00.000 to Saturday 23:59:59.999 via `operationalWeekOf` in `backend/src/lib/weekUtils.ts`. Previously, transitioning a Weeklog from `open` to `pending_validation` required a manual POST to `/api/weeklogs/:id/submit-for-validation`. If the server restarted or an operator forgot to submit, expired weeks remained open and could accept invalid late entries.

### Decision
1. **Domain Service `reconcileExpiredWeeklogs`**:
   - Location: `backend/src/services/weeklogService.ts`.
   - Queries all `weeklogs` with `status = 'open'` and `endsOn < NOW()`.
   - In a pessimistic lock transaction (`SELECT ... FOR UPDATE SKIP LOCKED`):
     - Transitions `status` from `open` to `pending_validation`.
     - Ensures an initial `WeeklogValidation` round exists with `validationSequence = 1` and `status = 'pending'`.
     - Generates audit event `weeklog.auto_closed`.
2. **Three-Tier Trigger Hierarchy**:
   - **Boot Catch-Up**: Executed in `backend/src/index.ts` before HTTP listener starts (`runStartupCatchup`).
   - **Periodic Background Cron**: Runs every 60 seconds across all active workspaces.
   - **Just-in-Time Ingestion Guard**: If `finalizeProductionOrder` receives an order whose `deliveredAt > weeklog.endsOn`, the expired week is immediately closed, and the vehicle is assigned to the current active operational week.

---

## ADR-002: Deterministic Provisional Claim Absorption for External & Multiweek Lists

### Context & Problem
Spec 004 enforces anti-double-billing using `PaymentListEntryClaim` with a unique index:
```sql
CREATE UNIQUE INDEX "unique_active_or_consumed_weeklog_entry_claim"
ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
WHERE "status" IN ('reserved', 'consumed');
```
If auto-list creation upon WEEKLOG validation immediately issues non-provisional claims, any external client spreadsheet (e.g. VECTIS monthly PDF spanning 4 weeks) will fail during confrontation or import due to unique claim conflicts.

### Decision (FROZEN ARCHITECTURE: Provisional Claim Absorption)
We choose ONE deterministic architecture: **Source-Aware Provisional Claims with Multiweek Auto-Draft Absorption**.

#### 1. Entity Attributes & Claim States
- `PaymentList.sourceType`: `"weeklog_auto" | "external_import" | "manual"`
- `PaymentList.status`: `"draft" | "under_review" | "confronted" | "ready_for_billing" | "pending" | "paid" | "superseded"`
- `PaymentList.originWeeklogId`: Foreign key to `Weeklog` (for `weeklog_auto`)
- `PaymentList.supersededByPaymentListId`: Traceability link when absorbed
- `PaymentListEntryClaim.claimState`:
  - `provisional_auto`: Held by a `weeklog_auto` list while in `draft`. Does not block confrontation.
  - `locked_external`: Held by an external import during confrontation or approval.
  - `locked_internal`: Confirmed by user in direct internal billing path.
  - `consumed`: Finalized once the associated List is marked `pending` or `paid`.

#### 2. Deterministic State Transitions
```text
[WEEKLOG Validated]
       │
       ▼ (Atomic Trigger)
[Create PaymentList: sourceType=weeklog_auto, status=draft]
[Issue PaymentListEntryClaim: claimState=provisional_auto]
       │
       ├─────────────────────────────────────────┐
       │ (Path A: Direct Internal Billing)      │ (Path B: External Multiweek List Arrives)
       ▼                                         ▼
[User Approves List: ready_for_billing]   [Confrontation Matches Provisional Entries]
[claimState -> locked_internal]           [Provisional Claims Absorbed -> locked_external]
       │                                  [Auto-Draft List -> status=superseded]
       ▼                                         │
[POST /api/payment-lists/:id/invoice/create]      ▼
       │                                  [Confronted List -> ready_for_billing]
       ▼                                         │
[PaymentList: status=pending]                    ▼
[claimState -> consumed (Immutable)]       [Invoice Command & status=pending]
```

#### 3. Multiweek & Cross-Draft Absorption Rules
- An external List may span entries from multiple auto-draft Lists (e.g. Weeks 36, 37, 38).
- Upon confrontation commit:
  - If **all** entries of an auto-draft list are absorbed, that auto-draft list transitions to `superseded` with `supersededByPaymentListId = externalList.id`.
  - If only **some** entries are absorbed (partial confrontation), the auto-draft list retains its unabsorbed items, reducing its total.
- **Rollback & Inviolability**: If confrontation commit fails, transaction rollback restores provisional claims. If an entry is already in `pending` or `paid` (`claimState = consumed`), external absorption is strictly rejected (409 Conflict: `ENTRY_ALREADY_BILLED`).

---

## ADR-003: Concise Operational Projections for Business Views

### Context
`GET /api/weeklogs/:id` returns the full relational graph (panels, paint stages, labor hours, photos). Alex/VECTIS verified that business management and client sign-off require a clean, concise vehicle-level operational summary without mechanical repair trivia.

### Decision
1. **Dedicated Projection Endpoint**:
   - `GET /api/weeklogs/:id/projection`
2. **Standard Payload Structure**:
   ```typescript
   interface ConciseOperationalProjection {
     weeklogId: string;
     siteKey: string;
     clientName: string;
     weekDisplay: string;
     items: Array<{
       entryId: string;
       completionDate: string; // ISO YYYY-MM-DD
       vehicleDescription: string; // "BMW Serie 1"
       licensePlate: string; // "EW-621-GF"
       vin: string; // "WBA1V710305G06196"
       servicesSummary: string; // "Dégarnissage + T1"
       totalAmount: string; // "810.00"
       currencyCode: string; // "EUR"
       validationStatus: string; // "approved" | "rejected"
     }>;
     grandTotal: string;
     currencyCode: string;
   }
   ```
3. Full inspection details remain available in modal audit endpoints (`GET /api/weeklogs/:id/entries/:entryId`).

---

## ADR-004: Explicit Invoice Handoff Commands & Direct Billing

### Context
`PaymentList` had nullable `invoiceId` and `documentId` without explicit API command contracts. Additionally, the system must support businesses that bill directly from internal validated lists without importing an external client statement.

### Decision (FROZEN API CONTRACT: Explicit Commands)
We standardize on two explicit command endpoints in `backend/src/routes/paymentLists.ts`:

1. **Create Invoice Command**:
   - Route: `POST /api/payment-lists/:id/invoice/create`
   - Precondition: `paymentList.status` must be `ready_for_billing` or `confronted`.
   - Behavior: Creates an `Invoice` record in `invoices` table, populates items, updates `paymentList.invoiceId = invoice.id`, transitions `paymentList.status = 'pending'`, and moves entry claims to `consumed`.
2. **Associate Invoice Command**:
   - Route: `POST /api/payment-lists/:id/invoice/associate`
   - Payload: `{ invoiceId: string }`
   - Behavior: Verifies tenant access and client match, links `paymentList.invoiceId`, transitions list to `pending`.

#### Direct Internal Billing Path (Zero External Import Needed)
1. WEEKLOG validates $\rightarrow$ auto-draft `PaymentList` created (`status: 'draft'`).
2. Workshop manager reviews internal items $\rightarrow$ executes `POST /api/payment-lists/:id/approve`.
3. List transitions to `ready_for_billing`.
4. User invokes `POST /api/payment-lists/:id/invoice/create`.
5. Invoice generated; list moves to `pending` (feeding Expected Revenue). No external confrontation required.

---

## ADR-005: Client Governance Scope & Strict Technician Self-Approval Ban

### Context
Spec 002 permitted technicians to approve their own budgets (`TECH-BUDGET-APPROVE-OWN`). In commercial reality (Alex / VECTIS), technicians are contractors/service providers and must **never** approve financial obligations for the client. Approval must belong exclusively to client company collaborators.

### Decision
1. **Technician Self-Approval Superseded**:
   - `TECH-BUDGET-APPROVE-OWN` is classified as **superseded and prohibited**.
   - If `actorUserId === budget.technicianUserId` or actor is a technician without an active client grant, `POST /api/budgets/:id/revisions/:revisionId/approve` and `/reject` return **403 Forbidden (`TECH_SELF_APPROVAL_FORBIDDEN`)**.
2. **ClientAccessGrant Capability Governance**:
   - Enforce explicit capability: `budget.approve`.
   - Must match `budget.clientId`. Cross-client approvals return **403 Forbidden (`CROSS_CLIENT_FORBIDDEN`)**.
   - Optional `siteKey` / `locationId`: If specified on grant, the collaborator can only approve budgets belonging to that operational site.
3. **Budget Revisions**:
   - Any modification to an approved budget creates a new revision in `status = 'pending_approval'`. The budget must be re-approved by the client before production changes can be finalized.

---

## ADR-006: External WEEKLOG Intake & Review Staging

### Context
In addition to internal vehicle finalization, clients or remote workshops may submit an external WEEKLOG file (spreadsheet or PDF).

### Decision
1. Staging workflow mirrors external list imports:
   - `POST /api/weeklogs/external-import/upload` $\rightarrow$ parses document, extracts rows to staging table.
   - `PUT /api/weeklogs/external-import/:importId/rows/:rowId` $\rightarrow$ allows manual correction.
   - `POST /api/weeklogs/external-import/:importId/commit` $\rightarrow$ commits rows into a canonical `Weeklog` with `status: 'validated'`.
2. Validated external weeklogs trigger the exact same idempotent commercial handoff as internal weeklogs, producing a draft `PaymentList` without fake `ProductionOrder` records.

---

## ADR-007: Production Minimum History Timeline

### Context
The production view lacked a canonical timeline of events.

### Decision
A read-only timeline endpoint `GET /api/production-orders/:id/timeline` returns a deterministic sequence synthesized from immutable relational events:
1. `created`: Timestamp from `ProductionOrder.createdAt`.
2. `started`: First status transition to `in_production`.
3. `paused` / `resumed`: History from status transition logs.
4. `finalized`: Timestamp of finalization (`deliveredAt`).
5. `weeklog_enrolled`: Linked `WeeklogEntry.createdAt`.
6. `rectification_requested`: If entry status transitioned to `rectification_requested`.
7. `re_finalized`: If order was re-delivered after rectification.
