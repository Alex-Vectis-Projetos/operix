import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useLanguage } from "@/hooks/useLanguage";
import { Skeleton } from "@/components/ui/skeleton";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Configure worker URL explicitly for Vite bundler
// @ts-ignore
import maplibreglWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

if (typeof window !== "undefined" && typeof setWorkerUrl === "function") {
  setWorkerUrl(maplibreglWorkerUrl);
}
import { Users, CloudRain, Zap, Radar, Wrench, FileText, X, AlertTriangle, Wind, Clock, Gauge, Filter, Play, Pause, RotateCcw, Target, Eye, Network, Share2 } from "lucide-react";
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
/*  City & Country centroids for comprehensive operational geocoding   */
/* ------------------------------------------------------------------ */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  PT: [-8.2245, 39.3999], // Portugal
  ES: [-3.7038, 40.4168], // Espanha
  FR: [2.2137, 46.2276],  // França
  CH: [8.2275, 46.8182],  // Suíça
  DE: [10.4515, 51.1657], // Alemanha
  IT: [12.5674, 41.8719], // Itália
  GB: [-2.0000, 54.0000], // Reino Unido
  BE: [4.4699, 50.5039],  // Bélgica
  NL: [5.2913, 52.1326],  // Holanda
  AT: [14.5501, 47.5162], // Áustria
  BR: [-47.8825, -15.7942], // Brasil
  US: [-95.7129, 37.0902], // EUA
};

export const CITY_COORDS: Record<string, [number, number]> = {
  // Portugal
  lisboa: [-9.1393, 38.7223],
  lisbon: [-9.1393, 38.7223],
  porto: [-8.6291, 41.1579],
  "vila nova de gaia": [-8.6139, 41.1333],
  gaia: [-8.6139, 41.1333],
  amadora: [-9.2302, 38.7538],
  braga: [-8.4265, 41.5454],
  coimbra: [-8.4116, 40.2033],
  funchal: [-16.9085, 32.6669],
  setubal: [-8.8919, 38.5244],
  almada: [-9.1583, 38.6792],
  queluz: [-9.2544, 38.7567],
  faro: [-7.9304, 37.0194],
  aveiro: [-8.6538, 40.6405],
  viseu: [-7.9142, 40.6566],
  leiria: [-8.8077, 39.7438],
  guimaraes: [-8.2961, 41.4425],
  evora: [-7.9093, 38.5714],
  portimao: [-8.5379, 37.1363],
  sintra: [-9.3817, 38.8029],
  cascais: [-9.4215, 38.6979],
  santarem: [-8.6833, 39.2333],
  matosinhos: [-8.6869, 41.1824],
  maia: [-8.6214, 41.2333],
  braganca: [-6.7572, 41.8061],
  "castelo branco": [-7.4917, 39.8222],
  "viana do castelo": [-8.8322, 41.6918],

  // Espanha
  madrid: [-3.7038, 40.4168],
  barcelona: [2.1734, 41.3851],
  valencia: [-0.3763, 39.4699],
  sevilla: [-5.9845, 37.3891],
  sevilha: [-5.9845, 37.3891],
  zaragoza: [-0.8891, 41.6488],
  malaga: [-4.4214, 36.7213],
  murcia: [-1.1307, 37.9922],
  palma: [2.6502, 39.5696],
  bilbao: [-2.9350, 43.2630],
  alicante: [-0.4810, 38.3452],
  cordoba: [-4.7794, 37.8882],
  valladolid: [-4.7245, 41.6523],
  vigo: [-8.7207, 42.2406],
  gijon: [-5.6615, 43.5322],
  granada: [-3.5986, 37.1773],
  coruna: [-8.4115, 43.3623],
  toledo: [-4.0273, 39.8628],
  salamanca: [-5.6635, 40.9701],

  // França
  paris: [2.3522, 48.8566],
  lyon: [4.8357, 45.7640],
  marseille: [5.3698, 43.2965],
  toulouse: [1.4442, 43.6047],
  nice: [7.2620, 43.7102],
  nantes: [-1.5536, 47.2184],
  strasbourg: [7.7521, 48.5734],
  montpellier: [3.8767, 43.6108],
  bordeaux: [-0.5792, 44.8378],
  lille: [3.0573, 50.6292],
  rennes: [-1.6778, 48.1173],
  grenoble: [5.7245, 45.1885],
  rouen: [1.0999, 49.4432],
  toulon: [5.9280, 43.1242],
  "clermont-ferrand": [3.0870, 45.7772],
  "le mans": [0.1996, 48.0061],
  dijon: [5.0415, 47.3220],
  angers: [-0.5632, 47.4784],
  "saint-etienne": [4.3872, 45.4397],
  tours: [0.6848, 47.3941],
  reims: [4.0317, 49.2583],
  "le havre": [0.1079, 49.4944],

  // Suíça
  geneve: [6.1432, 46.2044],
  geneva: [6.1432, 46.2044],
  zurich: [8.5417, 47.3769],
  basel: [7.5886, 47.5596],
  bern: [7.4474, 46.9480],
  lausanne: [6.6323, 46.5197],
  lugano: [8.9536, 46.0037],

  // Alemanha
  berlin: [13.4050, 52.5200],
  munich: [11.5820, 48.1351],
  munique: [11.5820, 48.1351],
  frankfurt: [8.6821, 50.1109],
  hamburg: [9.9937, 53.5511],
  cologne: [6.9603, 50.9375],
  koln: [6.9603, 50.9375],
  stuttgart: [9.1829, 48.7758],
  dusseldorf: [6.7735, 51.2277],
  dortmund: [7.4653, 51.5136],

  // Itália
  roma: [12.4964, 41.9028],
  rome: [12.4964, 41.9028],
  milano: [9.1900, 45.4642],
  milan: [9.1900, 45.4642],
  napoli: [14.2681, 40.8518],
  torino: [7.6869, 45.0703],
  bologna: [11.3426, 44.4949],
  firenze: [11.2558, 43.7696],
  venezia: [12.3155, 45.4408],

  // Brasil
  "sao paulo": [-46.6333, -23.5505],
  "rio de janeiro": [-43.1729, -22.9068],
  brasilia: [-47.8825, -15.7942],
  "belo horizonte": [-43.9378, -19.9208],
  curitiba: [-49.2731, -25.4284],
  "porto alegre": [-51.2177, -30.0346],
  salvador: [-38.5108, -12.9714],
  campinas: [-47.0608, -22.9056],
  florianopolis: [-48.5496, -27.5954],
};

