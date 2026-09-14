# Fase 5A — Segurança, performance e dívida técnica

## 1. Escopo, método e limites

Esta análise é exclusivamente estática. Ela cruza o código atual com os inventários das Fases 1–4A e com o handover validado. Nenhum endpoint foi chamado, nenhum container foi iniciado, nenhum dado foi criado e nenhuma credencial foi testada. Consequências que dependem de configuração, dados ou topologia reais permanecem explicitamente classificadas como **REQUER REPRODUÇÃO 4B**.

As classificações usadas são:

- segurança: **VULNERABILIDADE ESTATICAMENTE CONFIRMADA**, **RISCO ESTÁTICO** ou **REQUER REPRODUÇÃO 4B**;
- performance: **GARGALO ESTATICAMENTE IDENTIFICADO**, **RISCO DE PERFORMANCE** ou **REQUER BENCHMARK 4B**;
- impacto na Fase 2: **A** — deve preceder qualquer nova feature; **B** — resolver durante a estabilização do módulo; **C** — pode ser postergado; **D** — somente evolução.

O referencial de análise combina OWASP Top 10 e OWASP API Security Top 10 (controle de acesso, autenticação, consumo de recursos e configuração), CWE-639/CWE-598/CWE-770, NIST SP 800-63B, RFC 9110, ISO/IEC 25010, Twelve-Factor App e os princípios de menor privilégio, negação por padrão, isolamento de tenant e defesa em profundidade.

## 2. Sumário executivo

- Foram registrados **26 achados de segurança**: **11 vulnerabilidades estaticamente confirmadas**, **13 riscos estáticos** e **2 itens que requerem reprodução na Fase 4B**.
- A cadeia de autorregistro público permite persistir `admin` como papel global e emitir uma sessão com esse privilégio. O código confirma a vulnerabilidade; o alcance concreto sobre dados ou provedores depende de reprodução sanitizada.
- A raiz predominante não é um endpoint isolado: o sistema não possui um `TenantContext` obrigatório, confunde papel global com papel de workspace e aceita identificadores/`workspaceId` fornecidos pelo cliente. Na matriz solicitada, **16 de 20 domínios não têm isolamento de tenant suficiente**, 2 são parciais, 1 é adequado e 1 é isolado por usuário, porém semanticamente desalinhado.
- Foram registrados **18 achados de performance**: **9 gargalos estáticos**, **7 riscos** e **2 itens que requerem benchmark 4B**. Não há números de tempo inventados.
- A dívida técnica foi agrupada em **D1–D7**, com 28 itens rastreáveis. Migração Supabase→Prisma, baseline de banco, autorização multi-tenant, testes, scheduler e observabilidade são os maiores condicionantes da Fase 2.

## 3. Auditoria de segurança

### 3.1 Cadeia crítica: autorregistro público de administrador

| Etapa | Evidência estática | Resultado |
|---|---|---|
| Entrada | `backend/src/routes/auth.ts`: `POST /register` é público e o schema aceita `role` incluindo `admin`, com padrão `admin` | Um cliente anônimo controla o papel solicitado |
| Validação | Zod valida apenas que o valor pertence ao enum; não há convite, segredo de bootstrap, allowlist ou aprovação | `admin` é considerado entrada válida |
| Persistência | A transação cria `User.role`, `AppUser`, `Profile` e `UserRole.role` usando o papel recebido | O papel privilegiado é persistido em mais de uma representação |
| Sessão | Ao fim do cadastro, o backend assina e devolve JWT com o papel | O novo usuário recebe sessão autenticada imediatamente |
| Autorização subsequente | `requireAuth` recarrega `User.role`; rotas administrativas e partes de billing usam o papel global | O privilégio não depende apenas de claim obsoleta: é reafirmado pelo banco |
| Alcance real | Depende dos dados, flags, serviços e topologia do ambiente sanitizado | **REQUER REPRODUÇÃO 4B** para medir impacto, nunca em produção |

Conclusão: **S5A-001 é uma VULNERABILIDADE ESTATICAMENTE CONFIRMADA**. Não é correto afirmar estaticamente quais registros reais seriam acessíveis, nem provocar efeitos em Stripe, SMTP, storage ou produção. O teste 4B deve parar após comprovar autorização em fixtures descartáveis e sem provedores reais.

### 3.2 Achados

