import { Sparkles, Bot, CheckCircle2, Shield, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";
import { useAI } from "@/agents/ai";

/**
 * AIPage — Controlled placeholder for the autonomous AI orchestrator.
 * Phase 1 retains the live Copilot in the TopBar while the autonomous
 * batch orchestrator is scheduled for Phase 2 homologation.
 *
 * Guarantees:
 * - Zero Supabase requests
 * - Zero unhandled network calls
 * - Zero console functional errors
 */
export default function AIPage() {
  const { t } = useLanguage();
  const { open } = useAI();

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Operix AI
            </h1>
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs px-2.5 py-0.5">
              Em breve · Fase 2
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Orquestrador autônomo, predição de gargalos e scores operacionais automatizados.
          </p>
        </div>

        <Button
          onClick={() => open()}
          className="flex items-center gap-2 self-start sm:self-auto bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
        >
          <Bot className="h-4 w-4" />
          <span>Abrir Copiloto Ativo</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Sparkles className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Capacidades Planeadas</span>
            </div>
            <CardTitle className="text-lg">Inteligência Operacional Contínua</CardTitle>
            <CardDescription className="text-xs">
              Módulos preditivos em desenvolvimento sobre a arquitetura canônica Express / PostgreSQL:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Análise preditiva de atrasos em Ordens de Produção e identificação de gargalos.</span>
            </div>
            <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Sugestão automatizada de atribuição de técnicos com base em histórico e produtividade.</span>
            </div>
            <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Auditoria e detecção de anomalias em listas comerciais e faturamento.</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-emerald-500 mb-1">
              <Shield className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Disponível Agora</span>
            </div>
            <CardTitle className="text-lg">Operix Copilot na Barra Superior</CardTitle>
            <CardDescription className="text-xs">
              O assistente operacional conversacional já está totalmente ativo:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <p>
              Aceda ao ícone de robô no topo da aplicação para interagir com o copiloto via streaming SSE,
              verificar a integridade dos módulos e receber orientações em tempo real sobre a operação.
            </p>
            <div className="rounded-md border border-border/80 bg-background/50 p-3 text-[11px] font-mono text-muted-foreground">
              Endpoint ativo: <span className="text-foreground">POST /api/agent/chat</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
