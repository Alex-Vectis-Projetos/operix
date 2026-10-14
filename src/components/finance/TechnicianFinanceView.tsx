import React, { useState } from "react";
import { UserCheck, PieChart, DollarSign, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DistributionsTab } from "./DistributionsTab";
import { ObligationsTab } from "./ObligationsTab";
import { TechnicianStatementTab } from "./TechnicianStatementTab";

export function TechnicianFinanceView() {
  const [activeTab, setActiveTab] = useState("statement");

  return (
    <div className="space-y-6 animate-fade-in" data-testid="technician-finance-view">
      {/* Header Banner */}
      <Card className="border-border/60 bg-muted/20">
        <CardContent className="flex items-center gap-4 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Extrato & Repasses do Técnico</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Acompanhe sua conta-corrente individual com detalhamento de produção recebida, despesas deduzidas e saldo líquido liberado.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Own Statement, Distributions, and Obligations */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-lg bg-muted p-1">
          <TabsTrigger value="statement" className="text-xs" data-testid="tab-tech-statement">
            <Wallet className="h-3.5 w-3.5 mr-1.5" />
            Extrato de Contas
          </TabsTrigger>
          <TabsTrigger value="distributions" className="text-xs" data-testid="tab-tech-distributions">
            <PieChart className="h-3.5 w-3.5 mr-1.5" />
            Meus Repasses
          </TabsTrigger>
          <TabsTrigger value="obligations" className="text-xs" data-testid="tab-tech-obligations">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" />
            Minhas Liquidações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="statement" className="space-y-4">
          <TechnicianStatementTab canMutate={false} />
        </TabsContent>

        <TabsContent value="distributions" className="space-y-4">
          <DistributionsTab canMutate={false} />
        </TabsContent>

        <TabsContent value="obligations" className="space-y-4">
          <ObligationsTab canMutate={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
