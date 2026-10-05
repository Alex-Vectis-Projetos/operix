/**
 * OperationalEventBus — unified, in-memory stream of operational events.
 *
 * Purpose
 * -------
 * Single fan-in point for everything that "happens" in the platform:
 *  - DB-sourced events (ai_alerts, discrepancies, hail_events,
 *    automation_executions, backend_event_logs) flow in via RealtimeHub
 *  - Runtime telemetry (provider failures, ingest results, edge failures,
 *    realtime reconnects) flow in via RuntimeHealthMonitor + agentBus
 *
 * Provides
 * --------
 *  - Normalised event shape (`OperationalEvent`)
 *  - Severity + priority + correlation key
 *  - Deduplication (same correlation_key within DEDUP_WINDOW)
 *  - Subscribe API for consumers (AI agent, hidden diagnostics)
 *  - Optional persistence into `operational_events` for runtime events
 *    that have no native DB origin (so we don't double-store)
 *
 * Non-goals
 * ---------
 *  - No polling, no timers.
 *  - No visual UI. Existing components keep their current rendering.
 */
import { RealtimeHub } from "@/lib/realtime/RealtimeHub";
import { agentBus, type AgentEvent } from "@/lib/agentEventBus";
import {
  RuntimeHealthMonitor,
  type HealthSnapshot,
} from "@/lib/observability";

export type OpSeverity = "info" | "warn" | "error" | "critical";
export type OpSource =
  | "ai_alerts"
  | "discrepancies"
  | "hail_events"
  | "automation_executions"
  | "backend_event_logs"
  | "provider_failure"
  | "ingest_log"
  | "runtime_event";

export interface OperationalEvent {
  id: string;                 // stable bus id
  workspaceId?: string | null;
  source: OpSource;
  kind: string;               // sub-type within source
  severity: OpSeverity;
  priority: number;           // 0 highest → 100 lowest
  title: string;
  detail?: string;
  correlationKey?: string;    // dedup / grouping
  refTable?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
  occurredAt: number;         // epoch ms
}

type Listener = (evt: OperationalEvent) => void;

const MAX_BUFFER = 500;
const DEDUP_WINDOW_MS = 60_000;

const buffer: OperationalEvent[] = [];
const listeners = new Set<Listener>();
const recentKeys = new Map<string, number>(); // correlationKey -> last ts

let booted = false;
let currentWorkspaceId: string | null = null;
const unsubscribers: Array<() => void> = [];

/* ---------------------------------------------------------------- API --- */

