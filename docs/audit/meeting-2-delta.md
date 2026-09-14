# Delta de entendimento — Segunda Reunião com Alex

**Data**: 2026-09-09  
**Fonte**: `docs/Reunião Alex Operix 2.txt`, lida integralmente  
**Regra**: para negócio, prevalece a última formulação explicitamente confirmada por Alex; para fatos técnicos, prevalecem código e auditoria. Falas exploratórias não ampliam o escopo.

## Como ler

- **CONFIRMADO**: decisão explícita; entra no target aplicável.
- **PREFERÊNCIA**: orienta UX/arquitetura, sem obrigação automática.
- **EXPLORAÇÃO**: raciocínio em voz alta; não vira requisito.
- **DESCARTADO**: Alex voltou atrás; não entra no target.
- **FUTURO**: fora do MVP inicial.

As ações usam somente a taxonomia da validação: `PRESERVAR`, `CORRIGIR`, `INTEGRAR`, `ADAPTAR`, `IMPLEMENTAR MÍNIMO`, `OCULTAR/REMOVER` e `FUTURO`.

## Mudanças de entendimento

| ID | ANTES | FALA DA REUNIÃO | ENTENDIMENTO FINAL | IMPACTO NO SISTEMA | AÇÃO |
|---|---|---|---|---|---|
| D01 | Técnico era tratado principalmente como membro de workspace | `11:33–13:21`, CONFIRMADO: técnico pode trabalhar sem workspace intermediador, com clientes e ciclo próprios | existem dois contextos: técnico independente e técnico vinculado | cadastro independente já existe, mas operação/financeiro exigem `workspaceId`; falta fronteira pessoal | ADAPTAR |
| D02 | Papéis externos estavam descritos genericamente como Admin/Associado/Técnico/Cliente | `15:00–16:13` e `19:00`, CONFIRMADO/PREFERÊNCIA final: vinculado vê só o que pertence a ele, inclusive status próprio, nunca faturamento agregado | o mesmo papel técnico muda de capacidade conforme vínculo/contexto | policy declara `own`, mas rotas não impõem o escopo de forma uniforme | CORRIGIR |
| D03 | Target anterior cogitava usuário cliente acima de várias empresas | `29:42–34:40`, EXPLORAÇÃO; `34:46–35:24`, DESCARTADO: “esquece... o cliente... empresa específica” | cada empresa cliente é cadastrada/convidada separadamente | não criar hierarquia multiempresa para cliente nesta onda; reutilizar cliente + convite por contexto | ADAPTAR |
| D04 | Cliente era uma conta externa sem estrutura interna definida | `27:00–36:58`, CONFIRMADO: cliente tem gerente de plataforma/regional, recepção, RH documental, validadores e conferência | cliente pode delegar funções a colaboradores próprios, limitados à Operix | falta cliente→colaborador→papel→local; membership genérica não resolve | IMPLEMENTAR MÍNIMO |
| D05 | B08 (Operix × tenant) e papéis estavam quase totalmente abertos | `17:27–18:49`, `31:20–32:47`, CONFIRMADO: owner/admin delega no workspace; administrador de uma empresa não acessa outra; cliente não vê financeiro interno | fronteiras locais ficaram mais claras, mas poder de platform admin ainda requer política interna | separar papel global/local e criar projeções por ator; B08 fica parcialmente aberta apenas no plano Operix | ADAPTAR |
| D06 | Orçamento aprovado era preservado/bloqueado; regra de alteração estava aberta | `20:44–21:26`, CONFIRMADO: altera e remanda para aprovação | orçamento aprovado pode ser revisado, mantendo auditabilidade mínima | frontend hoje bloqueia edição e persiste localmente; falta revisão no domínio | ADAPTAR |
| D07 | Validação/assinatura não tinha formato fechado | `22:39–24:06`, CONFIRMADO: assinatura desenhada é opcional; confirmação autenticada também vale | um dos dois meios é suficiente, com ator/data rastreáveis | checkbox existente é reaproveitável, mas precisa estar ligado à identidade/cliente autorizados | ADAPTAR |
| D08 | Retificação aparecia como dado/estado isolado | `24:14–26:32`, CONFIRMADO: retorna ao mesmo trabalho em Produção, refaz e volta ao WEEKLOG; técnico pode mudar | retificação é ciclo vinculado ao trabalho original | campos JSON e flags existem, mas não o comando/relacionamento end-to-end | INTEGRAR |
| D09 | Retificação era considerada principalmente antes de pagamento | `1:04:13–1:07:54`, CONFIRMADO: desconto/retífica também pode vir na Lista depois de o cliente já processar o trabalho | há dois gatilhos, pré-Lista e pós-Lista, usando o mesmo vínculo | reconciliação atual não reabre Produção nem preserva lineage canônico | IMPLEMENTAR MÍNIMO |
| D10 | B06 perguntava se WEEKLOG era OS, etapa, documento semanal ou visão | `55:05–59:40`, CONFIRMADO: WEEKLOG trabalha por semana; Lista trabalha com trabalhos reconhecidos e pode misturar semanas | WEEKLOG e Lista são aggregates/documentos distintos | `ServiceOrder` e `PaymentOrder/listName` misturam conceitos; exige adaptação semântica | ADAPTAR |
| D11 | Conversão WEEKLOG→PaymentOrder sugeria relação quase 1:1 | `55:05–59:40`, CONFIRMADO: uma Lista pode reunir carros de várias semanas | não pressupor cardinalidade 1:1; Lista contém itens | `ProductionList` é só status e o gerador atual cria sequência por WEEKLOG/semana | IMPLEMENTAR MÍNIMO |
| D12 | Upload manual era capacidade existente sem regra de validade final | `59:40–1:00:58`, CONFIRMADO: WEEKLOG carregado manualmente pode entrar validado e virar Lista | proveniência “importado externamente” permite validação inicial, sob usuário autorizado | reutilizar upload/OCR/revisão e registrar proveniência/ator | ADAPTAR |
| D13 | Confronto estava no módulo Financeiro e sua autoridade permanecia aberta | `54:29–1:02:48`, CONFIRMADO: compara WEEKLOG com Lista do cliente e deve ocorrer no carregamento antes de validar | Confronto pertence à revisão da Lista/Operações | motor `Reconciliation` é reutilizável, mas deve sair do fluxo financeiro isolado e ser tenant-safe | INTEGRAR |
| D14 | Importador era tratado genericamente como OCR de ordens/documentos | `1:01:48–1:07:54`, CONFIRMADO: preview, giro, zoom, correção, técnico, cliente, plataforma, placa/chassi, quatro serviços, aplicação em lote e confronto | importadores de WEEKLOG e Lista compartilham pipeline, mas persistem tipos/targets diferentes | componentes já existem; falta commit transacional, proveniência e integração ao Confronto | INTEGRAR |
| D15 | Distribuição podia evoluir para regras salvas/automáticas | `49:21–49:47`, CONFIRMADO: “melhor deixar manual” porque varia por técnico/trabalho | distribuição inicial é manual; não criar engine automática complexa | reaproveitar UI/cálculo e tratar `ProfitRule` como apoio, não fonte automática | ADAPTAR |
| D16 | Receita esperada era calculada/descrita a partir de WEEKLOG/OS | `50:14–51:28`, CONFIRMADO e autocorrigido: “esperado é o que está na lista, mas está pendente” | esperado = Lista validada pendente | `finance.ts` soma `ServiceOrder.total`; definição atual está errada | ADAPTAR |
| D17 | Recebido era total de PaymentOrder/listas sem regra de status consistente | `50:14–51:28`, CONFIRMADO: recebido = Lista marcada verde/paga | somente Lista paga entra em recebido | backend soma todas as `PaymentOrder`; precisa filtrar a fonte canônica | CORRIGIR |
| D18 | Caixa e obrigação não tinham regra de tempo clara | `52:09–54:14`, CONFIRMADO: disponível = recebido − despesas; pagamento não tem periodicidade fixa e pode haver saldo negativo | obrigação nasce conforme caixa e decisão operacional, não calendário fixo | fórmulas/telas existem; falta ledger/ciclo auditável sem dupla contagem | INTEGRAR |
| D19 | Despesas eram bloco financeiro genérico | `45:45–47:43` e `51:35`, CONFIRMADO: governo, compras, combustível, viagem, hotel, alimentação, adiantamento/retirada, aluguel e outros podem ser vinculados ao técnico | catálogo mínimo e relação com técnico/operação entram no financeiro essencial | `FinancialRecord` possui campos genéricos, mas FKs/tenant são fracos | INTEGRAR |
| D20 | “Documentos por País” tinha restrição anterior de preservar como módulo separado | `44:01–45:11`, CONFIRMADO: não precisa do menu; lógica pode ficar no diretório/RH | preservar catálogo útil, não a superfície lateral isolada | integrar checklist ao File Manager/Pessoa e depois ocultar rota/menu | ADAPTAR + OCULTAR/REMOVER |
| D21 | RH podia ser interpretado como módulo empresarial amplo | `16:13`, `37:08–41:47`, CONFIRMADO: pessoal/documentos necessários; sem férias/ponto; detalhes ficam para outra onda | RH do MVP é cadastro, função, contato, status, contrato/documentos e permissão | `Person` é base reaproveitável; remover mistura com externos; RH completo fica fora | ADAPTAR |
| D22 | B13 assumia gerente do Local obrigatoriamente como Colaborador | `1:09:53–1:11:40`, CONFIRMADO: manter editável/manual e também permitir buscar funcionário responsável | gerente textual é fallback válido; relação com colaborador é preferível, não obrigatória | manter campos atuais e adicionar FK opcional | ADAPTAR |
| D23 | Local era cadastro isolado; mapa inferia operação por cidade | `1:08:48–1:15:29`, CONFIRMADO: Local é oficina/plataforma e deve aparecer no mapa para cliente e workspace | Local precisa ser a fonte real de pontos e relações operacionais | adicionar coordenadas/relações; retirar `CITY_COORDS`/jitter como fonte de verdade | INTEGRAR |
| D24 | Mapa único já era target, mas apresentação/status não estavam fechados | `1:15:30–1:20:04`, CONFIRMADO/PREFERÊNCIA: mapa global apresentável, relações simples e cores azul/verde/amarelo/vermelho | preservar mapa único; usar status reais; conexões são preferência de baixa complexidade | MapLibre/layers servem; evitar projeto GIS/3D | ADAPTAR |
| D25 | PDR/IA e granizo apareciam como evolução grande | `1:11:40–1:13:52`, CONFIRMADO: PDR Intel e relato/dado meteorológico são importantes; `1:26:00`, FUTURO para detalhes | preservar núcleo do radar/granizo; refinamentos avançados não bloqueiam MVP | modelos/telas/gateways existem e precisam de tenant/egress/runtime | PRESERVAR |
| D26 | Portfólio de Automação/BI estava aberto | `42:32–42:55`, CONFIRMADO: Automação atual pode sair; `43:00–43:55`, PREFERÊNCIA: BI é interessante | ocultar Automação; BI fica futuro | remover do menu/rotas priorizadas sem apagar código | OCULTAR/REMOVER |
| D27 | Marketplace e módulos secundários continuavam decisão geral de portfólio | `1:21:42` e `1:26:00`, FUTURO: menor relevância e detalhes em outra onda | Marketplace não entra no core | manter fora da release inicial | FUTURO |
| D28 | Stripe aparecia como caminho de billing já iniciado | `1:23:04–1:23:35`, EXPLORAÇÃO/FUTURO: uso será livre primeiro e o provedor ainda não foi escolhido | billing SaaS definitivo não é requisito da próxima implementação | não ativar cobrança; preservar integração para futura avaliação sandbox | FUTURO |
| D29 | Mobile era requisito genérico; app nativo poderia ser cogitado | `1:20:59` e `1:24:30–1:26:00`, CONFIRMADO: telefone/tablet pela web é suficiente | primeira entrega é web responsiva, não app nativo | QA mobile do core, câmera e targets; app nativo fica futuro | ADAPTAR |
| D30 | Rebranding não era gate funcional explícito | `1:17:00–1:18:22`, CONFIRMADO: limpar WorkNexus/QW e usar Operix | marca deve ser coerente no produto inicial | há strings, título, logo e selos residuais em autenticação/shell | CORRIGIR |
| D31 | Ordem anterior colocava Financeiro depois de Operação e vários módulos concorrentes | `1:20:42–1:22:10`, CONFIRMADO: Operação + Financeiro fazem a virada; 95% do uso esperado é técnico | a primeira entrega comercial é Operação móvel + Financeiro essencial | fundação continua anterior como dependência técnica; Pessoas/Docs/Local entram somente quando sustentam o core | ADAPTAR |

