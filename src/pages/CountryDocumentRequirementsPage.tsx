import { useMemo, useState } from "react";
import {
  FileCheck2, Plus, Loader2, Trash2, Globe, Sparkles, Check, Edit2, X,
  ShieldCheck, AlertCircle, HelpCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  useCountryDocumentRequirements, useConfiguredCountries, type CountryDocumentRequirement,
} from "@/hooks/useCountryDocumentRequirements";
import { COUNTRIES } from "@/lib/countries";

const TOP_COUNTRIES = [
  "Portugal",
  "Bélgica",
  "Espanha",
  "França",
  "Alemanha",
  "Itália",
  "Brasil",
  "Suíça",
  "Reino Unido",
  "Países Baixos",
];

export default function CountryDocumentRequirementsPage() {
  const { data: configuredCountries = [], isLoading: loadingCountries } = useConfiguredCountries();
  const [selectedCountry, setSelectedCountry] = useState<string>("Bélgica");
  const [newCountryModalOpen, setNewCountryModalOpen] = useState(false);
  const [customCountryInput, setCustomCountryInput] = useState("");
  
  // New document form state
  const [newDocumentName, setNewDocumentName] = useState("");
  const [newAppliesTo, setNewAppliesTo] = useState<"both" | "technician" | "provider_operational">("both");

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingAppliesTo, setEditingAppliesTo] = useState<"both" | "technician" | "provider_operational">("both");

  // Determine active country: preference given to selectedCountry or first configured
  const effectiveCountry = selectedCountry || (configuredCountries.length > 0 ? configuredCountries[0] : "Bélgica");

  const {
    requirements,
    isLoading: loadingRequirements,
    create,
    update,
    seedDefaults,
  } = useCountryDocumentRequirements(effectiveCountry, true);

  const activeRequirements = useMemo(
    () => requirements.filter((r) => r.active).sort((a, b) => a.sort_order - b.sort_order),
    [requirements],
  );

  async function handleAddDocument() {
    if (!effectiveCountry || !newDocumentName.trim()) return;
    await create.mutateAsync({
      country: effectiveCountry,
      document_name: newDocumentName.trim(),
      applies_to: newAppliesTo,
      sort_order: activeRequirements.length + 1,
    });
    setNewDocumentName("");
  }

  async function handleAddCustomCountry() {
    const trimmed = customCountryInput.trim();
    if (!trimmed) return;
    setSelectedCountry(trimmed);
    setCustomCountryInput("");
    setNewCountryModalOpen(false);
  }

  async function handleSeedDefaults() {
    if (!effectiveCountry) return;
    await seedDefaults.mutateAsync(effectiveCountry);
  }

  function startEdit(req: CountryDocumentRequirement) {
    setEditingId(req.id);
    setEditingName(req.document_name);
    setEditingAppliesTo(req.applies_to);
  }

  async function saveEdit(id: string) {
    if (!editingName.trim()) return;
    await update.mutateAsync({
      id,
      document_name: editingName.trim(),
      applies_to: editingAppliesTo,
    });
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  const appliesToLabel = (type: "both" | "technician" | "provider_operational") => {
    switch (type) {
      case "technician":
        return "Apenas Técnicos";
      case "provider_operational":
        return "Apenas Prestadores";
      default:
        return "Técnicos & Prestadores";
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <FileCheck2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Documentos por País</h1>
              <p className="text-sm text-muted-foreground">
                Configuração da matriz de conformidade documental para técnicos e prestadores de serviços.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs py-1 px-2.5">
            <Globe className="h-3.5 w-3.5 mr-1 text-primary" />
            {configuredCountries.length} país(es) configurado(s)
          </Badge>
        </div>
      </div>

      {/* Country Selector Toolbar */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold">País em Gestão:</span>
            </div>

            <div className="min-w-[240px] max-w-sm">
              <Select value={effectiveCountry} onValueChange={setSelectedCountry}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Selecione um país" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {configuredCountries.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Países Configurados</SelectLabel>
                      {configuredCountries.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  <SelectGroup>
                    <SelectLabel>Principais Países Operacionais</SelectLabel>
                    {TOP_COUNTRIES.filter((c) => !configuredCountries.includes(c)).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectGroup>

                  <SelectGroup>
                    <SelectLabel>Todos os Países (Código)</SelectLabel>
                    {COUNTRIES.filter((c) => !configuredCountries.includes(c.name) && !TOP_COUNTRIES.includes(c.name))
                      .slice(0, 30)
                      .map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Dialog open={newCountryModalOpen} onOpenChange={setNewCountryModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                <Plus className="h-4 w-4" />
                <span>Outro País</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar Novo País</DialogTitle>
                <DialogDescription>
                  Selecione da lista internacional ou digite o nome de um novo país para configurar suas exigências documentais.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Selecionar da lista ISO</label>
                  <Select onValueChange={(val) => { setSelectedCountry(val); setNewCountryModalOpen(false); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pesquisar país..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.name}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-border"></div>
                  <span className="flex-shrink mx-2 text-xs text-muted-foreground uppercase">ou digite</span>
                  <div className="flex-grow border-t border-border"></div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nome personalizado do país</label>
                  <Input
                    value={customCountryInput}
                    onChange={(e) => setCustomCountryInput(e.target.value)}
                    placeholder="Ex.: Bélgica, Luxemburgo..."
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewCountryModalOpen(false)}>Cancelar</Button>
                <Button onClick={handleAddCustomCountry} disabled={!customCountryInput.trim()}>
                  Confirmar País
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Main Requirements Card */}
      <Card className="border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>Exigências Documentais:</span>
              <span className="text-primary font-bold">{effectiveCountry}</span>
              <Badge variant="secondary" className="text-xs">
                {activeRequirements.length} documento(s)
              </Badge>
            </CardTitle>
            <CardDescription>
              Estes documentos serão exigidos para que os profissionais atuem conformes no país selecionado.
            </CardDescription>
          </div>

          {activeRequirements.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDefaults}
              disabled={seedDefaults.isPending}
              className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 shrink-0"
            >
              {seedDefaults.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>Carregar Modelo Padrão</span>
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {loadingRequirements ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-2" />
              <p className="text-sm">A carregar documentos de {effectiveCountry}...</p>
            </div>
          ) : activeRequirements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-dashed bg-muted/10 space-y-4">
              <div className="p-3 rounded-full bg-primary/10 text-primary">
                <AlertCircle className="h-8 w-8" />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="font-semibold text-base">Nenhum documento configurado para {effectiveCountry}</h3>
                <p className="text-sm text-muted-foreground">
                  Você pode inicializar rapidamente com os documentos regulatórios recomendados para este país ou cadastrar itens personalizados abaixo.
                </p>
              </div>
              <Button
                onClick={handleSeedDefaults}
                disabled={seedDefaults.isPending}
                className="gap-2"
              >
                {seedDefaults.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Carregar Documentos Recomendados para {effectiveCountry}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border divide-y">
                {activeRequirements.map((req, idx) => (
                  <div
                    key={req.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3 hover:bg-muted/30 transition-colors"
                  >
                    {editingId === req.id ? (
                      <div className="flex-1 flex flex-col sm:flex-row items-center gap-2">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1 text-sm h-8"
                          autoFocus
                        />
                        <Select
                          value={editingAppliesTo}
                          onValueChange={(val: any) => setEditingAppliesTo(val)}
                        >
                          <SelectTrigger className="h-8 w-[180px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">Técnicos & Prestadores</SelectItem>
                            <SelectItem value="technician">Apenas Técnicos</SelectItem>
                            <SelectItem value="provider_operational">Apenas Prestadores</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => saveEdit(req.id)}>
                            <Check className="h-4 w-4 text-emerald-500" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={cancelEdit}>
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-semibold text-muted-foreground shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-sm font-medium text-foreground truncate">
                            {req.document_name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant={req.applies_to === "both" ? "secondary" : "outline"}
                            className="text-[11px] font-normal"
                          >
                            {appliesToLabel(req.applies_to)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
                            Obrigatório
                          </Badge>

                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => startEdit(req)}
                            title="Editar nome"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => update.mutate({ id: req.id, active: false })}
                            title="Desativar requisito"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New Document Section */}
          <div className="rounded-xl border p-4 bg-muted/15 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Adicionar Novo Documento Exigido
              </h4>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome do Documento</label>
                <Input
                  value={newDocumentName}
                  onChange={(e) => setNewDocumentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddDocument();
                    }
                  }}
                  placeholder="Ex.: Certificado de Seguro de Responsabilidade Civil..."
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5 sm:w-56">
                <label className="text-xs font-medium text-muted-foreground">Aplica-se a</label>
                <Select
                  value={newAppliesTo}
                  onValueChange={(val: any) => setNewAppliesTo(val)}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Técnicos & Prestadores</SelectItem>
                    <SelectItem value="technician">Apenas Técnicos</SelectItem>
                    <SelectItem value="provider_operational">Apenas Prestadores</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleAddDocument}
                disabled={create.isPending || !newDocumentName.trim()}
                className="gap-2 sm:self-end"
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Adicionar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
