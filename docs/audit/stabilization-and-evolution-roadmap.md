# Fase 7 — Backlog consolidado e roadmap de estabilização/evolução

**Projeto**: Operix / QW Nexus  
**Data**: 2026-09-07  
**Status**: FASE 7 CONCLUÍDA — diagnóstico concluído com validações runtime residuais  
**Escopo**: consolidação documental; nenhum código, schema, migration, dado ou integração foi alterado

## 1. Como ler este documento

Este backlog combina evidência estática das Fases 1–6.5, target state do relatório de Alex e a observação manual complementar de que várias superfícies aparentam funcionar visualmente, embora persistência e integração continuem heterogêneas. A observação manual não foi generalizada para módulos não exercitados e não substitui os 74 casos planejados em `runtime-test-plan.md`.

Prioridade significa: `P0` bloqueia uso seguro/confiável; `P1` é necessário ao core operacional; `P2` é evolução ou estabilização não bloqueante; `P3` é decisão futura/nice-to-have. Esforço é relativo: `XS`, `S`, `M`, `L`, `XL`. As estimativas não são preço, cronograma nem compromisso comercial.

## 2. Padrão sistêmico: arquitetura híbrida e falsa completude funcional

A plataforma não é “toda frontend”: há API Express com 189 endpoints, PostgreSQL/Prisma com 44 modelos, autenticação JWT, MinIO e integrações de Stripe, SMTP, IA, clima e rota. O problema é a coexistência sem fronteira única de cinco mecanismos: REST/Prisma; 45 fluxos funcionais ainda relacionados ao Supabase; `noopSupabaseFacade`; estado/localStorage; e serialização de domínio em `notes`/JSON.

Isso eleva a completude visual acima da completude funcional/arquitetural. Um modal pode abrir, um formulário pode aceitar dados e um toast pode indicar sucesso enquanto a mutação é absorvida pela façade noop, fica apenas no navegador ou atualiza uma entidade desconectada. A capacidade somente é adequada para produção quando fecha, conforme aplicável: **UI → contrato/API → autenticação/autorização → persistência → reload → isolamento tenant → integração com entidades relacionadas → tratamento de erro → testes**.

A migração deve ser por fatia vertical. É proibido um projeto horizontal do tipo “trocar todo Supabase primeiro”: cada capacidade deve migrar UI, contrato, autorização, modelo, dados e testes, e só então remover seu caminho Supabase/noop específico.

## 3. BACKLOG A — ESTABILIZAÇÃO / CORREÇÃO

### A0. Segurança crítica

### [A0-01] Encerrar autorregistro privilegiado e criar bootstrap administrativo seguro

**STATUS ATUAL**  
`POST /auth/register` é público, aceita `admin` e usa esse papel por padrão; o novo papel é persistido e recebe JWT.

**EVIDÊNCIA**  
`backend/src/routes/auth.ts`; S5A-001; SEC-4B-002; B4A e handover validation.

**CAUSA RAIZ**  
O onboarding comum foi reutilizado como cerimônia de criação de autoridade de plataforma, sem convite, uso único, aprovação ou encerramento do bootstrap.

**IMPACTO**  
Elevação administrativa e perda da fronteira de confiança antes de qualquer controle tenant.

**CORREÇÃO PROPOSTA**  
Remover escolha privilegiada do contrato público; criar bootstrap out-of-band, auditável, de uso único e fechado após inicialização; testar emissão e persistência de papéis.

**TARGET STATE**  
Cadastro público cria somente identidade sem privilégio; platform admin nasce por processo controlado e revogável.

**CRITÉRIO DE ACEITE**  
Request anônimo não consegue persistir papel privilegiado; bootstrap só funciona nas condições aprovadas e gera evento auditável.

**DEPENDÊNCIAS**  
S01, A0-02, A1-04.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; alcance requer validação runtime sanitizada.

### [A0-02] Separar papel global, papel de workspace e plano de controle da plataforma

**STATUS ATUAL**  
Alterar `Membership.role` também altera `User.role`/`UserRole`; rotas administrativas confundem admin global, owner e admin do tenant.

**EVIDÊNCIA**  
S5A-002/S5A-011; `workspaces.ts`, `billingOperations.ts`, `account.ts`; matriz de 20 domínios.

**CAUSA RAIZ**  
Uma única string de papel representa simultaneamente autoridade local, persona externa e privilégio de plataforma.

**IMPACTO**  
Escalada local→global, bloqueio indevido de owner e acesso transversal não justificável.

**CORREÇÃO PROPOSTA**  
Modelar grants de plataforma separados de membership; criar middlewares/casos de uso distintos; migrar papéis e registrar mudanças de autoridade.

**TARGET STATE**  
Owner/admin controla apenas o tenant; ações Operix usam plano de controle explícito, temporário e auditável conforme B08.

**CRITÉRIO DE ACEITE**  
Alterar membership em A não muda autoridade global nem acesso a B; matriz de papéis passa integralmente.

**DEPENDÊNCIAS**  
B08, S02, A0-01, A0-03, A1-01.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; extensão requer MV4B-02.

### [A0-03] Tornar TenantContext e autorização por objeto invariantes do servidor

**STATUS ATUAL**  
16 de 20 domínios prioritários têm isolamento inadequado; IDs e `workspaceId` do cliente chegam a consultas Prisma sem prova uniforme de membership.

**EVIDÊNCIA**  
S5A-003, B4A-001–012 e matriz multi-tenant em `security-performance-and-technical-debt.md`.

**CAUSA RAIZ**  
O RBAC calcula `own/team/all`, mas handlers verificam sobretudo `allowed`; não há contexto tenant obrigatório nem camada de dados que negue consultas não escopadas.

**IMPACTO**  
BOLA/IDOR, vazamento e mutação cross-tenant em operação, financeiro, pessoas, documentos e storage.

**CORREÇÃO PROPOSTA**  
Resolver tenant a partir de sessão/membership validada; adotar deny-by-default, autorização do objeto pai, repositórios tenant-scoped e FKs/uniques compostos.

**TARGET STATE**  
Nenhum caso de uso tenant-scoped aceita autoridade apenas pelo ID informado pelo navegador.

**CRITÉRIO DE ACEITE**  
Matriz A→B retorna 403/404/vazio sem revelar B; lint/testes impedem nova consulta não escopada.

**DEPENDÊNCIAS**  
A0-02, A1-01, A1-04, decisão de semântica dos objetos.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; extensão por rota requer 4B seletiva.

### [A0-04] Proteger OCR/IA, clima e operações caras

**STATUS ATUAL**  
Cinco endpoints de extração são públicos; ingestão/logs meteorológicos são acessíveis a qualquer autenticado; faltam quotas e rate limiting específicos.

**EVIDÊNCIA**  
S5A-008/009/012/018; `extract.ts`, `weather.ts`, `ai.ts`.

**CAUSA RAIZ**  
Integrações foram portadas como handlers técnicos sem política central de identidade, tenant, custo, tamanho e concorrência.

**IMPACTO**  
Abuso financeiro, exaustão de memória/cota e exposição de payload operacional.

**CORREÇÃO PROPOSTA**  
Exigir autenticação e permissão; impor limites por IP/identidade/tenant, schema/MIME/tamanho, timeout, circuit breaker e auditoria redigida.

**TARGET STATE**  
Serviços caros só executam em contexto autorizado, com custo e egress mensuráveis.

**CRITÉRIO DE ACEITE**  
Anônimo recebe 401/403 antes do provedor; excesso controlado retorna 429/4xx e não gera chamada externa.

