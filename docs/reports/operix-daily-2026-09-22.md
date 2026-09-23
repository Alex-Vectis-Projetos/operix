# Operix Core — Daily / Contract Alignment Checkpoint

**Data:** 2026-09-22
**Branch auditada:** `feat/004-payment-list-confrontation`
**Checkpoint remoto revisado:** `b658bc75e34c09746ab976656c42162df86f4a95`
**Escopo desta rodada:** rastreabilidade e alinhamento; nenhuma alteração de produto, schema, migration ou testes.

## 1. Executive Summary

As quatro fatias de engenharia do Core foram concluídas no branch: fundação e autoridade (Spec001), operação móvel e orçamento/produção (Spec002), WEEKLOG/validação/retificação (Spec003) e Lista/Confronto (Spec004). A Spec004 está publicada no `origin` no mesmo SHA local e não houve merge para `main` ou `develop/operix-core`.

O produto está alinhado, **para as fontes disponíveis**, com o fluxo acordado de técnico/empresa -> orçamento ou OP -> WEEKLOG -> validação -> Lista multissemanal -> confronto -> `pending`/`paid`. O Financeiro Essencial ainda não foi implementado; é o próximo domínio a ser descoberto, não iniciado.

Os instrumentos comerciais — contrato Fase 1 assinado, anexos e proposta aceita — não estão versionados neste checkout. Contudo, a gestão os revisou externamente contra este checkpoint técnico e concluiu que as Specs001–004 estão materialmente alinhadas ao escopo contratado da Fase 1. Contrato e anexos continuam sendo a autoridade máxima de negócio caso haja conflito com documentos do repositório. `docs/Relatorio_Plano_de_Ataque_QW_Nexus.pdf` é apenas plano técnico e não foi usado como substituto comercial.

**Parecer:** **OPERIX CONTRACTUALLY ALIGNED — SPEC 005 DISCOVERY READY, WITH FINANCE CLARIFICATIONS & HOMOLOGATION DEPENDENCIES OPEN.** Financeiro Essencial não está implementado; homologação, staging e release continuam pendentes.

### Confirmação contratual externa da gestão

A Fase 1 está organizada em: (1) fundação técnica; (2) operação móvel/Core; (3) Lista, Confronto e Financeiro Essencial; e (4) homologação, documentação e release controlado. A direção contratada é **recuperar, integrar e completar a base existente**, não reescrever o Operix do zero.

O escopo confirmado de operação inclui contexto de usuário/workspace/técnico, veículo por matrícula/placa ou VIN/chassi, fotos, Budget persistente e revisável, ProductionOrder direta ou derivada de Budget, ciclo de Produção, WEEKLOG, validação autorizada de cliente, retificação, importação externa de WEEKLOG, Core responsivo, correção de modo claro e limpeza de marca Operix. Lista/Financeiro inclui Lista distinta de WEEKLOG e multi-semanal, criação/importação/revisão, ciclo `pending`/`paid`, confronto executado versus reconhecido, distribuição manual, Expected de Lista validada pendente, Received de Lista paga, despesas, saldo disponível e obrigações/pagamentos sem periodicidade obrigatória. Não inclui ERP contábil completo, RH completo, plataforma genérica de automação, produto GIS, aplicativo nativo ou plataforma definitiva de billing SaaS.

## 2. What Changed Since Previous Report

- A Spec004 foi concluída e publicada: `PaymentList` tornou-se a autoridade comercial; `payment_orders` ficou projeção downstream somente-leitura.
- Importação externa passou a usar documento privado, SHA-256, staging relacional, revisão humana e commit explícito.
- O confronto passou a ocorrer em Operações, é versionado, tenant-scoped e compara veículo, serviços e valores; decisões humanas preservam a linhagem de retificação da Spec003.
- A rota estável `/payment-orders` passou a renderizar `PaymentListWorkspace`, sem mutação legada de PaymentOrder.
- Evidência T12: 47/47 critérios formais, 127/127 testes Spec004 e 213/213 regressões Specs001–003 em série; `prisma validate`, status/replay de 10 migrations, typechecks, lint e builds verdes.

## 3. Contract Alignment

### Matriz de rastreabilidade

