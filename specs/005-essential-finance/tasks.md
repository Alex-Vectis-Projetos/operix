# Task breakdown

| Task | Objective / likely files | Acceptance / gates / done |
|---|---|---|
| T01/T02 | RED acceptance and request-context helpers; `tests/**`, finance routes | DEC-016; FIN-CROSS-TENANT-01, FIN-WORKSPACE-SPOOF-01, EXPENSE-TENANT-01, EXPENSE-IDOR-01, DIST-TENANT-01, OBLIGATION-TENANT-01 |
| T03/T04 | Decimal models/migration/repository; Prisma schema/migration/services | FIN-NO-FLOAT-01, FIN-CURRENCY-SEPARATION-01, EXPENSE-DECIMAL-01; DEC-009–015; forward-only dry run |
| T05 | **COMPLETE** — canonical summary service and authenticated `/api/finance/v2/summary` route | Focused 8/8, schema 7/7, serial Specs001–004 340/340; evidence: `t05-finance-summary-evidence.md` |
| T06 | expense domain | EXPENSE-CREATE-01, EXPENSE-LINKAGE-01, EXPENSE-AUDIT-01 |
| T07 | manual distributions | DIST-MANUAL-01, DIST-NO-AUTO-RULE-01, DIST-PARTICIPANT-01, DIST-AUDIT-01 |
| T08 | full obligations/settlements | OBLIGATION-CREATE-01, OBLIGATION-NO-FIXED-CADENCE-01, OBLIGATION-PAY-01, OBLIGATION-PAY-IDEMPOTENT-01, OBLIGATION-AUDIT-01 |
| T09 | legacy retirement/migration | FIN-NO-LEGACY-AUTHORITY-01; report ambiguous rows, no reverse sync |
| T10/T11 | typed client/UI | FIN-TECH-OWN-01, FIN-CLIENT-INTERNAL-DENY-01, FIN-OWNER-SUMMARY-01 |
| T12 | regression/security/handoff | FIN-NO-SPEC004-MUTATION-01 plus all 33 normative scenarios, migration rehearsal and authenticated smoke evidence |

Each mutation must derive tenant from RequestContext, prevent mass assignment of audit fields, return non-leaking authorization errors, and pass serial and isolation tests.