| ID | Classe | Pri. | Achado e evidência | Impacto / causa sistêmica | Fase 2 |
|---|---|---:|---|---|:---:|
| S5A-001 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Autorregistro público aceita e persiste `admin` e devolve JWT (`routes/auth.ts`) | Elevação de privilégio sem cerimônia de bootstrap ou aprovação | A |
| S5A-002 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Alterar papel de `Membership` também altera `User.role` e `UserRole` globais (`routes/workspaces.ts`) | Um administrador de workspace pode promover privilégio fora do limite daquele workspace | A |
| S5A-003 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | A política calcula `own/team/all`, mas os handlers em geral verificam apenas `allowed`; IDs e `workspaceId` vêm do cliente | BOLA/IDOR sistêmico por ausência de contexto de tenant obrigatório e de escopo na camada de dados | A |
| S5A-004 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Reconciliação carrega e apaga reconciliações automáticas globalmente antes de recalcular (`routes/finance.ts`) | Operação destrutiva entre tenants; também viola previsibilidade transacional | A |
| S5A-005 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Documentos têm `workspaceId` opcional, listagem não o impõe e operações por ID/lote não comprovam pertencimento (`routes/documents.ts`) | Leitura/alteração/remoção cross-tenant de metadados documentais | A |
| S5A-006 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Storage aceita bucket/path arbitrários de usuário autenticado; upload em memória até 50 MB; buckets públicos são servidos sem tenant (`routes/storage.ts`) | BOLA por chave de objeto, sobrescrita e publicação de conteúdo sem modelo de ownership | A |
| S5A-007 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Download privado aceita JWT em query string e o logger registra a URL (`routes/storage.ts`, `src/lib/storage.ts`, `index.ts`) | Credencial pode aparecer em access log, histórico, proxy e referrer (CWE-598) | A |
| S5A-008 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P1 | Cinco endpoints OCR/IA são públicos, recebem base64 e acionam provedores sem quota/rate limit (`routes/extract.ts`, `lib/ai.ts`) | Abuso financeiro e exaustão de recursos por operação cara não autenticada | A |
| S5A-009 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P1 | Qualquer autenticado pode disparar ingestão meteorológica e consultar logs/payloads internos (`routes/weather.ts`) | Consumo externo, amplificação e exposição operacional sem papel administrativo | A |
| S5A-010 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | `ProductionList` usa `listName` globalmente único e leitura/alteração por nome/ID sem filiação ao workspace | Colisão e interferência cross-tenant no fluxo OP→WEEKLOG→PaymentOrder | A |
| S5A-011 | VULNERABILIDADE ESTATICAMENTE CONFIRMADA | P0 | Billing e contas aceitam `admin` global para atravessar workspaces; combinado com S5A-001/S5A-002 | O plano de controle de plataforma não está separado da administração de tenant | A |
| S5A-012 | RISCO ESTÁTICO | P1 | Não foi localizado rate limiting em login, registro, recuperação, upload, IA, clima ou operações caras | Brute force, enumeração temporal e consumo não governado (OWASP API4) | A |
| S5A-013 | RISCO ESTÁTICO | P1 | Senha exige apenas mínimo de 8; troca autenticada não exige senha atual; não há MFA/lockout visível | Sessão roubada pode consolidar takeover; política precisa alinhar-se ao NIST 800-63B | A |
| S5A-014 | RISCO ESTÁTICO | P1 | JWT e usuário ficam em `localStorage` (`src/lib/authSession.ts`) | Qualquer XSS no mesmo origin pode exfiltrar sessão; não há proteção `HttpOnly` | A |
| S5A-015 | RISCO ESTÁTICO | P2 | JWT tem expiração e segredo, mas sem issuer, audience, algoritmo explicitamente permitido ou estratégia de revogação | Hardening e separação de ambientes insuficientes | B |
| S5A-016 | RISCO ESTÁTICO | P1 | Convites não têm expiração/token forte/constraint de pendência; papel é string normalizada com passagem de desconhecidos | Convite antigo, duplicado ou papel não previsto pode gerar estado incoerente | B |
| S5A-017 | RISCO ESTÁTICO | P1 | CORS tem allowlist estruturada, mas o conjunto efetivo vem do ambiente e usa credenciais | Erro de configuração pode ampliar origens; validação é runtime | A |
| S5A-018 | RISCO ESTÁTICO | P1 | JSON global aceita 20 MB e duplica `rawBody`; upload usa `memoryStorage` até 50 MB e não valida conteúdo real | Pressão de memória/DoS e conteúdo ativo servido por MIME alegado | A |
| S5A-019 | RISCO ESTÁTICO | P1 | Billing recebe/anexa base64 e PDF em buffers/data URLs sob limite global, sem política específica | Memória, banco e logs podem receber payloads excessivos | B |
| S5A-020 | RISCO ESTÁTICO | P0 | O handover confidencial contém segredos privados em texto puro; atividade atual é desconhecida | Exposição fora de secret manager; requer rotação pós-handover e auditoria de histórico | A |
| S5A-021 | RISCO ESTÁTICO | P2 | Arquivos públicos/configuração foram versionados e exemplos têm defaults reutilizáveis; `VITE_*` é legível no browser | Confusão entre segredo, configuração pública e placeholder pode levar a implantação insegura | B |
| S5A-022 | RISCO ESTÁTICO | P1 | DSN/host de telemetria hardcoded, replay/tracing habilitados e probes locais permanecem em fontes | Egress, dados pessoais em replay e comportamento divergente por ambiente | A |
| S5A-023 | RISCO ESTÁTICO | P1 | Há respostas que propagam mensagens de provedores/internas e logging sem política central de redaction | Vazamento de topologia, payload ou dado pessoal; auditoria incompleta | B |
| S5A-024 | RISCO ESTÁTICO | P1 | Não há pipeline visível de SCA/CI; imagens/dependências não são integralmente fixadas e Docker usa instalação não determinística | Supply chain sem gate repetível | A |
| S5A-025 | REQUER REPRODUÇÃO 4B | P1 | Webhook Stripe verifica assinatura, mas não há chave persistente única de evento processado | Repetição pode duplicar logs/efeitos; extensão exata só em sandbox | B |
| S5A-026 | REQUER REPRODUÇÃO 4B | P0 | É preciso medir quais recursos a sessão criada por S5A-001 alcança com fixtures e provedores desabilitados | Confirma extensão, não a existência, da vulnerabilidade | A |

