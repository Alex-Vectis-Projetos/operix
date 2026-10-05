import { Car } from "lucide-react";
import { ComingSoonModule } from "@/components/shared/ComingSoonModule";

export default function FleetPage() {
  return (
    <ComingSoonModule
      title="Gestão de Frota"
      badge="Em breve · Fase 2"
      description="Controlo de viaturas, condutores, trajetos, abastecimentos e manutenções preventivas."
      icon={Car}
      phase="Fase 2"
      plannedFeatures={[
        {
          title: "Controlo de Viaturas & Atribuições",
          description: "Registo centralizado de veículos com rastreio de alocação a equipas operacionais e condutores autorizados.",
        },
        {
          title: "Diário de Bordo & Trajetos",
          description: "Registo e conferência de quilómetros, tempos de rota e vinculação a ordens de produção.",
        },
        {
          title: "Gestão de Combustível & Eficiência",
          description: "Lançamento de consumos e análise de eficiência energética diretamente integrada ao centro de custos.",
        },
        {
          title: "Alertas de Manutenção & Documentação",
          description: "Prazos de inspeção periódica, seguros obrigatórios e manutenções preventivas programadas.",
        },
      ]}
    />
  );
}