**DEPENDÊNCIAS**  
A0-03, S04/S06/S07, A1-05; sandbox para validar provedores.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; limites requerem runtime.

### [A0-05] Conter e governar secrets pós-handover

**STATUS ATUAL**  
O handover contém segredos em texto puro; `.env.development` e histórico Git indicam exposição/configuração rastreada. Atividade dos segredos é desconhecida.

**EVIDÊNCIA**  
SEC-4B-001/003/006; S5A-020/021; `handover-validation.md`. Nenhum valor foi copiado.

**CAUSA RAIZ**  
Ausência de inventário de owners/escopos, secret manager, scanning contínuo e processo formal de entrega/rotação.

**IMPACTO**  
Comprometimento de banco, storage, JWT, e-mail ou provedores e perímetro desconhecido no histórico.

**CORREÇÃO PROPOSTA**  
Após aprovação, inventariar e rotacionar; remover `keys.txt` onde existir; retirar env preenchido do tracking; usar secret manager; escanear objetos/branches/artifacts antes de eventual reescrita.

**TARGET STATE**  
Segredos por ambiente, mínimo privilégio, donos e expiração conhecidos; templates contêm apenas nomes/placeholders seguros.

**CRITÉRIO DE ACEITE**  
Todos os segredos entregues têm rotação comprovada sem valores em tickets/docs; CI bloqueia nova exposição; relatório do histórico é fechado.

**DEPENDÊNCIAS**  
S05, responsáveis pelos provedores e janela coordenada. Não executar durante este diagnóstico.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE quanto ao armazenamento textual; atividade requer verificação externa.

### [A0-06] Redesenhar sessão/JWT e reduzir exposição de credenciais

**STATUS ATUAL**  
JWT fica em `localStorage`; download privado aceita token em query string; faltam revogação, issuer/audience e algoritmo permitido explícito.

**EVIDÊNCIA**  
S5A-007/S5A-013–015; `authSession.ts`, `jwt.ts`, `storage.ts`.

**CAUSA RAIZ**  
A sessão foi implementada como token bearer de SPA sem uma arquitetura completa de ciclo de vida e sem canal seguro específico para arquivos.

**IMPACTO**  
XSS pode exfiltrar sessão; URLs e access logs podem reter credenciais; revogação e resposta a incidente ficam limitadas.

**CORREÇÃO PROPOSTA**  
Definir sessão curta/refresh ou cookie `HttpOnly` conforme arquitetura; validar claims; criar revogação; substituir token em URL por URL assinada curta ou download autenticado por header.

**TARGET STATE**  
Sessão revogável e rastreável, com nenhum bearer token em URL/log e caminho preparado para MFA.

**CRITÉRIO DE ACEITE**  
Tokens não aparecem em localStorage/URLs/logs conforme desenho aprovado; logout/revogação invalida acesso; testes cobrem expiração e troca de senha.

**DEPENDÊNCIAS**  
S03, A0-03, A1-05, frontend e proxy.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE.

### A1. Banco e infraestrutura

### [A1-01] Criar baseline Prisma, migrations e seed sanitizado reproduzível

**STATUS ATUAL**  
O schema tem 44 modelos, mas existe somente uma migration Prisma incremental; `migrate deploy` não cria um banco vazio e não há seed A/B versionado.

**EVIDÊNCIA**  
`schema.prisma`, `backend/prisma/migrations`, handover validation e R10.

**CAUSA RAIZ**  
A migração preservou um snapshot Prisma sem converter a genealogia Supabase em baseline operacional.

**IMPACTO**  
Ambientes não nascem de forma repetível; migrations futuras e testes podem operar sobre estados divergentes.

**CORREÇÃO PROPOSTA**  
Produzir baseline revisado, plano de adoção para bases existentes, migrations incrementais, validação de drift e seed sintético mínimo sem credenciais/dados reais.

**TARGET STATE**  
Banco vazio e base existente chegam ao mesmo schema verificável por processos documentados.

**CRITÉRIO DE ACEITE**  
CI cria banco do zero, aplica migrations/seed e executa smoke tests; drift check passa; rollback/forward plan é ensaiado em cópia sanitizada.

**DEPENDÊNCIAS**  
A0-02/A0-03, decisões de modelos canônicos, owner de dados.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE.

### [A1-02] Tornar compose, configuração e ambientes portáteis

**STATUS ATUAL**  
Compose declara Postgres, MinIO, API e frontend, mas usa contextos absolutos; exemplos divergem e o lockfile frontend está fora de sincronia.

**EVIDÊNCIA**  
`docker-compose.yml`, Dockerfiles, `.env.example`, `backend/.env.example`; tentativa local complementar.

**CAUSA RAIZ**  
Artefatos de deploy foram acoplados ao host anterior e não existe contrato único de configuração/build.

**IMPACTO**  
Onboarding lento, setup manual, risco de apontar para serviço errado e builds não determinísticos.

**CORREÇÃO PROPOSTA**  
Usar contextos relativos, perfis por ambiente, tags/digests aprovados, lockfiles sincronizados, validação de variáveis e runbook PowerShell.

**TARGET STATE**  
Um checkout limpo sobe localmente com configuração sanitizada e sem editar Dockerfiles/paths.

**CRITÉRIO DE ACEITE**  
Build e startup passam em máquina limpa e CI; nenhum endpoint live é selecionado em dev/test; documentação reproduz o resultado.

**DEPENDÊNCIAS**  
A1-01, A0-05, A1-04.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; execução portátil requer validação runtime.

### [A1-03] Retirar scheduler meteorológico do processo HTTP

**STATUS ATUAL**  
O job inicia após 8 segundos e roda em `setInterval` a cada 15 minutos em cada réplica, sem flag, lock, líder ou prevenção de overlap.

**EVIDÊNCIA**  
`backend/src/index.ts`, `weatherIngest.ts`; HV-17; P5A-007/012.

**CAUSA RAIZ**  
Agendamento e serviço HTTP compartilham ciclo de vida sem coordenação distribuída.

**IMPACTO**  
Duplicação de ingestão/custo, concorrência, startup com egress e escalabilidade imprevisível.

**CORREÇÃO PROPOSTA**  
Mover para worker/cron/fila; adicionar flag, lock distribuído, idempotência, timeout, retry e métricas.

**TARGET STATE**  
Exatamente uma execução lógica por janela, independente do número de réplicas da API.

**CRITÉRIO DE ACEITE**  
Duas réplicas produzem um único run; overlap é negado; falha/retry ficam auditados e health da API é independente.

**DEPENDÊNCIAS**  
E06, A1-02, A1-05; sandbox/egress controlado para teste.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; duplicação requer runtime controlado.

### [A1-04] Implantar CI e suíte backend/contrato/tenant

**STATUS ATUAL**  
Não há testes backend; frontend tem 3 arquivos/9 testes e não existe gate visível de contrato, tenant, migration, SCA ou secrets.

**EVIDÊNCIA**  
D5-01–03, S5A-024, inventário do repositório.

**CAUSA RAIZ**  
A velocidade de prototipação/migração não foi acompanhada por uma pirâmide de testes e gates automatizados.

**IMPACTO**  
Correções estruturais têm alto risco de regressão e “preservar o que funciona” não é verificável.

**CORREÇÃO PROPOSTA**  
Criar testes unitários de domínio, integração com banco descartável, contratos API, matriz A/B, E2E críticos e CI com lint/typecheck/migrations/SCA/secret scan.

