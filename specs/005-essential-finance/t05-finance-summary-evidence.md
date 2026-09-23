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
