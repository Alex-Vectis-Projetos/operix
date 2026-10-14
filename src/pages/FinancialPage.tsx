import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  Receipt,
  PieChart,
  DollarSign,
  ShieldAlert,
  Wallet,
  Users,
  BookOpen,
  ShieldCheck,
  Activity,
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
import { TechnicianStatementTab } from "@/components/finance/TechnicianStatementTab";
import { TechnicianFinanceView } from "@/components/finance/TechnicianFinanceView";
import { AccountingControlCenter } from "@/components/accounting/AccountingControlCenter";
import FinancialAuditTab from "@/components/financial/FinancialAuditTab";
import FinancialIntegrityTab from "@/components/financial/FinancialIntegrityTab";

export default function FinancialPage() {
  const { workspaceId, myRole, isAdmin: wsIsAdmin, ownerAppUserId } = useWorkspace();
  const { role: displayRole, isAdmin: roleIsAdmin, isOwner: roleIsOwner } = useRole();
  const { user } = useAuth();

  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const validTabs = [
    "overview",
    "accounting",
    "technicians",
    "expenses",
    "distributions",
    "obligations",
    "audit",
    "integrity",
  ];
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
              Controle canônico de recebimentos, despesas operacionais, contabilidade, repasses e integridade por moeda.
            </p>
          </div>
        </div>
      </div>

      {/* Main Canonical Navigation Tabs */}
      <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4 min-w-0 max-w-full w-full">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex h-auto p-1 bg-muted rounded-lg gap-1">
            <TabsTrigger value="overview" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-overview">
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              Visão Geral
            </TabsTrigger>
            <TabsTrigger value="accounting" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-accounting">
              <BookOpen className="h-3.5 w-3.5 mr-1.5" />
              Contabilidade
            </TabsTrigger>
            <TabsTrigger value="technicians" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-technicians">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              Detalhamento Técnicos
            </TabsTrigger>
            <TabsTrigger value="expenses" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-expenses">
              <Receipt className="h-3.5 w-3.5 mr-1.5" />
              Despesas Gerais
            </TabsTrigger>
            <TabsTrigger value="distributions" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-distributions">
              <PieChart className="h-3.5 w-3.5 mr-1.5" />
              Distribuições & Rateio
            </TabsTrigger>
            <TabsTrigger value="obligations" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-obligations">
              <DollarSign className="h-3.5 w-3.5 mr-1.5" />
              Obrigações & Pagamentos
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-audit">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Auditoria
            </TabsTrigger>
            <TabsTrigger value="integrity" className="text-xs py-1.5 px-3 whitespace-nowrap" data-testid="tab-finance-integrity">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Integridade
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Per-Currency Overview */}
        <TabsContent value="overview" className="space-y-4">
          <FinanceSummaryCards />
        </TabsContent>

        {/* Tab 2: Accounting Control Center (Alex Orbit & Modules) */}
        <TabsContent value="accounting" className="space-y-4 min-w-0 max-w-full">
          <div className="min-h-[60svh] min-w-0 max-w-full w-full overflow-visible md:min-h-[600px] md:overflow-hidden">
            <AccountingControlCenter embedded />
          </div>
        </TabsContent>

        {/* Tab 3: Technician Statements & Settlements (3-Part Extrato per Alex Rule) */}
        <TabsContent value="technicians" className="space-y-4">
          <TechnicianStatementTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 4: Canonical Expenses */}
        <TabsContent value="expenses" className="space-y-4">
          <ExpensesTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 5: Distributions & Batch Profit Rules */}
        <TabsContent value="distributions" className="space-y-4">
          <DistributionsTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 6: Obligations & Settlements */}
        <TabsContent value="obligations" className="space-y-4">
          <ObligationsTab canMutate={isFullManager} />
        </TabsContent>

        {/* Tab 7: Immutable Financial Audit Trail */}
        <TabsContent value="audit" className="space-y-4">
          <FinancialAuditTab />
        </TabsContent>

        {/* Tab 8: Integrity & Drift Check */}
        <TabsContent value="integrity" className="space-y-4">
          <FinancialIntegrityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
