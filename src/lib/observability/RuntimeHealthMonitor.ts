/**
 * RuntimeHealthMonitor — central observability hub.
 *
 * Singleton, side-effect free until `start()` is called from bootstrap.
 * Pure in-memory aggregation; capped buffers prevent leaks.
 *
 * What it observes:
 *  - Supabase realtime open/close/error (channel count, reconnects)
 *  - Provider latency samples (pushed by adapters)
 *  - Ingestion runs (pushed by ingest hooks/edge logs)
 *  - Edge function failures (pushed by callers)
 *  - Job failures (cron/automation, pushed by callers)
 *  - Event throughput (auto-counts realtime postgres_changes events)
 *
 * What it explicitly does NOT do:
 *  - No setInterval/polling.
 *  - No fetch wrapping (would interfere with TanStack Query).
 *  - No UI. A hidden panel can subscribe via `subscribe()`.
 */
import { supabase } from "@/integrations/supabase/client";
import { agentBus } from "@/lib/agentEventBus";
import type {
  HealthSnapshot, RealtimeHealth, ProviderLatencySample,
  IngestionSample, EdgeFunctionFailure, JobFailure, ThroughputBucket,
} from "./types";

const startedAt = Date.now();
let booted = false;

const realtime: RealtimeHealth = {
  status: "unknown",
  channelsOpen: 0,
  reconnects: 0,
};

const providerSamples = new Map<string, ProviderLatencySample[]>();
const ingestionRuns = new Map<string, IngestionSample[]>();
const edgeFailures: EdgeFunctionFailure[] = [];
const jobFailures: JobFailure[] = [];
const throughput = new Map<number, number>(); // minute -> count

const MAX_PER_PROVIDER = 50;
const MAX_PER_INGEST = 20;
const MAX_FAILURES = 50;
const MAX_THROUGHPUT_MINUTES = 60;

type Listener = (snap: HealthSnapshot) => void;
const listeners = new Set<Listener>();

function notify() {
  const snap = getSnapshot();
  listeners.forEach((l) => { try { l(snap); } catch { /* swallow */ } });
}

function pushCapped<T>(arr: T[], item: T, max: number) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

/* ---------------------------------------------------------------- API --- */

export function recordProviderLatency(sample: Omit<ProviderLatencySample, "at"> & { at?: number }) {
  const s: ProviderLatencySample = { at: Date.now(), ...sample };
  const list = providerSamples.get(s.provider) ?? [];
  pushCapped(list, s, MAX_PER_PROVIDER);
  providerSamples.set(s.provider, list);
  if (!s.ok) {
    agentBus.emit({
      kind: "operational_alert", level: "warn",
      title: `Provider ${s.provider} falhou`,
      detail: s.error?.slice(0, 200),
    });
  }
  notify();
}

export function recordIngestion(sample: Omit<IngestionSample, "at"> & { at?: number }) {
  const s: IngestionSample = { at: Date.now(), ...sample };
  const list = ingestionRuns.get(s.source) ?? [];
  pushCapped(list, s, MAX_PER_INGEST);
  ingestionRuns.set(s.source, list);
  notify();
}

export function recordEdgeFailure(fn: string, message: string, status?: number) {
  pushCapped(edgeFailures, { fn, message: message.slice(0, 240), status, at: Date.now() }, MAX_FAILURES);
  agentBus.emit({
    kind: "sync_failure", level: "error",
    title: `Edge function ${fn} falhou`,
    detail: `${status ?? ""} ${message}`.trim().slice(0, 200),
  });
  notify();
}

export function recordJobFailure(job: string, message: string) {
  pushCapped(jobFailures, { job, message: message.slice(0, 240), at: Date.now() }, MAX_FAILURES);
  notify();
}

export function recordRealtimeEvent() {
  const minute = Math.floor(Date.now() / 60_000);
  throughput.set(minute, (throughput.get(minute) ?? 0) + 1);
  if (throughput.size > MAX_THROUGHPUT_MINUTES) {
    const oldest = Math.min(...throughput.keys());
    throughput.delete(oldest);
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSnapshot(): HealthSnapshot {
  const providers: HealthSnapshot["providers"] = {};
  for (const [key, samples] of providerSamples) {
    const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
    const errors = samples.filter((s) => !s.ok).length;
    const last = samples[samples.length - 1];
    providers[key] = {
      samples: samples.length,
      avgLatencyMs: samples.length ? Math.round(sum / samples.length) : 0,
      p95LatencyMs: Math.round(p95),
      errorRate: samples.length ? errors / samples.length : 0,
      lastAt: last?.at ?? 0,
      lastOk: last?.ok ?? true,
    };
  }

  const ingestion: HealthSnapshot["ingestion"] = {};
  for (const [src, runs] of ingestionRuns) {
    const last = runs[runs.length - 1];
    ingestion[src] = {
      lastAt: last?.at ?? 0,
      lastOk: last?.ok ?? false,
      lastEvents: last?.events ?? 0,
      totalEvents: runs.reduce((a, r) => a + r.events, 0),
      failures: runs.filter((r) => !r.ok).length,
    };
  }

  const throughputPerMin: ThroughputBucket[] = Array.from(throughput.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, count]) => ({ minute, count }));

  return {
    realtime: { ...realtime },
    providers,
    ingestion,
    edgeFailures: [...edgeFailures].reverse(),
    jobFailures: [...jobFailures].reverse(),
    throughputPerMin,
    memoryMb: readMemoryMb(),
    uptimeMs: Date.now() - startedAt,
    generatedAt: Date.now(),
  };
}

function readMemoryMb(): number | undefined {
  try {
    const mem = (performance as any)?.memory;
    if (mem?.usedJSHeapSize) return Math.round(mem.usedJSHeapSize / 1048576);
  } catch { /* not supported */ }
  return undefined;
}

/* ---------------------------------------------------- realtime wiring --- */

export function start() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  try {
    const g = globalThis as any;
    if (!g.__SUPABASE_CLIENT__) {
      return;
    }
    const rt: any = (supabase as any).realtime;
    if (rt?.onOpen) {
      rt.onOpen(() => {
        if (realtime.status === "down" || realtime.status === "degraded") {
          realtime.reconnects += 1;
          realtime.lastReconnectAt = Date.now();
        }
        realtime.status = "ok";
        notify();
      });
      rt.onClose?.(() => {
        if (realtime.status === "ok") realtime.status = "degraded";
        notify();
      });
      rt.onError?.((err: any) => {
        realtime.status = "down";
        realtime.lastErrorAt = Date.now();
        realtime.lastError = String(err?.message ?? err ?? "unknown").slice(0, 200);
        notify();
      });
    }
    // Channel count is read on-demand via getChannels()
    Object.defineProperty(realtime, "channelsOpen", {
      get() { try { return (supabase as any).getChannels?.().length ?? 0; } catch { return 0; } },
    });
  } catch { /* realtime client may not be exposed */ }
}

export const RuntimeHealthMonitor = {
  start,
  getSnapshot,
  subscribe,
  recordProviderLatency,
  recordIngestion,
  recordEdgeFailure,
  recordJobFailure,
  recordRealtimeEvent,
};

export default RuntimeHealthMonitor;
