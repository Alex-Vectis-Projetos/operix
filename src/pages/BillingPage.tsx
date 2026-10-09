import { type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Receipt, CreditCard, GitMerge, CalendarClock, Building2, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import InvoicesScreen from "@/components/billing/InvoicesScreen";
import PaymentsScreen from "@/components/billing/PaymentsScreen";
import ReconciliationScreen from "@/components/billing/ReconciliationScreen";
import UpcomingBillsScreen from "@/components/billing/UpcomingBillsScreen";
import ClientsScreen from "@/components/billing/ClientsScreen";
import ReportsScreen from "@/components/billing/ReportsScreen";
import { useLanguage } from "@/hooks/useLanguage";

// ─────────────────────────────────────────────────────────────
// Layout with sub-nav
// ─────────────────────────────────────────────────────────────
function BillingLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  const subNav = [
    { slug: "faturas", label: t("nav.billing", "Faturamento"), icon: Receipt },
    { slug: "pagamentos", label: t("billing.pagamentos", "Pagamentos"), icon: CreditCard },
    { slug: "conciliacao", label: t("billing.conciliacao", "Conciliação"), icon: GitMerge },
    { slug: "contas-a-vencer", label: t("billing.upcoming", "Contas a vencer"), icon: CalendarClock },
    { slug: "clientes", label: t("billing.clients", "Clientes"), icon: Building2 },
    { slug: "relatorios", label: t("billing.reports", "Relatórios"), icon: BarChart3 },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm p-1">
        {subNav.map((item) => {
          const to = `/billing/${item.slug}`;
          const active = pathname.startsWith(to);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.slug}
              to={to}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-primary/15 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          );
        })}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Public route component
// ─────────────────────────────────────────────────────────────
export default function BillingPage() {
  return (
    <BillingLayout>
      <Routes>
        <Route index element={<Navigate to="faturas" replace />} />
        <Route path="faturas" element={<InvoicesScreen />} />
        <Route path="pagamentos" element={<PaymentsScreen />} />
        <Route path="conciliacao" element={<ReconciliationScreen />} />
        <Route path="contas-a-vencer" element={<UpcomingBillsScreen />} />
        <Route path="clientes" element={<ClientsScreen />} />
        <Route path="fornecedores" element={<Navigate to="/billing/clientes" replace />} />
        <Route path="relatorios" element={<ReportsScreen />} />

        <Route path="*" element={<Navigate to="faturas" replace />} />
      </Routes>
    </BillingLayout>
  );
}
