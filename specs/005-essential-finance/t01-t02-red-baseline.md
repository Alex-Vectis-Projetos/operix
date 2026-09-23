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
| FIN-CLIENT-INTERNAL-DENY-01 | TEST-HARNESS-DEFECT | FAIL: real auth positive control cannot reach the required local PostgreSQL fixture |
| FIN-OWNER-SUMMARY-01 | RED-MISSING-ROUTE | FAIL: summary absent |
| FIN-CROSS-TENANT-01 | RED-AUTHORIZATION | FAIL: owner v2 positive control absent |
| FIN-WORKSPACE-SPOOF-01 | RED-AUTHORIZATION | FAIL: v2 mutation absent |
| FIN-NO-FLOAT-01 | RED-MISSING-SCHEMA | FAIL: canonical Expense Decimal model absent |
| FIN-NO-LEGACY-AUTHORITY-01 | RED-MISSING-ROUTE | FAIL: canonical summary absent |
| FIN-NO-SPEC004-MUTATION-01 | RED-MISSING-ROUTE | FAIL: canonical expense mutation absent |

All source identifiers are separate tests; no reporting ranges are used.

## Executed 2026-09-23 — dependency recovery and targeted run

- Root lock repair: `npm ci` initially reported the four declared `@dnd-kit` entries missing from the root lock. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` produced a minimal `package-lock.json` repair (86 insertions, 15 deletions): the four required packages plus npm 11 peer-metadata normalization, without manifest or backend-lock changes. Both root and backend `npm ci --ignore-scripts --no-audit --no-fund` completed. Normal locked installs were then used to restore development tooling.
- Prisma generation: `npm --prefix backend run db:generate` was required because `--ignore-scripts` had left the local client ungenerated. It produced only ignored dependency output. Root and backend typechecks then passed.
- Runner: the local `vitest` executable resolved through `npm test`; no global or `npx` fallback was used.
- Harness correction: backend modules validate environment during import, so the test now establishes its test-only environment before dynamically importing the real Express router and JWT helper. This eliminated the collection-time `ZodError`.
- Targeted result: Vitest discovered **33** tests; **PASS 0 / FAIL 33 / SKIP 0 / TODO 0**. The Finance v2 requests returned `404` where the frozen contract requires `200`, `201`, or canonical behavior. `FIN-NO-FLOAT-01` found no canonical `Expense.amount Decimal` model.
- Classification totals: **RED-MISSING-ROUTE 24; RED-AUTHORIZATION 7; RED-MISSING-SCHEMA 1; TEST-HARNESS-DEFECT 1; GREEN-EXISTING 0; RED-MISSING-BEHAVIOR 0; RED-LEGACY-CONFLICT 0; UNEXPECTED-FAILURE 0; BLOCKED-CONTRACT 0.**
- The remaining harness defect is isolated to `FIN-CLIENT-INTERNAL-DENY-01`: its required real operational positive control invokes the current `requireAuth` middleware, which queries PostgreSQL. No listener exists on the repository-standard `127.0.0.1:55432` (nor on `5432`), and Docker is unavailable on this host, so the positive control returns `401` after Prisma cannot connect. It is not classified as an authorization/product result and no mock or fake positive control was introduced.
- False-green audit: no test passes; no status ranges, route simulation, unmounted v2 router, skip/todo, or empty-fixture pass can create a GREEN. Security cases require their positive controls before a GREEN classification.
- Stop rule: Specs001–004 regressions, full root suite, lint, and frontend/backend builds were not run after the unresolved harness fixture defect. No product, schema, migration, manifest, or runtime configuration was changed.