### 3.3 Controles positivos observados

Os controles abaixo reduzem risco, mas não neutralizam os achados anteriores:

- hash de senha com bcrypt e custo 12;
- login e recuperação com respostas que evitam enumeração direta;
- reset com expiração curta e vínculo ao hash vigente da senha;
- middleware relê usuário ativo e papel do banco em vez de confiar apenas no claim;
- Helmet habilitado e estrutura de allowlist CORS;
- assinatura do webhook Stripe validada;
- uso de transações em trechos críticos locais;
- validação de presença/comprimento mínimo de variáveis sensíveis no carregamento do ambiente.

### 3.4 Integrações e controles específicos

| Superfície | Controle observado | Lacuna/resultado da análise |
|---|---|---|
| SMTP | transporte autenticado, TLS seguro por padrão e configuração opcional centralizada (`lib/email/resend.ts`) | TLS pode ser desativado por ambiente; erro bruto do provedor pode ser persistido; faturamento pode registrar envio “simulado” quando SMTP não está configurado. Herda S5A-011/S5A-023 e deve usar sink na 4B |
| Stripe/webhook | assinatura construída sobre `rawBody`, segredo separado por ambiente | idempotência persistente não localizada (S5A-025); seleção de sandbox/live e alcance administrativo exigem gate de ambiente |
| OCR/IA | timeout por provedor e fallback Gemini→OpenAI | endpoints públicos, base64 sem quota específica e até duas chamadas caras por request (S5A-008/P5A-008) |
| Weather/ORS | chaves opcionais e tratamento de falhas por provedor | ingestão acionável por autenticado, job no processo HTTP e ausência de lock/leader; ORS é chamada sob demanda, sem prova de quota por tenant |
| MinIO/documentos | cliente S3 central e bootstrap de buckets | ownership não é entidade de domínio; bucket/path e MIME são confiados ao cliente (S5A-005–S5A-007) |
| Dependências | dois lockfiles versão 3 permitem inventário reprodutível parcial | não foi executado audit online nem atribuída CVE; o finding é ausência de SCA/pinning/gate, não uma vulnerabilidade de pacote inventada |

## 4. Matriz de isolamento multi-tenant

