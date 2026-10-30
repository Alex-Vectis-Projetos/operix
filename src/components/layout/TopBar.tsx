import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, LogOut, Check, Trash2, FileText, CreditCard, AlertTriangle, Info, Clock, User as UserIcon, Settings as SettingsIcon, Mail, Calendar, Calculator, MessageSquare, FileCheck, FolderOpen } from "lucide-react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/BrandLogo";
import { brandConfig } from "@/brand.config";
import { Button } from "@/components/ui/button";
import { useAgingAlerts } from "@/hooks/useAgingAlerts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { useLanguage } from "@/hooks/useLanguage";
import { useNotifications } from "@/hooks/useNotifications";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUserProfile } from "@/hooks/useUserProfile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AIControlCenter } from "./AIControlCenter";
import { IncomingInvitesButton } from "@/components/users/IncomingInvitesButton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const typeIcon: Record<string, typeof Info> = {
  service_order: FileText,
  payment: CreditCard,
  discrepancy: AlertTriangle,
  workspace_invite: Mail,
  weeklog: Calendar,
  budget: Calculator,
  observation: MessageSquare,
  document: FileCheck,
};

function timeAgo(dateStr: string, t: (k: string, fb?: string) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("notif.justNow");
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export const TopBar = memo(function TopBar() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { role } = useRole();
  const can = (useRole() as any).can;
  const canViewDocs = can ? can("documents.view") : true;
  const { t } = useLanguage();
  const { workspaceName } = useWorkspace();
  const { notifications, unreadCount, markAsRead, markAllRead, clearAll } = useNotifications();
  const { data: agingAlerts = [] } = useAgingAlerts();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const totalAlertCount = unreadCount + agingAlerts.length;

  const avatarUrl = userProfile?.avatar_url || profile?.avatar_url || "";
  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-3 sm:px-4 glass-panel supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center gap-2 min-w-0">
        <SidebarTrigger className="h-10 w-10 md:h-8 md:w-8 text-muted-foreground hover:text-foreground shrink-0" />
        {/* Context Switcher — 1 identidade, múltiplos ambientes operacionais */}
        <WorkspaceSwitcher />
      </div>

      {collapsed && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden lg:flex items-center gap-2 animate-fade-in">
          <BrandLogo size={24} />
          <span className="text-sm font-semibold text-foreground">{brandConfig.appName}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 sm:gap-1">
        {/* Document Explorer quick access */}
        {canViewDocs && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/documents")}
            className="h-10 w-10 md:h-8 md:w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("docs.title", "Documentos")}
            aria-label={t("docs.title", "Documentos")}
          >
            <FolderOpen className="h-4 w-4 text-primary" />
          </Button>
        )}

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-10 w-10 md:h-8 md:w-8 text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
              {totalAlertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  {totalAlertCount > 9 ? "9+" : totalAlertCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[1002] bg-card border-border w-[calc(100vw-1.5rem)] max-w-80">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold text-foreground">{t("notif.title")}</span>
              <div className="flex gap-1">
                {unreadCount > 0 && (
                    <Button variant="ghost" size="sm" className="min-h-9 md:min-h-6 px-2 text-[10px]" onClick={() => markAllRead()}>
                    <Check className="h-3 w-3 mr-1" />
                    {t("notif.markAllRead")}
                  </Button>
                )}
                {notifications.length > 0 && (
                    <Button variant="ghost" size="sm" className="min-h-9 md:min-h-6 px-2 text-[10px] text-destructive" onClick={() => clearAll()}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <DropdownMenuSeparator />
            <ScrollArea className="max-h-[400px]">
              {agingAlerts.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-amber-500 font-semibold bg-amber-500/5">
                    {t("notif.agingTitle")} ({agingAlerts.length})
                  </div>
                  {agingAlerts.map((alert) => {
                    const isCritical = alert.level === "level3";
                    const isElevated = alert.level === "level2";
                    const Icon = isCritical || isElevated ? AlertTriangle : Clock;
                    const tone = isCritical
                      ? { bg: "bg-red-500/5", icon: "bg-red-500/10 text-red-500", text: "text-red-500", badge: "bg-red-500/20 text-red-500" }
                      : isElevated
                      ? { bg: "bg-orange-500/5", icon: "bg-orange-500/10 text-orange-500", text: "text-orange-500", badge: "bg-orange-500/20 text-orange-500" }
                      : { bg: "bg-amber-500/5", icon: "bg-amber-500/10 text-amber-500", text: "text-amber-500", badge: "bg-amber-500/20 text-amber-500" };
                    const tag = alert.type === "payment_order" ? "OP" : alert.type === "invoice" ? "FAT" : "OS";
                    return (
                      <div key={alert.id} className={`flex gap-3 px-3 py-2.5 ${tone.bg}`}>
                        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className={`text-xs font-semibold ${tone.text}`}>
                              {isCritical ? t("notif.urgent") : isElevated ? t("notif.urgent") : t("notif.attention")} — {alert.daysOld}d
                            </p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${tone.badge}`}>
                              {tag}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{alert.message}</p>
                        </div>
                      </div>
                    );
                  })}
                  <DropdownMenuSeparator />
                </>
              )}


              {notifications.length === 0 && agingAlerts.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">{t("notif.empty")}</div>
              ) : (
                notifications.map((n: any) => {
                  const Icon = typeIcon[n.type] || Info;
                  return (
                    <div
                      key={n.id}
                      className={`flex gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 ${!n.is_read ? "bg-primary/5" : ""}`}
                      onClick={() => { if (!n.is_read) markAsRead(n.id); }}
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        n.type === "discrepancy" ? "bg-destructive/10 text-destructive"
                          : n.type === "payment" ? "bg-emerald-500/10 text-emerald-500"
                          : n.type === "workspace_invite" ? "bg-sky-500/10 text-sky-400"
                          : n.type === "weeklog" ? "bg-indigo-500/10 text-indigo-400"
                          : n.type === "budget" ? "bg-amber-500/10 text-amber-400"
                          : n.type === "observation" ? "bg-violet-500/10 text-violet-400"
                          : n.type === "document" ? "bg-teal-500/10 text-teal-400"
                          : "bg-primary/10 text-primary"
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-xs truncate ${!n.is_read ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                            {n.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{timeAgo(n.created_at, t)}</span>
                        </div>
                        {(n.body || n.message) && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {n.body || n.message}
                          </p>
                        )}
                      </div>
                      {!n.is_read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                  );
                })
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Workspace invites (only visible when there are pending) */}
        <IncomingInvitesButton />

        {/* AI Control Center — fixed operational copilot between notifications and profile */}
        <AIControlCenter />

        {/* User avatar + profile menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 sm:ml-2 flex h-10 w-10 md:h-8 md:w-8 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[1002] bg-card border-border w-56 max-w-[calc(100vw-1.5rem)]">
            <div className="px-3 py-2">
              <p className="text-sm font-medium text-foreground truncate">
                {workspaceName && workspaceName.toLowerCase() !== "default workspace" ? workspaceName : (profile?.full_name || t("common.user", "Utilizador"))}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")} className="text-sm cursor-pointer">
              <UserIcon className="h-3.5 w-3.5 mr-2" />
              {t("common.profile", "Perfil")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")} className="text-sm cursor-pointer">
              <SettingsIcon className="h-3.5 w-3.5 mr-2" />
              {t("nav.settings", "Configurações")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-sm cursor-pointer text-destructive">
              <LogOut className="h-3.5 w-3.5 mr-2" />
              {t("action.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
});