**TARGET STATE**  
Toda fatia vertical só integra após provar segurança, persistência e não regressão.

**CRITÉRIO DE ACEITE**  
Pipeline bloqueia falha; cobre auth/tenant, OP→WEEKLOG→pagamento, documentos e migrations; relatórios não expõem secrets.

**DEPENDÊNCIAS**  
A1-01/A1-02 e dataset sintético.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE.

### [A1-05] Estruturar health/readiness, logs, telemetria e redaction

**STATUS ATUAL**  
Health prova API+DB, não MinIO; há probes `127.0.0.1:7777`, console ruidoso, mensagens internas e telemetria/replay sem política central de redaction.

**EVIDÊNCIA**  
HV-19/20; S5A-022/023; D5-04; 27 probes catalogados.

**CAUSA RAIZ**  
Instrumentação temporária e logs de bibliotecas/HTTP foram acumulados sem modelo comum de evento, ambiente, sensibilidade ou SLO.

**IMPACTO**  
Diagnóstico de incidente difícil, ruído operacional, egress inesperado e risco de registrar IDs, PII, payloads, URLs assinadas ou tokens.

**CORREÇÃO PROPOSTA**  
Remover probes; logging estruturado com correlação/redaction; separar audit log de observabilidade; configurar telemetria opt-in; readiness por dependência e runbooks/SLOs.

**TARGET STATE**  
Logs úteis, mínimos e sem segredo; falha de storage ou integração aparece em readiness/métrica adequada.

**CRITÉRIO DE ACEITE**  
Captura sintética comprova zero token/PII proibida; nenhum request a `127.0.0.1:7777`; health/readiness distinguem processo, DB e storage.

**DEPENDÊNCIAS**  
E08/S06, A0-06, A1-02/A1-04.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE e PARCIALMENTE OBSERVADO em runtime quanto ao ruído.

### A2. Migração Supabase

### [A2-01] Substituir a façade noop por falha explícita e governança de migração

**STATUS ATUAL**  
48 arquivos importam o cliente Supabase; 45 participam de fluxos funcionais. A façade pode devolver vazio/sucesso sem request ou persistência.

**EVIDÊNCIA**  
`src/integrations/supabase/client.ts`; Fase 3, categorias A–D; D7-01/D7-04.

**CAUSA RAIZ**  
A camada de compatibilidade neutraliza sintomas para manter a UI de pé, mas elimina a semântica de erro e não registra quais capacidades continuam legadas.

**IMPACTO**  
Falsa sensação de sucesso, perda silenciosa, telas divergentes e diagnóstico enganoso.

**CORREÇÃO PROPOSTA**  
Criar inventário executável por capacidade, feature flags e adaptadores explícitos; em caminho não migrado, falhar de modo observável e seguro; remover import somente após fatia fechada.

**TARGET STATE**  
Cada domínio possui uma única fonte de verdade ativa; caminho não suportado nunca retorna sucesso.

**CRITÉRIO DE ACEITE**  
Testes provam que nenhuma mutação noop gera toast de sucesso; contagem de importadores cai apenas com casos verticais aceitos.

**DEPENDÊNCIAS**  
A1-04, A0-03; decisão de portfólio B6-01.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE e compatível com observação manual.

### [A2-02] Fechar os fluxos híbridos por fatias REST/Prisma

**STATUS ATUAL**  
13 fluxos têm substituto REST total/parcial; outros dependem de backend ausente, legado exclusivo ou decisão de domínio. A mesma função usa mecanismos diferentes em telas diferentes.

**EVIDÊNCIA**  
Matriz dos 13 fluxos em `api-contracts-and-bugs.md`; 45 importadores funcionais; 9 capacidades sem endpoint.

**CAUSA RAIZ**  
O porte foi organizado por chamadas/arquivos, não por unidade funcional ponta a ponta.

**IMPACTO**  
Pagamento, reconciliação, dashboard, documentos, convites e identidade apresentam comportamento inconsistente e retrabalho.

**CORREÇÃO PROPOSTA**  
Priorizar pagamentos/documentos/produção; para cada fatia alinhar contrato, tenant, modelo, migração de dados, reload/erros e testes; remover legado correspondente.

**TARGET STATE**  
Um fluxo tem uma API, um modelo e um comportamento consistente em todas as telas.

**CRITÉRIO DE ACEITE**  
HAR/testes não mostram host Supabase; create/update/delete sobrevivem a reload e falha produz erro verificável, não sucesso local.

**DEPENDÊNCIAS**  
A2-01, A0-03, A1-01/A1-04 e itens de domínio A3–A6.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; comportamento por tela requer validação seletiva.

### [A2-03] Classificar Edge Functions e módulos legados antes de portar ou remover

**STATUS ATUAL**  
Das 28 Edge Functions, 17 têm equivalente Express, 1 é parcial, 7 não foram portadas e 3 estão desativadas; módulos continuam expostos na UI.

**EVIDÊNCIA**  
Matriz da Fase 2 e F105–F115/F123–F130.

**CAUSA RAIZ**  
Ausência de decisão de portfólio e de critérios de encerramento para legado.

**IMPACTO**  
Escopo implícito, manutenção de código órfão e risco de reimplementar capacidade sem valor validado.

**CORREÇÃO PROPOSTA**  
Para cada capacidade decidir manter, substituir, ocultar ou encerrar; só então portar dados/contratos ou remover com telemetria e plano de transição.

**TARGET STATE**  
Nenhum módulo visível depende de backend inexistente; nenhum legado é removido sem decisão e evidência de uso.

**CRITÉRIO DE ACEITE**  
Registro de decisão P02 cobre todas as capacidades e gera backlog explícito ou retirada segura.

**DEPENDÊNCIAS**  
B6-01, A2-01, stakeholders de produto.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; valor/uso requer decisão de portfólio.

### A3. Identidade e dados

### [A3-01] Definir identidade canônica entre User, AppUser, Profile e Person

**STATUS ATUAL**  
Autenticação, perfil, membership e pessoa física usam quatro representações; `systemAccessUserId` não forma relação forte.

**EVIDÊNCIA**  
Fase 2 §3.1/3.2; D2-02; CTS-016–027.

**CAUSA RAIZ**  
Bounded contexts de IAM e RH cresceram sem IDs e responsabilidades explícitas; a separação desejada foi confundida com duplicação não governada.

**IMPACTO**  
Vínculos, autoria, técnico, desligamento e permissões podem usar identificadores diferentes.

**CORREÇÃO PROPOSTA**  
Preservar ausência de auto-sync, mas definir identidade, relações opcionais explícitas, lifecycle e migração incremental; cargo RH nunca concede permissão.

**TARGET STATE**  
Colaborador interno e utilizador externo permanecem separados, com vínculo manual somente se futuramente autorizado.

**CRITÉRIO DE ACEITE**  
Cada referência usa ID documentado; criar um lado não cria o outro; desligamento preserva autoria conforme B02.

**DEPENDÊNCIAS**  
B02, B12 respondida, A0-02/A0-03, A1-01.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; regra de desligamento requer decisão.

### [A3-02] Consolidar cliente canônico entre operação, faturamento e relacionamento

**STATUS ATUAL**  
`Client`, `BillingClient` e `Person(type=client)` são entidades concorrentes sem sincronização ou chave canônica.

**EVIDÊNCIA**  
Fase 2 §2.1/3; F024; D2-01; CTS-023; B01.

**CAUSA RAIZ**  
Cada módulo introduziu seu próprio cadastro de cliente e referências escalares, sem aggregate compartilhado.

