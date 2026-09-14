# Open Questions: Diagnóstico Técnico Brownfield Operix

**Branch**: `000-operix-diagnostic` | **Status**: FASE 7 CONCLUÍDA; diagnóstico concluído com validações runtime residuais; 4B/5B não executadas integralmente  
**Data**: 2026-09-05  
**Nova fonte primária**: `docs/Relatorio_Plano_de_Ataque_QW_Nexus.pdf`

Status permitidos: **RESPONDIDA PELO ALEX**, **PARCIALMENTE RESPONDIDA**, **CONTINUA ABERTA** e **NÃO É PERGUNTA PARA O CLIENTE**. Uma afirmação do PDF resolve intenção de negócio, não comprova runtime.

## 1. BUSINESS — perguntar ao Alex

| ID | Questão de resultado | Status | Efeito da nova fonte |
|---|---|---|---|
| B01 | Qual entidade representa um cliente único para operação, faturamento e relacionamento, e o que ocorre quando cadastros divergem? | CONTINUA ABERTA | PDF inclui clientes em Utilizadores, mas não escolhe entre `Client`, `BillingClient` e conta externa |
| B02 | Quando uma pessoa perde vínculo com um workspace, quais dados e ações históricas ela ainda pode ver? | CONTINUA ABERTA | separação interno/externo não define desligamento ou histórico |
| B03 | Se uma etapa externa falhar após gravação local, a operação reverte, fica pendente ou conclui parcialmente? | CONTINUA ABERTA | ordem incremental não define falha parcial OP→WEEKLOG→pagamento/envio |
| B04 | Quem pode criar, aprovar, substituir e tornar vigente uma versão de PDR/regra de distribuição? | CONTINUA ABERTA | novo PDF não detalha PDR/versionamento |
| B05 | Qual valor financeiro do técnico prevalece, quando congela e quem pode reabrir? | CONTINUA ABERTA | não abordado |
| B06 | WEEKLOG é OS, etapa, documento semanal ou visão? Qual referência é única? | CONTINUA ABERTA | PDF apenas lista o módulo e não define semântica |
| B07 | OS×PaymentOrder e invoice×payment são o mesmo processo? Quem inicia, revisa, desfaz e encerra? | CONTINUA ABERTA | não abordado |
| B08 | Quais ações são exclusivas da Operix e quais pertencem ao owner/admin de cada empresa? | PARCIALMENTE RESPONDIDA | há administrativo que cria empresas isoladas, mas autoridade Operix×tenant e papéis detalhados não foram definidos |
| B09 | Quais documentos expiram, são preservados ou eliminados e sob quais obrigações? | CONTINUA ABERTA | preserva Documentos por País, mas não define retenção/lifecycle |
| B10 | Convites vencem? Como tratar reenvio, papel alterado e usuário já membro? | CONTINUA ABERTA | não abordado |
| B11 | Qual latência é aceitável por módulo? | PARCIALMENTE RESPONDIDA | toggles do mapa devem refletir imediatamente; demais módulos/realtime continuam sem SLA |
| B12 | Cadastrar Colaborador ou Utilizador cria automaticamente o outro registro? | RESPONDIDA PELO ALEX | não; os fluxos não se comunicam/criam automaticamente em nenhum sentido |
| B13 | O gerente de um Local deve ser selecionado entre Colaboradores ou pode ser um contato livre? | CONTINUA ABERTA | PDF define os campos, mas não o vínculo |

### 1.1 Reavaliação da Fase 6.5

As formulações EverGreen abaixo são hipóteses de trabalho a confirmar; **não são respostas de Alex** e não substituem evidência técnica das Fases 1–6.

