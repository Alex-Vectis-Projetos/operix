# Implementation Plan — Phase 1 Business Flow Reconciliation (R01B Frozen)

## 1. Architectural Strategy & Safety Constraints
- **Zero Destructive Migrations**: All schema adjustments use expand-contract with additive nullable fields and default values.
- **Atomic Claim Delivery (Requirement 8)**: Automatic PaymentList creation will NOT be enabled until source-aware claim states (`provisional_auto`, `locked_internal`, `locked_external`) are persisted. Claim architecture lands atomically with auto-list creation in Phase R04.
- **Preserve Verified Green Baseline**: All 10 already-passing reconciliation invariants (including `WEEK-BOUNDARY-ROLLFORWARD-01` and Finance boundaries) and 65 unit regression tests remain permanently green.

---

## 2. Phased Roadmap (R02 – R07)

```text
R02: Week Boundary & Production History
  ├── reconcileExpiredWeeklogs domain service & cron runner
  ├── Startup catch-up hook (runStartupCatchup)
  └── GET /api/production-orders/:id/timeline

R03: Budget Client Authority & Client Governance Scope
  ├── Ban technician self-approval (supersede TECH-BUDGET-APPROVE-OWN)
  ├── Enforce ClientAccessGrant capability checks (budget.approve)
  ├── Cross-client validation & optional siteKey/locationId scope
  └── Mandatory re-approval for modified budget revisions

R04: Source-Aware Claim Architecture & Automatic Draft List Handoff (Atomic)
  ├── Schema: PaymentList.sourceType, originWeeklogId, supersededByPaymentListId
  ├── Schema: PaymentListEntryClaim.claimState (provisional_auto, locked_external, etc.)
  ├── Atomic trigger in validateWeeklogBatch creating draft PaymentList
  ├── ADR-002: Multiweek external confrontation absorption of provisional claims
  ├── Direct internal billing approval transition (ready_for_billing)
  └── Active weeklog queue filter (?status=validated exclusion)

R05: External WEEKLOG Intake & Importer UX Contract
  ├── POST /api/weeklogs/external-import/upload & staging table
  ├── Commit to status 'validated' without fake ProductionOrders
  ├── Identical auto-draft commercial handoff trigger
  └── Importer UI controls (rotation, zoom, bulk downward apply)

R06: Concise Operational Projections (WEEKLOG + PaymentList)
  ├── GET /api/weeklogs/:id/projection (vehicle, delivery date, site, services, amount)
  ├── PaymentList projection formatting (VECTIS semantic mapping)
  └── Frontend table optimization removing panel-level trivia

R07: Explicit Invoice Handoff & Contractual UI Release Gates
  ├── POST /api/payment-lists/:id/invoice/create
  ├── POST /api/payment-lists/:id/invoice/associate
  ├── Light mode contrast verification (WCAG 2.1 AA)
  ├── Mobile (<= 430px) and Tablet (768px - 1024px) responsive certification
  ├── Operix brand hygiene (purge residual "Nexus" occurrences)
  └── Hide generic automation engine from active navigation
```
