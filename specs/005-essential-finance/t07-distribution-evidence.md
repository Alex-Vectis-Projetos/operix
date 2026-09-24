# T07 canonical manual Distribution evidence

## Scope and approved schema

T07 adds only manual Distribution create/read/cancel behavior under `/api/finance/v2`. Product changes are limited to `backend/src/services/distributionService.ts` and `backend/src/routes/financeV2.ts`; tests add the focused suite and synchronize the five implemented normative Distribution scenarios. No schema, migration, frontend, obligation/settlement command, legacy-runtime, or automatic-rule implementation changed.

The pre-existing `Distribution` model is used unchanged: tenant and PaymentList lineage, optional PaymentListItem lineage, explicit participant union (`person`, `workspace`, `client`), fixed/percentage allocation union, Decimal `resolvedAmount`, List-derived currency, active/cancelled state, creation audit, and cancellation audit. Its composite List/item/person/client foreign keys, union checks, Decimal columns, `@@unique([id, workspaceId])`, and `(workspaceId, paymentListId, status)` index provide persistence defense in depth. Fresh PostgreSQL 16 has exactly 11 migrations; no migration 12 was created.

## HTTP contract and allocation

`POST /distributions` requires `Idempotency-Key` and strict DTO fields `paymentListId`, optional nullable `paymentListItemId`, `participant`, and `allocation`. Authority/audit/derived fields are rejected. The server resolves workspace and creator from `RequestContext`, List currency from `PaymentList.currencyCode`, and `resolvedAmount` from the requested manual allocation. First create returns 201; matching replay returns 200 with `idempotent:true`; a changed same-key request returns `409 IDEMPOTENCY_KEY_REUSED`.

Fixed allocation accepts a positive decimal string and resolves exactly to that two-decimal amount. Percentage accepts a positive decimal string up to 100; it uses the List `recognizedTotal`, or the linked item `totalAmount`, and computes with `Prisma.Decimal`. T07 freezes explicit half-up rounding to two decimals before persistence, proven by List `1000.00 × 12.50% = 125.00` and item `333.33 × 33.33% = 111.10`. A percentage whose rounded result is non-positive is rejected.

The source List is always queried by `(id, activeWorkspaceId)`. A supplied item is likewise tenant scoped; foreign/missing source is 404 and a same-tenant item attached to a different List is `422 DISTRIBUTION_ITEM_LIST_MISMATCH`.

## Participants and authorization

Participants are strict tagged DTOs: `{kind: person, personId}`, `{kind: workspace, workspaceId}`, or `{kind: client, clientId}`. Person and Client are tenant-scoped canonical records; Workspace is allowed only when it equals the active workspace. A participant is economic identity only and never grants login or Finance access.

Owner/admin, including a technician who owns a personal workspace, may create, list, detail, and cancel their workspace records. A linked technician may list/detail only records where `participantPersonId` equals the server-resolved `RequestContext.technicianPersonId`; all other participant records and foreign IDs are 404. Client is 403 for the Distribution ledger and unauthenticated access is 401. Partner/shareholder remains participant-only unless a later frozen foundation capability authorizes a separate Finance scope.

## Manual-only, cancellation, and no cash movement

An active legacy `ProfitRule` with a conspicuous 99% item is present in the focused fixture. A manual Distribution creates exactly one requested canonical row and no `ServiceOrderDistribution`; the new service imports or queries no ProfitRule.

`POST /distributions/:distributionId/cancel` requires a strict reason and idempotency key. It conditionally transitions only the original active row to `cancelled`, preserving lineage, participant, allocation, amount, currency, and creation audit while adding server cancellation actor/time/reason. Same-key retry replays; changed same key and a new key after cancellation are conflicts; concurrent cancellation converges to one canonical transition. A directly seeded paid downstream `FinancialObligation` blocks cancellation with `409 DISTRIBUTION_NOT_CANCELLABLE`; no T08 HTTP command was added.

Real HTTP create/cancel snapshots show FinanceSummary unchanged. Counts of FinancialObligation, ObligationPayment, Expense, FinancialRecord, PaymentOrder, and ServiceOrderDistribution remain unchanged around creation. PaymentList status, recognized/source totals, item count, and the commercial lifecycle remain unchanged: Distribution records entitlement only and does not move cash or mutate Spec004 authority.

## Executable verification — 2026-09-24

- Fresh disposable PostgreSQL 16 at localhost:55434: all 11 migrations applied; Prisma validate and migrate status PASS.
- `essential-finance-distributions.test.ts`: **7/7 PASS**, 0 skip, 0 todo.
- T06 Expense regression: **7/7 PASS**. T05 summary: **8/8 PASS**. Schema: **7/7 PASS**.
- Normative suite: **33 discovered; 26 GREEN; 7 legitimate future RED; 0 skip; 0 todo; 0 harness defects; no false GREEN or false RED.** Newly GREEN: `DIST-MANUAL-01`, `DIST-NO-AUTO-RULE-01`, `DIST-PARTICIPANT-01`, `DIST-AUDIT-01`, `DIST-TENANT-01`. Remaining RED: `OBLIGATION-CREATE-01`, `OBLIGATION-NO-FIXED-CADENCE-01`, `OBLIGATION-PAY-01`, `OBLIGATION-PAY-IDEMPOTENT-01`, `OBLIGATION-TENANT-01`, `OBLIGATION-AUDIT-01`, and `FIN-TECH-OWN-01`.
- `FIN-TECH-OWN-01` remains legitimately RED: T07 proves a technician's own Distribution read, but the frozen scenario requires participant-linked Obligation and payment-status visibility, which is T08 scope. It was not weakened or split.
- Explicit regressions: Spec001 **17/17**, Spec002 **59/59**, Spec003 **137/137**, Spec004 **127/127**: **340/340 PASS**.
- Serial aggregate non-normative invocation discovered 388 tests and passed 387. Its only failure was an aggregation-only `STACK_TRACE_ERROR` while collecting `service-orders-legacy-sanitization.test.ts` at its existing projection-immutability test; the exact unchanged Spec003 command passed independently **137/137** against the same fresh database. The failure has no T07 stack or assertion and is recorded as runner/fixture isolation debt, not as a Distribution product regression.
- Backend typecheck/build, root typecheck, and frontend production build PASS. Lint has 0 errors and the known `src/components/production/ProductionBoard.tsx:164` exhaustive-deps warning only.
- Source audit found no JavaScript Number/parseFloat/parseInt monetary work, client-authoritative workspace/audit fields, ProfitRule execution, auto Obligation/ObligationPayment creation, legacy projection writes, or Distribution deletion. `Decimal#toFixed(2)` is normalization/response serialization only. The router contains exactly summary, four Expense, and four Distribution routes—no T08 surface.

The disposable database container is removed after local checkpoints; no database credential is stored in the repository.
