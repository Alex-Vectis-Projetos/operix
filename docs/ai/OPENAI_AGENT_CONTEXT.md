# OPENAI_AGENT_CONTEXT.md — Operix Core

Compressed engineering context for coding and review agents.

This document exists to avoid repeatedly injecting large conversation history into prompts. It is intentionally not a transcript.

Normal workflow:
1. Read `AGENTS.md`.
2. Read the active spec/task artifacts.
3. Read this file only when work crosses specs or broader domain context is needed.

If this file conflicts with a newer approved spec/ADR, the newer approved spec/ADR wins.

---

## 1. Project

Operix Core is a brownfield SaaS / operating system for automotive repair, PDR/bodywork, workshops, technicians, clients, WEEKLOG validation, PaymentLists, invoicing, and essential Finance.

Client/product context:
- Alex Souza / VECTIS
- Europe / France operational context

Engineering strategy:
- preserve/reuse existing code where sound;
- avoid full rewrite;
- build vertical slices through real business workflows;
- spec-first;
- test-first;
- Git as source of truth;
- tenant-safe;
- auditable;
- migrate authority away from unsafe legacy paths instead of building parallel authority.

Primary stack:
- React
- Vite
- TypeScript
- Express / Node
- JWT auth
- Prisma
- PostgreSQL 16
- MinIO / S3-compatible storage
- TanStack Query
- Docker/Compose deployment architecture

---

## 2. Architecture

`React/Vite`
→ authenticated API client
→ `Express`
→ authentication / `RequestContext`
→ object/capability authorization
→ focused domain services
→ `Prisma/PostgreSQL`

Storage:
→ MinIO / S3-compatible adapters where required.

Avoid:
- browser authority over tenant;
- Supabase as parallel canonical authority;
- localStorage as domain authority;
- legacy financial tables as canonical current truth.

---

## 3. Server-side authority

Canonical context includes:
- `actorUserId`
- `platformRole`
- `activeWorkspaceId`
- `technicianPersonId`
- `scope`
- `membershipRole`
- capabilities

Primary rule:

`RequestContext.activeWorkspaceId` is tenant authority.

Frontend `X-Workspace-Id` may select context, but backend validates ownership/membership.

Typical privacy behavior:
- foreign resource: 404 when existence should not leak;
- authenticated role/capability denial: 403.

---

## 4. Actors

Important actors:
- workspace/company intermediary
- Owner/Admin
- internal employee
- independent technician
- linked technician
- partner/shareholder
- client
- client collaborator

Independent technician can operate through a personal workspace.

Linked technician must not gain company-wide Finance visibility.

Client/collaborator can act only inside granted client/site/capability boundaries and never receives internal ledger authority.

---

## 5. Canonical business flow

`Budget/PDR OR direct ProductionOrder`
→ `Production`
→ individual finalization
→ `WEEKLOG`
→ client/workshop validation/signature
→ `PaymentList`
→ invoice/document handoff
→ Finance
→ payments/distribution/obligations

Distinctions:

### Budget
Technician creates/revises.

Client or authorized client collaborator approves/rejects.

Technician cannot self-approve their own commercial Budget.

A modified approved Budget requires a new revision and client approval.

Direct ProductionOrder creation remains supported where authorized.

### Production
Operational execution for a vehicle.

Finalization creates WEEKLOG participation/evidence.

Rectification returns work to production without destroying earlier history.

### WEEKLOG
Weekly operational evidence.

Not the same entity as PaymentList.

### PaymentList
Commercial recognition/authority.

May span multiple operational weeks.

Supports internal/manual/external commercial flows.

### Finance
Consumes canonical PaymentList status.

Does not rewrite commercial truth.

---

## 6. WEEKLOG domain

Operational week:
- Sunday 00:00:00.000
- through Saturday 23:59:59.999
- workspace IANA timezone
- persisted in UTC
- DST-aware

Canonical identity includes tenant/week/client/site dimensions.

A ProductionOrder enters WEEKLOG only when finalized.

Unfinished work does not enter weekly coverage.

If finalized later, it enters the corresponding later operational week.

### WeeklogEntry

Carries immutable operational snapshots such as:
- vehicle identifiers;
- client;
- technician;
- performed services snapshot;
- amount;
- completion/delivery timestamp;
- execution sequence;
- rectification lineage where applicable.

Do not mutate historical snapshots because later production data changes.

### Validation rounds

Validation is versioned.

Each round contains:
- sequence;
- frozen coverage;
- submission metadata;
- status;
- validator/signature evidence when completed.

Coverage is immutable after submission.

Rectification/re-finalization can create another execution entry and another validation requirement.

Never overwrite historical validation evidence.

