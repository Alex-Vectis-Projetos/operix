# Operix Core — Phase 1 Homologation & Handoff Guide

## 1. Overview & Purpose
This guide prepares **Operix Core — Phase 1 (Release Candidate 1)** for business homologation by the VECTIS team. It details human-verifiable functional workflows, intentional architectural limitations, client sample dependencies, and the non-conformities feedback loop.

- **Current Status**: **AWAITING_VECTIS_HOMOLOGATION** (Technically Ready)
- **Delivered Specifications**:
  - Spec 001: Foundation, Multi-Tenancy & Zero-Trust Security
  - Spec 002: Mobile Operational Flow (Budget $\rightarrow$ Production Order)
  - Spec 003: Operational Consolidation (Production $\rightarrow$ WEEKLOG $\rightarrow$ Versioned Rectification)
  - Spec 004: Commercial Reconciliation (PaymentList $\rightarrow$ Import/Staging $\rightarrow$ Confrontation)
  - Spec 005: Essential Finance (FinanceSummary $\rightarrow$ Expenses $\rightarrow$ Distributions $\rightarrow$ Obligations $\rightarrow$ Settlement)

---

## 2. Human-Verifiable Homologation Scenarios

### 2.1. Workspace Access & Tenant Isolation
1. **Scenario**: Log in as an Owner/Admin in Workspace A.
   - *Expected*: Access granted only to Workspace A data.
2. **Scenario**: Attempt to access an entity belonging to Workspace B via URL direct navigation.
   - *Expected*: HTTP 404 or explicit access denied. No entity existence or details leaked.

### 2.2. Budget to Production Order (Spec 002)
1. **Scenario**: Create an operational Budget with vehicle details and service line items.
2. **Scenario**: Approve a Budget Revision and generate a Production Order (OP).
   - *Expected*: Monotonic OP code generated; composite database foreign keys guarantee budget lineage.
3. **Scenario**: Attempt to approve an obsolete (stale) budget revision.
   - *Expected*: HTTP 409 Conflict; system prevents revision divergence.

### 2.3. Production Order Finalization & WEEKLOG Lifecycle (Spec 003)
1. **Scenario**: Mark a Production Order as completed/finalized.
   - *Expected*: Production Order transitions to delivered status, automatically creating a linked WeeklogEntry in the corresponding weekly operational batch without duplication.
2. **Scenario**: Submit the WEEKLOG for client validation.
   - *Expected*: Generates an immutable Validation Round with frozen operational coverage snapshot.
3. **Scenario**: Request rework (Rectification) on a delivered entry.
   - *Expected*: Re-opens the entry for rework while strictly preserving historical validation rounds and self-referencing lineage.

### 2.4. Commercial Payment List & Confrontation (Spec 004)
1. **Scenario**: Import an external client payment list (document or spreadsheet).
   - *Expected*: Staged in database with raw currency totals and line-by-line item extraction.
2. **Scenario**: Execute commercial confrontation between the client list and internal WEEKLOG entries.
   - *Expected*: Deterministic matching engine detects:
     - Exact matches (Item accepted)
     - Divergences (Value differences flagged for manual decision)
     - Missing items (Contested items)
3. **Scenario**: Transition PaymentList from Pending to Paid.
   - *Expected*: Closes list; locks underlying claims against double-billing.

### 2.5. Essential Finance V2 Overview (Spec 005)
1. **Scenario**: Navigate to the `/financial` route as Workspace Owner.
   - *Expected*: Overview dashboard displays distinct cards grouped **per currency** (Expected, Received, Expenses, Settled Obligations, Available).
   - *Check*: No combined total across currencies (e.g. BRL + USD + EUR are never summed together).
   - *Check*: Legitimate negative Available balances are displayed in bold red without clamping to zero.

### 2.6. Expense Ledger & Reversal (Spec 005)
1. **Scenario**: Create an Expense with amount (e.g. `"150.00"`), currency, category, and date.
   - *Expected*: Expense appears in the ledger with active status; updates summary Available balance upon next fetch.
2. **Scenario**: Attempt to edit or delete an existing Expense.
   - *Expected*: Edit and Delete options do not exist. Only **Estornar (Reverse)** is available.
3. **Scenario**: Reverse the Expense providing an audit reason.
   - *Expected*: Expense status transitions to `REVERSED`; original amount remains visible in audit trail; cash effect is reversed.

