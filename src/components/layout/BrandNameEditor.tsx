import { useState, useEffect, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bold, Italic, Type, Sparkles, Upload, Image as ImageIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { buildBrandTextStyle } from "@/lib/brandStyles";
import { uploadFile, getFileUrl } from "@/lib/storage";
import { toast } from "sonner";

export type BrandGradient = {
  type: "linear" | "radial";
  from: string;
  to: string;
  angle?: number; // for linear
};

export interface BrandConfig {
  // Identity
  name?: string;

  // Typography
  fontFamily?: string;
  fontSize?: string;          // e.g. "16px"
  fontWeight?: number;        // 100..900 — wins over `bold`
  bold?: boolean;             // legacy
  italic?: boolean;
  letterSpacing?: number;     // em
  color?: string;             // text color (legacy single color also used as fallback)
  textGradient?: BrandGradient | null;
  textGlowColor?: string;
  textGlowIntensity?: number; // px (replaces glowIntensity for text)

  // Legacy / shared
  glowIntensity?: number;     // backward compat (treated as text glow if no textGlowIntensity)

  // Logo / Icon
  logoUrl?: string | null;
  logoSize?: "small" | "medium" | "large";
  logoSizeNum?: number;
  logoColor?: string;
  logoGradient?: BrandGradient | null;
  logoGlowColor?: string;
  logoGlowIntensity?: number;
  logoRadius?: number;        // 0..50 (percent)
  logoStyle?: "transparent" | "solid" | "glass";
}

const FONTS = [
  "Inter", "Space Grotesk", "JetBrains Mono", "Poppins", "Montserrat",
  "Raleway", "Outfit", "Sora", "Urbanist", "DM Sans",
  "Playfair Display", "Cormorant", "Bebas Neue", "Archivo Black",
  "Orbitron", "Rajdhani", "Exo 2", "Audiowide", "Michroma", "Oxanium",
];

const GRADIENT_PRESETS: { label: string; from: string; to: string }[] = [
  { label: "Blue → Purple",    from: "#3b82f6", to: "#a855f7" },
  { label: "Cyan → Blue",      from: "#06b6d4", to: "#2563eb" },
  { label: "Purple → Pink",    from: "#a855f7", to: "#ec4899" },
  { label: "Gold → Orange",    from: "#fbbf24", to: "#f97316" },
  { label: "Black → Gold",     from: "#0a0a0a", to: "#d4af37" },
  { label: "White → Silver",   from: "#ffffff", to: "#9ca3af" },
  { label: "Emerald → Cyan",   from: "#10b981", to: "#06b6d4" },
  { label: "Red → Crimson",    from: "#ef4444", to: "#7f1d1d" },
  { label: "Indigo → Electric",from: "#4f46e5", to: "#22d3ee" },
];

const GRADIENT_DIRECTIONS: { label: string; angle: number }[] = [
  { label: "→", angle: 90 },
  { label: "←", angle: 270 },
  { label: "↓", angle: 180 },
  { label: "↑", angle: 0 },
  { label: "↘", angle: 135 },
  { label: "↗", angle: 45 },
];

function GradientPicker({
  value,
  onChange,
}: {
  value: BrandGradient | null | undefined;
  onChange: (g: BrandGradient | null) => void;
}) {
  const active = value || null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">Gradiente</Label>
        {active && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange(null)}
          >
            limpar
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {GRADIENT_PRESETS.map((p) => {
          const isActive =
            active?.from === p.from && active?.to === p.to;
          return (
            <button
              type="button"
              key={p.label}
              onClick={() =>
                onChange({
                  type: "linear",
                  from: p.from,
                  to: p.to,
                  angle: active?.angle ?? 135,
                })
              }
              className={`h-8 rounded-md border transition-all ${
                isActive ? "border-primary scale-[1.03]" : "border-border/60 hover:border-border"
              }`}
              style={{
                background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
              }}
              title={p.label}
            />
          );
        })}
      </div>
      {active && (
        <>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground w-14">Tipo</Label>
            <div className="flex gap-1">
              {(["linear", "radial"] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => onChange({ ...active, type: t })}
                  className={`text-[10px] px-2 py-1 rounded border transition ${
                    active.type === t
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {active.type === "linear" && (
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] text-muted-foreground w-14">Direção</Label>
              <div className="flex gap-1">
                {GRADIENT_DIRECTIONS.map((d) => (
                  <button
                    type="button"
                    key={d.angle}
                    onClick={() => onChange({ ...active, angle: d.angle })}
                    className={`text-xs w-6 h-6 rounded border transition ${
                      (active.angle ?? 135) === d.angle
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">From</Label>
              <input
                type="color"
                value={active.from}
                onChange={(e) => onChange({ ...active, from: e.target.value })}
                className="h-7 w-full rounded border border-border cursor-pointer bg-transparent"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">To</Label>
              <input
                type="color"
                value={active.to}
                onChange={(e) => onChange({ ...active, to: e.target.value })}
                className="h-7 w-full rounded border border-border cursor-pointer bg-transparent"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function BrandNameEditor({
  config,
  defaultName = "",
  workspaceId,
  onSave,
  children,
}: {
  config: BrandConfig;
  defaultName?: string;
  workspaceId?: string;
  onSave: (c: BrandConfig) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BrandConfig>(() => ({
    ...config,
    name: config.name || defaultName || "",
  }));
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft({
        ...config,
        name: config.name || defaultName || "",
      });
    }
  }, [open, config, defaultName]);

  const handleSave = async () => {
    try {
      await onSave(draft);
      setOpen(false);
    } catch {
      // onSave handles toast errors
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione um arquivo de imagem válido (PNG, JPG, SVG, WebP).");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("O arquivo de imagem deve ter no máximo 2MB.");
      return;
    }

    try {
      setUploading(true);
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const uploadPath = `tenants/${workspaceId || "default"}/branding/${Date.now()}_${safeName}`;
      const { path, bucket } = await uploadFile("logos", uploadPath, file);
      const publicUrl = getFileUrl(bucket, path);
      setDraft((prev) => ({ ...prev, logoUrl: publicUrl }));
      toast.success("Logotipo carregado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error((err as Error).message || "Falha ao enviar logotipo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fontSize = parseInt(draft.fontSize || "16", 10);
  const fontWeight = draft.fontWeight ?? (draft.bold ? 700 : 600);
  const letterSpacing = draft.letterSpacing ?? -0.01;
  const textGlow = draft.textGlowIntensity ?? draft.glowIntensity ?? 0;
  const logoGlow = draft.logoGlowIntensity ?? 0;
  const logoSizeNum = draft.logoSizeNum ?? 32;
  const logoRadius = draft.logoRadius ?? 22;

  const previewTextStyle = buildBrandTextStyle(draft);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[360px] max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-xl border-border/60 shadow-2xl p-4 flex flex-col"
        side="right"
        align="start"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1 border-b border-border/40">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Personalizar marca
            </h4>
          </div>

          {/* Identity */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">Nome da Marca / Workspace</Label>
            <Input
              value={draft.name || ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 40) })}
              placeholder={defaultName || "Nome da sua empresa"}
              maxLength={40}
              className="h-8 text-sm bg-muted/30 border-border"
            />
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-border/60 bg-background/50 p-3 shadow-inner">
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Preview da Marca</Label>
              <span className="text-[9px] text-primary/90 font-mono">Ao vivo</span>
            </div>
            <div className="flex items-center gap-2.5 p-2 rounded-md bg-muted/20 border border-border/30">
              <BrandLogo
                size={logoSizeNum}
                logoUrlOverride={draft.logoUrl}
                radiusOverride={logoRadius}
                styleOverride={draft.logoStyle}
              />
              <div className="flex flex-col min-w-0">
                <span className="truncate" style={previewTextStyle}>
                  {draft.name || defaultName || "Operix"}
                </span>
                <span className="text-[9px] text-muted-foreground flex items-center gap-1 font-sans mt-0.5">
                  <Sparkles className="h-2.5 w-2.5 text-primary" /> Powered by Operix
                </span>
              </div>
            </div>
          </div>

          <Tabs defaultValue="type" className="w-full">
            <TabsList className="grid grid-cols-2 h-8">
              <TabsTrigger value="type" className="text-xs gap-1.5">
                <Type className="h-3 w-3" /> Tipografia
              </TabsTrigger>
              <TabsTrigger value="logo" className="text-xs gap-1.5">
                <ImageIcon className="h-3 w-3" /> Logotipo
              </TabsTrigger>
            </TabsList>

            {/* ============= TYPOGRAPHY ============= */}
            <TabsContent value="type" className="space-y-4 pt-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Fonte</Label>
                <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto rounded border border-border/60 p-1">
                  {FONTS.map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => setDraft({ ...draft, fontFamily: f })}
                      className={`text-[11px] px-2 py-1 rounded text-left transition-colors truncate ${
                        draft.fontFamily === f
                          ? "bg-primary/20 text-primary font-medium"
                          : "hover:bg-muted/50 text-muted-foreground"
                      }`}
                      style={{ fontFamily: f }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Peso: {fontWeight}</Label>
                <Slider
                  value={[fontWeight]}
                  onValueChange={([v]) => setDraft({ ...draft, fontWeight: v, bold: v >= 700 })}
                  min={100}
                  max={900}
                  step={100}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={draft.italic ? "default" : "outline"}
                  size="sm"
                  className="h-8 flex-1"
                  onClick={() => setDraft({ ...draft, italic: !draft.italic })}
                >
                  <Italic className="h-3.5 w-3.5 mr-1" /> Itálico
                </Button>
                <Button
                  type="button"
                  variant={(draft.fontWeight ?? (draft.bold ? 700 : 600)) >= 700 ? "default" : "outline"}
                  size="sm"
                  className="h-8 flex-1"
                  onClick={() => {
                    const isBold = (draft.fontWeight ?? (draft.bold ? 700 : 600)) >= 700;
                    setDraft({
                      ...draft,
                      bold: !isBold,
                      fontWeight: !isBold ? 700 : 500,
                    });
                  }}
                >
                  <Bold className="h-3.5 w-3.5 mr-1" /> Bold
                </Button>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Tamanho: {fontSize}px
                </Label>
                <Slider
                  value={[fontSize]}
                  onValueChange={([v]) => setDraft({ ...draft, fontSize: `${v}px` })}
                  min={12}
                  max={48}
                  step={1}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Letter spacing: {letterSpacing.toFixed(2)}em
                </Label>
                <Slider
                  value={[Math.round(letterSpacing * 100)]}
                  onValueChange={([v]) => setDraft({ ...draft, letterSpacing: v / 100 })}
                  min={-10}
                  max={30}
                  step={1}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Cor do texto</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="h-8 w-10 rounded border border-border cursor-pointer bg-transparent"
                  />
                  <Input
                    value={draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="h-8 text-xs flex-1 bg-muted/30 border-border font-mono"
                    maxLength={7}
                  />
                </div>
              </div>

              <GradientPicker
                value={draft.textGradient}
                onChange={(g) => setDraft({ ...draft, textGradient: g })}
              />

              <div className="space-y-1 pt-1 border-t border-border/40">
                <Label className="text-[11px] text-muted-foreground">
                  Glow do texto: {textGlow}px
                </Label>
                <Slider
                  value={[textGlow]}
                  onValueChange={([v]) =>
                    setDraft({ ...draft, textGlowIntensity: v, glowIntensity: v })
                  }
                  min={0}
                  max={40}
                  step={1}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-[10px] text-muted-foreground">Cor do Glow</Label>
                  <input
                    type="color"
                    value={draft.textGlowColor || draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, textGlowColor: e.target.value })}
                    className="h-7 w-10 rounded border border-border cursor-pointer bg-transparent"
                  />
                </div>
              </div>
            </TabsContent>

            {/* ============= LOGO ============= */}
            <TabsContent value="logo" className="space-y-4 pt-3">
              {/* Upload de Logotipo Personalizado */}
              <div className="space-y-2 p-3 rounded-lg border border-border/60 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium text-foreground">Logotipo da Empresa</Label>
                  {draft.logoUrl && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, logoUrl: null })}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      Remover logotipo
                    </button>
                  )}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 text-xs flex-1 gap-1.5"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {uploading ? "Enviando imagem..." : draft.logoUrl ? "Trocar imagem do logo" : "Carregar imagem do logo"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Formatos: PNG, JPG, WebP ou SVG (máx. 2MB).
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Tamanho: {logoSizeNum}px</Label>
                <Slider
                  value={[logoSizeNum]}
                  onValueChange={([v]) => setDraft({ ...draft, logoSizeNum: v })}
                  min={16}
                  max={80}
                  step={2}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Arredondamento das bordas: {logoRadius}%</Label>
                <Slider
                  value={[logoRadius]}
                  onValueChange={([v]) => setDraft({ ...draft, logoRadius: v })}
                  min={0}
                  max={50}
                  step={1}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Estilo do fundo</Label>
                <div className="flex gap-1">
                  {(["transparent", "solid", "glass"] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setDraft({ ...draft, logoStyle: s })}
                      className={`flex-1 text-[10px] px-2 py-1 rounded border transition ${
                        (draft.logoStyle || "transparent") === s
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-border/40">
                <Label className="text-[11px] text-muted-foreground">
                  Glow do logotipo: {logoGlow}px
                </Label>
                <Slider
                  value={[logoGlow]}
                  onValueChange={([v]) => setDraft({ ...draft, logoGlowIntensity: v })}
                  min={0}
                  max={40}
                  step={1}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-[10px] text-muted-foreground">Cor do Glow</Label>
                  <input
                    type="color"
                    value={draft.logoGlowColor || draft.color || "rgba(249, 115, 22, 0.35)"}
                    onChange={(e) => setDraft({ ...draft, logoGlowColor: e.target.value })}
                    className="h-7 w-10 rounded border border-border cursor-pointer bg-transparent"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Sticky footer with actions */}
          <div className="sticky bottom-0 bg-card/95 backdrop-blur-md pt-3 pb-1 border-t border-border/60 flex items-center justify-between mt-4 -mx-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-8 text-xs px-4 gap-1.5" onClick={handleSave}>
              <Sparkles className="h-3.5 w-3.5" /> Aplicar alterações
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
