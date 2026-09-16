import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";
import { installAuthBreaker } from "./lib/authBreaker";

// -----------------------------------------------------------------------------
// EARLIEST-POSSIBLE Supabase fetch blocker (dev containers only)
//
// Installed BEFORE the Supabase client / Auth circuit breaker / ANY lazy
// chunk touches window.fetch. This is critical because:
//   1. The dev container :1010 origin is not allowlisted in Supabase CORS.
//   2. @supabase/supabase-js inside cached/duplicated chunks calls raw
//      fetch() against nwjiyfvaoogevqovnyon.supabase.co directly.
//   3. Replacing the `supabase` singleton in client.ts alone does NOT
//      prevent those stale chunk-internal fetches from firing — hence
//      Chromium still logs `net::ERR_FAILED` CORS errors in DevTools even
//      when the caller lives inside an ErrorBoundary that suppresses the
//      UI exception.
//
// This interceptor:
//   - Short-circuits ANY request whose URL targets the Supabase host,
//     returning a fake 204 Response with {data:null,error:...} so the
//     caller gets a promise-shaped result without hitting the network.
//   - Passes every other request (API, maps, CDN) to the original fetch.
//   - Is idempotent across reloads (uses a `globalThis.__QW_FETCH_MASK__`
//     sentinel) so duplicate bundles/React strict mode do not double-wrap.
//   - NEVER activates in production (builds with hostname that don't match
//     72.62.27.129:1010, or builds pointing to a production API URL).
// -----------------------------------------------------------------------------
(function installSupabaseFetchMaskOnce() {
  if (typeof window === "undefined") return;
  const gw = globalThis as any;
  if (gw.__QW_FETCH_MASK_INSTALLED__) return;
  gw.__QW_FETCH_MASK_INSTALLED__ = true;

  const env =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env ?? ({} as Record<string, string | undefined>);
  const VITE_API_URL = (env.VITE_API_URL || "").replace(/\/$/, "");
  const VITE_SUPABASE_URL = (env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const origin = window.location.origin;

  const blocked =
    import.meta.env.DEV ||
    /\/\/72\.62\.27\.129:1010\b/.test(origin) ||
    /72\.62\.27\.129:4010\/api/.test(VITE_API_URL);
  if (!blocked) return;

  let supabaseHost = "";
  try {
    supabaseHost = VITE_SUPABASE_URL ? new URL(VITE_SUPABASE_URL).host : "";
  } catch {
    /* ignore malformed env */
  }
  const HARDCODED_HOST = "nwjiyfvaoogevqovnyon.supabase.co";
  const matchesSupabase = (u: string): boolean =>
    (supabaseHost && u.includes(supabaseHost)) ||
    (u.includes(HARDCODED_HOST) || /nwjiyfvaoogevqovnyon\.supabase\.co/.test(u));

  const originalFetch = window.fetch.bind(window);
  const fake = () =>
    new Response(
      JSON.stringify({ data: null, error: { message: "supabase-blocked-in-dev" } }),
      { status: 204, statusText: "No Content", headers: { "Content-Type": "application/json" } },
    );

  window.fetch = function qwFetchMask(input: any, init?: RequestInit): Promise<Response> {
    try {
      let url = "";
      if (typeof input === "string") url = input;
      else if (input && typeof input.url === "string") url = input.url;
      if (url && matchesSupabase(url)) return Promise.resolve(fake());
    } catch {
      /* fall through to real fetch */
    }
    return originalFetch(input, init);
  } as typeof window.fetch;
  console.debug(
    "[FETCH_MASK] Supabase REST/RPC requests blocked in dev origin",
    { origin, VITE_API_URL, VITE_SUPABASE_URL_HOST: supabaseHost || HARDCODED_HOST },
  );
})();

// -----------------------------------------------------------------------------
// Polyfill minimal: crypto.randomUUID (dev container served via HTTP)
//
// randomUUID() requires [SecureContext] in Chromium/Firefox — plain HTTP
// origins (even loopback/IP) return undefined for crypto.randomUUID, which
// makes the SDK/panels crash during UUID generation.
// We always install this polyfill (idempotent) for non-secure contexts.
// -----------------------------------------------------------------------------
(function polyfillRandomUuidIfMissing() {
  if (typeof window === "undefined") return;
  const gw = globalThis as any;
  try {
    if (gw.crypto && typeof gw.crypto.randomUUID === "function") return;
  } catch {
    /* noop */
  }
  const crypto =
    (gw.crypto as Crypto) ||
    ((gw.crypto = {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
        return arr;
      },
    }) as Crypto);
  const hex = (n: number): string =>
    (n < 16 ? "0" : "") + n.toString(16);
  function randomUUID(): string {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h: string[] = [];
    for (let i = 0; i < 16; i++) h.push(hex(b[i]));
    return (
      h.slice(0, 4).join("") +
      "-" +
      h.slice(4, 6).join("") +
      "-" +
      h.slice(6, 8).join("") +
      "-" +
      h.slice(8, 10).join("") +
      "-" +
      h.slice(10, 16).join("")
    );
  }
  if (!gw.crypto.randomUUID) {
    Object.defineProperty(gw.crypto, "randomUUID", {
      value: randomUUID,
      writable: true,
      configurable: true,
    });
  }
})();

// Install auth circuit breaker BEFORE the Supabase client touches window.fetch.
// Survives GoTrue 504 storms without infinite spinners.
installAuthBreaker();

// Sentry: minimal error/runtime monitoring — initialized once at bootstrap.
const SENTRY_DSN_FALLBACK =
  "https://746d269b547c16ec650ebe86b9a6ac37@o4511469175504896.ingest.de.sentry.io/4511469204668496";
const sentryDsn = import.meta.env.VITE_SENTRY_DSN || SENTRY_DSN_FALLBACK;
if (sentryDsn && typeof sentryDsn === "string") {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const tunnelUrl = projectId
    ? `https://${projectId}.supabase.co/functions/v1/sentry-tunnel`
    : "/api/sentry-tunnel";
  const isDev = import.meta.env.DEV;
  Sentry.init({
    dsn: sentryDsn,
    tunnel: tunnelUrl,
    debug: isDev,
    environment: import.meta.env.MODE,
    release: `qwork-nexus@${import.meta.env.MODE}`,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: isDev ? 1.0 : 0.1,
    replaysSessionSampleRate: isDev ? 0.1 : 0,
    replaysOnErrorSampleRate: isDev ? 1.0 : 0.2,
    transportOptions: { fetchOptions: { keepalive: true } },
  });
  if (isDev) {
    (window as any).__qwSentry = {
      test: () => Sentry.captureException(new Error("TESTE_SENTRY_QWORK")),
      flush: (ms = 3000) => Sentry.getClient()?.flush(ms),
      dsn: sentryDsn,
      tunnel: tunnelUrl,
    };
  }
}

createRoot(document.getElementById("root")!).render(<App />);
