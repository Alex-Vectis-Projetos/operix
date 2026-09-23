# Essential Finance conceptual contract

## Domain and states

`FinanceSummary(currency)` derives Expected/Received from PaymentList and Available from received minus paid Expenses, subject to OPEN-001. `Expense` is a Decimal cash cost with explicit currency, category (small controlled list or free label to be selected from evidence), effective date, creator and optional justified contextual link (PaymentList, ProductionOrder, technician/person, client, document). `Distribution` records a manual List/work allocation to a canonical participant (person/workspace/client relationship, never free-form recipient) in fixed amount or percentage. `FinancialObligation` records a payable allocation; state is `pending|paid|cancelled|reversed`. Optional immutable `ObligationPayment` is only introduced if settlement history/partials are confirmed.

## Contract traceability

| Requirement | Source/confidence | Decision/target | Acceptance/task | Status |
|---|---|---|---|---|
| Manual distribution | meeting delta D15, confirmed | DEC-004/Distribution | DIST-* / T07 | frozen |
| Expected pending / Received paid | meeting delta D16–17, confirmed; ADR-004 | DEC-002/003 summary | FIN-EXPECTED/RECEIVED / T05 | frozen |
| Expenses, Available, negative | PROJECT/DOMAIN and D18–19, confirmed | Expense + derived summary | FIN-AVAILABLE/EXPENSE-* / T05–06 | Available settlement open |
| Obligations without cadence | management-frozen fact | FinancialObligation | OBLIGATION-* / T08 | partial/reversal open |
| Technician own visibility | DOMAIN/D02, confirmed | scoped own projection | FIN-TECH-OWN / T02,T10 | participant details open |
| Workspace authority | Spec001 foundation | RequestContext | FIN-CROSS-TENANT / T02 | frozen |
| No accounting ERP | contract management fact | focused domain | scope gates / all | frozen |

## API direction and errors

Scoped `/finance/v2` commands: summary; expenses create/list/detail/cancel; distributions create/list/cancel; obligations create/list/detail/cancel; obligation payment/settlement. DTO money is decimal string plus `currencyCode`; server returns decimal strings. Commands accept validated domain fields and optional idempotency key, never audit actor or workspace authority fields. Return 401/403/404 without existence leakage, 409 on duplicate idempotency/state transition, and 422 on currency/state/invariant errors.

## Authorization

Owner/admin: workspace summary and mutations. Linked technician: own production-linked distribution/obligation only when OPEN-006 confirms; never company totals. Independent technician/own workspace owner: own workspace scope. Client/client collaborator: no internal finance through validation grants. Partner/shareholder requires explicit membership/participant grant, not participant name. Every list/detail/mutation uses RequestContext then ownership predicate.

## Audit, concurrency and currency

Use append-only audit event/actor/time/reversal linkage; cancellation reverses rather than erases effective money. Idempotency protects expense create, distribution command, payment/settlement and reversal. Later PostgreSQL tests cover duplicate payment, concurrent commands, cross-tenant races and status-transition summary consistency. No FX conversion; report independent totals per ISO currency.