| Domínio | Modelo | Possui `workspaceId`? | Workspace vem de onde? | Membership validada? | Operações por ID scoped? | Risco |
|---|---|---|---|---|---|---|
| Workspace | `Workspace` | raiz, não se aplica | parâmetro/ID da rota | SIM nas operações principais | SIM, com exceções do plano global de billing | ADEQUADO; separar plataforma |
| Membership | `Membership` | SIM, obrigatório | parâmetro da rota | SIM, owner/admin | PARCIAL: objeto é scoped, mas o papel altera `User.role` global | PARCIAL — escalada local→global |
| Person | `Person` | OPCIONAL | query/body do cliente | NÃO de forma uniforme | NÃO | INADEQUADO — BOLA/IDOR |
| Location | `Location` | OPCIONAL | query/body do cliente | NÃO de forma uniforme | NÃO | INADEQUADO — dado de localização cross-tenant |
| Client | `Client` | OPCIONAL | query/body ou vínculo informado | NÃO | NÃO | INADEQUADO — cadastro operacional cross-tenant |
| BillingClient | `BillingClient` | OPCIONAL | query/body; operações globais de admin | NÃO no plano operacional | NÃO | INADEQUADO — dado financeiro multi-tenant |
| ServiceOrder/WEEKLOG | `ServiceOrder` | OPCIONAL | query/body do cliente | NÃO | NÃO | INADEQUADO — operação e vínculo financeiro cruzados |
| ProductionOrder | `ProductionOrder` | SIM, obrigatório | query/body do cliente | NÃO | NÃO | INADEQUADO — OP acessível/atribuível fora do tenant |
| ProductionPhoto | `ProductionPhoto` | SIM, obrigatório | corpo e relações informadas | NÃO | NÃO valida consistentemente tenant do pai | INADEQUADO — foto cruza workspace/OP |
| ProductionList | `ProductionList` | OPCIONAL | query/body; também nome global | NÃO | NÃO | INADEQUADO — colisão/interferência no fluxo principal |
| PaymentOrder | `PaymentOrder` | OPCIONAL | query/body/ID do cliente | NÃO | NÃO | INADEQUADO — valores/status cross-tenant |
| Document | `Document` | OPCIONAL | metadado informado; listagem pode ser global | NÃO | NÃO, inclusive lote | INADEQUADO — BOLA e exclusão cruzada |
| Storage | objeto MinIO, sem modelo de ownership | NÃO | bucket/path do cliente | NÃO | NÃO | INADEQUADO — leitura/sobrescrita/publicação por chave |
| FinancialRecord | `FinancialRecord` | OPCIONAL | query/body/ID do cliente | NÃO | NÃO | INADEQUADO — lançamento financeiro cruzado |
| Reconciliation | `Reconciliation` | NÃO | processamento global | NÃO | NÃO | INADEQUADO — exclusão/recriação global |
| ProfitRule | `ProfitRule` | NÃO | estado global | NÃO | NÃO | INADEQUADO — regra de um tenant afeta outros |
| ServiceOrderDistribution | `ServiceOrderDistribution` | NÃO | vínculo/ID global | NÃO | NÃO | INADEQUADO — distribuição financeira sem partição |
| BillingInvoice | `BillingInvoice` | OPCIONAL | rotas tenant usam path; ops usam admin global | SIM nas rotas de workspace; NÃO no plano global | PARCIAL | PARCIAL — dois planos de acesso misturados |
| Settings | `CompanySetting` | NÃO; usa `userId` único | usuário autenticado | não se aplica | SIM pelo usuário | ISOLADO POR USUÁRIO, mas desalinhado de empresa/workspace |
| Platforms | modelos/rotas de `Platform` | SIM | query/body do cliente | NÃO | NÃO | INADEQUADO — configuração/credencial cruzável |

Resultado da matriz principal: **16/20 inadequados**, **2/20 parciais**, **1/20 adequado** e **1/20 isolado por usuário, porém semanticamente desalinhado**.

### 4.1 Causa raiz e arquitetura futura

O padrão recorrente é estrutural:

1. o controller recebe `workspaceId` ou um ID global do cliente;
2. a política verifica capacidade nominal (`allowed`), mas não materializa `own/team/all`;
3. a consulta Prisma não é obrigatoriamente condicionada ao conjunto de workspaces autorizados;
4. campos opcionais e uniques globais permitem dados sem partição;
5. o papel global é reutilizado tanto para plataforma quanto para administração local.

A correção sustentável exige um `TenantContext` resolvido no servidor, autorização de objeto negada por padrão, repositórios/use cases que não exponham consultas não escopadas, `workspaceId` obrigatório onde o domínio é tenant-scoped, FKs/uniques compostos e um plano de controle de plataforma separado, com grants explícitos e auditáveis. Corrigir handlers individualmente sem essa fronteira apenas redistribuiria o mesmo defeito.

## 5. Auditoria de secrets e configuração

Nenhum valor foi copiado ou exibido.

