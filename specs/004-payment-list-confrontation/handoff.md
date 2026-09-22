# Spec 004 — Engineering Handoff

**Status:** engineering complete; ready for Spec 005 discovery and implementation. This is not a production release or deployment authorization.

## Canonical surface

- `PaymentList` is the commercial authority; `payment_orders` is a one-way, read-only compatibility projection.
- Internal owner/admin flows use `/api/payment-lists` for list lifecycle, governed import staging, confrontation and decisions.
- `PaymentList.status = pending` is the expected-revenue basis for Spec 005; `paid` is the received-revenue basis. Spec 004 adds no financial records, expenses, cash, distribution or payout algorithm.
- The stable frontend entry point is `/payment-orders`, rendered by `PaymentListWorkspace` and the focused `payment-lists` components.

## Domain and security boundary

- Imports stage the original private document, SHA-256 provenance and reviewed rows before explicit commit; previews go through authenticated `/api/storage/presigned-download` and tenant-scoped paths.
- Claims use `reserved → consumed` or `released`; consumed claims are terminal. PostgreSQL partial uniqueness prevents active double billing.
- Confrontation is versioned by run, idempotent in `current` mode and explicit in `new_round`; decisions are addressed by `resultId` and rectification reuses the canonical Spec 003 command.
- RequestContext is authoritative for workspace and role. Ordinary technicians receive own sanitized content only; ClientAccessGrant has no commercial List authority. A personal-workspace owner retains owner authority.

## Validation evidence

- Original formal acceptance: 47/47 green, zero skipped/todo.
- Complete Spec004 suite: 127/127 green (schema, imports, claims, external WEEKLOG, confrontation/rectification, legacy transition, T10 and T11 frontend contracts).
- Specs001–003 regression: 213/213 green when serialized to avoid shared-fixture interference.
- `prisma validate`, migration status and fresh database replay are green. The replay applied all 10 migrations and `payment-list-schema.test.ts` passed on the fresh schema.
- Root/backend typechecks, lint (zero errors) and production builds are green.

## Local prerequisites and commands

Use the local PostgreSQL service exposed at `127.0.0.1:55432`, then run:

```text
npm test
npx vitest run <target suites> --maxWorkers=1
npx --prefix backend prisma validate --schema backend/prisma/schema.prisma
npx --prefix backend prisma migrate status --schema backend/prisma/schema.prisma
npm run typecheck
npm --prefix backend run typecheck
npm run lint
npm run build
npm --prefix backend run build
```

The repository-wide `npm test` runs test files in parallel. Its only observed failure in T12 was the existing Spec003 `GET-NO-WRITE-01` shared-fixture race; the affected suite and the complete Specs001–003 set pass serially.

## Legacy boundary audit

- The canonical PaymentList workspace, list APIs and services contain no direct Supabase client or legacy PaymentOrder mutation authority.
- `useExtractPaymentOrder` remains an unconsumed deprecated compatibility export. Legacy `apiFinance` consumers and the finance UI are outside the canonical Spec004 journey and their reconciliation endpoints answer `410`.
- `src/hooks/useDashboardData.ts` retains a read-only legacy direct Supabase aggregate over `payment_orders`. It is not used by `PaymentListWorkspace` and does not establish List authority, but should be retired or moved behind the canonical API in the next foundation/legacy-cleanup scope.

## Non-blocking handoff items

- `KNOWN_NON_BLOCKING_GAP: CONFRONTATION_HISTORY_READ_UI` — immutable runs are preserved in the backend, but the ordinary UI contract exposes only the latest run. No explicit formal acceptance requires browsing historical runs; a future read-only route/UI can address this.
- `REAL_DOCUMENT_VALIDATION_PENDING_CLIENT_SAMPLES` — no representative VECTIS/anonymized client document is present locally.
- `AUTHENTICATED_MANUAL_SMOKE_PENDING_ENVIRONMENT` — no safe owner/admin and technician browser fixtures were available for manual homologation.

These are homologation inputs, not evidence of completion. They must be completed before a controlled release, after Spec 005 and staging planning.
