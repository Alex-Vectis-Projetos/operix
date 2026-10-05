/**
 * Phase 5 — Security event logger.
 *
 * Fire-and-forget client → `log_security_event` RPC. Never throws; on failure
 * we only log to the console so app flows remain unaffected.
 *
 * Event taxonomy (severity):
 *  - login / logout / login_failed       info | warn
 *  - permission_change                   warn
 *  - export / delete / critical_action   warn | critical
 *  - ai_access                           info
 *  - suspicious                          critical
 */
import { supabase } from "@/integrations/supabase/client";

export type SecurityEventType =
  | "login"
  | "login_failed"
  | "logout"
  | "permission_change"
  | "export"
  | "delete"
  | "ai_access"
  | "critical_action"
  | "suspicious";

export type SecuritySeverity = "info" | "warn" | "critical";

export interface SecurityEventPayload {
  type: SecurityEventType;
  severity?: SecuritySeverity;
  resource?: string | null;
  resourceId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
  riskScore?: number;
}

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "server";
  const ua = navigator.userAgent || "";
  if (/Mobi|Android/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua)) return "tablet";
  return "desktop";
}

let cachedIp: string | null = null;
async function resolveIp(): Promise<string | null> {
  if (cachedIp) return cachedIp;
  try {
    // Best-effort, no API key. Silent fallback on any failure.
    const r = await fetch("https://api.ipify.org?format=json", { cache: "force-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    cachedIp = (j?.ip as string) || null;
    return cachedIp;
  } catch {
    return null;
  }
}

export async function logSecurityEvent(p: SecurityEventPayload): Promise<void> {
  try {
    const apiBase =
      (
        (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_API_URL || ""
      ).replace(/\/$/, "") || "";
    const isDirectIpDevBuild = /\/\/72\.62\.27\.129:1010\b/.test(
      typeof window !== "undefined" ? window.location.origin : "",
    ) || /72\.62\.27\.129:4010\/api/.test(apiBase);
    const hasSupabase = Boolean(
      (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    );
    if (!hasSupabase || import.meta.env.DEV || isDirectIpDevBuild) {
      console.debug("[securityLog] skipped (non-Supabase or standalone build)", p);
      return;
    }
    const ip = await resolveIp();
    await supabase.rpc("log_security_event", {
      _event_type: p.type,
      _severity: p.severity ?? "info",
      _resource: p.resource ?? null,
      _resource_id: p.resourceId ?? null,
      _metadata: {
        ...(p.metadata ?? {}),
        device: deviceLabel(),
        href: typeof window !== "undefined" ? window.location.pathname : null,
      } as any,
      _workspace_id: p.workspaceId ?? null,
      _ip: ip,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      _risk_score: p.riskScore ?? 0,
    } as any);
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[securityLog] failed", e);
  }
}
