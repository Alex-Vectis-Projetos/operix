# T10 Canonical Finance v2 Frontend Data Layer Evidence

## 1. Executive Summary & Goals

T10 implements the typed frontend data-access layer for canonical Finance v2 (`/api/finance/v2`), providing:
- Strongly typed HTTP client (`src/lib/apiFinanceV2.ts`);
- Authoritative DTO interfaces directly derived from backend canonical routes and domain services;
- TanStack Query hooks with workspace-partitioned query keys (`src/hooks/useFinance.ts`);
- Stable idempotency-key handling that survives mutation retries without UUID regeneration;
- Strict Decimal-string preservation throughout transport and DTOs;
- Explicit ISO currency separation (no default currency, no FX, no grand total reduction);
- Canonical error propagation (`ApiError` preserving 401, 403, 404, 409, 422);
- Explicit cache invalidation matrix following domain cash effects;
- Contract/unit test coverage (`tests/unit/finance-v2-client-contracts.test.ts` — 11/11 PASS);
- Pure frontend diff against the approved T09 baseline (`ccf9ce63`);
- Zero backend modifications and zero UI regressions.

---

## 2. Frontend Architecture Reused & X-Workspace-Id Semantics

The Finance v2 data layer integrates directly with Operix Core frontend conventions:
1. **HTTP / Request Infrastructure**: Reuses `src/lib/api.ts` (`apiRequest<T>`), which attaches the authenticated JWT Bearer token (`getAccessToken()`) and operational context header (`X-Workspace-Id`), timeout management, and `ApiError` normalization.
2. **X-Workspace-Id / RequestContext Authority Semantics**:
   - `X-Workspace-Id` is transmitted as the normal foundation mechanism for selecting the caller's active operational workspace context.
   - It is **NOT** trusted by itself as server-side authority: `RequestContext` middleware validates active membership, role, and workspace existence.
   - Client-supplied query/body parameters (`?workspaceId=...`, `?workspace_id=...`, `{ workspaceId: ... }`) are completely forbidden for Finance v2 (the router explicitly strips query selectors before routing).
   - **No Client-Supplied Workspace Bypass of RequestContext Authority**: Active workspace context is resolved and validated strictly on the server.
3. **Operational Workspace Scope**: Reuses `src/hooks/useWorkspace.tsx` (`useWorkspace()`) for active `workspaceId` cache partition keys.
4. **Query Management**: Leverages `@tanstack/react-query` v5 (`useQuery`, `useMutation`, `useQueryClient`).

---

## 3. Canonical DTO Inventory & Endpoints

### 3.1. Summary Surface (`GET /api/finance/v2/summary`)
- `FinanceCurrencySummary`:
  - `currencyCode: string`
  - `expected: string` (Decimal string)
  - `received: string` (Decimal string)
  - `expenses: string` (Decimal string)
  - `settledObligationPayments: string` (Decimal string)
  - `available: string` (Decimal string)
- `FinanceSummaryResponse`: `{ currencies: FinanceCurrencySummary[] }`

### 3.2. Expenses Surface (`/api/finance/v2/expenses`)
- `Expense`:
  - `id: string`
  - `amount: string`
  - `currencyCode: string`
  - `category: string`
  - `occurredOn: string` (YYYY-MM-DD)
  - `description: string | null`
  - `status: "effective" | "reversed"`
  - `context: ExpenseContext | null` (`payment_list` | `production_order` | `technician_person` | `client` | `document`)
  - `createdAt: string`, `createdByUserId: string`
  - `reversedAt: string | null`, `reversedByUserId: string | null`, `reversalReason: string | null`
- Inputs & Responses:
  - `CreateExpenseInput`: `{ amount, currencyCode, category, occurredOn, description?, context? }`
  - `ReverseExpenseInput`: `{ reason }`
  - `ExpenseMutationResponse`: `Expense & { idempotent: boolean }`
  - `ExpenseListResponse`: `{ items: Expense[] }`

### 3.3. Distributions Surface (`/api/finance/v2/distributions`)
- `Distribution`:
  - `id: string`
  - `paymentListId: string`
  - `paymentListItemId: string | null`
  - `participant: DistributionParticipant` (`person` | `workspace` | `client`)
  - `allocation: DistributionAllocation` (`fixed` with `amount` | `percentage` with `percentage`)
  - `resolvedAmount: string`
  - `currencyCode: string`
  - `status: "active" | "cancelled"`
  - `createdAt: string`, `createdByUserId: string`
  - `cancelledAt: string | null`, `cancelledByUserId: string | null`, `cancellationReason: string | null`
