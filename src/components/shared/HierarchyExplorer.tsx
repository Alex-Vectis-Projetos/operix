import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  ChevronRight,
  FolderTree,
  Calendar,
  CalendarDays,
  Landmark,
  MapPin,
  HardHat,
  Wrench,
  Factory,
  FileText,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

/**
 * Hierarchical operational explorer (Phase 1A).
 *
 * Levels: Year → Client → Operational Unit → Week → Technician
 *
 * Each node exposes:
 *   - 👉 (chevron) → expand/collapse next level
 *   - 👁 (eye)    → set this node as the active "view context" (filters tables)
 *
 * Pure presentation: state of opened nodes + active context is persisted in
 * localStorage under the given `storageKey` so that switching between SO/PO
 * pages keeps the user's last view.
 */

export type HierarchyRecord = {
  id: string;
  created_at?: string | null;
  client_name?: string | null;
  platform?: string | null;
  operational_unit?: string | null;
  week?: string | null;
  list_name?: string | null; // PO uses list_name as week fallback
  technician_name?: string | null;
  assigned_user_id?: string | null;
  user_id?: string | null;
};

export type HierarchySection = "operacional" | "documentos" | "relatorios";

export type HierarchyContext = {
  level: "all" | "year" | "client" | "platform" | "unit" | "week" | "technician";
  section?: HierarchySection;
  year?: string;
  client?: string;
  platform?: string;
  unit?: string;
  week?: string;
  technician?: string;
};

const EMPTY_CTX: HierarchyContext = { level: "all" };

// Per-level fallback labels — never collapse a row into a generic "—".
// These are what the user sees in the tree AND what is matched in filters.
export const HIERARCHY_FALLBACK = {
  year: "Sem Data",
  client: "Sem Cliente",
  platform: "Plataforma",
  unit: "Work",
  week: "Sem Semana",
  technician: "Sem Técnico",
} as const;

/** Static container label inserted between Client and Platform/Local. */
export const WORK_CONTAINER_LABEL = "Work";

function getYear(r: HierarchyRecord): string {
  if (!r.created_at) return HIERARCHY_FALLBACK.year;
  const d = new Date(r.created_at);
  return Number.isNaN(d.getTime()) ? HIERARCHY_FALLBACK.year : String(d.getFullYear());
}
function getWeek(r: HierarchyRecord): string {
  return (r.week || r.list_name || "").trim() || HIERARCHY_FALLBACK.week;
}
function getClient(r: HierarchyRecord): string {
  return (r.client_name || "").trim() || HIERARCHY_FALLBACK.client;
}
function getPlatform(r: HierarchyRecord): string {
  return (r.platform || "").trim() || HIERARCHY_FALLBACK.platform;
}
function getUnit(r: HierarchyRecord): string {
  return (r.operational_unit || "").trim() || HIERARCHY_FALLBACK.unit;
}
function getTech(r: HierarchyRecord): string {
  return (r.technician_name || "").trim() || HIERARCHY_FALLBACK.technician;
}

const FALLBACK_VALUES = new Set<string>(Object.values(HIERARCHY_FALLBACK));

/** Apply a HierarchyContext to a list of records. */
export function applyHierarchyContext<T extends HierarchyRecord>(
  records: T[],
  ctx: HierarchyContext,
): T[] {
  if (ctx.level === "all") return records;
  return records.filter((r) => {
    if (ctx.year && getYear(r) !== ctx.year) return false;
    if (ctx.client && getClient(r) !== ctx.client) return false;
    if (ctx.platform && getPlatform(r) !== ctx.platform) return false;
    if (ctx.unit && getUnit(r) !== ctx.unit) return false;
    if (ctx.week && getWeek(r) !== ctx.week) return false;
    if (ctx.technician && getTech(r) !== ctx.technician) return false;
    return true;
  });
}

type TreeNode = {
  key: string;
  label: string;
  count: number;
  ctx: HierarchyContext;
  children?: TreeNode[];
  disabled?: boolean;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
};

