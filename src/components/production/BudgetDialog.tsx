import { VehicleBlueprint5Views, type DamagePointData, type ValidatedPartSummary } from "./VehicleBlueprint5Views";
import { Eye } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBudgetPdf, sendBudgetEmail, uploadBudgetPhoto, markBudgetSent, getBudgetSignLink } from "@/lib/apiBudgets";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspace } from "@/hooks/useWorkspace";
import { openBudgetPreview, downloadBudgetHtml } from "@/lib/budgetPdfUtils";
import { apiRequest } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, Save, X, PenLine, Calculator as CalculatorIcon,
  Wrench, Palette, Hammer, ArrowLeft, Box as BoxIcon, MapPin, ShieldCheck,
  Boxes, ChevronDown, Check as CheckIcon, Search as SearchIcon, Lock as LockIcon,
  CheckCircle2, XCircle, Eraser, HandPlatter, Send, AlertTriangle, Scan as ScanIcon,
  FileDown, FileText, Users, Loader2, RotateCcw, Copy, Share2, Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/useLanguage";
import { useRole } from "@/hooks/useRole";
import { useExtractProductionOrder, type FieldConfidence } from "@/hooks/useExtractProductionOrder";
import { FileUploadZone } from "@/components/service-orders/FileUploadZone";
import { WeeklogSignatureCanvas, type WeeklogSignatureCanvasRef } from "@/components/service-orders/WeeklogSignatureCanvas";
import { useServiceCatalogItems } from "@/hooks/useServiceCatalog";

export type BudgetPartLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  pricing_mode?: "fixed" | "unit" | "global";
};

export type BudgetServiceLine = {
  id: string;
  catalogItemId?: string;
  catalogItemCode?: string;
  categoryCode?: string;
  description: string;
  quantity: number;
  unit_price: number;
  pricing_mode?: "fixed" | "unit" | "global";
};

export const BUDGET_TYPE_TO_CATEGORIES: Record<string, string[]> = {
  pdr: ["pdr"],
  assembly_disassembly: ["assembly_disassembly"],
  body_paint: ["bodywork", "paint", "detailing", "glass_exterior"],
  mechanics: ["mechanics", "brakes_suspension", "electrical_adas", "diagnostics", "wheels_tires", "hvac"],
};

export type BudgetLaborLine = {
  id: string;
  description: string;
  hours: number;
  hourly_rate: number;
};

export type OcrDamageArea = {
  id: string;
  areaName: string;
  damageType: string;
  quantity: number;
  measurements?: string;
  confidence: FieldConfidence;
};

export type OcrBudgetExtraction = {
  technician?: string;
  docDate?: string;
  vehicle_brand?: string;
  vehicle_model?: string;
  vehicle_plate?: string;
  vehicle_vin?: string;
  vehicle_year?: string;
  vehicle_color?: string;
  vehicle_km?: string;
  dossier_insurance_company?: string;
  dossier_claim_number?: string;
  intervention_types?: string[];
  diagnosis?: string;
  technical_description?: string;
  forfait_total?: number;
  damage_areas?: OcrDamageArea[];
  labor_lines?: Array<{ id: string; description: string; hours: number; hourly_rate?: number; confidence: FieldConfidence }>;
  observations?: string;
  client_name?: string;
  client_phone?: string;
  client_email?: string;
  field_confidence: Record<string, FieldConfidence>;
  overall_confidence: FieldConfidence;
  raw_notes?: string;
};

export type BudgetSignerType =
  | "client"
  | "company"
  | "insurance"
  | "authorized";

export const SIGNER_TYPE_OPTIONS: { value: BudgetSignerType; pt: string; fr: string }[] = [
  { value: "client", pt: "Cliente", fr: "Client" },
  { value: "company", pt: "Empresa", fr: "Entreprise" },
  { value: "insurance", pt: "Seguradora", fr: "Assurance" },
  { value: "authorized", pt: "Responsável autorizado", fr: "Responsable autorisé" },
];

export function signerTypeLabel(t: BudgetSignerType | string | null | undefined, lang: "pt" | "fr"): string {
  if (!t) return "—";
  const found = SIGNER_TYPE_OPTIONS.find((o) => o.value === t);
  if (found) {
    return lang === "fr" ? (found.fr ?? found.pt) : found.pt;
  }
  return String(t);
}

export type BudgetSignature = {
  signed: boolean;
  signerName: string;
  signerType: BudgetSignerType | "";
  signedAt: string | null;
  signatureData: string | null;
  confirmationMethod: "DRAWN_SIGNATURE" | "EXPLICIT_CONFIRMATION" | null;
  budgetNumberAtMoment: string | null;
  finalValueAtMoment: number | null;
};

export type BudgetRejection = {
  rejected: boolean;
  rejectedAt: string | null;
  rejectedBy: string | null;
  reason: string | null;
};

export function emptySignature(): BudgetSignature {
  return {
    signed: false,
    signerName: "",
    signerType: "",
    signedAt: null,
    signatureData: null,
    confirmationMethod: null,
    budgetNumberAtMoment: null,
    finalValueAtMoment: null,
  };
}

export function emptyRejection(): BudgetRejection {
  return { rejected: false, rejectedAt: null, rejectedBy: null, reason: null };
}

export type BudgetStatus = "draft" | "sent" | "approved" | "rejected" | "correction_needed";

export type BudgetType = "mechanics" | "body_paint" | "pdr" | "assembly_disassembly";

export const BUDGET_TYPE_LABELS: Record<BudgetType, { pt: string; fr: string }> = {
  mechanics: { pt: "Mecânica", fr: "Mécanique" },
  body_paint: { pt: "Funilaria e Pintura", fr: "Carrosserie et Peinture" },
  pdr: { pt: "Martelinho / PDR", fr: "Débosselage / PDR" },
  assembly_disassembly: { pt: "Montagem / Desmontagem", fr: "Montage / Démontage" },
};

export const BUDGET_TYPE_SHORT_LABELS: Record<BudgetType, { pt: string; fr: string }> = {
  mechanics: { pt: "Mecânica", fr: "Méc." },
  body_paint: { pt: "Funil. e Pintura", fr: "Carross. & Peint." },
  pdr: { pt: "Martelinho / PDR", fr: "Déboss. / PDR" },
  assembly_disassembly: { pt: "Mont./Desmont.", fr: "Mont./Démont." },
};

export const BUDGET_TYPE_DESCRIPTIONS: Record<BudgetType, { pt: string; fr: string }> = {
  mechanics: {
    pt: "Serviços mecânicos, elétrica, suspensão, motor, câmbio, transmissão, acessórios e revisões preventivas.",
    fr: "Services mécaniques, électrique, suspension, moteur, boîte de vitesses, transmission, accessoires et révisions préventives.",
  },
  body_paint: {
    pt: "Reparação de chapas, substituição de componentes, funilaria, pintura, acabamento, polimento e proteção de pintura.",
    fr: "Réparation de tôlerie, remplacement de composants, carrosserie, peinture, finition, polissage et protection de peinture.",
  },
  pdr: {
    pt: "Reparação sem pintura (Paintless Dent Repair), amassados leves, pequenos impactos, granizo, martelinho de ouro.",
    fr: "Réparation sans peinture (Paintless Dent Repair), bosses légères, petits impacts, grêle, débosselage à la main.",
  },
  assembly_disassembly: {
    pt: "Serviços exclusivos de desmontagem, montagem, remoção e reinstalação de componentes do veículo (carroceria, mecânica e elétrica).",
    fr: "Services exclusifs de démontage, montage, dépose et réinstallation de composants du véhicule (carrosserie, mécanique et électrique).",
  },
};

export const BUDGET_TYPE_SUBLINE: Record<BudgetType, { pt: string; fr: string }> = {
  mechanics: { pt: "Revisões, mecânica, elétrica e componentes", fr: "Révisions, mécanique, électrique et composants" },
  body_paint: { pt: "Chaparia, pintura, reparação e substituição", fr: "Tôlerie, peinture, réparation et remplacement" },
  pdr: { pt: "Amassados sem pintura · martelinho · PDR", fr: "Bosses sans peinture · débosselage · PDR" },
  assembly_disassembly: { pt: "Montagem · Desmontagem · Reinstalação", fr: "Montage · Démontage · Réinstallation" },
};

export const BUDGET_TYPE_META: Record<BudgetType, {
  accent: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
  itemsTitle: string;
  partsLabel: string;
  laborLabel: string;
  addPartsButtonLabel: string;
  addLaborButtonLabel: string;
  totalPartsLabel: string;
  totalLaborLabel: string;
}> = {
  mechanics: {
    accent: "bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30",
    dot: "bg-indigo-500",
    icon: Wrench,
    itemsTitle: "Peças / Materiais e Mão de Obra",
    partsLabel: "Peças / Materiais",
    laborLabel: "Mão de Obra",
    addPartsButtonLabel: "Peça",
    addLaborButtonLabel: "Serviço",
    totalPartsLabel: "Total Peças / Materiais",
    totalLaborLabel: "Total Mão de Obra",
  },
  body_paint: {
    accent: "bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
    dot: "bg-sky-500",
    icon: Palette,
    itemsTitle: "Peças / Componentes e Mão de Obra (Reparação / Pintura / Substituição)",
    partsLabel: "Peças / Componentes",
    laborLabel: "Mão de Obra",
    addPartsButtonLabel: "Peça / Componente",
    addLaborButtonLabel: "Serviço / Etapa",
    totalPartsLabel: "Total Peças / Componentes",
    totalLaborLabel: "Total Mão de Obra",
  },
  pdr: {
    accent: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
    dot: "bg-amber-500",
    icon: Hammer,
    itemsTitle: "Áreas / Danos e Mão de Obra (Martelinho / PDR)",
    partsLabel: "Áreas / Danos",
    laborLabel: "Mão de Obra",
    addPartsButtonLabel: "Área / Dano",
    addLaborButtonLabel: "Serviço / Etapa",
    totalPartsLabel: "Total Áreas / Danos",
    totalLaborLabel: "Total Mão de Obra",
  },
  assembly_disassembly: {
    accent: "bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30",
    dot: "bg-slate-500",
    icon: Boxes,
    itemsTitle: "Componentes / Peças e Mão de Obra (Montagem / Desmontagem)",
    partsLabel: "Componentes / Peças",
    laborLabel: "Mão de Obra",
    addPartsButtonLabel: "Componente",
    addLaborButtonLabel: "Serviço / Etapa",
    totalPartsLabel: "Total Componentes / Peças",
    totalLaborLabel: "Total Mão de Obra",
  },
};

export const INTERVENTION_CATALOG: Record<BudgetType, { pt: string[]; fr: string[] }> = {
  mechanics: {
    pt: [
      "Diagnóstico mecânico",
      "Revisão mecânica",
      "Manutenção preventiva",
      "Manutenção corretiva",
      "Revisão geral",
      "Motor",
      "Sistema de arrefecimento",
      "Sistema de lubrificação",
      "Sistema de alimentação",
      "Sistema de injeção",
      "Sistema de ignição",
      "Sistema de escape",
      "Caixa de câmbio",
      "Embreagem",
      "Transmissão",
      "Sistema de direção",
      "Sistema de suspensão",
      "Sistema de freios",
      "Sistema elétrico",
      "Bateria",
      "Alternador",
      "Motor de arranque",
      "Ar-condicionado",
      "Troca de óleo",
      "Troca de filtros",
      "Pneus",
      "Alinhamento",
      "Balanceamento",
      "Geometria",
      "Reparo",
      "Substituição de componente",
      "Outros",
    ],
    fr: [
      "Diagnostic mécanique",
      "Révision mécanique",
      "Entretien préventif",
      "Entretien correctif",
      "Révision générale",
      "Moteur",
      "Système de refroidissement",
      "Système de lubrification",
      "Système d'alimentation",
      "Système d'injection",
      "Système d'allumage",
      "Système d'échappement",
      "Boîte de vitesses",
      "Embrayage",
      "Transmission",
      "Système de direction",
      "Système de suspension",
      "Système de freinage",
      "Système électrique",
      "Batterie",
      "Alternateur",
      "Démarreur",
      "Climatisation",
      "Vidange d'huile",
      "Remplacement des filtres",
      "Pneus",
      "Géométrie / Alignement",
      "Équilibrage",
      "Géométrie train roulant",
      "Réparation",
      "Remplacement de composant",
      "Autres",
    ],
  },
  body_paint: {
    pt: [
      "Diagnóstico de carroceria",
      "Avaliação de danos",
      "Funilaria / Lanternagem",
      "Desmontagem para reparação",
      "Preparação de carroceria",
      "Reparação de painel",
      "Reparação de porta",
      "Reparação de capô",
      "Reparação de tampa traseira",
      "Reparação de para-lama",
      "Reparação de teto",
      "Reparação de lateral",
      "Reparação de para-choque",
      "Substituição de painel",
      "Substituição de porta",
      "Substituição de capô",
      "Substituição de tampa traseira",
      "Substituição de para-lama",
      "Substituição de para-choque",
      "Preparação para pintura",
      "Pintura",
      "Pintura parcial",
      "Pintura completa",
      "Polimento",
      "Acabamento",
      "Montagem após reparação",
      "Outros",
    ],
    fr: [
      "Diagnostic carrosserie",
      "Évaluation des dommages",
      "Carrosserie / débosselage classique",
      "Poinçonnage / redressage",
      "Démontage pour réparation",
      "Préparation de carrosserie",
      "Réparation d'aile / panneau",
      "Réparation de porte",
      "Réparation de capot",
      "Réparation de hayon",
      "Réparation d'aile avant/arrière",
      "Réparation de toit",
      "Réparation de paroi latérale",
      "Réparation de pare-chocs",
      "Remplacement d'aile / panneau",
      "Remplacement de porte",
      "Remplacement de capot",
      "Remplacement de hayon",
      "Remplacement d'aile avant/arrière",
      "Remplacement de pare-chocs",
      "Préparation pour peinture",
      "Peinture",
      "Peinture partielle",
      "Peinture complète",
      "Polissage",
      "Finition",
      "Remontage après réparation",
      "Autres",
    ],
  },
  pdr: {
    pt: [
      "Reparação PDR",
      "Avaliação de danos",
      "Danos de granizo",
      "Danos de estacionamento",
      "Amassado sem pintura",
      "Pequeno amassado",
      "Amassado médio",
      "Amassado grande",
      "Vinco",
      "Batida de porta",
      "Marcas de estacionamento",
      "Reparação localizada",
      "Acesso interno",
      "Acesso por desmontagem",
      "Acabamento PDR",
      "Avaliação de danos em alumínio",
      "Reparação de painel em alumínio",
      "Outros",
    ],
    fr: [
      "Réparation PDR",
      "Évaluation des dommages",
      "Dommages de grêle",
      "Dommages de stationnement",
      "Bosse sans peinture",
      "Petite bosse",
      "Bosse moyenne",
      "Grosse bosse",
      "Pli / marque",
      "Coup de porte",
      "Marques de stationnement",
      "Réparation localisée",
      "Accès par l'intérieur",
      "Accès par démontage",
      "Finition PDR",
      "Évaluation dommages aluminium",
      "Réparation panneau aluminium",
      "Autres",
    ],
  },
  assembly_disassembly: {
    pt: [
      "Desmontagem de capô",
      "Montagem de capô",
      "Desmontagem de tampa traseira",
      "Montagem de tampa traseira",
      "Desmontagem de porta",
      "Montagem de porta",
      "Desmontagem de para-choque",
      "Montagem de para-choque",
      "Desmontagem de para-lama",
      "Montagem de para-lama",
      "Desmontagem de teto",
      "Montagem de teto",
      "Desmontagem de forro de teto",
      "Montagem de forro de teto",
      "Desmontagem de revestimento interno",
      "Montagem de revestimento interno",
      "Desmontagem de bancos",
      "Montagem de bancos",
      "Desmontagem de elementos da carroceria",
      "Montagem de elementos da carroceria",
      "Desmontagem de componentes mecânicos",
      "Montagem de componentes mecânicos",
      "Desmontagem de componentes elétricos",
      "Montagem de componentes elétricos",
      "Remoção de componente",
      "Reinstalação de componente",
      "Outros",
    ],
    fr: [
      "Démontage de capot",
      "Montage de capot",
      "Démontage de hayon",
      "Montage de hayon",
      "Démontage de porte",
      "Montage de porte",
      "Démontage de pare-chocs",
      "Montage de pare-chocs",
      "Démontage d'aile",
      "Montage d'aile",
      "Démontage de toit",
      "Montage de toit",
      "Démontage de garniture de toit",
      "Montage de garniture de toit",
      "Démontage de revêtement intérieur",
      "Montage de revêtement intérieur",
      "Démontage de sièges",
      "Montage de sièges",
      "Démontage d'éléments de carrosserie",
      "Montage d'éléments de carrosserie",
      "Démontage de composants mécaniques",
      "Montage de composants mécaniques",
      "Démontage de composants électriques",
      "Montage de composants électriques",
      "Dépose de composant",
      "Réinstallation de composant",
      "Autres",
    ],
  },
};

export function getInterventionsListFor(type: BudgetType | string | null | undefined, lang: "pt" | "fr"): readonly string[] {
  if (!type) return [] as const;
  const key = String(type);
  const entry = (INTERVENTION_CATALOG as Partial<Record<string, { pt: readonly string[]; fr: readonly string[] }>>)[key];
  if (!entry) return [] as const;
  return lang === "fr" ? (entry.fr ?? entry.pt ?? []) : (entry.pt ?? entry.fr ?? []);
}

export type Budget = {
  id: string;
  number: string;
  code?: string;
  issued_at: string;
  status: BudgetStatus;
  budget_type: BudgetType;
  /** ISO 4217 currency of the budget (display only; authority is backend). */
  currency?: string;

  client_id?: string;
  client_display_id?: string;
  client_name: string;
  client_phone?: string;
  client_email?: string;
  client_document?: string;

  address_number?: string;
  address_street?: string;
  address_complement?: string;
  address_postal?: string;
  address_city?: string;
  address_country?: string;

  dossier_claim_number?: string;
  dossier_expert_number?: string;
  dossier_insurance_company?: string;
  dossier_garage_name?: string;
  dossier_broker_name?: string;
  dossier_claim_date?: string;
  dossier_franchise_amount?: number | string;
  dossier_expert_name?: string;
  dossier_expert_phone?: string;
  dossier_expert_time?: string;
  dossier_expert_date?: string;

  vehicle_brand?: string;
  vehicle_model?: string;
  vehicle_plate?: string;
  vehicle_vin?: string;
  vehicle_year?: string;
  vehicle_color?: string;
  vehicle_km?: string;
  vehicle_body_type?: string;

  // back-compat: mantido para registros antigos (string única)
  intervention_type?: string;
  // novo: seleção múltipla
  intervention_types?: string[];

  diagnosis?: string;
  technical_description?: string;

  discount_pct: number;
  iva_pct: number;

  parts: BudgetPartLine[];
  services: BudgetServiceLine[];
  labor: BudgetLaborLine[];

  vehicle_view_state: unknown | null;
  mechanical_selections?: unknown[];

  signature_ready: boolean;
  signature: BudgetSignature;
  rejection: BudgetRejection;
  created_at: string;
  updated_at: string;
};

export function resolveInterventionDisplayLang(langRaw: string): "pt" | "fr" {
  if (langRaw === "fr") return "fr";
  return "pt";
}

const PDR_AREA_KEYWORDS: Array<{ pattern: RegExp; labels: string[] }> = [
  { pattern: /cap(o|ô)/i, labels: ["Capô", "Capo"] },
  { pattern: /(porta|porte).*(dianteira|avant|frent(e|al)).*(esquerd|esquerdo|gauche|left)/i, labels: ["Porta dianteira esquerda"] },
  { pattern: /(porta|porte).*(dianteira|avant|frent(e|al)).*(direit|droit|right)/i, labels: ["Porta dianteira direita"] },
  { pattern: /(porta|porte).*(traseira|tr?s|arri|rear).*(esquerd|esquerdo|gauche|left)/i, labels: ["Porta traseira esquerda"] },
  { pattern: /(porta|porte).*(traseira|tr?s|arri|rear).*(direit|droit|right)/i, labels: ["Porta traseira direita"] },
  { pattern: /(porta|porte).*(esquerd|esquerdo|gauche|left)/i, labels: ["Porta esquerda"] },
  { pattern: /(porta|porte).*(direit|droit|right)/i, labels: ["Porta direita"] },
  { pattern: /mala|bagag|cofre|trunk|tampa.*(traseira|tr?s)/i, labels: ["Tampa do porta-malas"] },
  { pattern: /para-choque|parachoque|pare-chocs|parachoques|bumper.*(dianteira|avant|frent(e|al))/i, labels: ["Para-choque dianteiro"] },
  { pattern: /para-choque|parachoque|pare-chocs|parachoques|bumper.*(traseira|tr?s|rear)/i, labels: ["Para-choque traseiro"] },
  { pattern: /para-choque|parachoque|pare-chocs|bumper/i, labels: ["Para-choque"] },
  { pattern: /(paralama|garde-boue|fender).*(dianteira|avant|frent(e|al)).*(esquerd|gauche|left)/i, labels: ["Paralama dianteiro esquerdo"] },
  { pattern: /(paralama|garde-boue|fender).*(dianteira|avant|frent(e|al)).*(direit|droit|right)/i, labels: ["Paralama dianteiro direito"] },
  { pattern: /(paralama|garde-boue|fender).*(traseira|tr?s|rear).*(esquerd|gauche|left)/i, labels: ["Paralama traseiro esquerdo"] },
  { pattern: /(paralama|garde-boue|fender).*(traseira|tr?s|rear).*(direit|droit|right)/i, labels: ["Paralama traseiro direito"] },
  { pattern: /coluna|pilar|montante/i, labels: ["Coluna/Pilar"] },
  { pattern: /teto|toit|roof/i, labels: ["Teto"] },
  { pattern: /lat(eral|eral).*(esquerd|gauche|left)/i, labels: ["Painel lateral esquerdo"] },
  { pattern: /lat(eral|eral).*(direit|droit|right)/i, labels: ["Painel lateral direito"] },
  { pattern: /porta-malas|mala|bagag/i, labels: ["Porta-malas"] },
  { pattern: /painel|hatch|tampa/i, labels: ["Painel"] },
];

