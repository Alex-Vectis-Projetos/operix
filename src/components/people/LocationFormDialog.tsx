import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin } from "lucide-react";
import type { Location, LocationInput } from "@/hooks/useLocations";

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
            }
          : EMPTY_FORM
      );
      setErrors([]);
    }
  }, [open, editing]);

  const set = (field: keyof LocationInput) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

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
    await onSubmit(form);
    onOpenChange(false);
  }

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