**IMPACTO**  
Dados divergentes, seleção incorreta, faturamento desconectado e reconciliação manual/retrabalho.

**CORREÇÃO PROPOSTA**  
Validar premissa de cliente conceitualmente único; escolher master ID e bounded views; mapear duplicados, migração e compatibilidade temporária.

**TARGET STATE**  
Operação, faturamento e relacionamento referenciam a mesma identidade de negócio, com dados contextuais explícitos.

**CRITÉRIO DE ACEITE**  
Alteração autorizada é refletida pelos módulos previstos; nenhuma nova ordem/fatura nasce sem referência canônica; divergências históricas são reconciliadas.

**DEPENDÊNCIAS**  
Validação B01, A0-03, A1-01, decisão sobre utilizadores externos.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; target é PREMISSA EVERGREEN A VALIDAR.

### [A3-03] Alinhar Company, Workspace, perfil pessoal e configuração empresarial

**STATUS ATUAL**  
Workspace/membership existem, mas não há aggregate `Company`; `CompanySetting` pertence ao usuário, misturando perfil pessoal e marca empresarial.

**EVIDÊNCIA**  
CTS-006–014; `settings.ts`; `WorkspaceSwitcher`; gap F0.

**CAUSA RAIZ**  
Workspace foi usado como tenant técnico e empresa, enquanto configuração nasceu no escopo do usuário.

**IMPACTO**  
Branding incorreto ao alternar empresa, ownership ambíguo e dificuldade de isolamento multiempresa.

**CORREÇÃO PROPOSTA**  
Definir Company↔Workspace e owner; separar contratos de perfil/empresa; migrar settings/assets e reusar onboarding/switcher.

**TARGET STATE**  
Empresa ativa determina workspace, nome, logo, dados e permissões; perfil permanece pessoal.

**CRITÉRIO DE ACEITE**  
Alternar A↔B troca marca/dados sem reload ou mistura; cada empresa possui exatamente o vínculo definido.

**DEPENDÊNCIAS**  
B08, A0-02/A0-03, A1-01, MV4B-02.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; switch atual é parcialmente observável em runtime.

### [A3-04] Completar lifecycle de memberships, convites e desligamento

**STATUS ATUAL**  
Fluxo de members existe; deep link `/join` não está registrado/compatível; convites não têm política completa e desligamento permanece indefinido.

**EVIDÊNCIA**  
CT-03, B4A-023, S5A-016, B02/B10.

**CAUSA RAIZ**  
Contrato legado por token e REST por `inviteId` coexistem; lifecycle de identidade não foi formalizado.

**IMPACTO**  
Convites quebrados/duplicados, papéis incoerentes e permanência indevida de acesso.

**CORREÇÃO PROPOSTA**  
Definir token opaco, expiração, uso único, reenvio/conflito; encerrar sessão/membership ao desligar sem apagar histórico.

**TARGET STATE**  
Entrada e saída do tenant são determinísticas, auditadas e não alteram autoridade global.

**CRITÉRIO DE ACEITE**  
Convite válido completa uma vez; expirado/repetido falha previsivelmente; desligado perde ações futuras e autoria histórica permanece.

**DEPENDÊNCIAS**  
B02; B10 pode ser refinida na implementação; A0-02/A0-06/A1-04.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; happy path e concorrência requerem runtime.

### A4. Operação: Produção, WEEKLOG, pagamentos e financeiro

### [A4-01] Recuperar Produção e histórico sem regressão

**STATUS ATUAL**  
UI, POST/PATCH e estados de OP existem; timeline está desabilitado. A observação manual não comprovou create→reload→estados de forma rastreável.

**EVIDÊNCIA**  
CTS-001/002/004/005; `ProductionPage`, `useProductionTimeline`; MV4B-01.

**CAUSA RAIZ**  
Apresentação e contrato evoluíram sem teste E2E; fonte de eventos foi desligada durante a migração.

**IMPACTO**  
Core pode parecer disponível sem persistência/log; ausência de histórico reduz controle operacional.

**CORREÇÃO PROPOSTA**  
Executar MV4B-01; preservar camadas válidas; religar timeline a eventos persistentes tenant-scoped; automatizar estados/reload.

**TARGET STATE**  
OP direta e via orçamento coexistem, estados persistem e toda mudança relevante aparece cronologicamente.

**CRITÉRIO DE ACEITE**  
Abrir→salvar→recarregar→pausar→finalizar→recarregar funciona em A, não toca B e gera histórico ordenado.

**DEPENDÊNCIAS**  
A0-03, A1-01/A1-04; A4-02/A4-04 para fluxo completo.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
PARCIALMENTE OBSERVADO; requer MV4B-01.

### [A4-02] Persistir orçamento/PDR atual como domínio auditável

**STATUS ATUAL**  
Orçamento, cálculo e aprovação vivem em React/localStorage; ao converter, estrutura é serializada em `ProductionOrder.notes`.

**EVIDÊNCIA**  
F028–F034, B4A-024, CTS-003/051.

**CAUSA RAIZ**  
O protótipo visual precedeu modelo, contrato e workflow de aprovação no backend.

**IMPACTO**  
Perda entre navegadores, duplicidade, ausência de versões/constraints e disputa sobre o conteúdo aprovado.

**CORREÇÃO PROPOSTA**  
Criar entidade/versionamento mínimo do orçamento atual, API tenant-scoped, chave idempotente e migração de notas reconhecíveis; preservar cálculos validados.

**TARGET STATE**  
Orçamento sobrevive a reload, possui versão/autor/estado e converte uma vez em OP.

**CRITÉRIO DE ACEITE**  
Duas sessões veem a mesma versão; aprovação gera no máximo uma OP; conteúdo aprovado não é sobrescrito silenciosamente.

**DEPENDÊNCIAS**  
B03/B04, A0-03, A1-01/A1-04; base para B4-01.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE.

### [A4-03] Separar semanticamente WEEKLOG de ServiceOrder

**STATUS ATUAL**  
WEEKLOG é rota/tela de `ServiceOrder`, mas também é descrito como consolidação semanal; lista/pagamento se apoiam nessa ambiguidade.

**EVIDÊNCIA**  
Fase 2 §3.3; F046–F057; B06; D2-03.

**CAUSA RAIZ**  
Uma tabela física passou a representar ordem individual, agrupamento semanal e etapa financeira sem aggregate ou identificador de negócio explícito.

**IMPACTO**  
Referências frágeis, listas duplicadas, relatórios inconsistentes e dificuldade de definir aceite/retificação.

**CORREÇÃO PROPOSTA**  
Validar premissa de consolidação semanal; modelar referência/aggregate e compatibilidade; migrar relações e remover dependência de nomes/texto.

**TARGET STATE**  
WEEKLOG possui semântica única e liga operações individuais, semana, validação e listas sem sobreposição implícita.

**CRITÉRIO DE ACEITE**  
Cada intervenção/semana é representada sem duplicidade; consultas e UI usam o mesmo identificador e regras documentadas.

**DEPENDÊNCIAS**  
Validação B06, A1-01, A3-02, A4-04/A4-05.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; target é PREMISSA EVERGREEN A VALIDAR.

### [A4-04] Garantir idempotência e recuperação em OP→WEEKLOG→PaymentOrder

**STATUS ATUAL**  
Entrega/validação e efeitos derivados são commits separados; exceções podem preservar sucesso primário; faltam uniques e proteção contra corrida.

**EVIDÊNCIA**  
B4A-025/026/028/029; H4A-002/003; `productionOrders.ts`, `serviceOrders.ts`.

