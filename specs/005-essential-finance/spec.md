# Essential Finance conceptual contract

## Domain and states

`FinanceSummary(currency)` derives Expected/Received from PaymentList and Available as `Received - effective Expenses - effective settled ObligationPayments`. It is current-state only. `Expense` is a Decimal cash/cost outflow with explicit currency, category, effective date, creator and optional justified contextual link. `Distribution` is a manual List/work allocation or entitlement to a canonical participant; it is not an obligation and does not move cash. `FinancialObligation` is an amount payable, with `pending|paid|cancelled|reversed` lifecycle; creation does not affect Available. Immutable `ObligationPayment` preserves one full settlement, retry idempotency and reversal linkage; it is not an installment engine and is not an Expense.

## Contract traceability

| Requirement | Source/confidence | Decision/target | Acceptance/task | Status |
|---|---|---|---|---|
| Manual distribution | meeting delta D15, confirmed | DEC-004/Distribution | DIST-* / T07 | frozen |
| Expected pending / Received paid | meeting delta D16–17, confirmed; ADR-004 | DEC-002/003 summary | FIN-EXPECTED/RECEIVED / T05 | frozen |
| Expenses, Available, negative | PROJECT/DOMAIN, D18–19 and DEC-009/010, confirmed | Expense + derived summary | FIN-AVAILABLE/EXPENSE-* / T05–06 | frozen |
| Obligations without cadence | management fact + DEC-012/013 | FinancialObligation/ObligationPayment | OBLIGATION-* / T08 | frozen |
| Technician own visibility | DOMAIN/D02 + DEC-015 | scoped own projection | FIN-TECH-OWN / T02,T10 | frozen |
| Workspace authority | Spec001 foundation | RequestContext | FIN-CROSS-TENANT / T02 | frozen |
| No accounting ERP | contract management fact | focused domain | scope gates / all | frozen |

## API direction and errors

Scoped `/finance/v2` commands: summary; expenses create/list/detail/cancel; distributions create/list/cancel; obligations create/list/detail/cancel; obligation payment/settlement. DTO money is decimal string plus `currencyCode`; server returns decimal strings. Commands accept validated domain fields and optional idempotency key, never audit actor or workspace authority fields. Return 401/403/404 without existence leakage, 409 on duplicate idempotency/state transition, and 422 on currency/state/invariant errors.

## Authorization

Owner/admin: workspace summary and authorized mutations. Linked technician: own participant-linked distribution, obligation and payment status only—never company Expected, Received, Expenses, Available, margin or other participants. Independent technician/personal workspace owner acts through actual membership/ownership. Client/client collaborator: no internal finance through validation grants. Partner/shareholder requires explicit authenticated membership/capability plus object authorization; participant name alone is insufficient. Every list/detail/mutation uses RequestContext then ownership predicate.

## Audit, concurrency and currency

Before effectiveness, exposed draft data may be corrected. Effective money is never hard-deleted or silently rewritten: cancellation/reversal carries actor, timestamp, reason and original linkage. Idempotency protects expense create, distribution command, payment/settlement and reversal. Later PostgreSQL tests cover duplicate payment, concurrent commands, cross-tenant races and status-transition summary consistency. No FX conversion; report independent totals per ISO currency.

## DEC-016 concrete HTTP contract

Base path is `/api/finance/v2`. Every command is RequestContext-scoped: no endpoint accepts `workspaceId`, `workspace_id`, `createdBy`, `paidBy`, or `actorUserId` as authority. Money and percentage transport are base-10 decimal strings; currency is explicit uppercase ISO-4217. Monetary output is normalized to two decimals. Reject numeric JSON money, locale strings, scientific notation, NaN and Infinity with `422`.

GET success is `200`; first creation `201`; successful action/state transition `200`. Creation/settlement/reversal commands require `Idempotency-Key`. Same key, workspace, actor/action namespace and request fingerprint returns the original materialization with `200` and `idempotent:true`; a different payload with that key returns `409 IDEMPOTENCY_KEY_REUSED`. First materialization has `idempotent:false`.

Errors use `{ "error": { "code": "STABLE_MACHINE_CODE", "message": "…" } }`, with non-leaking validation details only. `400` is malformed transport; `401` authentication; `403` capability denial without object disclosure; `404` missing/foreign object; `409` state/concurrency/semantic conflict; `422` valid transport violating domain invariants.

### DTO tables

