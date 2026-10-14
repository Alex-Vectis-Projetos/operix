import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, ShieldAlert, Wrench, Trash2, Plus, CheckCircle2, Eye, Sun, Moon, Maximize2, ZoomIn, Car, AlertTriangle, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

export type VehicleViewType = "top" | "front" | "rear" | "left" | "right";
export type VehicleBodyType = "sedan" | "hatchback" | "suv" | "pickup";

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
  initialBodyType?: VehicleBodyType;
}

export const CAR_PARTS: { code: string; label: string; views: VehicleViewType[] }[] = [
  { code: "hood", label: "Capô", views: ["top", "front"] },
  { code: "roof", label: "Teto", views: ["top", "left", "right"] },
  { code: "trunk", label: "Tampa do Porta-Malas / Traseira", views: ["top", "rear"] },
  { code: "windshield", label: "Para-brisa Dianteiro", views: ["top", "front"] },
  { code: "rear_glass", label: "Vidro Traseiro", views: ["top", "rear"] },
  { code: "front_bumper", label: "Para-choque Dianteiro", views: ["front", "left", "right"] },
  { code: "rear_bumper", label: "Para-choque Traseiro", views: ["rear", "left", "right"] },
  { code: "front_grille", label: "Grade Dianteira", views: ["front"] },
  { code: "left_headlight", label: "Farol Dianteiro Esquerdo", views: ["front"] },
  { code: "right_headlight", label: "Farol Dianteiro Direito", views: ["front"] },
  { code: "left_taillight", label: "Lanterna Traseira Esquerda", views: ["rear"] },
  { code: "right_taillight", label: "Lanterna Traseira Direita", views: ["rear"] },
  { code: "front_left_fender", label: "Para-lama Dianteiro Esquerdo", views: ["left", "top"] },
  { code: "front_right_fender", label: "Para-lama Dianteiro Direito", views: ["right", "top"] },
  { code: "front_left_door", label: "Porta Dianteira Esquerda", views: ["left"] },
  { code: "front_right_door", label: "Porta Dianteira Direita", views: ["right"] },
  { code: "rear_left_door", label: "Porta Traseira Esquerda", views: ["left"] },
  { code: "rear_right_door", label: "Porta Traseira Direita", views: ["right"] },
  { code: "rear_left_quarter", label: "Lateral / Para-lama Traseiro Esquerdo", views: ["left", "top"] },
  { code: "rear_right_quarter", label: "Lateral / Para-lama Traseiro Direito", views: ["right", "top"] },
  { code: "left_mirror", label: "Retrovisor Esquerdo", views: ["left", "front"] },
  { code: "right_mirror", label: "Retrovisor Direito", views: ["right", "front"] },
  { code: "left_rail", label: "Coluna / Arco Superior Esquerdo", views: ["left"] },
  { code: "right_rail", label: "Coluna / Arco Superior Direito", views: ["right"] },
  { code: "left_sill", label: "Soleira Esquerda", views: ["left"] },
  { code: "right_sill", label: "Soleira Direita", views: ["right"] },
  { code: "general", label: "Outro Componente Automotivo", views: ["top", "front", "rear", "left", "right"] },
];

export const DAMAGE_TYPES: { code: string; label: string }[] = [
  { code: "hail", label: "Granizo (PDR)" },
  { code: "dent_small", label: "Amassado Leve (< 3cm)" },
  { code: "dent_medium", label: "Amassado Médio (3cm - 8cm)" },
  { code: "dent_large", label: "Amassado Severo (> 8cm)" },
  { code: "crease", label: "Vinco" },
  { code: "scratch", label: "Risco / Arranhão" },
  { code: "paint_damage", label: "Dano de Pintura" },
  { code: "crack", label: "Trinca / Quebra" },
];

const BODY_TYPES: { code: VehicleBodyType; label: string }[] = [
  { code: "sedan", label: "Sedan" },
  { code: "hatchback", label: "Hatchback" },
  { code: "suv", label: "SUV" },
  { code: "pickup", label: "Picape" },
];

