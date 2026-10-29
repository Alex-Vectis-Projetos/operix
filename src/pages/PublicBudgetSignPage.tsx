import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Car,
  FileText,
  AlertCircle,
  Building2,
  ShieldCheck,
  PenLine,
  Eraser,
  ExternalLink,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PublicBudgetData = {
  budgetId: string;
  budgetCode: string;
  revisionId: string;
  revisionNumber: number;
  status: string;
  isApproved: boolean;
  isRejected: boolean;
  approvedAt: string | null;
  createdAt: string;
  currencyCode: string;
  grossTotal: number;
  discountTotal: number;
  taxTotal: number;
  finalTotal: number;
  client: any;
  vehicle: any;
  services: any[];
  parts: any[];
  labor: any[];
  signature: any;
  workspace: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
};

export default function PublicBudgetSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicBudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulário de assinatura
  const [signerName, setSignerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approvedSuccess, setApprovedSuccess] = useState(false);
  const [showItems, setShowItems] = useState(false);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef({ drawing: false, lastX: 0, lastY: 0, hasStroke: false });

  // Busca dados públicos do orçamento
  useEffect(() => {
    if (!token) {
      setError("Token de orçamento ausente.");
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/budgets/public-sign/${encodeURIComponent(token)}`);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.message || "Não foi possível carregar o orçamento.");
        }
        const json: PublicBudgetData = await res.json();
        setData(json);
        if (json.client?.name) {
          setSignerName(json.client.name);
        }
      } catch (err: any) {
        setError(err.message || "Link inválido ou expirado.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token]);

  // Inicializa o canvas de desenho
  const initCanvas = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cvs.clientWidth || cvs.getBoundingClientRect().width || 400;
    const cssH = 160;
    cvs.width = Math.max(1, Math.floor(cssW * dpr));
    cvs.height = Math.max(1, Math.floor(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawingRef.current.hasStroke = false;
  };

  useEffect(() => {
    if (data && !data.isApproved && !approvedSuccess) {
      const t = setTimeout(initCanvas, 150);
      return () => clearTimeout(t);
    }
  }, [data, approvedSuccess]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    if (cvs.width <= 1 || cvs.height <= 1) {
      initCanvas();
    }

    drawingRef.current.drawing = true;
    drawingRef.current.lastX = x;
    drawingRef.current.lastY = y;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#0f172a";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(x, y, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
    drawingRef.current.hasStroke = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current.drawing) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#0f172a";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(drawingRef.current.lastX, drawingRef.current.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    drawingRef.current.lastX = x;
    drawingRef.current.lastY = y;
    drawingRef.current.hasStroke = true;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    drawingRef.current.drawing = false;
  };

  const handleApprove = async () => {
    if (!token) return;
    if (!signerName.trim()) {
      alert("Por favor, digite seu nome completo para assinar.");
      return;
    }
    const cvs = canvasRef.current;
    if (!cvs || !drawingRef.current.hasStroke) {
      alert("Por favor, desenhe sua assinatura no campo indicado.");
      return;
    }

    let signatureData: string | null = null;
    try {
      signatureData = cvs.toDataURL("image/png");
    } catch {
      signatureData = null;
    }

    if (!signatureData) {
      alert("Erro ao capturar a assinatura. Tente novamente.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`/api/budgets/public-sign/${encodeURIComponent(token)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signatureData,
          signerType: "client",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Erro ao aprovar orçamento.");
      }

      setApprovedSuccess(true);
    } catch (err: any) {
      alert(err.message || "Erro ao registrar aprovação.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val: number, cur = "EUR") => {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(val);
    } catch {
      return `${val.toFixed(2)} ${cur}`;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm font-medium">Carregando detalhes do orçamento...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-3" />
          <h2 className="text-lg font-bold text-slate-900 mb-1">Acesso Indisponível</h2>
          <p className="text-sm text-slate-600 mb-4">{error || "Orçamento não encontrado."}</p>
          <p className="text-xs text-slate-400">Entre em contato com a oficina para solicitar um novo link.</p>
        </div>
      </div>
    );
  }

  const isAlreadyApproved = data.isApproved || approvedSuccess;
  const pdfUrl = `/api/budgets/public-sign/${encodeURIComponent(token!)}/pdf`;

  return (
    <div className="min-h-screen bg-slate-100/80 py-6 px-3 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* Cabeçalho da Empresa */}
        <div className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <div className="flex items-center gap-3">
            {data.workspace.logoUrl ? (
              <img
                src={data.workspace.logoUrl}
                alt={data.workspace.name}
                className="h-10 w-10 rounded-lg object-contain border border-slate-100"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-100">
                <Building2 className="h-5 w-5" />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">{data.workspace.name}</h1>
              <p className="text-xs text-slate-500">Documento Oficial de Orçamento</p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
            {data.budgetCode}
          </span>
        </div>

        {/* Resumo do Veículo e Cliente */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Veículo</span>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Car className="h-5 w-5 text-emerald-600" />
                {[data.vehicle?.brand, data.vehicle?.model].filter(Boolean).join(" ") || "Veículo não especificado"}
              </h2>
            </div>
            {data.vehicle?.plate && (
              <span className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-mono font-bold tracking-wider text-slate-800">
                {data.vehicle.plate}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
            <div>
              <span className="text-slate-400">Cliente</span>
              <p className="font-medium text-slate-800">{data.client?.name || "-"}</p>
            </div>
            <div>
              <span className="text-slate-400">Chassi (VIN)</span>
              <p className="font-mono text-slate-800">{data.vehicle?.vin || "-"}</p>
            </div>
          </div>

          {/* Destaque Financeiro */}
          <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-300">Valor Total do Serviço</p>
              <p className="text-2xl font-bold tracking-tight text-emerald-400">
                {formatCurrency(data.finalTotal, data.currencyCode)}
              </p>
            </div>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold text-white transition-colors"
            >
              <FileText className="h-4 w-4" />
              <span>Ver PDF</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>
          </div>

          {/* Acordeão de Itens */}
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowItems(!showItems)}
              className="flex w-full items-center justify-between p-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span>Detalhamento dos Serviços e Peças ({data.services.length + data.parts.length} itens)</span>
              {showItems ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showItems && (
              <div className="divide-y divide-slate-100 bg-white p-3 text-xs space-y-2">
                {data.services.length > 0 && (
                  <div>
                    <p className="font-semibold text-slate-600 mb-1">Serviços / Martelinho:</p>
                    {data.services.map((s, idx) => (
                      <div key={idx} className="flex justify-between py-1 text-slate-700">
                        <span>{s.description || s.name || `Serviço ${idx + 1}`}</span>
                        <span className="font-medium">{formatCurrency(Number(s.total || s.price || 0), data.currencyCode)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.parts.length > 0 && (
                  <div className="pt-2">
                    <p className="font-semibold text-slate-600 mb-1">Peças e Materiais:</p>
                    {data.parts.map((p, idx) => (
                      <div key={idx} className="flex justify-between py-1 text-slate-700">
                        <span>{p.description || p.name || `Peça ${idx + 1}`}</span>
                        <span className="font-medium">{formatCurrency(Number(p.total || p.price || 0), data.currencyCode)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bloco de Aprovação / Assinatura */}
        {isAlreadyApproved ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h3 className="text-lg font-bold text-emerald-950">Orçamento Aprovado!</h3>
            <p className="text-sm text-emerald-800 max-w-md mx-auto">
              A autorização dos serviços foi concluída com sucesso. A oficina já foi notificada e dará início aos procedimentos no seu veículo.
            </p>
            {data.signature?.signatureData && (
              <div className="pt-2">
                <span className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">Assinatura Registrada:</span>
                <div className="mx-auto mt-1 max-w-xs rounded-lg border border-emerald-200 bg-white p-2">
                  <img src={data.signature.signatureData} alt="Assinatura" className="max-h-24 mx-auto" />
                </div>
                {data.signature?.signerName && (
                  <p className="text-xs text-slate-600 mt-1">Signatário: <strong>{data.signature.signerName}</strong></p>
                )}
              </div>
            )}
          </div>
        ) : data.isRejected ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm text-center">
            <Lock className="mx-auto h-10 w-10 text-red-500 mb-2" />
            <h3 className="text-base font-bold text-red-900">Orçamento Recusado</h3>
            <p className="text-xs text-red-700 mt-1">Este orçamento foi marcado como recusado e não aceita mais assinaturas.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
              <PenLine className="h-5 w-5 text-emerald-600" />
              <h3>Aprovação e Assinatura Digital</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Para autorizar o início dos serviços orçados pela oficina, confirme seu nome e assine no quadro abaixo usando o dedo ou uma caneta na tela:
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Seu Nome Completo:</label>
              <Input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Ex: João da Silva"
                className="bg-slate-50 border-slate-300 text-slate-900 text-sm h-10"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700">Desenhe sua assinatura no quadro:</label>
                <button
                  type="button"
                  onClick={initCanvas}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  <span>Limpar</span>
                </button>
              </div>

              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-1 shadow-inner relative overflow-hidden">
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="block w-full cursor-crosshair touch-none select-none rounded-lg"
                  style={{ height: "160px" }}
                />
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 flex items-start gap-2 border border-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Ao clicar em <strong>Aprovar e Assinar Orçamento</strong>, você declara estar de acordo com os serviços, peças e valores descritos neste documento.
              </span>
            </div>

            <Button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Registrando aprovação...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Aprovar e Assinar Orçamento</span>
                </>
              )}
            </Button>
          </div>
        )}

        <div className="text-center text-[11px] text-slate-400 py-2">
          Documento gerenciado pela plataforma Operix · Todos os direitos reservados
        </div>
      </div>
    </div>
  );
}
