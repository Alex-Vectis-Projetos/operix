import React, { useState } from "react";
import { UserCheck, PieChart, DollarSign, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DistributionsTab } from "./DistributionsTab";
import { ObligationsTab } from "./ObligationsTab";

export function TechnicianFinanceView() {
  const [activeTab, setActiveTab] = useState("distributions");

  return (
    <div className="space-y-6 animate-fade-in" data-testid="technician-finance-view">
      {/* Header Banner */}
      <Card className="border-border/60 bg-muted/20">
        <CardContent className="flex items-center gap-4 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Meus Repasses & Pagamentos</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Acompanhe suas alocações de participação e o status de pagamento das suas ordens e repasses na empresa.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Own Distributions and Own Obligations */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md bg-muted p-1">
          <TabsTrigger value="distributions" className="text-xs" data-testid="tab-tech-distributions">
            <PieChart className="h-3.5 w-3.5 mr-1.5" />
            Meus Repasses (Alocações)
          </TabsTrigger>
          <TabsTrigger value="obligations" className="text-xs" data-testid="tab-tech-obligations">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" />
            Minhas Obrigações (Pagamentos)
          </TabsTrigger>
        </TabsList>

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
