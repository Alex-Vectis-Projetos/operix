# T01/T02 RED baseline evidence

Test file: `tests/integration/essential-finance-red-baseline.test.ts`. Each test name is its exact acceptance ID; no skip/todo/fails modifier exists. Baseline classification is intentional: v2 endpoints are not mounted, while `FIN-NO-FLOAT-01` is RED-MISSING-SCHEMA.

| ID | Classification | Test result when runner is available |
|---|---|---|
| FIN-EXPECTED-PENDING-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-EXPECTED-EXCLUDE-NONPENDING-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-RECEIVED-PAID-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-RECEIVED-EXCLUDE-UNPAID-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-NO-DOUBLE-REVENUE-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-AVAILABLE-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-AVAILABLE-NEGATIVE-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-CURRENCY-SEPARATION-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| EXPENSE-CREATE-01 | RED-MISSING-ROUTE | FAIL: expense v2 absent |
| EXPENSE-DECIMAL-01 | RED-MISSING-ROUTE | FAIL: expense v2 absent |
| EXPENSE-LINKAGE-01 | RED-MISSING-ROUTE | FAIL: expense v2 absent |
| EXPENSE-AUDIT-01 | RED-MISSING-ROUTE | FAIL: expense v2 absent |
| EXPENSE-TENANT-01 | RED-AUTHORIZATION | FAIL: owner positive v2 create absent |
| EXPENSE-IDOR-01 | RED-AUTHORIZATION | FAIL: owner positive v2 create absent |
| DIST-MANUAL-01 | RED-MISSING-ROUTE | FAIL: distribution v2 absent |
| DIST-NO-AUTO-RULE-01 | RED-MISSING-ROUTE | FAIL: distribution v2 absent |
| DIST-PARTICIPANT-01 | RED-MISSING-ROUTE | FAIL: distribution v2 absent |
| DIST-AUDIT-01 | RED-MISSING-ROUTE | FAIL: distribution v2 absent |
| DIST-TENANT-01 | RED-AUTHORIZATION | FAIL: owner positive v2 create absent |
| OBLIGATION-CREATE-01 | RED-MISSING-ROUTE | FAIL: obligation v2 absent |
| OBLIGATION-NO-FIXED-CADENCE-01 | RED-MISSING-ROUTE | FAIL: obligation v2 absent |
| OBLIGATION-PAY-01 | RED-MISSING-ROUTE | FAIL: settlement v2 absent |
| OBLIGATION-PAY-IDEMPOTENT-01 | RED-MISSING-ROUTE | FAIL: settlement v2 absent |
| OBLIGATION-TENANT-01 | RED-AUTHORIZATION | FAIL: owner positive v2 create absent |
| OBLIGATION-AUDIT-01 | RED-MISSING-ROUTE | FAIL: settlement reversal absent |
| FIN-TECH-OWN-01 | RED-AUTHORIZATION | FAIL: positive v2 own-read absent |
| FIN-CLIENT-INTERNAL-DENY-01 | RED-AUTHORIZATION | FAIL: positive operational fixture/v2 boundary not yet established |
| FIN-OWNER-SUMMARY-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-CROSS-TENANT-01 | RED-AUTHORIZATION | FAIL: owner v2 positive control absent |
| FIN-WORKSPACE-SPOOF-01 | RED-AUTHORIZATION | FAIL: v2 mutation absent |
| FIN-NO-FLOAT-01 | RED-MISSING-SCHEMA | FAIL: canonical Expense Decimal model absent |
| FIN-NO-LEGACY-AUTHORITY-01 | RED-MISSING-ROUTE | FAIL: canonical summary absent |
| FIN-NO-SPEC004-MUTATION-01 | RED-MISSING-ROUTE | FAIL: canonical expense mutation absent |

All source identifiers are separate tests; no reporting ranges are used.
