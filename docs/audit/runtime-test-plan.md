# Plano de Testes Runtime — Fase 4B

**Status**: PRONTO COMO PLANO; EXECUÇÃO BLOQUEADA PELOS GATES DO HANDOVER  
**Data**: 2026-09-05  
**Ambiente obrigatório**: local, descartável, sanitizado e isolado de produção  
**Proibição**: este documento não autoriza iniciar a Fase 4B

## 1. Convenções e gates

Usuários: `PA` = platform admin local; `OA` = Owner A; `MA` = manager/admin A; `TA` = technician A; `OB` = Owner B; `TB` = technician B; `ANON` = sem token. Workspaces: `A`, `B`, `—`.

Gates obrigatórios antes de qualquer caso:

- `G0`: Docker ativo, imagens locais construídas e nenhum endpoint aponta para produção.
- `G1`: PostgreSQL/MinIO descartáveis, schema criado por `db push` somente local e dataset A/B identificado por `run_id`.
- `G2`: egress da API e do navegador bloqueado por padrão; Sentry/Supabase sempre bloqueados.
- `G3`: captura sanitiza Authorization, cookies, payloads documentais, e-mails, tokens e provider IDs.
- `G4`: snapshot dos volumes antes de grupos destrutivos; rollback preferencial por descarte dos volumes.
- `G5`: integrações externas liberadas somente para a categoria correspondente, com conta/chave exclusiva de teste e hard quota.
- `G6`: nenhuma variável live Stripe/payment está presente no processo/container.

Evidência padrão: timestamp, `run_id`, caso, usuário lógico, workspace lógico, método/path, status, shape sanitizado do body, IDs fictícios, logs correlacionados e diff de contagens/relacionamentos no banco. Nunca capturar valores de secrets.

Riscos: `B` baixo; `M` médio; `A` alto. Rollback: `N` nenhum; `DB` restaurar snapshot/descartar volume PostgreSQL; `OBJ` descartar volume MinIO; `EXT` limpar somente recursos sandbox; `ALL` DB+OBJ+EXT.

## A. Happy path

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-A01 | G0-G3; containers up | ANON / — | `GET /api/health` | 200, `status=ok`; prova apenas API+DB | response, `SELECT 1`, health dos containers | B | Não | N |
| 4B-A02 | banco vazio baseline | usuário local / — | registrar, login, `GET /auth/me` | registro/login/me coerentes; hash não aparece | 201/200, claims sanitizadas, linhas User/AppUser/Profile/Role | M | Sim | DB |
| 4B-A03 | token OA | OA / A | `POST /workspaces`, consultar billing-context | workspace, owner, membership e trial criados atomicamente | response + relações/counts | M | Sim | DB |
| 4B-A04 | A criado | OA / A | criar MA e TA em `/workspaces/:id/members` | memberships ativas; credencial temporária não entra na evidência | status, roles, e-mail capturado no sink se habilitado | M | Sim | DB |
| 4B-A05 | A + location | OA / A | criar Location e People; listar/detalhar | shapes persistidos e vinculados | requests sanitizados e queries scoped esperadas | M | Sim | DB |
| 4B-A06 | Client bootstrap local | MA / A | criar OP draft e consultar | OP persiste com A e auditoria mínima | response/DB | M | Sim | DB |
| 4B-A07 | SO/Payment base | TA / A | criar SO draft e PaymentOrder manual | registros coerentes com usuário/tenant | response/DB | M | Sim | DB |
| 4B-A08 | MinIO e buckets prontos | OA / A | upload de arquivo sintético e criação de metadata | objeto e Document apontam para mesmo path | hash do arquivo, metadata, bucket sem credencial | M | Sim | DB+OBJ |

## B. Contratos divergentes

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-B01 | G0-G3 | MA / A | `POST /extract/detect-discrepancies` sem imagem | 404 controlado; confirmar endpoint ausente, não stack trace inventado | status/body sanitizado/router list | B | Não | N |
| 4B-B02 | G0-G3 | MA / A | `GET /discrepancies` | 404 controlado | status/body | B | Não | N |
| 4B-B03 | frontend local | destinatário / — | abrir `/join?token=<fictício>` | decisão esperada: rota acessível e token inválido tratado; estado atual deve ser registrado | URL, UI, requests, console sanitizado | B | Talvez | DB |
| 4B-B04 | Billing dataset | PA / A | abrir ReconciliationScreen e executar consulta | não deve usar Supabase; contrato deve representar domínio aprovado | HAR sem secrets + DB before/after | M | Talvez | DB |
| 4B-B05 | dashboard A/B | OA / A | carregar dashboard | métricas somente A; ausência de discrepancies explicitada, não convertida em zero silencioso | responses por widget e comparação DB | M | Não | N |
| 4B-B06 | TA vinculado | MA / A | consultar técnicos/ganhos e editar vínculo | mesmo identificador canônico em membership/Profile/registro | IDs sanitizados e joins | M | Talvez | DB |
| 4B-B07 | entidade descartável | OA / A | excluir via fluxo que usa `assertDelete` | UI só confirma após resposta REST inequívoca | request real, status, count DB | M | Sim | DB |

