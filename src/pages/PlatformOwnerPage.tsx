import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import {
  Shield, Building2, AlertCircle, Clock, CheckCircle2,
  Landmark, CreditCard, Receipt, Percent, Webhook, Activity,
  ScrollText, Power, Brain, ShieldCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { PlatformFinancialDashboard } from "@/components/billing/PlatformFinancialDashboard";
import { SmartMetricsCards } from "@/components/billing/SmartMetricsCards";
import { AutomationPanel } from "@/components/billing/AutomationPanel";
import { ManualPaymentsReview } from "@/components/billing/ManualPaymentsReview";
import { SecurityDashboard } from "@/components/platform/SecurityDashboard";
import { ComplianceDashboard } from "@/components/platform/ComplianceDashboard";
import { useIsPlatformOwner } from "@/hooks/useSubscription";
import { toast } from "sonner";

type PlatformSubscriptionRow = {
  id: string;
  workspace_id: string;
  status: string;
  billing_cycle: string;
  plan_code: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
  technician_count: number;
  current_price: number;
  suspension_mode: string | null;
  legal_hold: boolean;
  workspaces: { name: string } | null;
};

type PlatformBankAccount = {
  id: string;
  bank_name: string;
  account_name: string;
  iban: string | null;
  bic: string | null;
  country: string;
  currency: string;
  account_type: string;
  is_primary: boolean;
  active: boolean;
  supported_methods?: string[];
};

type PlatformPaymentRow = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  method: string;
  amount: number;
  currency: string;
  status: string;
  external_ref: string | null;
  invoice_number: string | null;
  created_at: string;
};

type PlatformVatRule = {
  id: string;
  country: string;
  standard_rate: number;
  eu_member: boolean;
  reverse_charge_when_business: boolean;
};

type VatCalcResult = {
  rate: number;
  reverse_charge: boolean;
  exemption?: string | null;
  exemption_reason?: string | null;
};

type PlatformInvoiceRow = {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  customer_name: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  currency: string;
  status: string;
  workspaces?: { name: string } | null;
};

type PlatformWebhookRow = {
  id: string;
  created_at: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
};

type PlatformAuditLog = {
  id: string;
  created_at: string;
  workspace_id: string | null;
  category: string;
  action: string;
  severity: string;
  message: string | null;
  workspaces: { name: string } | null;
};

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  return withTime ? date.toLocaleString("pt-PT") : date.toLocaleDateString("pt-PT");
}

function shortenId(value: string | null | undefined) {
  if (!value) return "—";
  return `${value.slice(0, 8)}…`;
}