export function emit(evt: Omit<OperationalEvent, "id" | "occurredAt"> & { occurredAt?: number }) {
  const occurredAt = evt.occurredAt ?? Date.now();
  if (evt.correlationKey) {
    const last = recentKeys.get(evt.correlationKey);
    if (last && occurredAt - last < DEDUP_WINDOW_MS) return; // dropped — duplicate
    recentKeys.set(evt.correlationKey, occurredAt);
    if (recentKeys.size > 1000) {
      const cutoff = occurredAt - DEDUP_WINDOW_MS;
      for (const [k, t] of recentKeys) if (t < cutoff) recentKeys.delete(k);
    }
  }
  const out: OperationalEvent = {
    id: `${occurredAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    occurredAt,
    ...evt,
  };
  buffer.push(out);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  listeners.forEach((l) => { try { l(out); } catch { /* swallow */ } });

  // Persist runtime-only events (DB-sourced events already have a home)
  if (["provider_failure", "ingest_log", "runtime_event"].includes(out.source)) {
    void persist(out);
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getBuffer(): OperationalEvent[] {
  return [...buffer];
}

/** Reset all state (tests / hard reload). */
export function reset() {
  buffer.length = 0;
  recentKeys.clear();
  unsubscribers.splice(0).forEach((u) => { try { u(); } catch { /* noop */ } });
  booted = false;
  currentWorkspaceId = null;
}

/* ----------------------------------------------- severity / priority --- */

function severityFromLevel(level: string | undefined | null): OpSeverity {
  switch (String(level ?? "").toLowerCase()) {
    case "critical": case "fatal": return "critical";
    case "error":                  return "error";
    case "warn": case "warning":   return "warn";
    default:                       return "info";
  }
}

function priorityFor(severity: OpSeverity, source: OpSource): number {
  const base = { critical: 0, error: 15, warn: 40, info: 70 }[severity];
  const boost = source === "hail_events" || source === "provider_failure" ? -5 : 0;
  return Math.max(0, Math.min(100, base + boost));
}

/* ---------------------------------------------------- DB adapters ----- */

function wireDbAdapters(_workspaceId: string) {
  // DB streaming decommissioned in Phase 1 canonical architecture
}

/* --------------------------------------------- runtime + agentBus ----- */

function wireRuntimeAdapters() {
  // RuntimeHealthMonitor — snapshot diff: edge failures + provider samples
  let lastEdgeAt = 0;
  unsubscribers.push(RuntimeHealthMonitor.subscribe((snap: HealthSnapshot) => {
    // edge failures (newest first)
    for (const f of snap.edgeFailures) {
      if (f.at <= lastEdgeAt) break;
      emit({
        source: "runtime_event", kind: "edge_failure",
        severity: "error", priority: priorityFor("error", "runtime_event"),
        title: `Edge ${f.fn} falhou`,
        detail: `${f.status ?? ""} ${f.message}`.trim(),
        correlationKey: `edge:${f.fn}:${f.status ?? "x"}`,
        metadata: { status: f.status },
        occurredAt: f.at,
      });
    }
    lastEdgeAt = snap.edgeFailures[0]?.at ?? lastEdgeAt;

    // realtime status transitions
    if (snap.realtime.status === "down" || snap.realtime.status === "degraded") {
      emit({
        source: "runtime_event", kind: `realtime_${snap.realtime.status}`,
        severity: snap.realtime.status === "down" ? "error" : "warn",
        priority: priorityFor(snap.realtime.status === "down" ? "error" : "warn", "runtime_event"),
        title: `Realtime ${snap.realtime.status}`,
        detail: snap.realtime.lastError,
        correlationKey: `realtime:${snap.realtime.status}`,
      });
    }
  }));

  // agentBus — operational alerts + sync failures (provider failures often flow here)
  unsubscribers.push(agentBus.subscribe((e: AgentEvent) => {
    if (e.kind === "operational_alert" || e.kind === "sync_failure") {
      const src: OpSource = e.kind === "sync_failure" ? "provider_failure" : "runtime_event";
      const sev = severityFromLevel(e.level);
      emit({
        source: src, kind: e.kind,
        severity: sev, priority: priorityFor(sev, src),
        title: e.title,
        detail: e.detail,
        correlationKey: `${src}:${e.title}`,
        occurredAt: e.at,
      });
    }
  }));
}

/* ----------------------------------------------------- persistence ---- */

async function persist(_evt: OperationalEvent) {
  // In-memory bus; persistence to legacy tables decommissioned
}

/* --------------------------------------------------------- bootstrap --- */

/**
 * Initialise the bus. Call once after the workspace is known.
 * Idempotent — re-calling with the same workspace is a no-op; with a
 * different workspace it tears down old DB adapters and rewires.
 */
export function start(workspaceId: string | null | undefined) {
  if (booted && currentWorkspaceId === (workspaceId ?? null)) return;
  if (booted) reset();
  currentWorkspaceId = workspaceId ?? null;
  booted = true;

  if (typeof agentBus.subscribe === "function") wireRuntimeAdapters();
  if (workspaceId) wireDbAdapters(workspaceId);
}

export const OperationalEventBus = {
  start, emit, subscribe, getBuffer, reset,
};

export default OperationalEventBus;
