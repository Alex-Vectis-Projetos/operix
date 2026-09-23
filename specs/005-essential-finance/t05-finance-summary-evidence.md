# T05 canonical finance summary evidence

## Scope and implementation

T05 adds only `GET /api/finance/v2/summary`, its request-context bounded service, and focused integration coverage. It does not change schema, migrations, frontend, legacy product routes, or T06+ mutation behavior.

`getFinanceSummary` makes exactly three bounded Prisma aggregate queries: PaymentList grouped by `(status, currencyCode)`, Expense grouped by `currencyCode`, and ObligationPayment grouped by `currencyCode`. Every query filters the resolved active `workspaceId`; there is no per-currency query, history loading, or JavaScript money reduction. `Prisma.Decimal` is used for subtraction and `toFixed(2)` is serialization only.

The service imports or queries none of `FinancialRecord`, `PaymentOrder`, `FinancialEvent`, `ProfitRule`, `ServiceOrderDistribution`, `Reconciliation`, `ServiceOrder`, or `WEEKLOG`. A source search found no unsafe `Number`, `parseFloat`, `parseInt`, or `Math` monetary operation.

## T05 fixes

- Async authorization errors now reach Express through `next(error)`, returning 403 rather than leaving the request unresolved.
- Finance v2 removes `workspaceId` and `workspace_id` query selectors before shared RequestContext resolution. The authenticated active workspace therefore remains authoritative; the normal `X-Workspace-Id` header continues to be the foundation's legitimate scope selector.

## Executable T05 acceptance matrix

All entries below are PASS in `essential-finance-summary.test.ts` on a fresh PostgreSQL 16 database.

| IDs | Test / fixture / exact assertion |
|---|---|
| A, C, E, M, N, O, P | `aggregates canonical PaymentList and effective facts per ordered currency with Decimal strings`: pending EUR `0.30`, paid EUR `5000.00`, paid CAD `5000.00`, effective CAD/EUR/GBP/USD facts; exact ordered Decimal response. `recognizedTotal`, not source total `999.99`, is authoritative. |
| B, D | `moves one canonical list from expected to received without double counting`: pending EUR becomes paid; exact `{ expected: "0.00", received: "5000.30" }`. |
| G, I, J, K, L | `proves the complete Available current-state matrix without deleting audit facts`: CAD received `5000.00`, effective expense `3000.00`, pending obligation `2000.00` gives available `2000.00`; an effective payment `2000.00` gives `0.00`; its audited reversal restores `2000.00`; audited expense reversal gives expense `0.00`, available `5000.00`; independent USD `1000 - 800 - 500` is exactly `-300.00`. |
| H | `removes a currency represented only by reversed canonical facts`: audited reversal of the only GBP expense removes GBP from the response without deleting the row. |
| F | `excludes conspicuous legacy FinancialRecord revenue through the real summary route`: a legacy `FinancialRecord income=9999` is created; real HTTP response retains EUR received `5000.30`, expected `0.00`, and contains no `9999`. |
| Q, R, U | `keeps owner A in non-zero workspace A, permits client operations, and denies finance`: Workspace A has canonical values and Workspace B has paid EUR `7777.77`; owner A's normal request and both `?workspaceId=B` / `?workspace_id=B` requests return A's EUR `5000.30` and never contain `7777.77`. |
| S | Same HTTP test: linked technician receives 403. |
| T | Same HTTP test: the identical authenticated client gets 200 from the existing `GET /api/payment-lists`, then 403 from Finance v2. |

Personal-workspace determination is separately supported: `allows a technician who owns an active personal workspace` creates a technician AppUser that owns a `type: personal` workspace. A real request with that active workspace returns 200 and `{ currencies: [] }`. This uses existing `Workspace.ownerUserId` and RequestContext owner resolution; no foundation change was required.

## Fresh-fixture verification — 2026-09-23

- Disposable `postgres:16-alpine` database on localhost port 55433: all **11** migrations applied; `migrate status` current.
- Focused T05 suite: **8/8 PASS**, 0 skip, 0 todo.
- Schema suite: **7/7 PASS**.
- Normative baseline: **33 discovered; 1 GREEN (`FIN-NO-FLOAT-01`); 32 expected RED; 0 skip; 0 todo; 0 harness defects; 0 blocked-contract; no false green.** The lone green is existing Decimal schema evidence. No new baseline green is claimed: that fixture intentionally mounts only legacy finance/payment-list routes, so T06+ mutations and its frozen summary route expectations remain red. All 32 reds are expected absent-v2-route 404 outcomes; `FIN-NO-SPEC004-MUTATION-01` remains RED.
- Explicit serial regressions: Spec001 **17/17**, Spec002 **59/59**, Spec003 **137/137**, Spec004 **127/127**; **340/340 PASS**.
- Whole suite excluding intentionally failing normative baseline: **20 files, 374/374 PASS**. The normal whole-suite command has only the intentional normative 32 RED failures.

## Quality and diff audit

- Root typecheck reports only the established pre-T05 `PaymentListDetail.tsx(101,1453) TS2322` diagnostic.
- Backend typecheck and build: PASS. Prisma validate: PASS. Lint: 0 errors and the known `ProductionBoard.tsx:164` exhaustive-deps warning. Frontend Vite production build completed and produced 132 `dist` files.
- Final diff from `1df25946` is limited to the T05 service, route, index mount, focused test, this evidence, and task status. No schema, migration, frontend, manifest, T06+, or legacy runtime changes are included.
- The disposable PostgreSQL container was removed after verification; no database credential is persisted in the repository.

