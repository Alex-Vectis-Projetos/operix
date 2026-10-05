import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { agentBus } from "@/lib/agentEventBus";

/**
 * Lightweight context awareness for the AI Agent shell.
 * - Reads route from react-router (no extra provider).
 * - Tracks online/offline.
 * - Listens to window 'error' / 'unhandledrejection' to feed the event bus.
 *
 * No polling, no websocket, no query subscriptions.
 */

const ROUTE_LABELS: Record<string, { module: string; label: string }> = {
  "/": { module: "dashboard", label: "Centro Operacional" },
  "/service-orders": { module: "service_orders", label: "Ordens de Serviço" },
  "/production": { module: "production", label: "Produção" },
  "/payment-orders": { module: "payment_orders", label: "Ordens de Pagamento" },
  "/financial": { module: "financial", label: "Financeiro" },
  "/profit": { module: "profit", label: "Distribuição de Lucros" },
  "/fleet": { module: "fleet", label: "Frota" },
  "/documents": { module: "documents", label: "Documentos" },
  "/users": { module: "users", label: "Usuários" },
  "/settings": { module: "settings", label: "Configurações" },
  "/ai": { module: "ai", label: "Operix AI" },
  "/automations": { module: "automations", label: "Automações" },
  "/audit": { module: "audit", label: "Auditoria" },
  "/billing": { module: "billing", label: "Faturamento" },
  "/profile": { module: "profile", label: "Perfil" },
};

function resolveRoute(pathname: string) {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  const base = "/" + pathname.split("/").filter(Boolean)[0];
  return ROUTE_LABELS[base] ?? { module: "app", label: "Operix" };
}

export interface AgentContext {
  pathname: string;
  module: string;
  label: string;
  online: boolean;
  realtimeOk: boolean;
}

export function useAgentContext(): AgentContext {
  const { pathname } = useLocation();
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    const onErr = (e: ErrorEvent) => {
      agentBus.emit({
        kind: "runtime_error",
        level: "error",
        title: "Erro em runtime",
        detail: e.message,
      });
    };
    const onRej = (e: PromiseRejectionEvent) => {
      agentBus.emit({
        kind: "runtime_error",
        level: "error",
        title: "Promise rejeitada",
        detail: String(e.reason?.message ?? e.reason ?? "unknown"),
      });
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  const route = useMemo(() => resolveRoute(pathname), [pathname]);

  useEffect(() => {
    agentBus.emit({
      kind: "context_change",
      level: "info",
      title: `Você está em ${route.label}`,
      meta: { pathname, module: route.module },
    });
  }, [pathname, route.label, route.module]);

  return {
    pathname,
    module: route.module,
    label: route.label,
    online,
    realtimeOk: online, // Phase 1: proxy via connectivity; will refine later
  };
}
