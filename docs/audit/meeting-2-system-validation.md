# Segunda Reunião × Sistema Existente

**Projeto**: Operix / QW Nexus  
**Data da validação**: 2026-09-09  
**Fonte primária de negócio**: `docs/Reunião Alex Operix 2.txt`, lida integralmente (649 linhas; reunião de 93 minutos)  
**Escopo**: validação pós-reunião, sem alteração de produto, migration, dados ou integrações

## 1. Sumário executivo

A segunda reunião confirma que a próxima implementação deve recuperar e integrar o produto existente, não reconstruí-lo. O menor resultado vendável é uma fatia vertical móvel e tenant-safe: técnico identifica veículo, registra dados/fotos, cria orçamento ou Produção, conclui o trabalho, gera WEEKLOG, obtém validação do cliente, forma uma Lista e acompanha seu estado financeiro.

Foram identificados **80 itens verificáveis de requisito/escopo**: 75 aplicáveis às releases de recuperação e 5 explicitamente futuros. Falas exploratórias e a proposta que Alex descartou aos `34:46–35:03` não foram convertidas em requisito. Dos 80 itens, **70 já possuem alguma superfície visual** (60 `SIM` + 10 `PARCIAL`) e **59 possuem algum backend/modelo reutilizável** (30 `SIM` + 29 `PARCIAL`). Isso não equivale a funcionamento comprovado: nesta rodada, somente `/auth` e suas abas públicas puderam ser observadas; login, Técnico e Workspace renderizaram em viewport `390×844` sem overflow impeditivo evidente, mas com marca QWork Nexus e mistura de idiomas. Frontend, API e banco estavam inicialmente parados, o frontend foi iniciado isoladamente, e não havia sessão/dataset sanitizado para testar telas internas sem mutação.

Distribuição do trabalho:

| Estado | Total |
|---|---:|
| PRESERVAR | 5 |
| CORRIGIR | 18 |
| INTEGRAR | 19 |
| ADAPTAR | 23 |
| IMPLEMENTAR MÍNIMO | 8 |
| OCULTAR/REMOVER | 2 |
| FUTURO | 5 |
| **Total** | **80** |

Cada item possui uma release primária, sem dupla contagem:

| Release primária | Total |
|---|---:|
| R0 — Fundação segura | 15 |
| R1 — Operação móvel | 28 |
| R2 — Lista e financeiro essencial | 16 |
| R3 — Pessoas/documentos/Locais de apoio | 12 |
| R4 — Mapa/PDR Intel | 4 |
| FUTURO | 5 |
| **Total** | **80** |

Prioridade: **P0 15**, **P1 44**, **P2 16** e **P3 5**. Reaproveitamento: **51 alto**, **21 médio**, **7 baixo** e **1 nenhum** (app nativo, corretamente fora do MVP).

A fundação continua sendo o gate: bootstrap/cadastro privilegiado, papel global × papel do workspace, `TenantContext` server-side, autorização por objeto e por escopo, baseline Prisma, remoção do falso sucesso Supabase/noop, ownership documental e regressão automatizada. Sem isso, a UI pode parecer correta e ainda misturar dados, perder conteúdo após reload ou permitir acesso entre tenants.

Principais deltas funcionais:

- técnico independente precisa operar sem empresa intermediadora, mas com fronteira de dados própria;
- cliente é convidado para uma empresa cliente específica e pode delegar funções a seus colaboradores;
- orçamento aprovado pode ser alterado e reenviado, com versão/histórico mínimo;
- WEEKLOG e Lista são conceitos distintos e não possuem cardinalidade 1:1;
- retificação pode nascer antes da Lista ou depois de desconto/contestação na Lista;
- Confronto pertence à importação/revisão de Lista, antes da validação final;
- esperado = Lista validada pendente; recebido = Lista paga; disponível = recebido − despesas;
- distribuição permanece manual;
- “Documentos por País” deixa de ser módulo lateral isolado, preservando sua lógica dentro de Pessoas/File Manager;
- Automação deve sair do escopo visível; BI, Marketplace, billing SaaS definitivo, app nativo e refinamentos avançados permanecem futuros.

## 2. Atores e papéis definitivos

