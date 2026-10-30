import React, { useState, useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Shield,
  ShieldAlert,
  Wrench,
  Trash2,
  Plus,
  CheckCircle2,
  CheckCheck,
  Eye,
  Sun,
  Moon,
  Maximize2,
  ZoomIn,
  Car,
  AlertTriangle,
  Camera,
  Layers,
  Sparkles,
  Calculator,
  Sliders,
  Check,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type VehicleViewType = "top" | "front" | "rear" | "left" | "right";
export type VehicleBodyType = "sedan" | "hatchback" | "suv" | "pickup" | "pickup_cs" | "pickup_cd" | "van" | "furgao" | "wagon";

export interface DamagePointData {
  id?: string;
  view: VehicleViewType;
  coordX: number; // 0 a 100%
  coordY: number; // 0 a 100%
  carPartCode: string;
  damageType: string;
  dentCount?: number | null;
  dentSize?: string | null; // "1" até "15"
  partMaterial?: string | null; // "steel" | "aluminum" | "plastic" | "carbon" | "other"
  pricingMode?: "fixed" | "unit" | "global"; // "fixed" = pacote fechado da peça, "unit" = por mossa, "global" = conjunto fechado
  validated?: boolean;
  contracted: boolean; // true = orçado/reparo contratado; false = dano pré-existente (Checklist de Entrada)
  estimatedAmount?: number | string | null;
  photoStoragePath?: string | null;
  notes?: string | null;
}

export interface ValidatedPartSummary {
  carPartCode: string;
  partLabel: string;
  damageType: string;
  dentCount: number;
  dentSize?: string | null;
  dentSizeLabel?: string;
  partMaterial?: string | null;
  materialTag?: string;
  materialLabel?: string;
  pricingMode: "fixed" | "unit" | "global";
  estimatedAmount?: number;
  notes?: string;
}

interface VehicleBlueprintProps {
  damagePoints: DamagePointData[];
  onChange?: (points: DamagePointData[]) => void;
  onValidatePart?: (summary: ValidatedPartSummary) => void;
  readOnly?: boolean;
  className?: string;
  initialBodyType?: VehicleBodyType;
  onBodyTypeChange?: (type: VehicleBodyType) => void;
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
  { code: "replace", label: "Substituição da Peça" },
  { code: "crack", label: "Trinca / Quebra" },
];

export interface PartMaterialOption {
  code: string;
  label: string;
  tag: string;
  badgeClass: string;
  markupPct?: number;
}

export const PART_MATERIALS: PartMaterialOption[] = [
  { code: "steel", label: "Aço (acier)", tag: "ACIER", badgeClass: "bg-slate-700/60 text-slate-200 border-slate-600" },
  { code: "aluminum", label: "Alumínio (ALU)", tag: "ALU", badgeClass: "bg-cyan-900/60 text-cyan-200 border-cyan-600", markupPct: 25 },
  { code: "plastic", label: "Plástico (plastique)", tag: "PLASTIQUE", badgeClass: "bg-emerald-900/60 text-emerald-200 border-emerald-600" },
  { code: "carbon", label: "Fibra de carbono / compósito (carbone)", tag: "CARBONE", badgeClass: "bg-purple-900/60 text-purple-200 border-purple-600" },
  { code: "other", label: "Outro material (autre)", tag: "AUTRE", badgeClass: "bg-amber-900/60 text-amber-200 border-amber-600" },
];

export const DENT_SIZES = [
  { code: "1", label: "Nível 1 (< 1cm / Moeda 10c)", shortLabel: "< 1cm" },
  { code: "2", label: "Nível 2 (1 - 2cm / Moeda 50c)", shortLabel: "1-2cm" },
  { code: "3", label: "Nível 3 (2 - 3cm / Moeda 2€)", shortLabel: "2-3cm" },
  { code: "4", label: "Nível 4 (3 - 4cm / Bola Ping-Pong)", shortLabel: "3-4cm" },
  { code: "5", label: "Nível 5 (4 - 5cm / Bola de Golfe)", shortLabel: "4-5cm" },
  { code: "6", label: "Nível 6 (5 - 6.5cm / Bola de Sinuca)", shortLabel: "5-6.5cm" },
  { code: "7", label: "Nível 7 (6.5 - 8cm / Bola de Tênis)", shortLabel: "6.5-8cm" },
  { code: "8", label: "Nível 8 (> 8cm / Dano Acentuado)", shortLabel: "> 8cm" },
  { code: "9", label: "Nível 9 (> 10cm / Deformação)", shortLabel: "> 10cm" },
  { code: "10", label: "Nível 10 (> 12cm / Dano Severo)", shortLabel: "> 12cm" },
  { code: "11", label: "Nível 11 (> 15cm / Estiramento)", shortLabel: "> 15cm" },
  { code: "12", label: "Nível 12 (> 20cm / Colisão Leve)", shortLabel: "> 20cm" },
  { code: "13", label: "Nível 13 (> 25cm / Colisão Média)", shortLabel: "> 25cm" },
  { code: "14", label: "Nível 14 (> 35cm / Colisão Grave)", shortLabel: "> 35cm" },
  { code: "15", label: "Nível 15 (> 50cm / Troca Recomendada)", shortLabel: "> 50cm" },
];

const BODY_TYPES: { code: VehicleBodyType; label: string }[] = [
  { code: "sedan", label: "Sedan" },
  { code: "hatchback", label: "Hatchback" },
  { code: "suv", label: "SUV" },
  { code: "pickup_cs", label: "Picape Cab. Simples" },
  { code: "pickup_cd", label: "Picape Cab. Dupla" },
  { code: "wagon", label: "Wagon / SW" },
  { code: "furgao", label: "Furgão" },
  { code: "van", label: "Van / Carrinha" },
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
  pickup_cs: {
    front: { width: 295, height: 265 },
    rear: { width: 290, height: 265 },
    top: { width: 300, height: 770 },
    left: { width: 770, height: 295 },
    right: { width: 770, height: 295 },
  },
  pickup_cd: {
    front: { width: 295, height: 265 },
    rear: { width: 290, height: 265 },
    top: { width: 300, height: 770 },
    left: { width: 770, height: 295 },
    right: { width: 770, height: 295 },
  },
  van: {
    front: { width: 188, height: 198 },
    rear: { width: 164, height: 197 },
    top: { width: 115, height: 268 },
    left: { width: 266, height: 113 },
    right: { width: 266, height: 113 },
  },
  wagon: {
    front: { width: 271, height: 218 },
    rear: { width: 267, height: 198 },
    top: { width: 270, height: 627 },
    left: { width: 618, height: 218 },
    right: { width: 618, height: 218 },
  },
  furgao: {
    front: { width: 224, height: 192 },
    rear: { width: 224, height: 191 },
    top: { width: 223, height: 420 },
    left: { width: 419, height: 192 },
    right: { width: 419, height: 192 },
  },
};

// Mapeamento pericial de regiões por coordenadas percentuais (todas as vistas com topo alinhado)
function detectCarPart(view: VehicleViewType, x: number, y: number, facingLeft = false, bodyType?: VehicleBodyType): string {
  if (view === "top") {
    // Vãs e Furgões possuem teto muito extenso e frente mais curta
    if (bodyType === "van" || bodyType === "furgao") {
      if (y < 20) return x < 25 ? "front_left_fender" : x > 75 ? "front_right_fender" : "hood";
      if (y < 30) return "windshield";
      if (y < 86) return x < 15 ? "front_left_door" : x > 85 ? "front_right_door" : "roof";
      if (y < 93) return "rear_glass";
      return x < 25 ? "rear_left_quarter" : x > 75 ? "rear_right_quarter" : "trunk";
    }
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
    // Região superior do perfil lateral pericialmente pertence ao Brancard / Coluna Lateral (left_rail / right_rail)
    if (y < 32) return view === "left" ? "left_rail" : "right_rail";
    if (y > 78) return view === "left" ? "left_sill" : "right_sill";

    // Picape Cabine Simples: Frente + Porta dianteira longa + Caçamba direta atrás
    if (bodyType === "pickup_cs") {
      const isFront = facingLeft ? x < 30 : x > 70;
      const isCabinDoor = facingLeft ? (x >= 30 && x < 58) : (x >= 42 && x < 70);
      const isBed = facingLeft ? x >= 58 : x < 42;
      if (isFront) return view === "left" ? "front_left_fender" : "front_right_fender";
      if (isCabinDoor) return view === "left" ? "front_left_door" : "front_right_door";
      if (isBed) return view === "left" ? "rear_left_quarter" : "rear_right_quarter";
    }

    const isFrontSide = facingLeft
      ? (bodyType === "van" || bodyType === "furgao" ? x < 22 : x < 30)
      : (bodyType === "van" || bodyType === "furgao" ? x > 78 : x > 70);
    const isRearSide = facingLeft
      ? (bodyType === "van" || bodyType === "furgao" ? x > 78 : x > 70)
      : (bodyType === "van" || bodyType === "furgao" ? x < 22 : x < 30);
    const isMidFront = facingLeft
      ? (bodyType === "van" || bodyType === "furgao" ? x >= 22 && x < 45 : x >= 30 && x < 52)
      : (bodyType === "van" || bodyType === "furgao" ? x >= 55 && x < 78 : x >= 48 && x < 70);
    const isMidRear = facingLeft
      ? (bodyType === "van" || bodyType === "furgao" ? x >= 45 && x <= 78 : x >= 52 && x <= 70)
      : (bodyType === "van" || bodyType === "furgao" ? x >= 22 && x < 55 : x >= 30 && x < 48);

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
  onValidatePart,
  readOnly = false,
  className,
  initialBodyType = "sedan",
  onBodyTypeChange,
}: VehicleBlueprintProps) {
  const [bodyType, setBodyType] = useState<VehicleBodyType>(initialBodyType);
  const [activeView, setActiveView] = useState<VehicleViewType | "all">("all");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isCadTheme, setIsCadTheme] = useState<boolean>(true); // CAD Dark vs Ficha Clara
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialBodyType && initialBodyType !== bodyType) {
      setBodyType(initialBodyType);
    }
  }, [initialBodyType, bodyType]);

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
      onBodyTypeChange?.(newType);
    }
  };

  const confirmBodyTypeChange = () => {
    if (pendingBodyType) {
      setBodyType(pendingBodyType);
      onBodyTypeChange?.(pendingBodyType);
      setPendingBodyType(null);
    }
    setShowBodyTypeConfirm(false);
  };

  // Clique de alta precisão com matriz inversa SVG
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

    // Bounding clamp para garantir permanência na estampa da peça
    const clampedX = Math.max(0, Math.min(viewW, svgP.x));
    const clampedY = Math.max(0, Math.min(viewH, svgP.y));

    const coordX = Math.round((clampedX / viewW) * 100);
    const coordY = Math.round((clampedY / viewH) * 100);

    const detectedCode = detectCarPart(view, coordX, coordY, facingLeft, bodyType);

    // Herda material já definido para essa mesma peça em outros pontos (Abordagem A: Por Peça)
    const existingPointForPart = damagePoints.find((p) => p.carPartCode === detectedCode && p.partMaterial);
    const inheritedMaterial = existingPointForPart?.partMaterial || "steel";

    const newPoint: DamagePointData = {
      view,
      coordX,
      coordY,
      carPartCode: detectedCode,
      damageType: "hail",
      dentCount: 1,
      dentSize: "2",
      partMaterial: inheritedMaterial,
      pricingMode: "fixed",
      validated: false,
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

    const partCode = detectCarPart(view, coordX, coordY, facingLeft, bodyType);
    const partObj = CAR_PARTS.find((p) => p.code === partCode);
    setHoveredPart(partObj ? partObj.label : null);
  };

  const handleSvgMouseLeave = () => {
    setHoveredPart(null);
  };

  const updateSelectedPoint = (patch: Partial<DamagePointData>) => {
    if (selectedPointIndex === null || !onChange) return;
    const current = damagePoints[selectedPointIndex];
    if (!current) return;

    let nextPoints = [...damagePoints];

    // Se o patch altera o material da peça, atualiza todos os pontos dessa mesma peça (Abordagem A: Por Peça)
    if (patch.partMaterial && patch.partMaterial !== current.partMaterial) {
      const targetPart = patch.carPartCode || current.carPartCode;
      nextPoints = nextPoints.map((p, idx) =>
        idx === selectedPointIndex || p.carPartCode === targetPart
          ? { ...p, partMaterial: patch.partMaterial }
          : p
      );
    } else {
      nextPoints[selectedPointIndex] = { ...current, ...patch };
    }

    onChange(nextPoints);
  };

  const removeSelectedPoint = () => {
    if (selectedPointIndex === null || !onChange) return;
    const nextPoints = damagePoints.filter((_, idx) => idx !== selectedPointIndex);
    onChange(nextPoints);
    setSelectedPointIndex(null);
  };

  const removePiece = (carPartCode: string) => {
    if (readOnly || !onChange) return;
    const nextPoints = damagePoints.filter((p) => p.carPartCode !== carPartCode);
    onChange(nextPoints);
    setSelectedPointIndex(null);
  };

  const selectedPoint = selectedPointIndex !== null ? damagePoints[selectedPointIndex] : null;

  // Multiplicador rápido de mossas (ex: para peças divididas em setores como teto)
  const applyMultiplier = (mult: number) => {
    if (!selectedPoint || !onChange) return;
    const base = Number(selectedPoint.dentCount) || 1;
    const nextCount = Math.max(1, Math.round(base * mult));
    updateSelectedPoint({ dentCount: nextCount });
  };

  // Validação da peça e despacho para sincronização com Serviços do orçamento
  const handleValidatePiece = (partCode?: string) => {
    if (!onChange) return;
    const targetCode = partCode || selectedPoint?.carPartCode;
    if (!targetCode) return;

    const partPoints = damagePoints.filter((p) => p.carPartCode === targetCode);
    if (partPoints.length === 0) return;

    const totalCount = partPoints.reduce((acc, p) => acc + (Number(p.dentCount) || 1), 0);
    const referencePoint = partPoints[0];
    const matCode = referencePoint.partMaterial || "steel";
    const matObj = PART_MATERIALS.find((m) => m.code === matCode) || PART_MATERIALS[0];
    const partObj = CAR_PARTS.find((p) => p.code === targetCode);
    const partLabel = partObj?.label || targetCode;
    const sizeObj = DENT_SIZES.find((s) => s.code === referencePoint.dentSize);

    const partPricingMode = referencePoint.pricingMode || "fixed";
    const finalAmount = partPricingMode === "global" ? 0 : Number(referencePoint.estimatedAmount) || 0;

    // Marca todos os pontos da peça como validados
    const nextPoints = damagePoints.map((p) =>
      p.carPartCode === targetCode ? { ...p, validated: true } : p
    );
    onChange(nextPoints);

    // Notifica callback de vínculo comercial
    if (onValidatePart) {
      onValidatePart({
        carPartCode: targetCode,
        partLabel,
        damageType: referencePoint.damageType,
        dentCount: totalCount,
        dentSize: referencePoint.dentSize || "2",
        dentSizeLabel: sizeObj?.shortLabel,
        partMaterial: matCode,
        materialTag: matObj.tag,
        materialLabel: matObj.label,
        pricingMode: partPricingMode,
        estimatedAmount: finalAmount,
        notes: referencePoint.notes || undefined,
      });
    }
  };

  // Upload de foto da avaria
  const handlePhotoUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateSelectedPoint({ photoStoragePath: url });
  };

  // Contagem dinâmica total de mossas somando todas as peças
  const totalAllDents = useMemo(() => {
    return damagePoints.reduce((acc, p) => acc + (Math.max(1, Number(p.dentCount) || 1)), 0);
  }, [damagePoints]);

  const totalContractedDents = useMemo(() => {
    return damagePoints.filter((p) => p.contracted).reduce((acc, p) => acc + (Math.max(1, Number(p.dentCount) || 1)), 0);
  }, [damagePoints]);

  // Agrupamento consolidado por peça da carroceria (elimina poluição de dezenas de cards individuais)
  const piecesSummary = useMemo(() => {
    const map = new Map<string, {
      carPartCode: string;
      partLabel: string;
      points: (DamagePointData & { originalIndex: number })[];
      totalDents: number;
      materialCode: string;
      materialObj: (typeof PART_MATERIALS)[number];
      damageTypes: string[];
      hasContracted: boolean;
      isValidated: boolean;
      pricingMode: "fixed" | "unit" | "global";
      estimatedTotal: number;
      dentSizeLabel?: string;
    }>();

    damagePoints.forEach((pt, idx) => {
      const partCode = pt.carPartCode || "general";
      const partLabel = CAR_PARTS.find((p) => p.code === partCode)?.label || partCode;
      const count = Number(pt.dentCount || 1);
      const matCode = pt.partMaterial || "steel";
      const matObj = PART_MATERIALS.find((m) => m.code === matCode) || PART_MATERIALS[0];
      const pMode = pt.pricingMode || "fixed";
      const estAmt = Number(pt.estimatedAmount || 0);
      const sizeObj = DENT_SIZES.find((s) => s.code === pt.dentSize);

      if (!map.has(partCode)) {
        map.set(partCode, {
          carPartCode: partCode,
          partLabel,
          points: [{ ...pt, originalIndex: idx }],
          totalDents: count,
          materialCode: matCode,
          materialObj: matObj,
          damageTypes: [pt.damageType],
          hasContracted: Boolean(pt.contracted),
          isValidated: Boolean(pt.validated),
          pricingMode: pMode,
          estimatedTotal: estAmt,
          dentSizeLabel: sizeObj?.shortLabel,
        });
      } else {
        const entry = map.get(partCode)!;
        entry.points.push({ ...pt, originalIndex: idx });
        entry.totalDents += count;
        if (!entry.damageTypes.includes(pt.damageType)) {
          entry.damageTypes.push(pt.damageType);
        }
        if (pt.contracted) entry.hasContracted = true;
        if (pt.validated) entry.isValidated = true;
        entry.estimatedTotal += estAmt;
      }
    });

    return Array.from(map.values());
  }, [damagePoints]);

  const getAssetPath = (viewName: string) => {
    const themePrefix = isCadTheme ? "cad" : "light";
    const resolvedBody = (bodyType === "pickup_cs" || bodyType === "pickup_cd") ? "pickup" : bodyType;
    return `/blueprints/${resolvedBody}/${themePrefix}_${viewName}.png`;
  };

  // Renderiza uma vista técnica com dimensões fixas no viewBox
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

            {/* Camada 3: Marcadores Periciais Compactos */}
            {viewPoints.map((pt) => {
              const isSelected = selectedPointIndex === pt.originalIndex;
              const markerX = (pt.coordX / 100) * viewDims.width;
              const markerY = (pt.coordY / 100) * viewDims.height;
              const r = baseRadius;
              const isAlu = pt.partMaterial === "aluminum";

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
                      r={r * 1.6}
                      fill="none"
                      stroke={pt.contracted ? "#38bdf8" : "#fbbf24"}
                      strokeWidth="2"
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Sombra de contraste */}
                  <circle r={r + 1} fill="rgba(0,0,0,0.7)" />

                  {/* Ponto colorido (com destaque especial ciano caso seja Alumínio) */}
                  <circle
                    r={r}
                    fill={pt.contracted ? (isAlu ? "#0284c7" : "#2563eb") : "#d97706"}
                    stroke={pt.contracted ? (isAlu ? "#38bdf8" : "#93c5fd") : "#fde68a"}
                    strokeWidth={isAlu ? "2" : "1.5"}
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

  const selectedMaterialObj = PART_MATERIALS.find((m) => m.code === (selectedPoint?.partMaterial || "steel")) || PART_MATERIALS[0];

  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {/* BARRA SUPERIOR DE CONTROLE PERICIAL */}
      <div className="space-y-2.5 border-b pb-3">
        {/* Linha 1: Identificação, Contadores e Modo de Visualização */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs font-semibold border-cyan-800 text-cyan-400 bg-cyan-950/40">
              <Eye className="h-3.5 w-3.5 text-cyan-400" />
              Blueprint de Inspeção (5 Vistas)
            </Badge>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                <strong className="text-cyan-400">{damagePoints.length}</strong> {damagePoints.length === 1 ? "marcador" : "marcadores"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-cyan-950/70 border border-cyan-700/60 px-2 py-0.5 text-cyan-200 font-semibold shadow-sm">
                <Sparkles className="h-3 w-3 text-cyan-400" />
                <strong className="text-white">{totalAllDents}</strong> {totalAllDents === 1 ? "mossa total" : "mossas totais"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-950/50 border border-blue-800/60 px-2 py-0.5 text-cyan-300 font-medium">
                {totalContractedDents} orçadas
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-950/50 border border-amber-800/60 px-2 py-0.5 text-amber-300 font-medium">
                {damagePoints.filter((p) => !p.contracted).length} pré-existentes
              </span>
            </div>
          </div>

          {/* Alternância CAD Dark vs Ficha Impressa */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs gap-1.5 border-slate-700 bg-card hover:bg-muted"
            onClick={() => setIsCadTheme(!isCadTheme)}
            title={isCadTheme ? "Mudar para Ficha Técnica Clara" : "Mudar para CAD Blueprint Dark"}
          >
            {isCadTheme ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-cyan-400" />}
            <span className="font-medium">{isCadTheme ? "Modo Impresso" : "CAD Dark"}</span>
          </Button>
        </div>

        {/* Linha 2: Toolbar Unificada e Organizada de Carroceria e Vistas */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-muted/40 p-1.5 rounded-lg border">
          {/* Seletor de Carroceria */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 shrink-0">
              Carroceria:
            </span>
            <div className="flex items-center gap-1 bg-background/80 p-0.5 rounded-md border shrink-0">
              {BODY_TYPES.map((bt) => (
                <Button
                  key={bt.code}
                  size="sm"
                  variant={bodyType === bt.code ? "default" : "ghost"}
                  className={cn(
                    "h-6 px-2.5 text-xs font-medium transition-all",
                    bodyType === bt.code && "bg-cyan-600 text-white shadow-sm font-semibold"
                  )}
                  onClick={() => handleSelectBodyType(bt.code)}
                >
                  {bt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Filtro / Navegação de Vistas */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 shrink-0">
              Vista:
            </span>
            <div className="flex items-center gap-1 bg-background/80 p-0.5 rounded-md border shrink-0">
              {(["all", "top", "front", "rear", "left", "right"] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={activeView === v ? "default" : "ghost"}
                  className={cn(
                    "h-6 px-2 text-xs transition-all",
                    activeView === v && "bg-primary text-primary-foreground font-semibold shadow-sm"
                  )}
                  onClick={() => setActiveView(v)}
                >
                  {v === "all" ? "Prancha 5V" : v === "top" ? "Superior" : v === "front" ? "Frente" : v === "rear" ? "Traseira" : v === "left" ? "Lat. Esq." : "Lat. Dir."}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LEGENDA JURÍDICA & HUD DE PEÇA DETECTADA */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs border">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 border border-cyan-300 text-[9px] font-bold text-white shadow" />
            <span className="font-medium text-foreground">Serviço Contratado (Orçado)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-600 border border-amber-300 text-[9px] font-bold text-white shadow" />
            <span className="font-medium text-foreground">Dano Pré-existente (Checklist Entrada)</span>
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
            Clique na imagem para plotar avaria com detecção pericial de peça.
          </div>
        )}
      </div>

      {/* ÁREA GRÁFICA DO BLUEPRINT */}
      {activeView === "all" ? (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 flex flex-col gap-3">
            {renderTechnicalViewBox("front", "1. Vista Frontal", "front", "h-52 md:h-56", false)}
            {renderTechnicalViewBox("rear", "2. Vista Traseira", "rear", "h-52 md:h-56", false)}
          </div>
          <div className="md:col-span-4">
            {renderTechnicalViewBox("top", "3. Vista Superior (Capô, Teto, Tampa)", "top", "h-96 md:h-[464px]", false)}
          </div>
          <div className="md:col-span-4 flex flex-col gap-3">
            {renderTechnicalViewBox("left", "4. Lateral Esquerda (Motorista)", "left", "h-52 md:h-56", true)}
            {renderTechnicalViewBox("right", "5. Lateral Direita (Passageiro)", "right", "h-52 md:h-56", false)}
          </div>
        </div>
      ) : (
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

      {/* PAINEL DE INSPEÇÃO & EDIÇÃO: DETALHES DO PONTO / PEÇA SELECIONADA */}
      {selectedPoint && !readOnly ? (
        <div className="rounded-xl border border-cyan-800/80 bg-slate-900/80 p-4 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-2 mb-3 gap-2">
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
                Editar Ponto #{(selectedPointIndex ?? 0) + 1} — {CAR_PARTS.find((p) => p.code === selectedPoint.carPartCode)?.label}
              </span>
              <Badge className={cn("text-[10px] uppercase font-bold", selectedMaterialObj.badgeClass)}>
                {selectedMaterialObj.tag}
              </Badge>
              {selectedPoint.validated && (
                <Badge className="bg-emerald-950/80 text-emerald-300 border-emerald-600 text-[10px] gap-1">
                  <CheckCheck className="h-3 w-3" /> Validado
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={removeSelectedPoint}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remover Marcador
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            {/* Peça Afetada */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Peça da Carroceria</Label>
              <Select
                value={selectedPoint.carPartCode}
                onValueChange={(val) => {
                  const existingForPart = damagePoints.find((p) => p.carPartCode === val && p.partMaterial);
                  updateSelectedPoint({
                    carPartCode: val,
                    partMaterial: existingForPart?.partMaterial || selectedPoint.partMaterial || "steel",
                  });
                }}
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

            {/* TIPO DE MATERIAL (Requisito Explícito do Alex) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-cyan-300 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-cyan-400" />
                  Tipo de Material
                </Label>
                {selectedMaterialObj.markupPct && (
                  <span className="text-[10px] text-amber-400 font-bold">
                    +{selectedMaterialObj.markupPct}% PDR Sugerido
                  </span>
                )}
              </div>
              <Select
                value={selectedPoint.partMaterial || "steel"}
                onValueChange={(val) => updateSelectedPoint({ partMaterial: val })}
              >
                <SelectTrigger className="h-8 border-cyan-800/80 bg-slate-950/60 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PART_MATERIALS.map((m) => (
                    <SelectItem key={m.code} value={m.code}>
                      <span className="flex items-center justify-between gap-2 w-full">
                        <span>{m.label}</span>
                        {m.markupPct ? (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-600 text-amber-400">
                            +{m.markupPct}% Sugestão
                          </Badge>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo de Dano */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Tipo de Dano / Avaria</Label>
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

            {/* Diâmetro / Tamanho da Mossa (PDR) */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Diâmetro / Tamanho Mossa</Label>
              <Select
                value={selectedPoint.dentSize || "2"}
                onValueChange={(val) => updateSelectedPoint({ dentSize: val })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DENT_SIZES.map((ds) => (
                    <SelectItem key={ds.code} value={ds.code}>
                      {ds.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contagem de Mossas com Multiplicadores Rápidos */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Qtd. Mossas</Label>
                <span className="text-[10px] text-muted-foreground">Multiplicadores:</span>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={5000}
                  className="h-8 w-20 text-center font-bold"
                  value={selectedPoint.dentCount ?? 1}
                  onChange={(e) => updateSelectedPoint({ dentCount: parseInt(e.target.value) || 1 })}
                />
                <div className="flex items-center gap-0.5 bg-slate-950/80 p-0.5 rounded border border-slate-800">
                  {[2, 4, 6, 8, 12].map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-1.5 text-[10px] font-mono text-cyan-400 hover:bg-cyan-950"
                      onClick={() => applyMultiplier(m)}
                      title={`Multiplicar por ${m} (peça subdividida)`}
                    >
                      x{m}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modo de Precificação: Fixo vs Unitário vs Conjunto Global */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Modo de Precificação</Label>
              <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded border border-slate-800 h-8">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPoint.pricingMode === "fixed" ? "default" : "ghost"}
                  className={cn(
                    "h-6 flex-1 text-[10px] font-medium px-1",
                    selectedPoint.pricingMode === "fixed" && "bg-cyan-600 text-white"
                  )}
                  onClick={() => updateSelectedPoint({ pricingMode: "fixed" })}
                >
                  Fixo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPoint.pricingMode === "unit" ? "default" : "ghost"}
                  className={cn(
                    "h-6 flex-1 text-[10px] font-medium px-1",
                    selectedPoint.pricingMode === "unit" && "bg-cyan-600 text-white"
                  )}
                  onClick={() => updateSelectedPoint({ pricingMode: "unit" })}
                >
                  Por Mossa
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPoint.pricingMode === "global" ? "default" : "ghost"}
                  className={cn(
                    "h-6 flex-1 text-[10px] font-medium px-1",
                    selectedPoint.pricingMode === "global" && "bg-cyan-600 text-white"
                  )}
                  onClick={() => updateSelectedPoint({ pricingMode: "global", estimatedAmount: 0 })}
                  title="Conjunto / Preço por tudo (peça sem cobrança avulsa no dossiê)"
                >
                  Conjunto
                </Button>
              </div>
            </div>

            {/* Valor Estimado / Negociado */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                {selectedPoint.pricingMode === "global"
                  ? "Valor da Peça (€)"
                  : selectedPoint.pricingMode === "fixed"
                  ? "Valor do Pacote (€)"
                  : "Valor Unitário / Mossa (€)"}
              </Label>
              {selectedPoint.pricingMode === "global" ? (
                <div className="h-8 px-2.5 rounded border border-cyan-800/60 bg-cyan-950/40 text-cyan-300 text-xs flex items-center font-medium">
                  0,00 € (Incluso no Conjunto)
                </div>
              ) : (
                <Input
                  type="number"
                  step="0.01"
                  className="h-8"
                  placeholder="Ex: 350.00"
                  value={selectedPoint.estimatedAmount ?? ""}
                  onChange={(e) => updateSelectedPoint({ estimatedAmount: e.target.value })}
                />
              )}
            </div>

            {/* Enquadramento Pericial */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Classificação Pericial</Label>
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

            {/* Parecer Técnico */}
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs font-medium">Parecer Técnico / Anotação da Peça</Label>
              <Input
                className="h-8"
                placeholder="Ex.: Mossas concentradas na nervura central, sem estiramento."
                value={selectedPoint.notes ?? ""}
                onChange={(e) => updateSelectedPoint({ notes: e.target.value })}
              />
            </div>

            {/* Evidência Fotográfica com Câmera Funcional */}
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs font-medium">Evidência Fotográfica</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-xs font-mono flex-1"
                  placeholder="URL ou arquivo de imagem..."
                  value={selectedPoint.photoStoragePath ?? ""}
                  onChange={(e) => updateSelectedPoint({ photoStoragePath: e.target.value })}
                />
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  className="h-8 px-2.5 border-slate-700 hover:text-cyan-400 gap-1 shrink-0"
                  title="Tirar foto ou carregar imagem da avaria"
                  onClick={handlePhotoUploadClick}
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span className="text-[11px] hidden sm:inline">Foto</span>
                </Button>
              </div>
            </div>

            {/* BARRA DE AÇÃO: VALIDAR PEÇA E VINCULAR AO ORÇAMENTO */}
            <div className="md:col-span-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-800/80 mt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>
                  Ao validar, os dados desta peça são consolidados e vinculados automaticamente às tabelas financeiras de serviços/peças.
                </span>
              </div>
              <Button
                type="button"
                className="h-9 px-5 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow shrink-0"
                onClick={() => handleValidatePiece()}
              >
                <CheckCheck className="h-4 w-4" />
                Validar Peça e Vincular ao Orçamento
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CONSOLIDADO DE DANOS POR PEÇA (Substitui a lista desordenada de 50 cards azuis) */}
      {piecesSummary.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between pb-2 mb-2 border-b gap-2">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dossiê Consolidado por Peça ({piecesSummary.length} {piecesSummary.length === 1 ? "peça" : "peças"} • <strong className="text-cyan-400 font-bold">{totalAllDents}</strong> {totalAllDents === 1 ? "mossa total" : "mossas no total"})
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Selecione para ajustar detalhes ou clique em Validar para transferir aos itens financeiros
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {piecesSummary.map((piece) => {
              const isSelected = selectedPoint?.carPartCode === piece.carPartCode;

              return (
                <div
                  key={piece.carPartCode}
                  onClick={() => {
                    const firstIdx = piece.points[0]?.originalIndex;
                    if (firstIdx !== undefined) setSelectedPointIndex(firstIdx);
                  }}
                  className={cn(
                    "flex flex-col gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-all",
                    isSelected
                      ? "bg-cyan-950/40 border-cyan-500 shadow-md ring-1 ring-cyan-500/50"
                      : "bg-background/80 hover:bg-muted/80 border-slate-800/80"
                  )}
                >
                  {/* Topo do Card da Peça */}
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-foreground text-sm truncate">
                        {piece.partLabel}
                      </span>
                    </div>
                    <Badge className={cn("text-[9px] px-1.5 py-0 uppercase font-bold shrink-0", piece.materialObj.badgeClass)}>
                      {piece.materialObj.tag}
                    </Badge>
                  </div>

                  {/* Detalhes Técnicos e Contagens */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-medium text-cyan-300">
                      {piece.totalDents} {piece.totalDents === 1 ? "mossa" : "mossas"}
                    </span>
                    {piece.dentSizeLabel && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span>Tam: {piece.dentSizeLabel}</span>
                      </>
                    )}
                    <span className="text-slate-600">•</span>
                    <span className="capitalize">{DAMAGE_TYPES.find((d) => d.code === piece.damageTypes[0])?.label || piece.damageTypes[0]}</span>
                  </div>

                  {/* Rodapé com Status e Ações */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-0.5">
                    <div className="flex items-center gap-1">
                      {piece.isValidated ? (
                        <Badge className="bg-emerald-950/80 text-emerald-300 border-emerald-600 text-[9px] px-1.5 py-0 gap-0.5">
                          <CheckCheck className="h-2.5 w-2.5" /> Validado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-400 border-amber-700/60 text-[9px] px-1.5 py-0">
                          Pendente
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1.5 py-0",
                          piece.hasContracted ? "border-blue-700 text-blue-400" : "border-amber-700 text-amber-400"
                        )}
                      >
                        {piece.hasContracted ? "Orçado" : "Checklist"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      {!piece.isValidated && (
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px] text-cyan-400 hover:bg-cyan-950/80 gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleValidatePiece(piece.carPartCode);
                          }}
                          title="Validar e sincronizar com itens do orçamento"
                        >
                          <CheckCheck className="h-3 w-3" /> Validar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePiece(piece.carPartCode);
                        }}
                        title="Remover todos os pontos desta peça"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
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
              as peças nominais vinculadas serão preservados.
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
