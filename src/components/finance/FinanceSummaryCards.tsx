import React from "react";
import { TrendingUp, ArrowDownRight, ArrowUpRight, DollarSign, Wallet, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useFinanceSummary } from "@/hooks/useFinance";
import { formatFinanceMoney } from "@/lib/financeFormatters";

export function FinanceSummaryCards() {
  const { data: summary, isLoading, error } = useFinanceSummary();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-center gap-3 py-4 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            Erro ao carregar o resumo financeiro: {(error as Error)?.message || "Falha de comunicação com o servidor."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const currencies = summary?.currencies || [];

  if (currencies.length === 0) {
    return (
      <Card className="border-border/50 bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-base font-semibold text-foreground mb-1">Nenhuma movimentação financeira</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            Os saldos por moeda serão exibidos aqui à medida que Listas de Pagamento, Despesas e Obrigações forem registradas.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8" data-testid="finance-summary-container">
      {currencies.map((curr) => {
        const isNegativeAvailable = curr.available.startsWith("-");

        return (
          <div key={curr.currencyCode} className="space-y-3" data-testid={`summary-currency-${curr.currencyCode}`}>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono font-bold px-2 py-0.5 border-primary/40 bg-primary/5">
                {curr.currencyCode}
              </Badge>
              <span className="text-sm font-medium text-muted-foreground">
                Resumo de Caixa e Projeções ({curr.currencyCode})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Previsto */}
              <Card className="border-border/60 shadow-sm bg-card hover:border-border transition-colors">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Previsto (Listas)</CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold tracking-tight text-foreground" data-testid={`summary-${curr.currencyCode}-expected`}>
                    {formatFinanceMoney(curr.expected, curr.currencyCode)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Valor nominal faturável</p>
                </CardContent>
              </Card>

              {/* Recebido */}
              <Card className="border-border/60 shadow-sm bg-card hover:border-border transition-colors">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Recebido (Efetivo)</CardTitle>
                  <ArrowDownRight className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400" data-testid={`summary-${curr.currencyCode}-received`}>
                    {formatFinanceMoney(curr.received, curr.currencyCode)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Entradas em listas pagas</p>
                </CardContent>
              </Card>

              {/* Despesas */}
              <Card className="border-border/60 shadow-sm bg-card hover:border-border transition-colors">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Despesas</CardTitle>
                  <ArrowUpRight className="h-4 w-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold tracking-tight text-amber-600 dark:text-amber-400" data-testid={`summary-${curr.currencyCode}-expenses`}>
                    {formatFinanceMoney(curr.expenses, curr.currencyCode)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Despesas operacionais e gerais</p>
                </CardContent>
              </Card>

              {/* Repasses / Obrigações Liquidadas */}
              <Card className="border-border/60 shadow-sm bg-card hover:border-border transition-colors">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Repasses Liquidados</CardTitle>
                  <DollarSign className="h-4 w-4 text-indigo-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold tracking-tight text-indigo-600 dark:text-indigo-400" data-testid={`summary-${curr.currencyCode}-settled`}>
                    {formatFinanceMoney(curr.settledObligationPayments, curr.currencyCode)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Obrigações pagas</p>
                </CardContent>
              </Card>

              {/* Disponível */}
              <Card className={`border-border/60 shadow-sm bg-card transition-colors ${
                isNegativeAvailable ? "border-red-300 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10" : ""
              }`}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Disponível</CardTitle>
                  <Wallet className={`h-4 w-4 ${isNegativeAvailable ? "text-red-500" : "text-primary"}`} />
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-lg font-bold tracking-tight ${
                      isNegativeAvailable ? "text-red-600 dark:text-red-400" : "text-primary"
                    }`}
                    data-testid={`summary-${curr.currencyCode}-available`}
                  >
                    {formatFinanceMoney(curr.available, curr.currencyCode)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isNegativeAvailable ? "Saldo de caixa a descoberto" : "Saldo líquido disponível"}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        );
      })}
    </div>
  );
}
