# Critérios de Aceite BDD — Spec 003: Conclusão de OP, WEEKLOG, Validação em Lote e Retificação Versionada

**Fatia**: R1 — Operação Móvel  
**Branch**: `feat/003-production-weeklog`  
**Base**: `develop/operix-core`  
**Data**: 2026-09-17  
**Total de Cenários**: 78 cenários de aceitação formal (45 base + 11 hardening T04 + 9 T05 + 2 hardening T05 + 11 hardening T06)  
*(Nota: A suíte de testes de integração executa 83 testes no total: 78 cenários comportamentais de aceitação + 5 testes puramente estruturais de schema/invariantes de banco)*  

---

## 1. Matriz de Cenários e Invariantes (78 Cenários Comportamentais)

| ID do Cenário | Invariante / Regra de Negócio | Comportamento Esperado |
|---|---|---|
| **FINALIZE-01** | Conclusão atômica de OP | Finalizar OP cria exatamente uma entrada no lote WEEKLOG correspondente. |
| **FINALIZE-IDEMPOTENT-01** | Idempotência de retry | Chamar a finalização repetidas vezes retorna o mesmo registro com HTTP 200 sem duplicações. |
| **FINALIZE-CONCURRENT-01** | Concorrência de rede móvel | Duas chamadas simultâneas com lock pessimista produzem exatamente 1 item no banco. |
| **TENANT-01** | Isolamento multi-tenant (BOLA/IDOR) | Usuário do Workspace B recebe HTTP 404/403 ao tentar visualizar ou validar WEEKLOG do Workspace A. |
| **TECH-OWN-01** | Visibilidade restrita do técnico | Técnico com `scope: own` só visualiza e opera suas próprias entradas de WEEKLOG atribuídas. |
| **WEEK-GROUP-01** | Agrupamento semanal canônico | Entradas concluídas no mesmo período semanal e mesmo cliente/oficina compartilham o mesmo `weeklogId`. |
| **WEEK-BOUNDARY-01** | Determinismo de fuso horário | A transição de Domingo 00:00:00 a Sábado 23:59:59 respeita o fuso horário configurado no workspace. |
| **SNAPSHOT-01** | Imutabilidade do snapshot executado | Modificações posteriores na `ProductionOrder` ou no `Budget` não alteram o snapshot congelado do WEEKLOG. |
| **VALIDATE-01** | Validação em lote com autoridade | Validador com capability `weeklog.validate` aprova o lote semanal gerando `WeeklogValidation` versionado. |
| **VALIDATE-FORBIDDEN-01** | Bloqueio de validador não-autorizado | Usuário sem grant formal do cliente recebe HTTP 403 Forbidden. |
| **SIGNATURE-01** | Assinatura manuscrita capturada | Upload de assinatura desenhada em canvas grava imagem no MinIO e vincula storagePath auditável ao lote. |
| **CONFIRMATION-01** | Confirmação eletrônica sem desenho | Validação autenticada sem assinatura gráfica registra o carimbo de sessão do validador. |
| **VALIDATED-IMMUTABLE-01** | Bloqueio de edição in-place | Tentativa de atualizar diretamente campos de um item com status `approved` retorna HTTP 409 Conflict. |
| **RECTIFICATION-01** | Preservação de histórico original | Solicitação de retificação mantém o registro original como histórico e reabre a OP para retrabalho. |
| **RECTIFICATION-REASON-01** | Auditoria e obrigatoriedade de motivo | Rejeição/retificação sem motivo formal é rejeitada com HTTP 400 Bad Request. |
| **RECTIFICATION-REVALIDATE-01** | Revalidação de retrabalho | O retrabalho concluído gera nova entrada de WEEKLOG que exige nova validação formal. |
| **NO-FINANCE-SIDE-EFFECT-01** | Fronteira estrita Spec 003 vs Spec 004 | A validação do WEEKLOG não cria `PaymentOrder`, não gera `listName` e não oculta o item da consulta. |
| **RELOAD-01** | Persistência relacional pura | Recarregar a página (F5) ou alternar de navegador preserva integralmente o estado validado. |
| **RECTIFICATION-SAME-WEEK-01** | Retificação na mesma semana | Re-finalização de OP retificada no mesmo período semanal cria entrada com `executionSequence = 2` no mesmo lote. |
| **RECTIFICATION-NEXT-WEEK-01** | Retificação em semana subsequente | Re-finalização em semana posterior aloca a nova entrada no lote da nova semana com linhagem preservada. |
| **RECTIFICATION-MULTIPLE-01** | Múltiplas retificações sucessivas | Três ciclos de retificação geram sequências 1, 2 e 3 com cadeia auditável ininterrupta de self-FKs. |
| **FINALIZE-RETRY-CURRENT-EXECUTION-01** | Retry na sequência corrente | Retry de finalização após retificação retorna a entrada correspondente à sequência ativa da OP. |
| **WEEK-GROUP-CLIENT-01** | Segregação por cliente | Duas ordens na mesma semana para clientes diferentes geram dois lotes `Weeklog` distintos. |
| **WEEK-GROUP-LOCATION-01** | Segregação por local/oficina | Duas ordens do mesmo cliente em oficinas diferentes (`siteKey`) geram lotes distintos. |
| **WEEK-GROUP-CONCURRENT-01** | Concorrência de criação de cabeçalho | Duas finalizações simultâneas para o mesmo cliente/semana compartilham o mesmo cabeçalho sem colisão. |
| **WEEK-DST-SPRING-01** | Virada de horário de verão (Primavera) | Transição com salto de 23h calcula início e término semanal sem perder ordens no boundary. |
| **WEEK-DST-FALL-01** | Retorno de horário de verão (Outono) | Transição com repetição de 25h mantém consistência estrita de timestamps UTC. |
| **WEEK-YEAR-BOUNDARY-01** | Virada de ano civil | Semana operacional que cruza 31/12 e 01/01 resolve `startsOn` e `yearReference` de forma determinística. |
| **WEEK-INVALID-TIMEZONE-01** | Fuso horário inválido | Workspace com string IANA inválida aciona fallback seguro e determinístico para `"UTC"`. |
| **VALIDATOR-CLIENT-SCOPE-01** | Escopo de cliente do validador | Validador com grant para Cliente A valida com sucesso o lote do Cliente A. |
| **VALIDATOR-OTHER-CLIENT-01** | Bloqueio cross-client de validador | Validador do Cliente A tentando validar lote do Cliente B recebe HTTP 403 Forbidden. |
| **VALIDATOR-SELF-01** | Bloqueio de auto-validação de técnico | Técnico executor que possui papel de admin/owner é barrado de validar sua própria execução. |
| **PERSONAL-TECH-SELF-VALIDATE-01** | Personal Workspace sem auto-validação | Técnico autônomo em oficina pessoal não pode validar suas ordens perante o cliente contratante. |
| **DIRECT-OP-WEEKLOG-01** | OP direta com serviços estruturados | Finalização de ordem sem orçamento utiliza `performedServices` estruturado para gerar snapshot. |
| **DIRECT-OP-NO-SERVICES-01** | Bloqueio de OP direta sem serviços | Tentativa de finalizar OP direta sem nenhum serviço estruturado retorna HTTP 422 Unprocessable Entity. |
| **LEGACY-FINALIZE-01** | Delegação de finalização via PATCH legado | `PATCH /production-orders/:id` com `status: "delivered"` delega a `finalizeProductionOrder`. |
| **RECTIFICATION-FORGED-TECH-01** | Bloqueio de técnico forjado em retificação | Técnico tentando reatribuir retrabalho para outro técnico sem permissão recebe HTTP 403 Forbidden. |
| **RECTIFICATION-VALIDATOR-ASSIGN-FORBIDDEN-01** | Validador impedido de atribuir técnico | Validador do cliente tentando selecionar técnico na solicitação de retificação tem atribuição ignorada/rejeitada. |
| **SIGNATURE-IMMUTABLE-AFTER-VALIDATION-01** | Imutabilidade de assinatura pós-validação | Tentativa de re-upload ou alteração de assinatura em lote com `status: "validated"` retorna HTTP 409 Conflict. |
| **SUBMIT-VALIDATION-01** | Submissão de lote para validação | `POST /api/weeklogs/:id/submit-for-validation` transiciona `open` $\rightarrow$ `pending_validation` congelando o `coverageSnapshot` da rodada. Não bloqueia OPs futuras da semana. |
| **SUBMIT-VALIDATION-IDEMPOTENT-01** | Idempotência de submissão | Chamada repetida de submissão em lote já em `pending_validation` com a mesma cobertura retorna HTTP 200 de forma idempotente. |
| **VALIDATOR-REVOKED-01** | Bloqueio de validador com grant revogado | Validador com `ClientAccessGrant` revogado (`status = "revoked"`) recebe HTTP 403 Forbidden ao tentar validar lote. |
| **DIRECT-OP-NO-SITE-01** | Bloqueio de OP sem local operacional | Tentativa de finalizar ordem de produção sem `operationalSiteKey` resolvido/persistido retorna HTTP 422 Unprocessable Entity (`OPERATIONAL_SITE_REQUIRED`). |
| **FINALIZE-NO-CURRENCY-01** | Bloqueio de OP sem código de moeda | Tentativa de finalizar ordem sem moeda canônica definida (`currencyCode`) retorna HTTP 422 Unprocessable Entity (`CURRENCY_REQUIRED`). |
| **VALIDATOR-BATCH-SELF-01** | Bloqueio de auto-validação em lote | Validador autenticado que executou qualquer uma das ordens incluídas no `coverageSnapshot` do lote recebe HTTP 403 Forbidden. |
| **FINALIZE-CROSS-TENANT-01** | Isolamento tenant na finalização | Ator de Workspace B tentando finalizar OP de Workspace A recebe HTTP 404/403. |
| **FINALIZE-TECH-OWN-01** | Ownership estrito de técnico | Técnico A tentando finalizar OP atribuída a Técnico B recebe HTTP 403 Forbidden. |
| **FINALIZE-SNAPSHOT-DECIMAL-01** | Precisão monetária decimal | Cálculos de itens múltiplos utilizam Prisma.Decimal exato sem perda de ponto flutuante. |
| **FINALIZE-HEADER-RACE-01** | Race condition de cabeçalho | OPs distintas finalizadas concorrentemente para o mesmo lote semanal utilizam o mesmo Weeklog. |
| **FINALIZE-P2002-UNRELATED-01** | Propagação de P2002 não-relacionado | Erro P2002 de constraint externa à idempotência é relançado sem mascaramento. |
| **FINALIZE-DELIVERED-AT-AUTHORITY-01** | Autoridade temporal server-side | Payload client-side não consegue forjar data de entrega ou escolher arbitrariamente a semana. |
| **FINALIZE-REASSIGN-RACE-01** | Locked Source of Truth / Ownership | Técnico que perde atribuição da ordem antes do lock não finaliza com autorização stale (HTTP 403). |
| **FINALIZE-UNAPPROVED-REVISION-01** | Linhagem estrita de orçamento | OP vinculada a revisão de orçamento em draft/não-aprovada é rejeitada com HTTP 422. |
| **FINALIZE-NO-FINANCE-01** | Zero efeito financeiro colateral | Finalização não gera PaymentOrder, não cria listName e mantém intactos os saldos financeiros. |
| **FINALIZE-MORE-THAN-4-SERVICES-01** | Preservação integral de serviços | Snapshot canônico preserva >4 serviços sem truncamento enquanto a projeção legada preenche 4 slots. |
| **WEEKLOG-LIST-TENANT-01** | Isolamento tenant na listagem | `GET /api/weeklogs` filtra rigorosamente por workspace do `RequestContext` (Workspace B não lista registros do Workspace A). |
| **WEEKLOG-DETAIL-TECH-OWN-01** | Visibilidade restrita em detalhes | Técnico com `scope: own` consulta `GET /api/weeklogs/:id` e visualiza estritamente suas próprias entradas (`WeeklogEntry`). |
| **WEEKLOG-ENTRY-PARENT-01** | Consistência relacional de rota | `GET /api/weeklogs/:id/entries/:entryId` exige que o item pertença ao lote indicado na URL (HTTP 404 se pertencer a outro Weeklog). |
| **SUBMIT-COVERAGE-FREEZE-01** | Congelamento de rodada | Submissão transiciona lote para `pending_validation` e congela `coverageSnapshot` auditável com lista de IDs e totalizador. |
| **SUBMIT-CONCURRENT-01** | Concorrência de submissão | Duas submissões simultâneas para o mesmo lote resultam em exatamente 1 rodada de validação criada. |
| **SUBMIT-INVALID-STATE-01** | Validação de transição de estado | Submissão de lote vazio ou em estado que não seja `open` ou `rectification_pending` é rejeitada com HTTP 400. |
| **SUBMIT-CROSS-TENANT-01** | Isolamento tenant na submissão | Ator de Workspace B tentando submeter lote de Workspace A recebe HTTP 404/403. |
| **SUBMIT-TECH-FORBIDDEN-01** | Autoridade de submissão | Técnico comum sem permissão de gerenciamento é bloqueado de submeter lote (HTTP 403 Forbidden). |
| **GET-NO-WRITE-01** | Pureza de leitura (Zero mutações em GET) | Consultas via `GET /api/weeklogs` e `GET /api/weeklogs/:id` são rigorosamente somente-leitura e não alteram o banco. |
| **SUBMIT-AUDIT-ACTOR-01** | Autoridade estrita de autoria | Submissão audita `submittedBy` e `submittedAt` gerados exclusivamente pelo servidor a partir de `RequestContext` (rejeita/ignora client body). |
| **SUBMIT-COVERAGE-DB-IMMUTABLE-01** | Imutabilidade estrita no banco | O `coverageSnapshot` persistido em `WeeklogValidation` não é alterado por finalizações tardias de ordens ou retries de submissão. |
| **VALIDATE-SAME-ROUND-01** | Conclusão da mesma rodada de validação | Validação do lote conclui a MESMA rodada criada no submit (`WHERE id = activeRound.id`) em vez de inserir novo registro. |
| **VALIDATE-REVIEW-INCOMPLETE-01** | Pré-condição de revisão completa | Tentativa de validar lote com itens de coverage ainda pendentes retorna HTTP 409 Conflict (`VALIDATION_REVIEW_INCOMPLETE`). |
| **VALIDATE-UNCOVERED-ENTRY-01** | Preservação de status com ordens tardias | Lote com ordens novas adicionadas após o submit não é marcado como `validated`, mas permanece `open` para nova rodada. |
| **VALIDATE-CONCURRENT-01** | Concorrência de validação em lote | Concorrência real de chamadas de validação com lock pessimista resulta em exatamente uma validação consumada. |
| **VALIDATOR-GRANT-WORKSPACE-01** | Isolamento tenant de grant de validador | Validador com grant para o mesmo cliente em outro workspace é bloqueado com HTTP 403 Forbidden. |
| **VALIDATOR-GRANT-REVOKE-RACE-01** | Defesa contra corrida de revogação de grant | Revogação concorrente de grant antes da validação é detectada com `SELECT ... FOR UPDATE` no grant (HTTP 403). |
| **SIGNATURE-NON-PNG-01** | Validação de cabeçalho binário PNG | Upload de arquivo não-PNG (falsificado com Content-Type png) é rejeitado com HTTP 422 Unprocessable Entity. |
| **SIGNATURE-OVERSIZE-01** | Limite estrito de tamanho de assinatura | Upload de assinatura excedendo 1 MB é rejeitado com HTTP 422 Unprocessable Entity (`FILE_TOO_LARGE`). |
| **SIGNATURE-CROSS-TENANT-PATH-01** | Bloqueio de BOLA em storagePath de assinatura | Validação fornecendo caminho de storage de outro workspace/tenant é bloqueada com HTTP 403 Forbidden. |
| **SIGNATURE-CROSS-WEEKLOG-PATH-01** | Bloqueio de IDOR em storagePath entre weeklogs | Validação fornecendo caminho de storage de outro weeklog do mesmo tenant é bloqueada com HTTP 403 Forbidden. |
| **SIGNATURE-FINAL-PATH-01** | Promoção atômica de staging para definitivo | Validação com assinatura manuscrita promove staging temporário para chave definitiva vinculada à Validation Round. |