### Validation actor

Authorized client/workshop side validates.

Executor technician must not self-validate their own production as the client.

Sign-off can use:
- authenticated confirmation;
- drawn signature.

### Rectification

Rejected/disputed execution can return to production.

Preserve:
- original evidence;
- reason;
- lineage;
- sequence.

Do not turn operational rectification into automatic financial side effects.

---

## 7. Business-facing WEEKLOG projection

Primary WEEKLOG management/sign-off view should be concise.

Prefer per vehicle:
- completion/delivery date;
- Site/Local;
- brand/model;
- plate;
- VIN/chassis;
- performed service names;
- total value.

Do not duplicate full Budget/Production panel/part/damage detail in the primary weekly view.

Detailed evidence remains in audit/detail surfaces.

---

## 8. PaymentList / confrontation

PaymentList is distinct from WEEKLOG.

Historical canonical lifecycle:
`draft`
→ `under_review`
→ `confronted`
→ `pending`
→ `paid`

Spec006 preserves those and uses additional pre-invoice states where frozen:
- `ready_for_billing`
- `superseded`
- `cancelled` pre-invoice only

Important:
- List can cover multiple weeks;
- currency is explicit ISO;
- `sourceDocumentTotal` preserves source evidence;
- `recognizedTotal` is accepted commercial value;
- confrontation compares executed WEEKLOG facts with client-recognized List facts;
- human decisions resolve mismatches;
- claims prevent double billing.

### Source semantics

Frozen Spec006 source types:
- `weeklog_auto`
- `external_import`
- `manual`

Validated WEEKLOG should produce an internal draft List in the reconciliation flow.

External client Lists may span multiple weeks and must confront internal execution evidence without claim collisions.

Manual Lists remain supported.

### Claim lifecycle target

Frozen Spec006 target states:
- `provisional`
- `reserved`
- `consumed`
- `released`

Meaning:
- provisional = auto-draft hold; absorbable/non-definitive;
- reserved = definitive active commercial claim;
- consumed = invoiced/finalized claim; immutable;
- released = pre-invoice released/superseded claim.

One physical execution must never become billable twice.

---

## 9. Invoice boundary

Phase 1 requires a coherent List → Invoice/document boundary, not a complete SaaS billing platform.

Frozen direction:

Internal:
`draft`
→ `ready_for_billing`
→ invoice create/associate
→ `pending`
→ `paid`

External:
`under_review`
→ `confronted`
→ invoice create/associate
→ `pending`
→ `paid`

`pending` must not occur before invoice handoff.

Post-invoice `pending -> cancelled` is outside Phase 1.

Future fiscal reversal/credit-note behavior must not release consumed execution for rebilling.

---

## 10. Finance V2

Canonical revenue:
- Expected = SUM `recognizedTotal` where PaymentList status is `pending`
- Received = SUM `recognizedTotal` where status is `paid`

When `pending -> paid`, value leaves Expected and enters Received.

Never count paid in both.

Available per currency:

`Available = Received - effective Expenses - effective settled ObligationPayments`

Rules:
- pending obligation has zero cash effect;
- settlement reduces cash exactly once;
- settlement is not Expense;
- reversal restores cash exactly once;
- negative Available is valid;
- no FX/cross-currency grand total;
- current-state summary only in Phase 1.

Canonical entities:
- Expense
- Distribution
- FinancialObligation
- ObligationPayment

Distribution:
- manual allocation/entitlement;
- zero cash effect;
- may reference PaymentList/item;
- no automatic ProfitRule authority.

Linked technician:
- own distributions/obligations/payment status only;
- no company summary/expenses.

Client:
- denied internal Finance.

---

## 11. Client governance

`ClientAccessGrant` is the client-side authorization primitive.

Client-safe capabilities:
- `budget.approve`
- `weeklog.validate`
- `payment_list.review`
- `invoice.view`
- `client.collaborators.manage`

Operational scope:
- `siteKey = null` → client-wide
- `siteKey = value` → restricted site/platform

Rules:
- same workspace;
- same client;
- active/not revoked;
- required capability;
- site scope where applicable;
- no internal Finance capability;
- no cross-client delegation;
- no capability escalation beyond allowed ceiling.

Workspace Owner/Admin may bootstrap grants, but is not the client commercial approver merely because of workspace administration.

New grants default deny unless capabilities are explicitly assigned.

---

## 12. Budget authority

Technician:
- create;
- edit;
- revise;
- submit.

Cannot approve/reject own assigned/executed Budget.

Approval/rejection requires appropriate client grant/capability.

Cross-client approval denied.

Site-restricted client approver acts only on matching operational site.