function normalizeGeoText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

export function guessCityFromText(text: string): string | null {
  if (!text) return null;
  const lower = normalizeGeoText(text);
  for (const city of Object.keys(CITY_COORDS)) {
    if (lower.includes(city)) return city;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Dark premium MapLibre style (OpenFreeMap Vector — Keyless & Clean) */
/* ------------------------------------------------------------------ */
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

/* ------------------------------------------------------------------ */
/*  Layer config                                                       */
/* ------------------------------------------------------------------ */
type LayerKey = "teams" | "orders" | "operations" | "network" | "radar" | "storms" | "hail" | "pdr";

const LAYER_DEFS: { key: LayerKey; label: string; icon: any; color: string }[] = [
  { key: "teams", label: "Equipes", icon: Users, color: "#22d3ee" },
  { key: "orders", label: "Ordens", icon: FileText, color: "#a855f7" },
  { key: "operations", label: "Operações", icon: Wrench, color: "#10b981" },
  { key: "network", label: "Rede / Arcos", icon: Network, color: "#38bdf8" },
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
  const fallbackReadyTimerRef = useRef<number | null>(null);
  const layersMountedRef = useRef(false);
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
    network: true,
    radar: true,
    storms: false,
    hail: true,
    pdr: true,
  });

  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  /* -------- data: workspace registered locations ------------------- */
  const { data: locationsList = [] } = useQuery<any[]>({
    queryKey: ["op-map-locations"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async () => {
      const data = await apiRequest<any[]>("/locations").catch(() => []);
      return Array.isArray(data) ? data : [];
    },
  });

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
      const legacyOrders = (soData.orders ?? []).map((o: any) => ({
        ...o,
        car_name: o.car_name || "Veículo",
      }));
      const prodOrders: any[] = Array.isArray(poData) ? poData : (poData?.orders ?? []);
      const mappedProdOrders = prodOrders.map((p) => ({
        id: p.id,
        code: p.code || p.order_number || p.id,
        platform: p.platform || p.client_name || p.clientName || "Operação",
        client_name: p.client_name || p.clientName || "",
        technician_name: p.technician_name || p.technicianName || "",
        car_name: [p.brand, p.model].filter(Boolean).join(" ") || p.car_name || "Veículo",
        license_plate: p.license_plate || p.licensePlate || "",
        location_id: p.location_id || p.locationId || null,
        location_name: p.location_name || p.locationName || null,
        operational_site_key: p.operational_site_key || p.operationalSiteKey || null,
        notes: p.notes || "",
        status: p.status || "open",
        priority: p.priority || "normal",
      }));
      return [...legacyOrders, ...mappedProdOrders];
    },
  });

  /* -------- data: geo checkins and branch locations (teams) --------- */
  const { data: geoCheckins = [], isLoading: loadingGeo } = useQuery({
    queryKey: ["op-map-geo", locationsList],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async () => {
      const eventsData = await apiRequest<{ events: any[] }>(
        "/weather/backend-events?table_name=geolocation&action=CHECKIN&limit=300"
      ).catch(() => ({ events: [] }));

      const eventPoints = (eventsData.events ?? []).flatMap((event: any) => {
        const lat = Number(event.payload?.lat);
        const lng = Number(event.payload?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng)
          ? [{ ...event, payload: { ...event.payload, lat, lng } }]
          : [];
      });

      const locPoints = locationsList.flatMap((loc: any, idx: number) => {
        let lat = Number(loc.latitude ?? loc.lat);
        let lng = Number(loc.longitude ?? loc.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          // Resolve from address_city or name
          const cityMatch = guessCityFromText([loc.address_city, loc.name, loc.address_state].filter(Boolean).join(" "));
          if (cityMatch && CITY_COORDS[cityMatch]) {
            [lng, lat] = CITY_COORDS[cityMatch];
          } else {
            const countryKey = (loc.address_country || "PT").toUpperCase();
            const centroid = COUNTRY_CENTROIDS[countryKey] || COUNTRY_CENTROIDS.PT;
            [lng, lat] = centroid;
          }
          // Subtle deterministic jitter for multiple locations in the same city/region
          const jx = (((idx * 17 + 7) % 20) / 20 - 0.5) * 0.05;
          const jy = (((idx * 23 + 11) % 20) / 20 - 0.5) * 0.05;
          lng += jx;
          lat += jy;
        }

        return [{
          id: loc.id,
          created_at: loc.created_at || new Date().toISOString(),
          payload: {
            lat,
            lng,
            name: loc.name,
            city: loc.address_city || loc.name || "Base Operacional",
            address: [loc.address_street, loc.address_number, loc.address_city].filter(Boolean).join(", "),
            manager: loc.manager_name || loc.managerName || null,
            phone: loc.phone || null,
            status: loc.status || "active",
          },
        }];
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
    return (hailEvents ?? []).map((h: any) => {
      const rawDate =
        h.observed_time ??
        h.observedTime ??
        h.forecast_time ??
        h.forecastTime ??
        h.expires_at ??
        h.expiresAt ??
        null;
      const ts = rawDate ? new Date(rawDate).getTime() : Date.now();
      const radiusKm = Number(h.radius_km ?? h.radiusKm ?? 25);
      const hailSizeMm = Number(h.hail_size_mm ?? h.hailSizeMm ?? 0);
      const sev = (String(h.severity || "moderate").toLowerCase() as HailSeverity);
      const stat = (String(h.status || "forecast").toLowerCase() as HailStatus);
      return {
        id: h.id,
        lat: Number(h.lat),
        lng: Number(h.lng),
        status: stat,
        severity: sev,
        forecast: stat === "forecast",
        active: stat === "ongoing",
        confirmed: stat === "confirmed",
        timestamp: isNaN(ts) ? Date.now() : ts,
        confidence: Number(h.probability ?? h.confidence ?? 0),
        source: h.source ?? "meteoalarm",
        size: hailSizeMm,
        raw: {
          ...h,
          radius_km: radiusKm,
          hail_size_mm: hailSizeMm,
          severity: sev,
          status: stat,
          observed_time: h.observed_time ?? h.observedTime ?? null,
          forecast_time: h.forecast_time ?? h.forecastTime ?? null,
          expires_at: h.expires_at ?? h.expiresAt ?? null,
        },
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
    const hash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return h;
    };

    // Fast lookup for workspace locations
    const locationCoordsMap = new Map<string, [number, number]>();
    for (const loc of locationsList) {
      const matchedCity = guessCityFromText([loc.address_city, loc.name].filter(Boolean).join(" "));
      const coords = (matchedCity && CITY_COORDS[matchedCity])
        ? CITY_COORDS[matchedCity]
        : COUNTRY_CENTROIDS[(loc.address_country || "PT").toUpperCase()] || COUNTRY_CENTROIDS.PT;
      if (loc.id) locationCoordsMap.set(loc.id, coords);
      if (loc.name) locationCoordsMap.set(normalizeGeoText(loc.name), coords);
    }

    for (const o of serviceOrders) {
      let [lng, lat] = [0, 0];
      let resolvedCity = "";

      // 1. Try matching with linked location ID or location name
      if (o.location_id && locationCoordsMap.has(o.location_id)) {
        [lng, lat] = locationCoordsMap.get(o.location_id)!;
        resolvedCity = o.location_name || "Base";
      } else if (o.location_name && locationCoordsMap.has(normalizeGeoText(o.location_name))) {
        [lng, lat] = locationCoordsMap.get(normalizeGeoText(o.location_name))!;
        resolvedCity = o.location_name;
      } else {
        // 2. Try city name anywhere in order text
        const combinedText = [
          o.platform,
          o.client_name,
          o.clientName,
          o.car_name,
          o.license_plate,
          o.licensePlate,
          o.operational_site_key,
          o.operationalSiteKey,
          o.notes,
        ].filter(Boolean).join(" ");

        const city = guessCityFromText(combinedText);
        if (city && CITY_COORDS[city]) {
          [lng, lat] = CITY_COORDS[city];
          resolvedCity = city.charAt(0).toUpperCase() + city.slice(1);
        } else if (locationsList.length > 0) {
          // 3. Fallback: anchor to workspace's active location
          const firstLocation = locationsList[0];
          const matchedCityLoc = guessCityFromText([firstLocation?.address_city, firstLocation?.name].filter(Boolean).join(" "));
          const baseCoords = (matchedCityLoc && CITY_COORDS[matchedCityLoc])
            ? CITY_COORDS[matchedCityLoc]
            : COUNTRY_CENTROIDS[(firstLocation?.address_country || "PT").toUpperCase()] || COUNTRY_CENTROIDS.PT;
          [lng, lat] = baseCoords;
          resolvedCity = firstLocation?.name || firstLocation?.address_city || "Operação";
        } else {
          // 4. Fallback to default centroid (Portugal)
          [lng, lat] = COUNTRY_CENTROIDS.PT;
          resolvedCity = "Base Principal";
        }
      }

      // Add deterministic jitter so overlapping orders in the same location/city have distinct spots
      const h = hash(String(o.id ?? o.license_plate ?? o.code));
      const jx = (((h & 0xff) / 255) - 0.5) * 0.045;
      const jy = ((((h >> 8) & 0xff) / 255) - 0.5) * 0.045;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng + jx, lat + jy] },
        properties: {
          id: o.id,
          code: o.code || o.id,
          city: resolvedCity,
          platform: o.platform || o.client_name || "Operação",
          plate: o.license_plate || o.licensePlate || "",
          car_name: o.car_name || "Veículo",
          technician: o.technician_name || "",
          status: o.status || "open",
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [serviceOrders, locationsList]);

  const teamsGeo = useMemo(() => {
    const features = geoCheckins.map((c: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.payload.lng, c.payload.lat] },
      properties: {
        id: c.id,
        name: c.payload.name || c.payload.city || "Base Operacional",
        city: c.payload.city ?? "Check-in",
        address: c.payload.address || "",
        manager: c.payload.manager || "",
        phone: c.payload.phone || "",
        status: c.payload.status || "active",
        when: new Date(c.created_at).toLocaleDateString(),
      },
    }));
    return { type: "FeatureCollection", features };
  }, [geoCheckins]);

  const operationsGeo = useMemo(() => {
    // Operations = orders that are in progress or open
    const features = (ordersGeo.features as any[]).filter((f) => {
      const s = String(f.properties.status).toLowerCase();
      return (
        s.includes("progress") ||
        s.includes("andamento") ||
        s.includes("aberta") ||
        s.includes("open") ||
        s.includes("executando")
      );
    });
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

  /**
   * Generates curved geodesic / quadratic Bézier arc coordinates
   * between two geo-coordinates to create glowing flight/dispatch paths.
   */
  function createCurvedArc(
    start: [number, number],
    end: [number, number],
    steps: number = 24
  ): [number, number][] {
    const [lng1, lat1] = start;
    const [lng2, lat2] = end;

    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.001) return [start, end];

    const midLng = (lng1 + lng2) / 2;
    const midLat = (lat1 + lat2) / 2;

    const nx = -dy / dist;
    const ny = dx / dist;

    const arcHeight = Math.min(dist * 0.18, 3.2);

    const ctrlLng = midLng + nx * arcHeight;
    const ctrlLat = midLat + ny * arcHeight;

    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const invT = 1 - t;
      const lng = invT * invT * lng1 + 2 * invT * t * ctrlLng + t * t * lng2;
      const lat = invT * invT * lat1 + 2 * invT * t * ctrlLat + t * t * lat2;
      coords.push([lng, lat]);
    }
    return coords;
  }

  /* -------- Network curved geodesic arcs (Mission Control Topology) -- */
  const networkGeo = useMemo(() => {
    const features: any[] = [];
    const teamPoints: [number, number][] = (teamsGeo.features as any[]).map((f) => f.geometry.coordinates);
    const orderPoints = (ordersGeo.features as any[]).map((f) => ({
      coords: f.geometry.coordinates as [number, number],
      id: f.properties?.id,
      status: String(f.properties?.status || "").toLowerCase(),
    }));
    const hailPoints = (hailGeo.features as any[]).map((f) => ({
      coords: f.geometry.coordinates as [number, number],
      id: f.properties?.id,
      severity: f.properties?.severity,
    }));

    // 1. Base / Hub ➔ Orders (dispatch & coverage flight paths)
    orderPoints.forEach((ord, idx) => {
      if (teamPoints.length === 0) return;
      let nearestBase = teamPoints[0];
      let minDist = Infinity;
      teamPoints.forEach((b) => {
        const d = Math.hypot(b[0] - ord.coords[0], b[1] - ord.coords[1]);
        if (d < minDist) { minDist = d; nearestBase = b; }
      });

      // Regional link limit ~800km
      if (minDist <= 10) {
        const isOp =
          ord.status.includes("progress") ||
          ord.status.includes("andamento") ||
          ord.status.includes("executando");
        const arc = createCurvedArc(nearestBase, ord.coords, 20);
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: arc },
          properties: {
            id: `arc-order-${idx}`,
            color: isOp ? "#10b981" : "#38bdf8",
            width: isOp ? 2.2 : 1.5,
            opacity: isOp ? 0.85 : 0.65,
            type: isOp ? "operation" : "service",
          },
        });
      }
    });

    // 2. Base / Hub ➔ Storm Threat Vectors (tactical interception arcs)
    hailPoints.forEach((hail, hIdx) => {
      if (teamPoints.length === 0) return;
      let nearestBase = teamPoints[0];
      let minDist = Infinity;
      teamPoints.forEach((b) => {
        const d = Math.hypot(b[0] - hail.coords[0], b[1] - hail.coords[1]);
        if (d < minDist) { minDist = d; nearestBase = b; }
      });

      if (minDist <= 12) {
        const arc = createCurvedArc(nearestBase, hail.coords, 24);
        const color =
          hail.severity === "extreme" ? "#ec4899" :
          hail.severity === "severe" ? "#f97316" : "#eab308";
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: arc },
          properties: {
            id: `arc-hail-${hIdx}`,
            color,
            width: 2,
            opacity: 0.75,
            type: "threat_vector",
          },
        });
      }
    });

    // 3. Inter-Base Command Backbone (mesh between branches)
    if (teamPoints.length > 1) {
      for (let i = 0; i < teamPoints.length - 1; i++) {
        for (let j = i + 1; j < teamPoints.length; j++) {
          const d = Math.hypot(teamPoints[i][0] - teamPoints[j][0], teamPoints[i][1] - teamPoints[j][1]);
          if (d <= 8) {
            const arc = createCurvedArc(teamPoints[i], teamPoints[j], 24);
            features.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: arc },
              properties: {
                id: `arc-backbone-${i}-${j}`,
                color: "#06b6d4",
                width: 1.8,
                opacity: 0.55,
                type: "backbone",
              },
            });
          }
        }
      }
    }

    return { type: "FeatureCollection", features };
  }, [teamsGeo, ordersGeo, hailGeo]);

  /* -------- Init map ------------------------------------------------ */
  useEffect(() => {
    if (!containerEl || mapRef.current) return;
    layersMountedRef.current = false;

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
      if (/zoom|tile|404|aborted|Failed to fetch|NetworkError/i.test(msg)) {
        return; // expected, ignore
      }
      if (!layersMountedRef.current) {
        setMapReady(false);
        setMapError(msg || "Falha inesperada no mapa operacional.");
      }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    function mountLayers() {
      if (!map || layersMountedRef.current) return;
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

        // 1. Cluster outer diffuse glow
        map.addLayer({
          id: `${id}-cluster-glow`,
          type: "circle",
          source: id,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": color,
            "circle-opacity": 0.18,
            "circle-blur": 0.8,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              26, 10, 34, 50, 44,
            ],
          },
        });

        // 2. Cluster main hub
        map.addLayer({
          id: `${id}-clusters`,
          type: "circle",
          source: id,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": color,
            "circle-opacity": 0.35,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              16, 10, 22, 50, 30,
            ],
          },
        });

        // 3. Cluster count symbol
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

        // 4. Point: Outer Sonar Radar Ripple (Ring 3)
        map.addLayer({
          id: `${id}-radar-outer`,
          type: "circle",
          source: id,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "transparent",
            "circle-radius": 18,
            "circle-stroke-color": color,
            "circle-stroke-width": 1,
            "circle-stroke-opacity": 0.35,
          },
        });

        // 5. Point: Mid Concentric Ripple (Ring 2)
        map.addLayer({
          id: `${id}-radar-mid`,
          type: "circle",
          source: id,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "transparent",
            "circle-radius": 11,
            "circle-stroke-color": color,
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.65,
          },
        });

        // 6. Point: Atmospheric Glow Halo
        map.addLayer({
          id: `${id}-glow`,
          type: "circle",
          source: id,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": color,
            "circle-radius": 24,
            "circle-opacity": 0.22,
            "circle-blur": 1.2,
          },
        });

        // 7. Point: Concentric Core Dot (White-hot nucleus)
        map.addLayer({
          id: `${id}-points`,
          type: "circle",
          source: id,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 4.5,
            "circle-stroke-color": color,
            "circle-stroke-width": 3,
            "circle-opacity": 1,
          },
        });
      };

      addClusterLayer("orders", "#a855f7");
      addClusterLayer("teams", "#22d3ee");
      addClusterLayer("operations", "#10b981");

      /* ---- Network telemetry arcs (interconnected command grid) ---- */
      map.addSource("network", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as any,
      });

      // Glowing outer blur line (neon atmospheric glow)
      map.addLayer({
        id: "network-lines-glow",
        type: "line",
        source: "network",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["*", ["get", "width"], 2.8],
          "line-opacity": ["*", ["get", "opacity"], 0.45],
          "line-blur": 3,
        },
      });

      // Crisp inner laser core line (high visibility flight arc)
      map.addLayer({
        id: "network-lines-core",
        type: "line",
        source: "network",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
        },
      });

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
        let html = "";
        if (sourceId === "teams") {
          html = `
            <div style="min-width:180px; font-family:system-ui,sans-serif; color:#e2e8f0;">
              <div style="display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#22d3ee; margin-bottom:4px;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#22d3ee;"></span>
                Base Operacional
              </div>
              <div style="font-weight:700; font-size:13px; color:#fff; line-height:1.2;">${p.name || p.city}</div>
              ${p.address ? `<div style="font-size:10px; color:#94a3b8; margin-top:3px;">${p.address}</div>` : ""}
              ${p.manager ? `<div style="font-size:10px; color:#cbd5e1; margin-top:4px;"><strong>Responsável:</strong> ${p.manager}</div>` : ""}
              ${p.phone ? `<div style="font-size:10px; color:#94a3b8; margin-top:2px;">Tel: ${p.phone}</div>` : ""}
              <div style="margin-top:6px; font-size:9px; color:#64748b;">${p.when || "Ativo no workspace"}</div>
            </div>`;
        } else if (sourceId === "operations") {
          html = `
            <div style="min-width:190px; font-family:system-ui,sans-serif; color:#e2e8f0;">
              <div style="display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#f59e0b; margin-bottom:4px;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#f59e0b;"></span>
                Operação Ativa
              </div>
              <div style="font-weight:700; font-size:13px; color:#fff;">${p.car_name || p.plate || "Veículo"}</div>
              <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Placa: <strong style="color:#fff;">${p.plate || "—"}</strong></div>
              <div style="font-size:10px; color:#cbd5e1; margin-top:2px;">Cliente / Base: ${p.platform || p.city || "—"}</div>
              ${p.technician ? `<div style="font-size:10px; color:#cbd5e1; margin-top:2px;">Técnico: ${p.technician}</div>` : ""}
              <div style="margin-top:6px; display:inline-block; font-size:9px; font-weight:600; padding:2px 6px; border-radius:4px; background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3);">
                ${p.status || "Em andamento"}
              </div>
            </div>`;
        } else {
          html = `
            <div style="min-width:180px; font-family:system-ui,sans-serif; color:#e2e8f0;">
              <div style="display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#a855f7; margin-bottom:4px;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#a855f7;"></span>
                Ordem de Produção
              </div>
              <div style="font-weight:700; font-size:13px; color:#fff;">${p.car_name || p.plate || "Veículo"}</div>
              <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Placa: <strong style="color:#fff;">${p.plate || "—"}</strong></div>
              <div style="font-size:10px; color:#cbd5e1; margin-top:2px;">Cliente: ${p.platform || "—"}</div>
              ${p.city ? `<div style="font-size:10px; color:#94a3b8; margin-top:2px;">Local: ${p.city}</div>` : ""}
              <div style="margin-top:6px; display:inline-block; font-size:9px; font-weight:600; padding:2px 6px; border-radius:4px; background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3);">
                ${p.status || "Aberta"}
              </div>
            </div>`;
        }
        new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "260px" })
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
      if (fallbackReadyTimerRef.current) {
        window.clearTimeout(fallbackReadyTimerRef.current);
        fallbackReadyTimerRef.current = null;
      }
      layersMountedRef.current = true;
      setMapReady(true);
      setMapError(null);
      try { map.resize(); } catch {}
      } catch (e) {
        if (!layersMountedRef.current) {
          setMapReady(false);
          setMapError((e as Error)?.message || "Falha ao montar as camadas do mapa.");
        }
      }
    }

    if (map.isStyleLoaded()) {
      mountLayers();
    } else {
      map.on("load", mountLayers);
      map.once("styledata", mountLayers);
    }

    // Timeout de segurança
    const fallbackReadyTimer = window.setTimeout(() => {
      if (!layersMountedRef.current && !map.isStyleLoaded() && !map.loaded()) {
        setMapReady(false);
        setMapError("Tempo limite excedido ao inicializar o mapa. Verifique WebGL e a conexão.");
      }
    }, 15_000);
    fallbackReadyTimerRef.current = fallbackReadyTimer;

    mapRef.current = map;

    const radarTimer = radarTimerRef.current;
    const initTimer = initTimerRef.current;
    const radarStaggerTimer = radarStaggerTimerRef.current;

    return () => {
      if (fallbackReadyTimerRef.current) window.clearTimeout(fallbackReadyTimerRef.current);
      if (radarTimer) window.clearTimeout(radarTimer);
      if (initTimer) window.clearTimeout(initTimer);
      if (radarStaggerTimer) window.clearTimeout(radarStaggerTimer);
      try { canvas.removeEventListener("webglcontextlost", onCtxLost); } catch {}
      try { canvas.removeEventListener("webglcontextrestored", onCtxRestored); } catch {}
      try { map.remove(); } catch {}
      mapRef.current = null;
      layersMountedRef.current = false;
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
    safeSetData("network", networkGeo);
  }, [mapReady, ordersGeo, teamsGeo, operationsGeo, networkGeo, safeSetData]);

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
    () => (hailEvents ?? []).map((h: any) => ({
      id: h.id,
      city: h.city ?? h.region ?? "Região",
      region: h.region ?? null,
      country: h.country ?? "—",
      lat: Number(h.lat),
      lng: Number(h.lng),
      radius_km: Number(h.radius_km ?? h.radiusKm ?? 25),
      severity: (String(h.severity || "moderate").toLowerCase() as any),
      status: (String(h.status || "forecast").toLowerCase() as any),
      hail_size_mm: Number(h.hail_size_mm ?? h.hailSizeMm ?? 0),
      probability: Number(h.probability ?? 0.5),
    })),
    [hailEvents],
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
    try { (map.getSource("network") as GeoJSONSource | undefined)?.setData(networkGeo as any); } catch (e) { void e; }
    try { (map.getSource("hail") as GeoJSONSource | undefined)?.setData(hailGeo as any); } catch (e) { void e; }
    try { (map.getSource("hail-reports") as GeoJSONSource | undefined)?.setData(hailReportsGeo as any); } catch (e) { void e; }
    try { (map.getSource("pdr-heat") as GeoJSONSource | undefined)?.setData(pdrHeatGeo as any); } catch (e) { void e; }
  }, [ordersGeo, teamsGeo, operationsGeo, networkGeo, hailGeo, hailReportsGeo, pdrHeatGeo]);

  useEffect(() => {
    if (!mapReady || sourceRecoveryTick === 0) return;
    syncActiveSources();
    const map = mapRef.current;
    if (!map || !(map as any).style || gpuContextLostRef.current) return;
    const setVis = (id: string, vis: boolean) => {
      try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none"); } catch {}
    };
    (["orders", "teams", "operations"] as const).forEach((k) => {
      [
        `${k}-clusters`,
        `${k}-cluster-glow`,
        `${k}-cluster-count`,
        `${k}-points`,
        `${k}-glow`,
        `${k}-radar-mid`,
        `${k}-radar-outer`,
      ].forEach((id) => setVis(id, layersRef.current[k]));
    });
    ["hail-halo", "hail-ring", "hail-core", "hail-reports-glow", "hail-reports-core"].forEach((id) => setVis(id, layersRef.current.hail));
    ["pdr-heatmap", "pdr-points"].forEach((id) => setVis(id, layersRef.current.pdr));
    ["network-lines-glow", "network-lines-core"].forEach((id) => setVis(id, layersRef.current.network));
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

  /* -------- Dynamic auto-focus: fit map bounds to operational points -------- */
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!mapReady || !mapRef.current || fittedRef.current) return;
    const allPoints = [...(teamsGeo.features as any[]), ...(ordersGeo.features as any[])];
    if (allPoints.length === 0) return;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const p of allPoints) {
      const coords = p.geometry?.coordinates;
      if (!Array.isArray(coords)) continue;
      const [lng, lat] = coords;
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }

    if (minLng !== Infinity && maxLng !== -Infinity) {
      fittedRef.current = true;
      if (Math.abs(maxLng - minLng) < 0.05 && Math.abs(maxLat - minLat) < 0.05) {
        mapRef.current.flyTo({ center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2], zoom: 9, duration: 1000 });
      } else {
        mapRef.current.fitBounds(
          [[minLng - 0.08, minLat - 0.08], [maxLng + 0.08, maxLat + 0.08]],
          { padding: 50, maxZoom: 12, duration: 1000 }
        );
      }
    }
  }, [mapReady, teamsGeo, ordersGeo]);

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
                maxzoom: 7,
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
            const count =
              key === "teams" ? teamsGeo.features.length :
              key === "orders" ? ordersGeo.features.length :
              key === "operations" ? operationsGeo.features.length :
              key === "network" ? networkGeo.features.length :
              key === "hail" ? visibleHailEvents.length :
              key === "pdr" ? opportunities.length :
              null;

            return (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className="text-[10px] px-2 py-1 rounded-md border transition-all flex items-center gap-1.5 cursor-pointer"
                style={{
                  borderColor: active ? color : "hsl(220 12% 22%)",
                  background: active ? `${color}22` : "transparent",
                  color: active ? color : "hsl(var(--muted-foreground))",
                  boxShadow: active ? `0 0 8px ${color}55` : "none",
                }}
              >
                <Icon className="h-3 w-3" />
                <span>{label}</span>
                {count !== null && (
                  <span
                    className="text-[9px] px-1.5 py-0.2 rounded-full font-mono font-medium"
                    style={{
                      background: active ? `${color}33` : "rgba(255,255,255,0.06)",
                      color: active ? color : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {count}
                  </span>
                )}
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
                if (mapRef.current) {
                  try { mapRef.current.remove(); } catch {}
                  mapRef.current = null;
                }
                layersMountedRef.current = false;
                gpuContextLostRef.current = false;
                setMapError(null);
                setMapReady(false);
                setMapInitTick((n) => n + 1);
              }}
              className="mt-1 text-[11px] px-3 py-1 rounded-md border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 cursor-pointer"
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
          OpenFreeMap · {mapReady ? "online" : "init"} · hail:{hailEvents.length}
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
            totalMonitoredEvents={hailEvents.length}
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
