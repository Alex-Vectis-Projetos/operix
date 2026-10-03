/**
 * WorkspaceSwitcher — Operational context switcher.
 *
 * Architectural rule (do not regress):
 *  • 👑 QWork Nexus  → GLOBAL IDENTITY layer. Always mounted for the
 *    platform owner, never depends on a workspace, never disappears,
 *    not selectable as a "mode" — it simply IS, alongside whichever
 *    operational workspace is active.
 *  • 🛡️ Quality Work (or any other tenant) → OPERATIONAL CONTEXT layer.
 *    Selectable, swappable, scoped to data. Switching never reloads the
 *    page, never recreates providers, never resets auth.
 *
 * UI is intentionally minimal: ICON + NAME only. No "Proprietário",
 * "Global", "Próprio", "Convidado" badges. No descriptive footers.
 */
import { useMemo, type ReactNode } from "react";
import { Check, ChevronDown, Crown, Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useTenant } from "@/contexts/TenantContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher() {
  const { workspaceId, workspaceName, switchWorkspace, availableWorkspaces, isLoading } = useWorkspace();
  const { isPlatformOwner } = useTenant();

  const items = useMemo(
    () =>
      availableWorkspaces
        .filter((m) => m.membershipStatus === "active")
        .map((m) => ({ id: m.id, name: m.name || "—" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableWorkspaces],
  );

  // ── 👑 Operix — GLOBAL IDENTITY pill (always rendered for owner) ──
  const OwnerPill = isPlatformOwner ? (
    <div
      className="hidden md:flex items-center gap-1.5 px-2 h-8 rounded-md text-xs border border-amber-300/40 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-amber-400/10 text-amber-100"
      title="Operix"
    >
      <Crown className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-semibold max-w-[180px]">Operix</span>
    </div>
  ) : null;

  // ── 🛡️ Operational workspace selector ──
  let WorkspaceControl: ReactNode = null;

  if (isLoading) {
    WorkspaceControl = (
      <Button variant="ghost" size="sm" className="h-9 md:h-8 px-2 gap-1.5 text-muted-foreground" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </Button>
    );
  } else if (items.length === 0) {
    WorkspaceControl = null;
  } else if (items.length === 1) {
    // Single workspace — passive pill, no dropdown.
    WorkspaceControl = workspaceName ? (
      <div className="hidden md:flex items-center gap-1.5 px-2 h-8 rounded-md text-xs border border-border/40 bg-muted/20 text-foreground/90">
        <BrandLogo size={20} />
        <span className="truncate font-medium max-w-[180px]">{workspaceName}</span>
      </div>
    ) : null;
  } else {
    // Multiple workspaces — dropdown switcher.
    WorkspaceControl = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-9 md:h-8 px-2 sm:px-2.5 gap-1.5 text-xs border border-border/40 rounded-md max-w-[60vw] transition-colors",
              "text-foreground/90 hover:bg-accent/50",
            )}
          >
            <BrandLogo size={20} />
            <span className="truncate font-semibold max-w-[160px] sm:max-w-[220px]">
              {workspaceName || "—"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="z-[1002] w-[min(92vw,300px)] glass-panel border-border/60 p-1"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            {items.map((it) => {
              const active = it.id === workspaceId;
              return (
                <DropdownMenuItem
                  key={it.id}
                  onClick={() => switchWorkspace(it.id)}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer text-xs",
                    active && "bg-accent/60",
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{it.name}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-foreground/80" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (!OwnerPill && !WorkspaceControl) return null;

  return (
    <div className="flex items-center gap-2">
      {OwnerPill}
      {WorkspaceControl}
    </div>
  );
}