// Dimensões nativas exatas dos cortes (sem resíduos ou sobreposições)
const BLUEPRINT_DIMENSIONS: Record<VehicleBodyType, Record<VehicleViewType, { width: number; height: number }>> = {
  sedan: {
    front: { width: 345, height: 258 },
    rear: { width: 350, height: 258 },
    top: { width: 355, height: 850 },
    left: { width: 840, height: 306 },
    right: { width: 845, height: 252 },
  },
  hatchback: {
    front: { width: 215, height: 170 },
    rear: { width: 215, height: 168 },
    top: { width: 224, height: 430 },
    left: { width: 430, height: 168 },
    right: { width: 430, height: 170 },
  },
  suv: {
    front: { width: 175, height: 145 },
    rear: { width: 175, height: 145 },
    top: { width: 153, height: 360 },
    left: { width: 361, height: 162 },
    right: { width: 361, height: 162 },
  },
  pickup: {
    front: { width: 295, height: 265 },
    rear: { width: 290, height: 265 },
    top: { width: 300, height: 770 },
    left: { width: 770, height: 295 },
    right: { width: 770, height: 295 },
  },
};

// Mapeamento pericial de regiões por coordenadas percentuais (todas as vistas com topo alinhado)
function detectCarPart(view: VehicleViewType, x: number, y: number, facingLeft = false): string {
  if (view === "top") {
    // Orientação uniforme: Capô no topo (y < 35%), Teto no meio, Porta-malas na base
    if (y < 35) return x < 25 ? "front_left_fender" : x > 75 ? "front_right_fender" : "hood";
    if (y < 46) return "windshield";
    if (y < 74) return x < 20 ? "front_left_door" : x > 80 ? "front_right_door" : "roof";
    if (y < 84) return "rear_glass";
    return x < 25 ? "rear_left_quarter" : x > 75 ? "rear_right_quarter" : "trunk";
  }

  if (view === "front") {
    if (y > 68) return "front_bumper";
    if (y > 45 && y <= 68) {
      if (x < 28) return "left_headlight";
      if (x > 72) return "right_headlight";
      return "front_grille";
    }
    if (y > 25 && y <= 45) return "hood";
    return "windshield";
  }

  if (view === "rear") {
    if (y > 68) return "rear_bumper";
    if (y > 42 && y <= 68) {
      if (x < 28) return "left_taillight";
      if (x > 72) return "right_taillight";
      return "trunk";
    }
    return "rear_glass";
  }

  if (view === "left" || view === "right") {
    const isFrontSide = facingLeft ? x < 30 : x > 70;
    const isRearSide = facingLeft ? x > 70 : x < 30;
    const isMidFront = facingLeft ? x >= 30 && x < 52 : x >= 48 && x < 70;
    const isMidRear = facingLeft ? x >= 52 && x <= 70 : x >= 30 && x < 48;

    if (y < 32) return "roof";
    if (y > 78) return view === "left" ? "left_sill" : "right_sill";

    if (isFrontSide) return view === "left" ? "front_left_fender" : "front_right_fender";
    if (isRearSide) return view === "left" ? "rear_left_quarter" : "rear_right_quarter";
    if (isMidFront) return view === "left" ? "front_left_door" : "front_right_door";
    if (isMidRear) return view === "left" ? "rear_left_door" : "rear_right_door";
  }

  return "general";
}

