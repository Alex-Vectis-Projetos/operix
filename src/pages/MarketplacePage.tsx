import { Store } from "lucide-react";
import { ComingSoonModule } from "@/components/shared/ComingSoonModule";

export default function MarketplacePage() {
  return (
    <ComingSoonModule
      title="Mercado & Equipamentos"
      badge="Em breve · Fase 2"
      description="Anúncios, aquisição e alocação de veículos, peças, serviços e equipamentos especializados."
      icon={Store}
      phase="Fase 2"
      plannedFeatures={[
        {
          title: "Catálogo de Itens & Equipamentos",
          description: "Listagem estruturada de ferramentas, veículos e componentes com filtragem por categoria e localização.",
        },
        {
          title: "Ofertas Internas & Partilha entre Polos",
          description: "Mobilização de ativos excedentes entre diferentes equipas e frentes de serviço da organização.",
        },
        {
          title: "Negociação & Vinculação a Custos",
          description: "Associação direta de despesas de aquisição ou aluguer ao centro de custo da ordem de produção.",
        },
        {
          title: "Conformidade & Histórico de Ativos",
          description: "Rastreio documental de propriedade, certificação técnica e estado de conservação do equipamento.",
        },
      ]}
    />
  );
}
