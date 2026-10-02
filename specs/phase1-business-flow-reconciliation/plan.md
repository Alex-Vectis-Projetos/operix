# Implementation Plan — Phase 1 Business Flow Reconciliation (R01D Frozen)

## 1. Architectural Strategy & Safety Constraints
- **Zero Destructive Migrations**: All schema adjustments use expand-contract with additive nullable fields and default values. No destructive `prisma db push`.
- **Atomic Claim Delivery (Requirement 8 / ADR-002)**: Automatic PaymentList creation will NOT be enabled until source-aware claim states (`provisional`, `reserved`, `consumed`, `released`) and partial unique indexes exist. Claim architecture lands atomically with auto-list creation in Phase R04.
- **Forward-Only Claim Migration**: Safely replace existing DB constraints (`payment_list_entry_claims_status_check`, `payment_list_entry_claims_lifecycle_check`) without duplicating constraint names. Preserve `unique_active_or_consumed_weeklog_entry_claim` and add `unique_provisional_weeklog_entry_claim`.
- **Canonical Invoicing Order & Frozen Finance Semantics**: Invoicing commands (`/invoice/create` & `/invoice/associate`) strictly transition lists from `ready_for_billing` / `confronted` to `pending`. `pending` sets Expected = Total, Received = 0. `paid` sets Expected = 0, Received = Total. Transition is FROM Expected TO Received; never count in both.
- **Post-Invoice Cancellation Ban**: In Phase 1, `pending` $\rightarrow$ `cancelled` is strictly removed. Cancellation is permitted only pre-invoice (`draft`, `ready_for_billing`, `under_review`, `confronted`), while claims remain releasable. Consumed claims are immutable.
- **Preserve Verified Green Baseline**: All already-passing reconciliation invariants and 65 unit regression tests remain permanently green.

---

## 2. Canonical Phased Roadmap (R00 – R07)

```text
R00: Baseline & Foundation Setup [COMPLETED]
  └── Clean git baseline cf0b8a55f4485f7b08e685a6b4ee29ecb6797b43

R01: Business Flow Reconciliation, Contract Hardening & RED Acceptance Suite [R01D - CURRENT]
  ├── Frozen contracts without open options (ADR-001 through ADR-007)
  ├── 46 acceptance criteria classified across 10 groups
  └── Integration suite demonstrating intentional REDs and preserved GREENs

R02: Spec 002 — Budget Client Authority, Rejection Refinement, Client Delegation & Production Timeline
  ├── Ban technician self-approval: 403 TECH_SELF_APPROVAL_FORBIDDEN (supersedes TECH-BUDGET-APPROVE-OWN)
  ├── ClientAccessGrant capability checks: budget.approve, weeklog.validate, payment_list.review, invoice.view, client.collaborators.manage
  ├── Client collaborator delegation: POST /api/clients/:clientId/collaborators, PATCH /:grantId, DELETE /:grantId
  ├── Enforce same-client boundary, no internal Finance escalation, delegator capability ceiling
  ├── Operational siteKey scope enforcement (403 SITE_SCOPE_UNAUTHORIZED)
  ├── Preserve direct ProductionOrder creation (DIRECT-PO-PRESERVED-01)
  └── Minimal chronological fact timeline strictly from persisted facts: GET /api/production-orders/:id/timeline (no fabricated pause/resume events)

R03: Spec 003 — Week Boundary Auto-Closure & Startup Catch-Up Engine
  ├── reconcileExpiredWeeklogs domain service & cron runner
  ├── Startup catch-up hook (runStartupCatchup) in backend boot sequence
  ├── Concise operational projection: GET /api/weeklogs/:id/projection
  └── Verification of external WEEKLOG commit triggering validated status on canonical /api/external-operational-imports

R04: Spec 004 / ADR-002 — Source-Aware Provisional Claims, Multiweek Absorption, Manual List Coexistence & Auto-Draft PaymentList Handoff
  ├── PaymentList schema additions:
  │     sourceType (weeklog_auto, external_import, manual)
  │     originWeeklogId nullable UUID referencing Weeklog
  │     supersededByPaymentListId nullable UUID referencing PaymentList
  │     status values: draft, under_review, confronted, pending, paid, cancelled, ready_for_billing, superseded
  │     Partial unique index: unique_active_auto_payment_list_origin_weeklog
  ├── Forward-only claim constraints migration:
  │     payment_list_entry_claims_status_check (provisional, reserved, consumed, released)
  │     payment_list_entry_claims_lifecycle_check (provisional: consumed_at null, released_at null)
  │     unique_provisional_weeklog_entry_claim partial index
  ├── Atomic trigger in weeklog validation creating draft PaymentList with provisional claims
  ├── Multiweek external confrontation absorption of provisional claims (LIST-EXTERNAL-AUTO-ABSORB-01)
  ├── Coexistence of manual list: absorbs provisional auto-draft claims without 409 collision (LIST-MANUAL-AUTO-COEXIST-01)
  ├── Authorized billing operator review transition to ready_for_billing (cancellation permitted strictly pre-invoice)
  └── Active weeklog queue filter (omit validated weeklogs by default; includeTransferred=true)

R05: Spec 005 / ADR-004 — Explicit Invoice Commands & Direct Internal Billing
  ├── POST /api/payment-lists/:id/invoice/create
  ├── POST /api/payment-lists/:id/invoice/associate
  ├── Strict state transition to pending upon invoice command
  ├── Claim consumption to immutable status 'consumed'
  └── Finance revenue transition: pending (Expected = Total, Received = 0) -> paid (Expected = 0, Received = Total)

R06: Importer UX Preservation & Contractual UI Release Gates
  ├── Verify document preview controls (rotation, zoom, editable rows) in PaymentListImportDialog
  ├── Batch row updates via existing PATCH /api/external-operational-imports/:id/rows
  ├── Operix brand hygiene: purge residual "Nexus" and "WorkNexus" strings (UI-BRAND-OPERIX-01)
  └── Static contracts verified; preparation for browser runtime verification

R07: End-to-End Homologation, Browser Recording & Staging Sign-Off
  ├── All 46 acceptance tests green
  ├── Browser subagent execution with WebP session recording
  └── Final handoff documentation and human sign-off
```