| Ator | Representação atual | Modelos/telas | Permissões atuais | Inconsistência | Mudança mínima |
|---|---|---|---|---|---|
| A. Empresa/workspace intermediador | Parcialmente representado por `Workspace`; configurações empresariais ficam por usuário | `Workspace`, `Membership`, `CompanySetting`; onboarding, switcher, settings | owner/admin recebem escopo `all`, mas muitas rotas confiam no `workspace_id` enviado | não existe aggregate `Company`; settings e tenant não coincidem; isolamento falha em múltiplos domínios | manter `Workspace` como base, tornar a empresa/contexto canônico e impor tenant no servidor |
| B. Owner/Admin do workspace | Representado, mas papel global e local se contaminam | `User.role`, `UserRole`, `Membership.role`, `Profile.isSystemOwner`; Users/Permissions | owner/admin têm catálogo amplo; PATCH de membership também atualiza papel global | alteração local pode elevar autoridade global; administração não é estritamente limitada ao próprio tenant | separar plano de plataforma do papel de workspace e aplicar autorização por objeto |
| C. Colaborador interno | `Person` mistura funções internas e tipos externos | `Person`, `Location`, `Document`; Pessoas | permissões são da credencial/membership, não do cargo da pessoa | IAM, RH e pessoa civil não têm vínculo canônico; cargos e tipos se sobrepõem | manter cadastro, restringir a pessoal interno e permitir vínculo explícito opcional com acesso |
| D. Técnico independente | Cadastro público específico existe e não cria workspace | `User/AppUser/Profile`; aba Técnico em `/auth`; módulos operacionais | role `technician` usa escopo `own` no catálogo | quase todos os dados operacionais exigem `workspaceId`; “own” não é imposto consistentemente no backend | criar o menor contexto pessoal/tenant técnico reutilizando os módulos, sem hierarquia completa de colaboradores |
| E. Técnico vinculado | É membership `technician` em um ou mais workspaces | Users, convites, Produção, WEEKLOG, Lista | catálogo declara `own`, mas consultas aceitam filtros/IDs do cliente | escopo `own` é principalmente declarativo; pode haver exposição de Lista/financeiro agregado | escopar no servidor por técnico e restringir campos/visões agregadas |
| F. Sócio/parceiro | Papel `partner` e participante textual em distribuição | `Membership`, `ProfitRuleItem`, `ServiceOrderDistribution`; Profit/Finance | escopo `team` e acesso amplo a operação/financeiro | participação financeira não é identidade canônica nem necessariamente tenant-scoped | manter papel e UI, vincular participante real ao trabalho e limitar acesso pela permissão concedida |
| G. Cliente | `Client`, `BillingClient` e role `client` coexistem | Clientes, billing, convites, operação | cliente recebe `payment_orders.view`, subscriptions e workflow `own` | três identidades de cliente; convite não cria organização/escopo de colaboradores; há acesso financeiro inadequado | definir cliente canônico, convite por empresa cliente e visão operacional sem financeiro interno |
| H. Colaborador do cliente | Não há aggregate/relação suficiente | pode ser improvisado como `Person` ou membership | não existem papéis de plataforma/regional/recepção/RH/validador | ausência de vínculo cliente→colaborador→local→capacidade; `Person` é do workspace intermediador | implementar o mínimo: colaborador vinculado ao cliente, papel/capacidades e escopo por cliente/local |

Somente A e B estão estruturalmente reconhecíveis, ainda com correções críticas; E, F e G têm peças reutilizáveis, mas precisam de ajuste de escopo; C e D exigem adaptação de domínio; H é a lacuna de ator mais clara.

## 3. Fundação necessária

O objetivo não é modernização horizontal. É fechar as invariantes mínimas para que Operação e Financeiro não voltem a quebrar:

1. encerrar autorregistro privilegiado e definir bootstrap administrativo seguro;
2. separar autoridade da plataforma, owner do workspace e papéis locais;
3. derivar `TenantContext` de sessão + membership válida no servidor, nunca do `workspace_id` isolado do request;
4. aplicar autorização por objeto e escopos `own/team/all` nas consultas e mutações;
5. criar baseline/migrations/seed A/B sanitizado e reproduzível;
6. migrar cada fatia Supabase/noop para REST/Prisma com falha explícita;
7. retirar `localStorage` e `notes/JSON` do papel de fonte da verdade de orçamento, histórico e eventos financeiros;
8. definir ownership `tenant → entidade → objeto` para documentos/fotos;
9. tornar transições OP→WEEKLOG→Lista recuperáveis e idempotentes, sem engolir falha intermediária;
10. adicionar testes mínimos de autenticação, tenant, RBAC, reload, idempotência e storage antes de liberar o MVP.

Evidência estática central: `backend/src/routes/auth.ts` aceita papel no registro; `backend/src/routes/workspaces.ts` propaga alteração de membership para `User`/`UserRole`; várias rotas (`paymentOrders.ts`, `finance.ts`, `locations.ts`) consultam dados sem impor tenant derivado; `BudgetPanel.tsx` persiste em `localStorage`; o hook de pagamento em `serviceOrders.ts` registra erro e mantém a validação concluída.

## 4. Matriz requisito × sistema atual

Legenda de evidência: `SIM` = superfície específica existe; `PARCIAL` = há peça reutilizável, mas não fecha a regra; `NÃO` = não localizada; `N/A` = camada não aplicável. `PRESERVAR` indica ativo a manter, não validação de runtime.

