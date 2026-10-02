import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bold, Italic, Type, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { buildBrandTextStyle, gradientToCss } from "@/lib/brandStyles";

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
  onSave,
  children,
}: {
  config: BrandConfig;
  onSave: (c: BrandConfig) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BrandConfig>(config);

  useEffect(() => {
    if (open) setDraft(config);
  }, [open, config]);

  const handleSave = () => {
    onSave(draft);
    setOpen(false);
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
        className="w-[340px] max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-xl border-border/60 shadow-2xl"
        side="right"
        align="start"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Personalizar marca
            </h4>
          </div>

          {/* Identity */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Nome</Label>
            <Input
              value={draft.name || ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 30) })}
              maxLength={30}
              className="h-8 text-sm bg-muted/30 border-border"
            />
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Preview</Label>
            <div className="flex items-center gap-2.5 mt-2 min-h-10">
              <BrandLogo size={logoSizeNum} />
              <span style={previewTextStyle}>
                {draft.name || "Operix"}
              </span>
            </div>
          </div>

          <Tabs defaultValue="type" className="w-full">
            <TabsList className="grid grid-cols-2 h-8">
              <TabsTrigger value="type" className="text-xs gap-1.5">
                <Type className="h-3 w-3" /> Tipografia
              </TabsTrigger>
              <TabsTrigger value="logo" className="text-xs gap-1.5">
                <Sparkles className="h-3 w-3" /> Logo
              </TabsTrigger>
            </TabsList>

            {/* ============= TYPOGRAPHY ============= */}
            <TabsContent value="type" className="space-y-4 pt-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Fonte</Label>
                <div className="grid grid-cols-2 gap-1 max-h-28 overflow-y-auto rounded border border-border/60 p-1">
                  {FONTS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setDraft({ ...draft, fontFamily: f })}
                      className={`text-[11px] px-2 py-1 rounded text-left transition-colors truncate ${
                        draft.fontFamily === f
                          ? "bg-primary/20 text-primary"
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
                  className="h-8"
                  onClick={() => setDraft({ ...draft, italic: !draft.italic })}
                >
                  <Italic className="h-3.5 w-3.5 mr-1" /> Itálico
                </Button>
                <Button
                  type="button"
                  variant={(draft.fontWeight ?? (draft.bold ? 700 : 600)) >= 700 ? "default" : "outline"}
                  size="sm"
                  className="h-8"
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
                  <Label className="text-[10px] text-muted-foreground">Cor</Label>
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
                <Label className="text-[11px] text-muted-foreground">Border radius: {logoRadius}%</Label>
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

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Cor do ícone</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.logoColor || draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, logoColor: e.target.value })}
                    className="h-8 w-10 rounded border border-border cursor-pointer bg-transparent"
                  />
                  <Input
                    value={draft.logoColor || draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, logoColor: e.target.value })}
                    className="h-8 text-xs flex-1 bg-muted/30 border-border font-mono"
                    maxLength={7}
                  />
                </div>
              </div>

              <GradientPicker
                value={draft.logoGradient}
                onChange={(g) => setDraft({ ...draft, logoGradient: g })}
              />

              <div className="space-y-1 pt-1 border-t border-border/40">
                <Label className="text-[11px] text-muted-foreground">
                  Glow do ícone: {logoGlow}px
                </Label>
                <Slider
                  value={[logoGlow]}
                  onValueChange={([v]) => setDraft({ ...draft, logoGlowIntensity: v })}
                  min={0}
                  max={40}
                  step={1}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-[10px] text-muted-foreground">Cor</Label>
                  <input
                    type="color"
                    value={draft.logoGlowColor || draft.logoColor || draft.color || "#e2dcc8"}
                    onChange={(e) => setDraft({ ...draft, logoGlowColor: e.target.value })}
                    className="h-7 w-10 rounded border border-border cursor-pointer bg-transparent"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