- Inputs & Responses:
  - `CreateDistributionInput`: `{ paymentListId, paymentListItemId?, participant, allocation }`
  - `CancelDistributionInput`: `{ reason }`
  - `DistributionMutationResponse`: `Distribution & { idempotent: boolean }`
  - `DistributionListResponse`: `{ items: Distribution[] }`

### 3.4. Financial Obligations & Settlement (`/api/finance/v2/obligations`)
- `FinancialObligation`:
  - `id: string`, `distributionId: string`, `distribution: Distribution`
  - `amount: string`, `currencyCode: string`
  - `status: "pending" | "paid" | "cancelled" | "reversed"`
  - `createdAt: string`, `createdByUserId: string`
  - `paidAt: string | null`, `paidByUserId: string | null`
  - `cancelledAt: string | null`, `cancelledByUserId: string | null`, `cancellationReason: string | null`
  - `reversedAt: string | null`, `reversedByUserId: string | null`, `reversalReason: string | null`
  - `payment: ObligationPayment | null`
- `ObligationPayment`:
  - `id: string`, `obligationId: string`, `amount: string`, `currencyCode: string`
  - `status: "effective" | "reversed"`
  - `paidAt: string`, `paidByUserId: string`
  - `reversedAt: string | null`, `reversedByUserId: string | null`, `reversalReason: string | null`
- Inputs & Responses:
  - `CreateObligationInput`: `{ distributionId }`
  - `CancelObligationInput`: `{ reason }`
  - `ReverseObligationPaymentInput`: `{ reason }`
  - `ObligationMutationResponse`: `FinancialObligation & { idempotent: boolean }`
  - `ObligationListResponse`: `{ items: FinancialObligation[] }`

---

## 4. Query Key Hierarchy & Cache Safety

All query keys incorporate the active workspace ID to prevent cross-workspace data leakage during tenant context switching:

```ts
export const financeQueryKeys = {
  all: (workspaceId?: string | null) => ["finance", workspaceId ?? "none"] as const,
  summary: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "summary"] as const,
  expenses: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "expenses"] as const,
  expenseList: (workspaceId?: string | null) => [...financeQueryKeys.expenses(workspaceId), "list"] as const,
  expenseDetail: (workspaceId?: string | null, expenseId?: string | null) =>
    [...financeQueryKeys.expenses(workspaceId), "detail", expenseId ?? "none"] as const,
  distributions: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "distributions"] as const,
  distributionList: (workspaceId?: string | null) => [...financeQueryKeys.distributions(workspaceId), "list"] as const,
  distributionDetail: (workspaceId?: string | null, distributionId?: string | null) =>
    [...financeQueryKeys.distributions(workspaceId), "detail", distributionId ?? "none"] as const,
  obligations: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "obligations"] as const,
  obligationList: (workspaceId?: string | null) => [...financeQueryKeys.obligations(workspaceId), "list"] as const,
  obligationDetail: (workspaceId?: string | null, obligationId?: string | null) =>
    [...financeQueryKeys.obligations(workspaceId), "detail", obligationId ?? "none"] as const,
};
```

---

## 5. Idempotency & Command Envelope Design

To ensure TanStack mutation retries do not generate new idempotency keys on every attempt:
1. `prepareCommand(input, key?)` packages the input and a stable `Idempotency-Key` before mutation execution.
2. Mutation variables retain the key across network retries.
3. Outgoing requests attach the exact `Idempotency-Key` HTTP header.

```ts
export interface CommandEnvelope<TInput> {
  input: TInput;
  idempotencyKey: string;
}

export function prepareCommand<TInput>(input: TInput, idempotencyKey?: string): CommandEnvelope<TInput> {
  return {
    input,
    idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
  };
}
```

---

## 6. Cache Invalidation Matrix