| ID | Domínio | Ator | Requisito da reunião | UI existe? | Backend existe? | Persistência atual | Estado | Reuso | Trabalho necessário | Prioridade | Release |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Fundação | todos | [CONFIRMADO 6:38–7:43] autenticar, salvar e reencontrar dados após reload | SIM | SIM | JWT + Prisma; fluxos híbridos | CORRIGIR | ALTO | validar sessão/reload e eliminar fontes voláteis do core | P0 | R0 |
| F02 | Tenancy | A–H | [CONFIRMADO 12:04; 31:20] isolar empresas e contextos | SIM | PARCIAL | `Workspace/Membership`; tenant vindo do request | INTEGRAR | ALTO | `TenantContext` server-side e filtros obrigatórios | P0 | R0 |
| F03 | Autoridade | A–B | [CONFIRMADO 12:27; 31:20] diferenciar dono, admin e usuário delegado | SIM | PARCIAL | papéis em três tabelas | ADAPTAR | MÉDIO | separar papel global e local | P0 | R0 |
| F04 | Segurança | A–H | [CONFIRMADO pelo fluxo de acessos] cada ator acessa somente objetos autorizados | PARCIAL | PARCIAL | guards/UI e policy sem enforcement uniforme | CORRIGIR | MÉDIO | autorização por objeto deny-by-default | P0 | R0 |
| F05 | Migração | todos | [CONFIRMADO 6:38] dados e fluxos precisam estar integrados | SIM | PARCIAL | REST/Prisma + Supabase/noop | INTEGRAR | ALTO | fechar fatias verticais e falhar explicitamente | P0 | R0 |
| F06 | Persistência | D–G | [CONFIRMADO 7:17–7:43] não depender do navegador | SIM | PARCIAL | orçamento e drafts em `localStorage`; dados em `notes` | CORRIGIR | ALTO | persistência de domínio e reload | P0 | R0 |
| F07 | Banco/ambiente | equipe | [CONFIRMADO pelo objetivo “funcionar”] ambiente deve nascer de banco vazio | NÃO | PARCIAL | schema Prisma sem baseline confiável | CORRIGIR | MÉDIO | migrations e seed sanitizado A/B | P0 | R0 |
| F08 | Storage | C–H | [CONFIRMADO 39:00–41:47] documentos por pessoa com visibilidade | SIM | PARCIAL | `Document`/MinIO sem ownership uniforme | CORRIGIR | ALTO | ownership, URLs e autorização | P0 | R0 |
| F09 | Confiabilidade | equipe | [CONFIRMADO 7:43–9:06] evitar correção aparente e falha silenciosa | NÃO | PARCIAL | catches/noop/logs heterogêneos | CORRIGIR | MÉDIO | propagação de erro, redaction e readiness | P0 | R0 |
| F10 | Regressão | equipe | [CONFIRMADO pelo critério de uso real] provar fluxo, isolamento e reload | NÃO | NÃO | testes frontend pontuais | INTEGRAR | MÉDIO | suíte backend/contrato/tenant mínima | P0 | R0 |
| A01 | Empresa | A | [CONFIRMADO 13:21–15:00] workspace capta, delega e gerencia operação/financeiro | SIM | SIM | `Workspace`, ordens e finanças fragmentadas | INTEGRAR | ALTO | ligar aggregates sob tenant canônico | P1 | R1 |
| A02 | Owner/admin | B | [CONFIRMADO 17:27–18:49] administra usuários e permissões do próprio workspace | SIM | PARCIAL | members/invites/permissions | CORRIGIR | ALTO | impedir efeito global e acesso cruzado | P0 | R0 |
| A03 | Colaborador interno | C | [CONFIRMADO 16:13; 41:47] distinguir pessoal interno de técnico/prestador | SIM | SIM | `Person.type/role` genéricos | ADAPTAR | ALTO | restringir semântica e vínculo IAM opcional | P2 | R3 |
| A04 | Técnico independente | D | [CONFIRMADO 11:33–13:21] cadastrar-se e trabalhar sem intermediador | SIM | PARCIAL | conta sem workspace; módulos exigem workspace | ADAPTAR | ALTO | contexto pessoal isolado reutilizando core | P1 | R1 |
| A05 | Técnico independente | D | [CONFIRMADO 11:33–13:21] clientes, orçamento, Produção, WEEKLOG, Lista, fatura e financeiro próprios | SIM | NÃO | peças separadas, sem aggregate pessoal | ADAPTAR | MÉDIO | compor a fatia no contexto técnico | P1 | R1 |
| A06 | Técnico independente | D | [CONFIRMADO 12:27–13:21] não possuir hierarquia completa de empregados | PARCIAL | NÃO | nenhuma restrição de domínio explícita | ADAPTAR | MÉDIO | perfil/capabilities sem People administrativo | P1 | R1 |
| A07 | Técnico vinculado | E | [CONFIRMADO 15:00–16:13] ver apenas trabalhos e WEEKLOG próprios | SIM | PARCIAL | policy `own`; queries confiam em filtros | CORRIGIR | ALTO | filtro server-side por identidade | P0 | R0 |
| A08 | Técnico vinculado | E | [CONFIRMADO 15:00; PREFERÊNCIA final 19:00] ver suas Listas/status e financeiro, nunca agregado | SIM | PARCIAL | `PaymentOrder`/finance sem escopo uniforme | CORRIGIR | ALTO | projeção financeira própria e campos reduzidos | P0 | R0 |
| A09 | Sócio/parceiro | F | [CONFIRMADO 18:02–18:49; 48:24–49:47] participar do trabalho e receber acesso concedido | SIM | SIM | role `partner`; participante textual | ADAPTAR | MÉDIO | vincular pessoa/parte ao trabalho e tenant | P1 | R2 |
| A10 | Cliente | G | [CONFIRMADO 32:58–36:58] ser convidado por empresa cliente e acessar só operação própria | SIM | PARCIAL | `Client/BillingClient` + membership `client` | ADAPTAR | MÉDIO | cliente canônico, convite e projeção operacional | P1 | R1 |
| A11 | Colaborador do cliente | H | [CONFIRMADO 27:00–36:58] delegar gerente, recepção, RH, validação, Lista e documentos | NÃO | NÃO | sem relação cliente→colaborador→capacidade | IMPLEMENTAR MÍNIMO | BAIXO | papel/capacidades e escopo por cliente/local | P1 | R1 |
| O01 | Orçamento | D/E/B | [CONFIRMADO 20:44–21:26] criar e persistir orçamento | SIM | PARCIAL | `localStorage` + dados em `ProductionOrder.notes` | CORRIGIR | ALTO | entidade/versão persistente | P1 | R1 |
| O02 | Orçamento | G | [CONFIRMADO 20:44–21:26] aprovar e confirmar orçamento | SIM | NÃO | assinatura/estado apenas no frontend | ADAPTAR | ALTO | ator autorizado, evento e persistência | P1 | R1 |
| O03 | Orçamento | D/E/G | [CONFIRMADO 20:44–21:26] alterar aprovado e reenviar para aprovação | PARCIAL | NÃO | aprovado é hard-lock no `BudgetPanel` | ADAPTAR | MÉDIO | reabrir por nova revisão e reenviar | P1 | R1 |
| O04 | Orçamento | D/E/G | [CONFIRMADO por aceite; derivação de auditabilidade] preservar versão anterior com baixa complexidade | NÃO | NÃO | não há histórico de versões | IMPLEMENTAR MÍNIMO | BAIXO | `BudgetRevision`/snapshot + ator/data | P1 | R1 |
| O05 | Orçamento/PDR | D/E | [CONFIRMADO 1:20:59] dados, placa/chassi e fotos no fluxo móvel | SIM | SIM | OP/fotos em Prisma/MinIO; OCR parcial | INTEGRAR | ALTO | ligar captura, identificação e orçamento | P1 | R1 |
| O06 | Produção | D/E/B | [CONFIRMADO 11:33; 1:20:59] criar OP diretamente sem orçamento | SIM | SIM | `ProductionOrder` REST/Prisma | PRESERVAR | ALTO | gate tenant/runtime, sem reconstruir | P1 | R1 |
| O07 | Produção | D/E/B | [CONFIRMADO 12:27; 1:20:59] orçamento aprovado inicia Produção | SIM | SIM | evento local cria OP; mapa em localStorage | INTEGRAR | ALTO | transação/API idempotente | P1 | R1 |
| O08 | Produção | D/E/B | [CONFIRMADO 21:26; 24:14] estados produção/pausa/finalização | SIM | SIM | status Prisma + board | PRESERVAR | ALTO | validar persistência e transições | P1 | R1 |
| O09 | Produção | D/E/B | [CONFIRMADO 24:14–26:32] técnico, cliente, veículo, placa, chassi, Local e fotos | SIM | PARCIAL | campos existem; `Location` não se relaciona | INTEGRAR | ALTO | FKs canônicas e ownership de foto | P1 | R1 |
| O10 | Produção | todos | [CONFIRMADO pelo retorno/retificação] histórico cronológico mínimo | SIM | NÃO | timeline desabilitada/retorna vazio | CORRIGIR | MÉDIO | eventos persistentes e leitura | P1 | R1 |
| O11 | WEEKLOG | D/E | [CONFIRMADO 21:26; 24:14; 55:05] finalização gera WEEKLOG semanal | SIM | SIM | hook `ProductionOrder→ServiceOrder` | CORRIGIR | ALTO | atomicidade, idempotência e tenant | P1 | R1 |
| O12 | WEEKLOG | G/H | [CONFIRMADO 27:00–36:58] cliente/chefe autorizado valida | SIM | PARCIAL | validação em JSON, sem vínculo com cliente | ADAPTAR | ALTO | autorização por cliente/local e evento imutável | P1 | R1 |
| O13 | WEEKLOG | G/H | [CONFIRMADO 22:39–24:06] aceitar assinatura desenhada **ou** confirmação autenticada | SIM | PARCIAL | checkbox e responsável em JSON | ADAPTAR | ALTO | confirmação ligada à sessão; desenho opcional | P1 | R1 |
| O14 | WEEKLOG | E | [CONFIRMADO 15:00–16:13] técnico vê apenas seu WEEKLOG | SIM | PARCIAL | policy `own` sem filtro obrigatório | CORRIGIR | ALTO | escopo `assignedUserId` no servidor | P0 | R0 |
| O15 | Retificação | D/E/B/G | [CONFIRMADO 24:14–26:32] problema antes da Lista retorna ao mesmo trabalho em Produção | PARCIAL | PARCIAL | campos de retificativa; sem transição completa | INTEGRAR | MÉDIO | comando de retorno e novo ciclo WEEKLOG | P1 | R1 |
| O16 | Retificação | B/G | [CONFIRMADO 1:04:13–1:07:54] desconto/retífica pode surgir na Lista depois | NÃO | NÃO | reconciliação genérica não reabre Produção | IMPLEMENTAR MÍNIMO | BAIXO | registrar contestação e retornar opcionalmente | P1 | R2 |
| O17 | Retificação | D/E/B | [CONFIRMADO 26:09–26:32; 1:05:18] manter origem, motivo, sinalização e permitir trocar técnico | PARCIAL | NÃO | texto/flag em JSON, sem relação canônica | IMPLEMENTAR MÍNIMO | BAIXO | vínculo `originalWorkId`, motivo e reassignment | P1 | R1 |
| O18 | Importação WEEKLOG | B/D | [CONFIRMADO 55:05–1:00:58] upload externo, extração, revisão e dados estruturados | SIM | SIM | upload/extract + `ServiceOrder` | INTEGRAR | ALTO | fechar pipeline e persistência/reload | P1 | R1 |
| O19 | Importação WEEKLOG | B/D | [CONFIRMADO 1:00:00–1:00:58] importado pode entrar como já validado | SIM | PARCIAL | importação não garante regra canônica | ADAPTAR | MÉDIO | flag/proveniência + autorização | P1 | R1 |
| O20 | Lista | B/D/E/G | [CONFIRMADO 55:05–59:40] entidade distinta, agrupa trabalhos reconhecidos e pode cruzar semanas | PARCIAL | PARCIAL | `ProductionList` só status; `listName` em `PaymentOrder` | IMPLEMENTAR MÍNIMO | MÉDIO | aggregate Lista + itens N:N/1:N sem vínculo semanal obrigatório | P1 | R2 |
| O21 | Lista | B/G | [CONFIRMADO 1:00:58–1:02:48] criar/importar Lista manual com revisão | SIM | PARCIAL | importador e extração reutilizáveis | INTEGRAR | ALTO | tipo de documento + commit transacional | P1 | R2 |
| O22 | Lista | B/D | [CONFIRMADO 1:00:58] numeração `L` + seis dígitos/sequência | SIM | SIM | gerador existente | PRESERVAR | ALTO | desvincular semana sem perder sequência | P1 | R2 |
| O23 | Lista | B/D/E/G | [CONFIRMADO 19:00; 50:14–51:28] pendente e pago | SIM | SIM | status em `PaymentOrder/ProductionList` | INTEGRAR | ALTO | tornar status da Lista a fonte canônica | P1 | R2 |
| O24 | Lista | E | [CONFIRMADO/PREFERÊNCIA final 19:00] técnico vê só sua parte e status | SIM | PARCIAL | filtros opcionais e projeção agregada | CORRIGIR | ALTO | escopo server-side e DTO reduzido | P0 | R0 |
| O25 | Lista/fatura | B/D/G | [CONFIRMADO 12:27; 35:31–36:58] Lista alimenta fatura/documento do cliente | SIM | PARCIAL | billing separado de `ProductionList` | INTEGRAR | MÉDIO | ligação explícita e estado de emissão | P1 | R2 |
| O26 | Confronto | B/G | [CONFIRMADO 54:29–1:02:48] comparar executado × reconhecido por serviço, valor e veículo | SIM | SIM | `Reconciliation`/finance global, matching parcial | ADAPTAR | ALTO | escopar e usar itens WEEKLOG/Lista | P1 | R2 |
| O27 | Confronto | B/G | [CONFIRMADO 1:01:48–1:02:48] ocorrer durante revisão da Lista antes da validação | SIM | SIM | tela em Financeiro, endpoint separado | INTEGRAR | ALTO | reutilizar motor dentro do importador | P1 | R2 |
| FIN01 | Distribuição | B/F | [CONFIRMADO 48:24–49:47] participantes técnico, empresa, sócio, cliente e parceiro | SIM | SIM | regras/itens não plenamente tenant-scoped | ADAPTAR | ALTO | participantes canônicos por trabalho | P1 | R2 |
| FIN02 | Distribuição | B | [CONFIRMADO 49:21–49:47] preenchimento manual por enquanto | SIM | SIM | UI cria regras persistentes/reutilizáveis | ADAPTAR | ALTO | aplicar manualmente sem engine automática complexa | P1 | R2 |
| FIN03 | Esperado | B/D/E/F | [CONFIRMADO corrigido 50:14–51:28] Lista validada e pendente | SIM | SIM | cálculo atual soma `ServiceOrder` | ADAPTAR | ALTO | derivar de Lista pendente, não WEEKLOG | P1 | R2 |
| FIN04 | Recebido | B/D/E/F | [CONFIRMADO 50:14–51:28] somente Lista marcada paga | SIM | SIM | cálculo soma todas `PaymentOrder`, sem filtrar pago | CORRIGIR | ALTO | filtrar estado canônico pago | P1 | R2 |
| FIN05 | Caixa | B/D/E/F | [CONFIRMADO 52:09–53:40] recebido − despesas = disponível | SIM | SIM | fórmula existe com base recebida incorreta | INTEGRAR | ALTO | conectar às fontes corrigidas e ledger | P1 | R2 |
| FIN06 | Despesas | B/D/E | [CONFIRMADO 45:45–47:43; 51:35] categorias e vínculo a técnico/operação | SIM | SIM | `FinancialRecord.category/assignedUserId` | INTEGRAR | ALTO | catálogo mínimo, FK e tenant | P1 | R2 |
| FIN07 | Obrigações | B/D/E/F | [CONFIRMADO 52:32–54:14] registrar pagamento quando houver disponível; sem periodicidade fixa | SIM | PARCIAL | lançamentos/regras sem ciclo canônico | CORRIGIR | MÉDIO | obrigação/pagamento auditável e saldo | P1 | R2 |
| PD01 | File Manager | C–H | [CONFIRMADO 39:00–41:47; 1:06:00] pasta, subpasta, mover, renomear, upload e download | SIM | SIM | `Document.parentId` + MinIO; telas híbridas | INTEGRAR | ALTO | ligar UI global ao REST/MinIO único | P2 | R3 |
| PD02 | Documentos | C–H | [CONFIRMADO 39:00–41:47] compartilhar/visibilidade por pessoa autorizada | PARCIAL | NÃO | `workspaceId/entityType`, sem ACL por objeto | IMPLEMENTAR MÍNIMO | MÉDIO | ACL mínima ou grants por pessoa/cliente | P2 | R3 |
| PD03 | Documentos | C/D/E/H | [CONFIRMADO 37:27–41:47] identificação, morada, seguro, contrato e docs operacionais | SIM | SIM | `Document` + requisitos de país | PRESERVAR | ALTO | restringir primeiro ao conjunto core | P2 | R3 |
| PD04 | Documentos por país | C/H | [CONFIRMADO 44:01–45:11] preservar lógica útil dentro de RH/File Manager | SIM | SIM | catálogo global + página lateral | ADAPTAR | ALTO | incorporar checklist sem duplicar storage | P2 | R3 |
| PD05 | RH | C | [CONFIRMADO 16:13; 37:08–41:47] cadastro interno mínimo: dados, função, contato, documento, status/contrato | SIM | SIM | `Person`, documentos e localização | ADAPTAR | ALTO | remover tipos externos e compor acesso opcional | P2 | R3 |
| PD06 | RH completo | C | [FUTURO/fora do escopo 16:13; 1:26:00] férias, ponto, recrutamento e avaliação | NÃO | NÃO | ausente | FUTURO | BAIXO | não incluir no MVP | P3 | FUTURO |
| PD07 | Documento técnico | D/E/H | [CONFIRMADO 37:27–41:47] cliente acessa somente documento autorizado do técnico | SIM | PARCIAL | storage por workspace sem grant explícito | ADAPTAR | MÉDIO | grant por documento/pasta e auditoria | P2 | R3 |
| PD08 | Colaborador cliente | H | [CONFIRMADO 35:31–38:16] RH documental e validações sem folha/contabilidade interna | NÃO | NÃO | ator ausente | IMPLEMENTAR MÍNIMO | BAIXO | capacidades mínimas no contexto do cliente | P1 | R1 |
| PD09 | Navegação docs | C/H | [CONFIRMADO 44:01–45:11] retirar “Documentos por País” como módulo lateral isolado | SIM | SIM | rota/menu próprios | OCULTAR/REMOVER | ALTO | ocultar navegação após integrar a lógica | P2 | R3 |
| LM01 | Local | A/G | [CONFIRMADO 1:08:48–1:11:40] representar oficina, plataforma ou ponto operacional | SIM | SIM | `Location` REST/Prisma | ADAPTAR | ALTO | semântica e vínculos canônicos | P2 | R3 |
| LM02 | Gerente | A/G/H | [CONFIRMADO 1:09:53–1:11:40] campo manual e, preferencialmente, colaborador relacionado | SIM | PARCIAL | nome/contato livres | ADAPTAR | ALTO | manter fallback manual + FK opcional | P2 | R3 |
| LM03 | Local | A/G | [CONFIRMADO 1:09:53–1:15:29] status e coordenadas para operação/mapa | PARCIAL | PARCIAL | ativo/inativo; sem lat/lng | INTEGRAR | MÉDIO | ativo/pausado/encerrado + coordenadas | P2 | R3 |
| LM04 | Local | A/D/E/G/H | [CONFIRMADO 1:09:53–1:15:29] relacionar cliente, workspace, técnico/equipe e gerente | NÃO | NÃO | somente `Person.locationId` | IMPLEMENTAR MÍNIMO | BAIXO | relações mínimas, sem novo GIS | P2 | R3 |
| LM05 | Mapa | A/G | [CONFIRMADO 1:11:40–1:20:04] mapa único com Locais, operações, equipes/técnicos e status | SIM | PARCIAL | mapa usa ServiceOrder/cidade/jitter e eventos | INTEGRAR | ALTO | projetar dados reais de `Location` | P2 | R4 |
| LM06 | Mapa | A/G | [CONFIRMADO 1:19:28–1:20:04] azul sem operação, verde ativa, amarelo pausada, vermelho encerrada | SIM | NÃO | cores não derivam de status de Local | ADAPTAR | ALTO | mapping simples e legenda | P2 | R4 |
| LM07 | PDR Intel/granizo | A/D | [CONFIRMADO 1:11:40–1:13:52] preservar mapa, PDR Intel e eventos meteorológicos | SIM | SIM | `HailEvent/HailReport`, weather e mapa | PRESERVAR | ALTO | validar provedores/tenant sem redesenhar UI | P2 | R4 |
| LM08 | Granizo | A/D | [CONFIRMADO 1:13:21–1:13:52] relato manual, localização, severidade, fotos e dados automáticos | SIM | SIM | rotas/modelos parciais e egress externo | INTEGRAR | ALTO | ownership de foto, quota e estado vazio | P2 | R4 |
| UX01 | Automação | A/B | [CONFIRMADO 42:32–42:55] retirar/ocultar o módulo atual | SIM | SIM | rota/menu e telas expostas | OCULTAR/REMOVER | ALTO | ocultar sem apagar código nesta onda | P1 | R1 |
| UX02 | BI | A/B | [PREFERÊNCIA 43:00] métricas são interessantes, mas não fechadas | PARCIAL | NÃO | dashboards dispersos | FUTURO | MÉDIO | não ampliar MVP | P3 | FUTURO |
| UX03 | Marketplace | todos | [FUTURO 1:21:42; 1:26:00] menor relevância agora | SIM | NÃO | UI/Supabase residual | FUTURO | MÉDIO | manter fora do core e da navegação priorizada | P3 | FUTURO |
| UX04 | Billing SaaS | A/D | [FUTURO 1:23:04–1:23:35] uso livre primeiro; provedor de assinatura ainda indeciso | SIM | SIM | Stripe já integrado parcialmente | FUTURO | ALTO | não ativar cobrança; reavaliar provedor depois | P3 | FUTURO |
| UX05 | Responsividade | D/E/G/H | [CONFIRMADO 1:20:59; 1:24:30–1:26:00] uso forte em telefone/tablet pela web | PARCIAL | N/A | CSS responsivo heterogêneo; câmera web existe | ADAPTAR | ALTO | QA mobile da fatia MVP e alvos de toque | P1 | R1 |
| UX06 | App nativo | D/E | [FUTURO/descartado para agora 1:24:30–1:26:00] não criar app nesta fase | NÃO | NÃO | ausente | FUTURO | NENHUM | web responsiva é suficiente | P3 | FUTURO |
| UX07 | Tema | todos | [CONFIRMADO 1:24:12–1:24:30] corrigir light mode e contraste impeditivo | SIM | N/A | tokens/estilos frontend | CORRIGIR | ALTO | auditoria visual mobile/dark/light do MVP | P1 | R1 |
| UX08 | Marca | todos | [CONFIRMADO 1:17:00–1:18:22] QW Nexus/WorkNexus → Operix | SIM | N/A | strings/assets residuais | CORRIGIR | ALTO | inventário e troca consistente sem alterar autoria | P1 | R1 |

