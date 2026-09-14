# Pauta executiva — decisões para validação com Alex

**Objetivo da reunião**: confirmar premissas e fechar somente as decisões que alteram desenho, aceite ou escopo.  
**Duração sugerida**: uma rodada objetiva, sem discutir arquitetura técnica, tecnologia ou estimativas.  
**Status das premissas abaixo**: **PREMISSA EVERGREEN — VALIDAR COM CLIENTE**. Nenhuma está registrada como resposta de Alex.

## 1. Confirmações rápidas de entendimento

Antes das decisões, confirmar em bloco:

1. Existe uma única identidade conceitual de cliente; operação, faturamento e relacionamento devem estar interligados.
2. WEEKLOG é a consolidação semanal da operação como um todo, não apenas outro nome para uma ordem individual.
3. A ficha/cálculo PDR é criada pelo funcionário/orçamentista e aprovada pelo cliente.
4. O gestor/dono da oficina define o valor devido ao técnico.
5. OS, listas, ordem de pagamento, fatura e pagamento compõem um fluxo financeiro interligado.
6. Colaboradores acessam conforme função; administrador/dono tem acesso total à própria empresa/workspace.
7. Documentos devem ser mantidos por no mínimo 180 dias.
8. O gerente de um Local deve ser um Colaborador cadastrado, não apenas um nome livre.

Se alguma premissa for rejeitada, registrar a formulação correta e reabrir somente o cluster afetado.

## 2. Decisões necessárias

### 1. O que acontece se a OP terminar, mas o WEEKLOG ou a lista não for gerado?

**Contexto**: hoje a operação principal e seus efeitos derivados podem terminar em momentos diferentes. É necessário definir o estado de negócio visível quando a etapa posterior falha.

**Opções**:

- **A — OP concluída com pendência recuperável**: a operação não para; o sistema sinaliza a pendência e tenta novamente com rastreabilidade.
- **B — bloquear/reverter a conclusão**: garante consistência imediata, mas pode interromper a oficina por uma falha técnica posterior.
- **C — concluir sem pendência formal**: reduz implementação inicial, porém permite perda silenciosa de WEEKLOG/lista.

**Recomendação EverGreen**: A. Preserva a realidade operacional e exige recuperação explícita, idempotente e auditável.  
**Módulos impactados**: Produção, WEEKLOG, listas, PaymentOrder, notificações e auditoria.

### 2. Uma ficha PDR aprovada pode ser alterada?

**Contexto**: a aprovação do cliente transforma a ficha em evidência comercial e operacional. Editá-la no lugar compromete a trilha do que foi aceito.

**Opções**:

- **A — editar a mesma ficha**: experiência simples, mas o conteúdo originalmente aprovado deixa de ser preservado.
- **B — criar nova versão**: mantém a versão aprovada imutável e exige nova aprovação quando a alteração for material.
- **C — bloquear qualquer alteração**: máxima rigidez; correções exigem cancelar e criar outra ficha.

**Recomendação EverGreen**: B, com motivo da alteração e vínculo entre versões.  
**Módulos impactados**: orçamento/PDR, fotos, produção, documentos/relatórios e auditoria.

### 3. Quando o valor devido ao técnico fica fechado e quem pode reabri-lo?

**Contexto**: o gestor/dono define o cálculo, mas o evento de congelamento determina quando o valor deixa de variar e passa a sustentar pagamento e reconciliação.

**Opções**:

- **A — congelar na validação do WEEKLOG/lista**, permitindo reabertura por gestor/dono com motivo e trilha.
- **B — congelar ao finalizar a OP**: fecha cedo, antes da consolidação semanal e de eventuais ajustes.
- **C — congelar somente no pagamento/reconciliação**: mantém flexibilidade, mas prolonga incerteza para o técnico e o financeiro.

**Recomendação EverGreen**: A. Reabertura deve ser excepcional, autorizada e gerar nova versão do cálculo.  
**Módulos impactados**: Produção, WEEKLOG, listas, regras de distribuição, PaymentOrder, financeiro e auditoria.

### 4. Quem valida uma reconciliação e quem pode desfazer ou reabrir?

**Contexto**: o fluxo financeiro é interligado; validação e reabertura afetam valores, documentos e histórico.

**Opções**:

- **A — owner/admin da empresa valida e reabre**, sempre com justificativa e histórico; Operix não atua na rotina do tenant.
- **B — somente a equipe Operix valida/reabre**: aumenta controle central, mas cria dependência operacional e acesso amplo.
- **C — papéis separados**: um papel valida e outro, mais restrito, reabre/desfaz.

**Recomendação EverGreen**: A como padrão; C apenas se houver exigência real de segregação de funções.  
**Módulos impactados**: OS, listas, PaymentOrder, invoice, payment, ledger, confronto e auditoria.

### 5. Que poderes a equipe Operix possui sobre os dados das empresas clientes?

**Contexto**: o dono/admin controla integralmente seu workspace. Falta definir se a plataforma pode atravessar essa fronteira para suporte ou operação.

**Opções**:

- **A — sem acesso por padrão; suporte temporário mediante concessão**, com prazo, justificativa e auditoria.
- **B — leitura permanente**: facilita suporte, mas amplia exposição de dados entre plataforma e clientes.
- **C — administração permanente**: maximiza intervenção, com o maior risco e responsabilidade operacional.

**Recomendação EverGreen**: A, aplicando menor privilégio e revogação automática.  
**Módulos impactados**: autenticação, RBAC, empresa/workspace, pessoas, documentos, produção, financeiro, suporte e auditoria.

### 6. O que um colaborador desligado ainda pode consultar?

**Contexto**: remover o vínculo precisa interromper ações futuras sem apagar autoria, aprovações ou registros históricos.

**Opções**:

- **A — acesso encerrado imediatamente; histórico permanece para a empresa**, com o colaborador apenas como referência imutável.
- **B — acesso somente leitura ao histórico**: ajuda transição, mas mantém uma conta desligada dentro do perímetro.
- **C — acesso temporário por período definido**: exige expiração automática e escopo reduzido.

**Recomendação EverGreen**: A. Se houver necessidade de transição, usar C de forma excepcional e temporária.  
**Módulos impactados**: Colaboradores, Utilizadores, memberships, documentos, produção, WEEKLOG, financeiro e auditoria.

## 3. Encerramento esperado da reunião

Registrar a opção escolhida em cada uma das seis decisões e confirmar ou corrigir as oito premissas. Convites, SLA dos demais módulos e detalhes técnicos de archive/delete/backup podem ser definidos durante implementação e não devem ampliar esta reunião.

### Rastreabilidade interna

- Premissas: B01, B06, parte conhecida de B04/B05/B07/B08, B09 e B13.
- Decisões da pauta: B03, B04, B05, B07, B08 e B02.
- Fora da pauta principal: B10 e B11 podem ser definidos durante implementação; B12 já foi respondida por Alex.
