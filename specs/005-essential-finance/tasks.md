# Task breakdown

| Task | Objective / likely files | Acceptance / gates / done |
|---|---|---|
| T01/T02 | RED acceptance and request-context helpers; `tests/**`, finance routes | FIN-*, EXPENSE-TENANT/IDOR, cross-tenant; no implementation until decisions approved |
| T03/T04 | Decimal models/migration/repository; Prisma schema/migration/services | FIN-NO-FLOAT, currency, audit; forward-only dry-run and tenant-explicit migration |
| T05 | summary service from PaymentList; routes/hooks | Expected/Received/no-double-revenue; Spec004 regression guard |
| T06 | expense domain | EXPENSE-CREATE/DECIMAL/LINKAGE/AUDIT; idempotent, scoped, reversal policy approved |
| T07 | manual distributions | DIST-MANUAL/NO-AUTO-RULE/PARTICIPANT; canonical identity and audit |
| T08 | obligations/settlements | OBLIGATION-*; state locking/idempotency and OPEN-001/003/004 approved |
| T09 | legacy retirement/migration | FIN-NO-LEGACY-AUTHORITY; report ambiguous rows, no reverse sync |
| T10/T11 | typed client/UI | authorization visibility, currency separation; no unsafe legacy API reuse |
| T12 | regression/security/handoff | all normative scenarios, migration rehearsal, authenticated smoke evidence |

Each mutation must derive tenant from RequestContext, prevent mass assignment of audit fields, return non-leaking authorization errors, and pass serial and isolation tests.