### Falas que não viraram requisito automático

| Faixa | Classificação | Conteúdo | Tratamento |
|---|---|---|---|
| 29:42–34:40 | EXPLORAÇÃO | um usuário de cliente poderia criar várias empresas abaixo dele | não entra no target |
| 34:46–35:24 | DESCARTADO | Alex pede para esquecer a estrutura anterior; cada empresa cliente segue convite/cadastro próprio | prevalece a correção final |
| 43:00–43:55 | PREFERÊNCIA | BI pode ser interessante | orientação futura, sem obrigação |
| 1:15:30–1:20:30 | PREFERÊNCIA | linhas de conexão e mapa mais apresentável | caminho simples; sem GIS/3D no core |
| 1:23:04–1:23:35 | EXPLORAÇÃO/FUTURO | Stripe foi apenas a opção pesquisada; cobrança será decidida depois | não ativar cobrança nem fechar provedor agora |

## 5. Operação

### Cliente

Há cadastro, billing client, role `client` e convites, mas não um cliente canônico. O mínimo é escolher uma identidade empresarial de cliente, vinculá-la ao workspace prestador, permitir colaboradores convidados e projetar somente a operação desse cliente. A proposta intermediária de “cliente cria várias empresas” foi explicitamente descartada.

### Técnico

A aba pública de técnico independente e o papel `technician` são reaproveitáveis. O gap não é uma nova tela: é oferecer um contexto pessoal isolado aos módulos que hoje exigem `workspaceId`. Para o técnico vinculado, a prioridade é enforcement server-side de `own`; esconder a UI sem filtrar o banco não satisfaz a regra.