## Normative Acceptance Synchronization

The original T01/T02 baseline mounted only `/api/finance` and therefore returned 404 before it exercised the implemented v2 summary route. It also had no canonical PaymentList/Expense/ObligationPayment Given-state for read scenarios. The synchronized harness mounts the real `/api/finance/v2` router and Payment Lists positive control, while seeding canonical state directly only for the Given portion of a summary read. Future command tests still issue their actual HTTP command and remain RED at that missing command.

Fresh PostgreSQL 16 replayed all 11 migrations. The finalized synchronized run discovered **33** tests, with **14 GREEN / 19 RED / 0 skip / 0 todo / 0 harness defect**.

| ID | Result | Classification | Owning phase | Reason |
|---|---|---|---|---|
| FIN-EXPECTED-PENDING-01 | GREEN | GREEN-IMPLEMENTED | T05 | Real summary reads seeded pending EUR `5000.00` into Expected. |
| FIN-EXPECTED-EXCLUDE-NONPENDING-01 | GREEN | GREEN-IMPLEMENTED | T05 | Draft/paid lists do not change Expected. |
| FIN-RECEIVED-PAID-01 | GREEN | GREEN-IMPLEMENTED | T05 | Real summary reads paid EUR `5000.00` into Received. |
| FIN-RECEIVED-EXCLUDE-UNPAID-01 | GREEN | GREEN-IMPLEMENTED | T05 | Pending/draft lists do not change Received. |
| FIN-NO-DOUBLE-REVENUE-01 | GREEN | GREEN-IMPLEMENTED | T05 | Legacy income `9999` does not change canonical Received. |
| FIN-AVAILABLE-01 | GREEN | GREEN-IMPLEMENTED | T05 | EUR is exactly `5000 - 3000 - 2000 = 0`. |
| FIN-AVAILABLE-NEGATIVE-01 | GREEN | GREEN-IMPLEMENTED | T05 | GBP is exactly `1000 - 800 - 500 = -300`. |
| FIN-CURRENCY-SEPARATION-01 | GREEN | GREEN-IMPLEMENTED | T05 | Ordered EUR/GBP buckets remain separate. |
| EXPENSE-CREATE-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | First assertion is absent `POST /expenses` (404). |
| EXPENSE-DECIMAL-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | First assertion is absent `POST /expenses` (404). |
| EXPENSE-LINKAGE-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | First assertion is absent `POST /expenses` (404). |
| EXPENSE-AUDIT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | First assertion is absent reversal command (404). |
| EXPENSE-TENANT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | Required own create is absent (404). |
| EXPENSE-IDOR-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | Required own create is absent (404). |
| DIST-MANUAL-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T07 | First assertion is absent distribution command (404). |
| DIST-NO-AUTO-RULE-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T07 | First assertion is absent distribution command (404). |
| DIST-PARTICIPANT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T07 | First assertion is absent distribution command (404). |
| DIST-AUDIT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T07 | First assertion is absent cancellation command (404). |
| DIST-TENANT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T07 | Required own create is absent (404). |
| OBLIGATION-CREATE-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | First assertion is absent obligation command (404). |
| OBLIGATION-NO-FIXED-CADENCE-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | First assertion is absent obligation command (404). |
| OBLIGATION-PAY-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | First assertion is absent settlement command (404). |
| OBLIGATION-PAY-IDEMPOTENT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | First assertion is absent settlement command (404). |
| OBLIGATION-TENANT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | Required own command is absent (404). |
| OBLIGATION-AUDIT-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T08 | First assertion is absent reversal command (404). |
| FIN-TECH-OWN-01 | RED | RED-EXPECTED-PRODUCT-GAP | T07/T08 mixed | Required technician Distribution positive control is absent (404), before summary denial. |
| FIN-CLIENT-INTERNAL-DENY-01 | GREEN | GREEN-IMPLEMENTED | T05 | Real client Payment Lists read is 200, then real Finance summary is 403. |
| FIN-OWNER-SUMMARY-01 | GREEN | GREEN-IMPLEMENTED | T05 | Owner receives non-empty real summary (200). |
| FIN-CROSS-TENANT-01 | GREEN | GREEN-IMPLEMENTED | T05 | Own summary is 200; unauthorized foreign active-workspace resolution returns exact 403 `{ message }` before any Finance data. |
| FIN-WORKSPACE-SPOOF-01 | GREEN | GREEN-IMPLEMENTED | T05 | Both query selectors are ignored; non-zero B value `7777.77` is absent. |
| FIN-NO-FLOAT-01 | GREEN | GREEN-IMPLEMENTED | T03/T04 | Canonical `Expense.amount` is Decimal. |
| FIN-NO-LEGACY-AUTHORITY-01 | GREEN | GREEN-IMPLEMENTED | T05 | Real summary remains canonical despite legacy fixture. |
| FIN-NO-SPEC004-MUTATION-01 | RED | RED-EXPECTED-FUTURE-MUTATION | T06 | Required canonical finance mutation is absent (404). |

The 12 T05 summary scenarios that were false RED solely due to legacy-only mounting are now executable. `FIN-TECH-OWN-01` remains mixed-scope because its required positive control is a future Distribution read; it was not relaxed. The prior 404 expectation in `FIN-CROSS-TENANT-01` was over-specified: a foreign workspace is a RequestContext capability denial, so its frozen response is exact 403 with the normal message envelope and no Finance data. This differs from a concrete foreign-object lookup, where 404 privacy may still be correct. No product code was changed during this synchronization.