**CAUSA RAIZ**  
Check-then-create e catches locais substituem uma unidade de trabalho, outbox ou estado recuperável de domínio.

**IMPACTO**  
OP concluída sem WEEKLOG, WEEKLOG validado sem pagamento, duplicação de listas e perda financeira.

**CORREÇÃO PROPOSTA**  
Após B03, aplicar transação onde couber e outbox/saga/estado pending onde houver fronteira; adicionar idempotency key, constraints e reconciliação operacional.

**TARGET STATE**  
Cada transição gera exatamente um derivado ou uma pendência visível/reexecutável, nunca sucesso silencioso.

**CRITÉRIO DE ACEITE**  
Repetição e concorrência geram um WEEKLOG/PaymentOrder; falha induzida produz estado aprovado e retry seguro.

**DEPENDÊNCIAS**  
Decisão B03, A0-03, A1-01/A1-04, A4-03.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; duplicação/recuperação requer runtime.

### [A4-05] Isolar e tornar atômico o núcleo financeiro/reconciliação

**STATUS ATUAL**  
Reconciliação carrega/apaga dados automáticos globalmente; `Reconciliation`, regras/distribuições e registros têm tenant ausente/opcional e relações fracas.

**EVIDÊNCIA**  
B4A-001–003/027/029; S5A-004/010; P5A-002–006.

**CAUSA RAIZ**  
O motor foi construído sobre coleções globais e IDs escalares, sem aggregate tenant-scoped nem unidade de trabalho para status, ajuste e evento.

**IMPACTO**  
Alteração cross-tenant, perda de reconciliações, ledger divergente, risco monetário e baixa escalabilidade.

**CORREÇÃO PROPOSTA**  
Definir processos OS×PaymentOrder e invoice×payment; introduzir tenant/FKs/uniques, snapshots/versionamento, autorização e transações/outbox; paginar/indexar matching.

**TARGET STATE**  
Reconciliação de A nunca toca B; validação/reabertura deixa trilha e ajuste/evento coerentes.

**CRITÉRIO DE ACEITE**  
Snapshot B permanece idêntico após run A; falha não confirma parcialmente; reabertura autorizada gera evento imutável.

**DEPENDÊNCIAS**  
B05/B07 e B03 quando encadeado; A0-03, A1-01/A1-04, A4-03/A4-04.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; idempotência/escala requerem runtime.

### [A4-06] Migrar mutações de PaymentOrder e contratos de discrepância

**STATUS ATUAL**  
Edição/pagamento/exclusão usam Supabase noop apesar de PATCH/DELETE REST; hooks chamam dois endpoints inexistentes de discrepância.

**EVIDÊNCIA**  
B4A-018/019; CT-01/02; F058–F061.

**CAUSA RAIZ**  
Frontend e backend evoluíram separadamente e mantêm duas taxonomias de reconciliação/discrepância.

**IMPACTO**  
Falso pagamento/exclusão, estado visual divergente e ações 404.

**CORREÇÃO PROPOSTA**  
Após fechar domínio, migrar tabela ao REST, padronizar envelope/status/batch e consolidar discrepância no contrato financeiro aprovado.

**TARGET STATE**  
Toda mutação de pagamento é persistente, tenant-scoped, idempotente e refletida após reload.

**CRITÉRIO DE ACEITE**  
Update/pay/delete alteram banco uma vez; falha não gera toast de sucesso; nenhum endpoint ausente é chamado.

**DEPENDÊNCIAS**  
A2-01/A2-02, A0-03, A4-05 e B07.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE.

### A5. Documentos e storage

### [A5-01] Criar ownership tenant→entidade→objeto para documentos e MinIO

**STATUS ATUAL**  
Metadados têm workspace opcional; bucket/path são escolhidos pelo cliente; operações por ID/lote não provam ownership; quatro buckets são públicos.

**EVIDÊNCIA**  
B4A-007/008/011/017; S5A-005–007; `documents.ts`, `storage.ts`, `minio.ts`.

**CAUSA RAIZ**  
Storage foi exposto como serviço genérico, separado do aggregate e da autorização do documento/foto.

**IMPACTO**  
Leitura, sobrescrita, publicação ou exclusão cross-tenant; objetos órfãos; vazamento de credencial em URL.

**CORREÇÃO PROPOSTA**  
Modelar objeto com tenant/owner/classificação/hash; prefixos internos gerados pelo servidor; MIME/tamanho/scan; URLs curtas; compensação e lifecycle.

**TARGET STATE**  
O usuário nunca escolhe um path com autoridade; acesso deriva do documento e do tenant.

**CRITÉRIO DE ACEITE**  
Testes A/B negam leitura/delete/sobrescrita; falha DB/objeto é compensada/detectada; hashes e auditoria fecham o ciclo.

**DEPENDÊNCIAS**  
B09/S07, A0-03/A0-06, A1-01/A1-04.

**PRIORIDADE**  
P0.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; lifecycle requer runtime.

### [A5-02] Consolidar file manager REST e retenção documental

**STATUS ATUAL**  
`EmbeddedFileManager` usa REST/MinIO, mas a tela `/documents` usa Supabase noop; exclusões nem sempre removem objeto e retenção não está formalizada.

**EVIDÊNCIA**  
F116/117; B4A-021; CTS-021/028–031; B09.

**CAUSA RAIZ**  
Migração por componente e ausência de política comum de arquivo, exclusão, versão e retenção.

**IMPACTO**  
Listas vazias/falso sucesso, perda ou retenção indefinida e mecanismos paralelos.

**CORREÇÃO PROPOSTA**  
Reusar um único file manager sobre A5-01; migrar tela global; definir archive/delete/backup e mínimo de 180 dias se validado; preservar Documentos por País.

**TARGET STATE**  
Documento reaparece após reload, pertence à entidade correta e segue lifecycle conhecido sem remodelar o catálogo por país.

**CRITÉRIO DE ACEITE**  
Upload/list/download/archive/delete passam com policy; tela global e embutida mostram mesma fonte; catálogo atual não sofre regressão.

**DEPENDÊNCIAS**  
Validação B09, A5-01, A2-02, A1-04.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; persistência/retenção requer runtime.

### A6. Locais, mapas e dados operacionais

### [A6-01] Tornar Location entidade tenant-scoped e persistente

**STATUS ATUAL**  
CRUD/campos existem, mas workspace é opcional/confiado, há apenas active/inactive, gerente é texto livre e não há GPS/link.

**EVIDÊNCIA**  
F025/026; CTS-032–038; B4A-010; MV4B-03.

**CAUSA RAIZ**  
Location nasceu como cadastro simples e ainda não funciona como aggregate operacional ligado a pessoas/mapa.

**IMPACTO**  
Risco cross-tenant, desaparecimento aparente após salvar, gerente sem identidade e impossibilidade de mapa real.

**CORREÇÃO PROPOSTA**  
Primeiro testar persistência; tornar tenant obrigatório e contratos scoped; depois migrar status, coordenadas e relação de gerente conforme B13.

**TARGET STATE**  
Local é ficha real de filial/atuação, persistente e referenciável pelo mapa e equipes.

**CRITÉRIO DE ACEITE**  
Salvar→recarregar→sair/entrar preserva Local em A; B não aparece; status/GPS/gerente seguem regras validadas.

**DEPENDÊNCIAS**  
Validação B13, A0-03, A1-01/A1-04, MV4B-03.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
PARCIALMENTE OBSERVADO; causa do desaparecimento requer runtime.