---

## 2. Cenários BDD Detalhados (GIVEN / WHEN / THEN)

### Cenário SUBMIT-VALIDATION-01: Submissão do Lote Congelando Coverage da Rodada
```gherkin
Cenário: Submissão de lote transiciona para pending_validation e congela coverageSnapshot
  Dado que o lote "WL-W33" está no estado "open"
  E possui 3 ordens finalizadas ("ENTRY-1", "ENTRY-2", "ENTRY-3")
  Quando o gestor ou técnico envia "POST /api/weeklogs/WL-W33/submit-for-validation"
  Então o backend responde com HTTP 200
  E o status do lote transiciona para "pending_validation"
  E o campo "coverageSnapshot" é congelado contendo os IDs ["ENTRY-1", "ENTRY-2", "ENTRY-3"]
  E o sistema permite que outras ordens da mesma semana continuem em produção sem bloqueio
```

---

### Cenário SUBMIT-VALIDATION-IDEMPOTENT-01: Submissão Repetida sem Alteração de Estado
```gherkin
Cenário: Chamada redundante de submit-for-validation é tratada de forma idempotente
  Dado que o lote "WL-W33" já está no estado "pending_validation" com as entradas ["ENTRY-1", "ENTRY-2"]
  Quando uma nova requisição "POST /api/weeklogs/WL-W33/submit-for-validation" é recebida
  Então o backend responde com HTTP 200
  E o status permanece "pending_validation"
  E nenhuma nova rodada ou alteração no "coverageSnapshot" é gerada
```

