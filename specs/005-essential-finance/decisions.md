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

## Open business decisions

* OPEN-001 — **BUSINESS DECISION REQUIRED:** AVAILABLE_SETTLEMENT_SEMANTICS. Does obligation creation reserve Available; does paid settlement reduce it; and is it an Expense or distinct cash-out? Blocks formula/schema acceptance.
* OPEN-002 — **BUSINESS DECISION REQUIRED:** historical current-only versus period/as-of reporting. Blocks projection/timestamp design.
* OPEN-003 — partial outgoing settlement: no evidence requires it; default target is pending→paid only unless confirmed.
* OPEN-004 — correction semantics: cancel/reverse versus edit for effective expense/payment.
* OPEN-005 — whether same workspace financial view mixes currencies and whether per-currency/no-FX is sufficient.
* OPEN-006 — direct own-balance access for partner/shareholder/client versus owner/admin only.
