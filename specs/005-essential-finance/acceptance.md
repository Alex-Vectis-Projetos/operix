# Normative acceptance contract — 33 scenarios

Each ID is one deterministic Given/When/Then scenario. This is the frozen Fase1 denominator.

1. **FIN-EXPECTED-PENDING-01** — Given a confronted pending PaymentList with recognizedTotal 100 EUR, when its summary is read, then Expected EUR is 100.
2. **FIN-EXPECTED-EXCLUDE-NONPENDING-01** — Given draft, under-review, confronted, paid and cancelled Lists, when Expected is read, then none contributes.
3. **FIN-RECEIVED-PAID-01** — Given a paid PaymentList with recognizedTotal 100 EUR, when summary is read, then Received EUR is 100 and its effective receipt is `paidAt`.
4. **FIN-RECEIVED-EXCLUDE-UNPAID-01** — Given Lists not paid, when Received is read, then none contributes.
5. **FIN-NO-DOUBLE-REVENUE-01** — Given one PaymentList and legacy projections, when summary is read repeatedly, then it contributes once from PaymentList only.
6. **FIN-AVAILABLE-01** — Given Received 5,000 EUR, effective Expenses 3,000 EUR and a pending 2,000 EUR obligation, when summary is read, then Available is 2,000 EUR; when that obligation settles once, then Available is 0; a retry keeps it 0 and creates no Expense.
7. **FIN-AVAILABLE-NEGATIVE-01** — Given effective outflows exceed Received in one currency, when summary is read, then Available is a negative Decimal value.
8. **FIN-CURRENCY-SEPARATION-01** — Given EUR and GBP facts, when summary is read, then each currency has independent Expected, Received, Expenses and Available, with no FX or combined total.
9. **EXPENSE-CREATE-01** — Given an authorized owner/admin, when an explicit-currency Decimal effective Expense is created, then it is tenant-scoped and affects only its currency summary.
10. **EXPENSE-DECIMAL-01** — Given a fractional Decimal Expense, when stored and summarized, then its exact Decimal representation is retained without Float arithmetic.
11. **EXPENSE-LINKAGE-01** — Given a justified PaymentList, operation, technician, client or document link, when an Expense is created, then the approved relational link is preserved and foreign scope is rejected.
12. **EXPENSE-AUDIT-01** — Given an effective Expense recorded in error, when corrected, then it is cancelled/reversed with actor/time/reason/original linkage and cannot disappear through hard delete.
13. **EXPENSE-TENANT-01** — Given an expense command against another workspace, when submitted, then no foreign expense is read or changed.
14. **EXPENSE-IDOR-01** — Given a guessed foreign Expense ID, when detail, correction or cancellation is requested, then access is denied without mutation.
15. **DIST-MANUAL-01** — Given authorized List/work context, when an actor enters an allocation, then the Distribution is created only from that manual command.
16. **DIST-NO-AUTO-RULE-01** — Given legacy ProfitRules exist, when a Distribution is created, then no saved rule auto-executes or creates canonical money.
17. **DIST-PARTICIPANT-01** — Given a technician, company, shareholder/partner or client participant is validly related, when allocated, then canonical identity—not a free-form recipient—is recorded.
18. **DIST-AUDIT-01** — Given a manual Distribution is changed after effectiveness, when corrected, then audit/reversal rules preserve its origin and actor.
19. **DIST-TENANT-01** — Given a foreign List, work or participant, when distribution is attempted, then no allocation is created.
20. **OBLIGATION-CREATE-01** — Given an authorized manual Distribution, when a pending FinancialObligation is created, then it records payable entitlement but Available does not change.
21. **OBLIGATION-NO-FIXED-CADENCE-01** — Given an obligation, when it is created, then no recurring date, installment plan or mandatory cadence is required.
22. **OBLIGATION-PAY-01** — Given a pending obligation, when one full settlement succeeds, then one effective settlement is recorded atomically, obligation becomes paid, paidAt/paidBy are set, and Available decreases once.
23. **OBLIGATION-PAY-IDEMPOTENT-01** — Given the same settlement idempotency key is retried, when the command repeats, then no second settlement/cash effect occurs.
24. **OBLIGATION-TENANT-01** — Given a foreign obligation, when payment, cancellation or reversal is attempted, then object authorization denies it and state is unchanged.
25. **OBLIGATION-AUDIT-01** — Given an effective settlement is corrected, when reversed, then origin, actor, time, reason and reversal linkage remain traceable and the cash effect is restored once.
26. **FIN-TECH-OWN-01** — Given a linked technician, when finance is read, then only their participant-linked distribution/obligation/payment status is returned; workspace Expected, Received, Expenses, Available, margin, other balances are absent.
27. **FIN-CLIENT-INTERNAL-DENY-01** — Given a client/collaborator with valid WEEKLOG validation grant, when internal finance is requested, then access is denied.
28. **FIN-OWNER-SUMMARY-01** — Given owner/admin RequestContext for a workspace, when summary is requested, then authorized per-currency workspace totals are returned.
29. **FIN-CROSS-TENANT-01** — Given users in two workspaces, when each invokes finance operations, then no row or aggregate crosses the active workspace boundary.
30. **FIN-WORKSPACE-SPOOF-01** — Given a body/query `workspaceId` different from RequestContext, when a finance command runs, then RequestContext scope prevails.
31. **FIN-NO-FLOAT-01** — Given a canonical finance value, when persisted, returned and summarized, then Decimal-safe semantics—not Prisma Float or JavaScript Number arithmetic—are used.
32. **FIN-NO-LEGACY-AUTHORITY-01** — Given FinancialRecord, PaymentOrder, ProfitRule or legacy Reconciliation data, when canonical finance is read or mutated, then none is revenue/cash authority.
33. **FIN-NO-SPEC004-MUTATION-01** — Given any Spec005 operation, when it completes, then PaymentList confrontation, claims, rectification and lifecycle commercial truth remain unchanged.

## Non-normative hardening

Later tests cover concurrent duplicate settlement, payment/reversal race, expense retry, distribution concurrency, cross-tenant race, pending-to-paid during summary read, concurrent settlement/summary, currency isolation and reversal exactly once. T00.5 creates no tests.