### Orçamento/PDR

O editor visual, cálculo, PDF, assinatura, OCR e conversão existem. O bloqueio é `localStorage` e o hard-lock de aprovado (`BudgetPanel.tsx:278–328`). A menor adaptação é persistir orçamento e revisões, manter a versão aprovada anterior e reenviar a nova revisão. Ficha PDR avançada por peça e IA visual continuam fora do MVP.

### Produção

`ProductionOrder`, board, fotos, criação direta e conversão por orçamento são ativos de alto reuso. Devem receber relações canônicas com técnico, cliente e Local, histórico funcional e autorização tenant/object. O endpoint atual aceita `workspace_id` do corpo e atualiza por `id`, logo o visual não basta como controle.

### WEEKLOG

O hook de Produção finalizada para `ServiceOrder` existe e tenta idempotência por `serviceOrderId`. A validação eletrônica possui responsável, data, situação e histórico em JSON. Faltam: validador pertencente ao cliente/local correto, escopo técnico real, transação/estado recuperável e distinção semântica definitiva entre WEEKLOG e `ServiceOrder`.

### Retificação

Há campos/visual de retificativa e detecção de semana de retificação, mas não o ciclo de domínio. O mínimo é um comando que preserve `originalWorkId`, motivo, ator e técnico anterior/novo; retorne a OP; e gere novo WEEKLOG vinculado. Contestação posterior da Lista precisa usar o mesmo vínculo, sem um workflow builder.

