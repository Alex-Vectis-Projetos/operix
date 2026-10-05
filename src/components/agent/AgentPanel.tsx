import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Send, X, Wifi, WifiOff, MapPin, AlertTriangle, CheckCircle2, Info,
  Mic, Paperclip, Sparkles, Activity, ArrowRight, MessageSquare, Stethoscope,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { agentBus, type AgentEvent } from "@/lib/agentEventBus";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useOperationalSignals, type SignalLevel } from "@/hooks/useOperationalSignals";
import { deriveSuggestions, localReply } from "@/lib/agentRules";
import { dispatchAgentAction, AGENT_NAV_EVENT, type AgentAction } from "@/lib/agentActions";
import { loadPersistedAgentEvents } from "@/lib/operationalObserver";
import { captureScreenshot } from "@/lib/screenshotCapture";
import { streamAgentReply, RateLimitedError, type AgentTurn } from "@/lib/agentLLM";
import { AgentDiagnosticsView } from "./AgentDiagnosticsView";
import { AgentConversationPanel } from "./AgentConversationPanel";
import { MultimodalPanel } from "@/agents/multimodal";
import { useAI } from "@/agents/ai";
import { AGENT_OVERLAY_SIZE } from "@/agents/presence/MovementOrchestrator";
import { useWorkspace } from "@/hooks/useWorkspace";


interface Msg {
  id: string;
  from: "agent" | "user";
  text: string;
  at: number;
  typing?: boolean;
  action?: AgentAction;
  actionLabel?: string;
}

const STORAGE_KEY = "qwork.agent.history.v2";

function loadHistory(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]).slice(-60) : [];
  } catch { return []; }
}
function saveHistory(msgs: Msg[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.filter(m => !m.typing).slice(-60))); } catch { /* best effort */ }
}

