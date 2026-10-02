# Implementation Plan — Phase 1 Business Flow Reconciliation (R01C Frozen)

## 1. Architectural Strategy & Safety Constraints
- **Zero Destructive Migrations**: All schema adjustments use expand-contract with additive nullable fields and default values. No destructive `prisma db push`.
- **Atomic Claim Delivery (Requirement 8 / ADR-002)**: Automatic PaymentList creation will NOT be enabled until source-aware claim states (`provisional`, `reserved`, `consumed`, `released`) and partial unique indexes exist. Claim architecture lands atomically with auto-list creation in Phase R04.
- **Canonical Invoicing Order**: Invoicing commands (`/invoice/create` & `/invoice/associate`) strictly transition lists from `ready_for_billing` / `confronted` to `pending`. Finance `Expected` begins strictly at `pending`.
- **Preserve Verified Green Baseline**: All 18 already-passing reconciliation invariants (including `WEEK-BOUNDARY-ROLLFORWARD-01`, manual lists, and Finance boundaries) and 65 unit regression tests remain permanently green.

---

## 2. Canonical Phased Roadmap (R00 – R07)

```text
R00: Baseline & Foundation Setup [COMPLETED]
  └── Clean git baseline cf0b8a55f4485f7b08e685a6b4ee29ecb6797b43

R01: Business Flow Reconciliation, Contract Hardening & RED Acceptance Suite [R01C - CURRENT]
  ├── Frozen contracts without open options (ADR-001 through ADR-007)
  ├── 41 acceptance criteria classified across 10 groups
  └── Integration suite demonstrating intentional REDs and preserved GREENs

R02: Spec 002 — Budget Client Authority, Rejection Refinement, Client Delegation & Production Timeline
  ├── Ban technician self-approval: 403 TECH_SELF_APPROVAL_FORBIDDEN (supersedes TECH-BUDGET-APPROVE-OWN)
  ├── ClientAccessGrant capability checks: budget.approve, weeklog.validate, payment_list.review, invoice.view
  ├── Cross-client isolation & optional operational siteKey scope (SITE_SCOPE_UNAUTHORIZED)
  ├── Client representative collaborator delegation endpoint: POST /api/clients/:clientId/collaborators
  ├── Preserve direct ProductionOrder creation (DIRECT-PO-PRESERVED-01)
  └── Minimal chronological fact timeline: GET /api/production-orders/:id/timeline

R03: Spec 003 — Week Boundary Auto-Closure & Startup Catch-Up Engine
  ├── reconcileExpiredWeeklogs domain service & cron runner
  ├── Startup catch-up hook (runStartupCatchup) in backend boot sequence
  ├── Concise operational projection: GET /api/weeklogs/:id/projection
  └── Verification of external WEEKLOG commit triggering validated status on canonical /api/external-operational-imports

R04: Spec 004 / ADR-002 — Source-Aware Provisional Claims, Multiweek Absorption, Manual List Coexistence & Auto-Draft PaymentList Handoff
  ├── Claim status: provisional, reserved, consumed, released + partial unique index
  ├── Atomic trigger in weeklog validation creating draft PaymentList with provisional claims
  ├── Multiweek external confrontation absorption of provisional claims
  ├── Coexistence of manual list: absorbs provisional auto-draft claims without 409 collision (LIST-MANUAL-AUTO-COEXIST-01)
  ├── Authorized billing operator review transition to ready_for_billing
  └── Active weeklog queue filter (omit validated weeklogs by default; includeTransferred=true)

R05: Spec 005 / ADR-004 — Explicit Invoice Commands & Direct Internal Billing
  ├── POST /api/payment-lists/:id/invoice/create
  ├── POST /api/payment-lists/:id/invoice/associate
  ├── Strict state transition to pending upon invoice command
  └── Claim consumption to immutable status 'consumed'

R06: Importer UX Preservation & Contractual UI Release Gates
  ├── Reconnect document preview controls (rotation, zoom, editable grid, bulk downward apply)
  ├── Operix brand hygiene: purge residual "Nexus" and "WorkNexus" strings (UI-BRAND-OPERIX-01)
  └── Static contracts verified; preparation for browser runtime verification

R07: End-to-End Homologation, Browser Recording & Staging Sign-Off
  ├── All 41 acceptance tests green
  ├── Browser subagent execution with WebP session recording
  └── Final handoff documentation and human sign-off
```