Rejection reason may exist as an engineering/audit refinement; it is not itself a client meeting requirement.

---

## 13. External operational import

Canonical existing route family:

`/api/external-operational-imports`

Existing semantics:
- staging/review;
- editable rows;
- provenance;
- external source without fake ProductionOrder;
- commit produces validated WEEKLOG evidence;
- `external_import_review` semantics.

Do not create a parallel external WEEKLOG ingestion subsystem.

Spec006 delta:
canonical external WEEKLOG commit should later converge on the same commercial auto-draft mechanism as internally validated WEEKLOG.

---

## 14. Importer UX

Preserve/reconnect:
- source document preview;
- zoom;
- rotation;
- editable extracted rows;
- batch/apply-downward correction;
- human review before authoritative commit;
- confrontation visibility where applicable.

Do not invent a backend endpoint if existing batch/PATCH semantics already support the UI action.

---

## 15. Production history

Phase 1 requires a minimal factual timeline.

Use persisted facts only:
- created;
- started/in production where timestamp exists;
- finalized/delivered;
- WEEKLOG entry;
- rectification/reopened lineage.

Do not fabricate historical pause/resume events.

Do not add generic event sourcing for this requirement.

---

## 16. Explicit Phase 1 exclusions

Do not silently expand into:
- accounting ERP;
- full HR;
- configurable enterprise workflow engine;
- broad automation platform;
- advanced GIS/maps product;
- marketplace;
- native app;
- definitive SaaS subscription/billing platform;
- advanced PDR/AI visual analysis;
- FX/cross-currency accounting;
- partial settlement unless separately approved.

---

## 17. Git/release policy

- `main` = frozen production;
- `develop/operix-core` = integration;
- review before integration;
- no main merge before staging/regression/migrations proven;
- no force/rebase published history.

Preferred phase loop:
1. verify branch/head/worktree;
2. verify approved previous checkpoint;
3. implement only current phase;
4. focused acceptance;
5. required regressions;
6. quality gates;
7. atomic commit;
8. no push/deploy unless explicitly authorized;
9. human review;
10. next phase.

---

## 18. Historical regression baselines

Before Spec006 reconciliation:
- Spec001 Foundation/Security: 17/17
- Spec002 Budget/Production: 59/59
- Spec003 WEEKLOG: 137/137 historical consolidated inventory
- Spec004 PaymentList/Confrontation: 127/127
- Spec005 Essential Finance: technical release candidate complete

Newer frozen Spec006 rules override any historical behavior they explicitly supersede.

---

## 19. Current Spec006 reconciliation

Primary files:
- `specs/phase1-business-flow-reconciliation/spec.md`
- `specs/phase1-business-flow-reconciliation/decisions.md`
- `specs/phase1-business-flow-reconciliation/acceptance.md`
- `specs/phase1-business-flow-reconciliation/plan.md`
- `specs/phase1-business-flow-reconciliation/tasks.md`

R01D froze the reconciliation contract.

R02/R02.1 addressed:
- client-side Budget authority;
- technician self-approval prohibition;
- ClientAccessGrant capabilities;
- default-deny new grants;
- same-client/site scoped delegation;
- PaymentList client review capability enforcement on canonical routes;
- production factual timeline;
- collaborator reinvite/reactivation;
- removal of false `invoice.view` GREEN.

R03 addressed:
- WEEKLOG automatic week closure (`reconcileExpiredWeeklogs`) under pessimistic locking;
- startup catch-up (`runStartupCatchup`) before normal HTTP readiness;
- periodic 60-second idempotent closure runner;
- concise business WEEKLOG projection (`GET /api/weeklogs/:id/projection`);
- hardening against manual submission race, multi-runner concurrency, sequence increment, and tenant/site scoping.
- R03 approved.

R04/R04.1 addressed:
- source-aware provisional claims, multiweek absorption, and manual list coexistence;
- authoritative draft list handoff from validation (`validateWeeklogBatch`) and external import commit;
- forward-only migration for composite tenant-safe FKs and claim constraints;
- forward-only migration `20261002180000_spec006_r04_1_provenance_restrict` enforcing `ON DELETE RESTRICT` on commercial provenance foreign keys (`originWeeklog`, `originWeeklogValidation`, `supersededBy`);
- authorized internal manager transition to `ready_for_billing`, promoting claims `provisional -> reserved`, idempotent, zero Finance effect, and pre-invoice cancellation releasing claims;
- acceptance `LIST-PROVENANCE-IMMUTABLE-01` and `LIST-INTERNAL-READY-FOR-BILLING-01` verified GREEN.

