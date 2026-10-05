import type { LucideIcon } from "lucide-react";
import { Sparkles, Bot, ArrowRight, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAI } from "@/agents/ai";

interface ComingSoonModuleProps {
  title: string;
  badge?: string;
  description: string;
  icon: LucideIcon;
  plannedFeatures: {
    title: string;
    description: string;
  }[];
  phase?: string;
}

/**
 * ComingSoonModule — Standard controlled placeholder for modules
 * scheduled for post-Phase 1 homologation (Fleet, Automations, Marketplace, Recovery).
 *
 * Guarantees:
 * - Zero Supabase PostgREST requests
 * - Zero unhandled network calls / 404s
 * - Zero console functional errors
 * - Premium Operix design aesthetics
 */
export function ComingSoonModule({
  title,
  badge = "Em breve · Fase 2",
  description,
  icon: MainIcon,
  plannedFeatures,
  phase = "Fase 2",
}: ComingSoonModuleProps) {
  const navigate = useNavigate();
  const { open: openCopilot } = useAI();

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6 animate-fade-in">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <MainIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {title}
                </h1>
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs px-2.5 py-0.5">
                  {badge}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/")}
            className="text-xs"
          >
            Ir ao Dashboard
          </Button>
          <Button
            size="sm"
            onClick={() => openCopilot()}
            className="flex items-center gap-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Copiloto</span>
          </Button>
        </div>
      </div>

      {/* Grid of features */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Capacidades Planeadas ({phase})</span>
            </div>
            <CardTitle className="text-base">Módulo Integrado e Canónico</CardTitle>
            <CardDescription className="text-xs">
              Recursos arquitetados para o ecossistema Operix Express / PostgreSQL:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plannedFeatures.map((feat, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary/80 shrink-0" />
                <div>
                  <h4 className="text-xs font-semibold text-foreground">{feat.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{feat.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-wider">Governança & Homologação</span>
              </div>
              <CardTitle className="text-base">Foco na Estabilização Canónica</CardTitle>
              <CardDescription className="text-xs">
                A Fase 1 prioriza o fluxo canónico de ponta a ponta (Orçamento → Produção → Weeklog → Validação → Lista de Pagamentos → Faturação/Finanças).
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                Este módulo encontra-se em conformidade de migração para o modelo relacional unificado e será ativado na homologação subsequente sem impacto nos dados operacionais vigentes.
              </p>
              <p>
                Todas as operações financeiras e validações semanais permanecem disponíveis nos seus respetivos módulos canónicos.
              </p>
            </CardContent>
          </div>

          <div className="p-6 pt-0">
            <Button
              variant="secondary"
              className="w-full text-xs justify-between"
              onClick={() => navigate("/production")}
            >
              <span>Aceder à Produção Operacional</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