| Requisito / frente | Fonte disponível | Implementação atual | Spec responsável | Status | Evidência | Gap / próxima ação |
|---|---|---|---|---|---|---|
| Sessão, tenant e autorização por objeto | `PROJECT.md` R0; ADR-001 | `RequestContext`, papel global separado de membership e filtros tenant em fatias migradas | 001 | COMPLETE — ENGINEERING | ADR-001; regressões A/B | Migrar módulos legados fora das fatias Core antes de liberá-los |
| Técnico independente e vinculado | Reunião 2, 11:33–16:13; ADR-002 | workspace pessoal idempotente; vinculado usa escopo `own` nas fatias operacionais | 001/002 | COMPLETE — ENGINEERING | ADR-002; testes Specs001–003 | Homologar com contas reais dos dois perfis |
| Persistência, banco e regressão | `PROJECT.md`; regras de engenharia | Prisma/PostgreSQL, migrations forward-only e suítes integradas | 001–004 | COMPLETE — ENGINEERING | replay T12 de 10 migrations | Corrida paralela de fixture precisa ser estabilizada (seção 8) |
| Storage de fotos/documentos no Core | `PROJECT.md`; Reunião 2, 39:00–41:47 | caminhos privados tenant-scoped e preview autenticado nas fatias migradas | 001/002/004 | COMPLETE — ENGINEERING | ADR-003/004; testes de import | ACL de documentos de RH/cliente permanece fora do Core atual |
| Orçamento persistente e revisável | Reunião 2, 20:44–21:26 | Budget e revisão persistidos, com reaprovação e ligação à OP | 002 | COMPLETE — ENGINEERING | commits Spec002; testes T12 regressivos | Smoke mobile com dados reais |
| Veículo, placa/VIN, fotos e OP direta/do orçamento | Reunião 2, 1:20:59 | produção canônica, serviço estruturado e fotos com autoridade server-side | 002 | COMPLETE — ENGINEERING | Spec002/ADR-003 | Homologar câmera e conectividade móvel |
| WEEKLOG, validação do cliente e retificação | Reunião 2, 22:39–26:32 | WEEKLOG semanal, confirmação autenticada/PNG, grant de validador e retificação versionada | 003 | COMPLETE — ENGINEERING | ADR-003; 99/99 isolados e regressão serial | Amostras de WEEKLOG externo e contas de validador |
| WEEKLOG externo/manual | Reunião 2, 55:05–1:00:58 | ingestão governada sem OP fictícia e validação com cobertura congelada | 004 | COMPLETE — ENGINEERING | Spec004 import tests | Validar formatos reais de parceiros |
| Lista distinta e multissemanal | Reunião 2, 55:05–59:40; `DOMAIN.md` | `PaymentList` e itens, sem dependência de uma única semana | 004 | COMPLETE — ENGINEERING | ADR-004; 47/47 aceite | Homologar listas reais |
| Importação/OCR, provenance e revisão | Reunião 2, 1:01:48–1:02:48 | upload privado, hash, staging, correção e commit explícito | 004 | COMPLETE — ENGINEERING | ADR-004; 127/127 | Validar OCR contra amostras representativas |
| Confronto veículo/serviços/valor e decisão humana | Reunião 2, 54:29–1:07:54 | rodadas versionadas, decisão por resultado e retificação reutilizada | 004 | COMPLETE — ENGINEERING | ADR-004; `PaymentListWorkspace` | UI de leitura de rodadas antigas é gap não bloqueante |
| `pending`/`paid`, esperado e recebido | Reunião 2, 50:14–51:28; `DOMAIN.md` | Lista contém os estados; nenhuma escrituração financeira automática | 004 | COMPLETE — ENGINEERING | DEC-012/014; T12 | Implementar projeções financeiras na Spec005 |
| Despesas, disponível, distribuição e obrigações | Reunião 2, 45:45–54:14; `DOMAIN.md` | apenas fronteira explícita; não há novo ledger financeiro nesta entrega | 005 (a descobrir) | NEXT | ADR-004 limita Spec004 | Confirmar decisões financeiras antes da arquitetura |
| Responsividade, light mode e marca Operix | Reunião 2, 1:17:00–1:26:00 | componentes das fatias migradas são responsivos | 002–004 parcial | PENDING HOMOLOGATION | testes de contrato frontend | Auditoria visual completa de tema/marca ainda não foi provada |
| Staging, homologação, rollback e produção controlada | `PROJECT.md`; handoff Spec004 | nenhuma autorização de release foi emitida | pós-Spec005 | PENDING HOMOLOGATION | `handoff.md` da Spec004 | montar ambiente, roteiro, backup/rollback e evidências |

## 4. Meeting Alignment

