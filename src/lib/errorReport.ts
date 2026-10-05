/**
 * Error Report Builder — assembles a structured operational report.
 *
 * Combines: route, module, recent events, runtime diagnostics snapshot,
 * online status, last screenshot (if any), and a short technical analysis.
 *
 * No backend submission — report stays local, can be copied to clipboard.
 */
import { agentBus, type AgentEvent } from "./agentEventBus";
import { getDiagnosticsSnapshot } from "./runtimeDiagnostics";
import { loadLastScreenshot } from "./screenshotCapture";

export interface ErrorReport {
  id: string;
  createdAt: string;
  route: string;
  module: string;
  online: boolean;
  realtime: string;
  consoleErrors: number;
  renderCrashes: number;
  recentEvents: Array<Pick<AgentEvent, "kind" | "level" | "title" | "detail" | "at">>;
  analysis: string;
  screenshotDataUrl?: string | null;
}

export function buildErrorReport(opts: {
  route: string;
  module: string;
  online: boolean;
  includeScreenshot?: boolean;
}): ErrorReport {
  const diag = getDiagnosticsSnapshot();
  const events = agentBus.snapshot().slice(-25).map((e) => ({
    kind: e.kind,
    level: e.level,
    title: e.title,
    detail: e.detail,
    at: e.at,
  }));

  return {
    id: `rep-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    route: opts.route,
    module: opts.module,
    online: opts.online,
    realtime: diag.realtime,
    consoleErrors: diag.consoleErrors,
    renderCrashes: diag.renderCrashes,
    recentEvents: events,
    analysis: analyzeReport(diag, events, opts.online),
    screenshotDataUrl: opts.includeScreenshot ? loadLastScreenshot() : null,
  };
}

/**
 * Tiny rule-based technical analysis. Replaced by real LLM later.
 */
function analyzeReport(
  diag: ReturnType<typeof getDiagnosticsSnapshot>,
  events: ErrorReport["recentEvents"],
  online: boolean,
): string {
  const lines: string[] = [];
  if (!online) lines.push("Offline — operação local apenas.");
  if (diag.realtime === "disconnected") lines.push("Realtime caiu — possível perda de eventos ao vivo.");
  if (diag.realtime === "error") lines.push("Erro persistente no canal realtime.");
  if (diag.renderCrashes > 0) lines.push(`Erro de render detectado (${diag.renderCrashes}x).`);

  const netFails = events.filter((e) => e.kind === "sync_failure").length;
  if (netFails >= 3) lines.push(`Várias falhas de rede recentes (${netFails}).`);

  const extract = events.filter((e) => e.kind === "extraction_failure").length;
  if (extract > 0) lines.push(`Extração falhou ${extract}x.`);

  const slow = events.filter((e) => e.title?.includes("lenta")).length;
  if (slow > 0) lines.push(`${slow} resposta(s) lenta(s) detectada(s).`);

  if (!lines.length) lines.push("Sem anomalias técnicas relevantes neste momento.");
  return lines.join(" ");
}

export function reportToText(r: ErrorReport): string {
  return [
    `Operix Copilot · Relatório técnico`,
    `─────────────────────────────`,
    `ID: ${r.id}`,
    `Hora: ${r.createdAt}`,
    `Rota: ${r.route}`,
    `Módulo: ${r.module}`,
    `Online: ${r.online ? "sim" : "não"}`,
    `Realtime: ${r.realtime}`,
    `Erros consola: ${r.consoleErrors}  ·  Render crashes: ${r.renderCrashes}`,
    ``,
    `Análise:`,
    r.analysis,
    ``,
    `Últimos eventos (${r.recentEvents.length}):`,
    ...r.recentEvents.map(
      (e) =>
        `  [${new Date(e.at).toLocaleTimeString()}] ${e.level.toUpperCase()} · ${e.title}${e.detail ? " — " + e.detail : ""}`,
    ),
  ].join("\n");
}
