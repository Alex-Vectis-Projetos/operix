import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldAlert, Wrench, Trash2, Plus, CheckCircle2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export type VehicleViewType = "top" | "front" | "rear" | "left" | "right";

export interface DamagePointData {
  id?: string;
  view: VehicleViewType;
  coordX: number; // 0 a 100%
  coordY: number; // 0 a 100%
  carPartCode: string;
  damageType: string;
  dentCount?: number | null;
  contracted: boolean; // true = orçado/reparo contratado; false = dano pré-existente (Checklist de Entrada)
  estimatedAmount?: number | string | null;
  photoStoragePath?: string | null;
  notes?: string | null;
}

interface VehicleBlueprintProps {
  damagePoints: DamagePointData[];
  onChange?: (points: DamagePointData[]) => void;
  readOnly?: boolean;
  className?: string;
}

const CAR_PARTS: { code: string; label: string }[] = [
  { code: "hood", label: "Capô" },
  { code: "roof", label: "Teto" },
  { code: "trunk", label: "Porta-Malas / Traseira" },
  { code: "front_bumper", label: "Para-choque Dianteiro" },
  { code: "rear_bumper", label: "Para-choque Traseiro" },
  { code: "front_left_fender", label: "Para-lama Diant. Esq." },
  { code: "front_right_fender", label: "Para-lama Diant. Dir." },
  { code: "rear_left_quarter", label: "Lateral Traseira Esq." },
  { code: "rear_right_quarter", label: "Lateral Traseira Dir." },
  { code: "front_left_door", label: "Porta Diant. Esq." },
  { code: "front_right_door", label: "Porta Diant. Dir." },
  { code: "rear_left_door", label: "Porta Tras. Esq." },
  { code: "rear_right_door", label: "Porta Tras. Dir." },
  { code: "left_rail", label: "Coluna / Arco Esq." },
  { code: "right_rail", label: "Coluna / Arco Dir." },
  { code: "general", label: "Outro Componente" },
];

const DAMAGE_TYPES: { code: string; label: string }[] = [
  { code: "hail", label: "Granizo (PDR)" },
  { code: "dent_small", label: "Amassado Pequeno" },
  { code: "dent_medium", label: "Amassado Médio" },
  { code: "dent_large", label: "Amassado Grande" },
  { code: "crease", label: "Vinco" },
  { code: "scratch", label: "Arranhão / Risco" },
  { code: "paint_damage", label: "Dano de Pintura" },
  { code: "crack", label: "Trinca / Quebra" },
];