| Mutation | Direct Target Invalidated | Related Queries Invalidated | Cash Effect Summary Invalidation |
|---|---|---|---|
| `useCreateExpense` | `financeQueryKeys.expenseList(ws)` | None | `financeQueryKeys.summary(ws)` |
| `useReverseExpense` | `financeQueryKeys.expenseDetail(ws, id)`, `expenseList(ws)` | None | `financeQueryKeys.summary(ws)` |
| `useCreateDistribution` | `financeQueryKeys.distributionList(ws)` | None | **None** (zero cash effect) |
| `useCancelDistribution` | `financeQueryKeys.distributionDetail(ws, id)`, `distributionList(ws)` | None | **None** (zero cash effect) |
| `useCreateObligation` | `financeQueryKeys.obligationList(ws)` | `financeQueryKeys.distributions(ws)` | **None** (pending obligation has no cash effect) |
| `useCancelObligation` | `financeQueryKeys.obligationDetail(ws, id)`, `obligationList(ws)` | `financeQueryKeys.distributions(ws)` | **None** (cancelling pending has no cash effect) |
| `useSettleObligation` | `financeQueryKeys.obligationDetail(ws, id)`, `obligationList(ws)` | None | `financeQueryKeys.summary(ws)` (real cash out) |
| `useReverseObligationPayment` | `financeQueryKeys.obligationDetail(ws, id)`, `obligationList(ws)` | None | `financeQueryKeys.summary(ws)` (cash restored) |

---

## 7. Authorization Data Behavior

1. **Owner / Admin**: Full read and mutation access to all queries and mutations.
2. **Personal Workspace Owner**: Retains full owner authority in their personal workspace regardless of global platform roles.
3. **Linked Technician**:
   - `summary` query returns 403 (handled gracefully as forbidden without failing independent queries);
   - `expenses` query returns 403;
   - `distributions` query returns 200 with participant-scoped rows (`participant_person_id = technicianPersonId`);
   - `obligations` query returns 200 with participant-scoped rows.
4. **Client**: Internal finance endpoints return 403; client cannot inspect internal ledgers or distributions.

---

## 8. Consumer Inventory & T11 Migration Map

| Legacy Consumer | Old Endpoint / Source | New T10 Hook / Client | T11 UI Action Needed |
|---|---|---|---|
| `FinancialPage.tsx` | `/api/financial-records`, `/api/finance/summary` | `useFinanceSummary`, `useExpenses` | Migrate dashboard cards and expense grid to V2 data layer |
| `ProfitDistribution.tsx` | `/api/finance/profit-rules`, `/api/finance/reconciliations` | `useDistributions`, `useObligations` | Replace legacy profit engine with manual distribution and obligation settlement cards |
| `useFinancialAudit.ts` | `/api/financial-records` | `useExpenses`, `useFinanceSummary` | Point audit viewer to canonical audit fields |
| `PaymentOrdersPage.tsx` | `/api/payment-orders` | Retained as read-only compatibility / Spec 004 PaymentList | Keep read-only compatibility view; no writes |

---

## 9. Verification & Quality Gates

### 9.1. T10 Unit / Contract Suite
- `tests/unit/finance-v2-client-contracts.test.ts`: **11/11 PASS**
- All unit suites in `tests/unit/`: **52/52 PASS**

### 9.2. Spec 005 Backend Regressions
- Normative acceptance (`essential-finance-red-baseline.test.ts`): **33/33 GREEN**
- T08 Obligations (`essential-finance-obligations.test.ts`): **7/7 PASS**
- T07 Distributions (`essential-finance-distributions.test.ts`): **7/7 PASS**
- T06 Expenses (`essential-finance-expenses.test.ts`): **7/7 PASS**
- T05 Summary (`essential-finance-summary.test.ts`): **8/8 PASS**
- T09 Legacy Transition (`essential-finance-legacy-transition.test.ts`): **5/5 PASS**
- Schema (`essential-finance-schema.test.ts`): **7/7 PASS**

### 9.3. Consolidated Specs 001–004 Suite
- Consolidated aggregate: **340/340 PASS**

### 9.4. Static Analysis & Build Gates
- Frontend build (`npm run build`): **PASS** (5349 modules transformed, 0 errors)
- Frontend lint (`npm run lint`): **0 errors** (1 known unrelated `ProductionBoard` warning)
- Backend typecheck (`npm run typecheck` in backend): **PASS** (0 errors)
- Backend build (`npm run build` in backend): **PASS** (0 errors)
- Prisma validation (`prisma validate`): **PASS** (Schema is valid)