---

### Cenário VALIDATOR-REVOKED-01: Bloqueio de Validador com Grant Revogado
```gherkin
Cenário: Validador com acesso revogado pelo cliente não pode validar o lote
  Dado que o usuário "Validador-Excluído" possuía grant para o "Cliente-Alpha"
  Mas o grant foi revogado ("status: revoked", "revokedAt: 2026-09-15T10:00:00Z")
  Quando o usuário tenta enviar "POST /api/weeklogs/WL-Alpha/validate"
  Então o backend responde com HTTP 403 Forbidden ("VALIDATOR_REVOKED: Acesso de validação revogado.")
```

---

### Cenário DIRECT-OP-NO-SITE-01: Exigência de Local Operacional Canônico
```gherkin
Cenário: Finalização de ordem sem local operacional persistido é recusada
  Dado uma ordem de produção "PO-Sem-Site" com "operationalSiteKey: null" ou string vazia
  Quando o comando "POST /api/production-orders/PO-Sem-Site/finalize" é executado
  Então o backend recusa a transação com HTTP 422 Unprocessable Entity
  E retorna a mensagem "OPERATIONAL_SITE_REQUIRED: A ordem exige local operacional resolvido."
```

---

### Cenário FINALIZE-NO-CURRENCY-01: Exigência de Código de Moeda Canônico
```gherkin
Cenário: Finalização sem moeda resolvida do orçamento ou da ordem direta é recusada
  Dado uma ordem de produção direta "PO-Sem-Moeda" sem "currencyCode" definido
  Quando o comando "POST /api/production-orders/PO-Sem-Moeda/finalize" é executado
  Então o backend recusa a transação com HTTP 422 Unprocessable Entity
  E retorna a mensagem "CURRENCY_REQUIRED: Moeda obrigatória não definida para a ordem."
```

