import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Navigation, MapPin, X, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { registerCheckpoint, finalizeTripWithCurrentGps } from "@/lib/fleet/tripActions";

const POS_KEY = "fleet_floating_pos_v1";
const ACTIVE_TRIPS_KEY = "fleet_active_trips";
const EDGE_PEEK = 14; // pixels still visible when snapped off-screen
const PANEL_W = 240;
const PANEL_H = 116;

interface Pos { x: number; y: number; }

interface ActiveTripSummary {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  date: string | null;
  km_start: number | null;
  draft?: boolean;
}

function loadLocalActiveTrip(): ActiveTripSummary | null {
  try {
    const sessions = JSON.parse(localStorage.getItem(ACTIVE_TRIPS_KEY) || "[]");
    const latest = Array.isArray(sessions) ? sessions.sort((a: any, b: any) => Number(b?.ts || 0) - Number(a?.ts || 0))[0] : null;
    if (!latest?.tripId) return null;
    return {
      id: latest.tripId,
      vehicle_id: latest.vehicleId || latest.form?.vehicle_id || null,
      driver_id: latest.form?.driver_id || null,
      date: latest.form?.date || null,
      km_start: latest.form?.km_start ? Number(latest.form.km_start) : null,
      draft: latest.tripId === "draft",
    };
  } catch { return null; }
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { x: window.innerWidth - PANEL_W - 16, y: window.innerHeight - PANEL_H - 96 };
}

function clampToViewport(p: Pos): Pos {
  const maxX = window.innerWidth - EDGE_PEEK;
  const minX = -(PANEL_W - EDGE_PEEK);
  const maxY = window.innerHeight - PANEL_H - 8;
  const minY = 8;
  return {
    x: Math.min(Math.max(p.x, minX), maxX),
    y: Math.min(Math.max(p.y, minY), maxY),
  };
}

