# Spec 005 T11 Canonical Essential Finance UI Evidence

## 1. Overview & Goal
Replace the legacy, unsafe Finance user experience with the canonical Spec 005 Finance v2 UI.

T11 delivers:
- Canonical `FinancialPage` shell driven by authoritative `useWorkspace` membership capabilities.
- Per-currency `FinanceSummaryCards` presentation with separate currency groupings (Expected, Received, Expenses, Settled Obligations, Available) and negative balance support.
- Canonical `ExpensesTab`: ledger display, structured creation with safe context references, and reason-required reversal (no destructive edit/delete).
- Manual `DistributionsTab`: manual fixed/percentage allocation linked to PaymentLists and target participants (person, active workspace, client), reason-required cancellation, zero-cash terminology, and removal of automatic ProfitRule workflows.
- `ObligationsTab`: derived lifecycle from active distributions, strict full cash-out settlement dialog, and reason-required payment reversal.
- Specialized `TechnicianFinanceView`: own-scope "Meus Repasses & Pagamentos" view for linked technicians (no summary or expenses queries fired, mutation controls omitted).
- Personal workspace owner preservation: users with technician global identity who own/administer their personal workspace retain the full owner Finance UI.
- Client access denial: clients/client-collaborators receive explicit access denial UX rather than false zero summaries.
- Double-submit prevention via button locking and immutable command envelopes.
- Complete removal of legacy financial authority (`apiFinance.ts`, `useFinancialAudit.ts`, `/financial-records`, `/finance/summary`, `/finance/reconciliations`, `ProfitRule`, Supabase financial mutations) from active Finance screens.
- Zero backend product changes.

---

## 2. Information Architecture & Boundaries

### 2.1 Final Navigation & Tab Structure (Owner / Admin / Personal Owner)
1. **Overview**: Distinct per-currency financial summaries (`useFinanceSummary`).
2. **Despesas (Expenses)**: Workspace expense ledger, category grouping, context linkage, creation & reversal (`useExpenses`, `useCreateExpense`, `useReverseExpense`).
3. **Distribuições (Distributions)**: Manual allocation against PaymentLists, fixed/percentage mode, cancellation (`useDistributions`, `useCreateDistribution`, `useCancelDistribution`).
4. **Obrigações (Obligations)**: Entitlements derived from distributions, full settlement execution, payment reversal (`useObligations`, `useCreateObligation`, `useCancelObligation`, `useSettleObligation`, `useReverseObligationPayment`).

### 2.2 Linked Technician View
- Header: "Meus Repasses & Pagamentos"
- Tab 1: **Minhas Distribuições** (`useDistributions` - server-filtered to own participant scope)
- Tab 2: **Minhas Obrigações** (`useObligations` - server-filtered to own participant scope)
- Omissions: No Summary query, no Expenses query, no creation/settlement/cancellation mutation buttons.

### 2.3 Boundaries Enforced
- **Commercial Confrontation**: Remains exclusively within `PaymentListDetail` / Operations (`Spec 004`). `FusaoManualTab`, `PendentesTab`, and `HistoricoTab` are removed from the Finance page.
- **SaaS Billing & Stripe**: Kept strictly in existing subscription/billing routes.
- **Automatic Profit Rules**: Legacy percentage automation and template execution removed from active UI; allocations are strictly manual.

---

## 3. Authorization Visibility Matrix

| Actor / Context | Summary Cards | Expenses Ledger & Actions | Manual Distributions | Obligations Lifecycle | Settlement & Payment Reversal |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Workspace Owner / Admin** | Full (Per Currency) | View, Create, Reverse | View All, Create, Cancel | View All, Create, Cancel | Settle (Full), Reverse Payment |
| **Personal Workspace Owner** *(Technician global role, Owner membership)* | Full (Per Currency) | View, Create, Reverse | View All, Create, Cancel | View All, Create, Cancel | Settle (Full), Reverse Payment |
| **Linked Company Technician** | Hidden (No Query) | Hidden (No Query) | View Own Only | View Own Only | Hidden (Read-Only Status) |
| **Client / Client Collaborator** | Access Denied | Access Denied | Access Denied | Access Denied | Access Denied |

---

## 4. PaymentListDetail.tsx Change Classification
- **Diff**: Addition of type import `PaymentListTransitionStatus` and explicit cast `action.toStatus as PaymentListTransitionStatus` in `src/components/payment-lists/PaymentListDetail.tsx`.
- **Classification**: `TYPE_ALIGNMENT_ONLY` (Strictly non-behavioral TypeScript type alignment).
- **Invariants Preserved**: Does not alter PaymentList transitions, confrontation decisions, recognized totals, claims, pending/paid semantics, or technician visibility.

---

## 5. Mutation Safety & Money Handling

1. **Strict String Transport for Money**:
   - `amount` values in forms are maintained and validated as raw decimal strings (`"0.10"`, `"1500.50"`).
   - No floating-point arithmetic or conversion to floats occurs before constructing command payloads.
2. **Stable Command Envelopes & Idempotency**:
   - Mutation dialogs generate an idempotency key upon opening / user preparation.
   - Retries of the same command envelope preserve the original `idempotencyKey`.
   - Form buttons are locked/disabled while mutations are in flight (`isPending`).
3. **Reversal-Only Semantics**:
   - Effective Expenses cannot be edited or deleted; they can only be reversed with an audit reason.
   - Settled Obligations cannot be deleted or reopened; payments can only be reversed with an audit reason, moving the obligation to a terminal `REVERSED` state.
