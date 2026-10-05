import { useFinanceSummary } from "@/hooks/useFinance";
import { formatFinanceMoney } from "@/lib/financeFormatters";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowDownRight, ArrowUpRight, Wallet, ArrowRight, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * RevenueChart — Canonical Dashboard Financial Overview.
 *
 * Backed strictly by PostgreSQL /api/finance-v2/summary authority.
 * Invariants:
 * - Zero Supabase queries
 * - Zero unbacked client-side mathematical assumptions
 * - Hidden gracefully when user has no financial viewing authority
 */
export function RevenueChart() {
  const navigate = useNavigate();
  const { myRole, isAdmin: wsIsAdmin, ownerAppUserId } = useWorkspace();
  const { role: displayRole, isAdmin: roleIsAdmin, isOwner: roleIsOwner } = useRole();
  const { user } = useAuth();

  const isPersonalOwner = Boolean(
    ownerAppUserId && (user?.id === ownerAppUserId || (user as any)?.app_user_id === ownerAppUserId)
  );
  const isFullManager = wsIsAdmin || roleIsAdmin || roleIsOwner || isPersonalOwner || myRole === "admin";
  const isClient = myRole === "cliente" || displayRole === "cliente";

  // Clients and unauthorized technicians do not see internal financial balance
  if (isClient || !isFullManager) {
    return null;
  }

  return <RevenueChartContent onNavigate={() => navigate("/financial")} />;
}

function RevenueChartContent({ onNavigate }: { onNavigate: () => void }) {
  const { data: summary, isLoading, error } = useFinanceSummary();

  if (isLoading) {
    return <Skeleton className="h-[280px] rounded-xl" />;
  }

  if (error || !summary) {
    return null;
  }

  const currencies = summary.currencies || [];

  if (currencies.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-5 animate-fade-in flex flex-col justify-between h-[280px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Resumo Financeiro Canónico</h3>
          </div>
          <Badge variant="outline" className="text-xs">PostgreSQL Finance V2</Badge>
        </div>
        <div className="flex flex-col items-center justify-center text-center py-6">
          <p className="text-xs text-muted-foreground">Sem movimentação financeira registrada no workspace.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onNavigate} className="text-xs self-end">
          Aceder a Finanças <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const primary = currencies[0];
  const isNegative = primary.available.startsWith("-");

  return (
    <div className="glass-panel rounded-xl p-5 animate-fade-in flex flex-col justify-between min-h-[280px]" data-testid="dashboard-revenue-overview">
      <div>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Resumo Financeiro Canónico</h3>
              <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                {primary.currencyCode}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Consolidação de Listas de Pagamento e Despesas Efetivas
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onNavigate} className="text-xs h-7 gap-1">
            <span>Ver Detalhes</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Essential Finance Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-card/60 border border-border/50 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Recebido</span>
              <ArrowDownRight className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="text-base font-bold text-foreground">
              {formatFinanceMoney(primary.received, primary.currencyCode)}
            </div>
            <span className="text-[10px] text-muted-foreground">Listas pagas</span>
          </div>

          <div className="rounded-lg bg-card/60 border border-border/50 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>A Receber</span>
              <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="text-base font-bold text-foreground">
              {formatFinanceMoney(primary.expected, primary.currencyCode)}
            </div>
            <span className="text-[10px] text-muted-foreground">Listas pendentes</span>
          </div>

          <div className="rounded-lg bg-card/60 border border-border/50 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Despesas</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
            </div>
            <div className="text-base font-bold text-foreground">
              {formatFinanceMoney(primary.expenses, primary.currencyCode)}
            </div>
            <span className="text-[10px] text-muted-foreground">Efetivas</span>
          </div>

          <div className="rounded-lg bg-card/60 border border-border/50 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Disponível</span>
              <Wallet className={`h-3.5 w-3.5 ${isNegative ? "text-destructive" : "text-emerald-400"}`} />
            </div>
            <div className={`text-base font-bold ${isNegative ? "text-destructive" : "text-emerald-400"}`}>
              {formatFinanceMoney(primary.available, primary.currencyCode)}
            </div>
            <span className="text-[10px] text-muted-foreground">Caixa real</span>
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span>Obrigações liquidadas: {formatFinanceMoney(primary.settledObligationPayments, primary.currencyCode)}</span>
        <span className="text-[10px] opacity-75">Fonte: Express /api/finance-v2/summary</span>
      </div>
    </div>
  );
}
