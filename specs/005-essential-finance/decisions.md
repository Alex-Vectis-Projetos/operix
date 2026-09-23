# Spec005 decisions

## Frozen

* DEC-001 — PaymentList is commercial revenue authority; legacy PaymentOrder is not.
* DEC-002 — Expected derives only from validated pending PaymentLists; unsigned/unrecognized work is excluded.
* DEC-003 — Received derives only from paid PaymentLists; no automatic financial-record side effect.
* DEC-004 — Distribution is manual by work/List; no automatic ProfitRule engine.
* DEC-005 — New canonical money uses Decimal and explicit ISO currency; no EUR default, FX, or cross-currency sum.
* DEC-006 — RequestContext.activeWorkspaceId is the tenant authority and IDs require object authorization.
* DEC-007 — Expenses, distributions, obligations and payments require immutable audit trail; no hard deletion after effectiveness.
* DEC-008 — Confrontation stays in Operation/List and Spec004 lifecycle is immutable.

## Human-confirmed final decisions

* DEC-009 — Available per currency is Received minus effective Expenses minus effective settled ObligationPayments. Pending obligations do not reserve/reduce cash; negative results are valid.
* DEC-010 — Obligation settlement is a distinct cash-out and must never be automatically inserted as an Expense.
* DEC-011 — Fase1 FinanceSummary is current-state only. Historical as-of reconstruction/charts are future scope; audit history remains preserved.
* DEC-012 — Outgoing obligation settlement is full only in Fase1 (`pending → paid`); installments, remaining balances and schedules are out of scope.
* DEC-013 — Effective financial facts are corrected through actor/time/reason/original-linked cancel or reversal, never destructive rewrite.
* DEC-014 — Finance aggregates are independent per ISO currency: no default EUR, FX engine or cross-currency total.
* DEC-015 — Finance visibility requires authenticated workspace capability plus object authorization: linked technician own-only, client denied internal finance, and participant identity alone grants no access.
