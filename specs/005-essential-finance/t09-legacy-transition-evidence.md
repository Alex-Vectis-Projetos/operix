# Spec 005 T09 Legacy Transition Evidence

## Legacy Asset Matrix
| Asset | Routes | Current Reads | Current Writes | Tenant Model | Money Type | Current Frontend Consumers | Canonical Replacement | T09 Action |
|-------|--------|---------------|----------------|--------------|------------|----------------------------|-----------------------|------------|
| FinancialRecord | GET, POST, PATCH, DELETE, POST /delete-by | GET /financial-records, GET /summary | POST, PATCH, DELETE | Optional workspaceId | Float | ModulePages, useAccountingModules | Expense / PaymentList | DEPRECATE_ALL_410 |
| Reconciliation | GET, POST, PATCH, /run, /manual-merge | GET /reconciliations | POST, PATCH, /run, /manual-merge | None | Float | useReconciliation | PaymentList Confrontation | DEPRECATE_ALL_410 |
| ProfitRule | GET, POST, DELETE | GET /profit-rules | POST, DELETE | None | Percentage | (None specific) | Distribution | DEPRECATE_ALL_410 |
| ServiceOrderDistribution | (via ProfitRule) | /aggregation-source | (via ProfitRule) | via SO | Float | (None specific) | Distribution | LEGACY_ARCHIVE |
| Legacy Summary | GET /summary | GET /summary | N/A | Mixed/None | Float/EUR | useDashboardData | FinanceSummary | DEPRECATE_ALL_410 |
| PaymentOrder | GET, POST, PATCH, DELETE | GET /payment-orders | (Already deprecated) | workspaceId | Float | usePaymentOrders | PaymentList | KEEP_READ_ONLY_COMPAT |

## Frontend Consumer Inventory
Frontend consumers found during inventory (no changes made):
- \`src/pages/ModulePages.tsx\`
- \`src/hooks/useDashboardData.ts\`
- \`src/components/accounting/useAccountingModules.ts\`
- etc.
These will be migrated in T10/T11.

## Retired Write Surfaces
- \`POST /api/financial-records\`
- \`PATCH /api/financial-records/:id\`
- \`DELETE /api/financial-records/:id\`
- \`POST /api/financial-records/delete-by\`
- \`POST /api/finance/reconciliations\`
- \`PATCH /api/finance/reconciliations/:id\`
- \`POST /api/finance/reconciliations/manual-merge\`
- \`POST /api/finance/reconciliations/run\`
- \`POST /api/finance/profit-rules\`
- \`DELETE /api/finance/profit-rules/:id\`
- \`DELETE /api/finance/profit-rules\`
- \`POST /api/finance/confrontation/merge\`
- \`POST /api/finance/confrontation/reject\`
- \`POST /api/finance/confrontation/validate\`

## Dry-Run Classifier
A CLI script was created at \`backend/scripts/classifyLegacyFinance.ts\`.
It executes completely read-only in \`dry-run\` mode.
The script categorizes legacy finance records into deterministically defined categories (\`DETERMINISTIC_CANDIDATE\`, \`GLOBAL_NO_TENANT\`, \`AMBIGUOUS\`, \`ARCHIVE_ONLY\`, \`UNSUPPORTED_SEMANTICS\`).
It avoids assuming \`EUR\` and does not guess \`workspaceId\`.
Legacy Income is mapped strictly to \`ARCHIVE_ONLY\` because it must not become canonical Received.

## Legacy Income Non-Migration
Legacy Income rows in \`FinancialRecord\` are strictly classified as \`ARCHIVE_ONLY\`.

## One-Way Compatibility & No Reverse Sync
- Canonical writes (Expense, Distribution, Obligation) do not reverse sync to legacy \`FinancialRecord\`, \`ProfitRule\`, or \`Reconciliation\`.
- PaymentOrder downstream boundary read-only projection remains untouched for client compatibility.

## Quality
- Typecheck is GREEN.
- Tests (essential-finance-legacy-transition.test.ts) pass verifying the 410 Deprecated behaviors and DB state preservation.