function groupBy<T>(items: T[], keyFn: (i: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return map;
}

function sortKeys(keys: string[], opts?: { numericAsc?: boolean; numericDesc?: boolean }) {
  return [...keys].sort((a, b) => {
    if (FALLBACK_VALUES.has(a) && !FALLBACK_VALUES.has(b)) return 1;
    if (FALLBACK_VALUES.has(b) && !FALLBACK_VALUES.has(a)) return -1;
    if (opts?.numericDesc || opts?.numericAsc) {
      const an = Number(a);
      const bn = Number(b);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return opts.numericAsc ? an - bn : bn - an;
      }
    }
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function buildPlaceholderTree(year: string): TreeNode[] {
  // Live placeholder shown when a year has no real OS/OP records yet.
  // Structure: Operações → Work → Técnico. Disappears as soon as real data arrives.
  return [
    {
      key: `y:${year}|placeholder|ops`,
      label: "Operações",
      count: 0,
      icon: Wrench,
      ctx: { level: "year", year } as HierarchyContext,
      disabled: true,
      hint: "Sem dados",
      children: [
        {
          key: `y:${year}|placeholder|ops|work`,
          label: "Work",
          count: 0,
          icon: Factory,
          ctx: { level: "year", year } as HierarchyContext,
          disabled: true,
          hint: "Sem dados",
          children: [
            {
              key: `y:${year}|placeholder|ops|work|tech`,
              label: "Técnico",
              count: 0,
              icon: HardHat,
              ctx: { level: "year", year } as HierarchyContext,
              disabled: true,
              hint: "Sem dados",
            },
          ],
        },
      ],
    },
  ];
}

function buildTree(records: HierarchyRecord[], weekIcon?: LucideIcon, extraYears: string[] = []): TreeNode[] {
  const byYear = groupBy(records, getYear);
  const currentCalendarYear = String(new Date().getFullYear());
  const allYears = new Set<string>([...byYear.keys(), ...extraYears, currentCalendarYear]);
  return sortKeys([...allYears], { numericAsc: true }).map((year) => {
    const yearRows = byYear.get(year) ?? [];
    const byClient = groupBy(yearRows, getClient);
    // Year → Client → Platform → Technician → Week. NO "Operacional" wrapper.
    const operationalChildren: TreeNode[] = sortKeys([...byClient.keys()]).map((client) => {
      const clientRows = byClient.get(client)!;
      const byPlatform = groupBy(clientRows, getPlatform);
      const platformChildren: TreeNode[] = sortKeys([...byPlatform.keys()]).map((platform) => {
        const platRows = byPlatform.get(platform)!;
        const byTech = groupBy(platRows, getTech);
        return {
          key: `y:${year}|c:${client}|p:${platform}`,
          label: platform,
          count: platRows.length,
          icon: MapPin,
          ctx: { level: "platform", year, client, platform, section: "operacional" } as HierarchyContext,
          children: sortKeys([...byTech.keys()]).map((tech) => {
            const techRows = byTech.get(tech)!;
            const byWeek = groupBy(techRows, getWeek);
            return {
              key: `y:${year}|c:${client}|p:${platform}|t:${tech}`,
              label: tech,
              count: techRows.length,
              icon: HardHat,
              ctx: { level: "technician", year, client, platform, technician: tech, section: "operacional" } as HierarchyContext,
              children: sortKeys([...byWeek.keys()]).map((week) => ({
                key: `y:${year}|c:${client}|p:${platform}|t:${tech}|w:${week}`,
                label: week,
                count: byWeek.get(week)!.length,
                icon: weekIcon ?? CalendarDays,
                ctx: {
                  level: "week",
                  year,
                  client,
                  platform,
                  technician: tech,
                  week,
                  section: "operacional",
                } as HierarchyContext,
              })),
            };
          }),
        };
      });
      return {
        key: `y:${year}|c:${client}`,
        label: client,
        count: clientRows.length,
        icon: Landmark,
        ctx: { level: "client", year, client, section: "operacional" } as HierarchyContext,
        children: platformChildren,
      };
    });
    return {
      key: `y:${year}`,
      label: year,
      count: yearRows.length,
      icon: Calendar,
      // No `section` on the year ctx → enables the inline delete button.
      ctx: { level: "year", year } as HierarchyContext,
      children: [
        ...(operationalChildren.length > 0
          ? operationalChildren
          : buildPlaceholderTree(year)),
        // Sub-sections that always exist per year — restoration of the
        // Documentos / Relatórios entry points (do not remove).
        {
          key: `y:${year}|section:documentos`,
          label: "Documentos",
          count: 0,
          icon: FileText,
          ctx: { level: "year", year, section: "documentos" } as HierarchyContext,
        },
        {
          key: `y:${year}|section:relatorios`,
          label: "Relatórios",
          count: 0,
          icon: BarChart3,
          ctx: { level: "year", year, section: "relatorios" } as HierarchyContext,
        },
      ],
    };
  });
}

function ctxLabel(ctx: HierarchyContext): string {
  if (ctx.level === "all") return "Tudo";
  const parts: string[] = [];
  if (ctx.year) parts.push(ctx.year);
  if (ctx.client) parts.push(ctx.client);
  if (ctx.unit) parts.push(ctx.unit);
  if (ctx.week) parts.push(ctx.week);
  if (ctx.technician) parts.push(ctx.technician);
  return parts.join(" › ");
}

interface RowProps {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (k: string) => void;
  active: HierarchyContext;
  onView: (ctx: HierarchyContext) => void;
  onRequestDelete?: (year: string) => void;
}

function Row({ node, depth, open, toggle, active, onView, onRequestDelete }: RowProps) {
  const isOpen = open.has(node.key);
  const hasChildren = !!node.children?.length;
  const isDisabled = !!node.disabled;
  const isActive = !isDisabled &&
    active.level === node.ctx.level &&
    active.year === node.ctx.year &&
    active.client === node.ctx.client &&
    active.platform === node.ctx.platform &&
    active.unit === node.ctx.unit &&
    active.week === node.ctx.week &&
    active.technician === node.ctx.technician &&
    active.section === node.ctx.section;

  const Icon = node.icon;
  const handleActivate = () => {
    if (isDisabled) return;
    onView(node.ctx);
    if (hasChildren && !isOpen) toggle(node.key);
  };

  const isDeletable =
    node.ctx.level === "year" &&
    !node.ctx.section &&
    !!node.ctx.year;
  

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-sm pr-1 text-xs transition-colors",
          isDisabled
            ? "opacity-60"
            : "hover:bg-sidebar-accent/50 cursor-pointer",
          isActive && "bg-sidebar-accent text-primary",
        )}
        style={{ paddingLeft: depth * 10 + 4 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren && !isDisabled) toggle(node.key);
          }}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm",
            hasChildren && !isDisabled ? "hover:bg-sidebar-accent" : "opacity-30",
          )}
          aria-label={isOpen ? "Recolher" : "Expandir"}
          disabled={isDisabled || !hasChildren}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              isOpen && hasChildren && "rotate-90",
            )}
          />
        </button>

        {Icon && (
          <Icon
            className={cn(
              "h-3 w-3 shrink-0",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          />
        )}

        <span
          className={cn("flex-1 truncate py-1", isDisabled && "italic text-muted-foreground")}
          title={node.label}
          onClick={handleActivate}
        >
          {node.label}
        </span>

        {isDeletable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete?.(node.ctx.year!);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Excluir ano operacional"
            aria-label="Excluir ano operacional"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <Row
              key={child.key}
              node={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              active={active}
              onView={onView}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface Props {
  records: HierarchyRecord[];
  storageKey: string;
  context: HierarchyContext;
  onContextChange: (ctx: HierarchyContext) => void;
  title?: string;
  /** Optional override for the empty state. Falls back to a smart contextual message. */
  emptyMessage?: string;
  /** Phase 1E — allow complete lateral collapse into icon-only rail. */
  collapsible?: boolean;
  /** Optional controlled collapsed state. When provided, parent owns the value. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Optional override for the week-level icon (default CalendarDays). */
  weekIcon?: LucideIcon;
  /** Phase 1F-C — wipe all data attached to a year. Receives the year as string. */
  onDeleteYear?: (year: string) => Promise<void> | void;
  /** Force todos os nós da árvore a começarem RECOLHIDOS (padrão novo comportamento). */
  defaultAllCollapsed?: boolean;
}

export function HierarchyExplorer({
  records,
  storageKey,
  context,
  onContextChange,
  title = "OPERACIONAL",
  emptyMessage,
  collapsible = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  weekIcon,
  onDeleteYear,
  defaultAllCollapsed = false,
}: Props) {
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}.collapsed`);
      if (defaultAllCollapsed) return raw === null ? true : raw === "1";
      return raw === "1";
    } catch {
      return defaultAllCollapsed ? true : false;
    }
  });
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? (v as (p: boolean) => boolean)(collapsed) : v;
    if (controlledCollapsed === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const [open, setOpen] = useState<Set<string>>(() => {
    if (defaultAllCollapsed) return new Set<string>();
    try {
      const raw = localStorage.getItem(`${storageKey}.open`);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const [extraYears, setExtraYears] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}.extraYears`);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}.extraYears`, JSON.stringify(extraYears));
    } catch {
      /* ignore */
    }
  }, [extraYears, storageKey]);

  const [addingYear, setAddingYear] = useState(false);
  const [yearInput, setYearInput] = useState("");
  const [yearError, setYearError] = useState<string | null>(null);
  const [pendingDeleteYear, setPendingDeleteYear] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const yearInputRef = useRef<HTMLInputElement>(null);

  const dataYears = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) set.add(getYear(r));
    return set;
  }, [records]);

  const startAddYear = useCallback(() => {
    setAddingYear(true);
    setYearInput("");
    setYearError(null);
    setTimeout(() => yearInputRef.current?.focus(), 0);
  }, []);

  const cancelAddYear = useCallback(() => {
    setAddingYear(false);
    setYearInput("");
    setYearError(null);
  }, []);

  const commitAddYear = useCallback(() => {
    const trimmed = yearInput.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      setYearError("4 dígitos");
      return;
    }
    setExtraYears((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setAddingYear(false);
    setYearInput("");
    setYearError(null);
  }, [yearInput]);

  const confirmDeleteYear = useCallback(async (year: string) => {
    setDeleteBusy(true);
    try {
      // If year has stored data, hand off to parent to wipe it.
      if (dataYears.has(year)) {
        await onDeleteYear?.(year);
      }
      setExtraYears((prev) => prev.filter((y) => y !== year));
      if (context.year === year) {
        onContextChange(EMPTY_CTX);
      }
    } finally {
      setDeleteBusy(false);
      setPendingDeleteYear(null);
    }
  }, [dataYears, onDeleteYear, context.year, onContextChange]);

  // Persist opened nodes
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}.open`, JSON.stringify([...open]));
    } catch {
      /* ignore */
    }
  }, [open, storageKey]);

  // Persist context
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}.ctx`, JSON.stringify(context));
    } catch {
      /* ignore */
    }
  }, [context, storageKey]);

  // Persist collapsed state
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}.collapsed`, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed, storageKey]);

  const tree = useMemo(() => buildTree(records, weekIcon, extraYears), [records, weekIcon, extraYears]);

  const toggle = useCallback((k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const total = records.length;

  // Smart, context-aware empty state.
  const smartEmpty = (() => {
    if (emptyMessage) return emptyMessage;
    if (records.length === 0) return "Nenhum registro salvo ainda.";
    if (context.level === "technician") return "Nenhum registro deste técnico.";
    if (context.level === "week") return "Nenhum registro nesta semana.";
    if (context.level === "unit") return "Nenhum registro nesta unidade.";
    if (context.level === "client") return "Nenhum registro deste cliente.";
    if (context.level === "year") return "Nenhum registro neste período.";
    return "Sem dados para organizar.";
  })();

  return (
    <aside className="flex h-full w-full flex-col">
      <header
        className={cn(
          "flex items-center gap-2 px-1 py-1.5",
          context.level === "all" && "text-primary",
        )}
      >
        <div
          className="flex flex-1 items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground"
          onClick={() => onContextChange(EMPTY_CTX)}
          title="Limpar contexto"
        >
          <FolderTree className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>{title}</span>}
        </div>
        {!collapsed && !addingYear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startAddYear();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            title="Novo ano operacional"
            aria-label="Novo ano operacional"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-sidebar-accent transition-colors"
            title={collapsed ? "Expandir" : "Recolher"}
            aria-label={collapsed ? "Expandir" : "Recolher"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3 w-3" />
            ) : (
              <PanelLeftClose className="h-3 w-3" />
            )}
          </button>
        )}
      </header>

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1 overflow-auto py-2">
          {tree.map((node) => {
            const isActive = context.year === node.label;
            return (
              <button
                key={node.key}
                type="button"
                onClick={() => {
                  setCollapsed(false);
                  onContextChange(node.ctx);
                }}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                )}
                title={node.label}
              >
                <Calendar className="h-3.5 w-3.5" />
              </button>
            );
          })}
          {context.level !== "all" && (
            <div className="mt-2 flex flex-col items-center gap-1 border-t border-border/40 pt-2 w-full px-1">
              {[context.year, context.client, context.unit, context.week, context.technician]
                .filter(Boolean)
                .map((label, i) => (
                  <span
                    key={i}
                    className="block w-full truncate text-center text-[9px] text-muted-foreground"
                    title={label}
                  >
                    {label}
                  </span>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-1">
          {addingYear && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/40 bg-sidebar-accent/30">
              <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                ref={yearInputRef}
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={yearInput}
                onChange={(e) => { setYearInput(e.target.value.replace(/\D/g, "")); setYearError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitAddYear(); }
                  else if (e.key === "Escape") { e.preventDefault(); cancelAddYear(); }
                }}
                onBlur={() => { if (!yearInput.trim()) cancelAddYear(); }}
                placeholder="2027"
                className={cn(
                  "flex-1 min-w-0 bg-transparent border-b text-xs outline-none px-0.5 py-0",
                  yearError ? "border-destructive text-destructive" : "border-primary/60 text-foreground",
                )}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitAddYear}
                className="text-[10px] px-1.5 py-0.5 rounded-sm text-primary hover:bg-sidebar-accent"
              >
                OK
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelAddYear}
                className="text-[10px] px-1.5 py-0.5 rounded-sm text-muted-foreground hover:bg-sidebar-accent"
              >
                ✕
              </button>
            </div>
          )}
          {tree.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {smartEmpty}
            </p>
          ) : (
            tree.map((node) => (
              <Row
                key={node.key}
                node={node}
                depth={0}
                open={open}
                toggle={toggle}
                active={context}
                onView={onContextChange}
                onRequestDelete={(year) => setPendingDeleteYear(year)}
              />
            ))
          )}
        </div>
      )}

      <AlertDialog
        open={!!pendingDeleteYear}
        onOpenChange={(v) => { if (!v && !deleteBusy) setPendingDeleteYear(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Excluir operacional de {pendingDeleteYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deseja realmente apagar o operacional de <strong className="text-foreground">{pendingDeleteYear}</strong>?
              {pendingDeleteYear && dataYears.has(pendingDeleteYear) ? (
                <> Esta ação remove <strong className="text-destructive">todos os registros, documentos e relatórios</strong> deste ano. Não pode ser desfeita.</>
              ) : (
                <> Este ano foi adicionado manualmente e ainda não tem registros — será removido apenas da lista.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteYear) confirmDeleteYear(pendingDeleteYear);
              }}
            >
              {deleteBusy ? "Excluindo..." : "Sim, excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

/** Restores last persisted context for a given storageKey. */
export function loadHierarchyContext(storageKey: string): HierarchyContext {
  try {
    const raw = localStorage.getItem(`${storageKey}.ctx`);
    if (!raw) return EMPTY_CTX;
    const parsed = JSON.parse(raw) as HierarchyContext;
    if (parsed && typeof parsed === "object" && parsed.level) return parsed;
  } catch {
    /* ignore */
  }
  return EMPTY_CTX;
}
