/**
 * Multimodal helpers for the operational agent.
 *
 * Wraps the existing `agent-chat` edge function (now multimodal) with a
 * client-side streaming call that accepts image + audio attachments and
 * pulls operational context (signals, runtime snapshot, recent errors)
 * automatically.
 *
 * No new edge function — same endpoint, richer payload.
 */
import { getDiagnosticsSnapshot } from "./runtimeDiagnostics";
import { AgentRuntime } from "./agent";
import { RuntimeHealthMonitor } from "./observability";
import type { OperationalSignal } from "@/hooks/useOperationalSignals";
import type { AgentEvent } from "./agentEventBus";
import { getAccessToken } from "./authSession";
import { API_BASE_URL } from "./api";

const CHAT_URL = `${API_BASE_URL}/agent/chat`;

const MIN_INTERVAL_MS = 1500;
let lastCallAt = 0;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export interface ConvTurn {
  role: "user" | "assistant";
  content: string | ContentPart[];
}

export interface ConvContext {
  route: string;
  module: string;
  online: boolean;
  workspaceId: string;
  signals: OperationalSignal[];
  recentEvents: AgentEvent[];
  /** Append the runtime snapshot (agent signals + health) as JSON context. */
  attachRuntimeSnapshot?: boolean;
  /** Operator-attached error blobs. */
  errorAttachments?: Array<{ source: string; message: string; at?: number }>;
}

export interface ConvStreamOptions {
  history: ConvTurn[];
  context: ConvContext;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  signal?: AbortSignal;
  model?: string;
}

export class RateLimitedError extends Error {
  constructor() { super("Aguarda um instante antes de enviar outra mensagem."); }
}

/* -------------------------------------------------- attachment utils -- */

/** Read a File/Blob as a data URL (base64). */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(file);
  });
}

/** Strip the data URL prefix so we get just the base64 body. */
export function dataUrlToBase64(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return { mime: "application/octet-stream", b64: dataUrl };
  return { mime: m[1], b64: m[2] };
}

/* -------------------------------------------------- streaming call ---- */

export async function streamMultimodalReply(opts: ConvStreamOptions): Promise<void> {
  const now = Date.now();
  if (now - lastCallAt < MIN_INTERVAL_MS) throw new RateLimitedError();
  lastCallAt = now;
  const token = getAccessToken();
  if (!token) throw new Error("Sessão inválida. Faça login novamente.");

  const diag = getDiagnosticsSnapshot();
  const ctx = opts.context;

  const runtimeSnapshot = ctx.attachRuntimeSnapshot
    ? buildRuntimeSnapshot()
    : undefined;

  const payload = {
    model: opts.model,
    workspace_id: ctx.workspaceId,
    messages: opts.history,
    context: {
      route: ctx.route,
      module: ctx.module,
      online: ctx.online,
      realtime: diag.realtime,
      consoleErrors: diag.consoleErrors,
      renderCrashes: diag.renderCrashes,
      signals: ctx.signals.map((s) => ({
        id: s.id, level: s.level, title: s.title, detail: s.detail,
      })),
      recentEvents: ctx.recentEvents.slice(-10).map((e) => ({
        kind: e.kind, level: e.level, title: e.title, detail: e.detail, at: e.at,
      })),
      runtimeSnapshot,
      errorAttachments: ctx.errorAttachments,
    },
  };

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!resp.ok || !resp.body) {
    let msg = `Erro ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) opts.onDelta(delta);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const json = raw.slice(6).trim();
      if (json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) opts.onDelta(delta);
      } catch { /* ignore */ }
    }
  }

  opts.onDone();
}

/* -------------------------------------------------- runtime snapshot -- */

function buildRuntimeSnapshot(): Record<string, unknown> {
  try {
    const ctx = AgentRuntime.getContext();
    const health = RuntimeHealthMonitor.getSnapshot();
    return {
      generatedAt: ctx.generatedAt,
      windowMs: ctx.windowMs,
      bySeverity: ctx.bySeverity,
      signals: ctx.signals.slice(0, 8).map((s) => ({
        kind: s.kind, urgency: s.urgency, title: s.title,
        count: s.count, lastSeenAt: s.lastSeenAt,
      })),
      counters: ctx.counters,
      realtime: health.realtime,
      ingestion: health.ingestion,
      edgeFailures: health.edgeFailures.slice(0, 5),
      providers: health.providers,
    };
  } catch {
    return {};
  }
}
