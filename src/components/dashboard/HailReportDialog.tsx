import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CloudHail, Loader2, MapPin, Camera } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { uploadFile, getFileUrl } from "@/lib/storage";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Severity = "low" | "moderate" | "severe" | "extreme";

const SEV: { key: Severity; label: string; color: string }[] = [
  { key: "low", label: "Baixo", color: "#eab308" },
  { key: "moderate", label: "Moderado", color: "#f97316" },
  { key: "severe", label: "Severo", color: "#ef4444" },
  { key: "extreme", label: "Extremo", color: "#a855f7" },
];

export function HailReportDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState("");
  const [size, setSize] = useState<string>("");
  const [severity, setSeverity] = useState<Severity>("moderate");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const fetchLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocalização indisponível", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast({ title: "Permissão negada", variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const reset = () => {
    setCoords(null); setCity(""); setSize(""); setSeverity("moderate");
    setNotes(""); setPhoto(null);
  };

  const submit = async () => {
    if (!user) return toast({ title: "Faça login para reportar" });
    if (!coords) return toast({ title: "Capture sua localização", variant: "destructive" });
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

      // Confidence: photo +0.3, has size +0.2, base 0.3
      const confidence = Math.min(1, 0.3 + (photo ? 0.3 : 0) + (size ? 0.2 : 0));

      // ---- Attach to nearest active hail_event (≤ 80km), if any -------
      let attachedEventId: string | null = null;
      try {
        const since = new Date(Date.now() - 7*24*3600_000).toISOString();
        const data = await apiRequest<{ hailEvents: any[] }>(`/weather/hail-events?since=${since}&limit=200`);
        const candidates = data.hailEvents ?? [];
        if (candidates.length) {
          const R = 6371;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dist = (a: {lat:number;lng:number}, b: {lat:number;lng:number}) => {
            const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
            const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
            return 2*R*Math.asin(Math.sqrt(x));
          };
          const ranked = candidates
            .map((c: any) => ({ id: c.id as string, d: dist(coords!, { lat: Number(c.lat), lng: Number(c.lng) }), limit: Math.max(Number(c.radius_km)||0, 80), activeWeight: c.status==="ongoing"?0:c.status==="confirmed"?1:c.status==="forecast"?2:3 }))
            .filter(c => c.d <= c.limit)
            .sort((a,b) => a.activeWeight-b.activeWeight || a.d-b.d);
          attachedEventId = ranked[0]?.id ?? null;
        }
      } catch {
        // non-fatal: report is still persisted standalone
      }

      await apiRequest("/weather/hail-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hailEventId: attachedEventId,
          lat: coords!.lat,
          lng: coords!.lng,
          city: city || null,
          hailSizeMm: size ? Number(size) : null,
          severity,
          status: photo ? "confirmed" : "partial",
          confidenceScore: confidence,
          notes: notes || null,
          photoStoragePath: photo_storage_path,
          photoUrl: photo_url,
        }),
      });

      queryClient.invalidateQueries({ queryKey: ["op-map-hail-reports"] });
      queryClient.invalidateQueries({ queryKey: ["op-map-hail"] });
      toast({ title: "Relato enviado", description: "Obrigado pela contribuição." });
      reset();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button
          className="text-[10px] flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-400/30 bg-amber-400/5 text-amber-200 hover:bg-amber-400/10 transition"
          title="Relatar ocorrência de granizo"
        >
          <CloudHail className="h-3 w-3" />
          Relatar granizo
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudHail className="h-4 w-4 text-amber-400" /> Relatar granizo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Localização</Label>
            <div className="flex gap-2 mt-1">
              <Button type="button" variant="outline" size="sm" onClick={fetchLocation} className="text-xs">
                <MapPin className="h-3 w-3 mr-1" /> Usar minha posição
              </Button>
              {coords && (
                <span className="text-[10px] text-muted-foreground self-center tabular-nums">
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </span>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="hr-city" className="text-xs">Cidade (opcional)</Label>
            <Input id="hr-city" value={city} onChange={(e) => setCity(e.target.value)} className="h-8 text-xs" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="hr-size" className="text-xs">Tamanho (mm)</Label>
              <Input id="hr-size" type="number" inputMode="decimal" value={size}
                onChange={(e) => setSize(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Severidade</Label>
              <div className="flex gap-1 mt-1">
                {SEV.map((s) => (
                  <button
                    key={s.key} type="button"
                    onClick={() => setSeverity(s.key)}
                    className="text-[10px] px-2 py-1 rounded border transition"
                    style={{
                      borderColor: severity === s.key ? s.color : "rgba(255,255,255,0.1)",
                      background: severity === s.key ? `${s.color}22` : "transparent",
                      color: severity === s.key ? s.color : undefined,
                    }}
                  >{s.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="hr-photo" className="text-xs flex items-center gap-1">
              <Camera className="h-3 w-3" /> Foto (opcional, aumenta confiabilidade)
            </Label>
            <Input id="hr-photo" type="file" accept="image/*" capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="h-8 text-xs file:text-xs" />
          </div>

          <div>
            <Label htmlFor="hr-notes" className="text-xs">Observações</Label>
            <Textarea id="hr-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2} className="text-xs" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || !coords}>
            {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Enviar relato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
