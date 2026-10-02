import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Building2, UserCheck, ArrowRight } from "lucide-react";

/**
 * Minimal landing splash.
 * Two CTAs: workspace owners create a workspace, technicians use an invite link.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-16">
      <div className="max-w-3xl w-full text-center space-y-10">
        <div className="space-y-4">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground text-2xl mx-auto">
            Q
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Operix
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            Plataforma operacional para equipas de serviço.
            Escolha como quer entrar.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            to="/onboarding/workspace"
            className="group surface-card border border-border/40 rounded-xl p-6 text-left transition-all hover:border-primary/50 hover:shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]"
          >
            <Building2 className="h-7 w-7 mb-4 text-primary" />
            <h2 className="text-lg font-semibold mb-1">Criar Workspace</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Gestores e empresas. Inclui faturação, técnicos e operações.
            </p>
            <span className="inline-flex items-center text-xs font-medium text-primary group-hover:gap-2 gap-1 transition-all">
              Começar <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <Link
            to="/auth"
            className="group surface-card border border-border/40 rounded-xl p-6 text-left transition-all hover:border-primary/50 hover:shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]"
          >
            <UserCheck className="h-7 w-7 mb-4 text-primary" />
            <h2 className="text-lg font-semibold mb-1">Sou Técnico</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Acesso por convite. Receba o link da sua workspace e entre com a sua conta.
            </p>
            <span className="inline-flex items-center text-xs font-medium text-primary group-hover:gap-2 gap-1 transition-all">
              Entrar <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </div>

        <p className="text-xs text-muted-foreground">
          24,99€ + IVA aplicável /mês &middot; Cancela quando quiseres &middot; 14 dias de avaliação
        </p>
      </div>
    </div>
  );
}