export default function PlatformOwnerPage() {
  const { data: isOwner, isLoading: ownerLoading } = useIsPlatformOwner();

  if (ownerLoading) return <div className="module-shell"><LoadingState variant="cards" /></div>;
  if (!isOwner) return <Navigate to="/" replace />;

  return (
    <div className="module-shell space-y-6">
      <PageHeader icon={Shield} title="Plataforma" subtitle="Centro de billing interno — owner only" />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap h-auto bg-muted/30 p-1">
          <TabsTrigger value="overview"><Activity className="h-3.5 w-3.5 mr-1.5" />Visão geral</TabsTrigger>
          <TabsTrigger value="banks"><Landmark className="h-3.5 w-3.5 mr-1.5" />Contas bancárias</TabsTrigger>
          <TabsTrigger value="subscriptions"><Building2 className="h-3.5 w-3.5 mr-1.5" />Subscrições</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="h-3.5 w-3.5 mr-1.5" />Pagamentos</TabsTrigger>
          <TabsTrigger value="vat"><Percent className="h-3.5 w-3.5 mr-1.5" />IVA</TabsTrigger>
          <TabsTrigger value="invoices"><Receipt className="h-3.5 w-3.5 mr-1.5" />Faturas</TabsTrigger>
          <TabsTrigger value="webhooks"><Webhook className="h-3.5 w-3.5 mr-1.5" />Webhooks</TabsTrigger>
          <TabsTrigger value="lifecycle"><Power className="h-3.5 w-3.5 mr-1.5" />Ciclo de vida</TabsTrigger>
          <TabsTrigger value="automation"><Brain className="h-3.5 w-3.5 mr-1.5" />Automação</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="h-3.5 w-3.5 mr-1.5" />Auditoria</TabsTrigger>
          <TabsTrigger value="security"><Shield className="h-3.5 w-3.5 mr-1.5" />Segurança</TabsTrigger>
          <TabsTrigger value="compliance"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <SmartMetricsCards />
          <OverviewTab />
        </TabsContent>
        <TabsContent value="banks" className="mt-6"><BankAccountsTab /></TabsContent>
        <TabsContent value="subscriptions" className="mt-6"><SubscriptionsTab /></TabsContent>
        <TabsContent value="payments" className="mt-6"><PaymentsTab /></TabsContent>
        <TabsContent value="vat" className="mt-6"><VatTab /></TabsContent>
        <TabsContent value="invoices" className="mt-6"><InvoicesTab /></TabsContent>
        <TabsContent value="webhooks" className="mt-6"><WebhooksTab /></TabsContent>
        <TabsContent value="lifecycle" className="mt-6"><LifecycleTab /></TabsContent>
        <TabsContent value="automation" className="mt-6 space-y-6">
          <AutomationPanel />
          <SmartMetricsCards />
        </TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditTab /></TabsContent>
        <TabsContent value="security" className="mt-6"><SecurityDashboard /></TabsContent>
        <TabsContent value="compliance" className="mt-6"><ComplianceDashboard /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-subscriptions-overview"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformSubscriptionRow[]> => {
      const data = await apiRequest<{ subscriptions: PlatformSubscriptionRow[] }>("/billing/admin/overview");
      return data.subscriptions ?? [];
    },
  });

  const counts = rows.reduce((acc: Record<string, number>, row: PlatformSubscriptionRow) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, { total: 0 } as Record<string, number>);

  return (
    <div className="space-y-6">
      <PlatformFinancialDashboard />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Workspaces", value: counts.total, icon: Building2, tone: "text-foreground" },
          { label: "Activas", value: counts.active ?? 0, icon: CheckCircle2, tone: "text-emerald-500" },
          { label: "Em avaliação", value: counts.trial ?? 0, icon: Clock, tone: "text-amber-500" },
          { label: "Em atraso", value: counts.overdue ?? 0, icon: AlertCircle, tone: "text-orange-500" },
          { label: "Suspensas", value: counts.suspended ?? 0, icon: AlertCircle, tone: "text-red-500" },
        ].map((k) => (
          <Card key={k.label} className="p-4 surface-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <k.icon className={`h-3.5 w-3.5 ${k.tone}`} /> {k.label}
            </div>
            <p className="text-2xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>

      <Card className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">Tenants</h3>
        </div>
        {isLoading ? <div className="p-6"><LoadingState variant="table" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2">Workspace</th>
                  <th className="text-left px-4 py-2">Estado</th>
                  <th className="text-left px-4 py-2">Ciclo</th>
                  <th className="text-right px-4 py-2">Técnicos</th>
                  <th className="text-right px-4 py-2">Preço</th>
                  <th className="text-left px-4 py-2">Renovação / Trial</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: PlatformSubscriptionRow) => (
                  <tr key={row.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{row.workspaces?.name ?? "—"}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{row.status}</Badge></td>
                    <td className="px-4 py-2 text-xs">{row.billing_cycle}</td>
                    <td className="px-4 py-2 text-right">{row.technician_count}</td>
                    <td className="px-4 py-2 text-right">{Number(row.current_price).toFixed(2)} €</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {row.current_period_end ? formatDate(row.current_period_end) : row.trial_ends_at ? `Trial → ${formatDate(row.trial_ends_at)}` : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Sem workspaces.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function BankAccountsTab() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["platform-bank-accounts-admin"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformBankAccount[]> => {
      const data = await apiRequest<{ accounts: PlatformBankAccount[] }>("/billing/admin/bank-accounts", { timeoutMs: 8000 });
      return data.accounts ?? [];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PlatformBankAccount> }) => {
      await apiRequest(`/billing/admin/bank-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    onSuccess: () => {
      toast.success("Conta atualizada");
      qc.invalidateQueries({ queryKey: ["platform-bank-accounts-admin"] });
    },
    onError: (error: any) => toast.error(error.message || "Erro ao atualizar a conta"),
  });

  if (isLoading) return <LoadingState variant="cards" />;

  return (
    <div className="space-y-4">
      {accounts.map((account: PlatformBankAccount) => (
        <Card key={account.id} className="surface-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{account.account_name}</h3>
                {account.is_primary && <Badge className="text-[10px]">Primary</Badge>}
                <Badge variant="outline" className="text-[10px]">{account.currency}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{account.bank_name} · {account.country} · {account.account_type}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Ativa</span>
              <Switch
                checked={account.active}
                onCheckedChange={(value: boolean) => update.mutate({ id: account.id, patch: { active: value } })}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground">IBAN</label>
              <Input
                defaultValue={account.iban ?? ""}
                placeholder="PT50..."
                onBlur={(event: any) => {
                  if (event.target.value !== (account.iban ?? "")) {
                    update.mutate({ id: account.id, patch: { iban: event.target.value || null } });
                  }
                }}
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">BIC / SWIFT</label>
              <Input
                defaultValue={account.bic ?? ""}
                placeholder="QWRKPTPL"
                onBlur={(event: any) => {
                  if (event.target.value !== (account.bic ?? "")) {
                    update.mutate({ id: account.id, patch: { bic: event.target.value || null } });
                  }
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {(account.supported_methods ?? []).map((method: string) => (
              <Badge key={method} variant="secondary" className="text-[10px]">{method}</Badge>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SubscriptionsTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-subs-full"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformSubscriptionRow[]> => {
      const data = await apiRequest<{ subscriptions: PlatformSubscriptionRow[] }>("/billing/admin/subscriptions", { timeoutMs: 8000 });
      return data.subscriptions ?? [];
    },
  });

  if (isLoading) return <LoadingState variant="table" />;

  return (
    <Card className="surface-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2">Workspace</th>
              <th className="text-left px-4 py-2">Estado</th>
              <th className="text-left px-4 py-2">Ciclo</th>
              <th className="text-right px-4 py-2">Técnicos</th>
              <th className="text-right px-4 py-2">Preço/mês</th>
              <th className="text-left px-4 py-2">Trial termina</th>
              <th className="text-left px-4 py-2">Período atual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: PlatformSubscriptionRow) => (
              <tr key={row.id} className="border-t border-border/40">
                <td className="px-4 py-2 font-medium">{row.workspaces?.name ?? shortenId(row.workspace_id)}</td>
                <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{row.status}</Badge></td>
                <td className="px-4 py-2 text-xs">{row.billing_cycle}</td>
                <td className="px-4 py-2 text-right">{row.technician_count}</td>
                <td className="px-4 py-2 text-right">{Number(row.current_price).toFixed(2)} €</td>
                <td className="px-4 py-2 text-xs">{formatDate(row.trial_ends_at)}</td>
                <td className="px-4 py-2 text-xs">{formatDate(row.current_period_end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PaymentsTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-payments"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformPaymentRow[]> => {
      const data = await apiRequest<{ payments: PlatformPaymentRow[] }>("/billing/admin/payments", { timeoutMs: 8000 });
      return data.payments ?? [];
    },
  });

  if (isLoading) return <LoadingState variant="table" />;

  return (
    <div className="space-y-6">
      <ManualPaymentsReview />
      <Card className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Pagamentos registados</h3>
          <span className="text-[11px] text-muted-foreground">Histórico consolidado da plataforma</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Sem pagamentos ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2">Data</th>
                  <th className="text-left px-4 py-2">Workspace</th>
                  <th className="text-left px-4 py-2">Método</th>
                  <th className="text-right px-4 py-2">Valor</th>
                  <th className="text-left px-4 py-2">Estado</th>
                  <th className="text-left px-4 py-2">Ref. externa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payment: PlatformPaymentRow) => (
                  <tr key={payment.id} className="border-t border-border/40">
                    <td className="px-4 py-2 text-xs">{formatDate(payment.created_at, true)}</td>
                    <td className="px-4 py-2 text-xs">{payment.workspace_name ?? shortenId(payment.workspace_id)}</td>
                    <td className="px-4 py-2 text-xs">{payment.method}</td>
                    <td className="px-4 py-2 text-right">{Number(payment.amount).toFixed(2)} {payment.currency}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{payment.status}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{payment.external_ref ?? payment.invoice_number ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function VatTab() {
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["platform-vat-rules"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformVatRule[]> => {
      const data = await apiRequest<{ rules: PlatformVatRule[] }>("/billing/admin/vat-rules", { timeoutMs: 8000 });
      return data.rules ?? [];
    },
  });

  const [country, setCountry] = useState("FR");
  const [isBusiness, setIsBusiness] = useState(false);
  const [vatNumber, setVatNumber] = useState("");
  const [result, setResult] = useState<VatCalcResult | null>(null);

  const calc = async () => {
    try {
      const data = await apiRequest<VatCalcResult>("/billing/vat/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          is_business: isBusiness,
          vat_number: vatNumber || null,
        }),
      });
      setResult(data);
    } catch (error: any) {
      toast.error(error.message || "Erro ao calcular IVA");
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="surface-card p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Percent className="h-4 w-4" />Calculadora de IVA</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">País (ISO-2)</label>
            <Input value={country} onChange={(event: any) => setCountry(event.target.value.toUpperCase())} maxLength={2} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Empresa (B2B)</span>
            <Switch checked={isBusiness} onCheckedChange={setIsBusiness} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Nº IVA (opcional)</label>
            <Input value={vatNumber} onChange={(event: any) => setVatNumber(event.target.value)} placeholder="FR12345678901" />
          </div>
          <Button onClick={calc} className="w-full">Calcular</Button>
          {result && (
            <div className="rounded border border-border/40 p-3 text-xs space-y-1 bg-muted/20">
              <div>Taxa: <span className="font-semibold">{Number(result.rate ?? 0) * 100}%</span></div>
              <div>Reverse charge: <span className="font-semibold">{result.reverse_charge ? "Sim" : "Não"}</span></div>
              <div>Isenção: <span className="font-semibold">{result.exemption ?? result.exemption_reason ?? "—"}</span></div>
            </div>
          )}
        </div>
      </Card>

      <Card className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">Regras por país</h3>
        </div>
        {isLoading ? <div className="p-6"><LoadingState variant="table" /></div> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2">País</th>
                <th className="text-right px-4 py-2">Taxa</th>
                <th className="text-center px-4 py-2">UE</th>
                <th className="text-center px-4 py-2">Reverse B2B</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: PlatformVatRule) => (
                <tr key={rule.id} className="border-t border-border/40">
                  <td className="px-4 py-2 font-mono text-xs">{rule.country}</td>
                  <td className="px-4 py-2 text-right">{Number(rule.standard_rate).toFixed(2)}%</td>
                  <td className="px-4 py-2 text-center">{rule.eu_member ? "✓" : "—"}</td>
                  <td className="px-4 py-2 text-center">{rule.reverse_charge_when_business ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function InvoicesTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-invoices"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformInvoiceRow[]> => {
      const data = await apiRequest<{ invoices: PlatformInvoiceRow[] }>("/billing/admin/invoices", { timeoutMs: 8000 });
      return data.invoices ?? [];
    },
  });

  if (isLoading) return <LoadingState variant="table" />;

  return (
    <Card className="surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold">Faturas internas (workspaces)</h3>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">Sem faturas emitidas.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2">Número</th>
                <th className="text-left px-4 py-2">Emissão</th>
                <th className="text-left px-4 py-2">Venc.</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-right px-4 py-2">Subtotal</th>
                <th className="text-right px-4 py-2">IVA</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-left px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice: PlatformInvoiceRow) => (
                <tr key={invoice.id} className="border-t border-border/40">
                  <td className="px-4 py-2 font-mono text-xs">{invoice.invoice_number}</td>
                  <td className="px-4 py-2 text-xs">{formatDate(invoice.issue_date)}</td>
                  <td className="px-4 py-2 text-xs">{formatDate(invoice.due_date)}</td>
                  <td className="px-4 py-2 text-xs">{invoice.customer_name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{Number(invoice.subtotal).toFixed(2)} {invoice.currency}</td>
                  <td className="px-4 py-2 text-right">{Number(invoice.vat_amount).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{Number(invoice.total).toFixed(2)}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{invoice.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function WebhooksTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-webhooks"],
    retry: 0,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformWebhookRow[]> => {
      const data = await apiRequest<{ events: PlatformWebhookRow[] }>("/billing/admin/webhooks", { timeoutMs: 8000 });
      return data.events ?? [];
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <LoadingState variant="table" />;

  return (
    <Card className="surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Fila de eventos internos</h3>
        <span className="text-[11px] text-muted-foreground">Auto-refresh 15s</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">Sem eventos.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2">Quando</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-right px-4 py-2">Tentativas</th>
                <th className="text-left px-4 py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event: PlatformWebhookRow) => (
                <tr key={event.id} className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs">{formatDate(event.created_at, true)}</td>
                  <td className="px-4 py-2 text-xs font-mono">{event.event_type}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{event.status}</Badge></td>
                  <td className="px-4 py-2 text-right text-xs">{event.attempts}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[200px]">{event.last_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LifecycleTab() {
  const qc = useQueryClient();
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["platform-lifecycle-subs"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformSubscriptionRow[]> => {
      const data = await apiRequest<{ subscriptions: PlatformSubscriptionRow[] }>("/billing/admin/lifecycle/subscriptions", { timeoutMs: 8000 });
      return data.subscriptions ?? [];
    },
  });

  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");

  const transition = useMutation({
    mutationFn: async ({ ws, status }: { ws: string; status: string }) => {
      await apiRequest(`/billing/admin/lifecycle/workspaces/${ws}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reason: reason || null,
          suspension_mode: status === "suspended" || status === "legal_hold" ? mode : null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Estado atualizado");
      setReason("");
      qc.invalidateQueries({ queryKey: ["platform-lifecycle-subs"] });
      qc.invalidateQueries({ queryKey: ["platform-subscriptions-overview"] });
      qc.invalidateQueries({ queryKey: ["platform-subs-full"] });
      qc.invalidateQueries({ queryKey: ["platform-audit-logs"] });
      qc.invalidateQueries({ queryKey: ["platform-financial-overview"] });
      qc.invalidateQueries({ queryKey: ["platform-smart-metrics"] });
    },
    onError: (error: any) => toast.error(error.message || "Transição inválida"),
  });

  const selected = subs.find((sub: PlatformSubscriptionRow) => sub.workspace_id === picked) ?? null;

  if (isLoading) return <LoadingState variant="cards" />;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">Workspaces</h3>
        </div>
        <div className="max-h-[480px] overflow-y-auto divide-y divide-border/40">
          {subs.map((sub: PlatformSubscriptionRow) => (
            <button
              key={sub.id}
              onClick={() => setPicked(sub.workspace_id)}
              className={`w-full text-left px-4 py-3 hover:bg-muted/30 ${picked === sub.workspace_id ? "bg-muted/40" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{sub.workspaces?.name ?? shortenId(sub.workspace_id)}</span>
                <Badge variant="outline" className="text-[10px]">{sub.status}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sub.technician_count} técnicos · {Number(sub.current_price).toFixed(2)} €
                {sub.legal_hold ? " · legal hold" : ""}
                {sub.suspension_mode ? ` · ${sub.suspension_mode}` : ""}
              </p>
            </button>
          ))}
          {subs.length === 0 && (
            <div className="p-6 text-xs text-center text-muted-foreground">Sem subscrições.</div>
          )}
        </div>
      </Card>

      <Card className="surface-card p-5 space-y-4">
        {!selected ? (
          <p className="text-xs text-muted-foreground text-center py-12">Selecione uma workspace para gerir o estado.</p>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold">{selected.workspaces?.name ?? selected.workspace_id}</h3>
              <p className="text-xs text-muted-foreground">Estado actual: <Badge variant="outline" className="text-[10px]">{selected.status}</Badge></p>
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground">Motivo (auditoria)</label>
              <Input value={reason} onChange={(event: any) => setReason(event.target.value)} placeholder="ex: pagamento não recebido" />
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground">Modo de suspensão</label>
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant={mode === "soft" ? "default" : "outline"} onClick={() => setMode("soft")}>Soft</Button>
                <Button size="sm" variant={mode === "hard" ? "default" : "outline"} onClick={() => setMode("hard")}>Hard</Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Soft = leitura + export · Hard = só faturação
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              {[
                { label: "Activar", value: "active" },
                { label: "Tolerância", value: "grace_period" },
                { label: "Em atraso", value: "past_due" },
                { label: "Overdue", value: "overdue" },
                { label: "Suspender", value: "suspended" },
                { label: "Cancelar", value: "cancelled" },
                { label: "Legal hold", value: "legal_hold" },
              ].map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant="outline"
                  disabled={transition.isPending || opt.value === selected.status}
                  onClick={() => transition.mutate({ ws: selected.workspace_id, status: opt.value })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function AuditTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["platform-audit-logs"],
    refetchInterval: 30_000,
    retry: 0,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<PlatformAuditLog[]> => {
      const data = await apiRequest<{ logs: PlatformAuditLog[] }>("/billing/admin/audit-logs", { timeoutMs: 8000 });
      return data.logs ?? [];
    },
  });

  if (isLoading) return <LoadingState variant="table" />;

  return (
    <Card className="surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Auditoria de billing</h3>
        <span className="text-[11px] text-muted-foreground">Append-only · 300 últimos</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">Sem eventos auditados.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2">Quando</th>
                <th className="text-left px-4 py-2">Workspace</th>
                <th className="text-left px-4 py-2">Categoria</th>
                <th className="text-left px-4 py-2">Acção</th>
                <th className="text-left px-4 py-2">Severidade</th>
                <th className="text-left px-4 py-2">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event: PlatformAuditLog) => (
                <tr key={event.id} className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDate(event.created_at, true)}</td>
                  <td className="px-4 py-2 text-xs">{event.workspaces?.name ?? shortenId(event.workspace_id)}</td>
                  <td className="px-4 py-2 text-xs font-mono">{event.category}</td>
                  <td className="px-4 py-2 text-xs">{event.action}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        event.severity === "critical" ? "border-red-500/40 text-red-500" :
                        event.severity === "warning" ? "border-amber-500/40 text-amber-500" : ""
                      }`}
                    >{event.severity}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{event.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