| ID | Classificação 6.5 | Premissa ou decisão remanescente |
|---|---|---|
| B01 | PREMISSA EVERGREEN — VALIDAR COM CLIENTE | uma identidade conceitual de Cliente interliga operação, faturamento e relacionamento; consolidação técnica é engenharia |
| B02 | AINDA PRECISA DE DECISÃO DO ALEX | definir acesso e histórico após desligamento do colaborador |
| B03 | AINDA PRECISA DE DECISÃO DO ALEX | escolher pendência recuperável, bloqueio/reversão ou outra regra quando WEEKLOG/lista falha após concluir OP |
| B04 | AINDA PRECISA DE DECISÃO DO ALEX | premissa: funcionário/orçamentista cria e cliente aprova; decidir edição no lugar versus nova versão após aprovação |
| B05 | AINDA PRECISA DE DECISÃO DO ALEX | premissa: gestor/dono define o valor; decidir evento de congelamento e autoridade de reabertura/recálculo |
| B06 | PREMISSA EVERGREEN — VALIDAR COM CLIENTE | WEEKLOG é consolidação semanal da operação como um todo, não sinônimo de uma ServiceOrder individual |
| B07 | AINDA PRECISA DE DECISÃO DO ALEX | premissa: fluxo financeiro é interligado; decidir quem valida, desfaz/reabre e quando encerra |
| B08 | AINDA PRECISA DE DECISÃO DO ALEX | premissa: owner/admin controla o próprio workspace; decidir poderes e acesso da equipe Operix sobre empresas clientes |
| B09 | PREMISSA EVERGREEN — VALIDAR COM CLIENTE | retenção mínima de 180 dias; archive/delete/backup/storage ficam como política de engenharia |
| B10 | PODE SER DEFINIDA DURANTE IMPLEMENTAÇÃO | expiração, reenvio e conflito de convites entram no desenho de identidade sem bloquear roadmap macro |
| B11 | PODE SER DEFINIDA DURANTE IMPLEMENTAÇÃO | toggles do mapa já exigem resposta imediata; SLAs restantes podem ser refinados por módulo |
| B12 | NÃO BLOQUEIA FASE 7 | já respondida por Alex: não existe criação automática Colaborador↔Utilizador |
| B13 | PREMISSA EVERGREEN — VALIDAR COM CLIENTE | gerente/responsável do Local é um Colaborador cadastrado; não usar nome livre como identidade canônica |

Resultado: **6 decisões** ainda precisam de Alex (B02, B03, B04, B05, B07 e B08), **4 premissas autônomas** aguardam validação (B01, B06, B09 e B13), **1 item não bloqueia** e **2 podem ser definidos durante implementação**. Partes conhecidas de B04/B05/B07/B08 também permanecem explicitamente como premissas EverGreen dentro das respectivas decisões.

## 2. ENGINEERING — decisão da EverGreen

| ID | Decisão técnica | Status | Dependência |
|---|---|---|---|
| E01 | Como materializar `TenantContext` server-side e impedir consultas Prisma não escopadas? | NÃO É PERGUNTA PARA O CLIENTE | target exige isolamento total |
| E02 | Como separar identidade, middleware, APIs e auditoria de plataforma e tenant? | NÃO É PERGUNTA PARA O CLIENTE | B08/S5A-001–003 |
| E03 | Qual padrão implementa B03: transação local, outbox/saga ou estado recuperável? | NÃO É PERGUNTA PARA O CLIENTE | depende da resposta B03 |
| E04 | Como consolidar `Person`, `Client` e `BillingClient` preservando histórico? | NÃO É PERGUNTA PARA O CLIENTE | depende de B01 e target interno/externo |
| E05 | Como criar baseline Prisma verificável preservando a genealogia Supabase? | NÃO É PERGUNTA PARA O CLIENTE | gate G4 |
| E06 | Scheduler será worker, fila ou cron externo? Qual lock/idempotência/retry? | NÃO É PERGUNTA PARA O CLIENTE | dívida operacional 5A |
| E07 | Qual modelo de ownership, retenção e URL assinada será usado em documentos/storage? | NÃO É PERGUNTA PARA O CLIENTE | B09 e gate G5 |
| E08 | Qual política central de logs, redaction, auditoria, tracing, replay e egress? | NÃO É PERGUNTA PARA O CLIENTE | findings de segurança 5A |
| E09 | Quais gates CI cobrem lint, typecheck, testes, SCA, secrets e migrations? | NÃO É PERGUNTA PARA O CLIENTE | gates G4/G7 |
| E10 | Qual padrão de paginação, índices, batches e orçamento de consulta? | NÃO É PERGUNTA PARA O CLIENTE | performance 5A |
| E11 | Qual desenho de sessão permite revogação, MFA e proteção contra XSS? | NÃO É PERGUNTA PARA O CLIENTE | segurança 5A |
| E12 | Qual sequência vertical remove Supabase/noop sem big-bang? | NÃO É PERGUNTA PARA O CLIENTE | gate G6 |