### Lista

O código atual cria uma `PaymentOrder` e um `listName` após validar cada WEEKLOG; o nome inclui semana e cada conversão tende a gerar nova sequência. Isso conflita com a Lista da reunião, que agrupa trabalhos reconhecidos pelo cliente e pode cruzar semanas. `ProductionList` pode ser reaproveitada como cabeçalho, mas precisa de itens explícitos e vínculo com fatura/estado de pagamento.

### Confronto

`Reconciliation`, motor de matching e telas de divergência são alto reuso. A mudança é de contexto e fonte: confrontar itens do WEEKLOG executado com itens da Lista importada, dentro da revisão da Lista e antes da validação, mantendo decisão humana.

### Importação

Upload, câmera, fila, preview, rotação, zoom, OCR, tabela editável, até quatro serviços e aplicação em lote já existem visualmente. A fatia deve remover caminhos noop, persistir o documento e a extração, diferenciar tipo WEEKLOG/Lista e registrar proveniência/validação humana.

## 6. Financeiro

### Distribuição

Manter a UI e os cálculos, mas não transformar `ProfitRule` em engine automática. A distribuição inicial é manual por Lista/trabalho e pode incluir técnico, empresa, sócio, cliente e parceiro.

### Esperado

O backend atual soma `ServiceOrder.total` (`finance.ts:931`), contrariando a correção explícita de Alex aos `50:14–51:28`. Deve somar apenas Listas validadas pendentes.

