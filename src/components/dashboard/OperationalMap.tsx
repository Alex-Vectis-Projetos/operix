import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useLanguage } from "@/hooks/useLanguage";
import { Skeleton } from "@/components/ui/skeleton";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Users, CloudRain, Zap, Radar, Wrench, FileText, X, AlertTriangle, Wind, Clock, Gauge, Filter, Play, Pause, RotateCcw, Target, Eye } from "lucide-react";
import { HailRadarIcon } from "@/components/icons/HailRadarIcon";
import { OperationalPanel, PanelTeam, PanelOrder } from "./OperationalPanel";
import {
  OperationalOpportunities,
  computeOpportunities,
  opportunitiesToHeatmapGeoJSON,
  type OppHailEvent,
  type OppOrder,
  type OppTeam,
} from "./OperationalOpportunities";
import { HailReportDialog } from "./HailReportDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/* ------------------------------------------------------------------ */
/*  Hail severity → premium color palette                              */
/* ------------------------------------------------------------------ */
const HAIL_COLORS = {
  low: "#eab308",       // yellow
  moderate: "#f97316",  // orange
  severe: "#ef4444",    // red
  extreme: "#a855f7",   // purple — extreme
} as const;
type HailSeverity = keyof typeof HAIL_COLORS;
type HailStatus = "forecast" | "ongoing" | "confirmed" | "closed";

interface HailEvent {
  id: string;
  source: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
  radius_km: number;
  severity: HailSeverity;
  status: HailStatus;
  hail_size_mm: number | null;
  probability: number | null;
  intensity: number | null;
  storm_speed_kmh: number | null;
  storm_direction_deg: number | null;
  forecast_time: string | null;
  observed_time: string | null;
  expires_at: string | null;
  is_demo: boolean;
  metadata?: Record<string, any> | null;
}

/* ------------------------------------------------------------------ */
/*  City heuristic (kept from previous map for fallback inference)     */
/* ------------------------------------------------------------------ */
const CITY_COORDS: Record<string, [number, number]> = {
  paris: [2.3522, 48.8566],
  lyon: [4.8357, 45.764],
  marseille: [5.3698, 43.2965],
  toulouse: [1.4442, 43.6047],
  nice: [7.262, 43.7102],
  nantes: [-1.5536, 47.2184],
  strasbourg: [7.7521, 48.5734],
  montpellier: [3.8767, 43.6108],
  bordeaux: [-0.5792, 44.8378],
  lille: [3.0573, 50.6292],
  rennes: [-1.6778, 48.1173],
  grenoble: [5.7245, 45.1885],
  rouen: [1.0999, 49.4432],
  toulon: [5.928, 43.1242],
  "clermont-ferrand": [3.087, 45.7772],
  "le mans": [0.1996, 48.0061],
  dijon: [5.0415, 47.322],
  angers: [-0.5632, 47.4784],
  "saint-etienne": [4.3872, 45.4397],
  tours: [0.6848, 47.3941],
  geneve: [6.1432, 46.2044],
  geneva: [6.1432, 46.2044],
};

function guessCityFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const city of Object.keys(CITY_COORDS)) {
    if (lower.includes(city)) return city;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Dark premium MapLibre style (CartoDB GL vector — proper ocean)     */
/* ------------------------------------------------------------------ */
const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/* ------------------------------------------------------------------ */
/*  Layer config                                                       */
/* ------------------------------------------------------------------ */
type LayerKey = "teams" | "orders" | "operations" | "radar" | "storms" | "hail" | "pdr";

const LAYER_DEFS: { key: LayerKey; label: string; icon: any; color: string }[] = [
  { key: "teams", label: "Equipes", icon: Users, color: "#22d3ee" },
  { key: "orders", label: "Ordens", icon: FileText, color: "#a855f7" },
  { key: "operations", label: "Operações", icon: Wrench, color: "#f59e0b" },
  { key: "radar", label: "Radar", icon: Radar, color: "#3b82f6" },
  { key: "storms", label: "Tempestades", icon: Zap, color: "#eab308" },
  { key: "hail", label: "Granizo", icon: CloudRain, color: "#ef4444" },
  { key: "pdr", label: "PDR Intel", icon: Target, color: "#fb923c" },
];

/* ------------------------------------------------------------------ */
/*  Pulse CSS (injected once)                                          */
/* ------------------------------------------------------------------ */
const MAP_CSS = `
.maplibregl-ctrl-attrib { background: rgba(10,22,40,0.6) !important; color: #94a3b8 !important; font-size: 9px; }
.maplibregl-ctrl-attrib a { color: #cbd5e1 !important; }
.maplibregl-popup-content { background: hsl(220 14% 11%); color: #e5e5e5; border: 1px solid hsl(220 12% 18%); border-radius: 8px; font-family: system-ui; font-size: 12px; padding: 10px 12px; }
.maplibregl-popup-tip { border-top-color: hsl(220 14% 11%) !important; border-bottom-color: hsl(220 14% 11%) !important; }
.op-pulse { position: relative; }
.op-pulse::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid currentColor; opacity: 0.6;
  animation: opPulse 2s ease-out infinite;
}
@keyframes opPulse {
  0% { transform: scale(0.6); opacity: 0.7; }
  100% { transform: scale(1.8); opacity: 0; }
}
.op-marker {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.85);
  box-shadow: 0 0 12px 3px currentColor;
}
.op-cluster {
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: #fff; font-weight: 700; font-size: 12px;
  font-family: system-ui; border: 2px solid currentColor;
  background: radial-gradient(circle, rgba(255,255,255,0.12), rgba(0,0,0,0.4));
  box-shadow: 0 0 14px 4px currentColor;
}
`;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function OperationalMap() {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const radarTimerRef = useRef<number | null>(null);
  const radarFramesRef = useRef<{ host: string; frames: any[] } | null>(null);
  const radarIdxRef = useRef(0);
  const radarIntervalRef = useRef<number | null>(null);
  const initRetryRef = useRef<number>(0);
  const initTimerRef = useRef<number | null>(null);
  const gpuContextLostRef = useRef(false);
  const radarStaggerTimerRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [mapInitTick, setMapInitTick] = useState(0);
  const [sourceRecoveryTick, setSourceRecoveryTick] = useState(0);
  const [rasterRecoveryTick, setRasterRecoveryTick] = useState(0);

  // Callback ref guarantees init runs the moment the DOM node exists,
  // regardless of whether the loader skeleton was rendered first.
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setContainerEl(el);
  }, []);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    teams: true,
    orders: true,
    operations: true,
    radar: true,
    storms: false,
    hail: true,
    pdr: true,
  });

  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  /* -------- data: service orders (orders + operations inferred) ----- */
  const { data: serviceOrders = [], isLoading: loadingSO } = useQuery({
    queryKey: ["op-map-orders"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async () => {
      const [soData, poData] = await Promise.all([
        apiRequest<{ orders: any[] }>("/service-orders?limit=500").catch(() => ({ orders: [] })),
        apiRequest<{ orders?: any[] } | any[]>("/production-orders").catch(() => []),
      ]);
      const legacyOrders = soData.orders ?? [];
      const prodOrders: any[] = Array.isArray(poData) ? poData : (poData?.orders ?? []);
      const mappedProdOrders = prodOrders.map((p) => ({
        id: p.id,
        platform: p.platform || p.client_name || p.clientName || "Operação",
        car_name: [p.brand, p.model].filter(Boolean).join(" "),
        license_plate: p.license_plate || p.licensePlate || "",
        status: p.status,
      }));
      return [...legacyOrders, ...mappedProdOrders];
    },
  });

  /* -------- data: geo checkins and branch locations (teams) --------- */
  const { data: geoCheckins = [], isLoading: loadingGeo } = useQuery({
    queryKey: ["op-map-geo"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async () => {
      const [eventsData, locData] = await Promise.all([
        apiRequest<{ events: any[] }>("/weather/backend-events?table_name=geolocation&action=CHECKIN&limit=300").catch(() => ({ events: [] })),
        apiRequest<any[]>("/locations").catch(() => []),
      ]);
      const eventPoints = (eventsData.events ?? []).filter((d: any) => d.payload?.lat && d.payload?.lng);
      const locationsList = Array.isArray(locData) ? locData : [];
      const locPoints = locationsList.map((loc: any) => {
        const text = [loc.city, loc.name, loc.address, loc.country].filter(Boolean).join(" ");
        const cityKey = guessCityFromText(text) || (loc.city ? loc.city.toLowerCase() : "paris");
        const coords = (CITY_COORDS as any)[cityKey] || [2.3522, 48.8566];
        return {
          id: loc.id,
          created_at: loc.created_at || new Date().toISOString(),
          payload: {
            lat: Number(loc.latitude ?? coords[1]),
            lng: Number(loc.longitude ?? coords[0]),
            city: loc.name || loc.city || "Base Operacional",
          },
        };
      });
      return [...eventPoints, ...locPoints];
    },
  });

  /* -------- data: hail events (operational weather intel) ----------- */
  const queryClient = useQueryClient();
  const { data: hailEvents = [] } = useQuery<HailEvent[]>({
    queryKey: ["op-map-hail"],
    retry: 0,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const data = await apiRequest<{ hailEvents: HailEvent[] }>(`/weather/hail-events?no_expired=true&since=${since}&limit=500`);
      return data.hailEvents ?? [];
    },
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
  });

  // Polling: refresh hail data every 60 seconds
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["op-map-hail"] });
      queryClient.invalidateQueries({ queryKey: ["op-map-hail-reports"] });
    }, 60000);
    return () => clearInterval(id);
  }, [queryClient]);

  /* -------- data: community hail reports (lifecycle window) -------- */
  const { data: hailReports = [] } = useQuery<any[]>({
    queryKey: ["op-map-hail-reports"],
    retry: 0,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
      const data = await apiRequest<{ reports: any[] }>(`/weather/hail-reports?since=${since}&limit=500`);
      return data.reports ?? [];
    },
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
  });

  /* -------- Reports indexed per hail event ------------------------- */
  const reportsByEvent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of hailReports ?? []) {
      if (!r.hail_event_id) continue;
      const arr = map.get(r.hail_event_id) ?? [];
      arr.push(r);
      map.set(r.hail_event_id, arr);
    }
    return map;
  }, [hailReports]);

  /* -------- Hail filters & timeline replay -------------------------- */
  type StatusFilter = "all" | "forecast" | "ongoing" | "confirmed";
  const [hailStatusFilter, setHailStatusFilter] = useState<StatusFilter>("all");
  const [hailSeverityFilter, setHailSeverityFilter] = useState<Record<HailSeverity, boolean>>({
    low: true, moderate: true, severe: true, extreme: true,
  });
  const [hailMinSizeMm, setHailMinSizeMm] = useState<number>(0);
  const [hailWindowHours, setHailWindowHours] = useState<number>(6); // last N hours
  const [replayCursor, setReplayCursor] = useState<number>(1); // 0..1 (1 = now / AO VIVO)
  const [replayPlaying, setReplayPlaying] = useState(false);

  // auto-advance replay
  useEffect(() => {
    if (!replayPlaying) return;
    const id = window.setInterval(() => {
      setReplayCursor((c) => {
        const next = c + 0.02;
        if (next >= 1) { setReplayPlaying(false); return 1; }
        return next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [replayPlaying]);

  const replayTimeMs = useMemo(() => {
    const windowMs = hailWindowHours * 3600_000;
    const start = Date.now() - windowMs;
    return start + windowMs * replayCursor;
  }, [hailWindowHours, replayCursor]);

  /* -------- Operational hail entities (Phase 2) --------------------- */
  /* Normalized climate entities the map reacts to. Filter chips operate
     directly over this collection — no raster/timeline coupling.        */
  type HailEntity = {
    id: string;
    lat: number;
    lng: number;
    status: HailStatus;
    severity: HailSeverity;
    forecast: boolean;
    active: boolean;
    confirmed: boolean;
    timestamp: number;
    confidence: number;
    source: string;
    size: number;
    raw: HailEvent;
  };

  const hailEntities = useMemo<HailEntity[]>(() => {
    return (hailEvents ?? []).map((h) => {
      const ts = new Date(
        h.observed_time ?? h.forecast_time ?? h.expires_at ?? Date.now()
      ).getTime();
      return {
        id: h.id,
        lat: h.lat,
        lng: h.lng,
        status: h.status,
        severity: h.severity,
        forecast: h.status === "forecast",
        active: h.status === "ongoing",
        confirmed: h.status === "confirmed",
        timestamp: isNaN(ts) ? Date.now() : ts,
        confidence: Number((h as any).probability ?? (h as any).confidence ?? 0),
        source: (h as any).source ?? "unknown",
        size: h.hail_size_mm ?? 0,
        raw: h,
      };
    });
  }, [hailEvents]);

  const visibleHailEvents = useMemo(() => {
    const windowStart = Date.now() - hailWindowHours * 3600_000;
    const isLive = replayCursor >= 0.999;
    // Density cap — never render more than N events on the operational
    // radar. Prevents heatmap saturation, marker storms and render loops
    // when ingestion floods the workspace. Severity-ordered before slice.
    const MAX_VISIBLE = 250;
    const SEV_RANK: Record<HailSeverity, number> = { extreme: 4, severe: 3, moderate: 2, low: 1 };

    const filtered = hailEntities.filter((e) => {
      if (!hailSeverityFilter[e.severity]) return false;
      if (hailMinSizeMm > 0 && e.size < hailMinSizeMm) return false;
      if (hailStatusFilter !== "all") {
        if (hailStatusFilter === "forecast" && !e.forecast) return false;
        if (hailStatusFilter === "ongoing" && !e.active) return false;
        if (hailStatusFilter === "confirmed" && !e.confirmed) return false;
      }
      if (!isLive) {
        if (e.timestamp < windowStart) return false;
        if (e.timestamp > replayTimeMs) return false;
      }
      return true;
    });

    if (filtered.length <= MAX_VISIBLE) return filtered.map((e) => e.raw);
    return filtered
      .sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (b.timestamp - a.timestamp))
      .slice(0, MAX_VISIBLE)
      .map((e) => e.raw);
  }, [hailEntities, hailStatusFilter, hailSeverityFilter, hailMinSizeMm, hailWindowHours, replayTimeMs, replayCursor]);


  const [selectedHailId, setSelectedHailId] = useState<string | null>(null);
  const selectedHail = useMemo(
    () => hailEvents.find((h) => h.id === selectedHailId) ?? null,
    [hailEvents, selectedHailId]
  );
  /* -------- GeoJSON sources ----------------------------------------- */
  const ordersGeo = useMemo(() => {
    const features: any[] = [];
    // Deterministic jitter per order id — keeps feature references stable
    // across re-renders, which avoids cascading recomputes (oppOrders →
    // opportunities → pdrHeatGeo) and map source thrashing.
    const hash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return h;
    };
    for (const o of serviceOrders) {
      const text = [o.platform, o.car_name, o.license_plate].filter(Boolean).join(" ");
      const city = guessCityFromText(text);
      if (!city) continue;
      const [lng, lat] = CITY_COORDS[city];
      const h = hash(String(o.id ?? text));
      const jx = (((h & 0xff) / 255) - 0.5) * 0.04;
      const jy = ((((h >> 8) & 0xff) / 255) - 0.5) * 0.04;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng + jx, lat + jy] },
        properties: {
          id: o.id,
          city: city.charAt(0).toUpperCase() + city.slice(1),
          platform: o.platform ?? "",
          plate: o.license_plate ?? "",
          status: o.status ?? "",
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [serviceOrders]);


  const teamsGeo = useMemo(() => {
    const features = geoCheckins.map((c: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.payload.lng, c.payload.lat] },
      properties: {
        city: c.payload.city ?? "Check-in",
        when: new Date(c.created_at).toLocaleDateString(),
      },
    }));
    return { type: "FeatureCollection", features };
  }, [geoCheckins]);

  const operationsGeo = useMemo(() => {
    // PDR ops = service orders flagged as in-progress; same city inference
    const features = (ordersGeo.features as any[]).filter(
      (f) => String(f.properties.status).toLowerCase().includes("progress") ||
             String(f.properties.status).toLowerCase().includes("andamento") ||
             String(f.properties.status).toLowerCase().includes("aberta")
    );
    return { type: "FeatureCollection", features };
  }, [ordersGeo]);

  const hailGeo = useMemo(() => {
    const features = visibleHailEvents.map((h) => {
      const isForecast = h.status === "forecast";
      const isConfirmed = h.status === "confirmed" || h.status === "ongoing";
      const isClosed = h.status === "closed";
      const sizeMm = h.hail_size_mm ?? 0;
      // Hail size adds extra weight on top of severity bucket
      const size_factor =
        (h.severity === "extreme" ? 28 :
         h.severity === "severe" ? 22 :
         h.severity === "moderate" ? 16 : 12)
        + Math.min(12, sizeMm / 4);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: {
          id: h.id,
          severity: h.severity,
          status: h.status,
          radius_km: h.radius_km,
          hail_size_mm: sizeMm,
          color: HAIL_COLORS[h.severity] ?? HAIL_COLORS.low,
          size_factor,
          is_forecast: isForecast ? 1 : 0,
          is_confirmed: isConfirmed ? 1 : 0,
          is_closed: isClosed ? 1 : 0,
        },
      };
    });
    return { type: "FeatureCollection", features };
  }, [visibleHailEvents]);

  const hailReportsGeo = useMemo(() => {
    const features = (hailReports ?? [])
      .filter((r: any) => r.lat != null && r.lng != null)
      .map((r: any) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(r.lng), Number(r.lat)] },
        properties: {
          id: r.id,
          severity: r.severity ?? "low",
          status: r.status ?? "partial",
          color: HAIL_COLORS[(r.severity as HailSeverity) ?? "low"] ?? HAIL_COLORS.low,
          city: r.city ?? "",
          country: r.country ?? "",
          hail_size_mm: r.hail_size_mm ?? 0,
          confidence: Number(r.confidence_score ?? 0),
          corroborations: Number(r.corroboration_count ?? 0),
          photo_url: r.photo_url ?? "",
          observed_at: r.observed_at ?? "",
          notes: r.notes ?? "",
        },
      }));
    return { type: "FeatureCollection", features };
  }, [hailReports]);

  /* -------- Init map ------------------------------------------------ */
  useEffect(() => {
    if (!containerEl || mapRef.current) return;

    // WebGL availability check — fall back to no-WebGL panel if missing
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    if (!gl) {
      setMapError("WebGL indisponível neste dispositivo");
      return;
    }
    try { (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext(); } catch {}

    if (!styleRef.current) {
      const s = document.createElement("style");
      s.textContent = MAP_CSS;
      document.head.appendChild(s);
      styleRef.current = s;
    }

    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: containerEl,
        style: DARK_STYLE,
        center: [2.3522, 46.6034],
        zoom: 4.8,
        attributionControl: { compact: true },
        maxZoom: 18,
        minZoom: 2,
      });
    } catch (err) {
      setMapError((err as Error)?.message ?? "init failed");
      if (initRetryRef.current < 3) {
        initRetryRef.current += 1;
        const delay = 800 * initRetryRef.current;
        initTimerRef.current = window.setTimeout(() => setMapInitTick((n) => n + 1), delay);
      }
      return;
    }

    // GPU context-loss recovery (preserves engine, doesn't recreate map)
    const canvas = map.getCanvas();
    const onCtxLost = (e: Event) => {
      e.preventDefault();
      gpuContextLostRef.current = true;
      if (radarIntervalRef.current) {
        window.clearInterval(radarIntervalRef.current);
        radarIntervalRef.current = null;
      }
      setMapError("Contexto GPU perdido — restaurando…");
    };
    const onCtxRestored = () => {
      gpuContextLostRef.current = false;
      setMapError(null);
      try {
        map.resize();
        setSourceRecoveryTick((n) => n + 1);
        setRasterRecoveryTick((n) => n + 1);
        window.setTimeout(() => { try { map.triggerRepaint(); } catch {} }, 80);
      } catch {}
    };
    canvas.addEventListener("webglcontextlost", onCtxLost);
    canvas.addEventListener("webglcontextrestored", onCtxRestored);

    map.on("error", (e: any) => {
      // Isolated: tile/style/zoom errors won't crash the map
      const msg = e?.error?.message ?? String(e);
      if (/zoom|tile|404|aborted/i.test(msg)) return; // expected, ignore
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      try {
      /* ---- Empty sources & layers; populated by data effect -------- */
      const addClusterLayer = (id: string, color: string) => {
        map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] } as any,
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 12,
        });
        map.addLayer({
          id: `${id}-clusters`,
          type: "circle",
          source: id,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": color,
            "circle-opacity": 0.25,
            "circle-stroke-color": color,
            "circle-stroke-width": 2,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              16, 10, 22, 50, 30,
            ],
          },
        });
        map.addLayer({
          id: `${id}-cluster-count`,
          type: "symbol",
          source: id,
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-size": 12,
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: `${id}-points`,
          type: "circle",
          source: id,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": color,
            "circle-radius": 6,
            "circle-stroke-color": "rgba(255,255,255,0.9)",
            "circle-stroke-width": 1.5,
            "circle-blur": 0.15,
          },
        });
        // soft glow halo
        map.addLayer(
          {
            id: `${id}-glow`,
            type: "circle",
            source: id,
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": color,
              "circle-radius": 16,
              "circle-opacity": 0.18,
              "circle-blur": 1,
            },
          },
          `${id}-points`
        );
      };

      addClusterLayer("orders", "#a855f7");
      addClusterLayer("teams", "#22d3ee");
      addClusterLayer("operations", "#f59e0b");

      /* ---- PDR Intel heatmap (operational opportunities) ---- */
      map.addSource("pdr-heat", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });
      map.addLayer({
        id: "pdr-heatmap",
        type: "heatmap",
        source: "pdr-heat",
        paint: {
          "heatmap-weight": ["coalesce", ["get", "weight"], 0.3],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 9, 2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 22, 9, 60],
          "heatmap-opacity": 0.55,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0,    "rgba(0,0,0,0)",
            0.2,  "rgba(34,211,238,0.55)",
            0.45, "rgba(234,179,8,0.7)",
            0.7,  "rgba(249,115,22,0.85)",
            1,    "rgba(239,68,68,1)",
          ],
        },
      });
      map.addLayer({
        id: "pdr-points",
        type: "circle",
        source: "pdr-heat",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "potential"], 0, 4, 100, 16],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.85,
          "circle-stroke-color": "rgba(255,255,255,0.95)",
          "circle-stroke-width": 1.5,
        },
      });

      /* ---- Hail cells (real data, severity-colored, not clustered) ---- */
      map.addSource("hail", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });
      // Outer pulse halo — wider for confirmed, dim for forecast/closed
      map.addLayer({
        id: "hail-halo",
        type: "circle",
        source: "hail",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["*", ["get", "size_factor"],
            ["case", ["==", ["get", "is_confirmed"], 1], 2.0, 1.4]],
          "circle-opacity": [
            "case",
            ["==", ["get", "is_closed"], 1], 0.05,
            ["==", ["get", "is_forecast"], 1], 0.12,
            0.22,
          ],
          "circle-blur": 1,
        },
      });
      // Mid ring — solid for confirmed, lighter for forecast, gray for closed
      map.addLayer({
        id: "hail-ring",
        type: "circle",
        source: "hail",
        paint: {
          "circle-color": "transparent",
          "circle-radius": ["get", "size_factor"],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "is_closed"], 1], "#64748b",
            ["get", "color"],
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "is_confirmed"], 1], 2.5,
            ["==", ["get", "is_forecast"], 1], 1.2,
            1.6,
          ],
          "circle-stroke-opacity": [
            "case",
            ["==", ["get", "is_closed"], 1], 0.4,
            ["==", ["get", "is_forecast"], 1], 0.55,
            0.95,
          ],
        },
      });
      // Core — bright for confirmed, hollow-feel for forecast
      map.addLayer({
        id: "hail-core",
        type: "circle",
        source: "hail",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["max", 5, ["/", ["get", "size_factor"], 3]],
          "circle-stroke-color": "rgba(255,255,255,0.9)",
          "circle-stroke-width": [
            "case",
            ["==", ["get", "is_forecast"], 1], 1,
            1.5,
          ],
          "circle-opacity": [
            "case",
            ["==", ["get", "is_closed"], 1], 0.35,
            ["==", ["get", "is_forecast"], 1], 0.55,
            0.95,
          ],
        },
      });

      /* ---- Community hail reports (camera/marker layer) ---- */
      map.addSource("hail-reports", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });
      map.addLayer({
        id: "hail-reports-glow",
        type: "circle",
        source: "hail-reports",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["get", "confidence"], 0, 10, 1, 22],
          "circle-opacity": 0.18,
          "circle-blur": 0.9,
        },
      });
      map.addLayer({
        id: "hail-reports-core",
        type: "circle",
        source: "hail-reports",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 6,
          "circle-stroke-color": "rgba(255,255,255,0.95)",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      const onReportClick = (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const conf = Math.round(Number(p.confidence ?? 0) * 100);
        const html = `
          <div style="min-width:200px">
            <strong>${p.city || "Relato comunitário"}</strong>
            <div style="font-size:10px;opacity:.75">${p.country || ""}</div>
            <div style="margin-top:4px;font-size:11px">
              <span style="color:${p.color}">●</span> ${(p.severity || "").toUpperCase()} · ${p.hail_size_mm || 0}mm
            </div>
            <div style="font-size:10px;opacity:.75">Confiança ${conf}% · ${p.corroborations} corrob.</div>
            ${p.notes ? `<div style="font-size:10px;opacity:.7;margin-top:4px">${p.notes}</div>` : ""}
          </div>`;
        new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "240px" })
          .setLngLat(f.geometry.coordinates)
          .setHTML(html)
          .addTo(map);
      };
      ["hail-reports-core", "hail-reports-glow"].forEach((id) => {
        map.on("click", id, onReportClick);
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      });

      const popupHandler = (sourceId: string) => (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const html = sourceId === "teams"
          ? `<strong>${p.city}</strong><br/>${p.when}`
          : `<strong>${p.city || "—"}</strong><br/>${p.platform || ""} ${p.plate || ""}<br/><span style="opacity:.7">${p.status || ""}</span>`;
        new maplibregl.Popup({ closeButton: false, offset: 12 })
          .setLngLat(f.geometry.coordinates)
          .setHTML(html)
          .addTo(map);
      };
      ["orders", "teams", "operations"].forEach((id) => {
        map.on("click", `${id}-points`, popupHandler(id));
        map.on("mouseenter", `${id}-points`, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", `${id}-points`, () => (map.getCanvas().style.cursor = ""));
        // cluster zoom-in
        map.on("click", `${id}-clusters`, async (e: any) => {
          const f = e.features?.[0];
          if (!f) return;
          const src = map.getSource(id) as GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id);
          map.easeTo({ center: f.geometry.coordinates, zoom });
        });
      });

      /* ---- Hail click → open detail panel ---- */
      const onHailClick = (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        setSelectedHailId(f.properties.id);
        map.easeTo({ center: f.geometry.coordinates, duration: 600 });
      };
      ["hail-core", "hail-ring", "hail-halo", "pdr-points"].forEach((id) => {
        map.on("click", id, onHailClick);
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      });
      window.clearTimeout(fallbackReadyTimer);
      setMapReady(true);
      } catch (e) {
        void e;
        window.clearTimeout(fallbackReadyTimer);
        setMapReady(true);
      }
    });

    const fallbackReadyTimer = window.setTimeout(() => {
      setMapReady(true);
    }, 2000);

    mapRef.current = map;

    const radarTimer = radarTimerRef.current;
    const initTimer = initTimerRef.current;
    const radarStaggerTimer = radarStaggerTimerRef.current;

    return () => {
      window.clearTimeout(fallbackReadyTimer);
      if (radarTimer) window.clearTimeout(radarTimer);
      if (initTimer) window.clearTimeout(initTimer);
      if (radarStaggerTimer) window.clearTimeout(radarStaggerTimer);
      try { canvas.removeEventListener("webglcontextlost", onCtxLost); } catch {}
      try { canvas.removeEventListener("webglcontextrestored", onCtxRestored); } catch {}
      try { map.remove(); } catch {}
      mapRef.current = null;
      setMapReady(false);
    };
  }, [containerEl, mapInitTick]);

  /* -------- Safe per-layer setData (isolated failures) ------------- */
  const safeSetData = useCallback((id: string, data: any) => {
    const map = mapRef.current;
    if (!map || !(map as any).style || gpuContextLostRef.current) return;
    try {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      src?.setData(data);
    } catch (e) {
      void e;
    }
  }, []);

  /* -------- Push data into sources --------------------------------- */
  useEffect(() => {
    if (!mapReady) return;
    safeSetData("orders", ordersGeo);
    safeSetData("teams", teamsGeo);
    safeSetData("operations", operationsGeo);
  }, [mapReady, ordersGeo, teamsGeo, operationsGeo, safeSetData]);

  // Push hail data
  useEffect(() => {
    if (!mapReady) return;
    safeSetData("hail", hailGeo);
    safeSetData("hail-reports", hailReportsGeo);
  }, [mapReady, hailGeo, hailReportsGeo, safeSetData]);

  /* -------- PDR Operational Opportunities (intelligence layer) ----- */
  const oppOrders: OppOrder[] = useMemo(
    () => (ordersGeo.features as any[]).map((f) => ({
      id: f.properties?.id,
      city: f.properties?.city,
      platform: f.properties?.platform,
      plate: f.properties?.plate,
      status: f.properties?.status,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    })),
    [ordersGeo],
  );
  const oppTeams: OppTeam[] = useMemo(
    () => (teamsGeo.features as any[]).map((f) => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      city: f.properties?.city,
      when: f.properties?.when,
    })),
    [teamsGeo],
  );
  const oppHail: OppHailEvent[] = useMemo(
    () => visibleHailEvents.map((h) => ({
      id: h.id, city: h.city, region: h.region, country: h.country,
      lat: h.lat, lng: h.lng, radius_km: h.radius_km, severity: h.severity,
      status: h.status, hail_size_mm: h.hail_size_mm, probability: h.probability,
    })),
    [visibleHailEvents],
  );
  const opportunities = useMemo(
    () => computeOpportunities(oppHail, oppOrders, oppTeams),
    [oppHail, oppOrders, oppTeams],
  );
  const pdrHeatGeo = useMemo(() => opportunitiesToHeatmapGeoJSON(opportunities), [opportunities]);

  const syncActiveSources = useCallback(() => {
    const map = mapRef.current;
    if (!map || !(map as any).style || gpuContextLostRef.current) return;
    try { (map.getSource("orders") as GeoJSONSource | undefined)?.setData(ordersGeo as any); } catch (e) { void e; }
    try { (map.getSource("teams") as GeoJSONSource | undefined)?.setData(teamsGeo as any); } catch (e) { void e; }
    try { (map.getSource("operations") as GeoJSONSource | undefined)?.setData(operationsGeo as any); } catch (e) { void e; }
    try { (map.getSource("hail") as GeoJSONSource | undefined)?.setData(hailGeo as any); } catch (e) { void e; }
    try { (map.getSource("hail-reports") as GeoJSONSource | undefined)?.setData(hailReportsGeo as any); } catch (e) { void e; }
    try { (map.getSource("pdr-heat") as GeoJSONSource | undefined)?.setData(pdrHeatGeo as any); } catch (e) { void e; }
  }, [ordersGeo, teamsGeo, operationsGeo, hailGeo, hailReportsGeo, pdrHeatGeo]);

  useEffect(() => {
    if (!mapReady || sourceRecoveryTick === 0) return;
    syncActiveSources();
    const map = mapRef.current;
    if (!map || !(map as any).style || gpuContextLostRef.current) return;
    const setVis = (id: string, vis: boolean) => {
      try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none"); } catch {}
    };
    (["orders", "teams", "operations"] as const).forEach((k) => {
      [`${k}-clusters`, `${k}-cluster-count`, `${k}-points`, `${k}-glow`].forEach((id) => setVis(id, layersRef.current[k]));
    });
    ["hail-halo", "hail-ring", "hail-core", "hail-reports-glow", "hail-reports-core"].forEach((id) => setVis(id, layersRef.current.hail));
    ["pdr-heatmap", "pdr-points"].forEach((id) => setVis(id, layersRef.current.pdr));
  }, [mapReady, sourceRecoveryTick, syncActiveSources]);

  // Push PDR heatmap data
  useEffect(() => {
    if (!mapReady) return;
    safeSetData("pdr-heat", pdrHeatGeo);
  }, [mapReady, pdrHeatGeo, safeSetData]);

  // Soft pulse animation for confirmed/ongoing hail halos (throttled; no continuous RAF loop)
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    const t0 = performance.now();
    const tick = () => {
      if (cancelled) return;
      const map = mapRef.current;
      if (!map || !(map as any).style || gpuContextLostRef.current || !layersRef.current.hail) return;
      try {
        if (map.getLayer("hail-halo")) {
          const now = performance.now();
          const phase = ((now - t0) % 1800) / 1800;
          const pulse = 0.18 + 0.18 * Math.sin(phase * Math.PI * 2);
          map.setPaintProperty("hail-halo", "circle-opacity", [
            "case",
            ["==", ["get", "is_closed"], 1], 0.05,
            ["==", ["get", "is_forecast"], 1], 0.12,
            0.18 + pulse,
          ] as any);
        }
      } catch {
        return;
      }
    };
    tick();
    const id = window.setInterval(tick, 900);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [mapReady]);

  /* -------- Toggle layer visibility -------------------------------- */
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (gpuContextLostRef.current) return;
    const map = mapRef.current;
    const setVis = (id: string, vis: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none");
    };
    (["orders", "teams", "operations"] as const).forEach((k) => {
      setVis(`${k}-clusters`, layers[k]);
      setVis(`${k}-cluster-count`, layers[k]);
      setVis(`${k}-points`, layers[k]);
      setVis(`${k}-glow`, layers[k]);
    });
    // Hail layers
    ["hail-halo", "hail-ring", "hail-core"].forEach((id) => setVis(id, layers.hail));
    // Community reports follow hail layer
    ["hail-reports-glow", "hail-reports-core"].forEach((id) => setVis(id, layers.hail));
    // PDR Intel layers
    ["pdr-heatmap", "pdr-points"].forEach((id) => setVis(id, layers.pdr));
  }, [layers, mapReady]);

  /* -------- RainViewer radar layer (animated frame playback) ------- */
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (gpuContextLostRef.current) return;
    const map = mapRef.current;
    let cancelled = false;

    const cleanupRaster = () => {
      if (radarIntervalRef.current) {
        window.clearInterval(radarIntervalRef.current);
        radarIntervalRef.current = null;
      }
      if (radarStaggerTimerRef.current) {
        window.clearTimeout(radarStaggerTimerRef.current);
        radarStaggerTimerRef.current = null;
      }
      ["radar-layer", "storms-layer"].forEach((id) => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
      });
      ["radar-src", "storms-src"].forEach((id) => {
        try { if (map.getSource(id)) map.removeSource(id); } catch {}
      });
    };

    const wantsRaster = layers.radar || layers.storms;
    if (!wantsRaster) {
      cleanupRaster();
      return;
    }

    const buildUrl = (host: string, path: string, kind: "radar" | "storms") =>
      kind === "radar"
        ? `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`
        : `${host}${path}/256/{z}/{x}/{y}/7/1_1.png`;

    (async () => {
      // Graceful degradation: short timeout + status check prevent a stuck
      // /radar/ request from holding the layer in an invalid render state.
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), 8000);
      let json: any = null;
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`radar_sync_failure_${res.status}`);
        json = await res.json();
      } catch (e: any) {
        // Network/abort/5xx — silently degrade. Hail + base map continue working.
        if (e?.name !== "AbortError") {
          void e;
        }
        return;
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (cancelled || !json) return;

      const past = json?.radar?.past ?? [];
      const nowcast = json?.radar?.nowcast ?? [];
      const frames = [...past, ...nowcast];
      const host = typeof json?.host === "string" ? json.host : null;
      if (!frames.length || !host) return;
      radarFramesRef.current = { host, frames };
      radarIdxRef.current = past.length - 1; // start at "now"

      const reconcile = (kind: "radar" | "storms", active: boolean) => {
        const srcId = `${kind}-src`;
        const layerId = `${kind}-layer`;
        const hasLayer = !!map.getLayer(layerId);
        const hasSrc = !!map.getSource(srcId);
        if (active) {
          if (hasLayer) return;
          if (!hasSrc) {
            try {
              map.addSource(srcId, {
                type: "raster",
                tiles: [buildUrl(host, frames[radarIdxRef.current].path, kind)],
                tileSize: 256,
              });
            } catch {}
          }
          try {
            map.addLayer({
              id: layerId,
              type: "raster",
              source: srcId,
              paint: {
                "raster-opacity": kind === "radar" ? 0.55 : 0.65,
                "raster-fade-duration": 0,
              },
            }, map.getLayer("hail-halo") ? "hail-halo" : undefined);
          } catch {}
        } else {
          if (hasLayer) { try { map.removeLayer(layerId); } catch {} }
          if (hasSrc) { try { map.removeSource(srcId); } catch {} }
        }
      };

      try {
        reconcile("radar", !!layers.radar);
        if (layers.radar && layers.storms) {
          radarStaggerTimerRef.current = window.setTimeout(() => reconcile("storms", true), 120);
        } else {
          reconcile("storms", !!layers.storms);
        }
      } catch (e) {
        void e;
      }

      // Animate: cycle frames smoothly — only for currently-active layers.
      // Each frame swap is fully guarded so a single tile failure cannot
      // cascade into a broken render cycle.
      if (radarIntervalRef.current) window.clearInterval(radarIntervalRef.current);
      radarIntervalRef.current = window.setInterval(() => {
        if (gpuContextLostRef.current) return;
        const data = radarFramesRef.current;
        if (!data || !data.frames.length) return;
        radarIdxRef.current = (radarIdxRef.current + 1) % data.frames.length;
        const path = data.frames[radarIdxRef.current]?.path;
        if (!path) return;
        const updateRaster = (kind: "radar" | "storms") => {
          if (!map.getLayer(`${kind}-layer`)) return;
          const src = map.getSource(`${kind}-src`) as any;
          if (src && typeof src.setTiles === "function") {
            try { src.setTiles([buildUrl(data.host, path, kind)]); } catch {}
          }
        };
        updateRaster("radar");
        if (map.getLayer("storms-layer")) {
          if (radarStaggerTimerRef.current) window.clearTimeout(radarStaggerTimerRef.current);
          radarStaggerTimerRef.current = window.setTimeout(() => updateRaster("storms"), 160);
        }
      }, 2400);
    })();

    return () => {
      cancelled = true;
      if (radarIntervalRef.current) {
        window.clearInterval(radarIntervalRef.current);
        radarIntervalRef.current = null;
      }
      if (radarStaggerTimerRef.current) {
        window.clearTimeout(radarStaggerTimerRef.current);
        radarStaggerTimerRef.current = null;
      }
    };
  }, [layers.radar, layers.storms, mapReady, rasterRecoveryTick]);

  const toggleLayer = useCallback((k: LayerKey) => {
    setLayers((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  const isLoadingOperationalData = loadingSO || loadingGeo;

  return (
    <div className="glass-panel rounded-xl p-5 animate-fade-in">
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <HailRadarIcon className="text-cyan-400" size={16} />
            {t("chart.activeRegions") || "Radar de Granizo"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("chart.techDistribution") || "Detecção de granizo e tempestade em tempo real"}
          </p>
          {/* Ingest health badge — exposes silent failures of the weather pipeline */}
          {(() => {
            const latest = hailEvents.reduce((max, h) => {
              const ts = h.observed_time || h.forecast_time;
              if (!ts) return max;
              const ms = new Date(ts).getTime();
              return ms > max ? ms : max;
            }, 0);
            if (!latest) {
              return (
                <p className="text-[10px] mt-1 flex items-center gap-1 text-amber-400/80">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Sem dados meteorológicos na janela — aguardando próxima sincronização
                </p>
              );
            }
            const ageMin = Math.round((Date.now() - latest) / 60000);
            const stale = ageMin > 60;
            return (
              <p className={`text-[10px] mt-1 flex items-center gap-1 ${stale ? "text-amber-400/80" : "text-emerald-400/80"}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />
                Última leitura há {ageMin < 60 ? `${ageMin}min` : `${Math.round(ageMin / 60)}h`} · {hailEvents.length} eventos · {hailReports.length} reports
              </p>
            );
          })()}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {LAYER_DEFS.map(({ key, label, icon: Icon, color }) => {
            const active = layers[key];
            return (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className="text-[10px] px-2 py-1 rounded-md border transition-all flex items-center gap-1"
                style={{
                  borderColor: active ? color : "hsl(220 12% 22%)",
                  background: active ? `${color}22` : "transparent",
                  color: active ? color : "hsl(var(--muted-foreground))",
                  boxShadow: active ? `0 0 8px ${color}55` : "none",
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
          <HailReportDialog />
        </div>
      </div>

      {/* -------- Hail filters + timeline replay (only when hail layer on) -------- */}
      {layers.hail && (
        <HailControls
          statusFilter={hailStatusFilter}
          onStatusFilter={setHailStatusFilter}
          severityFilter={hailSeverityFilter}
          onSeverityFilter={setHailSeverityFilter}
          minSizeMm={hailMinSizeMm}
          onMinSizeMm={setHailMinSizeMm}
          windowHours={hailWindowHours}
          onWindowHours={setHailWindowHours}
          replayCursor={replayCursor}
          onReplayCursor={setReplayCursor}
          replayPlaying={replayPlaying}
          onReplayToggle={() => {
            if (replayCursor >= 1) setReplayCursor(0);
            setReplayPlaying((p) => !p);
          }}
          replayTimeMs={replayTimeMs}
          eventCount={visibleHailEvents.length}
          totalCount={hailEvents.length}
        />
      )}

      <div className="relative">
        <div
          ref={setContainerRef}
          className="h-[420px] rounded-lg overflow-hidden relative"
          style={{ background: "#0a1628" }}
        />
        {/* Loading overlay (mapa base permanece sempre montado) */}
        {!mapReady && !mapError && (
          <div className="absolute inset-0 rounded-lg bg-[#0a1628]/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="text-[11px] text-cyan-300/80 animate-pulse">
              Inicializando mapa…
            </div>
          </div>
        )}
        {mapReady && isLoadingOperationalData && !mapError && (
          <div className="absolute top-2 right-2 z-10 text-[10px] text-cyan-300/85 bg-[#0a1628]/70 border border-cyan-500/20 rounded px-2 py-1 pointer-events-none backdrop-blur-sm">
            Carregando dados operacionais…
          </div>
        )}
        {/* Map init/WebGL error fallback with retry + non-WebGL list */}
        {mapError && (
          <div className="absolute inset-0 rounded-lg bg-[#0a1628]/90 flex flex-col items-center justify-center gap-2 text-center px-6 overflow-auto">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
            <div className="text-xs text-amber-200">Mapa em modo seguro</div>
            <div className="text-[10px] text-muted-foreground max-w-[320px]">{mapError}</div>
            <button
              onClick={() => {
                initRetryRef.current = 0;
                if (!mapRef.current) setMapInitTick((n) => n + 1);
                else {
                  gpuContextLostRef.current = false;
                  setSourceRecoveryTick((n) => n + 1);
                  setRasterRecoveryTick((n) => n + 1);
                }
                setMapError(null);
              }}
              className="mt-1 text-[11px] px-3 py-1 rounded-md border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
            >
              Tentar novamente
            </button>
            {/* Non-WebGL fallback: textual hail summary so operations don't stop */}
            {hailEvents.length > 0 && (
              <div className="mt-3 w-full max-w-[420px] text-left">
                <div className="text-[10px] uppercase tracking-wider text-cyan-300/70 mb-1">
                  Eventos ativos ({hailEvents.length})
                </div>
                <ul className="space-y-1 max-h-32 overflow-auto pr-1">
                  {hailEvents.slice(0, 8).map((h) => {
                    const reps = reportsByEvent.get(h.id) ?? [];
                    return (
                      <li key={h.id} className="text-[10px] flex justify-between items-center gap-2 border border-white/5 rounded px-2 py-1 bg-white/[0.02]">
                        <span className="truncate flex items-center gap-1.5">
                          {reps.length > 0 ? (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[9px] font-semibold"
                              style={{ background: "#ef444422", color: "#fca5a5", border: "1px solid #ef444455" }}
                              title={`${reps.length} relato(s) confirmando granizo`}
                            >
                              <CloudRain className="h-2.5 w-2.5" /> {reps.length}
                            </span>
                          ) : (
                            <span className="opacity-50" title="Sem relatos reais"><Eye className="h-2.5 w-2.5" /></span>
                          )}
                          <span className="truncate">{h.city ?? h.region ?? "—"}</span>
                        </span>
                        <span style={{ color: HAIL_COLORS[h.severity] }}>{h.severity}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
        {/* Diagnostic badge: provider + status */}
        <div className="absolute top-2 left-2 z-10 text-[9px] font-mono text-cyan-200/70 bg-[#0a1628]/70 border border-cyan-500/20 rounded px-2 py-0.5 pointer-events-none">
          CARTO · {mapReady ? "online" : "init"} · hail:{hailEvents.length}
        </div>
        {/* -------- Elegant operational legend overlay -------- */}
        {layers.hail && mapReady && <HailLegend />}
      </div>

      {/* -------- Dynamic operational command panel -------- */}
      {selectedHail && (
        <ErrorBoundary
          fallback={
            <div className="mt-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-300">
              Painel operacional indisponível para este evento. O mapa continua activo.
            </div>
          }
        >
          <OperationalPanel
            event={selectedHail}
            teams={(teamsGeo.features as any[]).map((f): PanelTeam => ({
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
              city: f.properties?.city,
              when: f.properties?.when,
            }))}
            orders={(ordersGeo.features as any[]).map((f): PanelOrder => ({
              id: f.properties?.id,
              city: f.properties?.city,
              platform: f.properties?.platform,
              plate: f.properties?.plate,
              status: f.properties?.status,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            }))}
            onClose={() => setSelectedHailId(null)}
            reports={reportsByEvent.get(selectedHail.id) ?? []}
          />
        </ErrorBoundary>
      )}


      {/* -------- PDR Operational Opportunities (intelligence panel) -------- */}
      {layers.pdr && (
        <ErrorBoundary fallback={null}>
          <OperationalOpportunities
            opportunities={opportunities}
            onSelect={(opp) => {
              setSelectedHailId(opp.id);
              mapRef.current?.easeTo({ center: [opp.hail.lng, opp.hail.lat], zoom: 7, duration: 700 });
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

/* ====================================================================== */
/*  Hail filter + timeline replay controls                                 */
/* ====================================================================== */
type StatusFilterOpt = "all" | "forecast" | "ongoing" | "confirmed";
const STATUS_OPTS: { key: StatusFilterOpt; label: string; color: string }[] = [
  { key: "all", label: "Todos", color: "#94a3b8" },
  { key: "forecast", label: "Previsão", color: "#eab308" },
  { key: "ongoing", label: "Ativo", color: "#f97316" },
  { key: "confirmed", label: "Confirmado", color: "#ef4444" },
];

function HailControls({
  statusFilter, onStatusFilter,
  severityFilter, onSeverityFilter,
  minSizeMm, onMinSizeMm,
  windowHours, onWindowHours,
  replayCursor, onReplayCursor,
  replayPlaying, onReplayToggle,
  replayTimeMs, eventCount, totalCount,
}: {
  statusFilter: StatusFilterOpt;
  onStatusFilter: (v: StatusFilterOpt) => void;
  severityFilter: Record<HailSeverity, boolean>;
  onSeverityFilter: (v: Record<HailSeverity, boolean>) => void;
  minSizeMm: number;
  onMinSizeMm: (v: number) => void;
  windowHours: number;
  onWindowHours: (v: number) => void;
  replayCursor: number;
  onReplayCursor: (v: number) => void;
  replayPlaying: boolean;
  onReplayToggle: () => void;
  replayTimeMs: number;
  eventCount: number;
  totalCount: number;
}) {
  const SEVS: HailSeverity[] = ["low", "moderate", "severe", "extreme"];
  const SEV_LABEL: Record<HailSeverity, string> = {
    low: "Baixo", moderate: "Mod.", severe: "Severo", extreme: "Extremo",
  };
  const isLive = replayCursor >= 0.999;
  return (
    <div
      className="mb-3 rounded-lg border p-2.5 animate-fade-in"
      style={{
        background: "linear-gradient(135deg, rgba(15,23,42,0.7), rgba(15,23,42,0.45))",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3 w-3" /> Granizo
        </span>
        <div className="flex gap-1">
          {STATUS_OPTS.map((opt) => {
            const active = statusFilter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => onStatusFilter(opt.key)}
                className="text-[10px] px-2 py-1 rounded-md border transition"
                style={{
                  borderColor: active ? opt.color : "rgba(255,255,255,0.1)",
                  background: active ? `${opt.color}22` : "transparent",
                  color: active ? opt.color : "hsl(var(--muted-foreground))",
                  boxShadow: active ? `0 0 8px ${opt.color}55` : "none",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {SEVS.map((s) => {
            const active = severityFilter[s];
            const c = HAIL_COLORS[s];
            return (
              <button
                key={s}
                onClick={() => onSeverityFilter({ ...severityFilter, [s]: !active })}
                className="text-[10px] px-2 py-1 rounded-md border transition flex items-center gap-1"
                style={{
                  borderColor: active ? c : "rgba(255,255,255,0.08)",
                  background: active ? `${c}22` : "transparent",
                  color: active ? c : "hsl(var(--muted-foreground))",
                  opacity: active ? 1 : 0.6,
                }}
                title={SEV_LABEL[s]}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                {SEV_LABEL[s]}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Gauge className="h-3 w-3" />
          ≥
          <input
            type="number" min={0} max={100} step={1}
            value={minSizeMm}
            onChange={(e) => onMinSizeMm(Math.max(0, Number(e.target.value) || 0))}
            className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-foreground tabular-nums"
          />
          mm
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <select
            value={windowHours}
            onChange={(e) => { onWindowHours(Number(e.target.value)); onReplayCursor(1); }}
            className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-foreground"
          >
            {[1, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </label>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {eventCount}/{totalCount} eventos
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onReplayToggle}
          className="p-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 transition text-foreground"
          title={replayPlaying ? "Pausar" : "Reproduzir"}
        >
          {replayPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
        <button
          onClick={() => onReplayCursor(1)}
          className="p-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 transition text-muted-foreground"
          title="Voltar ao tempo real"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <input
          type="range" min={0} max={1} step={0.01}
          value={replayCursor}
          onChange={(e) => onReplayCursor(Number(e.target.value))}
          className="flex-1 accent-cyan-400"
        />
        <span className="text-[10px] tabular-nums text-muted-foreground w-28 text-right">
          {isLive ? (
            <span className="text-cyan-400 flex items-center gap-1 justify-end">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
              AO VIVO
            </span>
          ) : (
            new Date(replayTimeMs).toLocaleTimeString(undefined, {
              hour: "2-digit", minute: "2-digit",
            })
          )}
        </span>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Elegant operational legend overlay                                     */
/* ====================================================================== */
function HailLegend() {
  return (
    <div
      className="absolute bottom-3 left-3 rounded-lg p-2.5 text-[10px] border animate-fade-in pointer-events-none"
      style={{
        background: "linear-gradient(135deg, rgba(10,16,28,0.85), rgba(10,16,28,0.65))",
        borderColor: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(8px)",
        minWidth: 140,
      }}
    >
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">Severidade</div>
      <div className="space-y-1">
        {(["low", "moderate", "severe", "extreme"] as HailSeverity[]).map((s) => {
          const c = HAIL_COLORS[s];
          const label = { low: "Baixo", moderate: "Moderado", severe: "Severo", extreme: "Extremo" }[s];
          return (
            <div key={s} className="flex items-center gap-1.5 text-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}88` }} />
              {label}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-2 mb-1">Estado</div>
      <div className="space-y-1 text-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border opacity-70" style={{ borderColor: "#eab308" }} />
          Previsão
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444", boxShadow: "0 0 6px #ef444488" }} />
          Confirmado
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#64748b", opacity: 0.5 }} />
          Encerrado
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Detail Panel — opens below the map when a hail cell is clicked         */
/* ====================================================================== */
const STATUS_LABEL: Record<HailStatus, string> = {
  forecast: "Prévision",
  ongoing: "Ao Vivo",
  confirmed: "Confirmado",
  closed: "Expirado",
};
const SEVERITY_LABEL: Record<HailSeverity, string> = {
  low: "Baixo risco",
  moderate: "Moderado",
  severe: "Severo",
  extreme: "Extremo",
};
const STATUS_DOT: Record<HailStatus, string> = {
  forecast: "bg-amber-400",
  ongoing: "bg-orange-500 animate-pulse",
  confirmed: "bg-red-500 animate-pulse",
  closed: "bg-zinc-500",
};

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function HailDetailPanel({ event, onClose }: { event: HailEvent; onClose: () => void }) {
  const color = HAIL_COLORS[event.severity];
  return (
    <div
      className="mt-4 rounded-xl p-4 animate-fade-in border relative"
      style={{
        background: "linear-gradient(135deg, rgba(15,23,42,0.85), rgba(15,23,42,0.6))",
        borderColor: `${color}55`,
        boxShadow: `0 0 24px ${color}22, inset 0 0 1px ${color}55`,
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/10 text-muted-foreground"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 mb-3">
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center"
          style={{ background: `${color}22`, border: `1px solid ${color}66` }}
        >
          <AlertTriangle className="h-5 w-5" style={{ color }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground truncate">
              {event.city || "—"}{event.region ? `, ${event.region}` : ""}{event.country ? ` · ${event.country}` : ""}
            </h4>
            {event.is_demo && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">DEMO</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] flex-wrap">
            <span className="flex items-center gap-1.5" style={{ color }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {SEVERITY_LABEL[event.severity]}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[event.status]}`} />
              {STATUS_LABEL[event.status]}
            </span>
            <span className="text-muted-foreground/70">fonte: {event.source}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric icon={<Gauge className="h-3 w-3" />} label="Tamanho est." value={event.hail_size_mm ? `${event.hail_size_mm} mm` : "—"} />
        <Metric icon={<AlertTriangle className="h-3 w-3" />} label="Probabilidade" value={event.probability != null ? `${Math.round(event.probability * 100)}%` : "—"} />
        <Metric icon={<Zap className="h-3 w-3" />} label="Intensidade" value={event.intensity != null ? `${Math.round(event.intensity)}/100` : "—"} />
        <Metric icon={<Wind className="h-3 w-3" />} label="Velocidade" value={event.storm_speed_kmh ? `${event.storm_speed_kmh} km/h` : "—"} />
        <Metric icon={<Clock className="h-3 w-3" />} label="Previsto" value={fmtTime(event.forecast_time)} />
        <Metric icon={<Clock className="h-3 w-3" />} label="Observado" value={fmtTime(event.observed_time)} />
        <Metric icon={<Clock className="h-3 w-3" />} label="Expira" value={fmtTime(event.expires_at)} />
        <Metric icon={<Radar className="h-3 w-3" />} label="Raio" value={`${event.radius_km} km`} />
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5 bg-white/[0.03] border border-white/5">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="text-xs font-medium text-foreground mt-0.5">{value}</div>
    </div>
  );
}