## C. Tenant isolation

Resultado esperado em todos os controles negativos: `403`/`404` ou coleção vazia sem revelar existência, conforme política aprovada. `200` com dado B para usuário A é falha P0.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-C01 | People A/B | OA / A | listar/detalhar Person B | negar/ocultar B | response + query audit | A | Não | N |
| 4B-C02 | Locations A/B | OA / A | listar/alterar Location B | negar e não alterar | before/after B | A | Talvez | DB |
| 4B-C03 | SO A/B | OA / A | `GET /service-orders?workspace_id=B` | negar; não confiar em query | response + DB | A | Não | N |
| 4B-C04 | OP B | OA / A | GET/PATCH/DELETE OP B por ID | negar todas | sequência de status + before/after | A | Talvez | DB |
| 4B-C05 | PaymentOrder B | OA / A | GET/PATCH/DELETE usando ID/query B | negar todas | response + soft-delete flag | A | Talvez | DB |
| 4B-C06 | Document B | OA / A | list/detail/update/delete por entity/ID B | negar/ocultar | metadata before/after | A | Talvez | DB |
| 4B-C07 | Finance A/B | OA / A | summary, records, reconciliation history | somente A | valores sentinela e IDs | A | Não | N |
| 4B-C08 | Billing clients A/B | MA / A | consultar/alterar BillingClient B | negar por membership/objeto | response + audit log | A | Talvez | DB |

## D. RBAC

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-D01 | banco descartável | ANON / — | registrar com `role=admin` | esperado seguro: 403/role não privilegiada; 201 admin confirma SEC-4B-002 | response, role persistida, acesso admin subsequente | A | Sim | DB |
| 4B-D02 | decisão owner/admin respondida | OA / A | acessar billing ops | resultado conforme matriz aprovada; hoje provável 403 | response e claims | M | Não | N |
| 4B-D03 | membros A | TA / A | criar/alterar membro | 403 | response + memberships invariantes | M | Talvez | DB |
| 4B-D04 | membros A | OA / A | criar/alterar membro não-owner | permitido; owner não pode ser rebaixado pelo mesmo fluxo | response + transação | M | Sim | DB |
| 4B-D05 | weather base | TA / A | `POST /weather/ingest` | esperado seguro: 403; nenhuma chamada externa | status + egress log | A | Talvez | DB |
| 4B-D06 | dois usuários | TA / A | `/account/role/context/permissions` de outro usuário | negar salvo papel explicitamente autorizado | response e audit | A | Não | N |

## E. OP → WEEKLOG → PaymentOrder

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-E01 | OP draft A | MA / A | alterar OP até `delivered` | exatamente um WEEKLOG/ServiceOrder criado e linkado | transição, IDs, contagens, logs | A | Sim | DB |
| 4B-E02 | OP delivered A | MA / A | repetir mesma atualização | nenhuma segunda OS/pasta | contagem antes/depois | A | Sim | DB |
| 4B-E03 | WEEKLOG A com validação completa | MA / A | validar via PATCH/PUT | exatamente um PaymentOrder e listName; snapshot recebe IDs | rows e snapshots before/after | A | Sim | DB |
| 4B-E04 | chain pronta | MA / A | repetir validação | idempotente; zero duplicatas | unique business key/counts | A | Sim | DB |
| 4B-E05 | snapshot G4 | MA / A | induzir falha DB no efeito OP→WEEKLOG | decisão aprovada: rollback integral ou estado pending recuperável; nunca sucesso silencioso | status, transação, logs, estado | A | Sim | DB |
| 4B-E06 | snapshot G4 | MA / A | induzir falha na criação PaymentOrder após validar SO | mesma política de consistência; mecanismo de recuperação demonstrado | before/after e retry | A | Sim | DB |
| 4B-E07 | cadeia completa | PA / A | vincular billing/finance conforme domínio aprovado | referências canônicas e tenant preservados | grafo de IDs e ledger | A | Sim | DB |

## F. Idempotência e duplicação