function formatTime(at: number) {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Props { onClose: () => void; }

export default function AgentPanel({ onClose }: Props) {
  const ctx = useAgentContext();
  const navigate = useNavigate();
  const { signals, worst, recent } = useOperationalSignals();
  const { snapshot: aiSnap } = useAI();
  const { workspaceId } = useWorkspace();
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<"chat" | "talk" | "diag" | "media">("chat");

  const [events, setEvents] = useState<AgentEvent[]>(() =>
    [...loadPersistedAgentEvents(), ...agentBus.snapshot()].slice(-30),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const announced = useRef<Set<string>>(new Set());

  const suggestions = useMemo(
    () => deriveSuggestions(signals, ctx.pathname),
    [signals, ctx.pathname],
  );

  // Bridge agent navigation events → react-router
  useEffect(() => {
    const handler = (e: Event) => {
      const to = (e as CustomEvent<{ to: string }>).detail?.to;
      if (to) navigate(to);
    };
    window.addEventListener(AGENT_NAV_EVENT, handler as EventListener);
    return () => window.removeEventListener(AGENT_NAV_EVENT, handler as EventListener);
  }, [navigate]);

  // Welcome
  useEffect(() => {
    if (messages.length === 0) {
      pushAgent(`Olá. Operix Copilot operacional — a observar "${ctx.label}".`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proactive announcements per signal (once per session)
  useEffect(() => {
    const fresh = signals.filter(
      (s) => s.level !== "ok" && s.id !== "all-ok" && !announced.current.has(s.id),
    );
    if (!fresh.length) return;
    fresh.forEach((s) => announced.current.add(s.id));
    fresh.forEach((s) => {
      const sug = suggestions.find((g) => g.id === `sug-${s.id}`);
      pushAgentTyping(
        s.detail ? `${s.title} — ${s.detail}` : s.title,
        sug ? { action: sug.action, actionLabel: sug.label } : undefined,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  useEffect(() => saveHistory(messages), [messages]);

  // Event bus stream (skip silent heartbeats)
  useEffect(() => {
    const unsub = agentBus.subscribe((evt) => {
      if (evt.meta?.silent) return;
      setEvents((prev) => [...prev.slice(-29), evt]);
    });
    const showErrs = () => {
      pushAgent(
        events.filter((e) => e.level === "error").slice(-3)
          .map((e) => `• ${e.title}${e.detail ? " — " + e.detail : ""}`).join("\n")
        || "Sem erros registados.",
      );
    };
    window.addEventListener("qwork:agent:show-errors", showErrs);
    return () => {
      unsub();
      window.removeEventListener("qwork:agent:show-errors", showErrs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function pushAgent(text: string, extras?: Partial<Msg>) {
    setMessages((m) => [...m, { id: `a-${Date.now()}-${Math.random()}`, from: "agent", text, at: Date.now(), ...extras }]);
  }
  function pushAgentTyping(text: string, extras?: Partial<Msg>) {
    const id = `t-${Date.now()}-${Math.random()}`;
    setMessages((m) => [...m, { id, from: "agent", text: "", at: Date.now(), typing: true }]);
    const delay = Math.min(900, 280 + text.length * 12);
    setTimeout(() => {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text, typing: false, ...extras } : x)));
    }, delay);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    if (!workspaceId) {
      toast.error("Workspace ativo não encontrado.");
      return;
    }

    const userMsg: Msg = { id: `u-${Date.now()}`, from: "user", text, at: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    agentBus.emit({ kind: "user_message", level: "info", title: text });

    // Build conversation history from current messages (skip typing/system meta)
    const history: AgentTurn[] = [...messages, userMsg]
      .filter((m) => !m.typing && m.text)
      .slice(-12)
      .map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text }));

    // Insert streaming assistant bubble
    const streamId = `a-${Date.now()}-${Math.random()}`;
    setMessages((m) => [...m, { id: streamId, from: "agent", text: "", at: Date.now(), typing: true }]);
    setBusy(true);

    let accumulated = "";
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await streamAgentReply({
        history,
        context: {
          route: ctx.pathname,
          module: ctx.label,
          online: ctx.online,
          workspaceId,
          signals,
          recentEvents: recent,
        },
        signal: ctrl.signal,
        onDelta: (chunk) => {
          accumulated += chunk;
          setMessages((m) =>
            m.map((x) => (x.id === streamId ? { ...x, text: accumulated, typing: false } : x)),
          );
        },
        onDone: () => {
          if (!accumulated) {
            setMessages((m) =>
              m.map((x) =>
                x.id === streamId
                  ? { ...x, text: "⚠ Sem resposta do agente. Tenta novamente.", typing: false }
                  : x
              ),
            );
            toast.error("Sem resposta do agente.");
          }
        },
      });
    } catch (err) {
      const msg = err instanceof RateLimitedError
        ? "⏱ Aguarda um instante antes de enviar outra mensagem."
        : err instanceof Error
          ? `⚠ ${err.message}`
          : "⚠ Falha ao contactar o agente.";
      const fallback =
        accumulated ||
        (err instanceof RateLimitedError
          ? msg
          : `${msg}\n\n_Resposta local:_ ${localReply(text, signals)}`);
      setMessages((m) =>
        m.map((x) => (x.id === streamId ? { ...x, text: fallback, typing: false } : x)),
      );
      if (err instanceof RateLimitedError) toast.warning(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  // Cancel any in-flight stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  function runAction(action: AgentAction, label: string) {
    dispatchAgentAction(action);
    pushAgent(`→ ${label}`);
  }

  const signalIcon = (level: SignalLevel) =>
    level === "error" || level === "warn" ? AlertTriangle
    : level === "info" ? Info : CheckCircle2;
  const signalColor = (level: SignalLevel) =>
    level === "error" ? "text-destructive"
    : level === "warn" ? "text-[hsl(38_92%_55%)]"
    : level === "info" ? "text-[hsl(195_100%_60%)]"
    : "text-[hsl(152_60%_45%)]";

  const headerTint =
    worst === "error" ? "from-[hsl(0_70%_18%/0.85)] to-[hsl(0_60%_8%/0.95)]"
    : worst === "warn" ? "from-[hsl(30_70%_18%/0.85)] to-[hsl(220_60%_8%/0.95)]"
    : "from-[hsl(210_70%_14%/0.9)] to-[hsl(220_60%_6%/0.97)]";

  // Emerge from the robot's actual screen position — single identity,
  // no "panel slides in from the right" feel.
  const robotCx = aiSnap.position.x + AGENT_OVERLAY_SIZE / 2;
  const robotCy = aiSnap.position.y + AGENT_OVERLAY_SIZE / 2;
  const originX = `${Math.round(robotCx)}px`;
  const originY = `${Math.round(robotCy)}px`;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="qw-overlay-layer">
      <div
        className="fixed inset-0 z-[1000] bg-black/20 md:bg-transparent"
        onClick={onClose}
        aria-hidden="true"
      />
    <div
      role="dialog"
      aria-label="Operix Copilot"
      className={cn(
        "fixed z-[1001] flex flex-col overflow-hidden text-white isolate",
        "border border-[hsl(195_100%_60%/0.18)]",
        "shadow-[0_20px_60px_-20px_hsl(220_90%_5%/0.85),0_0_0_1px_hsl(195_100%_60%/0.1)]",
        "backdrop-blur-2xl bg-[hsl(220_50%_4%/0.92)]",
        // Mobile: bottom sheet — full width, rounded top, slides up from bottom
        "inset-x-0 bottom-0 max-h-[min(88svh,720px)] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
        "animate-in slide-in-from-bottom duration-300 ease-out",
        // Desktop: contextual popover anchored under the AI button (top-right)
        "md:inset-x-auto md:bottom-auto md:right-4 md:top-16 md:w-[380px] md:max-h-[min(70svh,720px)] md:rounded-2xl",
        "md:animate-in md:fade-in md:zoom-in-95 md:slide-in-from-top-2 md:duration-200",
      )}
      style={{ transformOrigin: `top right` }}
    >
      {/* Mobile drag handle */}
      <div className="md:hidden flex justify-center pt-2 pb-1 shrink-0">
        <div className="h-1 w-10 rounded-full bg-white/20" />
      </div>

      {/* HUD grid overlay */}
      <div className="absolute inset-0 agent-hud-grid opacity-40 pointer-events-none" />
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, hsl(195 100% 60% / 0.7), transparent)" }}
      />

      {/* Header */}
      <div className={cn("relative px-4 py-3 border-b border-[hsl(195_100%_60%/0.15)] bg-gradient-to-br", headerTint)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* state pip — mirrors the live robot identity, no duplicate avatar */}
            <span
              aria-hidden
              className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                background: `hsl(${aiSnap.visual.hue})`,
                boxShadow: `0 0 10px hsl(${aiSnap.visual.hue} / 0.8)`,
              }}
            />
            {/* state pip — mirrors the live robot identity, no duplicate avatar */}
            <span
              aria-hidden
              className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                background: `hsl(${aiSnap.visual.hue})`,
                boxShadow: `0 0 10px hsl(${aiSnap.visual.hue} / 0.8)`,
              }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-wide leading-tight">OPERIX · COPILOT</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(195_100%_75%)] truncate">
                {aiSnap.visual.label} · {ctx.label}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Telemetry strip */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider">
          <Telemetry icon={MapPin} label={ctx.label} tone="info" />
          <Telemetry
            icon={ctx.online ? Wifi : WifiOff}
            label={ctx.online ? "Realtime OK" : "Offline"}
            tone={ctx.online ? "ok" : "error"}
          />
          <Telemetry
            icon={Activity}
            label={worst === "ok" ? "Estável" : worst === "info" ? "Atento" : worst === "warn" ? "Alerta" : "Crítico"}
            tone={worst}
          />
        </div>

        {/* Tab strip */}
        <div className="mt-3 flex gap-1 p-0.5 rounded-md bg-black/40 border border-white/5">
          <TabBtn active={tab === "chat"} icon={MessageSquare} label="Chat" onClick={() => setTab("chat")} />
          <TabBtn active={tab === "talk"} icon={ImageIcon} label="Conversar" onClick={() => setTab("talk")} />
          <TabBtn active={tab === "media"} icon={Paperclip} label="Mídia" onClick={() => setTab("media")} />
          <TabBtn active={tab === "diag"} icon={Stethoscope} label="Diagnóstico" onClick={() => setTab("diag")} />
        </div>

      </div>

      {/* Signals (chat tab only) */}
      {tab === "chat" && signals.length > 0 && (
        <div className="relative px-3 py-2 border-b border-[hsl(195_100%_60%/0.1)] space-y-1 bg-black/20">
          {signals.slice(0, 4).map((s) => {
            const Icon = signalIcon(s.level);
            return (
              <div key={s.id} className="flex items-center gap-2 text-[11px]">
                <Icon className={cn("h-3 w-3 shrink-0", signalColor(s.level))} />
                <span className="text-white/70 truncate">{s.title}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab === "diag" && (
        <AgentDiagnosticsView route={ctx.pathname} module={ctx.label} online={ctx.online} />
      )}

      {tab === "talk" && (
        <AgentConversationPanel autoAttachSnapshot className="flex-1 min-h-0" />
      )}

      {tab === "media" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MultimodalPanel />
        </div>
      )}

      {tab === "chat" && (
      <>


      {/* Messages */}
      <div ref={listRef} className="relative flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-[160px]">
        {messages.map((m) => (
          <div key={m.id} className={cn("max-w-[88%]", m.from === "user" ? "ml-auto" : "")}>
            <div
              className={cn(
                "rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap",
                m.from === "agent"
                  ? "bg-[hsl(220_50%_10%/0.9)] border border-[hsl(195_100%_60%/0.2)] text-white/90 rounded-bl-sm"
                  : "bg-[hsl(195_90%_45%)] text-[hsl(220_60%_6%)] rounded-br-sm font-medium",
              )}
            >
              {m.typing ? (
                <span className="agent-typing inline-flex items-center h-4">
                  <span /><span /><span />
                </span>
              ) : (
                m.text
              )}
            </div>
            <div className={cn("text-[9px] text-white/30 mt-0.5 px-1", m.from === "user" ? "text-right" : "")}>
              {formatTime(m.at)}
            </div>
            {m.action && m.actionLabel && !m.typing && (
              <button
                onClick={() => runAction(m.action!, m.actionLabel!)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-[hsl(195_100%_60%/0.35)] text-[hsl(195_100%_75%)] hover:bg-[hsl(195_100%_60%/0.1)] transition"
              >
                {m.actionLabel}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {events.length > 0 && (
          <details className="mt-2 text-[11px] text-white/40">
            <summary className="cursor-pointer select-none hover:text-white/80">
              Stream operacional ({events.length})
            </summary>
            <ul className="mt-1 space-y-0.5 pl-2 max-h-40 overflow-y-auto">
              {events.slice(-12).reverse().map((e) => (
                <li key={e.id} className="truncate">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle",
                      e.level === "error" && "bg-destructive",
                      e.level === "warn" && "bg-[hsl(38_92%_55%)]",
                      e.level === "success" && "bg-[hsl(152_60%_45%)]",
                      e.level === "info" && "bg-[hsl(195_100%_60%)]",
                    )}
                  />
                  {e.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="relative px-3 pt-2 pb-1 border-t border-[hsl(195_100%_60%/0.1)] bg-black/30">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">Sugestões</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => runAction(s.action, s.label)}
                className={cn(
                  "text-[11px] px-2.5 py-1 rounded-full border transition",
                  s.tone === "error"
                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                    : s.tone === "warn"
                      ? "border-[hsl(38_92%_55%/0.5)] text-[hsl(38_92%_70%)] hover:bg-[hsl(38_92%_55%/0.1)]"
                      : "border-[hsl(195_100%_60%/0.4)] text-[hsl(195_100%_75%)] hover:bg-[hsl(195_100%_60%/0.1)]",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="relative p-2 border-t border-[hsl(195_100%_60%/0.15)] bg-black/40 flex items-end gap-1.5">
        <button
          type="button"
          aria-label="Capturar ecrã"
          onClick={async () => {
            const d = await captureScreenshot();
            if (d) {
              toast.success("Ecrã capturado localmente.");
              setTab("diag");
            } else {
              toast.error("Captura cancelada ou não suportada.");
            }
          }}
          className="h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label="Ditar"
          onClick={() => toast("Voz chega na próxima fase", { description: "Reconhecimento por voz será adicionado em breve." })}
          className="h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
        >
          <Mic className="h-4 w-4" />
        </button>
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder={busy ? "A pensar…" : "Fale com o agente…"}
          disabled={busy}
          className={cn(
            "flex-1 resize-none bg-[hsl(220_50%_8%)] border border-[hsl(195_100%_60%/0.2)] rounded-md",
            "px-3 py-2 text-sm text-white placeholder:text-white/30",
            "focus:outline-none focus:ring-2 focus:ring-[hsl(195_100%_60%/0.4)] focus:border-[hsl(195_100%_60%/0.5)]",
            "max-h-32 disabled:opacity-60",
          )}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || busy}
          aria-label="Enviar"
          className={cn(
            "h-9 w-9 shrink-0 rounded-md flex items-center justify-center",
            "bg-[hsl(195_100%_55%)] text-[hsl(220_60%_6%)] hover:bg-[hsl(195_100%_60%)]",
            "disabled:opacity-30 disabled:cursor-not-allowed transition-colors",
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      </>
      )}
    </div>
    </div>,
    document.body,
  );

}

function TabBtn({
  active, icon: Icon, label, onClick,
}: { active: boolean; icon: typeof MessageSquare; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded transition",
        active
          ? "bg-[hsl(195_100%_60%/0.15)] text-[hsl(195_100%_80%)] border border-[hsl(195_100%_60%/0.4)]"
          : "text-white/50 hover:text-white/80 border border-transparent",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium tracking-wide">{label}</span>
    </button>
  );
}


function Telemetry({
  icon: Icon, label, tone,
}: { icon: typeof Wifi; label: string; tone: SignalLevel }) {
  const color =
    tone === "error" ? "text-destructive border-destructive/40"
    : tone === "warn" ? "text-[hsl(38_92%_70%)] border-[hsl(38_92%_55%/0.4)]"
    : tone === "ok" ? "text-[hsl(152_60%_60%)] border-[hsl(152_60%_45%/0.4)]"
    : "text-[hsl(195_100%_75%)] border-[hsl(195_100%_60%/0.4)]";
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded border bg-black/30 truncate", color)}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate text-[10px] font-medium">{label}</span>
    </div>
  );
}
