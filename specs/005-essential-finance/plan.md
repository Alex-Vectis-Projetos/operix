# Vertical plan

* T00 — discovery/ADR/traceability; no product diff.
* T01/T02 — write acceptance RED and RequestContext/object-authorization security baseline against DEC-016 concrete HTTP contract.
* T03/T04 — Decimal canonical schema and forward-only migration, after T01/T02 approval and the frozen DEC-009–015 architecture.
* T05 — PaymentList-derived Expected/Received/FinanceSummary, per currency.
* T06 — Expenses with audit, linkage and reversal semantics.
* T07 — manual Distribution; no automatic rules.
* T08 — full obligations and distinct settlement, reversal, idempotency/concurrency.
* T09 — legacy transition, dry-run data classification and one-way compatibility only.
* T10 — typed frontend API client/hooks.
* T11 — canonical finance UI, leaving billing SaaS and commercial confrontation out.
* T12 — quality, security, migration rehearsal, handoff and homologation.

Release gates preserve Spec004: PaymentList confrontation/claims/rectification/pending-paid lifecycle unchanged, zero reverse finance mutation, and PaymentOrder non-authoritative. Homologation needs VECTIS samples, authenticated owner/admin and technician smoke, staging and rollback/runbook. The known parallel `GET-NO-WRITE-01` PostgreSQL fixture race is test-harness debt, not T00 product work.