export function VehicleBlueprint5Views({
  damagePoints,
  onChange,
  readOnly = false,
  className,
}: VehicleBlueprintProps) {
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<VehicleViewType | "all">("all");

  const handleSvgClick = (view: VehicleViewType, e: React.MouseEvent<SVGSVGElement>) => {
    if (readOnly || !onChange) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);

    const newPoint: DamagePointData = {
      view,
      coordX: x,
      coordY: y,
      carPartCode: view === "top" ? (y < 35 ? "hood" : y < 70 ? "roof" : "trunk") : "general",
      damageType: "hail",
      dentCount: 1,
      contracted: true,
      estimatedAmount: 0,
      notes: "",
    };

    const nextPoints = [...damagePoints, newPoint];
    onChange(nextPoints);
    setSelectedPointIndex(nextPoints.length - 1);
  };

  const updateSelectedPoint = (patch: Partial<DamagePointData>) => {
    if (selectedPointIndex === null || !onChange) return;
    const nextPoints = [...damagePoints];
    nextPoints[selectedPointIndex] = { ...nextPoints[selectedPointIndex], ...patch };
    onChange(nextPoints);
  };

  const removeSelectedPoint = () => {
    if (selectedPointIndex === null || !onChange) return;
    const nextPoints = damagePoints.filter((_, idx) => idx !== selectedPointIndex);
    onChange(nextPoints);
    setSelectedPointIndex(null);
  };

  const selectedPoint = selectedPointIndex !== null ? damagePoints[selectedPointIndex] : null;

  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm", className)}>
      {/* Barra de Ferramentas / Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs font-semibold">
            <Eye className="h-3.5 w-3.5 text-primary" />
            Blueprint do Veículo (5 Vistas)
          </Badge>
          <span className="text-xs text-muted-foreground">
            {damagePoints.length} marcadores ({damagePoints.filter((p) => p.contracted).length} orçados,{" "}
            {damagePoints.filter((p) => !p.contracted).length} pré-existentes)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Filtrar Vista:</span>
          {(["all", "top", "front", "rear", "left", "right"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={activeView === v ? "default" : "outline"}
              className="h-7 px-2 text-xs capitalize"
              onClick={() => setActiveView(v)}
            >
              {v === "all" ? "Todas" : v === "top" ? "Superior" : v === "front" ? "Frente" : v === "rear" ? "Traseira" : v === "left" ? "Lat. Esq." : "Lat. Dir."}
            </Button>
          ))}
        </div>
      </div>

      {/* Legenda de Proteção Jurídica */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow">
            +
          </span>
          <span className="font-medium text-foreground">Intervenção Contratada (Orçado / Executar)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow">
            !
          </span>
          <span className="font-medium text-foreground">Dano Pré-existente (Checklist Entrada / Não Mexer)</span>
        </div>
        {!readOnly && (
          <span className="ml-auto text-[11px] italic text-muted-foreground">
            * Clique em qualquer área do diagrama para adicionar uma avaria.
          </span>
        )}
      </div>

      {/* Grid das Vistas Ortogonais */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        {/* Painel Central das Vistas */}
        <div className={cn("grid gap-4", selectedPoint ? "md:col-span-8" : "md:col-span-12")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* VISTA SUPERIOR (TOP) */}
            {(activeView === "all" || activeView === "top") && (
              <div className="relative flex flex-col items-center rounded-xl border bg-background/50 p-3 shadow-inner">
                <span className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Vista Superior (Teto / Capô)
                </span>
                <div className="relative h-64 w-36 cursor-crosshair">
                  <svg
                    viewBox="0 0 100 200"
                    className="h-full w-full stroke-foreground/70 fill-background"
                    onClick={(e) => handleSvgClick("top", e)}
                  >
                    {/* Silhueta Top-Down do Carro */}
                    <rect x="2" y="2" width="96" height="196" fill="transparent" stroke="none" />
                    {/* Contorno Geral */}
                    <path
                      d="M 25 10 C 35 5, 65 5, 75 10 C 85 20, 88 50, 88 90 C 88 150, 85 185, 75 195 C 65 198, 35 198, 25 195 C 15 185, 12 150, 12 90 C 12 50, 15 20, 25 10 Z"
                      strokeWidth="2.5"
                    />
                    {/* Capô */}
                    <path d="M 22 25 C 35 22, 65 22, 78 25 C 78 55, 22 55, 22 25" strokeWidth="1.5" strokeDasharray="2,2" />
                    {/* Para-brisa Dianteiro */}
                    <path d="M 20 60 C 35 55, 65 55, 80 60 C 76 75, 24 75, 20 60" strokeWidth="1.8" />
                    {/* Teto Solar / Painel Central */}
                    <rect x="25" y="80" width="50" height="55" rx="4" strokeWidth="1.8" />
                    {/* Vidro Traseiro */}
                    <path d="M 22 142 C 35 146, 65 146, 78 142 C 75 158, 25 158, 22 142" strokeWidth="1.8" />
                    {/* Porta-malas */}
                    <path d="M 25 165 C 35 163, 65 163, 75 165 C 75 185, 25 185, 25 165" strokeWidth="1.5" strokeDasharray="2,2" />
                    {/* Retrovisores */}
                    <path d="M 12 65 L 4 68 L 4 75 L 12 73 Z" strokeWidth="1.5" />
                    <path d="M 88 65 L 96 68 L 96 75 L 88 73 Z" strokeWidth="1.5" />

                    {/* Marcadores */}
                    {damagePoints
                      .map((pt, idx) => ({ pt, idx }))
                      .filter(({ pt }) => pt.view === "top")
                      .map(({ pt, idx }) => (
                        <g
                          key={idx}
                          transform={`translate(${pt.coordX}, ${pt.coordY})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPointIndex(idx);
                          }}
                          className="cursor-pointer transition-transform hover:scale-125"
                        >
                          <circle
                            r="6"
                            className={cn(
                              "stroke-white stroke-2 shadow-lg",
                              pt.contracted ? "fill-blue-600" : "fill-amber-500",
                              selectedPointIndex === idx && "ring-4 ring-primary"
                            )}
                          />
                          <text
                            textAnchor="middle"
                            dy="2.5"
                            className="fill-white text-[7px] font-black select-none pointer-events-none"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      ))}
                  </svg>
                </div>
              </div>
            )}

            {/* VISTA FRONTAL (FRONT) */}
            {(activeView === "all" || activeView === "front") && (
              <div className="relative flex flex-col items-center rounded-xl border bg-background/50 p-3 shadow-inner">
                <span className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Vista Frontal
                </span>
                <div className="relative h-44 w-52 cursor-crosshair">
                  <svg
                    viewBox="0 0 200 120"
                    className="h-full w-full stroke-foreground/70 fill-background"
                    onClick={(e) => handleSvgClick("front", e)}
                  >
                    <rect x="2" y="2" width="196" height="116" fill="transparent" stroke="none" />
                    {/* Cabine / Teto frontal */}
                    <path d="M 50 45 C 70 20, 130 20, 150 45 Z" strokeWidth="2" />
                    {/* Para-brisa */}
                    <path d="M 55 45 C 70 25, 130 25, 145 45 Z" strokeWidth="1.5" />
                    {/* Capô e Para-choque */}
                    <path d="M 25 50 C 35 48, 165 48, 175 50 C 185 60, 185 95, 175 105 C 160 110, 40 110, 25 105 C 15 95, 15 60, 25 50 Z" strokeWidth="2.5" />
                    {/* Grade Central */}
                    <rect x="75" y="65" width="50" height="30" rx="4" strokeWidth="1.5" strokeDasharray="3,2" />
                    {/* Faróis */}
                    <polygon points="35,55 65,58 60,70 30,68" strokeWidth="1.8" />
                    <polygon points="165,55 135,58 140,70 170,68" strokeWidth="1.8" />
                    {/* Rodas Frontais */}
                    <rect x="20" y="85" width="12" height="25" rx="2" strokeWidth="2" />
                    <rect x="168" y="85" width="12" height="25" rx="2" strokeWidth="2" />

                    {/* Marcadores */}
                    {damagePoints
                      .map((pt, idx) => ({ pt, idx }))
                      .filter(({ pt }) => pt.view === "front")
                      .map(({ pt, idx }) => (
                        <g
                          key={idx}
                          transform={`translate(${(pt.coordX / 100) * 200}, ${(pt.coordY / 100) * 120})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPointIndex(idx);
                          }}
                          className="cursor-pointer transition-transform hover:scale-125"
                        >
                          <circle
                            r="6"
                            className={cn(
                              "stroke-white stroke-2 shadow-lg",
                              pt.contracted ? "fill-blue-600" : "fill-amber-500",
                              selectedPointIndex === idx && "ring-4 ring-primary"
                            )}
                          />
                          <text
                            textAnchor="middle"
                            dy="2.5"
                            className="fill-white text-[7px] font-black select-none pointer-events-none"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      ))}
                  </svg>
                </div>
              </div>
            )}

            {/* VISTA TRASEIRA (REAR) */}
            {(activeView === "all" || activeView === "rear") && (
              <div className="relative flex flex-col items-center rounded-xl border bg-background/50 p-3 shadow-inner">
                <span className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Vista Traseira
                </span>
                <div className="relative h-44 w-52 cursor-crosshair">
                  <svg
                    viewBox="0 0 200 120"
                    className="h-full w-full stroke-foreground/70 fill-background"
                    onClick={(e) => handleSvgClick("rear", e)}
                  >
                    <rect x="2" y="2" width="196" height="116" fill="transparent" stroke="none" />
                    {/* Teto traseiro */}
                    <path d="M 50 45 C 70 20, 130 20, 150 45 Z" strokeWidth="2" />
                    {/* Vidro Traseiro */}
                    <path d="M 55 45 C 70 25, 130 25, 145 45 Z" strokeWidth="1.5" />
                    {/* Traseira e Para-choque */}
                    <path d="M 25 50 C 35 48, 165 48, 175 50 C 185 60, 185 95, 175 105 C 160 110, 40 110, 25 105 C 15 95, 15 60, 25 50 Z" strokeWidth="2.5" />
                    {/* Placa */}
                    <rect x="80" y="70" width="40" height="18" rx="2" strokeWidth="1.5" />
                    {/* Lanternas */}
                    <polygon points="30,55 60,56 58,68 32,68" strokeWidth="1.8" />
                    <polygon points="170,55 140,56 142,68 168,68" strokeWidth="1.8" />
                    {/* Escapamentos */}
                    <circle cx="50" cy="103" r="4" strokeWidth="1.5" />
                    <circle cx="150" cy="103" r="4" strokeWidth="1.5" />

                    {/* Marcadores */}
                    {damagePoints
                      .map((pt, idx) => ({ pt, idx }))
                      .filter(({ pt }) => pt.view === "rear")
                      .map(({ pt, idx }) => (
                        <g
                          key={idx}
                          transform={`translate(${(pt.coordX / 100) * 200}, ${(pt.coordY / 100) * 120})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPointIndex(idx);
                          }}
                          className="cursor-pointer transition-transform hover:scale-125"
                        >
                          <circle
                            r="6"
                            className={cn(
                              "stroke-white stroke-2 shadow-lg",
                              pt.contracted ? "fill-blue-600" : "fill-amber-500",
                              selectedPointIndex === idx && "ring-4 ring-primary"
                            )}
                          />
                          <text
                            textAnchor="middle"
                            dy="2.5"
                            className="fill-white text-[7px] font-black select-none pointer-events-none"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      ))}
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* VISTAS LATERAIS (LEFT & RIGHT) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* LATERAL ESQUERDA (LEFT) */}
            {(activeView === "all" || activeView === "left") && (
              <div className="relative flex flex-col items-center rounded-xl border bg-background/50 p-3 shadow-inner">
                <span className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Lateral Esquerda (Lado Motorista)
                </span>
                <div className="relative h-44 w-full cursor-crosshair">
                  <svg
                    viewBox="0 0 300 100"
                    className="h-full w-full stroke-foreground/70 fill-background"
                    onClick={(e) => handleSvgClick("left", e)}
                  >
                    <rect x="2" y="2" width="296" height="96" fill="transparent" stroke="none" />
                    {/* Perfil Sedan */}
                    <path
                      d="M 15 70 C 20 65, 30 55, 60 55 C 80 55, 95 30, 130 25 C 190 25, 215 30, 245 55 C 275 55, 285 62, 290 70 C 290 80, 275 82, 260 82 C 255 70, 235 70, 230 82 L 95 82 C 90 70, 70 70, 65 82 L 20 82 Z"
                      strokeWidth="2.2"
                    />
                    {/* Janelas / Vidros */}
                    <path d="M 105 32 L 150 32 L 150 52 L 95 52 Z" strokeWidth="1.5" />
                    <path d="M 155 32 L 205 32 L 225 52 L 155 52 Z" strokeWidth="1.5" />
                    {/* Linha das Portas */}
                    <line x1="152" y1="32" x2="152" y2="80" strokeWidth="1.5" />
                    <line x1="95" y1="52" x2="95" y2="80" strokeWidth="1.5" />
                    <line x1="225" y1="52" x2="225" y2="80" strokeWidth="1.5" />
                    {/* Rodas */}
                    <circle cx="78" cy="80" r="14" strokeWidth="2" />
                    <circle cx="242" cy="80" r="14" strokeWidth="2" />

                    {/* Marcadores */}
                    {damagePoints
                      .map((pt, idx) => ({ pt, idx }))
                      .filter(({ pt }) => pt.view === "left")
                      .map(({ pt, idx }) => (
                        <g
                          key={idx}
                          transform={`translate(${(pt.coordX / 100) * 300}, ${(pt.coordY / 100) * 100})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPointIndex(idx);
                          }}
                          className="cursor-pointer transition-transform hover:scale-125"
                        >
                          <circle
                            r="6"
                            className={cn(
                              "stroke-white stroke-2 shadow-lg",
                              pt.contracted ? "fill-blue-600" : "fill-amber-500",
                              selectedPointIndex === idx && "ring-4 ring-primary"
                            )}
                          />
                          <text
                            textAnchor="middle"
                            dy="2.5"
                            className="fill-white text-[7px] font-black select-none pointer-events-none"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      ))}
                  </svg>
                </div>
              </div>
            )}

            {/* LATERAL DIREITA (RIGHT) */}
            {(activeView === "all" || activeView === "right") && (
              <div className="relative flex flex-col items-center rounded-xl border bg-background/50 p-3 shadow-inner">
                <span className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Lateral Direita (Lado Passageiro)
                </span>
                <div className="relative h-44 w-full cursor-crosshair">
                  <svg
                    viewBox="0 0 300 100"
                    className="h-full w-full stroke-foreground/70 fill-background"
                    onClick={(e) => handleSvgClick("right", e)}
                  >
                    <rect x="2" y="2" width="296" height="96" fill="transparent" stroke="none" />
                    {/* Perfil Invertido */}
                    <g transform="translate(300, 0) scale(-1, 1)">
                      <path
                        d="M 15 70 C 20 65, 30 55, 60 55 C 80 55, 95 30, 130 25 C 190 25, 215 30, 245 55 C 275 55, 285 62, 290 70 C 290 80, 275 82, 260 82 C 255 70, 235 70, 230 82 L 95 82 C 90 70, 70 70, 65 82 L 20 82 Z"
                        strokeWidth="2.2"
                      />
                      <path d="M 105 32 L 150 32 L 150 52 L 95 52 Z" strokeWidth="1.5" />
                      <path d="M 155 32 L 205 32 L 225 52 L 155 52 Z" strokeWidth="1.5" />
                      <line x1="152" y1="32" x2="152" y2="80" strokeWidth="1.5" />
                      <line x1="95" y1="52" x2="95" y2="80" strokeWidth="1.5" />
                      <line x1="225" y1="52" x2="225" y2="80" strokeWidth="1.5" />
                      <circle cx="78" cy="80" r="14" strokeWidth="2" />
                      <circle cx="242" cy="80" r="14" strokeWidth="2" />
                    </g>

                    {/* Marcadores */}
                    {damagePoints
                      .map((pt, idx) => ({ pt, idx }))
                      .filter(({ pt }) => pt.view === "right")
                      .map(({ pt, idx }) => (
                        <g
                          key={idx}
                          transform={`translate(${(pt.coordX / 100) * 300}, ${(pt.coordY / 100) * 100})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPointIndex(idx);
                          }}
                          className="cursor-pointer transition-transform hover:scale-125"
                        >
                          <circle
                            r="6"
                            className={cn(
                              "stroke-white stroke-2 shadow-lg",
                              pt.contracted ? "fill-blue-600" : "fill-amber-500",
                              selectedPointIndex === idx && "ring-4 ring-primary"
                            )}
                          />
                          <text
                            textAnchor="middle"
                            dy="2.5"
                            className="fill-white text-[7px] font-black select-none pointer-events-none"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      ))}
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Painel de Edição do Ponto Selecionado */}
        {selectedPoint && (
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 shadow-sm md:col-span-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {selectedPointIndex! + 1}
                </span>
                <span className="text-sm font-semibold">Editar Avaria #{selectedPointIndex! + 1}</span>
              </div>
              {!readOnly && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={removeSelectedPoint}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Classificação: Orçado vs Pré-existente */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold">Classificação Operacional</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPoint.contracted ? "default" : "outline"}
                  className={cn("h-8 gap-1.5 text-xs", selectedPoint.contracted && "bg-blue-600 hover:bg-blue-700")}
                  disabled={readOnly}
                  onClick={() => updateSelectedPoint({ contracted: true })}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Orçado (PDR)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!selectedPoint.contracted ? "default" : "outline"}
                  className={cn("h-8 gap-1.5 text-xs", !selectedPoint.contracted && "bg-amber-500 hover:bg-amber-600 text-white")}
                  disabled={readOnly}
                  onClick={() => updateSelectedPoint({ contracted: false })}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Pré-existente
                </Button>
              </div>
              {!selectedPoint.contracted && (
                <p className="text-[11px] leading-tight text-amber-600 dark:text-amber-400">
                  Proteção Jurídica: Registrado no checklist de entrada; não será cobrado nem reparado.
                </p>
              )}
            </div>

            {/* Peça / Região do Carro */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Componente / Peça</Label>
              <Select
                value={selectedPoint.carPartCode}
                onValueChange={(val) => updateSelectedPoint({ carPartCode: val })}
                disabled={readOnly}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a peça" />
                </SelectTrigger>
                <SelectContent>
                  {CAR_PARTS.map((p) => (
                    <SelectItem key={p.code} value={p.code} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo de Dano */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Tipo de Intervenção / Avaria</Label>
              <Select
                value={selectedPoint.damageType}
                onValueChange={(val) => updateSelectedPoint({ damageType: val })}
                disabled={readOnly}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o dano" />
                </SelectTrigger>
                <SelectContent>
                  {DAMAGE_TYPES.map((d) => (
                    <SelectItem key={d.code} value={d.code} className="text-xs">
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantidade e Valor */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Qtd. Amassados</Label>
                <Input
                  type="number"
                  min="1"
                  value={selectedPoint.dentCount ?? 1}
                  onChange={(e) => updateSelectedPoint({ dentCount: Number(e.target.value) || 1 })}
                  className="h-8 text-xs"
                  disabled={readOnly}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Valor (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={selectedPoint.estimatedAmount ?? ""}
                  onChange={(e) => updateSelectedPoint({ estimatedAmount: e.target.value })}
                  placeholder="0.00"
                  className="h-8 text-xs"
                  disabled={readOnly || !selectedPoint.contracted}
                />
              </div>
            </div>

            {/* Observações */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Observações do Técnico</Label>
              <Input
                value={selectedPoint.notes ?? ""}
                onChange={(e) => updateSelectedPoint({ notes: e.target.value })}
                placeholder="Ex: vinco profundo, sem quebra de verniz"
                className="h-8 text-xs"
                disabled={readOnly}
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-8 text-xs"
              onClick={() => setSelectedPointIndex(null)}
            >
              Concluir Edição
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
