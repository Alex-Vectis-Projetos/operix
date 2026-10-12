import { useState, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CloudHail,
  Loader2,
  MapPin,
  Camera,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  UploadCloud,
  Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { uploadFile, getFileUrl } from "@/lib/storage";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { CITY_COORDS, guessCityFromText } from "./OperationalMap";

type Severity = "low" | "moderate" | "severe" | "extreme";

interface SeverityOption {
  key: Severity;
  label: string;
  range: string;
  color: string;
  borderClass: string;
  bgClass: string;
  activeClass: string;
}

const SEVERITY_OPTIONS: SeverityOption[] = [
  {
    key: "low",
    label: "Baixo",
    range: "< 15 mm",
    color: "#eab308",
    borderClass: "border-yellow-500/30",
    bgClass: "bg-yellow-500/10",
    activeClass: "border-yellow-400 bg-yellow-400/20 text-yellow-300 ring-1 ring-yellow-400/50",
  },
  {
    key: "moderate",
    label: "Moderado",
    range: "15–30 mm",
    color: "#f97316",
    borderClass: "border-orange-500/30",
    bgClass: "bg-orange-500/10",
    activeClass: "border-orange-400 bg-orange-400/20 text-orange-300 ring-1 ring-orange-400/50",
  },
  {
    key: "severe",
    label: "Severo",
    range: "30–50 mm",
    color: "#ef4444",
    borderClass: "border-red-500/30",
    bgClass: "bg-red-500/10",
    activeClass: "border-red-400 bg-red-400/20 text-red-300 ring-1 ring-red-400/50",
  },
  {
    key: "extreme",
    label: "Extremo",
    range: "> 50 mm",
    color: "#a855f7",
    borderClass: "border-purple-500/30",
    bgClass: "bg-purple-500/10",
    activeClass: "border-purple-400 bg-purple-400/20 text-purple-300 ring-1 ring-purple-400/50",
  },
];

const SIZE_PRESETS = [
  { mm: 10, label: "10mm", hint: "Moeda pequena" },
  { mm: 20, label: "20mm", hint: "Moeda 1€ / R$1" },
  { mm: 35, label: "35mm", hint: "Ping-pong" },
  { mm: 50, label: "50mm+", hint: "Golfe / Tênis" },
];

export function HailReportDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState("");
  const [size, setSize] = useState<string>("");
  const [severity, setSeverity] = useState<Severity>("moderate");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Manage image preview memory
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Dynamic confidence score calculation
  const confidenceScore = useMemo(() => {
    let score = 30; // base score for community report
    if (coords || (city.trim() && guessCityFromText(city.trim()))) score += 20;
    if (size && Number(size) > 0) score += 20;
    if (photo) score += 30;
    return Math.min(100, score);
  }, [coords, city, size, photo]);

  const handleSelectSizePreset = (mm: number) => {
    setSize(String(mm));
    // Automatically match recommended severity
    if (mm <= 15) setSeverity("low");
    else if (mm <= 30) setSeverity("moderate");
    else if (mm <= 50) setSeverity("severe");
    else setSeverity("extreme");
  };

  const fetchLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocalização indisponível", description: "O navegador não suporta GPS.", variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setLocating(false);

        // Attempt reverse geocoding to auto-fill city if empty
        if (!city) {
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`, {
              headers: { "Accept-Language": "pt,es,en" },
            });
            if (res.ok) {
              const data = await res.json();
              const detectedCity = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality;
              if (detectedCity) setCity(detectedCity);
            }
          } catch {
            // non-fatal
          }
        }
        toast({ title: "Posição capturada!", description: `Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}` });
      },
      (err) => {
        setLocating(false);
        const msg = err.code === 1 ? "Permissão de GPS negada pelo usuário." : "Tempo esgotado ao buscar sinal GPS.";
        toast({ title: "GPS indisponível", description: `${msg} Pode digitar a cidade no campo abaixo.`, variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const reset = () => {
    setCoords(null);
    setCity("");
    setSize("");
    setSeverity("moderate");
    setNotes("");
    setPhoto(null);
    setPhotoPreview(null);
    setLocating(false);
  };

  const submit = async () => {
    if (!user) return toast({ title: "Autenticação requerida", description: "Faça login para registrar uma ocorrência.", variant: "destructive" });

    // Resolve coordinates: either already captured from GPS, or derived from City
    let finalLat = coords?.lat ?? null;
    let finalLng = coords?.lng ?? null;

    if (finalLat == null || finalLng == null) {
      if (!city.trim()) {
        toast({
          title: "Localização necessária",
          description: "Use o botão 'Usar minha posição' ou informe o nome da Cidade/Região.",
          variant: "destructive",
        });
        return;
      }

      // Check fast local dictionary
      const matchedKey = guessCityFromText(city.trim());
      if (matchedKey && CITY_COORDS[matchedKey]) {
        finalLng = CITY_COORDS[matchedKey][0];
        finalLat = CITY_COORDS[matchedKey][1];
      } else {
        // Fallback to online geocoder
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city.trim())}&limit=1`);
          const geoData = await geoRes.json();
          if (Array.isArray(geoData) && geoData.length > 0) {
            finalLat = parseFloat(geoData[0].lat);
            finalLng = parseFloat(geoData[0].lon);
          }
        } catch {
          // fallback failed
        }
      }

      if (finalLat == null || finalLng == null) {
        toast({
          title: "Cidade não localizada",
          description: "Não foi possível determinar as coordenadas geográficas da cidade informada. Capture o GPS ou especifique melhor.",
          variant: "destructive",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      let photo_storage_path: string | null = null;
      let photo_url: string | null = null;

      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${user.id}/${Date.now()}.${ext}`;
        await uploadFile("hail-reports", path, photo, photo.type);
        photo_storage_path = path;
        photo_url = getFileUrl("hail-reports", path);
      }

      const normalizedConfidence = confidenceScore / 100;

      // Find nearest active hail event within 80km
      let attachedEventId: string | null = null;
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
        const data = await apiRequest<{ hailEvents: any[] }>(`/weather/hail-events?since=${since}&limit=200`);
        const candidates = data.hailEvents ?? [];
        if (candidates.length) {
          const R = 6371;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
            const dLat = toRad(b.lat - a.lat);
            const dLng = toRad(b.lng - a.lng);
            const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(x));
          };
          const ranked = candidates
            .map((c: any) => ({
              id: c.id as string,
              d: dist({ lat: finalLat!, lng: finalLng! }, { lat: Number(c.lat), lng: Number(c.lng) }),
              limit: Math.max(Number(c.radius_km) || 0, 80),
              activeWeight: c.status === "ongoing" ? 0 : c.status === "confirmed" ? 1 : c.status === "forecast" ? 2 : 3,
            }))
            .filter((c) => c.d <= c.limit)
            .sort((a, b) => a.activeWeight - b.activeWeight || a.d - b.d);
          attachedEventId = ranked[0]?.id ?? null;
        }
      } catch {
        // non-fatal
      }

      await apiRequest("/weather/hail-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hailEventId: attachedEventId,
          lat: finalLat,
          lng: finalLng,
          city: city.trim() || null,
          hailSizeMm: size ? Number(size) : null,
          severity,
          status: photo ? "confirmed" : "partial",
          confidenceScore: normalizedConfidence,
          notes: notes.trim() || null,
          photoStoragePath: photo_storage_path,
          photoUrl: photo_url,
        }),
      });

      queryClient.invalidateQueries({ queryKey: ["op-map-hail-reports"] });
      queryClient.invalidateQueries({ queryKey: ["op-map-hail"] });

      toast({
        title: "Relato de granizo registrado!",
        description: `Ocorrência inserida no mapa com ${confidenceScore}% de índice de confiança.`,
      });
      reset();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Falha ao enviar relato", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          className="text-[10px] flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:border-amber-400/60 shadow-sm transition font-medium cursor-pointer"
          title="Relatar ocorrência de granizo em campo"
        >
          <CloudHail className="h-3.5 w-3.5 text-amber-400" />
          <span>Relatar granizo</span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-lg bg-[#0b1322] border border-cyan-500/20 text-slate-100 shadow-2xl p-6 rounded-xl">
        <DialogHeader className="pb-3 border-b border-slate-800/80">
          <DialogTitle className="flex items-center gap-2.5 text-base font-semibold text-slate-50 tracking-tight">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <CloudHail className="h-5 w-5" />
            </div>
            <div>
              <div>Relatar Ocorrência de Granizo</div>
              <div className="text-[11px] font-normal text-slate-400 mt-0.5">
                Alimente a malha de inteligência climática do Operix em tempo real.
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-xs pt-2">
          {/* 1. Localização */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-cyan-400" /> Localização do Evento
              </Label>
              {coords ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                  <CheckCircle2 className="h-3 w-3" />
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </span>
              ) : (
                <span className="text-[10px] text-slate-400">GPS ou Cidade</span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fetchLocation}
                disabled={locating}
                className="h-9 text-xs border-cyan-500/30 hover:border-cyan-400 bg-cyan-950/20 hover:bg-cyan-900/30 text-cyan-200 justify-start"
              >
                {locating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin text-cyan-400" />
                    Obtendo GPS…
                  </>
                ) : (
                  <>
                    <MapPin className="h-3.5 w-3.5 mr-2 text-cyan-400" />
                    {coords ? "Atualizar GPS" : "Usar minha posição"}
                  </>
                )}
              </Button>

              <Input
                id="hr-city"
                placeholder="Ex: Lisboa, Madrid, Porto..."
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-9 text-xs bg-slate-950/60 border-slate-700/80 focus:border-cyan-400 placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* 2. Tamanho das pedras de granizo */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="hr-size" className="text-xs font-semibold text-slate-200">
                Tamanho Estimado (diâmetro)
              </Label>
              <span className="text-[10px] text-slate-400">Em milímetros (mm)</span>
            </div>

            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.mm}
                  type="button"
                  onClick={() => handleSelectSizePreset(preset.mm)}
                  className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-md border text-center transition cursor-pointer ${
                    size === String(preset.mm)
                      ? "border-amber-400 bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/50"
                      : "border-slate-800 bg-slate-900/50 hover:border-slate-700 text-slate-300 hover:text-slate-100"
                  }`}
                >
                  <span className="text-xs font-bold leading-none">{preset.label}</span>
                  <span className="text-[9px] text-slate-400 mt-0.5 leading-none">{preset.hint}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Input
                id="hr-size"
                type="number"
                inputMode="decimal"
                min={1}
                max={150}
                placeholder="Ou digite o valor exato (ex: 28)"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="h-8 text-xs bg-slate-950/60 border-slate-700/80 focus:border-amber-400 pr-10"
              />
              <span className="absolute right-3 top-2 text-[10px] text-slate-400 font-mono pointer-events-none">mm</span>
            </div>
          </div>

          {/* 3. Severidade do Fenômeno (Linha dedicada, sem corte horizontal) */}
          <div>
            <Label className="text-xs font-semibold text-slate-200 block mb-1.5">Grau de Severidade</Label>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITY_OPTIONS.map((s) => {
                const isSelected = severity === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSeverity(s.key)}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition cursor-pointer ${
                      isSelected
                        ? s.activeClass
                        : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-slate-100"
                    }`}
                  >
                    <span className="flex items-center gap-1 font-semibold text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{s.range}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Evidência Fotográfica (Drag & Drop / Preview) */}
          <div>
            <Label className="text-xs font-semibold text-slate-200 flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 text-cyan-400" /> Foto comprobatória (opcional)
              </span>
              <span className="text-[10px] text-cyan-400/90 font-medium">+30% confiabilidade</span>
            </Label>

            <input
              ref={fileInputRef}
              id="hr-photo"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />

            {!photo ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-slate-700 hover:border-cyan-500/60 bg-slate-900/40 hover:bg-cyan-950/10 rounded-lg p-3 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1 group"
              >
                <div className="p-2 rounded-full bg-slate-800/80 group-hover:bg-cyan-500/10 text-slate-400 group-hover:text-cyan-300 transition">
                  <UploadCloud className="h-4 w-4" />
                </div>
                <div className="text-xs text-slate-300 group-hover:text-cyan-200 font-medium">
                  Clique para anexar foto do granizo
                </div>
                <div className="text-[10px] text-slate-500">JPG, PNG ou WEBP até 10MB</div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20">
                <div className="flex items-center gap-3 overflow-hidden">
                  {photoPreview && (
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="w-10 h-10 rounded-md object-cover border border-cyan-500/30 flex-shrink-0"
                    />
                  )}
                  <div className="overflow-hidden">
                    <div className="text-xs font-medium text-slate-200 truncate">{photo.name}</div>
                    <div className="text-[10px] text-cyan-300/80 font-mono">
                      {(photo.size / (1024 * 1024)).toFixed(2)} MB · Evidência carregada
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setPhoto(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  title="Remover foto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* 5. Observações */}
          <div>
            <Label htmlFor="hr-notes" className="text-xs font-semibold text-slate-200 block mb-1">
              Observações operacionais
            </Label>
            <Textarea
              id="hr-notes"
              placeholder="Ex: Danos em telhados/veículos, rajadas de vento intensas, acúmulo de gelo..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-xs bg-slate-950/60 border-slate-700/80 focus:border-cyan-400 resize-none placeholder:text-slate-500"
            />
          </div>

          {/* 6. Indicador de Confiabilidade */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`h-4 w-4 ${
                  confidenceScore >= 80
                    ? "text-emerald-400"
                    : confidenceScore >= 50
                    ? "text-amber-400"
                    : "text-slate-400"
                }`}
              />
              <div>
                <div className="text-[11px] font-semibold text-slate-200">
                  Índice de Confiabilidade:{" "}
                  <span
                    className={
                      confidenceScore >= 80
                        ? "text-emerald-400"
                        : confidenceScore >= 50
                        ? "text-amber-400"
                        : "text-slate-300"
                    }
                  >
                    {confidenceScore}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {confidenceScore >= 80
                    ? "Alta precisão (foto + localização confirmada)"
                    : confidenceScore >= 50
                    ? "Moderada (adicione foto para validação automática)"
                    : "Preliminar"}
                </div>
              </div>
            </div>

            <div className="w-20 bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  confidenceScore >= 80
                    ? "bg-emerald-400"
                    : confidenceScore >= 50
                    ? "bg-amber-400"
                    : "bg-slate-500"
                }`}
                style={{ width: `${confidenceScore}%` }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t border-slate-800/80 flex items-center justify-between sm:justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={submitting || (!coords && !city.trim())}
            className="text-xs bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium shadow-md shadow-cyan-900/30 px-4"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Registrando…
              </>
            ) : (
              <>
                <CloudHail className="h-3.5 w-3.5 mr-1.5" />
                Enviar relato
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