| Tipo de segredo/configuração | Arquivo/local | Estado atual | Histórico? | Risco | Rotação futura? |
|---|---|---|---|---|---|
| credenciais privadas de banco, assinatura, storage, e-mail e provedores | handover confidencial | SEGREDO ATIVO DESCONHECIDO | SIM, armazenado em artefato textual | crítico: cópia fora de secret manager e atividade/escopo desconhecidos | SIM, pós-handover e por proprietário |
| segredo privado em commit Git | histórico nominal e arquivos rastreados consultados | SEGREDO HISTORICAMENTE EXPOSTO — não confirmado na varredura estática limitada | pendente secret scan de todos os objetos/branches | ausência na busca nominal não prova ausência histórica | SIM para qualquer ocorrência futura confirmada |
| possível arquivo agregado de chaves | referência a `keys.txt` | não localizado; exposição não confirmada | NÃO no checkout/histórico nominal consultado | alto se existir em outro branch/objeto/artefato | SIM se localizado; remover e invalidar |
| URL/project/publishable config Supabase | `.env` histórico | VARIÁVEL PÚBLICA INTENCIONAL | SIM | baixo como segredo; médio por drift/endpoint público | não por sigilo; revisar projeto/escopo |
| token de cliente entregue pelo build | `.env.development` rastreado | VARIÁVEL PÚBLICA INTENCIONAL | SIM | confirmar que o provedor o define como publicável e sem privilégio servidor | somente se o escopo real divergir |
| DSN/host de telemetria | fonte frontend | VARIÁVEL PÚBLICA INTENCIONAL | SIM | egress/replay e acoplamento de ambiente, não sigilo do DSN | não por sigilo; reconfigurar e governar |
| chaves vazias de integrações | `.env.example`, `backend/.env.example` | PLACEHOLDER | SIM | baixo; risco aparece se valor real for commitado | não |
| credenciais/defaults locais reutilizáveis | exemplos e `docker-compose.yml` | PLACEHOLDER | SIM | alto se copiados para ambiente compartilhado/produção | substituir por segredo forte fora de local |
| segredos privados hardcoded em código atual | varredura por padrões comuns | não localizado; SEGREDO ATIVO DESCONHECIDO fora do escopo dos padrões | histórico completo pendente | varredura nominal não é prova de ausência | decidir após secret scan integral |
| segredos ativos de produção | ambientes externos | SEGREDO ATIVO DESCONHECIDO | desconhecido | não foram acessados, testados ou inferidos | SIM para os presentes no handover, sem execução nesta fase |

Backlog obrigatório, sem execução nesta fase: rotação pós-handover; remoção definitiva de qualquer `keys.txt`; secret manager por ambiente; pre-commit/CI secret scanning; verificação do histórico Git por padrões e objetos removidos; inventário de donos, escopos, expiração e última rotação. Variáveis `VITE_*` devem ser tratadas como públicas por definição.

## 6. Auditoria estática de performance

| ID | Classe | Pri. | Evidência | Efeito provável / validação | Fase 2 |
|---|---|---:|---|---|:---:|
| P5A-001 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | People lista sem paginação e executa até duas consultas por pessoa em `Promise.all` | N+1 e rajada de conexões; substituir por agregação/batch | B |
| P5A-002 | GARGALO ESTATICAMENTE IDENTIFICADO | P0 | GET de ServiceOrder carrega vínculos, escreve reconciliação e busca ProductionOrder por linha | N+1, leitura com efeito colateral e latência crescente | A |
| P5A-003 | GARGALO ESTATICAMENTE IDENTIFICADO | P0 | reconciliação carrega conjuntos globais, apaga globalmente e faz matching em memória | volume e blast radius crescem com todos os tenants | A |
| P5A-004 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | candidatos de reconciliação percorrem ordens livres em combinações | complexidade quadrática no pior caso | B |
| P5A-005 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | sumário financeiro carrega coleções completas de múltiplas tabelas | memória e transferência proporcionais ao histórico integral | B |
| P5A-006 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | billing atribui display IDs durante GET e abre transação por linha | leitura mutante, contenção e N+1 | B |
| P5A-007 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | ingestão meteorológica chama países/grades/provedores em sequências e faz upserts unitários | ciclo longo, custo externo e pressão de banco | B |
| P5A-008 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | JSON de até 20 MB é mantido também em `rawBody`; base64 amplia payload | multiplicação de memória por request | A |
| P5A-009 | GARGALO ESTATICAMENTE IDENTIFICADO | P1 | multer usa memória até 50 MB por arquivo | concorrência multiplica heap e risco de queda | A |
| P5A-010 | RISCO DE PERFORMANCE | P1 | PDFs são produzidos como Buffer/base64 e circulam em data URLs | cópias de memória, rede e eventualmente banco | B |
| P5A-011 | RISCO DE PERFORMANCE | P1 | batch de ServiceOrder usa `Promise.all` sem limite explícito | saturação de pool/CPU em lotes grandes | B |
| P5A-012 | RISCO DE PERFORMANCE | P1 | scheduler vive no processo HTTP, sem lock, líder ou guarda de sobreposição | duplicação por réplica e execuções concorrentes | A |
| P5A-013 | RISCO DE PERFORMANCE | P2 | polling de 15/30/60 s, incluindo invalidações duplicadas, permanece em telas | tráfego e renderizações mesmo sem mudança | B |
| P5A-014 | RISCO DE PERFORMANCE | P2 | frontend tem telas de 1,6k–4,5k linhas e dependências pesadas de mapa/PDF/3D | chunks e custo de render potencialmente altos | B |
| P5A-015 | RISCO DE PERFORMANCE | P1 | filtros recorrentes carecem de índices/uniques compostos coerentes com tenant e vínculos | scans e contenção à medida que a base cresce | A |
| P5A-016 | RISCO DE PERFORMANCE | P2 | probes, replay/tracing e logging de desenvolvimento permanecem no caminho | overhead e egress variáveis por ambiente | B |
| P5A-017 | REQUER BENCHMARK 4B | P1 | tamanho/chunks do bundle não foram medidos; lazy routes existem, sem estratégia manual visível | medir build, parse e rotas críticas no ambiente sanitizado | B |
| P5A-018 | REQUER BENCHMARK 4B | P1 | N+1, reconciliação, PDFs, upload e clima não têm baseline | medir com dataset mínimo e limites seguros, sem produção | B |