Executar somente com autorização explícita de concorrência, no banco local e com barreira de sincronização controlada.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-F01 | Budget local A | MA / A | duplo clique/retry simultâneo de aprovação | uma OP por chave de aprovação | requests, IDs e contagem | A | Sim | DB |
| 4B-F02 | OP A | MA / A | duas entregas simultâneas | um WEEKLOG e uma árvore documental | traces correlacionados/counts | A | Sim | DB |
| 4B-F03 | WEEKLOG A | MA / A | duas validações simultâneas | um PaymentOrder e um listName | queries/counts | A | Sim | DB |
| 4B-F04 | payload batch | MA / A | lote com um item inválido no meio | tudo-ou-nada ou resultado parcial explicitamente contratado | response + rows por item | A | Sim | DB |
| 4B-F05 | Stripe sandbox G5/G6 | PA / A | reenviar mesmo evento test | um efeito financeiro; replay reconhecido | event ID sanitizado, counts, logs | A | Sim | DB+EXT |
| 4B-F06 | alvo de convite local | OA / A | dois convites concorrentes iguais | um pendente ou conflito determinístico | responses e unique state | M | Sim | DB |

## G. Document e Storage isolation

Usar somente arquivos sintéticos pequenos, com hashes e sentinelas A/B; nunca documentos reais.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-G01 | buckets prontos | OA / A | upload, metadata, download privado próprio | hash de ida/volta igual e ownership A | hash, headers, metadata | M | Sim | DB+OBJ |
| 4B-G02 | objeto privado B | OA / A | ler `bucket/path` B | negar sem revelar objeto | status, bytes zero, access log | A | Não | N |
| 4B-G03 | objeto privado B | OA / A | delete path B | negar; objeto continua com mesmo hash | response + HEAD/hash B | A | Talvez | OBJ |
| 4B-G04 | público/privado | ANON / — | ler bucket público e privado | público permitido somente allowlist; privado negado | status/headers | M | Não | N |
| 4B-G05 | G4 | OA / A | falhar metadata depois do upload | compensação remove objeto ou orphan é detectado/reconciliado | listagem S3 + DB | A | Sim | DB+OBJ |
| 4B-G06 | PersonDocument A | OA / A | excluir documento | metadata e objeto seguem política de retenção aprovada | before/after DB/S3/audit | M | Sim | DB+OBJ |

## H. Finance e reconciliation

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-H01 | ledger A/B | OA / A | `GET /finance/summary` e históricos | somente A | totais sentinela e IDs | A | Não | N |
| 4B-H02 | recon auto A/B + G4 | OA / A | `POST /finance/reconciliations/run` para A | não apaga/recria B | snapshot rows A/B | A | Sim | DB |
| 4B-H03 | SO A + Payment B | OA / A | manual merge cross-tenant | 403/409; nenhuma Reconciliation | response/count | A | Sim | DB |
| 4B-H04 | recon com diferença A | OA / A | validar confronto | status, ajuste e FinancialEvent atômicos e com workspace A | transação/rows/event hash | A | Sim | DB |
| 4B-H05 | regras A/B | OA / A | criar/alterar profit rule A | distribuição somente A; snapshot antigo respeitado | rules/distributions/SO diffs | A | Sim | DB |
| 4B-H06 | G4 | OA / A | falhar criação do ajuste/evento | nenhuma confirmação parcial ou estado recuperável explícito | before/after e retry | A | Sim | DB |
| 4B-H07 | financial records B | OA / A | CRUD/delete-by por filtros B | negar e preservar B | response + count/hash B | A | Talvez | DB |

## I. OCR e IA

Somente documentos sintéticos sem PII, projeto de teste com hard quota e allowlist dos hosts dos provedores.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-I01 | egress bloqueado | ANON / — | chamar os cinco `/extract/*` | esperado seguro: 401/429 antes do provedor | status + egress zero | A | Não | N |
| 4B-I02 | G5; provedor primário | MA / A | extrair documento sintético válido | shape conforme contrato, sem persistência implícita | status, latência, provider redigido, schema | M | Não | N |
| 4B-I03 | G5; fallback dedicado | MA / A | provocar falha controlada do primário | fallback ocorre somente nos status contratados e sem duplicar custo indevido | logs sanitizados e contagem de chamadas | M | Não | N |
| 4B-I04 | egress bloqueado | MA / A | payload inválido, MIME falso, base64 truncado e limite | 4xx determinístico; zero 500 e zero chamada externa | responses, memory/CPU, egress | A | Não | N |
| 4B-I05 | G5 | MA / A | exceder quota local/rate limit de forma limitada | 429/circuit breaker; custo máximo respeitado | métricas sem chaves | A | Não | N |

## J. Stripe sandbox

