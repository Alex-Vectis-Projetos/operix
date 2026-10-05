/**
 * Phase 5.5 — Lightweight device fingerprint + auto-registration.
 *
 * Best-effort: persists a stable per-browser ID in localStorage, enriches
 * with UA / locale info, calls `register_device` once per session. Silent on
 * failure — never blocks the auth flow.
 */
import { supabase } from "@/integrations/supabase/client";

const FP_KEY = "qw_device_fp";

export function getDeviceFingerprint(): string {
  try {
    let fp = localStorage.getItem(FP_KEY);
    if (!fp) {
      fp = crypto.randomUUID();
      localStorage.setItem(FP_KEY, fp);
    }
    return fp;
  } catch {
    return "anonymous";
  }
}

function parseUA(): { browser: string; os: string; deviceType: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  let os = "Unknown";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  let deviceType = "desktop";
  if (/Mobi|Android/i.test(ua)) deviceType = "mobile";
  else if (/Tablet|iPad/i.test(ua)) deviceType = "tablet";
  return { browser, os, deviceType };
}

let cachedIp: string | null = null;
async function resolveIp(): Promise<string | null> {
  if (cachedIp) return cachedIp;
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "force-cache" });
    if (!r.ok) return null;
    cachedIp = ((await r.json())?.ip as string) || null;
    return cachedIp;
  } catch {
    return null;
  }
}

let registered = false;
export async function registerCurrentDevice(workspaceId?: string | null) {
  if (registered) return;
  registered = true;
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
      return;
    }
    const { browser, os, deviceType } = parseUA();
    const ip = await resolveIp();
    await supabase.rpc("register_device" as any, {
      _fingerprint: getDeviceFingerprint(),
      _browser: browser,
      _os: os,
      _device_type: deviceType,
      _ip: ip,
      _country: null,
      _city: null,
      _workspace_id: workspaceId ?? null,
    });
  } catch {
    /* silent */
  }
}