export function VehicleBlueprint5Views({
  damagePoints,
  onChange,
  readOnly = false,
  className,
  initialBodyType = "sedan",
}: VehicleBlueprintProps) {
  const [bodyType, setBodyType] = useState<VehicleBodyType>(initialBodyType);
  const [activeView, setActiveView] = useState<VehicleViewType | "all">("all");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isCadTheme, setIsCadTheme] = useState<boolean>(true); // CAD Dark vs Ficha Clara
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);

  // Modal de confirmação para troca de carroceria com histórico preservado
  const [pendingBodyType, setPendingBodyType] = useState<VehicleBodyType | null>(null);
  const [showBodyTypeConfirm, setShowBodyTypeConfirm] = useState<boolean>(false);

  const handleSelectBodyType = (newType: VehicleBodyType) => {
    if (newType === bodyType) return;
    if (damagePoints.length > 0) {
      setPendingBodyType(newType);
      setShowBodyTypeConfirm(true);
    } else {
      setBodyType(newType);
    }
  };

  const confirmBodyTypeChange = () => {
    if (pendingBodyType) {
      setBodyType(pendingBodyType);
      setPendingBodyType(null);
    }
    setShowBodyTypeConfirm(false);
  };

  // Clique de alta precisão com matriz inversa SVG (independente de aspect ratio da tela)
  const handleSvgClick = (
    view: VehicleViewType,
    e: React.MouseEvent<SVGSVGElement>,
    viewW: number,
    viewH: number,
    facingLeft = false
  ) => {
    if (readOnly || !onChange) return;

    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(ctm.inverse());

    // Bounding clamp para garantir que permaneça na estampa da peça
    const clampedX = Math.max(0, Math.min(viewW, svgP.x));
    const clampedY = Math.max(0, Math.min(viewH, svgP.y));

    const coordX = Math.round((clampedX / viewW) * 100);
    const coordY = Math.round((clampedY / viewH) * 100);

    const detectedCode = detectCarPart(view, coordX, coordY, facingLeft);

    const newPoint: DamagePointData = {
      view,
      coordX,
      coordY,
      carPartCode: detectedCode,
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

  const handleSvgMouseMove = (
    view: VehicleViewType,
    e: React.MouseEvent<SVGSVGElement>,
    viewW: number,
    viewH: number,
    facingLeft = false
  ) => {
    if (readOnly) return;
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(ctm.inverse());

    const clampedX = Math.max(0, Math.min(viewW, svgP.x));
    const clampedY = Math.max(0, Math.min(viewH, svgP.y));

    const coordX = Math.round((clampedX / viewW) * 100);
    const coordY = Math.round((clampedY / viewH) * 100);

    const partCode = detectCarPart(view, coordX, coordY, facingLeft);
    const partObj = CAR_PARTS.find((p) => p.code === partCode);
    setHoveredPart(partObj ? partObj.label : null);
  };

  const handleSvgMouseLeave = () => {
    setHoveredPart(null);
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

  const getAssetPath = (viewName: string) => {
    const themePrefix = isCadTheme ? "cad" : "light";
    return `/blueprints/${bodyType}/${themePrefix}_${viewName}.png`;
  };

  // Renderiza uma vista técnica com dimensões fixas no viewBox, eliminando distorções de escala
  const renderTechnicalViewBox = (
    view: VehicleViewType,
    title: string,
    viewName: string,
    containerHeightClass: string,
    facingLeft = false
  ) => {
    const isFocus = activeView === view;
    const viewDims = BLUEPRINT_DIMENSIONS[bodyType]?.[view] || { width: 300, height: 200 };
    const viewPoints = damagePoints
      .map((p, idx) => ({ ...p, originalIndex: idx }))
      .filter((p) => p.view === view);

    // Raio proporcional compacto para precisão pericial (sem círculos gigantes)
    const baseRadius = Math.max(7, Math.min(viewDims.width, viewDims.height) * 0.032);

    return (
      <div
        className={cn(
          "relative flex flex-col rounded-lg border transition-all duration-200 overflow-hidden",
          isCadTheme
            ? "bg-[#090e1a] border-cyan-950/60 shadow-inner"
            : "bg-[#f8fafc] border-slate-200 shadow-sm",
          isFocus ? "ring-2 ring-cyan-500 shadow-[0_0_20px_rgba(56,189,248,0.25)]" : "hover:border-cyan-800/60"
        )}
      >
        {/* Cabeçalho da Vista */}
        <div
          className={cn(
            "flex items-center justify-between px-3 py-1.5 text-xs font-semibold border-b select-none",
            isCadTheme ? "bg-slate-900/80 border-slate-800 text-cyan-300" : "bg-slate-100 border-slate-200 text-slate-800"
          )}
        >
          <div className="flex items-center gap-2">
            <span>{title}</span>
            {viewPoints.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-cyan-900/60 text-cyan-200 border border-cyan-700/50">
                {viewPoints.length} {viewPoints.length === 1 ? "dano" : "danos"}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-cyan-400"
            title="Ampliar / Focar esta vista"
            onClick={() => setActiveView(activeView === view ? "all" : view)}
          >
            {activeView === view ? <Maximize2 className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Canvas da Vista */}
        <div
          className={cn(
            "relative w-full flex items-center justify-center p-2 select-none",
            containerHeightClass,
            isCadTheme
              ? "bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]"
              : "bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px]"
          )}
        >
          <svg
            viewBox={`0 0 ${viewDims.width} ${viewDims.height}`}
            className="w-full h-full cursor-crosshair select-none"
            onClick={(e) => handleSvgClick(view, e, viewDims.width, viewDims.height, facingLeft)}
            onMouseMove={(e) => handleSvgMouseMove(view, e, viewDims.width, viewDims.height, facingLeft)}
            onMouseLeave={handleSvgMouseLeave}
          >
            {/* Camada 1: Imagem Oficial CAD com traços periciais */}
            <image
              href={getAssetPath(viewName)}
              x="0"
              y="0"
              width={viewDims.width}
              height={viewDims.height}
              preserveAspectRatio="xMidYMid meet"
              style={{
                filter: isCadTheme ? "drop-shadow(0 0 1px rgba(56,189,248,0.35))" : undefined,
              }}
            />

            {/* Camada 3: Marcadores Periciais Compactos e Perfeitamente Circulares */}
            {viewPoints.map((pt) => {
              const isSelected = selectedPointIndex === pt.originalIndex;
              const markerX = (pt.coordX / 100) * viewDims.width;
              const markerY = (pt.coordY / 100) * viewDims.height;
              const r = baseRadius;

              return (
                <g
                  key={pt.id || pt.originalIndex}
                  transform={`translate(${markerX}, ${markerY})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPointIndex(pt.originalIndex);
                  }}
                >
                  {/* Anel indicador se selecionado */}
                  {isSelected && (
                    <circle
                      r={r * 1.5}
                      fill="none"
                      stroke={pt.contracted ? "#38bdf8" : "#fbbf24"}
                      strokeWidth="2"
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Sombra de contraste */}
                  <circle r={r + 1} fill="rgba(0,0,0,0.7)" />

                  {/* Ponto colorido */}
                  <circle
                    r={r}
                    fill={pt.contracted ? "#2563eb" : "#d97706"}
                    stroke={pt.contracted ? "#67e8f9" : "#fde68a"}
                    strokeWidth="1.5"
                  />

                  {/* Número identificador */}
                  <text
                    textAnchor="middle"
                    dy={r * 0.38}
                    fontSize={r * 1.05}
                    fontWeight="bold"
                    fill="#ffffff"
                    pointerEvents="none"
                  >
                    {pt.originalIndex + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm", className)}>
      {/* BARRA SUPERIOR DE CONTROLE PERICIAL */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        {/* Identificação e Contadores */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs font-semibold border-cyan-800 text-cyan-400 bg-cyan-950/30">
            <Eye className="h-3.5 w-3.5 text-cyan-400" />
            Blueprint de Inspeção (5 Vistas)
          </Badge>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{damagePoints.length}</span> marcadores
            <span className="text-slate-600">|</span>
            <span className="text-cyan-400 font-medium">{damagePoints.filter((p) => p.contracted).length} orçados</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400 font-medium">{damagePoints.filter((p) => !p.contracted).length} pré-existentes</span>
          </div>
        </div>

        {/* Controles de Carroceria, Vista e Tema */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Carroceria */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border">
            {BODY_TYPES.map((bt) => (
              <Button
                key={bt.code}
                size="sm"
                variant={bodyType === bt.code ? "default" : "ghost"}
                className={cn(
                  "h-7 px-2.5 text-xs font-medium",
                  bodyType === bt.code && "bg-cyan-600 text-white shadow-sm"
                )}
                onClick={() => handleSelectBodyType(bt.code)}
              >
                {bt.label}
              </Button>
            ))}
          </div>

          {/* Alternância CAD Dark vs Ficha Impressa */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs gap-1.5 border-slate-700"
            onClick={() => setIsCadTheme(!isCadTheme)}
            title={isCadTheme ? "Mudar para Ficha Técnica Clara" : "Mudar para CAD Blueprint Dark"}
          >
            {isCadTheme ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-cyan-400" />}
            <span className="hidden md:inline">{isCadTheme ? "Modo Impresso" : "CAD Dark"}</span>
          </Button>

          {/* Filtro / Navegação de Vistas */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border">
            {(["all", "top", "front", "rear", "left", "right"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={activeView === v ? "default" : "ghost"}
                className={cn(
                  "h-7 px-2 text-xs",
                  activeView === v && "bg-primary text-primary-foreground font-semibold"
                )}
                onClick={() => setActiveView(v)}
              >
                {v === "all" ? "Prancha Completa" : v === "top" ? "Superior" : v === "front" ? "Frente" : v === "rear" ? "Traseira" : v === "left" ? "Lat. Esq." : "Lat. Dir."}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* LEGENDA JURÍDICA & HUD DE PEÇA DETECTADA */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs border">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 border border-cyan-300 text-[9px] font-bold text-white shadow" />
            <span className="font-medium text-foreground">Serviço Contratado (Orçado / Executar)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-600 border border-amber-300 text-[9px] font-bold text-white shadow" />
            <span className="font-medium text-foreground">Dano Pré-existente (Checklist Entrada / Isenção)</span>
          </div>
        </div>

        {/* HUD de Peça Sob o Cursor */}
        {hoveredPart ? (
          <div className="flex items-center gap-1.5 font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
            <Car className="h-3 w-3" />
            <span>Peça sob mira: <strong>{hoveredPart}</strong></span>
          </div>
        ) : (
          <div className="text-muted-foreground text-[11px] italic">
            Clique na imagem para plotar um ponto de avaria com vinculação de peça.
          </div>
        )}
      </div>

      {/* ÁREA GRÁFICA DO BLUEPRINT: MODO PRANCHA GERAL OU MODO VISTA FOCAL */}
      {activeView === "all" ? (
        /* PRANCHA COMPLETA 5 VISTAS */
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Coluna Esquerda: Frente e Traseira */}
          <div className="md:col-span-4 flex flex-col gap-3">
            {renderTechnicalViewBox("front", "1. Vista Frontal", "front", "h-52 md:h-56", false)}
            {renderTechnicalViewBox("rear", "2. Vista Traseira", "rear", "h-52 md:h-56", false)}
          </div>

          {/* Coluna Central: Vista Superior Verticalizada */}
          <div className="md:col-span-4">
            {renderTechnicalViewBox("top", "3. Vista Superior (Capô, Teto, Tampa)", "top", "h-96 md:h-[464px]", false)}
          </div>

          {/* Coluna Direita: Laterais Esquerda e Direita */}
          <div className="md:col-span-4 flex flex-col gap-3">
            {renderTechnicalViewBox("left", "4. Lateral Esquerda (Motorista)", "left", "h-52 md:h-56", true)}
            {renderTechnicalViewBox("right", "5. Lateral Direita (Passageiro)", "right", "h-52 md:h-56", false)}
          </div>
        </div>
      ) : (
        /* MODO VISTA FOCAL AMPLIADA (ZOOM PERICIAL) */
        <div className="flex flex-col gap-2">
          {activeView === "front" && renderTechnicalViewBox("front", "Vista Frontal Ampliada", "front", "h-[450px]", false)}
          {activeView === "rear" && renderTechnicalViewBox("rear", "Vista Traseira Ampliada", "rear", "h-[450px]", false)}
          {activeView === "top" && renderTechnicalViewBox("top", "Vista Superior Ampliada", "top", "h-[500px]", false)}
          {activeView === "left" && renderTechnicalViewBox("left", "Lateral Esquerda Ampliada", "left", "h-[450px]", true)}
          {activeView === "right" && renderTechnicalViewBox("right", "Lateral Direita Ampliada", "right", "h-[450px]", false)}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setActiveView("all")} className="text-xs gap-1">
              <Eye className="h-3.5 w-3.5" /> Voltar para Prancha Completa (5 Vistas)
            </Button>
          </div>
        </div>
      )}

      {/* PAINEL DE INSPEÇÃO: DETALHES DO PONTO SELECIONADO */}
      {selectedPoint && !readOnly ? (
        <div className="rounded-xl border border-cyan-800/80 bg-slate-900/60 p-4 shadow-md backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white shadow",
                  selectedPoint.contracted ? "bg-blue-600" : "bg-amber-600"
                )}
              >
                {(selectedPointIndex ?? 0) + 1}
              </span>
              <span className="font-semibold text-sm text-foreground">
                Editar Ponto de Avaria #{ (selectedPointIndex ?? 0) + 1 }
              </span>
              <Badge variant="outline" className="capitalize text-xs font-mono">
                Vista: {selectedPoint.view} ({selectedPoint.coordX}%, {selectedPoint.coordY}%)
              </Badge>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2.5 text-xs gap-1"
              onClick={removeSelectedPoint}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover Ponto
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            {/* Peça Afetada */}
            <div className="space-y-1">
              <Label className="text-xs">Peça da Carroceria</Label>
              <Select
                value={selectedPoint.carPartCode}
                onValueChange={(val) => updateSelectedPoint({ carPartCode: val })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAR_PARTS.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo de Dano */}
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Dano / Avaria</Label>
              <Select
                value={selectedPoint.damageType}
                onValueChange={(val) => updateSelectedPoint({ damageType: val })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAMAGE_TYPES.map((dt) => (
                    <SelectItem key={dt.code} value={dt.code}>
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Qtd Mossas / Severidade */}
            <div className="space-y-1">
              <Label className="text-xs">Contagem de Mossas / Intensidade</Label>
              <Input
                type="number"
                min={1}
                max={500}
                className="h-8"
                value={selectedPoint.dentCount ?? 1}
                onChange={(e) => updateSelectedPoint({ dentCount: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* Classificação Jurídica: Contratado vs Pré-existente */}
            <div className="space-y-1">
              <Label className="text-xs">Enquadramento Pericial</Label>
              <Select
                value={selectedPoint.contracted ? "contracted" : "pre_existing"}
                onValueChange={(val) => updateSelectedPoint({ contracted: val === "contracted" })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contracted">Serviço Contratado (Orçado)</SelectItem>
                  <SelectItem value="pre_existing">Dano Pré-existente (Checklist Entrada)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Anotação Técnica */}
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">Parecer Técnico / Anotação da Avaria</Label>
              <Input
                className="h-8"
                placeholder="Ex.: Mossas concentradas na nervura central, sem quebra de verniz."
                value={selectedPoint.notes ?? ""}
                onChange={(e) => updateSelectedPoint({ notes: e.target.value })}
              />
            </div>

            {/* Registro de Foto */}
            <div className="space-y-1">
              <Label className="text-xs">Evidência Fotográfica</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="URL ou código da foto..."
                  value={selectedPoint.photoStoragePath ?? ""}
                  onChange={(e) => updateSelectedPoint({ photoStoragePath: e.target.value })}
                />
                <Button size="sm" variant="outline" className="h-8 px-2" title="Anexar Foto">
                  <Camera className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* TABELA / DOSSIÊ DOS PONTOS DE AVARIA CADASTRADOS */}
      {damagePoints.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between pb-2 mb-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dossiê de Danos Registrados ({damagePoints.length})
            </span>
            <span className="text-[11px] text-muted-foreground">
              Clique em um item para destacar e editar
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {damagePoints.map((pt, idx) => {
              const partName = CAR_PARTS.find((p) => p.code === pt.carPartCode)?.label || pt.carPartCode;
              const typeName = DAMAGE_TYPES.find((d) => d.code === pt.damageType)?.label || pt.damageType;
              const isSelected = selectedPointIndex === idx;

              return (
                <div
                  key={pt.id || idx}
                  onClick={() => setSelectedPointIndex(idx)}
                  className={cn(
                    "flex items-center justify-between gap-2 p-2 rounded border text-xs cursor-pointer transition-all",
                    isSelected
                      ? "bg-cyan-950/40 border-cyan-500 shadow-sm"
                      : "bg-background/80 hover:bg-muted border-slate-800/60"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white",
                        pt.contracted ? "bg-blue-600" : "bg-amber-600"
                      )}
                    >
                      {idx + 1}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate text-foreground">{partName}</span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        {typeName} {pt.dentCount && pt.dentCount > 1 ? `(${pt.dentCount} un.)` : ""}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px] px-1.5 py-0 h-4",
                      pt.contracted ? "border-blue-700 text-blue-400" : "border-amber-700 text-amber-400"
                    )}
                  >
                    {pt.contracted ? "Orçado" : "Checklist"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMAÇÃO PARA ALTERAÇÃO DE CARROCERIA */}
      <Dialog open={showBodyTypeConfirm} onOpenChange={setShowBodyTypeConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              Alterar Modelo de Carroceria?
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm">
              Este veículo já possui <strong>{damagePoints.length} marcadores de danos</strong> registrados.
              Ao alterar a carroceria para{" "}
              <strong>{BODY_TYPES.find((b) => b.code === pendingBodyType)?.label}</strong>, o histórico pericial e
              as peças nominais vinculadas serão preservados, mas as coordenadas gráficas anteriores podem necessitar
              de reposicionamento no novo diagrama.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowBodyTypeConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="default" size="sm" onClick={confirmBodyTypeChange}>
              Confirmar e Ajustar Modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
