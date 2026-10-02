# Architecture Decisions — Phase 1 Business Flow Reconciliation (R01D Frozen)

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
   - **Just-in-Time Ingestion Guard**: If `finalizeProductionOrder` receives an order whose `deliveredAt > weeklog.endsOn`, the expired week is immediately closed, and the vehicle is assigned to the current active operational week (already validated as GREEN by `WEEK-BOUNDARY-ROLLFORWARD-01`).

---

## ADR-002: Source-Aware Provisional Claims & Deterministic Multiweek / Manual Absorption

### Context & Problem
Spec 004 enforces anti-double-billing using `PaymentListEntryClaim` with a unique index:
```sql
CREATE UNIQUE INDEX "unique_active_or_consumed_weeklog_entry_claim"
ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
WHERE "status" IN ('reserved', 'consumed');
```
If auto-list creation upon WEEKLOG validation immediately issues a `reserved` claim, any external client spreadsheet (e.g., VECTIS monthly PDF spanning 3–4 weeks) or manual list creation will fail due to active unique claim collisions.

### Decision (FROZEN ARCHITECTURE: Reconciled Claims & State Machine)

We choose ONE deterministic architecture that integrates seamlessly with the existing database schema:

#### 1. Claim Lifecycle and Complete Status Values
`PaymentListEntryClaim.status` lifecycle values:
- **`provisional`**: Held by an auto-draft list (`sourceType: "weeklog_auto"`). Non-blocking for external confrontation and manual list absorption, but mutually unique among provisional claims per entry.
  - Lifecycle timestamps: `consumed_at` MUST be NULL, `released_at` MUST be NULL until promotion or absorption/release.
- **`reserved`**: Held by an active definitive list (`sourceType: "manual"` or `"external_import"` or internally reviewed `"ready_for_billing"` list). Strictly blocks any other list from claiming the entry.
  - Lifecycle timestamps: `consumed_at` MUST be NULL, `released_at` MUST be NULL.
- **`consumed`**: Finalized once the associated `PaymentList` transitions to `pending` (invoiced) or `paid`. **100% immutable**.
  - Lifecycle timestamps: `consumed_at` MUST be NOT NULL, `released_at` MUST be NULL.
- **`released`**: Released when a list is cancelled before `pending`, or when a provisional claim is absorbed by an external/manual list.
  - Lifecycle timestamps: `released_at` MUST be NOT NULL, `consumed_at` MUST be NULL.

#### 2. Forward-Only Migration Strategy for Claims (Audited Constraints)
The database already contains constraints `payment_list_entry_claims_status_check` and `payment_list_entry_claims_lifecycle_check` (from `20260921120000` and `20260921130000`). We DO NOT add duplicates with the same name. We freeze a forward-only migration:

```sql
-- 1. Safely replace status check constraint
ALTER TABLE "payment_list_entry_claims"
DROP CONSTRAINT IF EXISTS "payment_list_entry_claims_status_check";

ALTER TABLE "payment_list_entry_claims"
ADD CONSTRAINT "payment_list_entry_claims_status_check"
CHECK ("status" IN ('provisional', 'reserved', 'consumed', 'released'));

-- 2. Safely replace lifecycle consistency check constraint
ALTER TABLE "payment_list_entry_claims"
DROP CONSTRAINT IF EXISTS "payment_list_entry_claims_lifecycle_check";

ALTER TABLE "payment_list_entry_claims"
ADD CONSTRAINT "payment_list_entry_claims_lifecycle_check"
CHECK (
  ("status" = 'provisional' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL)
  OR
  ("status" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL)
  OR
  ("status" = 'released' AND "released_at" IS NOT NULL AND "consumed_at" IS NULL)
);

-- 3. Preserve existing unique index for active or consumed claims:
-- CREATE UNIQUE INDEX "unique_active_or_consumed_weeklog_entry_claim"
-- ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
-- WHERE "status" IN ('reserved', 'consumed');

-- 4. Add partial unique index for provisional claims:
CREATE UNIQUE INDEX "unique_provisional_weeklog_entry_claim"
ON "payment_list_entry_claims" ("workspace_id", "weeklog_entry_id")
WHERE "status" = 'provisional';
```