G5 e G6 obrigatórios. Verificar no dashboard sandbox que nenhum objeto live foi criado.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-J01 | Stripe test + workspace A | OA / A | checkout e portal sandbox | URLs/objetos pertencem ao modo test | mode flag, IDs redigidos, DB | M | Sim | DB+EXT |
| 4B-J02 | webhook sandbox | Stripe test / A | evento assinado válido | 2xx e efeito único | event type/ID redigido, logs, rows | A | Sim | DB+EXT |
| 4B-J03 | webhook sandbox | cliente inválido / A | assinatura ausente/inválida | 400 e nenhuma mutação | response + before/after | M | Não | N |
| 4B-J04 | evento J02 | Stripe test / A | replay do mesmo evento | idempotente | duas responses, um efeito | A | Sim | DB+EXT |
| 4B-J05 | G6 | PA / — | inspeção negativa de configuração + checkout | processo recusa qualquer modo live; nenhum fallback | configuração apenas por presença/ausência, dashboard test | A | Talvez | EXT |

## K. SMTP

Usar sink autenticado; destinatários em domínio reservado. Nunca SMTP ou e-mail de produção.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-K01 | sink SMTP | usuário local / — | `/auth/recover` | mensagem chega apenas ao sink; token não entra em log/evidência | envelope redigido e status | M | Sim | DB |
| 4B-K02 | invoice A | PA / A | enviar fatura sintética | send-log coerente e uma mensagem no sink | status, log, contagem sink | M | Sim | DB |
| 4B-K03 | sink indisponível | PA / A | repetir envio com falha controlada | erro explícito; invoice não marcada falsamente como enviada | response, logs, before/after | M | Sim | DB |

## L. Weather e route

Separar teste do scheduler de teste manual. Coordenadas e endereços devem ser sintéticos e não identificar pessoas.

| ID | Pré-condições | Usuário / WS | Request ou ação | Resultado esperado | Evidência | Risco | Altera dados? | Rollback? |
|---|---|---|---|---|---|---:|---|---|
| 4B-L01 | egress bloqueado | sistema / — | iniciar uma instância e aguardar primeiro tick | falha externa é controlada; API/health permanecem; zero dado falso | logs, egress, health | M | Talvez | DB |
| 4B-L02 | G5; uma instância | sistema / — | observar dois ciclos autorizados | um run por ciclo, sem sobreposição/duplicação | timestamps, provider counts, rows | A | Sim | DB |
| 4B-L03 | G5; duas instâncias + G4 | sistema / — | observar um ciclo | esperado arquitetural: lock/leader impede duplicação; ausência confirma risco | logs correlacionados/counts | A | Sim | DB |
| 4B-L04 | G5 ORS | MA / A | `POST /route/calculate` com pontos sintéticos | rota/distância plausíveis e status contratual | request redigida, provider/latência | M | Não | N |
| 4B-L05 | ORS ausente; egress Nominatim conforme allowlist | MA / A | cálculo/geocode fallback | fallback explicitamente identificado; sem resultado fabricado | status, fonte, coordenadas aproximadas | M | Não | N |
| 4B-L06 | dataset A/B | TA / A | `POST /weather/ingest`, consultar backend-events | RBAC e tenant conforme política; nenhum evento B exposto | response, egress, rows | A | Sim | DB |

## 2. Sequenciamento recomendado

1. Executar A01-A04 em egress bloqueado.
2. Criar snapshot G4 e dataset mínimo.
3. Executar happy path restante e contratos B.
4. Restaurar snapshot; executar C e D sem integrações externas.
5. Restaurar snapshot; executar E, F e G.
6. Restaurar snapshot; executar H.
7. Somente após revisão de custos e allowlist, executar I, J, K e L em sessões separadas.
8. Descartar volumes/objetos/recursos sandbox; verificar zero recurso live e zero e-mail externo.

## 3. Testes proibidos em produção

- Todos os controles de tenant/IDOR e autorregistro privilegiado (C e D01).
- Falhas induzidas, payloads malformados/oversized, concorrência e replay (E05-E06, F, I04-I05, J04).
- Rebuild/delete/reconciliação global e CRUD financeiro destrutivo (H02-H07).
- Tentativas de ler/excluir paths de outro tenant (G02-G03).
- OCR/IA com documentos, chaves ou quotas reais; webhook/checkout live; SMTP real.
- Múltiplas instâncias do scheduler e ingestões repetidas de clima (L02-L03/L06).
- `prisma db push`, reset, truncate, remoção de volume, reescrita de Git ou rotação de secret.

## 4. Critério de saída da Fase 4B

A 4B só termina quando cada caso executado tiver evidência sanitizada, resultado real (`PASS`, `FAIL`, `BLOCKED`), vínculo com o bug/hipótese 4A, rollback confirmado e zero acesso a produção. Hipóteses só podem virar bug confirmado mediante reprodução determinística; ausência de reprodução não prova ausência do defeito.

