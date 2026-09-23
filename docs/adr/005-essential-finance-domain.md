# ADR-005 — Essential Finance domain

## Context and authority

Business authority is, in order: signed Fase 1 contract/annexes and accepted proposal (externally reviewed by management); latest confirmed VECTIS decisions; `meeting-2-delta.md`; `PROJECT.md`/`DOMAIN.md`; frozen Specs 001–004; code only for technical facts. The commercial instruments are not versioned here. This ADR does not expand Fase 1 into an accounting ERP.

## Decision — FROZEN

**Option B is selected:** derive Expected/Received from PaymentList and add a focused canonical Expense/Distribution/Obligation domain.

Adopt a focused canonical finance domain. `PaymentList`/`PaymentListItem` remain the sole commercial authority. Expected is derived from validated `PaymentList.status=pending`; Received from `status=paid`, using the final recognized List value and its lifecycle timestamps. Spec005 must never recalculate confrontation, claims, WEEKLOG, rectification, `recognizedTotal`, or reverse-write commercial status.

Persist only new reality: tenant-explicit Decimal `Expense`, manual `Distribution`, `FinancialObligation`, and, if payment history is required, immutable `ObligationPayment`. All authorization derives from `RequestContext.activeWorkspaceId`; body/query workspace IDs are never authority. Amounts carry explicit ISO currency, have no EUR default, and summary calculations are per currency with no FX conversion.

Available is derived, never independently mutable, per currency: Received minus effective paid Expenses minus effective settled ObligationPayments. Pending FinancialObligations and unsettled Distributions have no cash effect. Settlement is a distinct cash-out—not an Expense—and is counted once. Negative values are valid.

## Legacy transition

`FinancialRecord`, `FinancialEvent`, `FinancialIntegrity*`, `ProfitRule`, `ServiceOrderDistribution`, and the active legacy finance routes are archive/deprecate candidates, not canonical inputs. Their nullable workspace ownership, Float money, loose scalar references, global aggregations and destructive mutations prevent adoption. `Reconciliation` stays retired as commercial authority; canonical confrontation is `/payment-lists`. Compatibility, if justified later, is one-way canonical-to-legacy only. Migration is forward-only, Decimal-safe, tenant-explicit, dry-run/idempotent/audited; ambiguous, orphaned or global rows are skipped and reported.

## Consequences

This minimizes duplicate truth and preserves auditability. Fase1 supplies a current-state summary only; historical/as-of reporting is a future enhancement. PaymentList lifecycle records remain auditable, but no expected-revenue ledger is introduced merely for time-travel reporting. Full settlement only is in scope; partial installments/schedules are not.

## Rejected alternatives

* Harden generic `FinancialRecord`: unsafe legacy semantics and migration burden.
* Persist a full ledger for every commercial event: duplicate PaymentList truth and ERP complexity.
* Automatic `ProfitRule`: contradicts confirmed manual distribution.
