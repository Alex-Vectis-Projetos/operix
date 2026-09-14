# Operix — Glossário de Domínio (Linguagem Ubíqua)

Este glossário estabelece o significado inequívoco dos termos de negócio, evitando desvios conceituais entre desenvolvedores, agentes de IA e partes interessadas.

---

| Termo em Português | Termo Técnico / Modelo | Definição Canônica | O que NÃO é |
|---|---|---|---|
| **Workspace (Empresa)** | `Workspace` | Unidade corporativa multi-tenant que agrupa técnicos, clientes, ordens e relatórios. | Não é o usuário físico. Um usuário pode pertencer a múltiplos workspaces. |
| **Técnico Independente** | `Person (scope: personal)` | Profissional autônomo que executa serviços diretamente para clientes finais, sem vínculo corporativo intermediador. | Não é um funcionário subordinado a uma oficina. |
| **Técnico Vinculado** | `Membership (role: technician)` | Colaborador ou prestador que atua sob a gestão de um Workspace específico. | Não tem acesso às métricas financeiras consolidadas da empresa contratante. |
| **Cliente Operacional** | `Client` | Pessoa jurídica ou física contratante dos serviços de reparação (frotista, concessionária, seguradora). | Não deve ser confundido com a conta de autenticação `User`. |
| **Orçamento (Budget)** | `Budget` / `BudgetRevision` | Levantamento técnico inicial de danos no veículo, cálculo estimado de peças/mão de obra e registro de fotos. | Não deve ficar salvo em `localStorage` ou apenas no campo `notes`. |
| **Ordem de Produção (OP)** | `ProductionOrder` | Trabalho em execução na oficina física ou em operação móvel de campo. | Não é a consolidação financeira final. |
| **WEEKLOG** | `ServiceOrder` (legado) / `Weeklog` | Registro do trabalho efetivamente **executado** agrupado por semana operacional. | **NÃO é a Lista de Pagamento**. Representa o esforço físico da oficina. |
| **Lista de Pagamento** | `PaymentList` | Documento comercial emitido pelo cliente contendo os veículos **reconhecidos e aprovados** para faturamento. | Não se restringe a uma única semana (pode conter carros de várias semanas). |
| **Confronto** | `Reconciliation` | Processo de conciliação e batimento entre os itens do WEEKLOG e a Lista de Pagamento do cliente. | Não é exclusão/recriação global de lançamentos contábeis. |
| **Retificação** | `ServiceRectification` | Reabertura de um serviço rejeitado pelo cliente para retrabalho na mesma Ordem de Produção original. | Não é uma nova OP desvinculada. |
| **Executado** | Indicador Financeiro | Soma monetária total dos WEEKLOGs concluídos. | Não garante que o cliente pagará esse valor integralmente. |
| **Reconhecido** | Indicador Financeiro | Valor total dos serviços aprovados na Lista de Pagamento do cliente. | Não significa que o dinheiro já está na conta. |
| **Esperado** | Indicador Financeiro | Valor de Listas validadas com faturamento em aberto / pendente de pagamento. | Não é calculado diretamente a partir dos WEEKLOGs brutos. |
| **Recebido** | Indicador Financeiro | Valor de Listas efetivamente pagas e compensadas pelo cliente. | Não deve incluir listas em aberto. |
| **Disponível** | Indicador Financeiro | Saldo líquido de caixa obtido por: $\text{Recebido} - \text{Despesas Pagas}$. | Não é o faturamento bruto. |
| **RequestContext** | Middleware / Context | Estrutura de dados imutável no backend com a identidade e autoridade comprovadas do usuário na requisição. | Não é um objeto injetado pelo cliente no body HTTP. |
