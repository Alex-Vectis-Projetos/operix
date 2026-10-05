import { Zap } from "lucide-react";
import { ComingSoonModule } from "@/components/shared/ComingSoonModule";

export default function AutomationsPage() {
  return (
    <ComingSoonModule
      title="Motor de Automações"
      badge="Em breve · Fase 2"
      description="Gatilhos, regras condicionais e fluxos automatizados de notificação e transição de estado."
      icon={Zap}
      phase="Fase 2"
      plannedFeatures={[
        {
          title: "Gatilhos Operacionais Canónicos",
          description: "Disparo automático por eventos do ciclo de vida: aprovação de orçamentos, submissão de weeklogs e liquidação de listas.",
        },
        {
          title: "Ações & Encaminhamentos",
          description: "Envio de notificações multicanal, geração de tarefas e despachos sem intervenção manual repetitiva.",
        },
        {
          title: "Auditoria de Execução & Dead Letter Queue",
          description: "Rastreio detalhado de cada execução com recuperação determinística de falhas em ambiente isolado.",
        },
        {
          title: "Integrações via Webhook Seguro",
          description: "Notificação de sistemas externos com assinaturas criptográficas e controlo de taxa por workspace.",
        },
      ]}
    />
  );
}