| Decisão final de Alex | Estado | Fundamentação |
|---|---|---|
| Técnico independente opera em contexto próprio; vinculado vê somente o próprio | IMPLEMENTED | ADR-002 e RequestContext resolvem o contexto; Specs001–003 cobrem a fronteira |
| Cliente é convidado por empresa específica, sem hierarquia multiempresa | PARTIAL | A Spec004 não amplia cliente; o modelo mínimo de colaboradores do cliente permanece fora da fatia atual |
| Cliente não vê o financeiro interno | IMPLEMENTED no fluxo de Lista | DTO sanitizado para técnico e ausência de autoridade comercial para `ClientAccessGrant`; a revisão global do Financeiro legado permanece futura |
| Orçamento aprovado pode ser revisado e reenviado | IMPLEMENTED | Spec002 introduziu revisão persistente e reaprovação |
| WEEKLOG é semanal; Lista é comercial e pode cruzar semanas | IMPLEMENTED | ADR-003/004 e modelo `PaymentList` |
| Validação aceita confirmação autenticada ou assinatura | IMPLEMENTED | Spec003 controla ambos os meios e o validador autorizado |
| Retificação pode nascer antes ou depois da Lista | IMPLEMENTED | Spec003 reabre a OP; Spec004 dispara o comando canônico a partir da decisão comercial |
| Importação manual de WEEKLOG/Lista é possível e revisável | IMPLEMENTED | pipelines externos governados; sem auto-commit |
| Confronto pertence a Operações, não ao Financeiro | IMPLEMENTED | APIs canônicas em `/payment-lists`; leitura/execução legado de reconciliação responde `410` |
| Distribuição é manual; cadência de pagamento não é fixa | NEXT | Regra preservada como requisito de Spec005; não foi presumida nem automatizada |
| Disponível pode ser positivo ou negativo e usa recebido menos despesas | NEXT | fórmula documentada; ainda falta ledger/projeção canônica |
| RH mínimo, documentos por país, Locais/mapa e PDR | OUT OF SCOPE desta sequência Core | `PROJECT.md` e a constituição atual os mantêm fora da entrega oportunista; não foram reclassificados como bugs da Spec004 |

## 5. Engineering Evidence

- Spec001: autoridade server-side, RequestContext e isolamento; ADR-001.
- Spec002: Budget/OP/fotos e contexto operacional; commits `19b738f` a `7ed8169` no histórico da branch.
- Spec003: WEEKLOG, validação, PNG, grants e retificação; commits `705f416` a `0ef19d6`.
- Spec004: importação governada, PaymentList, claims, confronto e UI; commits `765f378` a `6676671`.
- Gates T12: `prisma validate`, migrations e replay clean database; builds root/backend, typechecks e lint. O banco de replay foi temporário e removido.
- Auditoria estática atual confirma `requireAuth` + `resolveRequestContext` em `paymentListsRouter`; rotas mutáveis legadas de `paymentOrders` retornam `410`; o motor comercial canônico está em `paymentListService`, `externalListImportService` e `confrontationService`.

## 6. Completed Scope

1. Fundamento de segurança necessário às quatro verticais Core, sem confiar em `workspaceId` do cliente nas rotas migradas.
2. Fluxo operacional persistente: orçamento/revisão, OP, fotos, finalização idempotente, WEEKLOG, validação e retificação.
3. Separação definitiva de WEEKLOG (executado) e Lista (reconhecido comercialmente).
4. Lista multissemanal, importação externa governada, claims anti-dupla cobrança, confronto e decisões humanas auditáveis.
5. Transição segura de compatibilidade: `service_orders` e `payment_orders` são projeções legadas; a jornada canônica não muta esses agregados.

## 7. Remaining Contracted Scope

### Estado por frente de Fase 1

| Frente | Status | Limite atual |
|---|---|---|
| Fundação e autoridade das verticais Core | COMPLETE — ENGINEERING | módulos legados fora das fatias seguem backlog de migração |
| Operação móvel Core | COMPLETE — ENGINEERING | requer homologação responsiva/autenticada e amostras reais |
| Lista e Confronto | COMPLETE — ENGINEERING | requer homologação de OCR/listas e leitura histórica futura |
| Financeiro Essencial | NEXT | Spec005 ainda não deve ser implementada sem discovery e decisões |
| Homologação, staging, documentação de operador e release | PENDING HOMOLOGATION | nenhum release de produção autorizado |

Os instrumentos comerciais permanecem fora do checkout, mas foram revisados externamente pela gestão contra este checkpoint. Contrato e anexos prevalecem sobre esta documentação se houver conflito.

## 8. Gaps / Risks / Technical Debt