## Questões anteriores reclassificadas

| Questão | Situação após reunião 2 | Evidência final |
|---|---|---|
| B01 — cliente canônico | **regra de negócio parcialmente respondida**; engenharia ainda escolhe a consolidação | cliente é empresa específica convidada e pode ter colaboradores; código mantém `Client` e `BillingClient` |
| B02 — acesso após desligamento | **continua aberta** | reunião não define histórico após desligamento |
| B03 — falha parcial OP→WEEKLOG→Lista | **continua aberta** | retificação foi definida, mas falha técnica intermediária não |
| B04 — versão/alteração após aprovação | **respondida para orçamento**; PDR avançado continua futuro/aberto | alterar e reenviar; preservar revisão mínima por auditabilidade |
| B05 — valor/congelamento do técnico | **parcialmente respondida** | distribuição manual e saldo foram definidos; congelamento/reabertura não |
| B06 — semântica WEEKLOG | **respondida** | semanal e distinta de Lista multissemanas |
| B07 — reconciliação/autoridade | **parcialmente respondida** | Confronto é revisão de Lista antes de validar; desfazer/encerramento técnico ainda exige desenho |
| B08 — Operix × tenant | **parcialmente respondida** | papéis locais e visibilidade foram definidos; acesso de suporte/platform admin continua política interna |
| B09 — retenção documental | **continua aberta** | documentos e acesso foram detalhados, não retenção/eliminação |
| B10 — lifecycle de convites | **continua aberta** | cliente sempre convidado, mas expiração/reenvio/conflitos não |
| B11 — latência | **parcialmente respondida** | uso mobile e feedback imediato importam; SLA formal não foi dado |
| B12 — criação automática Person↔User | **mantém resposta anterior** | nada na reunião revoga a separação; vínculo deve ser explícito |
| B13 — gerente de Local | **respondida** | campo manual permitido, vínculo com colaborador preferível |

## Consequência para o target

O target anterior de 53 CTS não deve ser apagado. Esta reunião o refina em quatro movimentos:

1. **substitui** a semântica de WEEKLOG/Lista, a fórmula financeira, o gerente obrigatório e a preservação lateral de Documentos por País;
2. **acrescenta ao core** técnico independente operacional, colaborador do cliente, retificação ligada e Lista multissemanas;
3. **rebaixa para futuro** billing SaaS, Marketplace, BI, app nativo e refinamentos avançados;
4. **mantém como fundação técnica** tenant, autoridade, baseline, ownership, idempotência e testes, pois a reunião não muda fatos do código.

### Referencial

O delta preserva rastreabilidade de decisão (ISO/IEC/IEEE 29148), separa requisito confirmado de hipótese e preferência, e aplica gestão incremental de mudanças em sistemas brownfield. Decisões de domínio foram confrontadas com aggregates e limites de autorização; nenhuma fala foi usada como prova de funcionamento técnico.