---

### Cenário VALIDATOR-BATCH-SELF-01: Bloqueio de Auto-Validação em Lote por Técnico Executor
```gherkin
Cenário: Validador impedido de aprovar lote se executou qualquer um dos itens cobertos
  Dado um lote "WL-W33" com "coverageSnapshot" contendo as entradas "ENTRY-1" e "ENTRY-2"
  E o técnico "User-Alex" foi o executor da entrada "ENTRY-2" ("technicianUserId: User-Alex")
  E "User-Alex" possui papel de administrador ou validador no cliente
  Quando "User-Alex" tenta submeter "POST /api/weeklogs/WL-W33/validate"
  Então o backend recusa a operação com HTTP 403 Forbidden
  E retorna a mensagem "VALIDATOR-BATCH-SELF-01: O validador não pode ter executado nenhum serviço do lote."
```

---

### Cenário RECTIFICATION-SAME-WEEK-01: Retificação e Re-Finalização na Mesma Semana
```gherkin
Cenário: Ordem retificada e retrabalhada na mesma semana operacional gera sequência 2 no mesmo lote
  Dado que a ordem "PO-201" foi finalizada na segunda-feira na Semana "2026-W33" com "executionSequence: 1"
  E a entrada "ENTRY-201-1" foi gerada no lote "WL-W33" com "executionSequence: 1"
  E na terça-feira o validador reprovou o serviço disparando "POST /api/weeklogs/WL-W33/entries/ENTRY-201-1/rectify"
  E a ordem "PO-201" foi reaberta para "in_production" com "executionSequence: 2"
  Quando o técnico conclui o retrabalho na quinta-feira da mesma Semana "2026-W33" e aciona "POST /api/production-orders/PO-201/finalize"
  Então o backend responde com HTTP 200
  E uma nova entrada "ENTRY-201-2" é criada no MESMO lote "WL-W33"
  E "ENTRY-201-2" possui "executionSequence: 2"
  E "ENTRY-201-2" possui "rectificationOriginEntryId" apontando para "ENTRY-201-1"
  E a entrada original "ENTRY-201-1" permanece preservada com "validationStatus: rectification_requested"
```