## 3. RUNTIME — responder na Fase 4B

| ID | Questão a comprovar em laboratório sanitizado | Status | Observação |
|---|---|---|---|
| R01 | Até onde chega uma conta criada pelo autorregistro público? | CONTINUA ABERTA | PDF não é evidência de execução |
| R02 | Alterar membership em A eleva acesso global ou a B? | CONTINUA ABERTA | requer fixtures A/B |
| R03 | Cada domínio inadequado rejeita IDs de B para usuário só de A? | CONTINUA ABERTA | target reforça prioridade de isolamento |
| R04 | Evento Stripe sandbox repetido/concorrente é idempotente? | CONTINUA ABERTA | não abordado |
| R05 | Quais limites seguros existem para JSON, upload, IA, PDF e batches? | CONTINUA ABERTA | não abordado |
| R06 | Como People, ServiceOrder, reconciliação e billing escalam? | CONTINUA ABERTA | não abordado |
| R07 | Duas réplicas duplicam/sobrepõem o job meteorológico? | CONTINUA ABERTA | Radar deve ser preservado, sem prova operacional |
| R08 | Storage rejeita MIME falso, path cruzado e objeto de outro tenant? | CONTINUA ABERTA | documentos por colaborador aumentam prioridade |
| R09 | Quais hosts/campos recebem telemetria e probes? | CONTINUA ABERTA | não abordado |
| R10 | O ambiente nasce de banco vazio de modo repetível? | CONTINUA ABERTA | laboratório continua bloqueado |

## 4. PRODUCT — analisadas na Fase 6; decisões ainda abertas permanecem

| ID | Questão de produto | Status | Efeito da nova fonte |
|---|---|---|---|
| P01 | Qual UX torna versões, aprovação e assinatura PDR compreensíveis? | CONTINUA ABERTA | Fase 6 confirmou ausência do workflow; depende de B04 antes do desenho final |
| P02 | Quais módulos legados permanecem, são substituídos ou removidos? | PARCIALMENTE RESPONDIDA | Fase 6 criou F7 sem CTS dedicado; destino final continua decisão de portfólio, não escopo implícito |
| P03 | Quais telas exigem atualização quase em tempo real? | PARCIALMENTE RESPONDIDA | CTS-044 exige resposta imediata dos toggles; demais módulos continuam sem SLA |
| P04 | Como permissões `own/team/all` serão explicadas e administradas? | CONTINUA ABERTA | Fase 6 confirmou dependência de G2/G3 e B08; UX de administração não foi definida |
| P05 | Como arquivo, recuperação e retenção aparecem sem confundir exclusão lógica/física? | CONTINUA ABERTA | CTS-021/030/031/047/052/053 dependem de G5 e B09; lifecycle permanece aberto |
| P06 | Operações deve ter mapa separado do Radar? | RESPONDIDA PELO ALEX | não; deve existir um único mapa com camadas |
| P07 | Documentos por País deve ser remodelado neste ciclo? | RESPONDIDA PELO ALEX | não; preservar lógica e dados atuais |
| P08 | O que uma conta sem empresa/workspace deve enxergar? | RESPONDIDA PELO ALEX | Perfil e Painel/Radar, sem módulos operacionais listados |
| P09 | Toda OP exige orçamento prévio? | RESPONDIDA PELO ALEX | não; OP pode nascer diretamente em Produção e o fluxo Orçamento→Produção deve coexistir |

