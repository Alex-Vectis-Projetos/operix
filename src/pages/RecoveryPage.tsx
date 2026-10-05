import { History } from "lucide-react";
import { ComingSoonModule } from "@/components/shared/ComingSoonModule";

export default function RecoveryPage() {
  return (
    <ComingSoonModule
      title="Centro de Recuperação"
      badge="Em breve · Fase 2"
      description="Restauração segura de entidades e registos arquivados com preservação integral de integridade referencial."
      icon={History}
      phase="Fase 2"
      plannedFeatures={[
        {
          title: "Auditoria de Entidades Arquivadas",
          description: "Visualização centralizada de itens arquivados por utilizadores autorizados com período de retenção configurável.",
        },
        {
          title: "Restauração com Integridade Relacional",
          description: "Recuperação determinística validando chaves estrangeiras ativas e evitando colisões de unicidade.",
        },
        {
          title: "Trilha de Auditoria Imutável",
          description: "Registo criptográfico de quem executou a operação de arquivamento e restauro para conformidade estrita.",
        },
        {
          title: "Políticas de Purga Automática",
          description: "Eliminação definitiva após transcurso do período legal de guarda em conformidade com as diretivas de privacidade.",
        },
      ]}
    />
  );
}