### [A6-02] Substituir dados aproximados/sintéticos do mapa por projeções reais

**STATUS ATUAL**  
Há um único `OperationalMap` reaproveitável, mas Operações/Ordens usam cidade hardcoded e jitter; Equipes depende de telemetria Supabase/noop.

**EVIDÊNCIA**  
CTS-038–045; F083–F088; gap F4.

**CAUSA RAIZ**  
Camadas visuais foram implementadas antes das fontes canônicas de Location, equipe e ordem.

**IMPACTO**  
Representação enganosa, ausência de dados reais, mistura tenant e falsa sensação de operação em tempo real.

**CORREÇÃO PROPOSTA**  
Preservar o mapa único/toggles; criar projeções tenant-scoped de Location/equipe/ordem; mostrar vazio explícito; migrar telemetria com consentimento/retenção.

**TARGET STATE**  
Cada marcador é rastreável a entidade real autorizada; ausência de fonte produz vazio, nunca posição inventada.

**CRITÉRIO DE ACEITE**  
Mapa A mostra apenas fixtures A com origem identificável; toggles respondem; nenhum `CITY_COORDS`/jitter cria dado operacional.

**DEPENDÊNCIAS**  
A6-01, A0-03, A2-02, B06/B11 e MV4B-04.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE para fonte sintética; apresentação requer runtime.

### [A6-03] Governar Weather/OpenRouteService e suas falhas

**STATUS ATUAL**  
Clima e ORS/Nominatim existem, mas aliases de env divergem, ingestão carece de RBAC e scheduler/quotas/egress não são governados.

**EVIDÊNCIA**  
HV-15–17; variáveis do handover; S5A-009; `weatherIngest.ts`, `routeCalc.ts`.

**CAUSA RAIZ**  
Integrações externas foram acopladas diretamente a rotas/job sem gateway operacional e contrato de ambiente.

**IMPACTO**  
Custo, rate limit, resultados inconsistentes e dependência externa podendo degradar API.

**CORREÇÃO PROPOSTA**  
Normalizar configuração; aplicar RBAC/tenant; gateway com timeout/cache/circuit breaker; identificar fonte/fallback; separar job conforme A1-03.

**TARGET STATE**  
Mapa/Radar degrada explicitamente sem fabricar dados; rota informa fonte e integrações obedecem quota/ambiente.

**CRITÉRIO DE ACEITE**  
Falha externa não derruba health; anônimo/membro sem papel não ingere; fallback e fonte são observáveis em sandbox.

**DEPENDÊNCIAS**  
A0-04, A1-03/A1-05, A6-02; chaves dedicadas somente para teste autorizado.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE; provedores requerem runtime sandbox.

## 4. BACKLOG B — NOVAS FUNCIONALIDADES / EVOLUÇÃO

### [B1-01] Entregar experiência multiempresa e estado sem empresa

**STATUS ATUAL**  
Switcher/workspaces existem, mas empresa canônica, criação pelo Perfil, branding por empresa e gate “sem workspace” não existem de forma completa.

**EVIDÊNCIA**  
CTS-006–014 e prioridade 03/04 de Alex.

**CAUSA RAIZ**  
O target multiempresa é posterior ao modelo atual de settings por usuário e navegação somente por permissões.

**IMPACTO**  
Sem evolução, contas sem empresa veem módulos inadequados e alternância não representa empresa real.

**CORREÇÃO PROPOSTA**  
Após A3-03, reusar onboarding/switcher; criar empresa pelo Perfil; header dinâmico e gate central para mostrar apenas Perfil/Painel/Radar sem tenant.

**TARGET STATE**  
Um utilizador autorizado cria/alterna empresas isoladas e o shell reflete a empresa ativa.

**CRITÉRIO DE ACEITE**  
Conta sem empresa não acessa módulos operacionais; criar A/B e alternar troca branding/contexto sem vazamento.

**DEPENDÊNCIAS**  
B08, A0-02/A0-03, A3-03, A1-04, MV4B-02.

**PRIORIDADE**  
P1.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
REQUER DECISÃO DE NEGÓCIO e validação runtime do reuso.

### [B2-01] Evoluir Colaboradores internos

**STATUS ATUAL**  
People mistura tipos internos/externos e não possui catálogo governado de cargos, nomes separados, foto e dados bancários estruturados completos.

**EVIDÊNCIA**  
CTS-015–022; páginas 5–6 do plano de Alex.

**CAUSA RAIZ**  
O target redefine a finalidade de `Person`; campos genéricos não materializam catálogo, sensibilidade ou lifecycle.

**IMPACTO**  
Cadastro interno incompleto e confusão entre cargo, tipo de pessoa e permissão.

**CORREÇÃO PROPOSTA**  
Renomear após redesenho; modelar cargos extensíveis, identificação, contato/bancário e pasta documental com proteção/auditoria.

**TARGET STATE**  
Colaborador representa apenas pessoal interno e cargo não concede acesso ao sistema.

**CRITÉRIO DE ACEITE**  
Novo colaborador persiste campos, status e documentos; não cria utilizador; dados bancários têm acesso restrito.

**DEPENDÊNCIAS**  
A3-01, A5-01/A5-02, A6-01 para gerente, B02/B13.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE como evolução/redesenho.

### [B2-02] Evoluir Utilizadores como rede externa e cliente relacionado

**STATUS ATUAL**  
Membership possui papéis externos, mas autoridade global/local está acoplada e cliente permanece fragmentado.

**EVIDÊNCIA**  
CTS-023–027; página 6 do plano de Alex.

**CAUSA RAIZ**  
Identidade de acesso e relacionamento comercial foram sobrepostos sem aggregate de cliente/rede.

**IMPACTO**  
Permissões inconsistentes e ausência de visão confiável de técnicos/prestadores/clientes externos.

**CORREÇÃO PROPOSTA**  
Após A0-02/A3-02, apresentar rede externa com papéis próprios, vínculos de negócio e lifecycle; preservar ausência de criação automática de colaborador.

**TARGET STATE**  
Utilizadores externos não compartilham cargos de RH e operam somente nos workspaces concedidos.

**CRITÉRIO DE ACEITE**  
Criar técnico/cliente externo não cria Person interno; papel em A não afeta B; cliente canônico liga módulos aprovados.

**DEPENDÊNCIAS**  
Validação B01, A0-02/A0-03, A3-01/A3-02/A3-04.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
REQUER DECISÃO DE NEGÓCIO para cliente canônico.

### [B3-01] Completar Local operacional com status, GPS e gerente canônico

**STATUS ATUAL**  
A6-01 estabiliza o cadastro; o target adiciona Ativo/Pausado/Encerrado, ponto/link e gerente colaborador.

**EVIDÊNCIA**  
CTS-035/036/038; página 8 de Alex.

**CAUSA RAIZ**  
São requisitos novos sobre uma entidade antes apenas cadastral.

**IMPACTO**  
Sem evolução, mapa e operação não podem usar locais reais nem representar lifecycle.

**CORREÇÃO PROPOSTA**  
Modelar transições, coordenadas validadas e relação com Colaborador; criar projeção para o mapa único.

**TARGET STATE**  
Local ativo/pausado/encerrado é fonte de verdade operacional e geográfica.

**CRITÉRIO DE ACEITE**  
Status filtra corretamente; coordenada/link reabre igual; gerente seleciona registro válido e mapa recebe apenas locais autorizados.

**DEPENDÊNCIAS**  
Validação B13, A6-01/A6-02, B2-01.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
M.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE como evolução; B13 permanece premissa.

