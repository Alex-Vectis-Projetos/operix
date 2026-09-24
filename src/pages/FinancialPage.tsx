import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  Receipt,
  PieChart,
  DollarSign,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/hooks/useAuth";
import { FinanceSummaryCards } from "@/components/finance/FinanceSummaryCards";
import { ExpensesTab } from "@/components/finance/ExpensesTab";
import { DistributionsTab } from "@/components/finance/DistributionsTab";
import { ObligationsTab } from "@/components/finance/ObligationsTab";
import { TechnicianFinanceView } from "@/components/finance/TechnicianFinanceView";

export default function FinancialPage() {
  const { workspaceId, myRole, isAdmin: wsIsAdmin, ownerAppUserId } = useWorkspace();
  const { role: displayRole, isAdmin: roleIsAdmin, isOwner: roleIsOwner } = useRole();
  const { user } = useAuth();

  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const validTabs = ["overview", "expenses", "distributions", "obligations"];
  const [mainTab, setMainTab] = useState(
    initialTab && validTabs.includes(initialTab) ? initialTab : "overview"
  );

  // Authorization Evaluation:
  // Personal workspace owner receives full admin access even if their global platform role is technician.
  const isPersonalOwner = Boolean(
    ownerAppUserId && (user?.id === ownerAppUserId || (user as any)?.app_user_id === ownerAppUserId)
  );
  const isFullManager = wsIsAdmin || roleIsAdmin || roleIsOwner || isPersonalOwner || myRole === "admin";
  const isClient = myRole === "cliente" || displayRole === "cliente";
  const isLinkedTechnician = !isFullManager && (myRole === "tecnico" || displayRole === "tecnico");

  // 1. Client Access Denied
  if (isClient) {
    return (
      <div className="space-y-6 animate-fade-in" data-testid="finance-client-denied">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Gestão Financeira</h1>
            <p className="text-xs text-muted-foreground">Acesso restrito</p>
          </div>
        </div>

        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-base font-semibold text-foreground mb-1">Acesso Restrito</h3>
            <p className="text-xs text-muted-foreground max-w-md">
              Acesso restrito à gestão financeira interna da organização. Clientes e parceiros externos não possuem permissão para visualizar este módulo.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Linked Technician Own-Scope View
  if (isLinkedTechnician) {
    return (
      <div className="space-y-6 animate-fade-in" data-testid="finance-technician-scope">
        <TechnicianFinanceView />
      </div>
    );
  }

  // 3. Full Owner / Admin / Personal-Workspace Owner View
  return (
    <div className="space-y-6 animate-fade-in min-w-0 max-w-full w-full" data-testid="canonical-finance-page">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Gestão Financeira & Caixa</h1>
            <p className="text-xs text-muted-foreground">
              Controle canônico de recebimentos, despesas, repasses e liquidações por moeda.
            </p>
          </div>
        </div>
      </div>

      {/* Main Canonical Navigation Tabs */}
      <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4 min-w-0 max-w-full w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-xl bg-muted p-1">
          <TabsTrigger value="overview" className="text-xs" data-testid="tab-finance-overview">
            <Wallet className="h-3.5 w-3.5 mr-1.5" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="expenses" className="text-xs" data-testid="tab-finance-expenses">
            <Receipt className="h-3.5 w-3.5 mr-1.5" />
            Despesas
          </TabsTrigger>
          <TabsTrigger value="distributions" className="text-xs" data-testid="tab-finance-distributions">
            <PieChart className="h-3.5 w-3.5 mr-1.5" />
            Distribuições
          </TabsTrigger>
          <TabsTrigger value="obligations" className="text-xs" data-testid="tab-finance-obligations">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" />
            Obrigações
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Per-Currency Overview */}
        <TabsContent value="overview" className="space-y-4">
          <FinanceSummaryCards />
        </TabsContent>

        {/* Tab 2: Expenses */}
        <TabsContent value="expenses" className="space-y-4">
          <ExpensesTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 3: Distributions */}
        <TabsContent value="distributions" className="space-y-4">
          <DistributionsTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 4: Obligations */}
        <TabsContent value="obligations" className="space-y-4">
          <ObligationsTab canMutate={isFullManager} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
