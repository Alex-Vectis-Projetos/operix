# Task breakdown

| Task | Objective / likely files | Acceptance / gates / done |
|---|---|---|
| T01/T02 | RED acceptance and request-context helpers; `tests/**`, finance routes | DEC-016; FIN-CROSS-TENANT-01, FIN-WORKSPACE-SPOOF-01, EXPENSE-TENANT-01, EXPENSE-IDOR-01, DIST-TENANT-01, OBLIGATION-TENANT-01 |
| T03/T04 | Decimal models/migration/repository; Prisma schema/migration/services | FIN-NO-FLOAT-01, FIN-CURRENCY-SEPARATION-01, EXPENSE-DECIMAL-01; DEC-009–015; forward-only dry run |
| T05 | **COMPLETE** — canonical summary service and authenticated `/api/finance/v2/summary` route | Focused 8/8, schema 7/7, serial Specs001–004 340/340; evidence: `t05-finance-summary-evidence.md` |
| T06 | **COMPLETE** — canonical Expense create/read/reversal lifecycle | Focused 7/7, T05 8/8, schema 7/7, normative 21 GREEN / 12 legitimate future RED; evidence: `t06-expense-evidence.md` |
| T07 | **COMPLETE** — canonical manual Distribution create/read/cancel lifecycle | Focused 7/7, T06 7/7, T05 8/8, schema 7/7, normative 26 GREEN / 7 legitimate future RED; evidence: `t07-distribution-evidence.md` |
| T08 | **COMPLETE** — full obligations/settlements | Focused 7/7, T07 7/7, T06 7/7, T05 8/8, schema 7/7, normative 33/33 GREEN, Specs001–004 340/340; evidence: `t08-obligation-settlement-evidence.md` |
| T09 | **COMPLETE** — legacy retirement/migration | FIN-NO-LEGACY-AUTHORITY-01; report ambiguous rows, no reverse sync |
| T10 | **COMPLETE** — typed frontend Finance v2 client + TanStack query hooks | FIN-TECH-OWN-01, FIN-CLIENT-INTERNAL-DENY-01, FIN-OWNER-SUMMARY-01; unit 11/11, frontend build/lint pass; evidence: `t10-frontend-client-evidence.md` |
| T11 | **COMPLETE** — typed canonical Finance v2 UI | FinancialPage canonical migration, per-currency summary, Expenses ledger/reversal, manual Distributions, Obligations/settlement lifecycle, technician own view, client denial, 0 legacy authority; unit 62/62 (10/10 focused UI), build/type/lint pass; evidence: `t11-canonical-finance-ui-evidence.md` |
| T12 | **COMPLETE** — final regression, security, migration rehearsal & handoff | All gates passed: normative 33/33, prior specs 340/340, serial aggregate 454/454, fresh 11-migration rehearsal, security audit, release runbook, VECTIS homologation guide; evidence: `t12-release-readiness.md` |

Each mutation must derive tenant from RequestContext, prevent mass assignment of audit fields, return non-leaking authorization errors, and pass serial and isolation tests.
