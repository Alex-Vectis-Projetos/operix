# Spec005 findings

| ID | Severity | Evidence | Impact | Treatment |
|---|---|---|---|---|
| FIN-F01 | P0 | `FinancialRecord.workspaceId` is nullable; `/financial-records` uses supplied `workspace_id`, lists without RequestContext and deletes by ID/filter | cross-tenant read/write, IDOR and hard delete | LEGACY_ARCHIVE; replace only with scoped canonical commands |
| FIN-F02 | P0 | `FinancialRecord.amount`, distributions, reconciliation and snapshots are Prisma `Float`; route/UI use `Number`, `parseFloat`, `toFixed` | rounding and inconsistent money | Decimal canonical values; legacy projection only |
| FIN-F03 | P0 | `/finance/summary` sums `ServiceOrder`/`PaymentOrder`; routes include broad global queries | wrong Expected/Received and tenant leakage | replace by PaymentList-derived FinanceSummary |
| FIN-F04 | P0 | legacy reconciliation routes perform global delete/reset; only duplicate routes are 410 | destructive legacy commercial authority remains callable | deprecate/deny legacy paths; keep canonical confrontation untouched |
| FIN-F05 | P1 | ProfitRule/ServiceOrderDistribution have no workspace FK, loose names, Float percentage/value | manual allocation lacks identity/audit safety | archive; new Distribution references canonical participant and List |
| FIN-F06 | P1 | FinancialEvent/Integrity models have nullable workspace and Float snapshots | audit projections cannot be authority | archive/read-only evidence; no reverse sync |
| FIN-F07 | P1 | FinancialPage mixes confronto, profit rules, accounting, legacy API and Supabase-era hooks | unsafe UI/API authority | reuse visual shell only; replace data contracts/hook |
| FIN-F08 | P1 | `useDashboardData` sums service orders directly | dashboard residue conflicts with FinanceSummary | replace when canonical summary ships |
| FIN-F09 | P1 | PaymentList has explicit ISO currency; legacy money formatting hardcodes `€` | currency mixing/default risk | summaries per currency, no implicit default/FX |
| FIN-F10 | P1 | no immutable expected-status projection identified | historical Expected cannot be reconstructed after paid transition | OPEN-002 before period reporting |

### Asset classification

| Asset | Current purpose/consumers | Authority/safety | Classification |
|---|---|---|---|
| FinancialRecord + route + `apiFinance` | generic income/expense UI | nullable tenant, Float, client fields, hard/bulk delete | LEGACY_ARCHIVE/DEPRECATE |
| FinancialEvent/Integrity | legacy audit/integrity tabs | nullable tenant, Float aggregate snapshots | LEGACY_ARCHIVE |
| ProfitRule + UI | saved percentage templates | automatic-rule shape, global groups/names | DEPRECATE; visual ideas only |
| ServiceOrderDistribution | calculated legacy OP split | no tenant/List/participant FK, Float | LEGACY_ARCHIVE |
| Reconciliation + confrontation UI | former matching flow | commercial authority retired by Spec004; duplicate active legacy handlers | DEPRECATE/REMOVE |
| Billing/Stripe/invoice modules | SaaS/invoice surface | separate product boundary | OUT_OF_SCOPE |
| FinancialPage/components | tabbed legacy presentation | visuals reusable, contracts unsafe | ADAPT |

Historical legacy rows: tenant-explicit and Decimal-convertible rows are deterministically migratable only after dry run; missing tenant = GLOBAL/NO-TENANT, ambiguous references = AMBIGUOUS, malformed Float/source rows = ARCHIVE ONLY. Never infer workspace heuristically.