---

### Cenário RECTIFICATION-NEXT-WEEK-01: Retificação com Conclusão em Semana Posterior
```gherkin
Cenário: Retrabalho concluído na semana seguinte aloca a nova entrada no lote da nova semana
  Dado que a ordem "PO-202" teve sua primeira execução "ENTRY-202-1" na Semana "2026-W33" marcada como "rectification_requested"
  E a ordem "PO-202" está reaberta em produção com "executionSequence: 2"
  Quando a ordem é finalizada na terça-feira da Semana seguinte "2026-W34"
  Então uma nova entrada "ENTRY-202-2" é criada no lote "WL-W34"
  E "ENTRY-202-2" aponta para "ENTRY-202-1" como sua origem de retificação
  E o lote "WL-W33" mantém a entrada original intacta para fins de auditoria
```

---

### Cenário RECTIFICATION-MULTIPLE-01: Cadeia Sucessiva de Três Retificações
```gherkin
Cenário: Três ciclos sucessivos de retificação mantêm cadeia de linhagem íntegra
  Dado que a ordem "PO-203" passou por 3 ciclos de retrabalho
  Então existem exatamente 3 entradas em "weeklog_entries":
    | Entrada     | executionSequence | rectificationOriginEntryId | validationStatus         |
    | ENTRY-203-1 | 1                 | null                       | rectification_requested  |
    | ENTRY-203-2 | 2                 | ENTRY-203-1                | rectification_requested  |
    | ENTRY-203-3 | 3                 | ENTRY-203-2                | pending                  |
```

