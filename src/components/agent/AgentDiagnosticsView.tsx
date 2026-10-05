import { useState } from "react";
import { Camera, ClipboardCopy, RefreshCw, FileText, RotateCw, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOperationalTimeline } from "@/hooks/useOperationalTimeline";
import { buildErrorReport, reportToText } from "@/lib/errorReport";
import { captureScreenshot, loadLastScreenshot, clearLastScreenshot } from "@/lib/screenshotCapture";
import { getDiagnosticsSnapshot } from "@/lib/runtimeDiagnostics";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  route: string;
  module: string;
  online: boolean;
}

const KIND_DOT: Record<string, string> = {
  error: "bg-destructive",
  warn: "bg-[hsl(38_92%_55%)]",
  info: "bg-[hsl(195_100%_60%)]",
  success: "bg-[hsl(152_60%_45%)]",
  user: "bg-white/60",
  reconnect: "bg-[hsl(280_100%_70%)]",
};

function timeShort(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentDiagnosticsView({ route, module, online }: Props) {
  const entries = useOperationalTimeline(60);
  const [shotTick, setShotTick] = useState(0);
  const diag = getDiagnosticsSnapshot();
  const screenshot = loadLastScreenshot();

  async function handleCaptureScreen() {
    toast("A iniciar captura — escolha o ecrã.");
    const data = await captureScreenshot();
    if (data) {
      setShotTick((t) => t + 1);
      toast.success("Screenshot capturado localmente.");
    } else {
      toast.error("Captura cancelada ou não suportada.");
    }
  }

  function handleCopyReport() {
    const report = buildErrorReport({ route, module, online, includeScreenshot: false });
    const text = reportToText(report);
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Relatório copiado para a área de transferência."),
      () => toast.error("Falha ao copiar."),
    );
  }

  function handleReloadModule() {
    toast("A recarregar módulo…");
    setTimeout(() => window.location.reload(), 300);
  }

  async function handleResetRealtime() {
    try {
      const rt: any = (supabase as any).realtime;
      rt?.disconnect?.();
      setTimeout(() => rt?.connect?.(), 200);
      toast.success("Realtime reiniciado.");
    } catch {
      toast.error("Não foi possível reiniciar o realtime.");
    }
  }

  function handleClearShot() {
    clearLastScreenshot();
    setShotTick((t) => t + 1);
  }

  const analysis = buildErrorReport({ route, module, online }).analysis;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-white/90">
      {/* Diagnostics summary */}
      <section className="rounded-lg border border-[hsl(195_100%_60%/0.2)] bg-black/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-white/40">Diagnóstico técnico</div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Realtime" value={diag.realtime === "unknown" && online ? "conectado" : diag.realtime} tone={diag.realtime === "connected" || (diag.realtime === "unknown" && online) ? "ok" : diag.realtime === "disconnected" ? "warn" : diag.realtime === "error" ? "err" : "info"} />
          <Stat label="Online" value={online ? "sim" : "não"} tone={online ? "ok" : "err"} />
          <Stat label="Consola" value={`${diag.consoleErrors} erro(s)`} tone={diag.consoleErrors > 0 ? "warn" : "ok"} />
          <Stat label="Render" value={`${diag.renderCrashes} crash`} tone={diag.renderCrashes > 0 ? "err" : "ok"} />
        </div>
        <p className="text-[11px] text-white/70 leading-snug pt-1 border-t border-white/5">{analysis}</p>
      </section>

      {/* Recovery actions */}
      <section className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-white/40 px-0.5">Acções de recuperação</div>
        <div className="grid grid-cols-2 gap-1.5">
          <ActionBtn icon={RotateCw} label="Reset realtime" onClick={handleResetRealtime} />
          <ActionBtn icon={RefreshCw} label="Recarregar módulo" onClick={handleReloadModule} />
          <ActionBtn icon={Camera} label="Capturar ecrã" onClick={handleCaptureScreen} />
          <ActionBtn icon={ClipboardCopy} label="Copiar relatório" onClick={handleCopyReport} />
        </div>
      </section>

      {/* Screenshot preview */}
      {screenshot && (
        <section className="rounded-lg border border-[hsl(195_100%_60%/0.2)] bg-black/30 p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
            <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Último screenshot</span>
            <button onClick={handleClearShot} className="hover:text-destructive" aria-label="Remover">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <img
            key={shotTick}
            src={screenshot}
            alt="Screenshot local"
            className="rounded border border-white/10 max-h-40 w-full object-contain bg-black"
          />
        </section>
      )}

      {/* Timeline */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-0.5">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Timeline operacional</div>
          <FileText className="h-3 w-3 text-white/30" />
        </div>
        {entries.length === 0 ? (
          <div className="text-[11px] text-white/40 px-1 py-3">Sem eventos registados.</div>
        ) : (
          <ul className="space-y-0.5">
            {entries.slice().reverse().map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[11px] py-1 border-b border-white/5">
                <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", KIND_DOT[e.kind] ?? "bg-white/40")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-white/85">{e.title}</span>
                    <span className="text-[9px] text-white/30 shrink-0">{timeShort(e.at)}</span>
                  </div>
                  {e.detail && <div className="text-white/40 truncate text-[10px]">{e.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "err" | "info" }) {
  const color =
    tone === "err" ? "text-destructive"
    : tone === "warn" ? "text-[hsl(38_92%_70%)]"
    : tone === "ok" ? "text-[hsl(152_60%_60%)]"
    : "text-[hsl(195_100%_75%)]";
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded bg-black/30 border border-white/5">
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <span className={cn("text-xs font-medium truncate", color)}>{value}</span>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] rounded-md border border-[hsl(195_100%_60%/0.25)] bg-black/30 text-white/85 hover:bg-[hsl(195_100%_60%/0.08)] hover:border-[hsl(195_100%_60%/0.45)] transition text-left"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-[hsl(195_100%_70%)]" />
      <span className="truncate">{label}</span>
    </button>
  );
}
