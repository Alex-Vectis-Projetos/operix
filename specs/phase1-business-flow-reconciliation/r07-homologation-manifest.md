# R07 Homologation Manifest — Phase 1 End-to-End Release Gates

This document defines the exact checklist and browser test flows required for R07 staging/production homologation.
Per AGENTS.md, R06 prepares these release gates; final runtime execution and certification occurs strictly in R07.

## Required Browser Flows

| Flow ID | Scenario / Verification Scope | Expected Runtime Behavior | Acceptance Reference |
|---------|--------------------------------|---------------------------|----------------------|
| **FLOW-01** | **Login & Workspace Selection** | Authenticate via email/password, select tenant workspace, verify RequestContext isolation and JWT issuance. | SEC-AUTH-MULTI-01, TENANT-ISOLATION |
| **FLOW-02** | **Client Collaborator Authorization** | Authenticate as client collaborator with capability token; confirm access to client portal and strict 403 on internal finance routes. | AUTHZ-CLIENT-RESTRICTED-01 |
| **FLOW-03** | **Budget Create -> Client Approval** | Create vehicle budget/estimate, transition to pending approval, client approves via portal/signature link. | BUD-APPROVE-MUT-01 |
| **FLOW-04** | **Direct ProductionOrder** | Create operational production order directly (without budget parent), verify serial, site assignment, and lineage. | PROD-CREATE-DIRECT-01 |
| **FLOW-05** | **Production Finalization** | Mark repair tasks complete, technicians assigned, quality inspection checklist completed, order marked finalized. | PROD-ORDER-FINAL-01 |
| **FLOW-06** | **WEEKLOG Weekly Flow** | Operational week Sunday 00:00 to Saturday 23:59:59.999 UTC; view technician timesheets, repair units, and operational coverage. | WEEKLOG-CUTOFF-UTC-01 |
| **FLOW-07** | **Client Validation & Signature** | Submit WEEKLOG validation round, client reviews immutable coverage snapshot, submits digital signature/approval. | WEEKLOG-VAL-ROUND-01 |
| **FLOW-08** | **Auto PaymentList Generation** | Automatically materialize commercial PaymentList from validated WEEKLOG claims; verify non-duplication of operational items. | LIST-MATERIALIZE-AUTO-01 |
| **FLOW-09** | **Manual/External List Confrontation** | Upload external commercial claim list, perform confrontation against operational records, detect discrepancies. | CONF-MATCH-CONFRONT-01 |
| **FLOW-10** | **Ready for Billing Transition** | Reconcile discrepancies, approve commercial list, transition status to `ready_for_billing`. | LIST-READY-BILLING-01 |
| **FLOW-11** | **Invoice Create & Associate** | From PaymentList in `ready_for_billing`, issue new BillingInvoice or associate existing invoice; verify atomic transition to `pending`. | LIST-INVOICE-HANDOFF-01 |
| **FLOW-12** | **Invoice Client View & PDF** | Client views invoice via `invoice.view` capability, verifies PDF rendering, tax breakdowns, and payment coordinates. | BILLING-INVOICE-VIEW-01 |
| **FLOW-13** | **Pending -> Finance Expected** | Verify that `pending` invoices contribute strictly to Expected Revenue in workspace currency without cross-FX pollution. | FIN-EXPECTED-ACC-01 |
| **FLOW-14** | **Paid -> Finance Received** | Record payment settlement on invoice; confirm invoice moves to `paid`, disappears from Expected, and is recognized in Received. | FIN-RECEIVED-ACC-01 |
| **FLOW-15** | **Expense & Available Smoke** | Record operational expenses and settled obligation payments; verify Available = Received - Expenses - Settled Obligations. | FIN-AVAILABLE-CALC-01 |
| **FLOW-16** | **Light Mode Runtime Contrast** | Verify full application shell, dialogs, tables, and form controls in Light Mode; ensure WCAG AA contrast and zero text washouts. | UI-LIGHT-MODE-01 |
| **FLOW-17** | **Mobile Viewport (<= 430px)** | Verify Budget, Production, WEEKLOG, PaymentList, and Finance on mobile viewport (<= 430px); ensure no horizontal clipping or touch overlap. | UI-MOBILE-CORE-01 |
| **FLOW-18** | **Tablet Viewport (768px - 1024px)** | Verify responsive grid layouts, sidebar drawer toggles, and confrontation tables on tablet viewport (768px–1024px). | UI-TABLET-CORE-01 |
| **FLOW-19** | **Importer Document Review** | Upload multi-row operational document; verify document viewer zoom/rotation, edit row drafts, test bulk downward apply, commit list. | IMPORT-UX-CONTRACT-01 |
| **FLOW-20** | **Branding & Navigation Hygiene** | Verify zero residual "Nexus" or "WorkNexus" strings across all active pages, document titles, logos, and confirm automation nav is hidden. | UI-BRAND-OPERIX-01, UI-AUTOMATION-HIDDEN-01 |

## R07 Certification Rules
1. Every flow must be executed in real browser (Chromium/WebKit) against a live homologation environment.
2. No mocked APIs or synthetic local storage may be used during homologation.
3. Upon completion of all 20 flows without error, update acceptance status for UI-LIGHT-MODE-01, UI-MOBILE-CORE-01, and UI-TABLET-CORE-01 to full GREEN.