### Recebido

O backend soma todas as `PaymentOrder` (`finance.ts:932`), sem restringir status pago. A fonte precisa ser a Lista canônica marcada como paga.

### Caixa

A fórmula recebido − despesas já aparece no frontend e backend. O trabalho é integrar fontes corretas e garantir que pagamentos gerem eventos/ledger sem dupla contagem.

### Despesas

`FinancialRecord` possui tipo, categoria, referência e `assignedUserId`. Faltam catálogo mínimo consistente, relações com técnico/operação/Lista e tenant obrigatório.

### Obrigações

O sistema possui telas de distribuição, detalhamento e registros; falta um ciclo canônico que converta saldo disponível em obrigação/pagamento auditável. Não deve haver periodicidade fixa.

## 7. Pessoas e documentos

Reaproveitar `PeoplePage`, `Person`, `Document`, `CountryDocumentRequirement`, MinIO e `EmbeddedFileManager`. Separar três contextos: colaborador interno; técnico/prestador; colaborador do cliente. Cargo de RH não deve conceder automaticamente permissão e membership não deve criar pessoa implicitamente.

O File Manager precisa primeiro de ownership e ACL; só depois a tela global deve ser religada. O catálogo por país continua útil para checklist/validade, mas sua rota lateral deve ser ocultada após a integração em Pessoa/File Manager. Retenção e descarte legal continuam decisão posterior; nada deve ser apagado por inferência.

## 8. Locais e mapa

`Location` já guarda endereço, contato, gerente textual e status ativo/inativo. A adaptação mínima adiciona coordenadas, estados ativo/pausado/encerrado, cliente/workspace e relações operacionais; mantém gerente textual como fallback e adiciona relação opcional com colaborador.

O mapa único, layers, MapLibre, radar e hail models devem ser preservados. A fonte atual de operações usa `CITY_COORDS` e jitter sobre texto de `ServiceOrder`; isso não pode representar localização real. R4 troca a fonte por projeção tenant-safe de `Location`, aplica as quatro cores e, se barato, desenha relações simples. Mapa-múndi 3D, roteamento visual sofisticado e animações avançadas ficam fora do core.

## 9. Módulos futuros

- BI avançado;
- Marketplace;
- workflow/automação configurável;
- app nativo;
- billing SaaS definitivo e escolha do provedor;
- PDR visual avançado/IA de dano;
- conexões/GIS avançados;
- RH completo.