- **Execution Lineage Authority**:
  We **DO NOT** introduce the report-only invariant `UNIQUE(workspace_id, production_order_id, billing_cycle_id)`. The physical execution authority is `WeeklogEntry` / execution lineage, which correctly supports external WEEKLOG entries that do not possess a `production_order_id`.

#### 3. PaymentList Schema Requirements
To support auto-draft handoff, provenance, and idempotency, `PaymentList` schema requires:
- `sourceType`: enum `weeklog_auto`, `external_import`, `manual`.
- `originWeeklogId`: nullable UUID referencing `Weeklog(id)` (provenance lineage only).
- `originWeeklogValidationId`: nullable UUID referencing `WeeklogValidation(id)` (exact validation-cycle commercial handoff authority).
- `supersededByPaymentListId`: nullable UUID referencing `PaymentList(id)`.
- `status`: enum preserving `draft`, `under_review`, `confronted`, `pending`, `paid`, `cancelled` and adding `ready_for_billing`, `superseded`.
- **Tenant-Safe Composite FKs**:
  `originWeeklogId`, `originWeeklogValidationId`, and `supersededByPaymentListId` strictly preserve Spec004 composite tenant FK architecture:
  - `FOREIGN KEY (origin_weeklog_id, workspace_id) REFERENCES weeklogs(id, workspace_id)`
  - `FOREIGN KEY (origin_weeklog_validation_id, workspace_id) REFERENCES weeklog_validations(id, workspace_id)`
  - `FOREIGN KEY (superseded_by_payment_list_id, workspace_id) REFERENCES payment_lists(id, workspace_id)`
  Never introduce simple cross-workspace FK linkage.
- **Auto-List Idempotency Authority (Approved R03 Preflight Decision)**:
  A single Weeklog can legitimately produce multiple completed Validation Rounds after rectification/re-finalization. Therefore, `originWeeklogId` remains provenance only, and the exactly-once handoff authority is `originWeeklogValidationId`. Auto-draft lists are created from the exact approved coverage of that completed validation round.
- **Deterministic Auto-Draft Validation-Cycle Idempotency Constraint** (`LIST-AUTO-IDEMPOTENT-01`):
  ```sql
  CREATE UNIQUE INDEX "unique_active_auto_payment_list_origin_validation"
  ON "payment_lists" ("workspace_id", "origin_weeklog_validation_id")
  WHERE "source_type" = 'weeklog_auto' AND "status" NOT IN ('cancelled', 'superseded');
  ```

#### 4. Canonical PaymentList State Machine & Post-Invoice Cancellation
- **Internal / Manual Flow**:
  `draft` $\rightarrow$ `ready_for_billing` $\rightarrow$ `invoice/create` OR `invoice/associate` $\rightarrow$ `pending` $\rightarrow$ `paid`
  - Pre-Invoice Cancellation (Allowed): `draft` $\rightarrow$ `cancelled`; `ready_for_billing` $\rightarrow$ `cancelled`. This releases provisional / reserved claims atomically.
  - **Post-Invoice Cancellation (`pending` $\rightarrow$ `cancelled`) is REMOVED from Phase 1**: Consumed claims are immutable. After invoice handoff/pending, any future fiscal cancellation/credit-note workflow is a separate audited post-Phase 1 operation and **MUST NOT** release the consumed `WeeklogEntry` for rebilling.
  - Superseded: `draft` $\rightarrow$ `superseded` (when auto-draft is absorbed by manual list or external confrontation).