---

### Cenário WEEK-GROUP-CLIENT-01 & WEEK-GROUP-LOCATION-01: Segregação Determinística de Cabeçalhos
```gherkin
Cenário: Separação estrita de lotes semanais por cliente e por local operacional
  Dado duas ordens "PO-A" (Cliente X, Oficina Central) e "PO-B" (Cliente Y, Oficina Central) finalizadas na mesma semana
  Quando as entradas são materializadas
  Então elas são vinculadas a dois lotes "Weeklog" distintos devido ao "clientId" diferente
  Dado outra ordem "PO-C" (Cliente X, Oficina Norte) finalizada na mesma semana
  Então ela é vinculada a um terceiro lote "Weeklog" devido ao "siteKey" diferente
```

---

### Cenário WEEK-DST-SPRING-01 & WEEK-DST-FALL-01: Determinismo em Horário de Verão
```gherkin
Cenário: Transições de Daylight Saving Time não corrompem o boundary semanal
  Dado um workspace com timezone "Europe/Paris"
  Quando ocorre a virada de horário de verão de primavera (salto de 02:00 para 03:00)
  Então o cálculo de "startsOn" e "endsOn" compreende exatamente o intervalo local de Domingo a Sábado
  E nenhum veículo finalizado durante a madrugada da transição tem sua semana desviada
```

