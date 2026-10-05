import { memo } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, FileText, CreditCard, TrendingUp, BarChart3,
  Car, Users, Receipt, Shield, Wrench, Store, Zap, Brain, Workflow,
  UserPlus, IdCard, MapPin, FileCheck2,
} from "lucide-react";
import { useIsPlatformOwner } from "@/hooks/useSubscription";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { useLanguage } from "@/hooks/useLanguage";
import { useCan } from "@/hooks/usePermission";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";
import { useWorkspace } from "@/hooks/useWorkspace";
import { BrandNameEditor, type BrandConfig } from "@/components/layout/BrandNameEditor";
import { BrandLogo } from "@/components/BrandLogo";
import { brandConfig as appBrand } from "@/brand.config";
import { buildBrandTextStyle } from "@/lib/brandStyles";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  module: string;
  action: string;
  end?: boolean;
  enabled?: boolean; // extra gating (e.g. platform owner)
  badge?: string;
};

type NavGroup = {
  /** Optional label. When omitted, items render flush without a section header. */
  label?: string;
  items: NavItem[];
};

export const AppSidebar = memo(function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { t } = useLanguage();
  const { can, isLoading: permsLoading } = useCan();
  const { brandConfig, saveBrandConfig } = useCompanyLogo();
  const { workspaceName } = useWorkspace();
  const { data: isPlatformOwner = false } = useIsPlatformOwner();
  // Platform-owner gating removed — single-workspace architecture.

  const handleBrandSave = async (config: BrandConfig) => {
    try {
      await saveBrandConfig(config);
      toast.success(t("brand.nameUpdated"));
    } catch {
      toast.error(t("brand.nameUpdateError"));
    }
  };

  const displayName = brandConfig.name || workspaceName || appBrand.appName;

  // Architecture: declarative groups → easy to collapse / reorder later.
  const groups: NavGroup[] = [
    {
      // Painel — no label, acts as the top anchor
      items: [
        { title: t("nav.dashboard"), url: "/", icon: LayoutDashboard, module: "dashboard", action: "view", end: true },
      ],
    },
    {
      // Cliente — flush entre Painel e Operações, com espaçamento visual via className pt-4 abaixo.
      items: [
        { title: t("nav.clients", "Clientes"), url: "/clients", icon: UserPlus, module: "accounting", action: "view" },
      ],
    },
    {
      label: t("nav.group.registrations", "Cadastros"),
      items: [
        { title: t("nav.people", "Pessoas"), url: "/people", icon: IdCard, module: "people", action: "view" },
        { title: t("nav.locations", "Locais"), url: "/locations", icon: MapPin, module: "locations", action: "view" },
        { title: t("nav.countryDocuments", "Documentos por País"), url: "/country-document-requirements", icon: FileCheck2, module: "country_document_requirements", action: "view" },
      ],
    },
    {
      label: t("nav.group.operations", "Operações"),
      items: [
        { title: t("nav.production", "Produção"), url: "/production", icon: Wrench, module: "service_orders", action: "view" },
        { title: "WEEKLOG", url: "/service-orders", icon: FileText, module: "service_orders", action: "view" },
        { title: t("nav.paymentOrders", "LISTA"), url: "/payment-orders", icon: CreditCard, module: "payment_orders", action: "view" },
        { title: t("nav.productionWorkflow", "Workflow"), url: "/production-workflow", icon: Workflow, module: "production_workflow", action: "view" },
      ],
    },
    {
      label: t("nav.group.accounting", "Contabilidade"),
      items: [
        { title: t("nav.billing", "Faturamento"), url: "/billing", icon: Receipt, module: "accounting", action: "view" },
        { title: t("nav.financial"), url: "/financial", icon: TrendingUp, module: "financial", action: "view" },
        { title: t("nav.platform", "Plataforma"), url: "/platform", icon: Shield, module: "dashboard", action: "view", enabled: isPlatformOwner },
      ],
    },
    {
      label: t("nav.group.intelligence", "Inteligência"),
      items: [
        { title: t("nav.automations", "Automações"), url: "/automations", icon: Zap, module: "settings", action: "edit", badge: "Em breve" },
        { title: "Operix AI", url: "/ai", icon: Brain, module: "dashboard", action: "view", badge: "Em breve" },
      ],
    },
    {
      label: t("nav.group.opportunities", "Oportunidades"),
      items: [
        { title: t("nav.fleet"), url: "/fleet", icon: Car, module: "fleet", action: "view", badge: "Em breve" },
        { title: t("nav.marketplace", "Mercado"), url: "/marketplace", icon: Store, module: "dashboard", action: "view", badge: "Em breve" },
      ],
    },
    {
      label: t("nav.group.accounts", "Contas"),
      items: [
        { title: t("nav.users"), url: "/users", icon: Users, module: "users", action: "view" },
        { title: t("nav.subscription", "Assinaturas"), url: "/subscription", icon: Shield, module: "dashboard", action: "view" },
      ],
    },
  ];

  const visibleGroups: NavGroup[] = permsLoading
    ? groups.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.enabled === undefined || i.enabled),
      }))
    : groups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) => (i.enabled === undefined || i.enabled) && can(i.module, i.action).allowed,
          ),
        }))
        .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <div className={`flex h-14 items-center border-b border-border/50 ${collapsed ? "justify-center px-0" : "px-4"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <BrandLogo size={brandConfig.logoSizeNum ?? 30} />
            {(() => {
              const nameStyle = buildBrandTextStyle(brandConfig);
              return can("settings", "edit").allowed ? (
                <BrandNameEditor config={brandConfig} onSave={handleBrandSave}>
                  <button
                    className="overflow-hidden hover:opacity-80 transition-opacity cursor-pointer text-left font-display"
                    title={t("brand.editTooltip")}
                  >
                    <span className="truncate inline-block" style={nameStyle}>
                      {displayName}
                    </span>
                  </button>
                </BrandNameEditor>
              ) : (
                <Link to="/" className="overflow-hidden font-display">
                  <span className="truncate inline-block" style={nameStyle}>
                    {displayName}
                  </span>
                </Link>
              );
            })()}
          </div>
        )}
      </div>

      <SidebarContent className="pt-3 gap-1">
        {visibleGroups.map((group, idx) => (
          <SidebarGroup
            key={group.label ?? `__top-${idx}`}
            className={
              idx === 0
                ? "pt-0"
                : idx === 1
                  ? "pt-3"
                  : group.label
                    ? "pt-3"
                    : "pt-0"
            }
          >
            {group.label && (
              <SidebarGroupLabel className="text-muted-foreground/50 text-[10px] font-medium uppercase tracking-[0.14em] px-2 mb-1">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild tooltip={collapsed ? item.title : undefined}>
                      <NavLink
                        to={item.url}
                        end={item.end}
                        onClick={() => { if (isMobile) setOpenMobile(false); }}
                        className="text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors rounded-md"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <div className="flex items-center justify-between flex-1 min-w-0">
                            <span className="text-[13px] md:text-[13px] truncate">{item.title}</span>
                            {item.badge && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-muted/80 text-muted-foreground border border-border/50 font-medium shrink-0 ml-1">
                                {item.badge}
                              </span>
                            )}
                          </div>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
});