| DTO / field | Type | Required / nullable | Source | Client-writable | Meaning |
|---|---|---|---|---|---|
| FinanceSummaryCurrencyDTO.currencyCode | ISO string | required | derived | no | bucket identity |
| expected, received, expenses, settledObligationPayments, available | decimal string | required | derived | no | per-currency totals |
| ExpenseDTO.id/status/createdAt/createdByUserId | string/status/UTC | required | server | no | audit identity (`effective|reversed`) |
| ExpenseDTO.amount/currencyCode/category/occurredOn | decimal/ISO/string/date | required | command | yes at create | effective cost facts |
| ExpenseDTO.description/context | string/tagged union | optional | command | yes at create | one justified link |
| ExpenseContextDTO.kind/id | payment_list\|production_order\|technician_person\|client\|document / id | context optional | command + scoped resolve | yes | one same-tenant reference |
| DistributionDTO paymentListId/paymentListItemId | id/id nullable | required/optional | command | yes | recognized commercial anchor |
| DistributionDTO participant/allocation/resolvedAmount/currencyCode/status | DTO/DTO/decimal/ISO/status | required | mixed | participant/allocation only | manual entitlement (`active|cancelled`) |
| ParticipantDTO | `{kind: person,personId}` \| `{kind:workspace,workspaceId}` \| `{kind:client,clientId}` | required | command + scoped resolve | yes | economic, never access identity |
| AllocationDTO | `{mode:fixed,amount}` \| `{mode:percentage,percentage}` | required | command | yes | exactly one form; percentage >0 and <=100 |
| FinancialObligationDTO | id, distributionId, participant, amount, currencyCode, status, createdAt, createdByUserId, paidAt?, paidByUserId? | required fields / paid nullable | server | no | payable (`pending|paid|cancelled|reversed`) |
| ObligationPaymentDTO | id, obligationId, amount, currencyCode, status, paidAt, paidByUserId | required | server | no | immutable full settlement (`effective|reversed`) |
| ReversalDTO | id, paymentId, reason, reversedAt, reversedByUserId | required | server | reason only | reversal evidence |
| ApiErrorDTO.error.code/message/details? | string/string/object | details optional | server | no | stable error envelope |

Dates: `occurredOn` is `YYYY-MM-DD`; server returns `createdAt`, `paidAt`, `reversedAt` as ISO-8601 UTC. No client audit timestamps. Lists use `{items:[…]}`; no pagination is required in Fase1.

### Endpoint matrix

| Method / path | Authority | Request | Success | Principal errors | Acceptance / task |
|---|---|---|---|---|---|
| GET `/summary` | owner/admin; personal owner | none | `200 {currencies}` sorted by currency | 403 technician/client | FIN-EXPECTED*, FIN-RECEIVED*, FIN-AVAILABLE*, FIN-CURRENCY*, FIN-OWNER / T05 |
| POST `/expenses` | owner/admin | amount, currencyCode, category, occurredOn; description/context optional; idempotency | 201/200 ExpenseDTO | 404 foreign context; 422 invariant | EXPENSE-CREATE/DECIMAL/LINKAGE/TENANT / T06 |
| GET `/expenses`, `/:expenseId` | owner/admin | none | 200 `{items}` / ExpenseDTO | 403 actor; 404 foreign | EXPENSE-IDOR/TENANT / T06 |
| POST `/expenses/:expenseId/reverse` | owner/admin | reason + idempotency | 200 reversed ExpenseDTO | 404 foreign; 409 state | EXPENSE-AUDIT / T06 |
| POST `/distributions` | owner/admin | List/item, ParticipantDTO, AllocationDTO + idempotency | 201/200 DistributionDTO | 404 foreign; 422 mismatch | DIST-MANUAL/NO-AUTO-RULE/PARTICIPANT/TENANT / T07 |
| GET `/distributions`, `/:id` | owner/admin workspace; linked tech own-only | none | 200 `{items}` / DTO | 403 client; 404 foreign/non-own | DIST-AUDIT/TENANT, FIN-TECH-OWN / T07,T10 |
| POST `/distributions/:id/cancel` | owner/admin | reason + idempotency | 200 cancelled DTO | 404 foreign; 409 `DISTRIBUTION_NOT_CANCELLABLE` | DIST-AUDIT / T07 |
| POST `/obligations` | owner/admin | distributionId + idempotency | 201/200 obligation | 404 foreign; 409 `OBLIGATION_ALREADY_EXISTS` | OBLIGATION-CREATE/NO-FIXED-CADENCE / T08 |
| GET `/obligations`, `/:id` | owner/admin; linked tech own-only | none | 200 `{items}` / DTO | 403 client; 404 foreign/non-own | OBLIGATION-TENANT, FIN-TECH-OWN / T08,T10 |
| POST `/obligations/:id/cancel` | owner/admin | reason + idempotency | 200 cancelled | 409 `OBLIGATION_ALREADY_SETTLED` | OBLIGATION-AUDIT / T08 |
| POST `/obligations/:id/settle` | owner/admin | `{}` + idempotency | 200 obligation + payment | 404 foreign; 409 already settled | OBLIGATION-PAY/IDEMPOTENT, FIN-AVAILABLE / T08 |
| POST `/obligations/:id/settlements/:paymentId/reverse` | owner/admin | reason + idempotency | 200 obligation/payment/reversal | 404 foreign/mismatch; 409 state | OBLIGATION-AUDIT, FIN-AVAILABLE / T08 |

Distribution item linkage must belong to supplied List; foreign links return `404`, same-workspace item/List mismatch returns `422 DISTRIBUTION_ITEM_LIST_MISMATCH`. Workspace ParticipantDTO is allowed only when it equals the active workspace; it is economic identity, never tenant selection. Obligation creation derives amount/currency/participant from Distribution and permits exactly one active obligation per Distribution. Settlement is full-only, atomically creates one immutable payment, changes `pending→paid`, derives payer, and has no Expense side effect. Reversal changes payment and obligation to `reversed`, restores cash once, and does not reopen the obligation.
