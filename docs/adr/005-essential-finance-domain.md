# ADR-005 — Essential Finance domain

## Context and authority

Business authority is, in order: signed Fase 1 contract/annexes and accepted proposal (externally reviewed by management); latest confirmed VECTIS decisions; `meeting-2-delta.md`; `PROJECT.md`/`DOMAIN.md`; frozen Specs 001–004; code only for technical facts. The commercial instruments are not versioned here. This ADR does not expand Fase 1 into an accounting ERP.

## Decision

Adopt a focused canonical finance domain. `PaymentList`/`PaymentListItem` remain the sole commercial authority. Expected is derived from validated `PaymentList.status=pending`; Received from `status=paid`, using the final recognized List value and its lifecycle timestamps. Spec005 must never recalculate confrontation, claims, WEEKLOG, rectification, `recognizedTotal`, or reverse-write commercial status.

Persist only new reality: tenant-explicit Decimal `Expense`, manual `Distribution`, `FinancialObligation`, and, if payment history is required, immutable `ObligationPayment`. All authorization derives from `RequestContext.activeWorkspaceId`; body/query workspace IDs are never authority. Amounts carry explicit ISO currency, have no EUR default, and summary calculations are per currency with no FX conversion.

Available is derived, never independently mutable. Baseline is Received minus paid linked Expenses. Whether settlement also reduces Available, and whether it is an Expense, remains OPEN-001; implementation of that formula is blocked to prevent double subtraction. Negative values are valid.

## Legacy transition

`FinancialRecord`, `FinancialEvent`, `FinancialIntegrity*`, `ProfitRule`, `ServiceOrderDistribution`, and the active legacy finance routes are archive/deprecate candidates, not canonical inputs. Their nullable workspace ownership, Float money, loose scalar references, global aggregations and destructive mutations prevent adoption. `Reconciliation` stays retired as commercial authority; canonical confrontation is `/payment-lists`. Compatibility, if justified later, is one-way canonical-to-legacy only. Migration is forward-only, Decimal-safe, tenant-explicit, dry-run/idempotent/audited; ambiguous, orphaned or global rows are skipped and reported.

## Consequences

This minimizes duplicate truth and preserves auditability. Historical period/as-of reporting is OPEN-002: current status alone cannot reconstruct past Expected after payment; do not add charts until the required immutable lifecycle timestamps/event projection are frozen.

## Rejected alternatives

* Harden generic `FinancialRecord`: unsafe legacy semantics and migration burden.
* Persist a full ledger for every commercial event: duplicate PaymentList truth and ERP complexity.
* Automatic `ProfitRule`: contradicts confirmed manual distribution.