## 5. SECURITY — decisão interna de segurança

| ID | Política | Status | Finding relacionado |
|---|---|---|---|
| S01 | Cerimônia do primeiro platform admin e encerramento do bootstrap | NÃO É PERGUNTA PARA O CLIENTE | S5A-001 |
| S02 | Acesso temporário/auditado de suporte Operix a tenant | NÃO É PERGUNTA PARA O CLIENTE | S5A-002/S5A-011 |
| S03 | Sessão, TTL, revogação, MFA e troca de senha | NÃO É PERGUNTA PARA O CLIENTE | S5A-013–015 |
| S04 | Limites por identidade/IP/tenant para serviços caros | NÃO É PERGUNTA PARA O CLIENTE | S5A-008/009/012/018 |
| S05 | Rotação pós-handover e auditoria completa do Git | NÃO É PERGUNTA PARA O CLIENTE | S5A-020/021 |
| S06 | Dados permitidos em logs, replay e IA | NÃO É PERGUNTA PARA O CLIENTE | S5A-022/023 |
| S07 | MIME, tamanho e tratamento de conteúdo ativo/malware | NÃO É PERGUNTA PARA O CLIENTE | S5A-006/018/019 |
| S08 | Eventos imutáveis e retenção da trilha de segurança/financeira | NÃO É PERGUNTA PARA O CLIENTE | S5A-004/023/025 |
| S09 | Origens CORS, egress e callbacks por ambiente | NÃO É PERGUNTA PARA O CLIENTE | S5A-017/022 |

## 6. Totais e gates

| Status | Total |
|---|---:|
| RESPONDIDA PELO ALEX | 5 |
| PARCIALMENTE RESPONDIDA | 4 |
| CONTINUA ABERTA | 23 |
| NÃO É PERGUNTA PARA O CLIENTE | 21 |
| **Total** | **53** |

O PDF substitui somente a hipótese de **sincronização automática** Colaborador↔Utilizador. A Fase 6 mapeou dependências sem inventar respostas: cliente canônico, WEEKLOG, regra financeira do técnico, reconciliações, falha parcial, retenção documental, versões/aprovações PDR e permissões Operix×tenant continuam abertos.

A Fase 4B/5B integral permanece não executada e condicionada aos gates de laboratório já registrados. A Fase 7 foi concluída documentalmente; nenhuma premissa acima autoriza produção, migrations ou implementação.

## 7. Filtro final da Fase 7 — decisões que impedem implementação definitiva

O relatório mestre apresenta ao cliente somente as decisões que alteram desenho, aceite ou autoridade:

1. **B02** — acesso e histórico após desligamento;
2. **B03** — estado quando WEEKLOG/lista falha após a conclusão da OP;
3. **B04** — versão e alteração de PDR após aprovação;
4. **B05** — momento de congelamento e autoridade de reabertura do valor técnico;
5. **B07** — natureza, validação e reabertura das reconciliações;
6. **B08** — poderes e acesso da Operix sobre tenants.

Continuam como **PREMISSAS EVERGREEN A VALIDAR**, e não como respostas do Alex: B01 cliente único/interligado, B06 WEEKLOG como consolidação semanal, B09 retenção mínima de 180 dias e B13 gerente do Local como Colaborador, além das partes conhecidas de B04/B05/B07/B08.

B10 e o restante de B11 podem ser refinados durante implementação; B12 permanece respondida pelo Alex. P02 continua uma decisão de portfólio independente: Frota, Marketplace, Automação, Copiloto e outros legados não entram automaticamente no escopo.

**Estado do registro**: aberto somente para as decisões/premissas/validações acima; Fase 7 concluída sem inventar respostas.
