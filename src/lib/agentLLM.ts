/**
 * Agent LLM client — desacoplado, streaming, multi-provider ready.
 *
 * Hoje: Lovable AI Gateway (Gemini/GPT) via edge function `agent-chat`.
 * Amanhã: adicionar providers (OpenAI direto, Claude, modelos locais) seguindo
 * a mesma interface `streamAgentReply`.
 *
 * Cost protection:
 *  - debounce (chamador controla)
 *  - rate limit local (min interval entre requests)
 *  - token cap server-side (max_tokens 600)
 *  - histórico cortado a 12 turns
 *  - AbortController para cancelar
 */
import type { OperationalSignal } from "@/hooks/useOperationalSignals";
import type { AgentEvent } from "./agentEventBus";
import { getDiagnosticsSnapshot } from "./runtimeDiagnostics";
import { getAccessToken } from "./authSession";
import { API_BASE_URL } from "./api";

const CHAT_URL = `${API_BASE_URL}/agent/chat`;

const MIN_INTERVAL_MS = 1500; // rate limit local
let lastCallAt = 0;

export type AgentTurn = { role: "user" | "assistant"; content: string };

export interface AgentLLMContext {
  route: string;
  module: string;
  online: boolean;
  workspaceId: string;
  signals: OperationalSignal[];
  recentEvents: AgentEvent[];
}

export interface StreamOptions {
  history: AgentTurn[];
  context: AgentLLMContext;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

export class RateLimitedError extends Error {
  constructor() { super("Aguarda um instante antes de enviar outra mensagem."); }
}

export async function streamAgentReply(opts: StreamOptions): Promise<void> {
  const now = Date.now();
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    throw new RateLimitedError();
  }
  lastCallAt = now;
  const token = getAccessToken();
  if (!token) {
    throw new Error("Sessão inválida. Faça login novamente.");
  }

  const diag = getDiagnosticsSnapshot();

  const payload = {
    messages: opts.history,
    workspace_id: opts.context.workspaceId,
    context: {
      route: opts.context.route,
      module: opts.context.module,
      online: opts.context.online,
      realtime: diag.realtime,
      consoleErrors: diag.consoleErrors,
      renderCrashes: diag.renderCrashes,
      signals: opts.context.signals.map((s) => ({
        id: s.id, level: s.level, title: s.title, detail: s.detail,
      })),
      recentEvents: opts.context.recentEvents.slice(-10).map((e) => ({
        kind: e.kind, level: e.level, title: e.title, detail: e.detail, at: e.at,
      })),
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
        // partial JSON across chunks — push back & wait
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  // flush leftovers
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