### [B4-01] Criar domínio PDR por peça, versão e aprovação

**STATUS ATUAL**  
Não há entidade persistente de ficha, peça, dano, versão ou aprovação; orçamento atual é local.

**EVIDÊNCIA**  
CTS-046/049/050; F035–F037; B04.

**CAUSA RAIZ**  
A capacidade é nova e não pode ser inferida do OCR documental nem de componentes visuais.

**IMPACTO**  
Sem domínio, estimativa, preço, fotos e documento aprovado não têm fonte auditável.

**CORREÇÃO PROPOSTA**  
Definir aggregate PDR, catálogo de peças/danos, estados, versões imutáveis e aprovação/reprovação com motivo e autoria.

**TARGET STATE**  
Orçamentista cria; cliente aprova; alteração material gera nova versão conforme decisão B04.

**CRITÉRIO DE ACEITE**  
Versão aprovada permanece imutável; histórico permite comparar versões; totais derivam somente de danos vigentes.

**DEPENDÊNCIAS**  
Decisão B04, A4-02, A0-03, A1-01/A1-04, A5-01.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
REQUER DECISÃO DE NEGÓCIO; ausência confirmada estaticamente.

### [B4-02] Associar fotos a peças e danos

**STATUS ATUAL**  
`ProductionPhoto`/MinIO existem, mas foto não referencia peça/dano PDR nem ownership completo.

**EVIDÊNCIA**  
CTS-047; F036; modelo `ProductionPhoto`.

**CAUSA RAIZ**  
Galeria de produção precede o domínio PDR.

**IMPACTO**  
Evidência visual não sustenta orçamento, aprovação nem auditoria por peça.

**CORREÇÃO PROPOSTA**  
Reusar upload/galeria sobre A5-01; criar relações e classificação; preservar fotos legadas sem associação explícita.

**TARGET STATE**  
Cada foto conhece tenant, veículo, ficha/versão, peça e dano quando aplicável.

**CRITÉRIO DE ACEITE**  
Foto A não é acessível em B; remoção/versionamento segue lifecycle; registros legados não são atribuídos artificialmente.

**DEPENDÊNCIAS**  
B4-01, A5-01/A5-02, B09.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE como nova funcionalidade.

### [B4-03] Implementar estimativa IA com validação humana

**STATUS ATUAL**  
Há infraestrutura Gemini/OpenAI para OCR documental; não existe modelo/avaliação de dano visual nem workflow humano.

**EVIDÊNCIA**  
CTS-048/049; F037; `ai.ts`.

**CAUSA RAIZ**  
Cliente de LLM não equivale a produto de visão avaliado, governado e integrado ao domínio.

**IMPACTO**  
Estimativa pode gerar custo, viés/erro e decisão financeira sem evidência ou responsabilização.

**CORREÇÃO PROPOSTA**  
Definir schema estruturado, dataset/eval, consentimento/retenção, quota e proveniência; IA apenas propõe; humano aceita/corrige/rejeita.

**TARGET STATE**  
Saída é sugestão rastreável vinculada à evidência e nunca altera versão aprovada automaticamente.

**CRITÉRIO DE ACEITE**  
100% das propostas têm modelo/versão/evidência e decisão humana; falha/baixa confiança não fabrica estimativa; custos têm limite.

**DEPENDÊNCIAS**  
B04, B4-01/B4-02, A0-04, A5-01, política S06.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
XL.

**CONFIANÇA**  
REQUER DECISÃO DE NEGÓCIO e validação futura de IA.

### [B4-04] Consolidar danos e preço/forfait com trilha financeira

**STATUS ATUAL**  
Cálculo/preço vivem localmente/notes; não há dano aprovado persistente nem evento de congelamento do valor técnico.

**EVIDÊNCIA**  
CTS-050/051; B05; A4-02/A4-05.

**CAUSA RAIZ**  
Regras comerciais e financeiras não foram modeladas como versão e evento de domínio.

**IMPACTO**  
Valores podem divergir entre orçamento, WEEKLOG, pagamento e reconciliação.

**CORREÇÃO PROPOSTA**  
Derivar totais da versão aprovada; permitir forfait manual por papel; registrar autor/motivo/vigência; congelar/reabrir conforme B05.

**TARGET STATE**  
Valor comercial e valor do técnico são distintos, versionados e reconciliáveis.

**CRITÉRIO DE ACEITE**  
Mesmo input aprovado gera total determinístico; override fica auditado; reabertura gera nova versão e nunca sobrescreve histórico.

**DEPENDÊNCIAS**  
Decisão B05, B4-01, A4-03/A4-05.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
REQUER DECISÃO DE NEGÓCIO.

### [B5-01] Produzir documentos white-label por empresa ativa

**STATUS ATUAL**  
Geradores/assets existem, mas branding pertence ao usuário e não há template tenant-scoped/versionado.

**EVIDÊNCIA**  
CTS-052; `CompanySetting`; billing/PDF inventariado.

**CAUSA RAIZ**  
Saída documental foi implementada antes de Company/Workspace e ownership de assets.

**IMPACTO**  
Documento pode usar marca errada ou misturar dados entre empresas.

**CORREÇÃO PROPOSTA**  
Versionar templates/assets por empresa; resolver marca pelo TenantContext; proteger preview/PDF e registrar versão usada.

**TARGET STATE**  
Todo documento identifica inequivocamente a empresa ativa e preserva o conteúdo de negócio.

**CRITÉRIO DE ACEITE**  
Mesmo caso gerado em A/B troca apenas campos de marca autorizados; nenhuma referência cruzada; PDF é reprodutível pela versão.

**DEPENDÊNCIAS**  
A3-03, A5-01/A5-02, A1-04, B09.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE como redesenho/evolução.

### [B5-02] Gerar documentos multilíngues com invariantes

**STATUS ATUAL**  
UI possui i18n, mas não existe pipeline comprovado de documentos PT/EN/FR/DE/ES/IT.

**EVIDÊNCIA**  
CTS-053; inventário de PDF/i18n.

**CAUSA RAIZ**  
Tradução de interface e template documental são capacidades distintas; não há catálogo/versionamento/QA de templates.

**IMPACTO**  
Risco de tradução incompleta ou alteração de fatos, números e termos comerciais.

**CORREÇÃO PROPOSTA**  
Criar templates por idioma, fallback explícito, glossário e testes snapshot/estruturais que preservem valores e identificadores.

**TARGET STATE**  
Usuário escolhe idioma suportado e recebe documento semanticamente equivalente e versionado.

**CRITÉRIO DE ACEITE**  
Matriz de seis idiomas passa revisão; valores/datas/IDs permanecem equivalentes; ausência de tradução falha explicitamente.

**DEPENDÊNCIAS**  
B5-01, A5-02, A1-04, revisão jurídica/linguística.

**PRIORIDADE**  
P2.

**ESFORÇO RELATIVO**  
L.

**CONFIANÇA**  
CONFIRMADO ESTATICAMENTE como nova funcionalidade.

### [B6-01] Decidir portfólio de Frota, Marketplace, Automação, Copiloto e legados

**STATUS ATUAL**  
Esses módulos têm UI/código parcial ou legado, frequentemente sem backend Express/Prisma, e não possuem CTS explícito de implementação.

**EVIDÊNCIA**  
F089–F115/F123–F130; cluster F7; P02.

**CAUSA RAIZ**  
O repositório acumulou experimentos/capacidades sem decisão atual de produto e sem critérios de manutenção.