const PDR_DAMAGE_TYPE: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /granizo|grêle|grain|hail/i, label: "Granizo" },
  { pattern: /impacto|impact|batida|choque|collision/i, label: "Impacto" },
  { pattern: /amassad|bosselé|dented?|dent|deform/i, label: "Amassado" },
  { pattern: /vinco|pli|rayure|scratch|risco|risca/i, label: "Vinco" },
  { pattern: /pequeno|petit|small|leve|léger/i, label: "Amassado pequeno" },
  { pattern: /médio|moyen|medium/i, label: "Amassado médio" },
  { pattern: /grande|grand|big|large|grosse?|forte?/i, label: "Amassado grande" },
  { pattern: /estacion|parking|stationn/i, label: "Dano de estacionamento" },
];

function normalizeForfait(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Number(n.toFixed(2));
}

function inferDamageAreaFromText(text: string): string {
  for (const entry of PDR_AREA_KEYWORDS) {
    if (entry.pattern.test(text)) return entry.labels[0];
  }
  return "Área não identificada";
}
function inferDamageTypeFromText(text: string): string {
  for (const entry of PDR_DAMAGE_TYPE) {
    if (entry.pattern.test(text)) return entry.label;
  }
  return "Amassado";
}

const MEASURE_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m|polegada|pol|poleg\.?|''|\"|x\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?)/g;

function extractMeasurements(text: string): string | undefined {
  const matches: string[] = [];
  MEASURE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEASURE_PATTERN.exec(text)) !== null) matches.push(m[0].trim());
  if (matches.length) return matches.join(", ");
  return undefined;
}

function extractQtyFromText(text: string): number | null {
  const qtyPatterns = [
    /(?:qtd|qty|quantidade|nombre)\s*[:=]?\s*(\d+)/i,
    /(?:n[°º]?|número|numero|num|nombre)\s*(?:de)?\s*(?:danos|bosses|amassados|déformation)?\s*[:=]?\s*(\d+)/i,
    /(\d+)\s*(?:danos|bosses|amassados|déformations|pcs|peças|pièces|unidades?|unités?)/i,
    /(?:granizo|hail|grêle)\s*(?:com|avec|de|with)?\s*(\d+)/i,
  ];
  for (const p of qtyPatterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 9999) return n;
    }
  }
  return null;
}

export function adaptProductionExtractionToBudget(
  input: { order: any; confidence: FieldConfidence; notes?: string; field_confidence?: Record<string, FieldConfidence> },
  budgetType: BudgetType,
): OcrBudgetExtraction {
  const o = input.order ?? {};
  const conf = input.field_confidence ?? {};
  const notes = (input.notes ?? "").trim();
  const vehicleNotes = (o.vehicle_notes ?? "").trim();
  const combinedNotes = [notes, vehicleNotes].filter(Boolean).join("\n");
  const platform = (o.platform ?? "") as string;

  const docDateMatch = combinedNotes.match(
    /(?:data|date|emissão|emisão|feita|feito|criada)\s*[:=]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  );
  const technicianMatch = combinedNotes.match(
    /(?:técnico|tecnico|technicien|responsável|responsable|realizado\s+por|feito\s+por)\s*[:=]?\s*([^\n\r,;|]{2,80})/i,
  );
  const forfaitMatch = combinedNotes.match(
    /(?:forfait|forfete|valor\s+total|total\s+geral|montant\s+total|valor\s+global|montant\s+global|orçamento|devis)\s*(?:global)?\s*[:=]?\s*(?:R?\$|€|EUR|USD)?\s*([\d.,]+)/i,
  );
  const forfaitTotal = normalizeForfait(forfaitMatch?.[1] ?? undefined);

  const damage_areas: OcrDamageArea[] = [];
  if (budgetType === "pdr") {
    const lines = combinedNotes.split(/[\n\r;|]+/).map(l => l.trim()).filter(Boolean);
    for (const rawLine of lines) {
      const line = rawLine;
      if (line.length < 4) continue;
      const isDamageLine =
        /(?:capo|capô|porta|mala|parachoque|paralama|painel|teto|tampa|dano|amassado|granizo|bosselé|impacto|vinco|área|area|zone|pièce|peça|PDR|martelinho|débosselage)/i
          .test(line);
      if (!isDamageLine) continue;
      const areaName = inferDamageAreaFromText(line);
      const damageType = inferDamageTypeFromText(line);
      const qtyFound = extractQtyFromText(line);
      const measures = extractMeasurements(line);
      if (areaName === "Área não identificada" && !qtyFound && !measures && PDR_DAMAGE_TYPE.every(e => !e.pattern.test(line))) {
        continue;
      }
      damage_areas.push({
        id: crypto.randomUUID(),
        areaName,
        damageType,
        quantity: qtyFound ?? 1,
        measurements: measures,
        confidence: conf[`damage_${damage_areas.length}`] ?? "low",
      });
    }
    if (damage_areas.length === 0) {
      const hailCount = extractQtyFromText(combinedNotes);
      const hailMatch = /granizo|grêle|hail|grain/i.test(combinedNotes);
      if (hailMatch && (hailCount ?? 0) >= 1) {
        damage_areas.push({
          id: crypto.randomUUID(),
          areaName: "Várias áreas (granizo)",
          damageType: "Granizo",
          quantity: hailCount!,
          confidence: "medium",
        });
      }
    }
  }

  const labor_lines: OcrBudgetExtraction["labor_lines"] = [];
  if (budgetType === "pdr") {
    const laborPatterns = [
      /(?:mão\s*de\s*obra|m?o\s*de\s*obra|main\s*d'oeuvre|mo\s*[:=]|MO\s*[:=])\s*[:=]?\s*(?:R?\$|€)?\s*([\d.,]+)?(?:\s*(?:\/|por|per|p\/)\s*((?:\d+(?:[.,]\d+)?)h?))?/i,
      /(?:horas|heures|tempo)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*h?/i,
    ];
    const hrsMatch = combinedNotes.match(laborPatterns[1]);
    if (hrsMatch && hrsMatch[1]) {
      const hrs = Number(hrsMatch[1].replace(",", "."));
      if (Number.isFinite(hrs) && hrs > 0 && hrs < 9999) {
        labor_lines.push({
          id: crypto.randomUUID(),
          description: "Mão de obra PDR (informada no documento)",
          hours: Number(hrs.toFixed(2)),
          hourly_rate: undefined,
          confidence: "medium",
        });
      }
    }
  }

  const observations = combinedNotes.length > 10 ? combinedNotes : undefined;
  let client_name = o.client ?? undefined;
  if (!client_name) {
    const m = combinedNotes.match(/(?:cliente|client|proprietário|propriétaire|nome)\s*[:=]?\s*([^\n\r,;|]{2,120})/i);
    if (m && m[1]) client_name = m[1].trim();
  }
  let client_phone: string | undefined = undefined;
  let client_email: string | undefined = undefined;
  const phoneMatch = combinedNotes.match(/(\(?\d{2}\)?\s?\d{4,5}-?\d{4}|\+\d{2,3}\s?\d{8,13})/);
  if (phoneMatch) client_phone = phoneMatch[1].trim();
  const emailMatch = combinedNotes.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (emailMatch) client_email = emailMatch[1].trim();

  return {
    technician: technicianMatch?.[1]?.trim(),
    docDate: docDateMatch?.[1],
    vehicle_brand: o.brand ?? undefined,
    vehicle_model: o.model ?? undefined,
    vehicle_plate: o.license_plate ?? undefined,
    vehicle_vin: o.vin ?? undefined,
    vehicle_color: o.color ?? undefined,
    dossier_insurance_company: o.insurer ?? undefined,
    dossier_claim_number: (() => {
      const m = combinedNotes.match(/(?:sinistro|sinistre|reclamação|reclamaçao|claim|n°?\s*sinistro)\s*[:=]?\s*([A-Za-z0-9\-\/]{3,40})/i);
      return m?.[1]?.trim();
    })(),
    intervention_types: (() => {
      const list = getInterventionsListFor(budgetType, "pt");
      const found: string[] = [];
      for (const iv of list) {
        const pattern = new RegExp(iv.replace(/[()]/g, "\\$&").replace(/\s+/g, "\\s*"), "i");
        if (pattern.test(combinedNotes) || pattern.test(platform)) {
          if (!found.includes(iv)) found.push(iv);
        }
      }
      return found.length > 0 ? found : undefined;
    })(),
    diagnosis: (() => {
      const m = combinedNotes.match(/(?:diagn[oó]stico|diagnostic)\s*[:=]?\s*([^\n]{6,240})/i);
      return m?.[1]?.trim();
    })(),
    technical_description: (() => {
      if (!combinedNotes.trim()) return undefined;
      const short = combinedNotes.trim().slice(0, 500);
      return short.length > 20 ? short : undefined;
    })(),
    forfait_total: forfaitTotal,
    damage_areas: damage_areas.length ? damage_areas : undefined,
    labor_lines: labor_lines.length ? labor_lines : undefined,
    observations,
    client_name,
    client_phone,
    client_email,
    field_confidence: { ...conf },
    overall_confidence: input.confidence,
    raw_notes: combinedNotes || undefined,
  };
}

export function btLabel(t: BudgetType | string | null | undefined, lang: "pt" | "fr"): string {
  if (!t) return "-";
  const entry = (BUDGET_TYPE_LABELS as Partial<Record<string, { pt: string; fr: string }>>)[String(t)];
  return entry ? (entry[lang] ?? entry.pt ?? String(t)) : String(t);
}
export function btShort(t: BudgetType | string | null | undefined, lang: "pt" | "fr"): string {
  if (!t) return "-";
  const entry = (BUDGET_TYPE_SHORT_LABELS as Partial<Record<string, { pt: string; fr: string }>>)[String(t)];
  return entry ? (entry[lang] ?? entry.pt ?? String(t)) : String(t);
}
export function btDescription(t: BudgetType | string | null | undefined, lang: "pt" | "fr"): string {
  if (!t) return "";
  const entry = (BUDGET_TYPE_DESCRIPTIONS as Partial<Record<string, { pt: string; fr: string }>>)[String(t)];
  return entry ? (entry[lang] ?? entry.pt ?? "") : "";
}
export function btSubline(t: BudgetType | string | null | undefined, lang: "pt" | "fr"): string {
  if (!t) return "";
  const entry = (BUDGET_TYPE_SUBLINE as Partial<Record<string, { pt: string; fr: string }>>)[String(t)];
  return entry ? (entry[lang] ?? entry.pt ?? "") : "";
}

export function getBudgetInterventions(b: { intervention_type?: string; intervention_types?: string[] | null }): string[] {
  if (Array.isArray(b.intervention_types) && b.intervention_types.length > 0) {
    return [...b.intervention_types];
  }
  if (b.intervention_type && String(b.intervention_type).trim().length > 0) {
    const s = String(b.intervention_type).trim();
    if (s.includes(";")) return s.split(";").map((x) => x.trim()).filter(Boolean);
    if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  return [];
}

export function setBudgetInterventions(
  set: (patch: { intervention_type?: string; intervention_types?: string[] }) => void,
  next: string[],
): void {
  set({
    intervention_types: [...next],
    intervention_type: next.length > 0 ? next.join(", ") : "",
  });
}

// LEGADO (mantido somente para não quebrar imports externos raros)
const INTERVENTION_TYPES = [
  "Diagnóstico",
  "Mecânica",
  "Elétrica",
  "Funilaria",
  "Pintura",
  "Revisão Preventiva",
  "Troca de Óleo",
  "Pneus / Alinhamento",
  "Ar Condicionado",
  "Outros",
];

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

const todayISO = () => new Date().toISOString().slice(0, 10);

interface CountryBudgetConfig {
  documentLabel: string;
  documentPlaceholder: string;
  postalLabel: string;
  postalPlaceholder: string;
}
const COUNTRY_BUDGET_CONFIG: Record<string, CountryBudgetConfig> = {
  BR: {
    documentLabel: "Documento",
    documentPlaceholder: "CPF: 000.000.000-00  ·  CNPJ: 00.000.000/0000-00",
    postalLabel: "CEP",
    postalPlaceholder: "00000-000",
  },
  PT: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF: 123456789",
    postalLabel: "Código postal",
    postalPlaceholder: "4000-000",
  },
  FR: {
    documentLabel: "Documento",
    documentPlaceholder: "SIRET: 123 456 789 00012  ·  SIREN: 123 456 789",
    postalLabel: "Code postal",
    postalPlaceholder: "69001",
  },
  DE: {
    documentLabel: "Documento",
    documentPlaceholder: "USt-IdNr. / Steuer-ID: DE123456789",
    postalLabel: "Postleitzahl",
    postalPlaceholder: "10115",
  },
  ES: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF / CIF: A12345678",
    postalLabel: "Código postal",
    postalPlaceholder: "28001",
  },
  IT: {
    documentLabel: "Documento",
    documentPlaceholder: "Partita IVA: IT12345678901  ·  CF: RSSMRA80A01F205X",
    postalLabel: "CAP",
    postalPlaceholder: "00100",
  },
  GB: {
    documentLabel: "Documento",
    documentPlaceholder: "VAT Reg No: GB123456789",
    postalLabel: "Postcode",
    postalPlaceholder: "EC1A 1BB",
  },
  BE: {
    documentLabel: "Documento",
    documentPlaceholder: "TVA / BTW / VAT: BE0123456789",
    postalLabel: "Code postal",
    postalPlaceholder: "1000",
  },
  NL: {
    documentLabel: "Documento",
    documentPlaceholder: "BTW: NL123456789B01",
    postalLabel: "Postcode",
    postalPlaceholder: "1012 GX",
  },
  LU: {
    documentLabel: "Documento",
    documentPlaceholder: "TVA: LU12345678",
    postalLabel: "Code postal",
    postalPlaceholder: "L-1000",
  },
  CH: {
    documentLabel: "Documento",
    documentPlaceholder: "UID: CHE-123.456.789 MWST",
    postalLabel: "PLZ",
    postalPlaceholder: "8001",
  },
  US: {
    documentLabel: "Documento",
    documentPlaceholder: "EIN: 12-3456789  ·  SSN: 000-00-0000",
    postalLabel: "ZIP Code",
    postalPlaceholder: "10001",
  },
  CA: {
    documentLabel: "Documento",
    documentPlaceholder: "BN / NE: 123456789",
    postalLabel: "Postal code",
    postalPlaceholder: "M5V 2T6",
  },
  AR: {
    documentLabel: "Documento",
    documentPlaceholder: "CUIT/CUIL: XX-12345678-X  ·  DNI: 12.345.678",
    postalLabel: "Código postal",
    postalPlaceholder: "C1001ABC",
  },
  CL: {
    documentLabel: "Documento",
    documentPlaceholder: "RUT: 12.345.678-K",
    postalLabel: "Código postal",
    postalPlaceholder: "8320000",
  },
  CO: {
    documentLabel: "Documento",
    documentPlaceholder: "NIT: 123.456.789-0  ·  CC: 1.234.567.890",
    postalLabel: "Código postal",
    postalPlaceholder: "110111",
  },
  MX: {
    documentLabel: "Documento",
    documentPlaceholder: "RFC: XXXX000000XXX",
    postalLabel: "Código postal",
    postalPlaceholder: "06600",
  },
  AO: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF: 000000000LA0000",
    postalLabel: "Código postal",
    postalPlaceholder: "",
  },
  MZ: {
    documentLabel: "Documento",
    documentPlaceholder: "NUIT: 000000000",
    postalLabel: "Código postal",
    postalPlaceholder: "",
  },
  ST: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF: 000000000",
    postalLabel: "Código postal",
    postalPlaceholder: "",
  },
  CV: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF: 000000000",
    postalLabel: "Código postal",
    postalPlaceholder: "",
  },
  GW: {
    documentLabel: "Documento",
    documentPlaceholder: "NIF / NIFU: 000000000",
    postalLabel: "Código postal",
    postalPlaceholder: "",
  },
};
const DEFAULT_COUNTRY_CONFIG: CountryBudgetConfig = {
  documentLabel: "Documento",
  documentPlaceholder: "Documento / Número de identificação fiscal",
  postalLabel: "Código postal",
  postalPlaceholder: "Código postal",
};
export function getCountryBudgetConfig(code: string | undefined | null): CountryBudgetConfig {
  if (!code) return COUNTRY_BUDGET_CONFIG.BR ?? DEFAULT_COUNTRY_CONFIG;
  return COUNTRY_BUDGET_CONFIG[code.toUpperCase()] ?? DEFAULT_COUNTRY_CONFIG;
}
const DEFAULT_CLIENT_COUNTRY = "BR";