Totais: **9 gargalos estaticamente identificados**, **7 riscos de performance** e **2 itens de benchmark 4B**.

## 7. Dívida técnica D1–D7

| ID | Categoria | Dívida / hotspot | Consequência | Fase 2 |
|---|---|---|---|:---:|
| D1-01 | D1 Arquitetura | handlers concentram HTTP, autorização, domínio e Prisma; não existe fronteira `TenantContext` | invariantes não são impostas de forma única | A |
| D1-02 | D1 Arquitetura | papéis de plataforma e workspace são acoplados | elevação de privilégio e plano de controle ambíguo | A |
| D1-03 | D1 Arquitetura | scheduler meteorológico e integrações longas vivem no processo HTTP | escala, disponibilidade e jobs ficam acoplados | A |
| D1-04 | D1 Arquitetura | storage é genérico e rotas grandes misturam leitura, escrita e efeitos derivados | ownership/atomicidade dependem de convenções locais | A |
| D2-01 | D2 Modelagem | `Client`, `BillingClient` e `Person(type=client)` representam cliente em contextos concorrentes | identidade e regras divergentes | A |
| D2-02 | D2 Modelagem | `User`, `AppUser`, `Profile` e `Person` representam identidade/acesso sem vínculo canônico uniforme | sincronização e autorização frágeis | A |
| D2-03 | D2 Modelagem | WEEKLOG e `ServiceOrder` têm semântica ambígua; entidades financeiras usam workspace opcional/ausente e vínculos fracos | unicidade, tenant e reconciliação ficam implícitos | A |
| D2-04 | D2 Modelagem | PDR e outros estados de domínio são serializados em `notes`/JSON ou persistidos em `localStorage` | sem versionamento, constraints ou auditoria confiável | A |
| D3-01 | D3 Segurança | bootstrap/autorregistro permite `admin` e membership altera papel global | fronteira de confiança quebrada | A |
| D3-02 | D3 Segurança | RBAC calcula escopo mas não o aplica; autorização por objeto/tenant é inconsistente | BOLA/IDOR horizontal | A |
| D3-03 | D3 Segurança | JWT em `localStorage`/query, uploads livres e limites/rate limiting insuficientes | roubo de sessão e exaustão de recursos | A |
| D3-04 | D3 Segurança | secrets no handover, telemetria hardcoded e supply chain sem gates | exposição operacional e dependências não governadas | A |
| D4-01 | D4 Manutenibilidade | `BudgetDialog.tsx` (~4,5k), `billing.ts` (~3,1k), `finance.ts` (~1,8k) e `ModulePages.tsx` (~1,6k) são hotspots | baixa coesão e alto raio de mudança | B |
| D4-02 | D4 Manutenibilidade | 1.288 ocorrências de `any`; tipos Supabase gerados somam ~7k linhas | contratos deixam de ser verificados pelo compilador | B |
| D4-03 | D4 Manutenibilidade | contratos híbridos, montagem duplicada de billing e caminhos múltiplos de PDF/documento | drift e regras duplicadas | B |
| D4-04 | D4 Manutenibilidade | código órfão, façade noop e probes para `127.0.0.1:7777` permanecem no caminho | falso sucesso, ruído e compreensão difícil | A |
| D5-01 | D5 Testes/Observabilidade | backend não tem suíte/script de testes | auth, tenant e transações não têm gate | A |
| D5-02 | D5 Testes/Observabilidade | frontend tem apenas 3 arquivos/9 testes e sem coverage configurado | cobertura desproporcional aos 480 arquivos TS/TSX | A |
| D5-03 | D5 Testes/Observabilidade | não há suíte/gate de contrato, segurança, tenant, migration, performance ou SCA em CI | Fase 2 não tem rede de segurança repetível | A |
| D5-04 | D5 Testes/Observabilidade | logs, tracing/replay e probes não têm política central; faltam SLO, baseline e runbook | incidentes e regressões sem critério objetivo | B |
| D6-01 | D6 Infraestrutura/Deploy | compose contém caminhos absolutos de host | ambiente não é portátil | A |
| D6-02 | D6 Infraestrutura/Deploy | Docker usa `npm install`, imagem MinIO não é fixada e env/examples divergem | build/configuração não determinísticos | A |
| D6-03 | D6 Infraestrutura/Deploy | health check valida banco, mas readiness de MinIO/provedores é parcial | instância pode parecer saudável sem funções essenciais | B |
| D6-04 | D6 Infraestrutura/Deploy | job não tem feature flag, leader election, lock ou prevenção de overlap | execução imprevisível por réplica | A |
| D7-01 | D7 Migração/Legado | 48 importadores Supabase e 45 usos funcionais coexistem com Prisma/noop | duas arquiteturas e falso feedback de sucesso | A |
| D7-02 | D7 Migração/Legado | há 192 migrations/28 Edge Functions Supabase contra um snapshot Prisma sem baseline completo/seed | perda de genealogia e setup não reproduzível | A |
| D7-03 | D7 Migração/Legado | Edge Functions e domínios legados não portados deixam módulos expostos sem backend equivalente | funcionalidades órfãs ou quebradas | A |
| D7-04 | D7 Migração/Legado | módulos parcialmente migrados combinam REST, Supabase, `localStorage` e código órfão | um domínio funciona em uma tela e falha em outra | A |