**IMPACTO**  
Escopo e custo podem ser inflados; manter UI quebrada reduz confiança; remover sem validação pode apagar valor.

**CORREÇÃO PROPOSTA**  
Fazer decisão de portfólio por módulo: manter/portar, substituir, ocultar ou encerrar; criar discovery/CTS separado somente para os escolhidos.

**TARGET STATE**  
Roadmap contém apenas capacidades autorizadas; shell não promete módulo sem serviço funcional.

**CRITÉRIO DE ACEITE**  
P02 registra decisão, owner e próximo passo para cada módulo; itens não escolhidos ficam ocultos/retirados por plano aprovado.

**DEPENDÊNCIAS**  
Decisão P02 e dados de uso; A2-03.

**PRIORIDADE**  
P3.

**ESFORÇO RELATIVO**  
S para decisão; implementação futura não estimada.

**CONFIANÇA**  
REQUER DECISÃO DE PORTFÓLIO.

## 5. Roadmap técnico por dependências

| Cluster | Objetivo e itens | Complexidade / risco | Reaproveitamento | Superfícies aproximadas | Migration / testes | Dependências e saída |
|---|---|---|---|---:|---|---|
| **FOUNDATION 0** | Segurança, TenantContext, banco e testes: A0-01–06, A1-01/04/05, A5-01 | XL / crítico | médio: JWT, membership, Prisma e MinIO existem | 20 domínios + infraestrutura | migrations obrigatórias; matriz A/B e auth/storage | fecha bootstrap, plano plataforma/tenant, baseline e gates |
| **FOUNDATION 1** | Identidade, Company/Workspace e dados canônicos: A3-01–04, A1-02 | XL / alto | médio-alto: onboarding, switcher, People/Users | 8–12 modelos e várias telas | migração de identidade/settings; MV4B-02/03 | depende de B01/B02/B08 e Foundation 0 |
| **VERTICAL 1** | Produção: A4-01/02 | L / alto | alto em OP/board; médio em orçamento | 5–8 superfícies | migration de orçamento; MV4B-01 e E2E | preserva criação direta e Orçamento→Produção |
| **VERTICAL 2** | WEEKLOG + Financeiro: A4-03–06 | XL / crítico | médio: handlers e UI financeira existem | 10+ modelos/rotas/telas | migrations/FKs/uniques; concorrência, falha e A/B | depende de B03/B05/B06/B07 e Vert. 1 |
| **VERTICAL 3** | Colaboradores/Utilizadores/Clientes: B2-01/02 + A3-01/02/04 | XL / alto | médio: formulários/memberships | 10+ superfícies | migração de IDs; testes negativos de auto-sync | depende de B01/B02/B13 e Foundation 1 |
| **VERTICAL 4** | Documentos: A5-02 + CTS 028–031 | L / crítico | alto: MinIO/REST/file manager | 6–9 superfícies | migração de metadados/objetos; ownership/lifecycle | depende de B09 e Foundation 0 |
| **VERTICAL 5** | Locais/Mapa: A6-01–03 + B3-01 | XL / alto | alto no mapa/CRUD; baixo nas fontes | 8–12 superfícies + provedores | migration GPS/status; MV4B-03/04 | depende de B06/B11/B13, Vert. 3 e storage/tenant |
| **EVOLUTION 1** | PDR/IA: B4-01–04 | XL / alto | médio periférico; baixo no domínio | novo aggregate + 8–12 superfícies | migrations e suíte/evals de IA | só após Vert. 1/2/4 e B04/B05 |
| **EVOLUTION 2** | White-label/multilíngue: B5-01/02 | L / médio-alto | médio: PDF/assets/i18n | 5–8 superfícies e 6 idiomas | templates/versionamento; snapshots/revisão | depende de Company e Documentos |
| **PORTFOLIO** | B6-01 | S para decisão / variável | indeterminado | 7+ módulos | testes apenas para módulos mantidos | não entra em implementação sem CTS próprio |

Não é fornecida faixa em dias úteis: B01/B03–B09/B13, os três cenários runtime mínimos e a decisão P02 podem alterar significativamente escopo e sequência. Uma estimativa preliminar só deve ser produzida depois desses gates, por equipe/capacidade conhecida.

## 6. Migração por fatia vertical — Definition of Done

Uma fatia só é considerada encerrada quando:

1. UI usa um único caminho ativo e não promete sucesso local;
2. contrato REST é versionado/validado e erros são explícitos;
3. autenticação, TenantContext, RBAC e autorização do objeto passam;
4. modelo/constraints e migration preservam dados;
5. persistência sobrevive a reload e retry;
6. integração com entidades adjacentes é atômica ou recuperável;
7. testes unitários, integração, A/B e E2E aplicáveis passam;
8. observabilidade não registra secrets/PII proibida;
9. o import/Edge Function/noop legado daquela capacidade é removido;
10. rollback e runbook são atualizados.

## 7. Totais consolidados

| Recorte | Total |
|---|---:|
| Backlog total | 40 |
| P0 | 10 |
| P1 | 19 |
| P2 | 10 |
| P3 | 1 |
| Estabilização/correção (Backlog A) | 29 |
| Evolução/target (Backlog B) | 11 |

Naturezas podem se sobrepor e foram contadas pelos IDs abaixo. Essas contagens não somam 40 porque um item pode ser redesenho, migração e runtime simultaneamente.

- **Redesign estrutural — 18**: A0-02, A0-03, A0-06, A1-03, A3-01, A3-02, A3-03, A4-03, A4-05, A5-01, A6-01, A6-02, B1-01, B2-01, B2-02, B3-01, B4-01 e B5-01.
- **Migração material — 12**: A1-01, A2-01, A2-02, A2-03, A3-01, A3-02, A3-03, A4-02, A4-03, A4-06, A5-02 e A6-02.
- **Validação runtime residual — 17**: A0-01, A0-02, A0-03, A0-04, A1-02, A1-03, A1-05, A2-02, A3-03, A3-04, A4-01, A4-04, A4-05, A5-01, A6-01, A6-02 e A6-03.

## 8. Validações runtime residuais

Durante o início da implementação, executar prioritariamente `MV4B-01` Produção, `MV4B-02` empresa ativa/acesso e `MV4B-03` persistência cadastral; `MV4B-04` mapa se o laboratório estiver disponível. Dos demais casos, selecionar por mudança: A/B de autorização, concorrência OP/WEEKLOG/pagamento, lifecycle storage, reconciliação A/B, Stripe sandbox, SMTP sink e scheduler de duas réplicas.

Esses testes refinam escopo e reaproveitamento, mas não alteram a decisão comercial central: o produto deve ser **recuperado e estabilizado por fatias**, não reescrito integralmente, porque há UI, rotas, modelos e integrações materiais reaproveitáveis. Também não eliminam os gaps estruturais de autoridade, tenant, baseline, ownership e domínio canônico.

## 9. Referencial

- OWASP API Security Top 10 2023: autorização por objeto/função e consumo de recursos.
- ISO/IEC 25010: adequação funcional, confiabilidade, segurança e manutenibilidade.
- ISO/IEC/IEEE 29148: requisitos e critérios de aceite rastreáveis/verificáveis.
- NIST SP 800-63B e OWASP Secrets Management Cheat Sheet: identidade e ciclo de secrets.
- RFC 9110: semântica HTTP e idempotência.
- Fowler, *Strangler Fig*: substituição incremental por capacidades.
- Gray & Reuter: atomicidade, consistência, isolamento e recuperação transacional.