export function FloatingTripButton() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [pos, setPos] = useState<Pos>(() => clampToViewport(loadPos()));
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState<"checkpoint" | "end" | null>(null);
  const [localTrip, setLocalTrip] = useState<ActiveTripSummary | null>(() => loadLocalActiveTrip());

  // Poll for in-progress trips (lightweight; throttled)
  const { data: activeTripFromDb } = useQuery({
    queryKey: ["fleet_active_trip_global"],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("fleet_trips")
        .select("id, vehicle_id, driver_id, date, km_start")
        .eq("status", "in_progress")
        .order("created_at", { ascending: false })
        .limit(1);
      return (data && data[0]) || null;
    },
  });

  const activeTrip = (activeTripFromDb || localTrip) as ActiveTripSummary | null;

  useEffect(() => {
    const syncLocalTrip = () => setLocalTrip(loadLocalActiveTrip());
    window.addEventListener("storage", syncLocalTrip);
    window.addEventListener("fleet:session-updated", syncLocalTrip);
    const id = window.setInterval(syncLocalTrip, 1500);
    return () => {
      window.removeEventListener("storage", syncLocalTrip);
      window.removeEventListener("fleet:session-updated", syncLocalTrip);
      window.clearInterval(id);
    };
  }, []);

  // re-clamp on viewport resize
  useEffect(() => {
    const onResize = () => setPos((p) => clampToViewport(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // persist position
  useEffect(() => {
    if (!dragging) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* noop */ }
    }
  }, [pos, dragging]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.dx;
    const dy = e.clientY - dragRef.current.dy;
    if (Math.abs(dx - pos.x) + Math.abs(dy - pos.y) > 3) dragRef.current.moved = true;
    setPos(clampToViewport({ x: dx, y: dy }));
  };
  const onPointerUp = () => {
    setDragging(false);
    // snap horizontally to nearest edge if user dragged far enough
    setPos((p) => {
      const cx = p.x + PANEL_W / 2;
      const mid = window.innerWidth / 2;
      const snappedX = cx < mid ? 8 : window.innerWidth - PANEL_W - 8;
      // only snap if user did meaningful horizontal drag (avoid jump on tap)
      const moved = dragRef.current?.moved;
      dragRef.current = null;
      if (!moved) return p;
      return clampToViewport({ x: snappedX, y: p.y });
    });
  };

  const handleResume = useCallback(() => {
    if (!activeTrip) return;
    if (location.pathname !== "/fleet") navigate("/fleet");
    setTimeout(() => {
      const detail = activeTrip.draft ? {} : { tripId: activeTrip.id };
      window.dispatchEvent(new CustomEvent("fleet:open-trips", { detail }));
      window.dispatchEvent(new CustomEvent("fleet:resume-trip", { detail }));
    }, 250);
  }, [activeTrip, location.pathname, navigate]);

  const handleCheckpoint = useCallback(async () => {
    if (!activeTrip || busy || activeTrip.draft) return;
    setBusy("checkpoint");
    try {
      const gps = await registerCheckpoint(activeTrip.id);
      toast.success(`Ponto registado: ${gps.city || gps.display_address}`);
      qc.invalidateQueries({ queryKey: ["fleet_trips"] });
      qc.invalidateQueries({ queryKey: ["fleet_active_trip_global"] });
      window.dispatchEvent(new CustomEvent("fleet:session-updated"));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao registar ponto");
    } finally {
      setBusy(null);
    }
  }, [activeTrip, busy, qc]);

  const handleEnd = useCallback(async () => {
    if (!activeTrip || busy || activeTrip.draft) return;
    setBusy("end");
    try {
      toast.info("A capturar GPS final e a calcular rota...");
      await finalizeTripWithCurrentGps(activeTrip.id);
      toast.success("Trajeto encerrado");
      qc.invalidateQueries({ queryKey: ["fleet_trips"] });
      qc.invalidateQueries({ queryKey: ["fleet_active_trip_global"] });
      setLocalTrip(null);
      window.dispatchEvent(new CustomEvent("fleet:session-updated"));
      setConfirmEnd(false);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao encerrar trajeto");
    } finally {
      setBusy(null);
    }
  }, [activeTrip, busy, qc]);

  if (!user || !activeTrip) return null;

  return (
    <>
      <div
        role="dialog"
        aria-label="Trajeto em andamento"
        className={`fixed z-[60] select-none touch-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          left: pos.x,
          top: pos.y,
          width: PANEL_W,
          transition: dragging ? "none" : "left 220ms cubic-bezier(.2,.8,.2,1), top 220ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="
            relative overflow-hidden rounded-2xl border border-primary/30
            bg-background/60 backdrop-blur-xl
            shadow-[0_8px_40px_-12px_hsl(var(--primary)/0.35),0_0_0_1px_hsl(var(--primary)/0.08)_inset]
          "
          style={{ animation: "trip-breathe 3.4s ease-in-out infinite" }}
        >
          {/* close (X) - sits above drag handle */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (activeTrip.draft) {
                try { localStorage.setItem(ACTIVE_TRIPS_KEY, JSON.stringify([])); } catch { /* noop */ }
                setLocalTrip(null);
                window.dispatchEvent(new CustomEvent("fleet:session-updated"));
                return;
              }
              setConfirmEnd(true);
            }}
            className="absolute top-1.5 right-1.5 z-10 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
            aria-label={activeTrip.draft ? "Descartar trajeto minimizado" : "Encerrar trajeto"}
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="px-3 pt-2.5 pb-3">
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full bg-green-500"
                style={{ boxShadow: "0 0 8px hsl(142 70% 45% / 0.9)", animation: "trip-pulse 1.6s ease-in-out infinite" }}
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/90">
                {activeTrip.draft ? "Trajeto minimizado" : "Trajeto em andamento"}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleResume(); }}
                className="
                  group inline-flex items-center justify-center gap-1.5 h-9 rounded-lg
                  border border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.09]
                  text-[11px] font-semibold text-foreground transition-colors
                "
              >
                <Navigation className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
                Retomar
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleCheckpoint(); }}
                disabled={busy === "checkpoint" || activeTrip.draft}
                className="
                  group inline-flex items-center justify-center gap-1.5 h-9 rounded-lg
                  border border-primary/40 bg-primary/10 hover:bg-primary/20
                  text-[11px] font-semibold text-foreground transition-colors
                  disabled:opacity-60
                "
              >
                {busy === "checkpoint"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <MapPin className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
                }
                {activeTrip.draft ? "Aguardando início" : "Registar ponto"}
              </button>
            </div>
          </div>

          {/* subtle gradient highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{ background: "radial-gradient(120% 60% at 0% 0%, hsl(var(--primary) / 0.12), transparent 60%)" }}
          />
        </div>
      </div>

      <style>{`
        @keyframes trip-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.25); }
        }
        @keyframes trip-breathe {
          0%, 100% { box-shadow: 0 8px 40px -12px hsl(var(--primary) / 0.35), 0 0 0 1px hsl(var(--primary) / 0.08) inset; }
          50% { box-shadow: 0 10px 48px -10px hsl(var(--primary) / 0.55), 0 0 0 1px hsl(var(--primary) / 0.18) inset; }
        }
      `}</style>

      <AlertDialog open={confirmEnd} onOpenChange={(o) => !busy && setConfirmEnd(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja encerrar o trajeto?</AlertDialogTitle>
            <AlertDialogDescription>
              A posição GPS atual será registada automaticamente como destino final
              e o trajeto passará a "Concluído".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "end"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleEnd(); }} disabled={busy === "end"}>
              {busy === "end" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Encerrar Trajeto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