## 8. Top 10 P0/P1 e precedência

| Ordem | Item | Por que precede evolução |
|---:|---|---|
| 1 | S5A-001 — autorregistro admin | invalida a fronteira de confiança |
| 2 | S5A-002 — papel local altera papel global | permite escalada fora do tenant |
| 3 | S5A-003 — autorização/tenant não aplicada | afeta horizontalmente quase todos os módulos |
| 4 | S5A-011 — plano plataforma misturado ao tenant | amplia S5A-001 e S5A-002 |
| 5 | S5A-004 — reconciliação global destrutiva | ameaça integridade financeira multi-tenant |
| 6 | S5A-006/S5A-007 — ownership de storage e JWT em URL | combina BOLA com exposição de credencial |
| 7 | S5A-005 — documentos sem isolamento | envolve metadados e operações em lote |
| 8 | S5A-010 — fluxo produtivo com chaves globais | ameaça o fluxo operacional principal |
| 9 | S5A-020 — segredos em handover | exige contenção e rotação antes de operação confiável |
| 10 | D7-01/D7-02/D5-01 — migração sem baseline/testes | impede mudanças seguras e reproduzíveis |

Devem ocorrer antes de qualquer feature nova: definição do modelo de autoridade, bloqueio do bootstrap público, separação dos papéis, tenant context obrigatório, contenção de storage/documentos/financeiro, plano de secrets, baseline de banco e uma suíte mínima de regressão backend. Estabilização específica de billing, finance, clima, PDFs e UI pesada pode ocorrer durante a Fase 2, desde que os controles estruturais anteriores sejam gates.

## 9. Decisões abertas por categoria

### BUSINESS — decisão de Alex em termos de resultado

1. Qual entidade representa um cliente único para operação, faturamento e relacionamento, e qual é o resultado esperado quando cadastros divergem?
2. Quando uma pessoa perde vínculo com um workspace, quais dados e ações históricas ela ainda pode ver?
3. Quando uma etapa externa falha após uma gravação local, o negócio prefere reversão total, pendência recuperável ou conclusão parcial explícita?
4. Quem pode criar, aprovar, substituir e tornar vigente uma versão de PDR/regra de distribuição?
5. Qual valor financeiro prevalece para o técnico e em que momento ele deve ficar imutável?
6. WEEKLOG é sinônimo de ServiceOrder, uma etapa, um documento ou uma visão? Qual identificador é a referência do negócio?
7. Quem pode iniciar, revisar, desfazer e encerrar reconciliação financeira, e qual trilha precisa permanecer?
8. Quais ações são exclusivas da equipe Operix (plataforma) e quais pertencem ao owner/admin do cliente?
9. Quais documentos devem expirar, ser preservados ou eliminados e sob quais obrigações?
10. Convites vencem? O que ocorre com reenvio, troca de papel e usuário já pertencente ao workspace?
11. Qual latência de atualização é aceitável por módulo: imediata, segundos ou atualização manual?

### ENGINEERING — decisão de EverGreen

