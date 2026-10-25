import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, Globe, Sparkles, ExternalLink, CheckCircle2 } from "lucide-react";
import { resolveMapUrl, type Location, type LocationInput } from "@/hooks/useLocations";
import { toast } from "@/hooks/use-toast";

const EMPTY_FORM: LocationInput = {
  name: "",
  address_street: "",
  address_number: "",
  address_neighborhood: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  address_country: "",
  phone: "",
  email: "",
  manager_name: "",
  manager_phone: "",
  manager_email: "",
  status: "active",
  maps_url: "",
  latitude: null,
  longitude: null,
};

interface LocationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Location | null;
  onSubmit: (input: LocationInput) => Promise<unknown>;
  saving: boolean;
}

export function LocationFormDialog({ open, onOpenChange, editing, onSubmit, saving }: LocationFormDialogProps) {
  const [form, setForm] = useState<LocationInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [mapsInputUrl, setMapsInputUrl] = useState("");
  const [resolvingMap, setResolvingMap] = useState(false);
  const [mapSuccessMessage, setMapSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name,
              address_street: editing.address_street,
              address_number: editing.address_number ?? "",
              address_neighborhood: editing.address_neighborhood ?? "",
              address_city: editing.address_city,
              address_state: editing.address_state ?? "",
              address_zip: editing.address_zip ?? "",
              address_country: editing.address_country,
              phone: editing.phone ?? "",
              email: editing.email ?? "",
              manager_name: editing.manager_name,
              manager_phone: editing.manager_phone ?? "",
              manager_email: editing.manager_email ?? "",
              status: editing.status,
              maps_url: editing.maps_url ?? "",
              latitude: editing.latitude ?? null,
              longitude: editing.longitude ?? null,
            }
          : EMPTY_FORM
      );
      setMapsInputUrl(editing?.maps_url ?? "");
      setMapSuccessMessage(null);
      setErrors([]);
    }
  }, [open, editing]);

  const set = (field: keyof LocationInput) => (value: any) => setForm((f) => ({ ...f, [field]: value }));

  async function handleResolveMapsUrl() {
    const raw = mapsInputUrl.trim();
    if (!raw) return;
    setResolvingMap(true);
    setMapSuccessMessage(null);
    try {
      const res = await resolveMapUrl(raw);
      if (res?.success) {
        setForm((prev) => ({
          ...prev,
          name: prev.name.trim() ? prev.name : (res.name_hint || prev.name),
          address_street: res.address.street || prev.address_street,
          address_number: res.address.number || prev.address_number,
          address_neighborhood: res.address.neighborhood || prev.address_neighborhood,
          address_city: res.address.city || prev.address_city,
          address_state: res.address.state || prev.address_state,
          address_zip: res.address.zip || prev.address_zip,
          address_country: res.address.country || prev.address_country,
          maps_url: res.resolved_url || raw,
          latitude: res.latitude,
          longitude: res.longitude,
        }));
        setMapsInputUrl(res.resolved_url || raw);
        setMapSuccessMessage(
          `Endereço identificado com sucesso (${res.latitude?.toFixed(5)}, ${res.longitude?.toFixed(5)})`
        );
        toast({
          title: "Endereço identificado pelo mapa!",
          description: "Os campos foram preenchidos automaticamente com as coordenadas da unidade.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Não foi possível identificar a URL",
        description: err?.message || "Verifique se a URL do Google Maps é válida.",
        variant: "destructive",
      });
    } finally {
      setResolvingMap(false);
    }
  }

  function validate(): boolean {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("Nome do local");
    if (!form.address_street.trim()) missing.push("Rua");
    if (!form.address_city.trim()) missing.push("Cidade");
    if (!form.address_country.trim()) missing.push("País");
    if (!form.manager_name.trim()) missing.push("Nome do gerente responsável");
    setErrors(missing);
    return missing.length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    await onSubmit({
      ...form,
      maps_url: mapsInputUrl.trim() || form.maps_url || null,
    });
    onOpenChange(false);
  }

  const lat = form.latitude;
  const lon = form.longitude;
  const hasCoordinates = lat != null && lon != null && !isNaN(lat) && !isNaN(lon);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Local" : "Novo Local"}</DialogTitle>
        </DialogHeader>

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Campos obrigatórios pendentes: {errors.join(", ")}.
          </div>
        )}

        {/* Bloco Dourado Estilizado: LOCALIZAÇÃO - URL DO GOOGLE MAPS */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 space-y-3 shadow-inner">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-500 uppercase tracking-wider">
            <Globe className="h-4 w-4 text-amber-400" />
            <span>Localização</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase font-medium text-amber-200/90 tracking-wide">
              URL do Google Maps (ou Waze / OpenStreetMap)
            </Label>
            <div className="flex gap-2">
              <Input
                value={mapsInputUrl}
                onChange={(e) => setMapsInputUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleResolveMapsUrl();
                  }
                }}
                placeholder="https://maps.google.com/..."
                className="h-10 text-xs font-mono bg-background/90 border-amber-500/30 focus-visible:ring-amber-500/50"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 px-4 border-amber-500/40 text-amber-300 hover:bg-amber-500/20 shrink-0 font-medium"
                onClick={handleResolveMapsUrl}
                disabled={resolvingMap || !mapsInputUrl.trim()}
              >
                {resolvingMap ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Identificando...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-400" /> Identificar
                  </>
                )}
              </Button>
            </div>
          </div>

          {mapSuccessMessage && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{mapSuccessMessage}</span>
            </div>
          )}

          {/* Mini Mapa Interativo Incorporado */}
          {hasCoordinates && (
            <div className="mt-3 rounded-lg overflow-hidden border border-border/70 bg-card shadow-sm space-y-2 p-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <span className="flex items-center gap-1 text-foreground font-medium">
                  <MapPin className="h-3.5 w-3.5 text-red-500" />
                  Mini Mapa da Unidade ({lat.toFixed(5)}, {lon.toFixed(5)})
                </span>
                <a
                  href={mapsInputUrl || `https://www.google.com/maps?q=${lat},${lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  Abrir no Google Maps <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="w-full h-44 rounded-md overflow-hidden border border-border/50 relative bg-muted/30">
                <iframe
                  title="Mini mapa do local"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  scrolling="no"
                  marginHeight={0}
                  marginWidth={0}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.005},${lat - 0.003},${lon + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lon}`}
                  className="w-full h-full pointer-events-auto"
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>Nome do local / unidade / filial *</Label>
            <Input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Filial Lyon" />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Rua *</Label>
            <Input value={form.address_street} onChange={(e) => set("address_street")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Número</Label>
            <Input value={form.address_number ?? ""} onChange={(e) => set("address_number")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bairro</Label>
            <Input value={form.address_neighborhood ?? ""} onChange={(e) => set("address_neighborhood")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Cidade *</Label>
            <Input value={form.address_city} onChange={(e) => set("address_city")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Estado / Província</Label>
            <Input value={form.address_state ?? ""} onChange={(e) => set("address_state")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>CEP</Label>
            <Input value={form.address_zip ?? ""} onChange={(e) => set("address_zip")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>País *</Label>
            <Input value={form.address_country} onChange={(e) => set("address_country")(e.target.value)} placeholder="França" />
          </div>

          <div className="col-span-2 flex items-center gap-2 p-2.5 rounded-lg border border-cyan-500/20 bg-cyan-950/20 text-xs text-cyan-300">
            <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Geocoding Automático via OpenStreetMap:</strong> Ao salvar, o sistema localiza a rua e o número no mapa para posicionamento de frota e rotas.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label>Telefone do local</Label>
            <Input value={form.phone ?? ""} onChange={(e) => set("phone")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail do local</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => set("email")(e.target.value)} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Gerente responsável — nome completo *</Label>
            <Input value={form.manager_name} onChange={(e) => set("manager_name")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Telefone do gerente</Label>
            <Input value={form.manager_phone ?? ""} onChange={(e) => set("manager_phone")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail do gerente</Label>
            <Input type="email" value={form.manager_email ?? ""} onChange={(e) => set("manager_email")(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status")(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Salvar" : "Criar Local"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
