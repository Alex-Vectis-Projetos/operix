# Acceptance plan

## Normative acceptance

| ID | Given / When / Then |
|---|---|
| FIN-EXPECTED-PENDING-01 | Given validated pending List A, when summary is read, then A recognized amount appears only in Expected. |
| FIN-EXPECTED-EXCLUDE-NONPENDING-01 | Given draft/paid/rejected List, when summary is read, then it is not Expected. |
| FIN-RECEIVED-PAID-01 | Given paid List A, when summary is read, then A appears only in Received. |
| FIN-RECEIVED-EXCLUDE-UNPAID-01 | Given non-paid List, then it is excluded from Received. |
| FIN-NO-DOUBLE-REVENUE-01 | Given List A, when repeated reads/legacy projections exist, then A is counted once from PaymentList only. |
| FIN-AVAILABLE-01 | Given received and paid linked expenses, then Available is their Decimal difference per currency. **BLOCKED-BUSINESS OPEN-001 for settlement.** |
| FIN-AVAILABLE-NEGATIVE-01 | Given expenses exceed received, then a negative Decimal Available is returned. |
| FIN-CURRENCY-SEPARATION-01 | Given EUR and non-EUR facts, then totals are separate and no FX/cross-sum occurs. |
| EXPENSE-CREATE-01 / EXPENSE-DECIMAL-01 / EXPENSE-LINKAGE-01 / EXPENSE-AUDIT-01 | Given owner/admin scope, when valid Decimal expense with explicit currency/context is created, then it is scoped, audited and visible in summary. |
| EXPENSE-TENANT-01 / EXPENSE-IDOR-01 | Given another workspace record, when accessed/mutated, then no data changes or leaks. |
| DIST-MANUAL-01 / DIST-NO-AUTO-RULE-01 / DIST-PARTICIPANT-01 / DIST-AUDIT-01 | Given authorized manual List allocation to canonical participant, when created, then no saved rule executes and audit is preserved. |
| DIST-TENANT-01 | Given foreign List/participant, when allocated, then 403/404 and no write. |
| OBLIGATION-CREATE-01 / OBLIGATION-NO-FIXED-CADENCE-01 | Given valid manual allocation, when payable is created, then it has no required monthly cadence. |
| OBLIGATION-PAY-01 / OBLIGATION-PAY-IDEMPOTENT-01 | Given pending obligation, when same settlement command retries, then one audited settlement exists. **BLOCKED-BUSINESS OPEN-003/004.** |
| OBLIGATION-TENANT-01 / OBLIGATION-AUDIT-01 | Given foreign/non-authorized obligation, then mutation fails; effective transitions remain auditable. |
| FIN-TECH-OWN-01 / FIN-CLIENT-INTERNAL-DENY-01 / FIN-OWNER-SUMMARY-01 | Given respective actor, then technician sees confirmed own scope only, client sees no internal finance, owner/admin sees workspace summary. **OPEN-006.** |
| FIN-CROSS-TENANT-01 / FIN-WORKSPACE-SPOOF-01 | Given body/query workspace spoof, then RequestContext scope prevails. |
| FIN-NO-FLOAT-01 / FIN-NO-LEGACY-AUTHORITY-01 / FIN-NO-SPEC004-MUTATION-01 | Given canonical operation, then Decimal models only, legacy cannot authorize results, and Spec004 data/lifecycle is unchanged. |

## Hardening / non-normative

PostgreSQL concurrency: duplicate payment, expense retry, concurrent distribution freeze/update, tenant race, and PaymentList transition during summary read. Historical period charts remain blocked by OPEN-002. No tests are created in T00.