1. Como será materializado o `TenantContext` server-side e como consultas não escopadas serão proibidas?
2. O plano de controle de plataforma terá identidade, middleware e APIs separados do plano de tenant?
3. Qual padrão de consistência implementará a decisão de negócio: transação local, outbox/saga ou estado recuperável?
4. Qual estratégia consolida `Person`, `Client` e `BillingClient` sem big-bang?
5. Como transformar o snapshot atual em baseline Prisma verificável e preservar a genealogia das migrations Supabase?
6. Scheduler será worker dedicado, fila ou cron externo? Qual mecanismo de idempotência/lock?
7. Qual modelo de ownership, classificação, retenção e URLs assinadas substituirá bucket/path livre?
8. Qual política de logs, redaction, auditoria, tracing e replay será obrigatória?
9. Quais gates de CI cobrirão lint, typecheck, testes, SCA, secret scanning e migrations?
10. Qual padrão de paginação, índices compostos e orçamento de consulta será adotado?
11. Qual desenho de sessão suportará revogação, MFA futura e proteção contra XSS?
12. Qual sequência vertical de migração reduz caminhos híbridos sem paralisar o produto?

### RUNTIME — comprovação sanitizada da Fase 4B

1. Até onde chega uma conta criada pelo fluxo público quando todos os provedores reais estão desabilitados?
2. Uma alteração de membership realmente eleva o acesso global em outra fixture de workspace?
3. Cada domínio marcado inadequado rejeita IDs pertencentes ao Workspace B quando o usuário está apenas no A?
4. Reenvio do mesmo evento Stripe sandbox é idempotente em estado e logs?
5. Quais são os limites seguros de concorrência para JSON, upload, IA, PDF e batches?
6. Como N+1 e reconciliação escalam no dataset mínimo controlado?
7. Duas réplicas executam simultaneamente o job meteorológico?
8. Storage rejeita MIME falso, path cruzado e objeto de outro tenant?
9. Quais hosts recebem telemetria/probes e quais campos são enviados?

### PRODUCT

1. Qual UX torna versões/aprovações de PDR compreensíveis?
2. Quais módulos do legado permanecem, serão substituídos ou encerrados?
3. Quais telas exigem atualização quase em tempo real e quais toleram refresh explícito?
4. Como permissões `own/team/all` devem ser explicadas e administradas no produto?
5. Como arquivo, recuperação e retenção aparecem ao usuário sem confundir exclusão lógica/física?

### SECURITY

1. Qual cerimônia cria o primeiro platform admin e como o endpoint é desativado depois?
2. Como suporte Operix recebe acesso temporário, justificável e auditado a um tenant?
3. Qual política de sessão, TTL, revogação, MFA e troca de senha será adotada?
4. Quais limites por identidade/IP/tenant protegem autenticação e integrações caras?
5. Quem executará rotação pós-handover, auditoria Git e validação de escopo de cada segredo?
6. Quais dados podem entrar em logs, Sentry/replay e provedores de IA?
7. Quais tipos/tamanhos são aceitos em upload e como malware/conteúdo ativo será tratado?
8. Quais eventos de segurança devem ser imutáveis e por quanto tempo?
9. Quais origens, destinos de egress e callbacks são permitidos em cada ambiente?

## 10. Testes 4B prioritários derivados desta fase

Todos devem usar banco descartável, dois workspaces, usuários sintéticos, buckets locais e provedores sandbox/desabilitados. Nenhum deve ser executado em produção.

1. autenticação: autorregistro solicitando papel privilegiado e verificação do papel persistido, sem acessar dado real;
2. RBAC: owner/admin de A tentando alterar papel global ou contexto de B;
3. isolamento: matriz A→B para os 16 domínios inadequados, com IDs válidos de fixtures;
4. finance: reconciliar A e comprovar que B permanece byte-a-byte/contagem inalterado;
5. fluxo OP→WEEKLOG→PaymentOrder: colisão de `listName`, repetição e rollback;
6. documentos/storage: listagem, download, sobrescrita, delete em lote, MIME falso e JWT ausente de URL/log;
7. Stripe sandbox: mesma assinatura/evento repetido e concorrente;
8. limites: payloads pequenos e progressivamente maiores dentro de limites acordados, sem teste de exaustão ofensivo;
9. scheduler: duas réplicas sanitizadas, overlap e recuperação de falha;
10. benchmark: query count e memória para People, ServiceOrder, reconciliação, PDFs e upload;
11. telemetria: captura de egress e redaction com dados sintéticos;
12. convites: expiração desejada, duplicação, corrida de aceite e papel inválido.

## 11. Conclusão para a Fase 2

A Fase 2 terá esforço significativo: a correção não se limita a patches locais. Ela precisa estabelecer fronteiras arquiteturais (tenant/plataforma), consolidar o caminho Prisma, introduzir baseline/migrations/testes, retirar dependências funcionais Supabase e isolar jobs/integrações. Features novas antes desses gates aumentariam o custo de migração e a superfície de segurança.

A Fase 4B ainda não foi executada. Ela está tecnicamente planejada, mas só deve começar após disponibilização de ambiente sanitizado, credenciais exclusivamente sandbox, banco/MinIO descartáveis e autorização explícita.