4. **No Optimistic Cash Updates**:
   - Cash states and totals update exclusively following server response and TanStack Query cache invalidation (`financeQueryKeys.all(workspaceId)`).

---

## 6. Verification & Test Evidence

### 6.1 T11 Focused UI Component & Contract Tests
- Test File: `tests/unit/finance-ui-contracts.test.tsx`
- Results: **10/10 PASS**
  - `renders distinct currency buckets without combining them into a grand total`
  - `displays negative available amounts clearly without clamping to zero`
  - `renders full finance UI for personal workspace owner even with technician identity`
  - `renders technician own-scope view without summary expenses or mutation controls`
  - `denies access for clients without rendering fake zero values`
  - `preserves exact decimal string in expense creation payload`
  - `requires a reason for expense reversal and invokes reverse mutation`
  - `allows manual distribution creation with fixed or percentage mode`
  - `renders correct obligation action controls per lifecycle state`
  - `verifies static source code does not contain legacy financial authority`

### 6.2 Frontend Suite & Quality Gates
- T10 Client Contracts (`tests/unit/finance-v2-client-contracts.test.ts`): **11/11 PASS**
- All Unit Suites in `tests/unit/` (5 test files): **62/62 PASS**
- `npm run typecheck`: **PASS** (0 errors)
- `npm run lint`: **0 errors, 1 known unrelated warning** (`ProductionBoard.tsx`)
- `npm run build`: **PASS** (Vite production bundle generated successfully in 58.39s)

### 6.3 Prior Specifications Consolidated Baseline (Specs 001–004)

| Spec | Canonical Test Inventory | Expected Count | Executed Count | Status | Notes |
|---|---|---|---|---|---|
| **Spec 001** | `foundation-security.test.ts`, `tenant-isolation.test.ts` | 17 | 17 | **17/17 PASS** | Foundation security & tenant boundaries |
| **Spec 002** | `budget-production-flow.test.ts` | 59 | 59 | **59/59 PASS** | Budget revision & production order lineage |
| **Spec 003** | `weeklog-operational-flow.test.ts`, `service-orders-legacy-sanitization.test.ts`, `tests/unit/weeklog-frontend-contracts.test.ts` | 137 | 137 | **137/137 PASS** | Weeklog lifecycle & legacy sanitization |
| **Spec 004** | `payment-list-schema.test.ts`, `payment-list-invariants.test.ts`, `payment-list-import.test.ts`, `commercial-confrontation.test.ts`, `external-weeklog-import.test.ts`, `legacy-payment-order-transition.test.ts`, `tests/unit/payment-list-frontend-contracts.test.ts`, `tests/unit/payment-list-ui-contracts.test.ts` | 127 | 127 | **127/127 PASS** | Commercial reconciliation & confrontation |
| **Total Baseline** | **13 files** | **340** | **340** | **340/340 PASS** | Complete historical baseline verified |

*Reconciliation Note*: The previous mention of 299 tests reflected running `tests/integration/` without the 3 unit contract files in `tests/unit/` (`weeklog-frontend-contracts.test.ts` [21], `payment-list-frontend-contracts.test.ts` [10], `payment-list-ui-contracts.test.ts` [10]). Consolidated execution across all canonical files confirms 299 + 41 = **340/340 PASS**.

### 6.4 Spec 005 Backend Regressions & Normative Suite
- Spec 005 Normative Suite (`tests/integration/essential-finance-red-baseline.test.ts`): **33/33 GREEN**
- T09 Legacy Transition Suite (`tests/integration/essential-finance-legacy-transition.test.ts`): **5/5 PASS**
- T08 Obligations & Settlement Suite (`tests/integration/essential-finance-obligations.test.ts`): **7/7 PASS**
- T07 Manual Distributions Suite (`tests/integration/essential-finance-distributions.test.ts`): **7/7 PASS**
- T06 Expenses Ledger Suite (`tests/integration/essential-finance-expenses.test.ts`): **7/7 PASS**
- T05 Summary Projections Suite (`tests/integration/essential-finance-summary.test.ts`): **8/8 PASS**
- Schema Constraints Suite (`tests/integration/essential-finance-schema.test.ts`): **7/7 PASS**

### 6.5 Full Repository Serial Aggregate
- Command: `npx vitest run --fileParallelism=false`
- Total Test Files: **27 passed (27)**
- Total Tests: **454 passed (454)**
- Passes: **454** | Failures: **0** | Errors: **0** | Skip: **0** | Todo: **0**

### 6.6 Backend Quality, Schema & Migration Status
- Backend Typecheck (`npm --prefix backend run typecheck`): **PASS** (0 errors)
- Backend Build (`npm --prefix backend run build`): **PASS** (0 errors)
- Prisma Schema Validation (`prisma validate`): **PASS** (Schema is valid 🚀)
- Prisma Migration Status (`prisma migrate status`): **11 migrations found; database schema is up to date**
- Schema / Migrations Diff Guard (`git diff 46afcf20..HEAD -- backend/prisma`): **Empty (0 diff)**

---

## 7. Source Audit & Legacy Authority Removal

Static and dynamic source audit confirmed zero references in active Finance screens to:
- `apiFinance.ts`
- `useFinancialAudit.ts`
- `/financial-records`
- `/finance/summary` (v1)
- `/finance/reconciliations`
- `ProfitRule` engine
- Direct Supabase financial table writes