R05 addressed:
- explicit invoice commands: `POST /api/payment-lists/:id/invoice/create` and `POST /api/payment-lists/:id/invoice/associate`;
- internal manager authority gate (`manager(ctx)`), client collaborators denied 403;
- atomic transaction promoting `ready_for_billing`/`confronted` PaymentList to `pending` with `invoiceId`;
- definitive `reserved` claims promoted to immutable `consumed` (`consumedAt` set, `releasedAt` null);
- provisional claims rejected with 422 before `pending`;
- create/associate idempotency, row locking (`FOR UPDATE`) protecting concurrent races, and atomic rollback on failure;
- tenant isolation: foreign invoice IDs return 404 without leaking existence; client mismatch rejected with 422;
- Finance boundary verified: `ready_for_billing`/`confronted` (Expected = 0, Received = 0), `pending` (Expected = recognizedTotal, Received = 0), `paid` (Expected = 0, Received = recognizedTotal);
- canonical `invoice.view` client capability wired to `GET /api/billing/invoices/:invoiceId` and `/pdf` with siteKey scoping, revoked grant denial, and zero internal ledger leakage;
- acceptance `LIST-INVOICE-HANDOFF-01`, `LIST-INVOICE-CREATE-IDEMPOTENT-01`, `LIST-INVOICE-CONCURRENT-01`, `LIST-INVOICE-ASSOCIATE-IDEMPOTENT-01`, `LIST-INVOICE-ATOMIC-ROLLBACK-01`, and `CLIENT-CAPABILITY-INVOICE-VIEW-01` verified GREEN.

Reviewed local checkpoint:

`b332e404b9ae21dfffc3f86e3ba6ee48cf4966a4`

Branch:
`fix/phase1-business-flow-reconciliation`

Always verify Git; this SHA is a checkpoint, not a permanent assumption.

---

## 20. Current next phase

Current approved phase:

### Spec006 R06
Importer UX Preservation & Contractual UI Release Gates.
- Connect interactive document controls (rotation, zoom, editable grid, bulk downward apply) in frontend importer using existing `PATCH /api/external-operational-imports/:id/rows`
- Execute Operix brand hygiene audit: purge residual "Nexus" and "WorkNexus" strings (`UI-BRAND-OPERIX-01`)
- Verify light mode contrast and mobile/tablet responsive layouts
- Hide generic automation engine from active navigation

---

## 21. Context reuse protocol

For every new task:

First:
- read `AGENTS.md`.

Then read only:
- current spec;
- relevant ADR section;
- named acceptance IDs;
- current phase tasks;
- exact code/tests touched.

Read this file when:
- task crosses spec boundaries;
- authorization/Finance/WEEKLOG/List interaction is involved;
- prompt would otherwise need large background repetition;
- reviewer needs broader invariants.

Avoid:
- reloading all previous reports;
- replaying full conversation history;
- re-reading both Alex/VECTIS meetings unless a frozen spec is ambiguous.

Meetings are source history.
Specs/acceptance are execution authority.

---

## 22. Review protocol

Normal review input:
- baseline SHA;
- new SHA;
- named acceptance IDs;
- `git diff baseline..new`;
- test summary;
- migration summary if any.

Review the diff against the contract.

Expand beyond the diff only when:
- changed path crosses a domain boundary;
- regression suggests hidden coupling;
- spec itself is ambiguous;
- migration/authorization/financial invariants are at risk.

---

## 23. Reporting protocol

Keep final phase reports as engineering evidence, but compress them.

Always include:
- baseline;
- commit;
- scope;
- acceptance result;
- regressions;
- quality gates;
- migrations;
- material architecture decisions;
- risks/blockers;
- Git status;
- next allowed phase.

Do not include:
- every command executed;
- every file merely viewed;
- verbose successful logs;
- repeated copies of frozen rules.

Use report-by-exception for detail.

---

## 24. Maintenance

Update this file only when durable cross-spec context changes.

Do not append routine command history.

At phase boundaries, update:
- `Current Spec006 reconciliation`
- `Current next phase`

### Current Spec006 Reconciliation
- Approved R05 Checkpoint: `d20f955bdcf38ebe860a85be482c097cd5957c4d`
- Completed R06 Phase: UI Release Gates, Operix Brand Hygiene, Importer UX downward apply, Light/Mobile/Tablet static contracts.
- Intentional functional RED: 0
- Runtime Homologation Pending: 3 (`UI-LIGHT-MODE-01`, `UI-MOBILE-CORE-01`, `UI-TABLET-CORE-01`)
- Current Next Phase: R07 (Homologation & Release Verification per `specs/phase1-business-flow-reconciliation/r07-homologation-manifest.md`)

If this file conflicts with current approved spec/ADR, the current approved spec/ADR wins.