- **External Import Flow**:
  `under_review` $\rightarrow$ `confronted` $\rightarrow$ `invoice/create` OR `invoice/associate` $\rightarrow$ `pending` $\rightarrow$ `paid`
  - Pre-Invoice Cancellation (Allowed): `under_review` $\rightarrow$ `cancelled`; `confronted` $\rightarrow$ `cancelled`.
  - Post-Invoice Cancellation (`pending` $\rightarrow$ `cancelled`) is FORBIDDEN.

#### 5. Coexistence with Manual Lists (`LIST-MANUAL-AUTO-COEXIST-01`)
When an operator calls `POST /api/payment-lists` manually selecting `weeklogEntryIds` currently held as `provisional`:
- Within a single transaction:
  1. The provisional claims on the auto-draft are updated to `status = 'released'` with `released_reason = 'absorbed_by_manual_list:<manualListId>'`.
  2. If all entries of the auto-draft list were absorbed, the auto-draft list transitions to `status = 'superseded'`.
  3. The manual list acquires `status = 'reserved'` claims.
- **Guarantees**: Zero double billing, no 409 conflict, full provenance tracking.

#### 6. External Multiweek Absorption & Rollback (`LIST-EXTERNAL-AUTO-ABSORB-01`)
- External lists spanning multiple weeks match against entries across multiple auto-drafts.
- On confrontation commit: provisional claims are marked `released` (`released_reason: "absorbed_by_external_list:<id>"`), and definitive `reserved` claims are issued to the external list.
- If confrontation aborts, transaction rollback preserves provisional claims completely.
- If an entry is already `consumed` (invoiced), absorption is denied (409 Conflict: `ENTRY_ALREADY_BILLED`).

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
       amount: number; // 810.00
     }>;
     totalAmount: number;
   }
   ```

---

## ADR-004: Explicit Invoicing Commands & Direct Billing Order

### Context
Previous drafts conflicted between a single `/invoice` endpoint with a `mode=create|associate` parameter versus dedicated command endpoints. Furthermore, some diagrams incorrectly showed transitions to `pending` before invoice creation.

### Decision (FROZEN API & ORDER)
1. **Explicit Command Endpoints**:
   - `POST /api/payment-lists/:id/invoice/create`: Emits a new invoice in the billing engine and links `invoiceId`.
   - `POST /api/payment-lists/:id/invoice/associate`: Links an externally provided invoice identifier or fiscal number.
2. **Strict Transition Order**:
   - **PaymentList MUST NOT transition to `pending` before invoice handoff.**
   - Handoff from `ready_for_billing` (or `confronted`) executes the invoice command, atomically transitioning `PaymentList.status` to `pending`.
   - Claims transition from `reserved` to `consumed` (immutable).
3. **Finance Revenue Boundaries & Semantics**:
   - `draft`, `ready_for_billing`, `under_review`, `confronted`, `superseded`, `cancelled`:
     - **Expected = 0.00, Received = 0.00** (Zero ledger impact).
   - `pending`:
     - **Expected = recognizedTotal, Received = 0.00**.
   - `paid`:
     - **Expected = 0.00, Received = recognizedTotal**.
   - **Canonical Transition**: A list transitions **FROM Expected TO Received** when `pending` $\rightarrow$ `paid`. A paid list is NEVER counted in both buckets.
4. **Internal Direct Review Actor**:
   - The actor who reviews the auto-draft list into `ready_for_billing` is the **authorized workspace billing operator** (an engineering safety/control checkpoint to verify client billing profile and fiscal metadata, not a redundant workshop manager signature).

---

## ADR-005: Budget Client Authority, Rejection Refinement & Delegation Scope

### Context
In brownfield Spec 002, `TECH-BUDGET-APPROVE-OWN` permitted technicians to approve their own budgets. Alex/VECTIS confirmed that technicians create/revise budgets, but approval/rejection belongs strictly to the client.

### Decision
1. **Technician Self-Approval Banned**:
   - Executor technicians calling `/approve` or `/reject` on their assigned budgets receive `403 Forbidden` (`TECH_SELF_APPROVAL_FORBIDDEN`).
2. **Client Authority & Granular Capabilities**:
   - Approval/rejection requires active `ClientAccessGrant` matching `budget.clientId` with capability `budget.approve`. Cross-client access receives `403 Forbidden` (`CROSS_CLIENT_FORBIDDEN`).
   - Granular client capabilities:
     - `budget.approve`: Client approval/rejection of budget revisions.
     - `weeklog.validate`: Operational sign-off on weekly work logs.
     - `payment_list.review`: Commercial review/confrontation of payment lists.
     - `invoice.view`: Visibility of client invoices.
     - `client.collaborators.manage`: Delegation authority for client administrators.
   - Canonical operational scope: `siteKey` (null = all sites of the client; string = restricted to specific site).
3. **Rejection Reason**:
   - Rejection accepts a `reason` payload. Documented explicitly as an **ENGINEERING/AUDIT REFINEMENT** for traceability and preventing silent dismissals, not a requirement from Alex/VECTIS meetings.
4. **Client Collaborator Delegation (`CLIENT-COLLABORATORS-MANAGE-01`)**:
   - Only a client representative/grant holder with `client.collaborators.manage` may:
     - Create a collaborator grant for the same `clientId` (`POST /api/clients/:clientId/collaborators`).
     - Update capabilities and operational `siteKey` scope (`PATCH /api/clients/:clientId/collaborators/:grantId`).
     - Revoke a collaborator grant (`DELETE /api/clients/:clientId/collaborators/:grantId`).
   - Invariants:
     - Cannot delegate across `clientId` (`403 CROSS_CLIENT_FORBIDDEN`).
     - Cannot grant internal Finance access (`422/403 INVALID_CLIENT_CAPABILITY`).
     - Cannot escalate authority beyond delegator's allowed client capabilities.
5. **Direct Production Orders Preserved (`DIRECT-PO-PRESERVED-01`)**:
   - Canonical flow continues to support direct `POST /api/production-orders` without budget approval.

---

## ADR-006: External WEEKLOG Intake via Canonical Imports Router

### Context
Spec 004 already implements operational intake via `externalOperationalImportService` and router `POST /api/external-operational-imports`. Inventing parallel paths like `/api/external-import/upload` violates architectural consistency.

### Decision
1. **Preserve Canonical Router**:
   - Staging, review, and commit remain anchored at `POST /api/external-operational-imports`.
2. **Delta Formalization**:
   - The **ONLY** new behavior is: upon commit (`POST /api/external-operational-imports/:id/commit`), when weeklogs are marked `validated`, the service atomically triggers the **same automatic draft PaymentList handoff** as a signed internal WEEKLOG, creating a `draft` list with `provisional` claims.

---

## ADR-007: Production Chronological History Timeline

### Context
The production timeline in the UI was previously empty or mocked. We require a minimal chronological fact history.

### Decision
1. **Timeline Derivation Strictly from Canonical Facts**:
   - `GET /api/production-orders/:id/timeline` returns chronological domain events derived strictly from persisted facts:
     - `created`: from `ProductionOrder.createdAt` and `createdBy`
     - `in_production`: from `ProductionOrder.startedAt`
     - `finalized`: from `ProductionOrder.finishedAt` or `deliveredAt`
     - `weeklog_entry`: from associated `WeeklogEntry.createdAt`
     - `rectification_requested` / `reopened`: from `rectificationOriginId` and `executionSequence > 1`
2. **No Fabricated History / No Generic Event Sourcing**:
   - Historical pause/resume events will **never be fabricated** from current state.
   - Generic event sourcing or status audit trail arrays are NOT added in R02.
   - If historical persistence of pause/resume events is required in the future, it will be designed as explicit prospective work outside Spec 006.