export function emptyBudget(
  type?: BudgetType,
): Budget {
  return {
    id: `local-${uid()}`,
    number: "",
    issued_at: todayISO(),
    status: "draft",
    budget_type: type ?? ("" as any),

    client_id: "",
    client_display_id: "",
    client_name: "",
    client_phone: "",
    client_email: "",
    client_document: "",

    address_number: "",
    address_street: "",
    address_complement: "",
    address_postal: "",
    address_city: "",
    address_country: DEFAULT_CLIENT_COUNTRY,

    dossier_claim_number: "",
    dossier_expert_number: "",
    dossier_insurance_company: "",
    dossier_garage_name: "",

    vehicle_brand: "",
    vehicle_model: "",
    vehicle_plate: "",
    vehicle_vin: "",
    vehicle_year: "",
    vehicle_color: "",
    vehicle_km: "",

    intervention_type: "",
    intervention_types: [],
    diagnosis: "",
    technical_description: "",

    discount_pct: 0,
    iva_pct: 0,

    parts: [
      { id: uid(), description: "", quantity: 1, unit_price: 0 },
    ],
    services: [
      { id: uid(), description: "", quantity: 1, unit_price: 0 },
    ],
    labor: [
      { id: uid(), description: "", hours: 1, hourly_rate: 0 },
    ],

    vehicle_view_state: null,
    mechanical_selections: [],

    signature_ready: false,
    signature: emptySignature(),
    rejection: emptyRejection(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeBudgetType(
  v: string | null | undefined,
  fallback?: BudgetType,
): BudgetType | undefined {
  if (!v) return fallback;
  return (v === "mechanics" || v === "body_paint" || v === "pdr" || v === "assembly_disassembly")
    ? (v as BudgetType)
    : fallback;
}

function isValidBudgetType(v: string | null | undefined | (string & {})): v is BudgetType {
  return v === "mechanics" || v === "body_paint" || v === "pdr" || v === "assembly_disassembly";
}

export function formatBRL(v: number, currency = "EUR"): string {
  if (Number.isNaN(v)) v = 0;
  const curr = (currency || "EUR").toUpperCase();
  const locale = curr === "EUR" ? "fr-FR" : curr === "USD" ? "en-US" : "pt-BR";
  return v.toLocaleString(locale, {
    style: "currency",
    currency: curr,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const formatMoney = formatBRL;

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch {
    return String(iso);
  }
}

interface Props {
  open: boolean;
  initial?: Budget | null;
  onOpenChange: (v: boolean) => void;
  onSave: (b: Budget) => Promise<void> | void;
}

type DialogStep = "choose_type" | "form";

export function BudgetDialog({ open, initial, onOpenChange, onSave }: Props) {
  const { dbRole } = useRole();
  const isClient = dbRole === "client";
  const [form, setForm] = useState<Budget>(() => emptyBudget());
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<DialogStep>(() => {
    const bt = initial?.budget_type;
    return isValidBudgetType(bt) ? "form" : "choose_type";
  });
  const [showBackToType, setShowBackToType] = useState(false);
  const [confirmBudgetType, setConfirmBudgetType] = useState<{
    open: boolean;
    pending: BudgetType | null;
    source: "choose_step" | "form_step";
  }>({ open: false, pending: null, source: "choose_step" });
  const [intervPopoverOpen, setIntervPopoverOpen] = useState(false);
  const [intervQuery, setIntervQuery] = useState("");
  const [inspectionPoints, setInspectionPoints] = useState<DamagePointData[]>([]);

  useEffect(() => {
    const currentId = initial?.id || form.id;
    if (open && currentId) {
      apiRequest<{ inspection: any }>(`/budgets/${currentId}/inspection`)
        .then((res) => {
          if (res?.inspection?.damagePoints) {
            setInspectionPoints(
              res.inspection.damagePoints.map((p: any) => ({
                id: p.id,
                view: p.view,
                coordX: Number(p.coordX),
                coordY: Number(p.coordY),
                carPartCode: p.carPartCode,
                damageType: p.damageType,
                dentCount: p.dentCount,
                contracted: p.contracted,
                estimatedAmount: p.estimatedAmount ? Number(p.estimatedAmount) : null,
                photoStoragePath: p.photoStoragePath || p.photo_storage_path || null,
                notes: p.notes,
              }))
            );
          }
        })
        .catch(() => setInspectionPoints([]));
    } else if (open && !currentId) {
      setInspectionPoints([]);
    }
  }, [open, initial?.id, form.id]);

  const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
  const [ocrSelectedBudgetType, setOcrSelectedBudgetType] = useState<Budget["budget_type"] | null>(null);
  const [ocrIsExtracting, setOcrIsExtracting] = useState(false);
  const [ocrErrorMessage, setOcrErrorMessage] = useState<string | null>(null);
  const [ocrRateLimitedUntil, setOcrRateLimitedUntil] = useState<number | null>(null);
  const [ocrRateCountdown, setOcrRateCountdown] = useState<number>(0);
  const [ocrExtraction, setOcrExtraction] = useState<OcrBudgetExtraction | null>(null);
  const [ocrApplySelections, setOcrApplySelections] = useState<Record<string, boolean>>({});
  const [ocrDamageSelections, setOcrDamageSelections] = useState<Record<string, boolean>>({});
  const [ocrLaborSelections, setOcrLaborSelections] = useState<Record<string, boolean>>({});
  const { extract: runOcrExtract, isExtracting: _ocrLoading1 } = useExtractProductionOrder();

  const { lang } = useLanguage();
  const langDisplay = resolveInterventionDisplayLang(lang);
  const { data: catalogItems = [], isLoading: isCatalogLoading } = useServiceCatalogItems();

  const [pdfLang, setPdfLang] = useState<"pt" | "fr" | "en">(() => {
    const c = String(form.address_country || "").toUpperCase();
    if (c === "FR" || c === "FRANCE") return "fr";
    if (c === "PT" || c === "PORTUGAL" || c === "BR" || c === "BRAZIL" || c === "BRASIL") return "pt";
    return langDisplay === "fr" ? "fr" : "pt";
  });

  useEffect(() => {
    const c = String(form.address_country || "").toUpperCase();
    if (c === "FR" || c === "FRANCE") setPdfLang("fr");
    else if (c === "PT" || c === "PORTUGAL" || c === "BR" || c === "BRAZIL" || c === "BRASIL") setPdfLang("pt");
  }, [form.address_country]);

  // ─── Integração Cliente → Orçamento ───
  type BudgetClient = {
    id: string;
    kind?: "professional" | "particular";
    name: string;
    customer_display_num?: number | null;
    customer_display_id?: string | null;
    siren?: string | null;
    siret?: string | null;
    tva_intracom?: string | null;
    tax_id?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    address_complement?: string | null;
    postal_code?: string | null;
    city?: string | null;
    country?: string | null;
  };
  const { workspaceId, workspaceName, logoUrl, brandConfig } = useWorkspace();
  const qc = useQueryClient();
  const { data: clientsData } = useQuery({
    queryKey: ["clients", workspaceId],
    queryFn: async () => {
      let list: any[] = [];
      try {
        const billingData = await apiRequest<{ clients?: any[] } | any[]>("/billing/admin/ops/clients?active_only=false");
        list = Array.isArray(billingData) ? billingData : (billingData.clients ?? []);
      } catch {
        try {
          const data = await apiRequest<{ clients?: any[] } | any[]>("/clients");
          list = Array.isArray(data) ? data : (data.clients ?? []);
        } catch {
          list = [];
        }
      }
      return list.map((c: any): BudgetClient => ({
        id: c.id,
        kind: c.kind === "professional" ||
          c.kind === "company" ||
          c.legal_name ||
          c.siren ||
          c.siret
          ? "professional"
          : "particular",
        name: c.name || c.legal_name || "Cliente",
        customer_display_num:
          typeof c.customer_display_num === "number"
            ? c.customer_display_num
            : null,
        customer_display_id: c.display_code || c.displayCode || null,
        siren: c.siren || c.document || null,
        siret: c.siret || null,
        tva_intracom: c.tva_number || c.tva_intracom || null,
        tax_id: c.tax_id || null,
        email: c.email || c.contactEmail || c.contact_email || null,
        phone: c.phone || c.contactPhone || c.contact_phone || null,
        address: c.street || c.address || null,
        address_complement: c.address_complement || null,
        postal_code: c.postal_code || c.postalCode || null,
        city: c.city || null,
        country: c.country || "FR",
      }));
    },
  });
  const allClients = useMemo<BudgetClient[]>(() => clientsData ?? [], [clientsData]);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");

  const handleQuickCreateClient = async (name: string) => {
    if (!name.trim()) return;
    try {
      const res = await apiRequest<{ client: any }>("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const c = res.client;
      const formatted: BudgetClient = {
        id: c.id,
        kind: "particular",
        name: c.name,
        customer_display_num: null,
        customer_display_id: c.displayCode || c.display_code || null,
        siren: null,
        siret: null,
        tva_intracom: null,
        tax_id: null,
        email: c.contactEmail || c.contact_email || null,
        phone: c.contactPhone || c.contact_phone || null,
        address: c.address || null,
        address_complement: null,
        postal_code: null,
        city: null,
        country: null,
      };
      applyClientToBudget(formatted);
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(
        langDisplay === "fr"
          ? `Client "${name}" créé avec succès`
          : `Cliente "${name}" criado com sucesso!`
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao criar cliente.");
    }
  };
  const filteredClients = useMemo(() => {
    if (!clientSearchQuery.trim()) return allClients;
    const q = clientSearchQuery.toLowerCase();
    return allClients.filter((c) => {
      const hay = [
        c.customer_display_id,
        c.name,
        c.siren,
        c.siret,
        c.tva_intracom,
        c.tax_id,
        c.phone,
        c.email,
        c.city,
      ]
        .map((v) => (v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [allClients, clientSearchQuery]);

  const selectedClient = useMemo<BudgetClient | null | undefined>(() => {
    if (!form.client_id) return null;
    return allClients.find((c) => c.id === form.client_id) ?? null;
  }, [form.client_id, allClients]);

  const applyClientToBudget = (c: BudgetClient) => {
    if (isLocked) return;
    const fiscal = c.siret || c.siren || c.tva_intracom || c.tax_id || "";
    setFormSafe((f) => ({
      ...f,
      client_id: c.id,
      client_display_id: c.customer_display_id ?? "",
      client_name: c.name ?? "",
      client_phone: c.phone ?? "",
      client_email: c.email ?? "",
      client_document: fiscal,
      address_street: c.address ?? "",
      address_complement: c.address_complement ?? "",
      address_postal: c.postal_code ?? "",
      address_city: c.city ?? "",
      address_country: c.country ?? DEFAULT_CLIENT_COUNTRY,
      updated_at: new Date().toISOString(),
    }));
    toast.success(
      langDisplay === "fr"
        ? `Client chargé : ${c.customer_display_id ?? ""} ${c.name}`
        : `Cliente carregado: ${c.customer_display_id ?? ""} ${c.name}`,
    );
    setClientSearchOpen(false);
    setClientSearchQuery("");
  };

  const unlinkClient = () => {
    if (isLocked) return;
    setFormSafe((f) => ({
      ...f,
      client_id: "",
      client_display_id: "",
      updated_at: new Date().toISOString(),
    }));
    toast.message(langDisplay === "fr" ? "Client délié." : "Cliente desvinculado. Dados podem ser editados manualmente.");
  };
  // ──────────────────────────────────────

  const getAllowedInterventionsFor = (type: BudgetType | string | null | undefined): string[] => {
    if (!type || !isValidBudgetType(type)) return [];
    const legacyList = [...getInterventionsListFor(type, langDisplay)];
    if (!catalogItems || catalogItems.length === 0) return legacyList;
    const cats = BUDGET_TYPE_TO_CATEGORIES[String(type)] || [];
    const matched = catalogItems.filter((it) => cats.includes(it.categoryCode)).map((it) => it.name);
    return Array.from(new Set([...matched, ...legacyList]));
  };

  const interventionsCatalogue = useMemo(() => {
    if (!isValidBudgetType(form.budget_type)) return [];
    const allowed = getAllowedInterventionsFor(form.budget_type);
    const currentSelected = getBudgetInterventions(form);
    return Array.from(new Set([...allowed, ...currentSelected]));
  }, [form.budget_type, langDisplay, catalogItems, form]);

  const selectedInterventions = useMemo(() => getBudgetInterventions(form), [form]);

  const hasIncompatibleInterventions = (nextType: BudgetType): boolean => {
    if (selectedInterventions.length === 0) return false;
    const cat = getAllowedInterventionsFor(nextType);
    return !selectedInterventions.every((v) => cat.includes(v));
  };

  const changeBudgetTypeDirect = (t: BudgetType) => {
    if (isLocked) return;
    setFormSafe((f) => {
      const next = { ...f, budget_type: t, updated_at: new Date().toISOString() };
      const allowed = getAllowedInterventionsFor(t);
      setBudgetInterventions(
        (patch) => Object.assign(next, patch),
        selectedInterventions.filter((v) => allowed.includes(v)),
      );
      return next;
    });
  };

  const requestBudgetTypeChange = (t: BudgetType, source: "choose_step" | "form_step") => {
    if (isLocked) {
      toast.warning(langDisplay === "fr" ? "Devis bloqué" : "Orçamento bloqueado.");
      return;
    }
    if (t === form.budget_type) {
      if (source === "choose_step") {
        setStep("form");
        setShowBackToType(true);
      }
      return;
    }
    if (hasIncompatibleInterventions(t)) {
      setConfirmBudgetType({ open: true, pending: t, source });
    } else {
      changeBudgetTypeDirect(t);
      if (source === "choose_step") {
        setStep("form");
        setShowBackToType(true);
        toast.success(
          langDisplay === "fr"
            ? `Type de devis sélectionné : ${btLabel(t, "fr")}`
            : `Tipo de orçamento selecionado: ${btLabel(t, "pt")}`,
        );
      } else {
        toast.success(
          langDisplay === "fr"
            ? `Type de devis changé : ${btLabel(t, "fr")}`
            : `Tipo de orçamento alterado: ${btLabel(t, "pt")}`,
        );
      }
    }
  };

  const confirmBudgetTypeChange = (confirmed: boolean) => {
    if (!confirmed || confirmBudgetType.pending == null) {
      setConfirmBudgetType({ open: false, pending: null, source: "choose_step" });
      return;
    }
    const t = confirmBudgetType.pending;
    const src = confirmBudgetType.source;
    setForm((f) => {
      const next = { ...f, budget_type: t, updated_at: new Date().toISOString() };
      const allowed = getAllowedInterventionsFor(t);
      setBudgetInterventions(
        (patch) => Object.assign(next, patch),
        selectedInterventions.filter((v) => allowed.includes(v)),
      );
      return next;
    });
    if (src === "choose_step") {
      setStep("form");
      setShowBackToType(true);
    }
    toast.success(
      langDisplay === "fr"
        ? `Type de devis : ${btLabel(t, "fr")} (interventions incompatibles retirées)`
        : `Tipo de orçamento: ${btLabel(t, "pt")} (intervenções incompatíveis removidas)`,
    );
    setConfirmBudgetType({ open: false, pending: null, source: "choose_step" });
  };

  const toggleIntervention = (value: string) => {
    if (isLocked) return;
    setFormSafe((f) => {
      const current = getBudgetInterventions(f);
      const idx = current.indexOf(value);
      const next = idx >= 0 ? current.filter((v) => v !== value) : [...current, value];
      const out: Budget = { ...f, updated_at: new Date().toISOString() };
      setBudgetInterventions((patch) => Object.assign(out, patch), next);
      return out;
    });
  };

  useEffect(() => {
    if (open) {
      const base = initial ?? emptyBudget();
      const type = normalizeBudgetType(
        (base as unknown as Record<string, unknown>)?.budget_type as string | undefined,
        undefined,
      );
      const normalizedSelections: unknown[] = Array.isArray((base as any).mechanical_selections)
        ? (base as any).mechanical_selections.filter(Boolean)
        : [];
      const legacyIntervs = getBudgetInterventions(base);
      const baseServices: BudgetServiceLine[] = Array.isArray((base as any).services)
        ? ((base as any).services as BudgetServiceLine[]).filter(Boolean)
        : [{ id: uid(), description: "", quantity: 1, unit_price: 0 }];
      const baseParts: BudgetPartLine[] = Array.isArray(base.parts) && base.parts.length > 0
        ? base.parts.filter(Boolean)
        : [{ id: uid(), description: "", quantity: 1, unit_price: 0 }];
      const baseLabor: BudgetLaborLine[] = Array.isArray(base.labor) && base.labor.length > 0
        ? base.labor.filter(Boolean)
        : [{ id: uid(), description: "", hours: 1, hourly_rate: 0 }];
      const baseSignature: BudgetSignature =
        (base as any).signature && typeof (base as any).signature === "object"
          ? { ...emptySignature(), ...(base as any).signature }
          : emptySignature();
      const baseRejection: BudgetRejection =
        (base as any).rejection && typeof (base as any).rejection === "object"
          ? { ...emptyRejection(), ...(base as any).rejection }
          : emptyRejection();
      const next: Budget = {
        ...emptyBudget(type),
        ...base,
        budget_type: type ?? ("" as any),
        parts: baseParts,
        services: baseServices,
        labor: baseLabor,
        signature: baseSignature,
        rejection: baseRejection,
        address_country:
          (base as Budget).address_country ?? DEFAULT_CLIENT_COUNTRY,
        dossier_claim_number: (base as Budget).dossier_claim_number ?? "",
        dossier_expert_number: (base as Budget).dossier_expert_number ?? "",
        dossier_insurance_company: (base as Budget).dossier_insurance_company ?? "",
        dossier_garage_name: (base as Budget).dossier_garage_name ?? "",
        address_number: (base as Budget).address_number ?? "",
        address_street: (base as Budget).address_street ?? "",
        address_postal: (base as Budget).address_postal ?? "",
        address_city: (base as Budget).address_city ?? "",
        vehicle_view_state: (base as any).vehicle_view_state ?? null,
        mechanical_selections: normalizedSelections,
      };
      next.intervention_types = [...legacyIntervs];
      next.intervention_type = legacyIntervs.length > 0 ? legacyIntervs.join(", ") : "";
      if (!next.number) {
        next.number = generateBudgetNumber();
      }
      setForm(next);

      if (initial) {
        setStep("form");
        setShowBackToType(true);
      } else {
        setStep("choose_type");
        setShowBackToType(false);
      }
      setIntervQuery("");
      setIntervPopoverOpen(false);
      setConfirmBudgetType({ open: false, pending: null, source: "choose_step" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const totals = useMemo(() => {
    const parts = form.parts.reduce((sum, p) => {
      const q = Math.max(0, Number(p.quantity) || 0);
      const u = Math.max(0, Number(p.unit_price) || 0);
      const isFixed = (p as any).pricing_mode === "fixed" || (p as any).pricingMode === "fixed";
      return sum + (isFixed ? u : q * u);
    }, 0);
    const services = form.services.reduce((sum, s) => {
      const q = Math.max(0, Number(s.quantity) || 0);
      const u = Math.max(0, Number(s.unit_price) || 0);
      const isFixed = (s as any).pricing_mode === "fixed" || (s as any).pricingMode === "fixed";
      return sum + (isFixed ? u : q * u);
    }, 0);
    const labor = form.labor.reduce((sum, l) => {
      const h = Math.max(0, Number(l.hours) || 0);
      const r = Math.max(0, Number(l.hourly_rate) || 0);
      return sum + h * r;
    }, 0);
    const gross = parts + services + labor;
    const disc = (gross * Math.max(0, Math.min(100, Number(form.discount_pct) || 0))) / 100;
    const net = Math.max(0, gross - disc);
    const iva = (net * Math.max(0, Number(form.iva_pct) || 0)) / 100;
    const total = net + iva;
    return { parts, services, labor, gross, disc, net, iva, total };
  }, [form.parts, form.services, form.labor, form.discount_pct, form.iva_pct]);

  const isLocked = form.status === "approved" || form.status === "rejected";

  const handleScanFilesSelected = async (files: File[]) => {
    if (isLocked) {
      toast.error(langDisplay === "fr" ? "Devis bloqué — scan indisponible." : "Orçamento bloqueado — escanear indisponível.");
      return;
    }
    if (!files || files.length === 0) return;
    if (!ocrSelectedBudgetType) {
      setOcrErrorMessage(langDisplay === "fr"
        ? "Choisissez d'abord le type de service pour l'analyse."
        : "Selecione primeiro o tipo de serviço para a análise.");
      return;
    }
    if (ocrRateLimitedUntil && ocrRateLimitedUntil > Date.now()) {
      const secs = Math.max(1, Math.ceil((ocrRateLimitedUntil - Date.now()) / 1000));
      const msg = langDisplay === "fr"
        ? `Limite d'utilisation atteinte. Patientez ${secs}s avant de réessayer.`
        : `Limite de uso atingida. Aguarde ${secs}s antes de tentar novamente.`;
      setOcrErrorMessage(msg);
      toast.warning(msg);
      return;
    }
    const file = files[0];
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      const msg = langDisplay === "fr"
        ? `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum : 10MB. Compressez ou utilisez une image plus petite.`
        : `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 10MB. Comprima ou use uma imagem menor.`;
      setOcrErrorMessage(msg);
      toast.error(msg);
      return;
    }
    try {
      setOcrErrorMessage(null);
      setOcrRateLimitedUntil(null);
      setOcrIsExtracting(true);
      setOcrExtraction(null);
      const timeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error(
          langDisplay === "fr"
            ? "Temps d'attente dépassé. Vérifiez la connexion ou utilisez un document plus petit."
            : "Tempo esgotado. Verifique a conexão ou use um documento menor."
        )), 60000);
        return () => clearTimeout(t);
      });
      const res = await Promise.race([runOcrExtract(file), timeout]);
      const adapted = adaptProductionExtractionToBudget(res, ocrSelectedBudgetType);
      setOcrExtraction(adapted);

      const nextSelections: Record<string, boolean> = {};
      const scalarFields = [
        "technician", "docDate", "vehicle_brand", "vehicle_model", "vehicle_plate", "vehicle_vin",
        "vehicle_year", "vehicle_color", "vehicle_km", "dossier_insurance_company", "dossier_claim_number",
        "intervention_types", "diagnosis", "technical_description", "forfait_total",
        "observations", "client_name", "client_phone", "client_email",
      ];
      for (const k of scalarFields) {
        const value = (adapted as any)[k];
        if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && (typeof value !== "string" || value.trim().length > 0)) {
          const conf = adapted.field_confidence[k] ?? adapted.overall_confidence;
          nextSelections[k] = conf === "high";
        }
      }
      setOcrApplySelections(nextSelections);
      const dmgSel: Record<string, boolean> = {};
      (adapted.damage_areas ?? []).forEach((d) => { dmgSel[d.id] = d.confidence === "high"; });
      setOcrDamageSelections(dmgSel);
      const labSel: Record<string, boolean> = {};
      (adapted.labor_lines ?? []).forEach((l) => { labSel[l.id] = l.confidence === "high"; });
      setOcrLaborSelections(labSel);
      const msg = adapted.overall_confidence === "low"
        ? (langDisplay === "fr" ? "Extraction OK — faible confiance · à confirmer." : "Extração concluída — baixa confiança · confira antes de aplicar.")
        : (langDisplay === "fr" ? "Données extraites — confirmez avant application." : "Dados extraídos com sucesso · confirme antes de aplicar.");
      toast.message(msg);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err ?? "");
      const isRateLimit = /rate\s*limit|too\s*many\s*requests|429/i.test(rawMsg);
      if (isRateLimit) {
        const windowMs = 60 * 1000;
        const until = Date.now() + windowMs;
        setOcrRateLimitedUntil(until);
        const secs = Math.ceil(windowMs / 1000);
        const msg = langDisplay === "fr"
          ? `Limite d'utilisation du serveur. Réessayez dans ${secs} secondes. Trop de requêtes envoyées.`
          : `Limite de uso do servidor. Tente novamente em ${secs} segundos. Muitas requisições enviadas.`;
        setOcrErrorMessage(msg);
        toast.warning(msg);
      } else {
        const msg = err instanceof Error
          ? (langDisplay === "fr" ? `Erreur OCR : ${err.message}` : `Erro no OCR: ${err.message}`)
          : (langDisplay === "fr" ? "Erreur inconnue lors de la lecture." : "Falha desconhecida ao ler documento.");
        setOcrErrorMessage(msg);
        toast.error(msg);
      }
    } finally {
      setOcrIsExtracting(false);
    }
  };

  const confidenceTone = (c?: FieldConfidence) => {
    if (c === "high") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    if (c === "medium") return "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20";
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  };
  const confidenceLabel = (c?: FieldConfidence) => c === "high" ? "Alta" : c === "medium" ? "Média" : "Baixa / confirmar";

  const applyOcrData = () => {
    if (!ocrExtraction) return;
    if (isLocked) {
      toast.error("Orçamento bloqueado — não é possível aplicar dados.");
      return;
    }
    const sel = ocrApplySelections;
    setFormSafe((f) => {
      const next: Budget = { ...f, updated_at: new Date().toISOString() };
      const maybeSet = <K extends keyof Budget>(k: K, v: Budget[K] | undefined) => {
        if (v === undefined || v === null) return;
        if (typeof v === "string" && !v.trim()) return;
        if (Array.isArray(v) && v.length === 0) return;
        const current = next[k];
        const isEmpty =
          current === undefined || current === null ||
          (typeof current === "string" && !String(current).trim()) ||
          (Array.isArray(current) && current.length === 0) ||
          (typeof current === "number" && (Number.isNaN(current) || current === 0));
        if (!isEmpty) return;
        (next as any)[k] = v;
      };
      const budgetType = next.budget_type;

      if (sel.technician) {
        const technician = ocrExtraction.technician;
        if (technician) {
          const current = next.dossier_garage_name ?? "";
          if (!current.trim()) {
            next.dossier_garage_name = `Técnico: ${technician}`;
          }
        }
      }
      if (sel.docDate && ocrExtraction.docDate) {
        if (!next.issued_at || next.issued_at.length < 6) {
          const raw = String(ocrExtraction.docDate).replace(/\./g, "/").replace(/-/g, "/");
          const parts = raw.split("/");
          try {
            let iso: string | null = null;
            if (parts.length === 3) {
              const d = parts[0].padStart(2, "0");
              const m = parts[1].padStart(2, "0");
              let y = parts[2];
              if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
              iso = `${y}-${m}-${d}T12:00:00.000Z`;
              new Date(iso).toISOString();
            }
            if (iso) next.issued_at = iso;
          } catch {}
        }
      }
      if (sel.vehicle_brand) maybeSet("vehicle_brand", ocrExtraction.vehicle_brand);
      if (sel.vehicle_model) maybeSet("vehicle_model", ocrExtraction.vehicle_model);
      if (sel.vehicle_plate) maybeSet("vehicle_plate", ocrExtraction.vehicle_plate);
      if (sel.vehicle_vin) maybeSet("vehicle_vin", ocrExtraction.vehicle_vin);
      if (sel.vehicle_year) maybeSet("vehicle_year", ocrExtraction.vehicle_year);
      if (sel.vehicle_color) maybeSet("vehicle_color", ocrExtraction.vehicle_color);
      if (sel.vehicle_km) maybeSet("vehicle_km", ocrExtraction.vehicle_km);
      if (sel.dossier_insurance_company) maybeSet("dossier_insurance_company", ocrExtraction.dossier_insurance_company);
      if (sel.dossier_claim_number) maybeSet("dossier_claim_number", ocrExtraction.dossier_claim_number);
      if (sel.client_name) maybeSet("client_name", ocrExtraction.client_name);
      if (sel.client_phone) maybeSet("client_phone", ocrExtraction.client_phone);
      if (sel.client_email) maybeSet("client_email", ocrExtraction.client_email);
      if (sel.diagnosis) maybeSet("diagnosis", ocrExtraction.diagnosis);
      if (sel.technical_description) maybeSet("technical_description", ocrExtraction.technical_description);

      if (sel.intervention_types && Array.isArray(ocrExtraction.intervention_types) && ocrExtraction.intervention_types.length > 0) {
        const current = new Set(getBudgetInterventions(next));
        if (current.size === 0) {
          next.intervention_types = [...ocrExtraction.intervention_types];
        } else {
          const merged = Array.from(new Set([...Array.from(current), ...ocrExtraction.intervention_types]));
          next.intervention_types = merged;
        }
      }

      if (sel.forfait_total && typeof ocrExtraction.forfait_total === "number") {
        if (budgetType === "pdr") {
          const existingPartsTotal = (next.parts ?? []).reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0);
          if (existingPartsTotal <= 0 && (next.parts ?? []).length === 0 && (ocrExtraction.damage_areas ?? []).length > 0) {
            // Preservar o valor global e não dividir — injetar como linha única
            next.parts = [{
              id: crypto.randomUUID(),
              description: `Forfait global (${ocrExtraction.damage_areas!.length} áreas/danos — distribuição manual recomendada)`,
              quantity: 1,
              unit_price: Number(ocrExtraction.forfait_total.toFixed(2)),
            }];
          } else if (existingPartsTotal <= 0 && (next.parts ?? []).length === 0) {
            next.parts = [{
              id: crypto.randomUUID(),
              description: "Forfait total (informado no documento — confirmar distribuição)",
              quantity: 1,
              unit_price: Number(ocrExtraction.forfait_total.toFixed(2)),
            }];
          }
        }
      }

      const damageAreasSelected = (ocrExtraction.damage_areas ?? []).filter(d => ocrDamageSelections[d.id]);
      if (damageAreasSelected.length > 0 && budgetType === "pdr") {
        const currentIsEmpty = (next.parts ?? []).length === 0 ||
          (next.parts ?? []).every(p => !p.description.trim());
        if (currentIsEmpty) {
          next.parts = damageAreasSelected.map(d => {
            const descriptionParts: string[] = [d.areaName.trim()];
            if (d.damageType.trim()) descriptionParts.push(d.damageType.trim());
            if (d.measurements?.trim()) descriptionParts.push(`Medidas: ${d.measurements.trim()}`);
            return {
              id: d.id,
              description: descriptionParts.join(" · "),
              quantity: Math.max(1, d.quantity || 1),
              unit_price: 0,
            };
          });
        } else {
          // Anexar sem sobrescrever os existentes
          const merged = [...(next.parts ?? [])];
          for (const d of damageAreasSelected) {
            const descriptionParts: string[] = [d.areaName.trim()];
            if (d.damageType.trim()) descriptionParts.push(d.damageType.trim());
            if (d.measurements?.trim()) descriptionParts.push(`Medidas: ${d.measurements.trim()}`);
            merged.push({
              id: d.id,
              description: descriptionParts.join(" · "),
              quantity: Math.max(1, d.quantity || 1),
              unit_price: 0,
            });
          }
          next.parts = merged;
        }
      }

      const laborSelected = (ocrExtraction.labor_lines ?? []).filter(l => ocrLaborSelections[l.id]);
      if (laborSelected.length > 0) {
        if ((next.labor ?? []).length === 0) {
          next.labor = laborSelected.map(l => ({
            id: l.id,
            description: l.description,
            hours: Number(l.hours.toFixed(2)),
            hourly_rate: Number((l.hourly_rate ?? 0).toFixed(2)),
          }));
        } else {
          const merged = [...(next.labor ?? [])];
          for (const l of laborSelected) {
            merged.push({
              id: l.id,
              description: l.description,
              hours: Number(l.hours.toFixed(2)),
              hourly_rate: Number((l.hourly_rate ?? 0).toFixed(2)),
            });
          }
          next.labor = merged;
        }
      }
      return next;
    });
    toast.success("Dados do OCR aplicados (apenas campos vazios foram preenchidos).");
    setOcrDialogOpen(false);
    setOcrExtraction(null);
    setOcrApplySelections({});
    setOcrDamageSelections({});
    setOcrLaborSelections({});
  };

  const meta = (BUDGET_TYPE_META as Partial<Record<string, typeof BUDGET_TYPE_META.mechanics>>)[String(form.budget_type)] ?? BUDGET_TYPE_META.mechanics;
  const countryCfg = getCountryBudgetConfig(form.address_country ?? DEFAULT_CLIENT_COUNTRY);

  // Estados para interação (tela de assinatura, rejeição, confirmação explícita)
  const [signatureSignerName, setSignatureSignerName] = useState<string>("");
  const [signatureSignerType, setSignatureSignerType] = useState<BudgetSignerType | "">("client");
  const signatureCanvasRef = useRef<WeeklogSignatureCanvasRef | null>(null);
  const [confirmNoSignatureOpen, setConfirmNoSignatureOpen] = useState(false);
  const [confirmNoSignatureName, setConfirmNoSignatureName] = useState("");
  const [confirmNoSignatureType, setConfirmNoSignatureType] = useState<BudgetSignerType | "">("client");
  const [confirmNoSignatureChecked, setConfirmNoSignatureChecked] = useState(false);
  const [confirmRejectionOpen, setConfirmRejectionOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionRejectedBy, setRejectionRejectedBy] = useState("");
  const [sendClientDialogOpen, setSendClientDialogOpen] = useState(false);

  useEffect(() => {
    if (!signatureSignerName && form.client_name) {
      setSignatureSignerName(form.client_name);
    }
  }, [form.client_name]);

  const setSafe = <K extends keyof Budget>(k: K, v: Budget[K]) => {
    if (isLocked) return;
    setForm((f) => ({ ...f, [k]: v, updated_at: new Date().toISOString() }));
  };
  const set = setSafe;

  const setFormSafe: typeof setForm = (updater) => {
    if (isLocked) return;
    setForm(updater);
  };

  useEffect(() => {
    if (!ocrRateLimitedUntil) {
      setOcrRateCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((ocrRateLimitedUntil - Date.now()) / 1000));
      setOcrRateCountdown(remaining);
      if (remaining <= 0) {
        setOcrRateLimitedUntil(null);
        setOcrErrorMessage(null);
        toast.message(langDisplay === "fr" ? "Temps d'attente écoulé — vous pouvez réessayer." : "Tempo esgotado — pode tentar novamente.");
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [ocrRateLimitedUntil, langDisplay]);

  // Inicializa nome/signatário padrão a partir do cliente/seguradora quando abre
  useEffect(() => {
    if (open) {
      setSignatureSignerName(form.client_name || form.dossier_insurance_company || "");
      if (form.dossier_insurance_company && form.dossier_insurance_company.trim().length > 0 && !form.client_name) {
        setSignatureSignerType("insurance");
      } else {
        setSignatureSignerType("client");
      }
      setConfirmNoSignatureName(form.client_name || form.dossier_insurance_company || "");
      setConfirmNoSignatureChecked(false);
      setRejectionReason("");
      setRejectionRejectedBy("");
      signatureCanvasRef.current?.clear();
    }
  }, [open, initial?.id, form.client_name, form.dossier_insurance_company]);



  const approveWithSignature = async () => {
    if (isLocked) return;
    const name = signatureSignerName.trim() || form.client_name?.trim() || "";
    if (!name) {
      toast.warning(langDisplay === "fr" ? "Nom du signataire requis" : "Nome do signatário obrigatório.");
      return;
    }
    const resolvedSignerType = signatureSignerType || "client";
    const sigCanvas = signatureCanvasRef.current;
    if (!sigCanvas || sigCanvas.isEmpty()) {
      toast.warning(langDisplay === "fr" ? "Dessinez la signature avant d'approuver" : "Desenhe a assinatura antes de aprovar.");
      return;
    }
    const dataUrl = sigCanvas.getDataUrl();
    if (!dataUrl) {
      toast.warning(langDisplay === "fr" ? "Dessinez la signature avant d'approuver" : "Desenhe a assinatura antes de aprovar.");
      return;
    }
    const signedAt = new Date().toISOString();

    let resolvedSignatureData = dataUrl;
    if (form.id && !form.id.startsWith("local-") && dataUrl) {
      try {
        const parts = dataUrl.split(",");
        const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        const blob = new Blob([u8arr], { type: mime });
        const resPhoto = await uploadBudgetPhoto(form.id, blob, {
          category: "signature",
          caption: `Assinatura de ${name}`,
        });
        if (resPhoto.photo?.url || resPhoto.photo?.download_url) {
          resolvedSignatureData = resPhoto.photo.url || resPhoto.photo.download_url || resPhoto.photo.storagePath;
        }
      } catch (err) {
        console.warn("Upload de foto de assinatura no MinIO não concluído:", err);
      }
    }

    const finalDraft: Budget = {
      ...form,
      status: "approved",
      signature: {
        signed: true,
        signerName: name,
        signerType: resolvedSignerType,
        signedAt,
        signatureData: resolvedSignatureData,
        confirmationMethod: "DRAWN_SIGNATURE",
        budgetNumberAtMoment: form.number || null,
        finalValueAtMoment: totals.total,
      },
      updated_at: signedAt,
    };
    try {
      await onSave({ ...finalDraft, updated_at: new Date().toISOString() });
      setFormSafe(finalDraft);
      toast.success(langDisplay === "fr" ? "Devis approuvé · Bloqué" : "Orçamento aprovado com sucesso!");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || (langDisplay === "fr" ? "Échec de l'approbation." : "Falha ao aprovar o orçamento."));
    }
  };

  const approveWithExplicitConfirmation = async () => {
    if (isLocked) return;
    if (!confirmNoSignatureChecked) {
      toast.warning(langDisplay === "fr" ? "Cochez la case de confirmation" : "Marque a caixa de confirmação.");
      return;
    }
    const name = confirmNoSignatureName.trim() || signatureSignerName.trim() || form.client_name?.trim() || "";
    if (!name) {
      toast.warning(langDisplay === "fr" ? "Nom du signataire requis" : "Nome do signatário obrigatório.");
      return;
    }
    const resolvedSignerType = confirmNoSignatureType || signatureSignerType || "client";
    const signedAt = new Date().toISOString();
    const finalDraft: Budget = {
      ...form,
      status: "approved",
      signature: {
        signed: true,
        signerName: name,
        signerType: resolvedSignerType,
        signedAt,
        signatureData: null,
        confirmationMethod: "EXPLICIT_CONFIRMATION",
        budgetNumberAtMoment: form.number || null,
        finalValueAtMoment: totals.total,
      },
      updated_at: signedAt,
    };
    try {
      await onSave({ ...finalDraft, updated_at: new Date().toISOString() });
      setFormSafe(finalDraft);
      setConfirmNoSignatureOpen(false);
      setConfirmNoSignatureChecked(false);
      toast.success(langDisplay === "fr" ? "Devis approuvé · Bloqué" : "Orçamento aprovado com sucesso!");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || (langDisplay === "fr" ? "Échec de l'approbation." : "Falha ao aprovar o orçamento."));
    }
  };

  const rawPhone = (form.client_phone ?? "").trim();
  const rawEmail = (form.client_email ?? "").trim();
  const isPlaceholderPhone = (v: string) => {
    const digits = v.replace(/\D/g, "");
    if (!digits) return true;
    if (/^(\d)\1+$/.test(digits)) return true;
    if (digits.includes("9999999")) return true;
    if (/9999.*9999/.test(digits)) return true;
    if (v.replace(/\s+/g, "").toLowerCase().includes("99999")) return true;
    return false;
  };
  const isPlaceholderEmail = (v: string) => {
    const e = v.trim().toLowerCase();
    if (!e) return true;
    if (/@exemplo\./.test(e)) return true;
    if (/@example\./.test(e)) return true;
    if (/^(cliente|usuario|user|teste|test|exemplo|example)@/.test(e)) return true;
    return false;
  };
  const hasValidPhone = rawPhone.length > 0 && /\d/.test(rawPhone) && !isPlaceholderPhone(rawPhone);
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && !isPlaceholderEmail(rawEmail);
  const hasSmsConfigured = false;
  const hasAnyContact = hasValidPhone || hasValidEmail;

  const sendToClient = () => {
    if (isLocked) return;
    if (form.status === "sent") {
      toast.message(langDisplay === "fr" ? "Déjà envoyé" : "Já enviado");
      return;
    }
    if (!hasAnyContact) {
      toast.error(
        langDisplay === "fr"
          ? "Aucun canal disponible : ajoutez téléphone/WhatsApp ou e-mail."
          : "Nenhum canal disponível: adicione telefone/WhatsApp ou e-mail do cliente.",
      );
      return;
    }
    setSendClientDialogOpen(true);
  };

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleValidatePartFromBlueprint = (summary: ValidatedPartSummary) => {
    const isReplace = summary.damageType === "replace" || summary.damageType === "crack";
    const isPaint = summary.damageType === "paint_damage" || summary.damageType === "scratch";
    const materialTag = summary.materialTag ? `[${summary.materialTag}]` : "";
    const sizeText = summary.dentSizeLabel ? ` (${summary.dentSizeLabel})` : "";

    if (isReplace) {
      const desc = `Substituição - ${summary.partLabel} ${materialTag}`.trim();
      setFormSafe((prev) => {
        const existingIdx = prev.parts.findIndex((p) => p.description.includes(summary.partLabel));
        const newLine: BudgetPartLine = {
          id: uid(),
          description: desc,
          quantity: 1,
          unit_price: summary.estimatedAmount || 0,
          pricing_mode: summary.pricingMode || "fixed",
        };
        if (existingIdx >= 0) {
          const nextParts = [...prev.parts];
          nextParts[existingIdx] = { ...nextParts[existingIdx], ...newLine, id: nextParts[existingIdx].id };
          return { ...prev, parts: nextParts, updated_at: new Date().toISOString() };
        }
        return {
          ...prev,
          parts: prev.parts.some((p) => !p.description && !p.unit_price)
            ? prev.parts.map((p, idx) => (idx === 0 && !p.description ? newLine : p))
            : [...prev.parts, newLine],
          updated_at: new Date().toISOString(),
        };
      });
      toast.success(`Peça "${summary.partLabel}" vinculada à tabela de Peças/Materiais.`);
    } else {
      const isGlobal = summary.pricingMode === "global";
      const prefix = isPaint ? "Pintura" : "PDR";
      const baseDesc = isPaint
        ? `${prefix} - ${summary.partLabel} ${materialTag}`.trim()
        : `${prefix} - ${summary.partLabel} ${materialTag} — ${summary.dentCount} ${summary.dentCount === 1 ? "mossa" : "mossas"}${sizeText}`.trim();

      const desc = isGlobal ? `${baseDesc} [Conjunto Global - Incluso]` : baseDesc;
      const isFixed = summary.pricingMode === "fixed" || isGlobal;
      const newLine: BudgetServiceLine = {
        id: uid(),
        description: desc,
        quantity: isFixed ? 1 : summary.dentCount,
        unit_price: isGlobal ? 0 : (summary.estimatedAmount || 0),
        pricing_mode: summary.pricingMode || "fixed",
      };

      setFormSafe((prev) => {
        const existingIdx = prev.services.findIndex((s) => s.description.includes(summary.partLabel));
        if (existingIdx >= 0) {
          const nextServices = [...prev.services];
          nextServices[existingIdx] = { ...nextServices[existingIdx], ...newLine, id: nextServices[existingIdx].id };
          return { ...prev, services: nextServices, updated_at: new Date().toISOString() };
        }
        return {
          ...prev,
          services: prev.services.some((s) => !s.description && !s.unit_price)
            ? prev.services.map((s, idx) => (idx === 0 && !s.description ? newLine : s))
            : [...prev.services, newLine],
          updated_at: new Date().toISOString(),
        };
      });
      toast.success(`Serviço de ${prefix} para "${summary.partLabel}" vinculado ao orçamento.`);
    }
  };

  const persistCurrentState = async (closeOnFinish = false): Promise<string | null> => {
    if (saving) return null;
    setSaving(true);
    try {
      const savedRes: any = await onSave({ ...form, updated_at: new Date().toISOString() });
      const targetId =
        savedRes?.budget?.id ||
        savedRes?.id ||
        savedRes?.revision?.budgetId ||
        form.id ||
        initial?.id;

      if (targetId && !targetId.startsWith("local-")) {
        setFormSafe((prev) => ({ ...prev, id: targetId }));
        try {
          await apiRequest(`/budgets/${targetId}/inspection`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ damage_points: inspectionPoints }),
          });
        } catch (e) {
          console.error("Erro ao salvar pontos de inspeção:", e);
        }
      }

      if (closeOnFinish) {
        toast.success(langDisplay === "fr" ? "Devis enregistré avec succès." : "Orçamento salvo com sucesso.");
        onOpenChange(false);
      }
      return targetId;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar orçamento.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const triggerBudgetBlobDownload = async (): Promise<boolean> => {
    setIsGeneratingPdf(true);
    try {
      const targetId = await persistCurrentState(false);
      if (!targetId || targetId.startsWith("local-")) {
        toast.error(
          langDisplay === "fr"
            ? "Impossible d'enregistrer le devis pour générer le PDF."
            : "Não foi possível salvar o orçamento para gerar o PDF.",
        );
        return false;
      }
      const blob = await getBudgetPdf(targetId, pdfLang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Protocole_${form.number || targetId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (error: any) {
      toast.error(error?.message || (langDisplay === "fr" ? "Échec du téléchargement PDF." : "Falha ao baixar o PDF."));
      return false;
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const viewBudgetPreview = async () => {
    setIsGeneratingPdf(true);
    try {
      const isPdr =
        form.budget_type === "pdr" ||
        (form as any).budgetType === "pdr" ||
        inspectionPoints.length > 0 ||
        Boolean((form as any).vehicle_body_type) ||
        (Array.isArray((form as any).services) && (form as any).services.some((s: any) => {
          const d = String(s.description || s.name || "").toLowerCase();
          return d.includes("dsp") || d.includes("pdr") || d.includes("mossa") || d.includes("bosse") || d.includes("grele") || d.includes("granizo");
        }));

      if (isPdr) {
        // Visualização instantânea em tempo real com os dados correntes do formulário e idioma selecionado
        openBudgetPreview(form as any, pdfLang, {
          name: workspaceName,
          logoUrl: logoUrl,
          brandConfig: brandConfig,
        });
        // Salva estado em segundo plano sem interromper a visualização
        persistCurrentState(false).catch((e) => console.error("Auto-save na visualização:", e));
      } else {
        const targetId = await persistCurrentState(false);
        if (!targetId || targetId.startsWith("local-")) {
          toast.error(
            langDisplay === "fr"
              ? "Impossible d'enregistrer le devis pour l'aperçu."
              : "Não foi possível salvar o orçamento para visualização.",
          );
          return;
        }
        const blob = await getBudgetPdf(targetId, pdfLang);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error: any) {
      toast.error(error?.message || (langDisplay === "fr" ? "Impossible d'ouvrir l'aperçu." : "Não foi possível abrir a visualização."));
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const confirmSendByWhatsApp = async () => {
    setSendClientDialogOpen(false);
    if (!hasValidPhone) {
      toast.error(langDisplay === "fr" ? "Téléphone non valide" : "Telefone/WhatsApp não cadastrado.");
      return;
    }
    const downloaded = await triggerBudgetBlobDownload();
    if (!downloaded) return;

    let digits = (form.client_phone ?? "").replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) {
      digits = "33" + digits.slice(1);
    } else if (digits.length === 10 || digits.length === 11) {
      if (!digits.startsWith("55")) {
        digits = "55" + digits;
      }
    }

    let signLink = "";
    try {
      let targetId = form.id;
      if (!targetId || targetId.startsWith("local-")) {
        const savedId = await persistCurrentState(false);
        if (savedId) targetId = savedId;
      }
      if (targetId && !targetId.startsWith("local-")) {
        const linkRes = await getBudgetSignLink(targetId);
        if (linkRes?.path) {
          signLink = `${window.location.origin}${linkRes.path}`;
        }
      }
    } catch (e) {
      console.warn("Could not generate sign link for WhatsApp:", e);
    }

    const signPart = signLink
      ? (langDisplay === "fr"
          ? `\n\n✍️ Vous pouvez consulter les détails et signer directement sur votre smartphone via ce lien sécurisé :\n${signLink}`
          : `\n\n✍️ Você pode visualizar os detalhes e assinar diretamente pelo celular no link abaixo:\n${signLink}`)
      : "";

    const text = encodeURIComponent(
      (langDisplay === "fr" ? "Bonjour,\n\nVeuillez trouver votre devis n° " : "Olá,\n\nSegue seu orçamento nº ") +
      (form.number || "(sem número)") +
      (langDisplay === "fr" ? " — Montant total: " : " — Valor total: ") +
      formatMoney(totals.total, form.currency || "EUR") +
      signPart +
      (langDisplay === "fr"
        ? "\n\nLe document PDF a été téléchargé localement et est joint ci-après."
        : "\n\nO documento PDF foi baixado e está pronto para envio."),
    );
    const url = `https://wa.me/${digits}?text=${text}`;
    try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}

    try {
      if (form.id && !form.id.startsWith("local-")) {
        await markBudgetSent(form.id);
      }
      const updatedForm: Budget = {
        ...form,
        status: "sent",
        updated_at: new Date().toISOString(),
      };
      setFormSafe(updatedForm);
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success(
        langDisplay === "fr"
          ? "Statut mis à jour : Devis envoyé via WhatsApp."
          : "Status atualizado: Orçamento enviado via WhatsApp.",
      );
    } catch (e) {
      console.error("Erro ao atualizar status após WhatsApp:", e);
    }
  };

  const confirmSendByEmail = async () => {
    setSendClientDialogOpen(false);
    if (!hasValidEmail) {
      toast.error(langDisplay === "fr" ? "E-mail non valide" : "E-mail não cadastrado.");
      return;
    }

    const targetId = await persistCurrentState(false);
    if (!targetId || targetId.startsWith("local-")) {
      toast.error(
        langDisplay === "fr"
          ? "Impossible d'enregistrer le devis avant l'envoi."
          : "Não foi possível salvar o orçamento antes do envio.",
      );
      return;
    }

    try {
      await sendBudgetEmail(targetId, form.client_email || "");
      toast.success(
        langDisplay === "fr"
          ? `Devis envoyé par e-mail avec succès à ${form.client_email}.`
          : `Orçamento enviado por e-mail com sucesso para ${form.client_email}.`,
      );
      setFormSafe({ ...form, id: targetId, status: "sent", updated_at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    } catch (err: any) {
      toast.error(err?.message || (langDisplay === "fr" ? "Échec de l'envoi transactionnel." : "Falha no envio transacional do e-mail."));
    }
  };

  const copySignLink = async () => {
    try {
      let targetId = form.id;
      if (!targetId || targetId.startsWith("local-")) {
        const savedId = await persistCurrentState(false);
        if (savedId) targetId = savedId;
      }
      if (!targetId || targetId.startsWith("local-")) {
        toast.error(langDisplay === "fr" ? "Veuillez enregistrer le devis d'abord." : "Salve o orçamento primeiro.");
        return;
      }
      const res = await getBudgetSignLink(targetId);
      if (res?.path) {
        const fullUrl = `${window.location.origin}${res.path}`;
        await navigator.clipboard.writeText(fullUrl);
        toast.success(
          langDisplay === "fr"
            ? "Lien de signature copié dans le presse-papier !"
            : "Link de assinatura copiado com sucesso! Você pode colá-lo no WhatsApp ou e-mail."
        );
      }
    } catch (e: any) {
      toast.error(e?.message || (langDisplay === "fr" ? "Erreur lors de la génération du lien" : "Erro ao gerar link de assinatura"));
    }
  };

  const downloadPDF = async () => {
    const isPdr =
      form.budget_type === "pdr" ||
      (form as any).budgetType === "pdr" ||
      inspectionPoints.length > 0 ||
      Boolean((form as any).vehicle_body_type);

    if (isPdr) {
      downloadBudgetHtml(form as any, pdfLang, {
        name: workspaceName,
        logoUrl: logoUrl,
        brandConfig: brandConfig,
      });
      toast.success(langDisplay === "fr" ? "Document téléchargé." : "Documento do orçamento baixado.");
      persistCurrentState(false).catch(() => {});
      return;
    }

    const downloaded = await triggerBudgetBlobDownload();
    if (downloaded) {
      toast.success(langDisplay === "fr" ? "PDF téléchargé." : "PDF baixado.");
    }
  };

  const computeTotalsFor = (b: Budget) => {
    const p = (b.parts || []).reduce(
      (s, x) =>
        s +
        Math.max(0, Number(x?.quantity) || 0) *
          Math.max(0, Number(x?.unit_price) || 0),
      0,
    );
    const sv = Array.isArray((b as any).services)
      ? (b as any).services.reduce(
          (s: number, x: any) =>
            s +
            Math.max(0, Number(x?.quantity) || 0) *
              Math.max(0, Number(x?.unit_price) || 0),
          0,
        )
      : 0;
    const l = (b.labor || []).reduce(
      (s, x) =>
        s +
        Math.max(0, Number(x?.hours) || 0) *
          Math.max(0, Number(x?.hourly_rate) || 0),
      0,
    );
    const gross = p + sv + l;
    const disc = (gross * Math.max(0, Math.min(100, Number(b.discount_pct) || 0))) / 100;
    const net = Math.max(0, gross - disc);
    const iva = (net * Math.max(0, Number(b.iva_pct) || 0)) / 100;
    return { parts: p, services: sv, labor: l, gross, disc, net, iva, total: net + iva };
  };

  const confirmRejection = async () => {
    if (isLocked) return;
    const done = new Date().toISOString();
    const reasonText = rejectionReason.trim() || "Orçamento rejeitado pelo cliente";
    const next: Budget = {
      ...form,
      status: "rejected",
      rejection: {
        rejected: true,
        rejectedAt: done,
        rejectedBy: rejectionRejectedBy.trim().length ? rejectionRejectedBy.trim() : null,
        reason: reasonText,
      },
      updated_at: done,
    };
    setFormSafe(next);
    setConfirmRejectionOpen(false);
    try {
      await onSave({ ...next, updated_at: done });
      toast.warning(
        langDisplay === "fr" ? "Devis rejeté · Bloqué" : "Orçamento rejeitado · Bloqueado.",
      );
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao rejeitar orçamento.");
    }
  };

  const addPart = () =>
    setFormSafe((f) => ({
      ...f,
      parts: [...f.parts, { id: uid(), description: "", quantity: 1, unit_price: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const updatePart = (id: string, patch: Partial<BudgetPartLine>) =>
    setFormSafe((f) => ({
      ...f,
      parts: f.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      updated_at: new Date().toISOString(),
    }));

  const removePart = (id: string) =>
    setFormSafe((f) => ({
      ...f,
      parts: f.parts.filter((p) => p.id !== id).length
        ? f.parts.filter((p) => p.id !== id)
        : [{ id: uid(), description: "", quantity: 1, unit_price: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const addService = () =>
    setFormSafe((f) => ({
      ...f,
      services: [...f.services, { id: uid(), description: "", quantity: 1, unit_price: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const updateService = (id: string, patch: Partial<BudgetServiceLine>) =>
    setFormSafe((f) => ({
      ...f,
      services: f.services.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      updated_at: new Date().toISOString(),
    }));

  const removeService = (id: string) =>
    setFormSafe((f) => ({
      ...f,
      services: f.services.filter((s) => s.id !== id).length
        ? f.services.filter((s) => s.id !== id)
        : [{ id: uid(), description: "", quantity: 1, unit_price: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const addLabor = () =>
    setFormSafe((f) => ({
      ...f,
      labor: [...f.labor, { id: uid(), description: "", hours: 1, hourly_rate: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const updateLabor = (id: string, patch: Partial<BudgetLaborLine>) =>
    setFormSafe((f) => ({
      ...f,
      labor: f.labor.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      updated_at: new Date().toISOString(),
    }));

  const removeLabor = (id: string) =>
    setFormSafe((f) => ({
      ...f,
      labor: f.labor.filter((l) => l.id !== id).length
        ? f.labor.filter((l) => l.id !== id)
        : [{ id: uid(), description: "", hours: 1, hourly_rate: 0 }],
      updated_at: new Date().toISOString(),
    }));

  const save = async () => {
    await persistCurrentState(true);
  };

  const chooseType = (t: BudgetType) => {
    requestBudgetTypeChange(t, "choose_step");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-6xl max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            {step === "form" && showBackToType && !initial ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 -ml-2 text-muted-foreground"
                type="button"
                onClick={() => setStep("choose_type")}
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Trocar tipo
              </Button>
            ) : null}
            <CalculatorIcon className={`h-5 w-5 ${meta.dot.replace("bg-", "text-")}`} />
            <span>
              {initial
                ? langDisplay === "fr"
                  ? "Modifier le devis"
                  : "Editar Orçamento"
                : step === "choose_type"
                  ? langDisplay === "fr"
                    ? "Nouveau devis · Type"
                    : "Novo Orçamento · Tipo"
                  : langDisplay === "fr"
                    ? "Nouveau devis"
                    : "Novo Orçamento"}
            </span>
            <Badge variant="outline" className="text-xs">
              {form.number || (langDisplay === "fr" ? "Brouillon" : "Rascunho")}
            </Badge>
            {step === "form" && isValidBudgetType(form.budget_type) ? (
              <Badge variant="outline" className={`gap-1 ${meta.accent}`}>
                <meta.icon className="h-3.5 w-3.5" />
                {btLabel(form.budget_type, langDisplay)}
              </Badge>
            ) : null}
            <StatusBadge status={form.status} />
            {step === "form" && !isLocked ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 ml-2 h-8 border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setOcrSelectedBudgetType(form.budget_type || "pdr");
                  setOcrErrorMessage(null);
                  setOcrExtraction(null);
                  setOcrApplySelections({});
                  setOcrDamageSelections({});
                  setOcrLaborSelections({});
                  setOcrDialogOpen(true);
                }}
                disabled={ocrIsExtracting || _ocrLoading1}
              >
                <ScanIcon className="h-3.5 w-3.5" />
                {langDisplay === "fr" ? "Numériser document" : "Escanear documento"}
              </Button>
            ) : null}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {langDisplay === "fr"
              ? "Formulaire technique de devis avec données du client, véhicule, articles et totaux."
              : "Formulário técnico de orçamento com dados do cliente, veículo, itens e totais."}
          </DialogDescription>
        </DialogHeader>

        {isLocked ? (
          <div
            className={cn(
              "mb-3 mt-1 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
              form.status === "rejected"
                ? "bg-destructive/5 border-destructive/30 text-destructive"
                : "bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
            )}
          >
            <LockIcon className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <strong className="font-semibold">
                  {form.status === "rejected"
                    ? langDisplay === "fr"
                      ? "Devis rejeté · Bloqué en écriture"
                      : "Orçamento rejeitado · Bloqueado para edição"
                    : langDisplay === "fr"
                      ? "Devis approuvé · Bloqué en écriture"
                      : "Orçamento aprovado · Bloqueado para edição"}
                </strong>
                {form.status === "rejected" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setFormSafe((prev) => ({
                        ...prev,
                        status: "draft",
                        rejection: { rejected: false, rejectedAt: null, rejectedBy: null, reason: null },
                      }));
                      toast.info("Orçamento reaberto como rascunho para renegociação. Salve as alterações para registrar uma nova revisão.");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    {langDisplay === "fr" ? "Rouvrir / Nouvelle révision" : "Reabrir / Nova Revisão"}
                  </Button>
                )}
              </div>
              <span className="block opacity-90 mt-0.5">
                {form.status === "rejected" && form.rejection?.reason
                  ? `Motivo do descarte: ${form.rejection.reason}`
                  : langDisplay === "fr"
                    ? "Aucune modification n'est autorisée. Les valeurs financières sont figées."
                    : "Nenhuma alteração é permitida. Os valores financeiros estão congelados."}
                {form.signature.signed && form.signature.finalValueAtMoment != null
                  ? ` ${langDisplay === "fr" ? "Valeur finale approuvée :" : "Valor final aprovado:"} ${formatBRL(form.signature.finalValueAtMoment)}`
                  : ""}
              </span>
            </div>
          </div>
        ) : null}

        {form.status === "correction_needed" ? (
          <div className="mb-3 mt-1 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="font-semibold">
                {langDisplay === "fr" ? "Correction demandée par la Production" : "Correção solicitada pela Produção"}
              </strong>
              <span className="block opacity-90 mt-0.5">
                {langDisplay === "fr"
                  ? "Modifiez les données requises puis approuvez à nouveau pour renvoyer vers la Production."
                  : "Edite os dados solicitados e depois aprove novamente para reenviar à Produção."}
              </span>
            </div>
          </div>
        ) : null}

        {step === "choose_type" ? (
          <div className="space-y-5 pt-2">
            <Section title={langDisplay === "fr" ? "Type de devis" : "Tipo de Orçamento"}>
              <p className="text-xs text-muted-foreground">
                {langDisplay === "fr"
                  ? "Sélectionnez le type de devis. Ce choix définit la structure et les interventions disponibles ci-dessous."
                  : "Selecione o tipo de orçamento. Esta escolha determina a estrutura e as intervenções disponíveis abaixo."}
              </p>
              <div className="pt-2 max-w-md">
                <Select
                  value={isValidBudgetType(form.budget_type) ? form.budget_type : ""}
                  onValueChange={(v) => {
                    const t = normalizeBudgetType(v);
                    if (t) setFormSafe((f) => ({ ...f, budget_type: t as any }));
                  }}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={langDisplay === "fr" ? "Sélectionner le type de devis" : "Selecionar tipo de orçamento"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mechanics">Mecânica</SelectItem>
                    <SelectItem value="body_paint">Funilaria</SelectItem>
                    <SelectItem value="pdr">Martelinho / PDR</SelectItem>
                    <SelectItem value="assembly_disassembly">Montagem / Desmontagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Section>
            <DialogFooter className="pt-1">
              <div className="flex w-full flex-wrap justify-between gap-2">
                <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4 mr-1" /> {langDisplay === "fr" ? "Annuler" : "Cancelar"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      const t = normalizeBudgetType(form.budget_type);
                      if (t) chooseType(t);
                    }}
                    variant="default"
                    disabled={!isValidBudgetType(form.budget_type)}
                  >
                    {langDisplay === "fr" ? "Continuer" : "Continuar"}
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* TIPO DE ORÇAMENTO (Promovido para o topo do formulário) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border bg-muted/20 border-slate-700/60 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg border shadow-sm", meta.accent)}>
                  <meta.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {langDisplay === "fr" ? "Type de devis actif" : "Tipo de orçamento ativo"}
                  </div>
                  <div className="text-sm font-bold text-foreground flex items-center gap-2">
                    <span>{btLabel(form.budget_type, langDisplay)}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", meta.accent)}>
                      {form.budget_type === "pdr" ? "Baremo Pericial UT" : "Itens Comerciais"}
                    </Badge>
                  </div>
                </div>
              </div>

              {!isLocked && (
                <div className="flex items-center gap-2">
                  <Select
                    value={isValidBudgetType(form.budget_type) ? form.budget_type : "pdr"}
                    onValueChange={(v) => {
                      const t = normalizeBudgetType(v);
                      if (t) requestBudgetTypeChange(t, "form_step");
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-[200px] border-slate-700 bg-background/80">
                      <SelectValue placeholder={langDisplay === "fr" ? "Changer type de devis" : "Alterar tipo de orçamento"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdr">Martelinho / PDR</SelectItem>
                      <SelectItem value="body_paint">Funilaria e Pintura</SelectItem>
                      <SelectItem value="mechanics">Mecânica</SelectItem>
                      <SelectItem value="assembly_disassembly">Montagem / Desmontagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-slate-500" />
                  Cliente
                </span>
              }
            >
              {/* Seleção / pesquisa do cliente cadastrado */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-10">
                  <Label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                    {langDisplay === "fr" ? "Sélectionner un client" : "Selecionar cliente cadastrado"}
                    <span className="ml-2 font-sans normal-case tracking-normal text-[10px] text-slate-500">
                      (C-00001 · nome · SIREN · telefone · documento)
                    </span>
                  </Label>
                  <Popover open={clientSearchOpen} onOpenChange={setClientSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-start font-normal text-left h-10 px-3"
                        disabled={isLocked}
                      >
                        {form.client_display_id && selectedClient ? (
                          <span className="inline-flex items-center gap-2 overflow-hidden">
                            <Badge variant="outline" className="font-mono text-[10px] font-semibold text-primary border-primary/40 bg-primary/10 shrink-0">
                              {form.client_display_id}
                            </Badge>
                            <span className="truncate font-medium">{selectedClient.name}</span>
                            <span className="text-muted-foreground truncate text-[11px]">
                              {[selectedClient.phone, selectedClient.email].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground flex items-center gap-2 w-full">
                            <SearchIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {langDisplay === "fr"
                                ? "Rechercher un client (C-00001, nom, SIREN, téléphone…)"
                                : "Pesquisar cliente (C-00001, nome, SIREN, telefone…)"}
                            </span>
                          </span>
                        )}
                        <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[calc(100vw-48px)] sm:w-[640px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder={
                            langDisplay === "fr"
                              ? "Rechercher par ID, nom, SIREN, SIRET, téléphone, document…"
                              : "Pesquisar por ID, nome, SIREN, SIRET, telefone, documento…"
                          }
                          value={clientSearchQuery}
                          onValueChange={setClientSearchQuery}
                          autoFocus
                        />
                        <CommandList>
                          <CommandEmpty className="p-4 text-center">
                            <p className="text-xs text-muted-foreground mb-2">
                              {langDisplay === "fr"
                                ? "Aucun client trouvé."
                                : "Nenhum cliente encontrado."}
                            </p>
                            {clientSearchQuery.trim() ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="w-full text-xs gap-1.5"
                                onClick={() => handleQuickCreateClient(clientSearchQuery)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {langDisplay === "fr"
                                  ? `Créer le client "${clientSearchQuery.trim()}"`
                                  : `Cadastrar cliente "${clientSearchQuery.trim()}"`}
                              </Button>
                            ) : null}
                          </CommandEmpty>
                          <CommandGroup>
                            <ScrollArea className="max-h-[340px]">
                              {filteredClients.length === 0 && clientSearchQuery.trim().length === 0 ? (
                                <div className="py-6 text-center text-xs text-muted-foreground">
                                  {langDisplay === "fr"
                                    ? "Aucun client cadastré."
                                    : "Nenhum cliente cadastrado."}
                                </div>
                              ) : (
                                filteredClients.map((c) => (
                                  <CommandItem
                                    key={c.id}
                                    value={c.id}
                                    onSelect={() => applyClientToBudget(c)}
                                    className="py-2.5"
                                  >
                                    <div className="flex w-full flex-col gap-0.5">
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="font-mono text-[10px] font-semibold text-primary border-primary/30 bg-primary/10">
                                          {c.customer_display_id ?? (
                                            <span className="text-muted-foreground/70 font-normal">—</span>
                                          )}
                                        </Badge>
                                        <span className="font-medium text-sm">{c.name}</span>
                                        <Badge variant="outline" className="text-[10px] ml-auto">
                                          {c.kind === "professional"
                                            ? (langDisplay === "fr" ? "Professionnel" : "Profissional")
                                            : (langDisplay === "fr" ? "Particulier" : "Particular")}
                                        </Badge>
                                      </div>
                                      <div className="text-[11px] text-muted-foreground truncate">
                                        {[c.siret, c.siren, c.tva_intracom, c.tax_id, c.phone, c.email, c.city]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </div>
                                    </div>
                                    <CheckIcon
                                      className={cn(
                                        "ml-auto h-4 w-4 shrink-0",
                                        form.client_id === c.id ? "opacity-100 text-primary" : "opacity-0",
                                      )}
                                    />
                                  </CommandItem>
                                ))
                              )}
                            </ScrollArea>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="sm:col-span-2 flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={unlinkClient}
                    disabled={isLocked || !form.client_id}
                    className="w-full text-xs text-muted-foreground border border-dashed border-slate-600/40 hover:text-rose-400 hover:border-rose-500/50"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" />
                    {langDisplay === "fr" ? "Délier" : "Desvincular"}
                  </Button>
                </div>
              </div>

              {/* Dados do cliente: readonly se vinculado, editável legacy se não */}
              {!form.client_id && (form.client_name || form.client_phone || form.client_email || form.client_document) ? (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-amber-400 font-medium flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    {langDisplay === "fr"
                      ? "Client lié manuellement (ancien)"
                      : "Cliente preenchido manualmente (compatibilidade)"}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label={langDisplay === "fr" ? "Nom / Raison sociale" : "Nome / Razão Social"}>
                      <Input
                        placeholder="Nome completo / Empresa"
                        value={form.client_name}
                        onChange={(e) => set("client_name", e.target.value)}
                        disabled={isLocked}
                      />
                    </Field>
                    <Field label={langDisplay === "fr" ? "Téléphone" : "Telefone"}>
                      <Input
                        placeholder="(11) 9 9999-9999"
                        value={form.client_phone ?? ""}
                        onChange={(e) => set("client_phone", e.target.value)}
                        disabled={isLocked}
                      />
                    </Field>
                    <Field label={langDisplay === "fr" ? "E-mail" : "E-mail"}>
                      <Input
                        type="email"
                        placeholder="cliente@exemplo.com"
                        value={form.client_email ?? ""}
                        onChange={(e) => set("client_email", e.target.value)}
                        disabled={isLocked}
                      />
                    </Field>
                    <Field label={countryCfg.documentLabel}>
                      <Input
                        placeholder={countryCfg.documentPlaceholder}
                        value={form.client_document ?? ""}
                        onChange={(e) => set("client_document", e.target.value)}
                        disabled={isLocked}
                      />
                    </Field>
                  </div>
                </div>
              ) : form.client_id && selectedClient ? (
                <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-900/30 p-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {langDisplay === "fr" ? "Nom / Raison sociale" : "Nome / Razão Social"}
                      </div>
                      <div className="font-medium">{form.client_name || "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {langDisplay === "fr" ? "Téléphone" : "Telefone"}
                      </div>
                      <div>{form.client_phone || "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {langDisplay === "fr" ? "E-mail" : "E-mail"}
                      </div>
                      <div className="truncate">{form.client_email || "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {countryCfg.documentLabel}
                      </div>
                      <div className="font-mono text-[11px]">{form.client_document || "—"}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </Section>

            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" />
                  Endereço
                  {form.client_id && (
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground border-slate-700/50">
                      {langDisplay === "fr" ? "Lié au client" : "Vinculado ao cliente"}
                    </Badge>
                  )}
                </span>
              }
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Field label="Número">
                  <Input
                    placeholder="123"
                    value={form.address_number ?? ""}
                    onChange={(e) => set("address_number", e.target.value)}
                    disabled={isLocked || !!form.client_id}
                  />
                </Field>
                <Field label="Rua / Logradouro" className="lg:col-span-2">
                  <Input
                    placeholder="Rua, avenida, praça, travessa…"
                    value={form.address_street ?? ""}
                    onChange={(e) => set("address_street", e.target.value)}
                    disabled={isLocked || !!form.client_id}
                  />
                </Field>
                <Field label={langDisplay === "fr" ? "Complément" : "Complemento"} className="lg:col-span-1">
                  <Input
                    placeholder={langDisplay === "fr" ? "Appt, étage, lieu-dit…" : "Apto, bloco, ponto de referência…"}
                    value={form.address_complement ?? ""}
                    onChange={(e) => set("address_complement", e.target.value)}
                    disabled={isLocked || !!form.client_id}
                  />
                </Field>
                <Field label={countryCfg.postalLabel}>
                  <Input
                    placeholder={countryCfg.postalPlaceholder || "Código postal"}
                    value={form.address_postal ?? ""}
                    onChange={(e) => set("address_postal", e.target.value)}
                    disabled={isLocked || !!form.client_id}
                  />
                </Field>
                <Field label="Cidade">
                  <Input
                    placeholder="Cidade / Localidade"
                    value={form.address_city ?? ""}
                    onChange={(e) => set("address_city", e.target.value)}
                    disabled={isLocked || !!form.client_id}
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="País">
                  <Select
                    value={form.address_country ?? DEFAULT_CLIENT_COUNTRY}
                    onValueChange={(v) => set("address_country", v)}
                    disabled={isLocked || !!form.client_id}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {form.address_country ?? DEFAULT_CLIENT_COUNTRY}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>

            <Section title="Veículo">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Marca">
                  <Input
                    placeholder="Volkswagen"
                    value={form.vehicle_brand ?? ""}
                    onChange={(e) => set("vehicle_brand", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Modelo">
                  <Input
                    placeholder="Gol 1.6"
                    value={form.vehicle_model ?? ""}
                    onChange={(e) => set("vehicle_model", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Placa / Matrícula">
                  <Input
                    placeholder="ABC1D23"
                    value={form.vehicle_plate ?? ""}
                    onChange={(e) => set("vehicle_plate", e.target.value.toUpperCase())}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="VIN">
                  <Input
                    placeholder="9BW VW 375 4 T 4123456"
                    value={form.vehicle_vin ?? ""}
                    onChange={(e) => set("vehicle_vin", e.target.value.toUpperCase())}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Ano / Modelo">
                  <Input
                    placeholder="2020/2021"
                    value={form.vehicle_year ?? ""}
                    onChange={(e) => set("vehicle_year", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Cor">
                  <Input
                    placeholder="Prata"
                    value={form.vehicle_color ?? ""}
                    onChange={(e) => set("vehicle_color", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="KM atual">
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={form.vehicle_km ?? ""}
                    onChange={(e) => set("vehicle_km", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Data de emissão">
                  <Input
                    type="date"
                    value={form.issued_at}
                    onChange={(e) => set("issued_at", e.target.value || todayISO())}
                    disabled={isLocked}
                  />
                </Field>
              </div>
              <p className="pt-1 text-[11px] text-muted-foreground">
                Placa / Matrícula e VIN são opcionais. Preencha apenas se disponíveis.
              </p>
            </Section>

            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  Mapeamento Visual do Veículo & Checklist de Entrada (5 Vistas)
                </span>
              }
            >
              <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
                Clique nas vistas do veículo para mapear avarias. Identifique danos orçados (PDR) e danos pré-existentes (não cobrados) para resguardo jurídico.
              </p>
              <VehicleBlueprint5Views
                damagePoints={inspectionPoints}
                initialBodyType={((form as any).vehicle_body_type || (initial as any)?.vehicle_body_type || "sedan") as any}
                onBodyTypeChange={(newType) => {
                  set("vehicle_body_type" as any, newType);
                }}
                onValidatePart={handleValidatePartFromBlueprint}
                onChange={async (newPoints) => {
                  setInspectionPoints(newPoints);
                  const currentId = form.id || initial?.id;
                  if (currentId) {
                    try {
                      await apiRequest(`/budgets/${currentId}/inspection`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ damage_points: newPoints }),
                      });
                    } catch {}
                  }
                }}
                readOnly={isLocked}
              />
            </Section>

            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                  Dados Complementares do Dossiê
                </span>
              }
            >
              <p className="text-xs text-muted-foreground -mt-1.5 mb-3">
                Informações opcionais de sinistro, perícia, seguradora e oficina.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Nº do sinistro">
                  <Input
                    placeholder="Referência do sinistro"
                    value={form.dossier_claim_number ?? ""}
                    onChange={(e) => set("dossier_claim_number", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Nº da perícia / Expertise">
                  <Input
                    placeholder="Número da perícia / laudo"
                    value={form.dossier_expert_number ?? ""}
                    onChange={(e) => set("dossier_expert_number", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Seguradora / Empresa">
                  <Input
                    placeholder="Nome da seguradora ou empresa"
                    value={form.dossier_insurance_company ?? ""}
                    onChange={(e) => set("dossier_insurance_company", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label="Nome da oficina / Garage">
                  <Input
                    placeholder="Oficina responsável"
                    value={form.dossier_garage_name ?? ""}
                    onChange={(e) => set("dossier_garage_name", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
              </div>
            </Section>

            <Section title={langDisplay === "fr" ? "Diagnostic / Intervention" : "Diagnóstico / Intervenção"}>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
                {langDisplay === "fr"
                  ? "Informations opérationnelles, type de devis et interventions sélectionnées."
                  : "Dados operacionais, tipo de orçamento e intervenções selecionadas."}
              </p>
              <div className="mb-4">
                <Badge variant="outline" className="tabular-nums font-bold tracking-wide text-foreground px-3 py-1 border-border/70 bg-muted/20">
                  <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    {langDisplay === "fr" ? "OS" : "OS"}
                  </span>
                  <span className="align-middle">
                    {form.number || (langDisplay === "fr" ? "Brouillon" : "Rascunho")}
                  </span>
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-1">
                <Field label={langDisplay === "fr" ? "Type de devis" : "Tipo de orçamento"}>
                  <Select
                    value={isValidBudgetType(form.budget_type) ? form.budget_type : ""}
                    onValueChange={(v) => {
                      const t = normalizeBudgetType(v);
                      if (t) requestBudgetTypeChange(t, "form_step");
                    }}
                    disabled={isLocked}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder={langDisplay === "fr" ? "Sélectionner le type de devis" : "Selecionar tipo de orçamento"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BUDGET_TYPE_META) as BudgetType[]).map((k) => {
                        const m = BUDGET_TYPE_META[k];
                        return (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center gap-2">
                              <m.icon className={`h-3.5 w-3.5 ${m.dot.replace("bg-", "text-")}`} />
                              {btLabel(k, langDisplay)}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="mt-2 space-y-2">
                <Field
                  label={
                    <span className="inline-flex items-center justify-between gap-2 w-full text-xs">
                      <span>{langDisplay === "fr" ? "Type(s) d'intervention" : "Tipo(s) de Intervenção"}</span>
                      <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                        {selectedInterventions.length} {langDisplay === "fr"
                          ? "sélectionnée(s)"
                          : "selecionada(s)"}
                      </span>
                    </span>
                  }
                >
                  <div className="space-y-2">
                    <Popover
                      open={isLocked ? false : intervPopoverOpen}
                      onOpenChange={(nextOpen) => {
                        if (isLocked) return;
                        setIntervPopoverOpen(nextOpen);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={intervPopoverOpen}
                          className="w-full justify-between font-normal h-8 text-xs"
                          disabled={isLocked}
                        >
                          <span className="truncate">
                            {interventionsCatalogue.length === 0
                              ? (langDisplay === "fr"
                                ? "Chargement du catalogue…"
                                : "Carregando catálogo…")
                              : selectedInterventions.length === 0
                                ? (langDisplay === "fr"
                                  ? "Sélectionner interventions ▼"
                                  : "Selecionar intervenções ▼")
                                : (langDisplay === "fr"
                                  ? `${selectedInterventions.length} intervention(s) ▼`
                                  : `${selectedInterventions.length} intervenção(ões) ▼`)}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-60 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(calc(100vw-2rem),420px] p-0" align="start">
                        <div className="border-b p-2 px-3 py-2">
                          <div className="relative">
                            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                            <Input
                              value={intervQuery}
                              onChange={(e) => setIntervQuery(e.target.value)}
                              placeholder={
                                langDisplay === "fr"
                                  ? "Rechercher une intervention…"
                                  : "Buscar intervenção…"
                              }
                              className="pl-8 h-9"
                            />
                          </div>
                        </div>
                        <ScrollArea className="max-h-72">
                          <div className="p-2 space-y-0.5">
                            {(() => {
                              const q = intervQuery.trim().toLowerCase();
                              const list = interventionsCatalogue.filter(
                                (v) => q.length === 0 || v.toLowerCase().includes(q),
                              );
                              if (list.length === 0) {
                                return (
                                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                    {langDisplay === "fr"
                                      ? "Aucune intervention ne correspond."
                                      : "Nenhuma intervenção correspondente."}
                                  </div>
                                );
                              }
                              return list.map((opt) => {
                                  const checked = selectedInterventions.includes(opt);
                                  return (
                                    <label
                                      key={opt}
                                      className={cn(
                                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer select-none hover:bg-accent hover:text-accent-foreground transition-colors",
                                      checked ? "bg-accent/40" : "",
                                    )}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleIntervention(opt)}
                                      id={`interv-${opt}`}
                                    />
                                    <span className="text-sm leading-tight">{opt}</span>
                                    {checked ? (
                                      <CheckIcon className="ml-auto h-4 w-4 text-emerald-600" />
                                    ) : null}
                                  </label>
                                  );
                                });
                            })()}
                          </div>
                        </ScrollArea>
                        <div className="border-t p-2 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {langDisplay === "fr"
                              ? `${interventionsCatalogue.length} au total`
                              : `${interventionsCatalogue.length} no catálogo`}
                          </span>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              type="button"
                              onClick={() => {
                                setForm((f) => {
                                  const out: Budget = { ...f, updated_at: new Date().toISOString() };
                                  setBudgetInterventions(
                                    (p) => Object.assign(out, p),
                                    [],
                                  );
                                  return out;
                                });
                              }}
                              disabled={selectedInterventions.length === 0}
                              className="h-7 px-2 text-[11px]"
                            >
                              {langDisplay === "fr" ? "Effacer" : "Limpar"}
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              onClick={() => setIntervPopoverOpen(false)}
                              className="h-7 px-2 text-[11px]"
                            >
                              {langDisplay === "fr" ? "OK" : "OK"}
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    {selectedInterventions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {selectedInterventions.map((v) => (
                          <Badge
                            key={v}
                            variant="secondary"
                            className={cn(
                              "gap-1 pr-1 h-6",
                              meta.accent,
                            )}
                          >
                            <span className="text-[11px]">{v}</span>
                            <button
                              type="button"
                              onClick={() => toggleIntervention(v)}
                              disabled={isLocked}
                              className={cn(
                                "ml-0.5 rounded-full p-0.5 inline-flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-[9px] leading-none",
                                isLocked ? "opacity-40 cursor-not-allowed" : "",
                              )}
                              aria-label={`${langDisplay === "fr" ? "Retirer" : "Remover"} ${v}`}
                              title={langDisplay === "fr" ? "Retirer" : "Remover"}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground pt-0.5 leading-tight">
                        {langDisplay === "fr"
                          ? "Aucune intervention sélectionnée. Sélectionnez celles compatibles avec votre type de devis."
                          : "Nenhuma intervenção selecionada. Selecione as intervenções compatíveis com o tipo de orçamento."}
                      </p>
                    )}
                  </div>
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Field label={langDisplay === "fr" ? "Diagnostic initial" : "Diagnóstico inicial"}>
                  <Textarea
                    rows={4}
                    placeholder={
                      langDisplay === "fr"
                        ? "Rapport client / symptômes / lecture codes erreurs…"
                        : "Relato do cliente / sintomas / leitura de erros..."
                    }
                    value={form.diagnosis ?? ""}
                    onChange={(e) => set("diagnosis", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
                <Field label={langDisplay === "fr" ? "Description technique du service" : "Descrição técnica do serviço"}>
                  <Textarea
                    rows={4}
                    placeholder={
                      langDisplay === "fr"
                        ? "Décrivez en détail les services à réaliser…"
                        : "Descreva detalhadamente os serviços a serem executados..."
                    }
                    value={form.technical_description ?? ""}
                    onChange={(e) => set("technical_description", e.target.value)}
                    disabled={isLocked}
                  />
                </Field>
              </div>
            </Section>

            <Section
              title={meta.partsLabel}
              actions={
                <Button variant="ghost" size="sm" type="button" onClick={addPart} className="h-8 px-2.5" disabled={isLocked}>
                  <Plus className="h-4 w-4" />
                </Button>
              }
            >
              <Card className="border-border/50">
                <CardContent className="pt-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px] w-[44%]">
                            {form.budget_type === "pdr" ? "Área / Localização do dano" : "Descrição"}
                          </TableHead>
                          <TableHead className="w-[14%] text-right">
                            {form.budget_type === "pdr" ? "Nº amassados" : "Qtd"}
                          </TableHead>
                          <TableHead className="w-[22%] text-right">
                            {form.budget_type === "pdr" ? "Valor por dano" : "Valor Unit."}
                          </TableHead>
                          <TableHead className="w-[14%] text-right">Subtotal</TableHead>
                          <TableHead className="w-[6%]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {form.parts.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <Input
                                placeholder={
                                  form.budget_type === "mechanics"
                                    ? "Ex.: Filtro de óleo"
                                    : form.budget_type === "body_paint"
                                      ? "Ex.: Parachoque dianteiro / tinta base"
                                      : "Ex.: Porta traseira esquerda · amassado central · 3 cm"
                                }
                                value={p.description}
                                onChange={(e) => updatePart(p.id, { description: e.target.value })}
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="tabular-nums"
                                  value={String(p.quantity)}
                                  onChange={(e) =>
                                    updatePart(p.id, {
                                      quantity: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  disabled={isLocked}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={(p as any).pricing_mode === "fixed" ? "default" : "outline"}
                                  className={cn(
                                    "h-8 px-1.5 text-[10px] font-medium shrink-0",
                                    (p as any).pricing_mode === "fixed" ? "bg-cyan-700 hover:bg-cyan-600 text-white" : "text-muted-foreground"
                                  )}
                                  onClick={() =>
                                    updatePart(p.id, {
                                      pricing_mode: (p as any).pricing_mode === "fixed" ? "unit" : "fixed",
                                    } as any)
                                  }
                                  title={(p as any).pricing_mode === "fixed" ? "Modo Fixo (preço fechado)" : "Modo Unitário (multiplica qtd * unitário)"}
                                  disabled={isLocked}
                                >
                                  {(p as any).pricing_mode === "fixed" ? "Fixo" : "Unit."}
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                className="tabular-nums"
                                value={String(p.unit_price)}
                                onChange={(e) =>
                                  updatePart(p.id, {
                                    unit_price: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatBRL(
                                (p as any).pricing_mode === "fixed"
                                  ? Math.max(0, Number(p.unit_price) || 0)
                                  : Math.max(0, Number(p.quantity) || 0) * Math.max(0, Number(p.unit_price) || 0),
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                type="button"
                                onClick={() => removePart(p.id)}
                                disabled={isLocked}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3}>{meta.totalPartsLabel}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatBRL(totals.parts)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </Section>

            <Section
              title={langDisplay === "fr" ? "Services" : "Serviços"}
              actions={
                <Button variant="ghost" size="sm" type="button" onClick={addService} className="h-8 px-2.5" disabled={isLocked}>
                  <Plus className="h-4 w-4" />
                </Button>
              }
            >
              <Card className="border-border/50">
                <CardContent className="pt-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px] w-[44%]">Descrição</TableHead>
                          <TableHead className="w-[14%] text-right">Qtd</TableHead>
                          <TableHead className="w-[22%] text-right">Valor Unit.</TableHead>
                          <TableHead className="w-[14%] text-right">Subtotal</TableHead>
                          <TableHead className="w-[6%]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {form.services.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <Input
                                list={`service-catalog-dl-${s.id}`}
                                placeholder={
                                  form.budget_type === "mechanics"
                                    ? "Ex.: Diagnóstico eletrônico / Geometria"
                                    : form.budget_type === "body_paint"
                                      ? "Ex.: Pintura / Polimento / Tratamento"
                                      : "Ex.: Avaliação detalhada de áreas"
                                }
                                value={s.description}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const matched = catalogItems.find(
                                    (it) => it.name.trim().toLowerCase() === val.trim().toLowerCase(),
                                  );
                                  if (matched) {
                                    const patch: Partial<BudgetServiceLine> = {
                                      description: matched.name,
                                      catalogItemId: matched.id,
                                      catalogItemCode: matched.code,
                                      categoryCode: matched.categoryCode,
                                    };
                                    if (matched.suggestedPrice && (!s.unit_price || s.unit_price === 0)) {
                                      patch.unit_price = Number(matched.suggestedPrice);
                                    }
                                    updateService(s.id, patch);
                                  } else {
                                    updateService(s.id, { description: val });
                                  }
                                }}
                                disabled={isLocked}
                              />
                              <datalist id={`service-catalog-dl-${s.id}`}>
                                {catalogItems.map((item) => (
                                  <option key={item.id} value={item.name}>
                                    {item.categoryName ? `${item.categoryName} — ` : ""}{item.code}
                                  </option>
                                ))}
                              </datalist>
                              {s.catalogItemCode ? (
                                <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">
                                  {s.categoryCode ? `${s.categoryCode} · ` : ""}{s.catalogItemCode}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="tabular-nums"
                                  value={String(s.quantity)}
                                  onChange={(e) =>
                                    updateService(s.id, {
                                      quantity: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  disabled={isLocked}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={(s as any).pricing_mode === "fixed" ? "default" : "outline"}
                                  className={cn(
                                    "h-8 px-1.5 text-[10px] font-medium shrink-0",
                                    (s as any).pricing_mode === "fixed" ? "bg-cyan-700 hover:bg-cyan-600 text-white" : "text-muted-foreground"
                                  )}
                                  onClick={() =>
                                    updateService(s.id, {
                                      pricing_mode: (s as any).pricing_mode === "fixed" ? "unit" : "fixed",
                                    } as any)
                                  }
                                  title={(s as any).pricing_mode === "fixed" ? "Modo Fixo (preço fechado)" : "Modo Unitário (multiplica qtd * unitário)"}
                                  disabled={isLocked}
                                >
                                  {(s as any).pricing_mode === "fixed" ? "Fixo" : "Unit."}
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                className="tabular-nums"
                                value={String(s.unit_price)}
                                onChange={(e) =>
                                  updateService(s.id, {
                                    unit_price: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatBRL(
                                (s as any).pricing_mode === "fixed"
                                  ? Math.max(0, Number(s.unit_price) || 0)
                                  : Math.max(0, Number(s.quantity) || 0) * Math.max(0, Number(s.unit_price) || 0),
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                type="button"
                                onClick={() => removeService(s.id)}
                                disabled={isLocked}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3}>
                            {langDisplay === "fr" ? "Total Services" : "Total Serviços"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatBRL(totals.services)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </Section>

            <Section
              title={meta.laborLabel}
              actions={
                <Button variant="ghost" size="sm" type="button" onClick={addLabor} className="h-8 px-2.5" disabled={isLocked}>
                  <Plus className="h-4 w-4" />
                </Button>
              }
            >
              <Card className="border-border/50">
                <CardContent className="pt-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px] w-[44%]">Descrição</TableHead>
                          <TableHead className="w-[14%] text-right">Horas</TableHead>
                          <TableHead className="w-[22%] text-right">Valor / Hora</TableHead>
                          <TableHead className="w-[14%] text-right">Subtotal</TableHead>
                          <TableHead className="w-[6%]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {form.labor.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>
                              <Input
                                placeholder={
                                  form.budget_type === "mechanics"
                                    ? "Ex.: Troca de óleo e filtros"
                                    : form.budget_type === "body_paint"
                                      ? "Ex.: Desmontagem · Reparação · Primer · Pintura · Polimento"
                                      : "Ex.: Acesso forro · Aquecimento · PDR · Acabamento"
                                }
                                value={l.description}
                                onChange={(e) => updateLabor(l.id, { description: e.target.value })}
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                step={0.25}
                                className="tabular-nums"
                                value={String(l.hours)}
                                onChange={(e) =>
                                  updateLabor(l.id, {
                                    hours: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                className="tabular-nums"
                                value={String(l.hourly_rate)}
                                onChange={(e) =>
                                  updateLabor(l.id, {
                                    hourly_rate: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                disabled={isLocked}
                              />
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatBRL(
                                Math.max(0, Number(l.hours) || 0) *
                                  Math.max(0, Number(l.hourly_rate) || 0),
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                type="button"
                                onClick={() => removeLabor(l.id)}
                                disabled={isLocked}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3}>{meta.totalLaborLabel}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatBRL(totals.labor)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </Section>

            <Section title="Totais">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2 border-border/50">
                  <CardHeader className="pb-3 pt-4">
                    <CardTitle className="text-sm">Ajustes Fiscais</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Desconto (%)">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={String(form.discount_pct)}
                          onChange={(e) =>
                            set(
                              "discount_pct",
                              Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            )
                          }
                          disabled={isLocked}
                        />
                      </Field>
                      <Field label="IVA / Impostos (%)">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={String(form.iva_pct)}
                          onChange={(e) =>
                            set("iva_pct", Math.max(0, Number(e.target.value) || 0))
                          }
                          disabled={isLocked}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 rounded-lg bg-muted/40 p-3 text-sm">
                      <Row
                        label={
                          langDisplay === "fr"
                            ? "Sous-total (Pièces + Services + M.O.)"
                            : "Subtotal (Peças + Serviços + M.O.)"
                        }
                        value={formatBRL(totals.gross)}
                      />
                      <Row
                        label={`Desconto (${Number(form.discount_pct || 0).toFixed(2)}%)`}
                        value={`- ${formatBRL(totals.disc)}`}
                        muted
                      />
                      <Row label="Base Tributável" value={formatBRL(totals.net)} />
                      <Row
                        label={`IVA (${Number(form.iva_pct || 0).toFixed(2)}%)`}
                        value={`+ ${formatBRL(totals.iva)}`}
                        muted
                      />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-emerald-500/40 bg-emerald-500/5">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm">Valor Total do Orçamento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Total a pagar
                    </p>
                    <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatBRL(totals.total)}
                    </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      Valor calculado automaticamente ({meta.partsLabel} + {langDisplay === "fr" ? "Services" : "Serviços"} + {meta.laborLabel}), com desconto
                      e IVA aplicados.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </Section>

            <Section title={langDisplay === "fr" ? "Signature du Responsable" : "Assinatura do Responsável"}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{langDisplay === "fr" ? "Client / Entreprise" : "Cliente / Empresa"}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground truncate">{form.client_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{langDisplay === "fr" ? "Nº OS" : "Nº OS"}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{form.number}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{langDisplay === "fr" ? "Valeur finale" : "Valor final"}</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatBRL(totals.total)}</p>
                  </div>
                </div>

                {form.signature.signed ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div className="flex-1 space-y-2">
                        <div>
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                            {langDisplay === "fr" ? "Devis approuvé" : "Orçamento aprovado"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {langDisplay === "fr" ? "Signé par" : "Assinado por"}{" "}
                            <strong className="text-foreground">{form.signature.signerName || "—"}</strong>
                            {" · "}
                            {form.signature.signerType ? signerTypeLabel(form.signature.signerType as BudgetSignerType, langDisplay) : "—"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                            {form.signature.signedAt ? formatDateTime(form.signature.signedAt) : "—"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {form.signature.confirmationMethod === "DRAWN_SIGNATURE"
                              ? (langDisplay === "fr" ? "Méthode : signature dessinée" : "Método: assinatura desenhada")
                              : (langDisplay === "fr" ? "Méthode : confirmation explicite (sans signature)" : "Método: confirmação explícita (sem assinatura)")}
                          </p>
                        </div>
                        {form.signature.signatureData ? (
                          <div className="mt-2">
                            <div className="inline-block rounded-md border border-border bg-white p-2">
                              <img src={form.signature.signatureData} alt={langDisplay === "fr" ? "Signature" : "Assinatura"} className="h-28 max-w-[320px] object-contain" />
                            </div>
                          </div>
                        ) : null}
                        {form.rejection.rejected ? (
                          <p className="mt-1 text-[11px] text-destructive">{langDisplay === "fr" ? "Rejet enregistré également" : "Rejeição também registrada"}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : form.rejection.rejected ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white">
                        <XCircle className="h-5 w-5" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                          {langDisplay === "fr" ? "Devis rejeté" : "Orçamento rejeitado"}
                        </p>
                        {form.rejection.rejectedBy ? (
                          <p className="text-xs text-muted-foreground">
                            {langDisplay === "fr" ? "Responsable : " : "Responsável: "}
                            <strong className="text-foreground">{form.rejection.rejectedBy}</strong>
                          </p>
                        ) : null}
                        {form.rejection.rejectedAt ? (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatDateTime(form.rejection.rejectedAt)}
                          </p>
                        ) : null}
                        {form.rejection.reason ? (
                          <p className="text-xs text-muted-foreground">
                            {langDisplay === "fr" ? "Motif : " : "Motivo: "}
                            <span className="text-foreground">{form.rejection.reason}</span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={langDisplay === "fr" ? "Nom du signataire" : "Nome do signatário"}>
                        <Input
                          placeholder={langDisplay === "fr" ? "Ex.: João da Silva" : "Ex.: João da Silva"}
                          value={signatureSignerName}
                          onChange={(e) => setSignatureSignerName(e.target.value)}
                          disabled={isLocked}
                        />
                      </Field>
                      <Field label={langDisplay === "fr" ? "Type de signataire" : "Tipo de signatário"}>
                        <Select
                          value={signatureSignerType}
                          onValueChange={(v) => setSignatureSignerType(v as BudgetSignerType | "")}
                          disabled={isLocked}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SIGNER_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {langDisplay === "fr" ? opt.fr : opt.pt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {langDisplay === "fr" ? "Zone de signature (dessiner)" : "Área para assinatura (desenhar)"}
                      </p>
                      <WeeklogSignatureCanvas
                        ref={signatureCanvasRef}
                        disabled={isLocked}
                        height={160}
                        hideControls={true}
                        placeholder={langDisplay === "fr" ? "Dessinez la signature ici (tactile ou souris)" : "Desenhe a assinatura aqui (toque ou mouse)"}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => signatureCanvasRef.current?.clear()}
                          disabled={isLocked}
                          className="h-8"
                        >
                          <Eraser className="h-3.5 w-3.5" /> {langDisplay === "fr" ? "Effacer signature" : "Limpar assinatura"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={approveWithSignature}
                          disabled={isLocked}
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        >
                          <PenLine className="h-3.5 w-3.5" /> {langDisplay === "fr" ? "Signer le devis" : "Assinar orçamento"}
                        </Button>
                      </div>

                      <div className="rounded-lg border border-slate-700/60 bg-muted/40 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>
                          {langDisplay === "fr"
                            ? "L'approbation valide les conditions financières du devis et autorise le démarrage de l'ordre de réparation."
                            : "A aprovação valida as condições comerciais do orçamento e autoriza o andamento para a Ordem de Produção."}
                        </span>
                      </div>
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center" aria-hidden>
                        <div className="w-full border-t border-dashed border-border" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          {langDisplay === "fr" ? "ou validation sans signature" : "ou validação sem assinatura"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const defaultName = signatureSignerName.trim() || form.client_name?.trim() || "";
                          setConfirmNoSignatureName(defaultName);
                          setConfirmNoSignatureType(signatureSignerType || "client");
                          setConfirmNoSignatureChecked(false);
                          setConfirmNoSignatureOpen(true);
                        }}
                        disabled={isLocked}
                        className="h-9 gap-1.5 font-medium"
                      >
                        <HandPlatter className="h-4 w-4 text-amber-500" />{" "}
                        {langDisplay === "fr" ? "Confirmer sans signature" : "Confirmar sem assinatura (Aprovar)"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}

        {step === "form" ? (
          <DialogFooter className="pt-4">
            <div className="flex w-full flex-wrap justify-between gap-2">
              <div>
                <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" /> {isLocked ? (langDisplay === "fr" ? "Fermer" : "Fechar") : (langDisplay === "fr" ? "Annuler" : "Cancelar")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Seletor rápido de idioma do documento PDF (PT | FR | EN) */}
                <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-md border border-slate-700/60 h-9" title="Idioma do documento PDF emitido">
                  {(["pt", "fr", "en"] as const).map((l) => (
                    <Button
                      key={l}
                      type="button"
                      size="sm"
                      variant={pdfLang === l ? "default" : "ghost"}
                      className={cn(
                        "h-7 px-2 text-[11px] font-bold uppercase transition-all",
                        pdfLang === l && "bg-cyan-600 text-white shadow-sm"
                      )}
                      onClick={() => setPdfLang(l)}
                    >
                      {l}
                    </Button>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={viewBudgetPreview}
                  disabled={isGeneratingPdf}
                  className="h-9"
                >
                  {isGeneratingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{" "}
                  {langDisplay === "fr" ? "Aperçu PDF" : "Visualizar PDF"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadPDF}
                  disabled={isGeneratingPdf}
                  className="h-9"
                >
                  {isGeneratingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{" "}
                  {langDisplay === "fr" ? "Télécharger PDF" : "Baixar PDF"}
                </Button>
                {form.status === "rejected" ? (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => {
                      setFormSafe((prev) => ({
                        ...prev,
                        status: "draft",
                        rejection: { rejected: false, rejectedAt: null, rejectedBy: null, reason: null },
                      }));
                      toast.info("Orçamento reaberto como rascunho para renegociação. Salve as alterações para registrar uma nova revisão.");
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {langDisplay === "fr" ? "Rouvrir / Renégocier" : "Reabrir para Renegociar"}
                  </Button>
                ) : null}
                {!isLocked ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmRejectionOpen(true)}
                      className="border-red-500/40 text-red-600 hover:bg-red-500/5 hover:text-red-700"
                    >
                      <XCircle className="h-4 w-4" /> {langDisplay === "fr" ? "Rejeter le devis" : "Rejeitar orçamento"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={sendToClient}
                      disabled={form.status === "sent"}
                    >
                      <Send className="h-4 w-4" />{" "}
                      {form.status === "sent"
                        ? (langDisplay === "fr" ? "Déjà envoyé" : "Já enviado")
                        : (langDisplay === "fr" ? "Envoyer au client" : "Enviar ao cliente")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={copySignLink}
                      className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <Share2 className="h-4 w-4" />{" "}
                      {langDisplay === "fr" ? "Lien signature" : "Link p/ Assinar"}
                    </Button>
                    <Button type="button" onClick={save} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{" "}
                      {langDisplay === "fr" ? "Enregistrer le devis" : "Salvar Orçamento"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>

    <Dialog open={ocrDialogOpen} onOpenChange={(v) => { if (!ocrIsExtracting && !_ocrLoading1) setOcrDialogOpen(v); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <ScanIcon className="h-5 w-5 text-indigo-600" />
            {ocrExtraction
              ? (langDisplay === "fr" ? "Données extraites — Confirmer" : "DADOS EXTRAÍDOS — CONFIRMAR")
              : !ocrSelectedBudgetType
                ? (langDisplay === "fr" ? "Étape 1/2 — Type de service" : "Passo 1/2 — Tipo de serviço")
                : (langDisplay === "fr" ? "Étape 2/2 — Numériser document" : "Passo 2/2 — Escanear documento")}
            {ocrSelectedBudgetType ? (
              <Badge variant="outline" className={cn("ml-auto", {
                "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20": ocrSelectedBudgetType === "mechanics",
                "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20": ocrSelectedBudgetType === "body_paint",
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20": ocrSelectedBudgetType === "pdr",
                "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20": ocrSelectedBudgetType === "assembly_disassembly",
              })}>
                {btLabel(ocrSelectedBudgetType, langDisplay)}
              </Badge>
            ) : (
              <Badge variant="outline" className={`ml-auto ${meta.accent}`}>
                {btLabel(form.budget_type, langDisplay)}
              </Badge>
            )}
            {ocrExtraction ? (
              <Badge variant="outline" className={cn("ml-1", confidenceTone(ocrExtraction.overall_confidence))}>
                Confiança: {confidenceLabel(ocrExtraction.overall_confidence)}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Upload de ficha ou documento para OCR e pré-visualização dos campos antes de aplicar.
          </DialogDescription>
        </DialogHeader>

        {!ocrSelectedBudgetType && !ocrExtraction ? (
          <div className="space-y-5 py-3">
            <div className="rounded-lg border border-dashed border-indigo-400/40 bg-indigo-500/5 px-4 py-3 text-sm text-indigo-700 dark:text-indigo-300">
              <div className="flex items-start gap-2">
                <SearchIcon className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <strong className="font-semibold">
                    {langDisplay === "fr" ? "Quel type de service ?" : "Qual o tipo de serviço?"}
                  </strong>
                  <p className="mt-1 opacity-80 leading-relaxed">
                    {langDisplay === "fr"
                      ? "L'analyse OCR sera optimisée pour ce type (ex: PDR analysera les zones / dommages)."
                      : "A análise OCR será otimizada para o tipo selecionado (ex: PDR lê áreas/danos e medidas)."}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(Object.keys(BUDGET_TYPE_LABELS) as BudgetType[]).map((t) => {
                const OptIcon =
                  t === "mechanics" ? Wrench :
                  t === "body_paint" ? Palette :
                  t === "pdr" ? Hammer : BoxIcon;
                const tone =
                  t === "mechanics" ? "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20 hover:bg-slate-500/20" :
                  t === "body_paint" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20" :
                  t === "pdr" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20" :
                  "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20";
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setOcrSelectedBudgetType(t); setOcrErrorMessage(null); }}
                    className={cn(
                      "flex items-start gap-3 text-left rounded-xl border-2 p-4 transition-all",
                      tone,
                    )}
                  >
                    <span className="shrink-0 mt-0.5">
                      {OptIcon ? <OptIcon className="h-5 w-5" /> : null}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-semibold text-sm leading-tight">{btLabel(t, langDisplay)}</span>
                      <span className="text-xs opacity-75 mt-1">
                        {t === "mechanics"
                          ? (langDisplay === "fr" ? "Mécanique, diagnostics, entretien." : "Mecânica, diagnósticos, manutenção.")
                          : t === "body_paint"
                            ? (langDisplay === "fr" ? "Carrosserie, peinture, remplacement." : "Funilaria, pintura, reposição.")
                            : t === "pdr"
                              ? (langDisplay === "fr" ? "Débosselage sans peinture / zones + dommages." : "Martelinho sem pintura / áreas danos + medidas.")
                              : (langDisplay === "fr" ? "Montage, démontage, accessoires." : "Montagem, desmontagem, acessórios.")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setOcrDialogOpen(false)}>
                {langDisplay === "fr" ? "Annuler" : "Cancelar"}
              </Button>
            </DialogFooter>
          </div>
        ) : !ocrExtraction ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => { setOcrSelectedBudgetType(null); setOcrErrorMessage(null); setOcrExtraction(null); }}
                disabled={ocrIsExtracting || _ocrLoading1}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {langDisplay === "fr" ? "Changer type" : "Mudar tipo"}
              </Button>
            </div>
            {ocrRateLimitedUntil && ocrRateLimitedUntil > Date.now() ? (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 animate-pulse" />
                <div className="flex-1">
                  <strong className="font-semibold">
                    {langDisplay === "fr" ? "Limite de requêtes temporaire" : "Limite de requisições temporária"}
                  </strong>
                  <p className="mt-0.5">
                    {langDisplay === "fr"
                      ? `Serveur surchargé — patientez ${ocrRateCountdown}s avant le prochain essai.`
                      : `Servidor sobrecarregado — aguarde ${ocrRateCountdown}s antes da próxima tentativa.`}
                  </p>
                  <div className="mt-2 h-1.5 w-full bg-white/40 dark:bg-black/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-1000 ease-linear rounded-full"
                      style={{
                        width: ocrRateCountdown > 0
                          ? `${Math.max(5, Math.min(100, 100 - ((60 - ocrRateCountdown) / 60) * 100))}%`
                          : "5%",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            {ocrErrorMessage && !(ocrRateLimitedUntil && ocrRateLimitedUntil > Date.now()) ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <strong className="font-semibold">{langDisplay === "fr" ? "Erreur" : "Erro"}</strong>
                  <p className="mt-0.5">{ocrErrorMessage}</p>
                </div>
              </div>
            ) : null}
            <FileUploadZone
              onFilesSelected={handleScanFilesSelected}
              isProcessing={ocrIsExtracting || _ocrLoading1}
              disabled={ocrRateLimitedUntil != null && ocrRateLimitedUntil > Date.now()}
            />
            {ocrIsExtracting || _ocrLoading1 ? (
              <div className="rounded-lg border border-dashed border-indigo-400/40 bg-indigo-500/5 px-4 py-3 text-xs text-indigo-700 dark:text-indigo-300">
                <div className="flex items-center gap-2">
                  <SearchIcon className="h-4 w-4 animate-pulse" />
                  {langDisplay === "fr" ? "Extraction en cours… (max 60s)" : "Lendo documento com OCR… (máx 60s)"}
                </div>
                <p className="mt-2 opacity-80 leading-relaxed">
                  {langDisplay === "fr"
                    ? "Les valeurs non identifiées seront laissées vides. Une prévisualisation sera affichée avant application."
                    : "Campos não encontrados ficarão em branco. Uma prévia aparecerá antes da aplicação."}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/80 p-4 text-xs text-slate-800 dark:text-slate-100 shadow-sm">
                <div className="flex items-center gap-2 mb-2 font-semibold text-sm text-foreground">
                  <FileText className="h-4 w-4 text-cyan-500" />
                  <span>{langDisplay === "fr" ? "Comment utiliser :" : "Como funciona:"}</span>
                </div>
                <ul className="list-disc pl-5 space-y-1.5 leading-relaxed text-slate-700 dark:text-slate-200">
                  <li>{langDisplay === "fr" ? "Envoyez une photo, scan ou PDF de la fiche." : "Envie uma foto, scanner ou PDF da ficha."}</li>
                  <li>{langDisplay === "fr" ? "Les champs identifiés sont affichés avec leur niveau de confiance." : "Os campos identificados sont exibidos com nível de confiança."}</li>
                  <li>{langDisplay === "fr" ? "Confirmez / modifiez la sélection avant d'appliquer." : "Confira / ajuste a seleção ANTES de aplicar."}</li>
                  <li className="text-amber-800 dark:text-amber-300 font-medium">
                    <strong className="font-semibold">{langDisplay === "fr" ? "Règle non destructive :" : "Regra NÃO destrutiva :"}</strong>
                    {langDisplay === "fr"
                      ? " si un champ est déjà rempli dans le devis, il ne sera JAMAIS écrasé."
                      : " se um campo já está preenchido no orçamento, NUNCA é sobrescrito."}
                  </li>
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setOcrDialogOpen(false)} disabled={ocrIsExtracting || _ocrLoading1}>
                {langDisplay === "fr" ? "Annuler" : "Cancelar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/20 p-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span>
                  <strong className="font-semibold text-foreground">
                    {langDisplay === "fr" ? "Confirmez les champs à appliquer" : "Confirme os campos que deseja APLICAR"}
                  </strong>
                  {langDisplay === "fr"
                    ? " (seuls les champs vides du devis sont modifiés)."
                    : " (apenas campos VAZIOS do orçamento são preenchidos)."}
                </span>
                <div className="flex gap-1.5">
                  <Badge variant="outline" className={cn(confidenceTone("high"))}>Alta</Badge>
                  <Badge variant="outline" className={cn(confidenceTone("medium"))}>Média</Badge>
                  <Badge variant="outline" className={cn(confidenceTone("low"))}>Baixa</Badge>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">{langDisplay === "fr" ? "Client & Véhicule" : "Cliente & Veículo"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(
                  [
                    ["client_name", langDisplay === "fr" ? "Nom client" : "Nome cliente", ocrExtraction.client_name],
                    ["client_phone", langDisplay === "fr" ? "Téléphone" : "Telefone", ocrExtraction.client_phone],
                    ["client_email", langDisplay === "fr" ? "E-mail" : "E-mail", ocrExtraction.client_email],
                    ["technician", langDisplay === "fr" ? "Technicien" : "Técnico", ocrExtraction.technician],
                    ["docDate", langDisplay === "fr" ? "Date document" : "Data do documento", ocrExtraction.docDate],
                    ["vehicle_brand", langDisplay === "fr" ? "Marque" : "Marca", ocrExtraction.vehicle_brand],
                    ["vehicle_model", langDisplay === "fr" ? "Modèle" : "Modelo", ocrExtraction.vehicle_model],
                    ["vehicle_plate", langDisplay === "fr" ? "Plaque" : "Placa", ocrExtraction.vehicle_plate],
                    ["vehicle_vin", langDisplay === "fr" ? "VIN / Châssis" : "VIN / Chassi", ocrExtraction.vehicle_vin],
                    ["vehicle_year", langDisplay === "fr" ? "Année" : "Ano", ocrExtraction.vehicle_year],
                    ["vehicle_color", langDisplay === "fr" ? "Couleur" : "Cor", ocrExtraction.vehicle_color],
                    ["vehicle_km", langDisplay === "fr" ? "Kilométrage" : "KM", ocrExtraction.vehicle_km],
                  ] as Array<[string, string, any]>
                ).map(([key, label, value]) => {
                  const isEmpty = value === undefined || value === null || (typeof value === "string" && !value.trim());
                  if (isEmpty) return null;
                  const conf = ocrExtraction.field_confidence[key] ?? ocrExtraction.overall_confidence;
                  return (
                    <div key={key} className="grid grid-cols-12 items-start gap-3 border-b border-border/40 last:border-0 pb-2.5 last:pb-0">
                      <div className="col-span-1 pt-1.5">
                        <Checkbox
                          checked={!!ocrApplySelections[key]}
                          onCheckedChange={(v) => setOcrApplySelections(s => ({ ...s, [key]: !!v }))}
                        />
                      </div>
                      <div className="col-span-4 text-sm text-muted-foreground flex flex-col gap-0.5 pt-1">
                        <span>{label}</span>
                        <Badge variant="outline" className={cn("w-fit text-[10px]", confidenceTone(conf))}>
                          {confidenceLabel(conf)}
                        </Badge>
                      </div>
                      <div className="col-span-7 text-sm font-medium break-words pt-1">
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </div>
                    </div>
                  );
                })}
                {!["client_name","client_phone","client_email","technician","docDate","vehicle_brand","vehicle_model","vehicle_plate","vehicle_vin","vehicle_year","vehicle_color","vehicle_km"]
                  .some((k) => { const v = (ocrExtraction as any)[k]; return !(v === undefined || v === null || (typeof v === "string" && !v.trim())); })
                  ? (
                    <div className="text-sm text-muted-foreground italic">
                      {langDisplay === "fr" ? "Aucun champ client/véhicule détecté." : "Nenhum campo cliente/veículo identificado."}
                    </div>
                  ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">{langDisplay === "fr" ? "Sinistre, Intervention, Diagnostics" : "Seguradora, Intervenções, Diagnóstico"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(
                  [
                    ["dossier_insurance_company", langDisplay === "fr" ? "Assureur" : "Seguradora", ocrExtraction.dossier_insurance_company],
                    ["dossier_claim_number", langDisplay === "fr" ? "N° sinistre" : "Nº sinistro", ocrExtraction.dossier_claim_number],
                    ["diagnosis", langDisplay === "fr" ? "Diagnostic" : "Diagnóstico", ocrExtraction.diagnosis],
                    ["technical_description", langDisplay === "fr" ? "Description technique" : "Descrição técnica", ocrExtraction.technical_description?.slice(0, 400) + ((ocrExtraction.technical_description?.length ?? 0) > 400 ? "…" : "")],
                    ["forfait_total", langDisplay === "fr" ? "Forfait / Valeur globale" : "Forfait / valor total", ocrExtraction.forfait_total != null ? formatBRL(ocrExtraction.forfait_total) : undefined],
                  ] as Array<[string, string, any]>
                ).map(([key, label, value]) => {
                  const isEmpty = value === undefined || value === null || (typeof value === "string" && !value.trim());
                  if (isEmpty) return null;
                  const conf = ocrExtraction.field_confidence[key] ?? ocrExtraction.overall_confidence;
                  return (
                    <div key={key} className="grid grid-cols-12 items-start gap-3 border-b border-border/40 last:border-0 pb-2.5 last:pb-0">
                      <div className="col-span-1 pt-1.5">
                        <Checkbox
                          checked={!!ocrApplySelections[key]}
                          onCheckedChange={(v) => setOcrApplySelections(s => ({ ...s, [key]: !!v }))}
                        />
                      </div>
                      <div className="col-span-4 text-sm text-muted-foreground flex flex-col gap-0.5 pt-1">
                        <span>{label}</span>
                        <Badge variant="outline" className={cn("w-fit text-[10px]", confidenceTone(conf))}>
                          {confidenceLabel(conf)}
                        </Badge>
                      </div>
                      <div className="col-span-7 text-sm font-medium break-words pt-1">
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </div>
                    </div>
                  );
                })}
                {Array.isArray(ocrExtraction.intervention_types) && ocrExtraction.intervention_types.length > 0 ? (
                  <div className="grid grid-cols-12 items-start gap-3 border-t border-border/40 pt-3">
                    <div className="col-span-1 pt-1.5">
                      <Checkbox
                        checked={!!ocrApplySelections.intervention_types}
                        onCheckedChange={(v) => setOcrApplySelections(s => ({ ...s, intervention_types: !!v }))}
                      />
                    </div>
                    <div className="col-span-4 text-sm text-muted-foreground flex flex-col gap-0.5 pt-1">
                      <span>{langDisplay === "fr" ? "Interventions détectées" : "Tipos de intervenção"}</span>
                      <Badge variant="outline" className={cn("w-fit text-[10px]", confidenceTone(ocrExtraction.field_confidence.intervention_types ?? "low"))}>
                        {confidenceLabel(ocrExtraction.field_confidence.intervention_types ?? "low")}
                      </Badge>
                    </div>
                    <div className="col-span-7 flex flex-wrap gap-1.5 pt-1">
                      {ocrExtraction.intervention_types.map((iv, idx) => (
                        <Badge key={idx} variant="outline">{iv}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!["dossier_insurance_company","dossier_claim_number","diagnosis","technical_description","forfait_total","intervention_types"]
                  .some((k) => {
                    const v = (ocrExtraction as any)[k];
                    if (k === "intervention_types") return Array.isArray(v) && v.length > 0;
                    return !(v === undefined || v === null || (typeof v === "string" && !v.trim()));
                  })
                  ? (
                    <div className="text-sm text-muted-foreground italic">
                      {langDisplay === "fr" ? "Aucune donnée sinistre/intervention détectée." : "Nenhum dado de seguradora/intervenção identificado."}
                    </div>
                  ) : null}
              </CardContent>
            </Card>

            {form.budget_type === "pdr" ? (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Hammer className="h-4 w-4 text-amber-600" />
                    {langDisplay === "fr" ? "PDR · Zones / Dommages" : "PDR · Áreas / Danos"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {Array.isArray(ocrExtraction.damage_areas) && ocrExtraction.damage_areas.length > 0 ? (
                    <div className="rounded-lg border border-border/60 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>{langDisplay === "fr" ? "Zone / Localisation" : "Área / Localização"}</TableHead>
                            <TableHead>{langDisplay === "fr" ? "Type" : "Tipo dano"}</TableHead>
                            <TableHead className="text-right w-24">{langDisplay === "fr" ? "Qté" : "Qtd"}</TableHead>
                            <TableHead>{langDisplay === "fr" ? "Mesures" : "Medidas"}</TableHead>
                            <TableHead className="w-28">{langDisplay === "fr" ? "Confiance" : "Confiança"}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ocrExtraction.damage_areas.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell>
                                <Checkbox
                                  checked={!!ocrDamageSelections[d.id]}
                                  onCheckedChange={(v) => setOcrDamageSelections(s => ({ ...s, [d.id]: !!v }))}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{d.areaName}</TableCell>
                              <TableCell>{d.damageType}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.quantity}</TableCell>
                              <TableCell className="text-xs">{d.measurements ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn(confidenceTone(d.confidence))}>{confidenceLabel(d.confidence)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      {langDisplay === "fr" ? "Aucune zone / dommage PDR détecté." : "Nenhuma área/dano PDR identificado na ficha."}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {form.budget_type === "pdr" || Array.isArray(ocrExtraction.labor_lines) && ocrExtraction.labor_lines.length > 0 ? (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">{langDisplay === "fr" ? "Main d'œuvre (si explicitement indiquée)" : "Mão de Obra (apenas se EXPLICITAMENTE informada)"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {Array.isArray(ocrExtraction.labor_lines) && ocrExtraction.labor_lines.length > 0 ? (
                    <div className="rounded-lg border border-border/60 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>{langDisplay === "fr" ? "Description" : "Descrição"}</TableHead>
                            <TableHead className="text-right w-28">{langDisplay === "fr" ? "Heures" : "Horas"}</TableHead>
                            <TableHead className="text-right w-32">{langDisplay === "fr" ? "Taux €/h" : "Taxa horária"}</TableHead>
                            <TableHead className="w-28">{langDisplay === "fr" ? "Confiance" : "Confiança"}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ocrExtraction.labor_lines.map((l) => (
                            <TableRow key={l.id}>
                              <TableCell>
                                <Checkbox
                                  checked={!!ocrLaborSelections[l.id]}
                                  onCheckedChange={(v) => setOcrLaborSelections(s => ({ ...s, [l.id]: !!v }))}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{l.description}</TableCell>
                              <TableCell className="text-right tabular-nums">{l.hours.toFixed(2)}h</TableCell>
                              <TableCell className="text-right tabular-nums">{l.hourly_rate != null && l.hourly_rate > 0 ? formatBRL(l.hourly_rate) : "— (confirmar manual)"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn(confidenceTone(l.confidence))}>{confidenceLabel(l.confidence)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      {langDisplay === "fr" ? "Aucune main d'œuvre explicitement indiquée dans le document." : "Nenhuma mão de obra EXPLICITAMENTE informada no documento (NÃO foi inventada)."}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {ocrExtraction.observations && ocrExtraction.observations.trim().length > 40 ? (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">{langDisplay === "fr" ? "Texte brut / Observations (OCR)" : "Texto bruto / Observações extraídas"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea readOnly rows={6} className="text-xs font-mono" value={ocrExtraction.observations.slice(0, 1500)} />
                </CardContent>
              </Card>
            ) : null}

            <DialogFooter className="flex-wrap">
              <Button variant="outline" type="button" onClick={() => { setOcrSelectedBudgetType(null); setOcrErrorMessage(null); setOcrExtraction(null); setOcrApplySelections({}); setOcrDamageSelections({}); setOcrLaborSelections({}); }} disabled={ocrIsExtracting || _ocrLoading1}>
                {langDisplay === "fr" ? "Nouveau scan" : "Escanear outro arquivo"}
              </Button>
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" type="button" onClick={() => setOcrDialogOpen(false)} disabled={ocrIsExtracting || _ocrLoading1}>
                  {langDisplay === "fr" ? "Annuler" : "Cancelar"}
                </Button>
                <Button
                  type="button"
                  onClick={applyOcrData}
                  disabled={
                    ocrIsExtracting ||
                    _ocrLoading1 ||
                    (
                      Object.values(ocrApplySelections).every(v => !v) &&
                      Object.values(ocrDamageSelections).every(v => !v) &&
                      Object.values(ocrLaborSelections).every(v => !v)
                    )
                  }
                >
                  <CheckIcon className="h-4 w-4 mr-2" />
                  {langDisplay === "fr" ? "Appliquer données" : "Aplicar dados"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmBudgetType.open} onOpenChange={(v) => !v && confirmBudgetTypeChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {langDisplay === "fr"
              ? "Changer le type de devis ?"
              : "Alterar o tipo de orçamento?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                {langDisplay === "fr"
                  ? `Les interventions sélectionnées actuellement (${selectedInterventions.length}) peuvent ne pas être compatibles avec le type « ${btLabel(confirmBudgetType.pending ?? form.budget_type, langDisplay)} ».`
                  : `As intervenções atualmente selecionadas (${selectedInterventions.length}) podem não ser compatíveis com o tipo « ${btLabel(confirmBudgetType.pending ?? form.budget_type, langDisplay)} ».`}
              </p>
              <p className="text-muted-foreground">
                {langDisplay === "fr"
                  ? "Les interventions incompatibles seront retirées automatiquement après confirmation."
                  : "Intervenções incompatíveis serão removidas automaticamente após a confirmação."}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => confirmBudgetTypeChange(false)}>
            {langDisplay === "fr" ? "Annuler" : "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => confirmBudgetTypeChange(true)}>
            {langDisplay === "fr" ? "Continuer" : "Continuar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={sendClientDialogOpen} onOpenChange={(v) => { if (!v) setSendClientDialogOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-sky-600" />
            {langDisplay === "fr" ? "Envoyer au client" : "Enviar ao cliente"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {langDisplay === "fr"
                  ? "Choisissez un canal. Le document sera téléchargé localement et prêt à être joint dans l'application qui s'ouvrira. Aucun état « envoyé » n'est marqué tant qu'un envoi réel n'a pas été confirmé côté canal."
                  : "Escolha um canal. O documento será baixado localmente e ficará pronto para ser anexado no aplicativo que se abrirá. Nenhum status « enviado » é marcado enquanto um envio real não for confirmado no respectivo canal."}
              </p>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1zm0 5a.5.5 0 0 0 1 0v-3a.5.5 0 0 0-1 0v3zm5-5a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1zm0 5a.5.5 0 0 0 1 0v-3a.5.5 0 0 0-1 0v3z"/></svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{langDisplay === "fr" ? "WhatsApp" : "WhatsApp"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {hasValidPhone ? (form.client_phone ?? "") : (langDisplay === "fr" ? "Non disponible" : "Indisponível")}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={confirmSendByWhatsApp}
                    disabled={!hasValidPhone}
                    className="h-8"
                  >
                    {langDisplay === "fr" ? "Envoyer" : "Enviar"}
                  </Button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{langDisplay === "fr" ? "E-mail" : "E-mail"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {hasValidEmail ? (form.client_email ?? "") : (langDisplay === "fr" ? "Non disponible" : "Indisponível")}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={confirmSendByEmail}
                    disabled={!hasValidEmail}
                    className="h-8"
                  >
                    {langDisplay === "fr" ? "Envoyer" : "Enviar"}
                  </Button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                      <LinkIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {langDisplay === "fr" ? "Lien de signature (Smartphone / Client)" : "Link de Assinatura Online (Celular)"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {langDisplay === "fr" ? "Lien sécurisé pour signer directement avec le doigt" : "Link seguro para o cliente assinar na tela sem login"}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={copySignLink}
                    className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {langDisplay === "fr" ? "Copier" : "Copiar"}
                  </Button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 opacity-80">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M7 2v11"/><path d="M3 4v11"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{langDisplay === "fr" ? "SMS" : "SMS"}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {hasSmsConfigured
                          ? (hasValidPhone ? (form.client_phone ?? "") : (langDisplay === "fr" ? "Non disponible" : "Indisponível"))
                          : (langDisplay === "fr" ? "Intégration SMS non configurée" : "Integração SMS não configurada")}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!hasSmsConfigured) {
                        toast.message(langDisplay === "fr" ? "Intégration SMS non disponible." : "Integração SMS não disponível.");
                        return;
                      }
                    }}
                    disabled={!hasSmsConfigured || !hasValidPhone}
                    className="h-8"
                  >
                    {langDisplay === "fr" ? "Envoyer" : "Enviar"}
                  </Button>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setSendClientDialogOpen(false)}>
            {langDisplay === "fr" ? "Annuler" : "Cancelar"}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={confirmNoSignatureOpen} onOpenChange={(v) => { if (!v) setConfirmNoSignatureOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <HandPlatter className="h-5 w-5 text-amber-600" />
            {langDisplay === "fr" ? "Confirmer sans signature dessinée" : "Confirmar sem assinatura desenhada"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="confirm-no-signature-check"
                    checked={confirmNoSignatureChecked}
                    onCheckedChange={(c) => setConfirmNoSignatureChecked(!!c)}
                  />
                  <label htmlFor="confirm-no-signature-check" className="text-sm leading-relaxed text-foreground cursor-pointer select-none">
                    <strong>
                      {langDisplay === "fr"
                        ? "Je confirme que le devis a été présenté, revu et autorisé."
                        : "Confirmo que o orçamento foi apresentado, revisado e autorizado."}
                    </strong>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={langDisplay === "fr" ? "Nom du signataire" : "Nome do signatário"}>
                  <Input
                    placeholder={langDisplay === "fr" ? "Nom complet" : "Nome completo"}
                    value={confirmNoSignatureName}
                    onChange={(e) => setConfirmNoSignatureName(e.target.value)}
                  />
                </Field>
                <Field label={langDisplay === "fr" ? "Type de signataire" : "Tipo de signatário"}>
                  <Select value={confirmNoSignatureType} onValueChange={(v) => setConfirmNoSignatureType(v as BudgetSignerType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SIGNER_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {langDisplay === "fr" ? opt.fr : opt.pt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setConfirmNoSignatureOpen(false)}>
            {langDisplay === "fr" ? "Annuler" : "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={approveWithExplicitConfirmation}
            disabled={!confirmNoSignatureChecked || !confirmNoSignatureName.trim() || !confirmNoSignatureType}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {langDisplay === "fr" ? "Confirmer l'approbation" : "Confirmar aprovação"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={confirmRejectionOpen} onOpenChange={(v) => { if (!v) setConfirmRejectionOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            {langDisplay === "fr" ? "Rejeter le devis ?" : "Rejeitar este orçamento?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                {langDisplay === "fr"
                  ? "Êtes-vous sûr de vouloir rejeter ce devis ? Une fois rejeté, il sera verrouillé et ne pourra plus être modifié normalement."
                  : "Tem certeza que deseja rejeitar este orçamento? Uma vez rejeitado, ele ficará bloqueado e não poderá mais ser alterado normalmente."}
              </p>
              <div className="grid grid-cols-1 gap-3">
                <Field label={langDisplay === "fr" ? "Responsable du rejet" : "Responsável pela rejeição"}>
                  <Input
                    placeholder={langDisplay === "fr" ? "Nom (optionnel)" : "Nome (opcional)"}
                    value={rejectionRejectedBy}
                    onChange={(e) => setRejectionRejectedBy(e.target.value)}
                  />
                </Field>
                <Field label={langDisplay === "fr" ? "Motif du rejet" : "Motivo da rejeição"}>
                  <Textarea
                    rows={3}
                    placeholder={langDisplay === "fr" ? "Optionnel — expliquez le motif du rejet…" : "Opcional — explique o motivo da rejeição…"}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setConfirmRejectionOpen(false)}>
            {langDisplay === "fr" ? "Annuler" : "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={confirmRejection} className="bg-red-600 hover:bg-red-700 text-white">
            {langDisplay === "fr" ? "Confirmer le rejet" : "Confirmar rejeição"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function Section({
  title,
  children,
  actions,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-background p-4 md:p-5 w-full min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ label, children, className }: { label: string | React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? "text-muted-foreground" : "font-medium"}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-muted-foreground" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: BudgetStatus }) {
  const map: Record<BudgetStatus, { label: string; tone: string }> = {
    draft: { label: "Rascunho", tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
    sent: { label: "Enviado", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
    approved: {
      label: "Aprovado",
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    rejected: {
      label: "Rejeitado",
      tone: "bg-destructive/10 text-destructive",
    },
    correction_needed: {
      label: "Correção necessária",
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
  };
  const m = map[status];
  return <Badge className={m.tone}>{m.label}</Badge>;
}

export function generateBudgetNumber(): string {
  try {
    const year = new Date().getFullYear();
    const key = `os-counter-${year}`;
    const raw = localStorage.getItem(key);
    const next = (raw ? Number(raw) || 0 : 0) + 1;
    localStorage.setItem(key, String(next));
    return `OS-${year}-00-${String(next).padStart(3, "0")}`;
  } catch {
    return `OS-${new Date().getFullYear()}-TEMP-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
  }
}