### 2.7. Manual Distributions & Zero-Cash Semantics (Spec 005)
1. **Scenario**: Create a manual Distribution against a recognized PaymentList.
   - *Modes*: Fixed amount or Percentage mode.
   - *Targets*: Linked technician (Person), active Workspace, or Client.
   - *Expected*: Creates distribution with `resolvedAmount`. Display clearly identifies allocation/entitlement (not cash-out).
2. **Scenario**: Cancel an active Distribution before any obligation is settled.
   - *Expected*: Transitions to `CANCELLED` with audit reason.

### 2.8. Financial Obligations & Full Cash-Out Settlement (Spec 005)
1. **Scenario**: Create a Financial Obligation from an active Distribution.
   - *Expected*: Obligation created in `PENDING` status. Pending obligations have **zero effect** on Available cash.
2. **Scenario**: Execute **Liquidar (Settle)** on the pending obligation.
   - *Expected*: Full cash-out confirmation modal appears with exact amount. Settling executes an atomic `ObligationPayment` fact; Available cash updates; status becomes `PAID`.
3. **Scenario**: Reverse an effective settlement payment with an audit reason.
   - *Expected*: Obligation transitions to terminal `REVERSED` state. Cannot be re-settled or reopened.

### 2.9. Authorization & Technician Own View (Spec 005)
1. **Scenario**: Log in as a linked company technician.
   - *Expected*: Accessing `/financial` displays the dedicated view **"Meus Repasses & Pagamentos"**.
   - *Check*: Summary cards and company expense ledgers are **hidden** (no backend queries fired).
   - *Check*: Only the technician's own participant distributions and obligations are visible.
   - *Check*: Mutation buttons (Create Expense, Create Distribution, Settle) are hidden.
2. **Scenario**: Log in as a user with technician global role who is the **Owner of their personal workspace**.
   - *Expected*: Full owner Finance UI is displayed (personal workspace ownership preserved).
3. **Scenario**: Log in as a Client or Client Collaborator.
   - *Expected*: Access to internal Finance is explicitly denied.

---

## 3. Explicit Statement of Intentional Limitations

During homologation review, please note that the following items are **intentional Phase 1 architectural boundaries**:
- **Current-State Financial Projections**: FinanceSummary reflects current operational state and settled payments; it is not an accrual-based accounting ERP.
- **No Multi-Currency Grand Total or FX**: Each currency is handled independently to avoid currency risk or invalid summation.
- **No Partial Settlement / Installment Engine**: Obligations are settled in full per distribution.
- **Manual Distribution Only**: Automatic percentage calculation rules (`ProfitRule`) are deprecated.
- **Legacy Finance Data Is Archive Only**: Unclassified legacy financial records remain in read-only archive tables (`NO_SAFE_AUTOMATIC_MIGRATION`).
- **SaaS Subscription Billing Is Separate**: Managed independently via Stripe routes.

---

## 4. Client Sample Dependencies

To complete full homologation of edge cases with VECTIS data, the following client samples are requested:
1. **Representative Payment List Documents**: Real sample PDF / Excel payment lists from insurance or fleet clients for OCR / import testing.
2. **External WEEKLOG Sheets**: Sample weekly operational files used for staging and coverage validation.
3. **Known Divergence Cases**: Real-world examples of disputed labor or paint line items for commercial confrontation validation.

---

## 5. Release Notes — Phase 1 (Core)

### What Changed
- **Multi-Tenant Foundation**: Strict server-side `RequestContext` enforcement across all endpoints.
- **Mobile Operational Backbone**: Versioned budget approval, production tracking, and weekly log finalization.
- **Commercial Confrontation Engine**: Automated discrepancy detection between client lists and internal production.
- **Canonical Essential Finance V2**: Full multi-currency summary projections, expense ledger with reversals, manual distributions, and derived obligation settlements.
- **Role-Aware Finance UI**: Clear separation between workspace owners, personal workspace owners, linked technicians, and clients.

### What Was Retired
- Legacy `/api/financial-records` endpoints (return HTTP 410 Gone).
- Legacy reconciliation and automatic profit rule engines.
- Direct frontend Supabase data mutations.

---

## 6. Consolidated Non-Conformities Feedback Template

Please record any homologation findings using this structured format:

| Item # | Module / Screen | Scenario Executed | Expected Behavior | Actual Behavior Observed | Severity (Blocker / Minor / Cosmetic) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