O módulo atual de Automação e a navegação lateral de Documentos por País devem ser **ocultados**, não apagados nesta etapa. Stripe deve permanecer desativado para cobrança real até decisão futura; qualquer teste posterior deve usar sandbox.

## 10. MVP operacional recomendado

```text
Técnico autenticado (mobile)
→ contexto próprio ou workspace autorizado
→ placa/chassi + veículo + fotos
→ orçamento versionado OU OP direta
→ Produção e estados
→ finalização idempotente
→ WEEKLOG semanal
→ cliente/colaborador autorizado confirma ou assina
→ Lista com itens reconhecidos (inclusive multissemanas)
→ confronto/revisão quando importada
→ pendente/paga
→ financeiro próprio e do workspace conforme papel
```

Critérios de aceite transversais: reload preserva dados; tenant A não alcança B; linked technician vê somente `own`; cliente não recebe financeiro interno; efeitos repetidos não duplicam; documentos/fotos respeitam ownership; erros são visíveis e recuperáveis; fluxo essencial funciona em telefone/tablet.

## 11. O que NÃO precisa ser reconstruído

1. design system, shell, rotas e grande parte das páginas React;
2. autenticação bcrypt/JWT como ponto de partida, após corrigir bootstrap/sessão;
3. Workspace, Membership, convite, switcher e catálogo de permissões;
4. UI/REST/Prisma de `ProductionOrder` e board;
5. editor de orçamento, PDF, captura de foto e componentes PDR existentes;
6. upload, preview, rotação, zoom, OCR, tabela editável e correção em lote;
7. `ServiceOrder`, `PaymentOrder`, `ProductionList` e `Reconciliation` como material de migração semântica;
8. telas/cálculos financeiros e `FinancialRecord`;
9. `Person`, `Location`, catálogo documental, MinIO e File Manager;
10. mapa único, MapLibre, layers, PDR Intel e modelos de granizo;
11. i18n, dark mode e infraestrutura de documentos;
12. gateways SMTP, IA, clima, ORS e Stripe, somente quando a fatia os exigir.

## 12. O que realmente precisa ser construído

Os **8 IMPLEMENTAR MÍNIMO** são:

1. ator e capacidades do colaborador do cliente;
2. histórico/revisão persistente de orçamento aprovado;
3. retificação posterior originada na Lista;
4. vínculo canônico da retificação ao trabalho original;
5. aggregate Lista com itens e suporte multissemanas;
6. ACL/grant documental por pessoa/cliente;
7. colaborador do cliente para RH documental/validações sem financeiro interno;
8. relações mínimas de Local com cliente, workspace, equipe/técnico e gerente.

Mesmo esses itens devem ser construídos sobre componentes/modelos existentes quando possível. “Implementar mínimo” não autoriza um novo ERP, workflow builder ou plataforma de GIS.

### Redesenhos estruturais realmente necessários

Embora `REDESENHO` não seja um estado permitido na matriz, oito núcleos exigem mudança estrutural dentro de itens `ADAPTAR`, `INTEGRAR` ou `IMPLEMENTAR MÍNIMO`:

1. autoridade de plataforma × workspace e `TenantContext`;
2. contexto isolado do técnico independente;
3. identidade canônica de cliente e colaboradores do cliente;
4. orçamento persistente com revisão após aprovação;
5. separação WEEKLOG × Lista e cardinalidade multissemanas;
6. fontes canônicas do financeiro esperado/recebido/caixa;
7. ownership e grants de documentos/fotos;
8. `Location` como fonte real do mapa e das relações operacionais.

Não exigem redesenho integral: shell/UX, board de Produção, importador, motor de confronto, File Manager, mapa, granizo, componentes financeiros e gateways externos.

## 13. O que deve ser retirado do escopo agora

- tornar todos os módulos do menu funcionais;
- automações configuráveis e workflow builder;
- BI avançado;
- Marketplace;
- cobrança SaaS definitiva;
- app nativo;
- RH completo;
- PDR/IA avançados por peça;
- mapa 3D/GIS/linhas sofisticadas;
- refatoração horizontal e limpeza estética sem fechar uma fatia;
- rotação de credenciais, deploy, migrations ou testes em produção nesta validação.

## 14. Sequência recomendada

| Ordem | Release | Resultado |
|---:|---|---|
| 1 | R0 — Fundação segura | bootstrap, papéis, TenantContext, object auth, baseline, ownership, erros e testes A/B |
| 2 | R1 — Operação móvel | técnico independente/vinculado, cliente convidado, orçamento/revisão, OP, fotos, WEEKLOG, validação e retificação pré-Lista |
| 3 | R2 — Lista e financeiro essencial | Lista multissemanas, importação/confronto, pendente/paga, distribuição manual, esperado/recebido/caixa/despesas/obrigações |
| 4 | R3 — Apoio ao core | colaboradores internos/do cliente, documentos/ACL, integração por país e Locais relacionados |
| 5 | R4 — Mapa/PDR Intel | Locations reais, status/cores, radar/granizo e relações simples |
| 6 | Futuro | BI, Marketplace, billing SaaS, app nativo, RH/PDR/IA/GIS avançados |

R0 não é uma fase de “modernização”: deve ser implementado em pequenas fundações ligadas às verticais R1/R2. R1 e R2 formam a primeira entrega comercial; R3 pode ser antecipada apenas quando um documento, colaborador ou Local for pré-condição direta do fluxo.

### Referencial

A classificação e a sequência seguem rastreabilidade e verificabilidade de requisitos (ISO/IEC/IEEE 29148), adequação funcional, segurança e manutenibilidade (ISO/IEC 25010), segregação de acesso e autorização por objeto (OWASP ASVS e OWASP API Security Top 10), invariantes de aggregate/bounded context (Evans/Vernon) e migração incremental por fatias, sem big-bang (Fowler). Evidência estática, observação visual e runtime foram mantidos separados para evitar falsa comprovação.