---

### Cenário VALIDATOR-SELF-01 & PERSONAL-TECH-SELF-VALIDATE-01: Bloqueio de Auto-Validação
```gherkin
Cenário: O executor do serviço é impedido de aprovar o próprio trabalho
  Dado que o usuário "User-Tech" é técnico e realizou os serviços da entrada "ENTRY-401"
  E "User-Tech" também é owner ou administrador do workspace
  Quando "User-Tech" tenta enviar "POST /api/weeklogs/WL-1/entries/ENTRY-401/review" com "validationStatus: approved"
  Então o backend responde com HTTP 403 Forbidden ("VALIDATOR-SELF-01: Executores não podem validar o próprio serviço.")
  Dado outro cenário onde um técnico opera em seu Personal Workspace autônomo
  Quando ele tenta auto-aprovar o lote do seu cliente
  Então o backend recusa a operação com HTTP 403 Forbidden exigindo validação pelo cliente contratante
```

---

### Cenário VALIDATOR-CLIENT-SCOPE-01 & VALIDATOR-OTHER-CLIENT-01: Escopo do Validador Externo
```gherkin
Cenário: Validador externo só pode chancelar lotes do cliente para o qual possui grant
  Dado que a usuária "Validadora-X" possui "ClientAccessGrant" ativo estritamente para o "Cliente-Alpha"
  Quando ela submete a validação do lote "WL-Alpha" pertencente ao "Cliente-Alpha"
  Então o backend valida a operação com sucesso e gera "WeeklogValidation"
  Quando ela tenta validar o lote "WL-Beta" pertencente ao "Cliente-Beta"
  Então o backend recusa a operação com HTTP 403 Forbidden
```

---

### Cenário DIRECT-OP-WEEKLOG-01 & DIRECT-OP-NO-SERVICES-01: OPs Diretas com Serviços Estruturados
```gherkin
Cenário: Finalização de OP direta exige serviços estruturados no campo performedServices
  Dado uma ordem direta "PO-Direct-1" sem orçamento prévio ("budgetId: null")
  E a ordem possui "performedServices" preenchido com 2 serviços detalhados totalizando "450.00 EUR"
  Quando o comando "POST /api/production-orders/PO-Direct-1/finalize" é executado
  Então o backend responde com HTTP 200 e copia os 2 serviços estruturados para "servicesSnapshot"
  Dado outra ordem direta "PO-Direct-2" com "performedServices" vazio ou nulo
  Quando o comando de finalização é executado
  Então o backend recusa a transação com HTTP 422 Unprocessable Entity ("DIRECT_OP_NO_SERVICES")
```

---

### Cenário LEGACY-FINALIZE-01: Delegação da Finalização via PATCH Legado
```gherkin
Cenário: Chamada legada PATCH /production-orders/:id com status delivered delega para finalize
  Dado uma ordem aberta "PO-Legacy" em produção
  Quando o cliente legado envia "PATCH /api/production-orders/PO-Legacy" com '{"status": "delivered"}'
  Então o backend não executa update direto, mas delega integralmente a "finalizeProductionOrder"
  E a transação atômica cria o "WeeklogEntry", sincroniza a projeção e retorna HTTP 200
```

---

### Cenário SIGNATURE-IMMUTABLE-AFTER-VALIDATION-01: Imutabilidade de Assinatura Pós-Validação
```gherkin
Cenário: Tentativa de sobrescrever assinatura em lote validado é recusada
  Dado que o lote "WL-500" já foi validado e possui "WeeklogValidation" registrado com assinatura em MinIO
  Quando um operador tenta enviar novo upload em "POST /api/weeklogs/WL-500/signature-upload"
  Então o backend recusa a operação retornando HTTP 409 Conflict
```