| Item | Classificação | Tratamento |
|---|---|---|
| `GET-NO-WRITE-01` falha somente no `npm test` paralelo por fixture PostgreSQL compartilhada; passa isolado e no conjunto serial 213/213 | non-blocking legacy residue | serializar essas suítes ou isolar bases/fixtures antes do CI paralelo |
| Smoke autenticado owner/admin/técnico | homologation item | preparar fixtures e ambiente seguro |
| Documentos VECTIS/anônimos e casos de divergência reais | homologation item | obter amostras antes da liberação controlada |
| UI para leitura de rodadas históricas de confronto | non-blocking legacy residue | futura rota/UI somente leitura; não requerida pelo aceite atual |
| `useDashboardData.ts` lê agregado legado `payment_orders` via Supabase | post-Fase1 cleanup | retirar ou mover atrás de API canônica; não integra `PaymentListWorkspace` |
| Rotas e telas financeiras legadas continuam no código; endpoints de reconciliação comercial prioritários estão desativados por `410` | release blocker para Financeiro Essencial, não para Spec004 | discovery Spec005 deve substituir/retirar autoridade remanescente, não apenas criar nova UI |
| Status documental de Spec003 ainda contém material histórico “ready/T11 TODO” apesar da implementação e regressões posteriores | documentation gap | consolidar handoff/status das Specs001–003 antes do pacote final ao cliente |
| `docs/deploy-operix-pro.com.md` descreve deploy antigo e não prova staging, rollback nem release atual | release blocker | criar runbook controlado e validá-lo em staging |

## 9. Client Inputs Required

| Entrada | Estado | Quando necessária |
|---|---|---|
| WEEKLOGs e Listas representativos, anonimizados ou autorizados | still required | homologação de import/OCR e confronto |
| Casos reais de glosa, desconto, contestação e retificação | still required | homologação de decisões e linhagem |
| Política operacional de despesas e participantes de distribuição | still required | discovery da Spec005 |
| Exemplos de obrigação/pagamento, inclusive saldo negativo, parcial e reversão | still required | modelagem financeira antes de schema |
| Contas de owner/admin, técnico vinculado/independente e validador de cliente em staging | can wait until homologation | smoke autorizado e segregação de dados |
| Acesso/informação de deploy, backup e rollback | can wait until release planning | staging e release controlado |

## 10. Documentation / Handoff Status

**Presente e útil internamente:** visão de projeto/domínio, ADRs 001–004, Specs001–004, critérios de aceite, migrations, evidência de testes e handoff final da Spec004.

**A preparar antes da entrega ao cliente:** contrato/proposta anexados ou referenciados, status consolidado das Specs001–003, guia de operador para fluxo móvel/Lista, roteiro de homologação, matriz de ambientes, runbook de staging/release/rollback e critérios de aceite assináveis. A documentação atual é majoritariamente de engenharia; não é ainda um pacote de operação/entrega final.

## 11. Finance Discovery Readiness

O sistema está pronto tecnicamente para **discovery**, mas a Spec005 não está pronta para implementação por inferência. Já estão confirmados: distribuição manual; Expected a partir de Lista validada `pending`; Received a partir de Lista `paid`; Confronto como parte de Operações/Lista; obrigações sem cadência fixa; e disponível negativo representável. As decisões materiais que permanecem são:

1. se a criação de obrigação já reserva/reduz Disponível ou se somente a liquidação efetiva o reduz;
2. se o pagamento de distribuição/comissão é também uma Despesa ou uma liquidação distinta, sem dupla subtração;
3. se Fase 1 requer pagamento parcial de obrigação;
4. qual semântica de correção/reversão é exigida para Despesa e pagamento registrados incorretamente;
5. se há múltiplas moedas por visão financeira e, nesse caso, se totais separados sem FX são suficientes;
6. quais participantes não proprietários podem ver seu próprio saldo/distribuição, sem expor finanças internas;
7. exemplos reais para homologar essas decisões sem inventar regras.

## 12. Scope Guard

Não fazem parte desta próxima descoberta/implementação: Marketplace, BI avançado, automação/workflow genérico, app nativo, billing SaaS/Stripe em produção, RH completo, PDR/IA avançado, GIS/mapa 3D e uma plataforma de multiempresa para clientes. Constraints, FKs compostas, staging, hashes, versionamento e testes de isolamento são fundação justificada, não expansão de produto.

## Timeline / Delivery Health

O repositório contém referência histórica a uma janela de 30–40 dias em `projeto.md`, mas não traz início efetivo, horas aprovadas nem log de dias úteis confiável. Não é possível calcular prazo contratual ou declarar “adiantado” com rigor. Qualitativamente, a sequência de engenharia está alinhada: as quatro fatias Core foram fechadas antes da descoberta financeira. O risco de prazo agora está nas decisões e amostras do cliente, homologação e preparação de release.

## Recommended Next Step

Revisar este checkpoint com Alex/EverGreen, solicitar os insumos da seção 9 e realizar uma sessão curta para as decisões financeiras abertas. Após a revisão de discovery, produzir a Spec005 test-first; não iniciar implementação ainda.
