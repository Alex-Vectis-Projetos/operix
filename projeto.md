Sim. Agora que o contrato fechou, eu mudaria completamente a postura: saímos de “diagnóstico/proposta” e entramos em **engenharia de produto de verdade**.

E concordo com você: não basta atacar os bugs de Operação e Financeiro e deixar a base bagunçada. Também não devemos cair no extremo oposto de passar semanas “refatorando por elegância”. O caminho correto é **arrumar a fundação à medida que fechamos as fatias do Core**, deixando uma arquitetura que outro engenheiro consiga entender, testar, manter e evoluir daqui a 1–2 anos.

A base não é pequena: o inventário encontrou 890 arquivos e cerca de 131 mil linhas, sendo ~90 mil no frontend, ~17 mil no backend e ~24,5 mil no legado Supabase. A estrutura já possui React/Vite, Express, Prisma/PostgreSQL, MinIO, Docker e uma organização parcial que pode ser aproveitada.  O problema é justamente a convivência de REST real, Supabase/noop, `localStorage`, JSON/`notes` e regras fragmentadas, além da falta de uma fronteira consistente de tenant/domínio. 

## Arquitetura que eu perseguiria

Eu **não trocaria a stack**. Nada de reinventar com Next, microservices, Nest, Kubernetes, Redis etc.

O alvo continua sendo:

```text
React + Vite
      ↓
Express API
      ↓
Auth / RequestContext / Authorization
      ↓
Application/Domain Services
      ↓
Prisma
      ↓
PostgreSQL

Arquivos → MinIO/S3
Integrações → adapters próprios
```

O trabalho é transformar isso de uma arquitetura que “existe em partes” em **uma arquitetura que seja realmente a regra do sistema**.

O diagnóstico já confirmou 44 modelos Prisma, mas também três representações diferentes de cliente e quatro representações de identidade, além de rotas sem isolamento consistente e OCR/IA exposto sem autenticação. 

---

# Plano de engenharia

## Fase 0 — Baseline profissional antes de alterar o produto

Essa etapa é curta, mas obrigatória.

Primeiro precisamos conseguir responder:

> “Qual código exatamente estamos alterando, como subimos isso localmente, como testamos e como voltamos atrás?”

Checklist:

* confirmar repositório GitHub canônico;
* atualizar qualquer código que esteja somente local;
* registrar **Commit de Início**;
* criar tag imutável, por exemplo `baseline-evergreen-2026-09`;
* backup do banco antes das migrations;
* confirmar branch principal;
* proteger `main`;
* proibir push direto;
* PR obrigatório;
* definir padrão de branches;
* criar CI mínimo;
* corrigir `docker-compose` com paths relativos;
* completar `.env.example`;
* validar envs com Zod;
* criar ambiente local reproduzível;
* criar ambiente de testes;
* criar staging separado;
* criar seed de dados descartáveis;
* criar Workspace A e Workspace B para testes de isolamento.

Eu **não usaria GitFlow pesado**.

Faria:

```text
main
feat/production-weeklog
feat/budget-revisions
fix/tenant-scope
chore/ci
```

PR → CI → merge → staging.

Simples e profissional.

Um detalhe: tentei consultar agora o `qwork-alex/operix` pelo conector do GitHub e ele está retornando como repositório movido, sem o destino atual acessível pelo conector. Então o **primeiro item real do kickoff** precisa ser confirmar o repo canônico atual e registrar o SHA. Os relatórios que temos continuam trazendo o inventário completo da versão auditada.

---

# Fase 1 — Organização do código

Eu não moveria os 890 arquivos em massa.

Isso seria exatamente o tipo de “refatoração bonita que quebra tudo” que queremos evitar.

Mas **todo código novo ou substancialmente alterado deve começar a convergir para uma estrutura melhor**.

### Backend alvo

```text
backend/src/
├── config/
├── middleware/
├── modules/
│   ├── auth/
│   ├── tenancy/
│   ├── identity/
│   ├── clients/
│   ├── budgets/
│   ├── production/
│   ├── weeklogs/
│   ├── payment-lists/
│   ├── finance/
│   ├── documents/
│   └── locations/
├── integrations/
└── shared/
    ├── errors/
    ├── logging/
    ├── authz/
    ├── validation/
    └── db/
```

Por exemplo:

```text
modules/weeklogs/
├── weeklog.routes.ts
├── weeklog.schemas.ts
├── weeklog.service.ts
├── weeklog.policy.ts
└── weeklog.test.ts
```

Não quero:

```ts
router.patch(... 350 linhas de regra de negócio ...)
```

A rota deveria fazer basicamente:

```text
request
→ validação
→ RequestContext
→ service
→ response
```

A regra fica no service/policy.

### Frontend alvo

Mesma filosofia:

```text
src/
├── app/
├── features/
│   ├── budgets/
│   ├── production/
│   ├── weeklogs/
│   ├── payment-lists/
│   └── finance/
├── components/
│   └── ui/
├── lib/
└── i18n/
```

Não precisamos migrar todo o frontend para isso agora.

Mas, quando uma tela de Produção for substancialmente modificada, fazemos aquele pedaço direito.

---

# Fase 2 — Fundação de autoridade

Esse é o **P0 real**.

Hoje há um problema conceitual sério: algumas rotas recebem `workspace_id` ou IDs do frontend e confiam neles. Já foram encontrados exemplos em People, Locations e Service Orders. 

Precisamos de um único contexto resolvido no servidor.

Conceitualmente:

```ts
RequestContext {
  actorUserId
  platformRole
  activeWorkspaceId?
  technicianPersonId?
  scope: workspace | technician_personal
  membershipRole?
  capabilities[]
}
```

O formato pode mudar, mas esses conceitos precisam existir.

Checklist:

* corrigir autorregistro privilegiado;
* separar role global de role do workspace;
* criar `RequestContext`;
* validar membership server-side;
* introduzir autorização por objeto;
* implementar `own/team/all` de verdade;
* técnico vinculado só consulta seus registros;
* técnico independente opera em contexto próprio;
* cliente vê apenas seus trabalhos;
* colaborador do cliente recebe capability específica;
* plataforma Operix não atravessa tenants sem regra;
* testes A → B obrigatórios.

Essa é a fundação em que **todos os módulos futuros vão depender**.

---

# Fase 3 — Banco de dados profissional

Antes de criar novas tabelas:

### Baseline Prisma

Precisamos reconciliar:

```text
Banco atual
vs
schema.prisma
vs
migrations atuais
vs
192 migrations Supabase históricas
```

Checklist:

* dump do schema;
* backup;
* detectar drift;
* definir baseline Prisma;
* comprovar que uma base vazia nasce das migrations;
* não usar `prisma db push` destrutivo em produção;
* migrations versionadas;
* migration testada em banco descartável;
* backfill explícito;
* rollback operacional previsto.

### Regra que eu adotaria

Mudança destrutiva:

```text
EXPAND
↓
migrar dados/código
↓
CONTRACT
```

Nunca:

> apagar coluna → rezar → subir frontend.

---

# Fase 4 — Resolver identidade sem reescrever tudo

Hoje existem:

```text
User
AppUser
Profile
Person
```

e:

```text
Client
BillingClient
Person(type=client)
```

O objetivo não é deletar metade do banco de uma vez.

É **definir quem é quem**.

Eu colocaria:

```text
User
= credencial/autenticação

Membership
= acesso ao workspace

Person
= pessoa real/operacional

Client
= entidade cliente operacional canônica
```

E depois usamos mappings/adapters para os modelos legados.

Checklist:

* definir ID canônico do usuário;
* definir ID canônico do técnico;
* definir ID canônico do cliente;
* parar de passar `profileId` em lugar onde esperávamos `userId`;
* parar de tratar `BillingClient` e cliente operacional como se fossem automaticamente iguais;
* criar FK/mapping;
* migrar por módulo;
* não sincronizar tabelas silenciosamente.

Isso é muito importante para evitar que daqui a seis meses apareçam novamente:

> “esse cliente está no financeiro mas não está na produção”.

---

# Fase 5 — Eliminar a arquitetura híbrida do Core

Esse é provavelmente o maior trabalho técnico da fase.

Hoje o relatório final aponta **48 consumidores Supabase**, com vários fluxos coexistindo entre REST, Supabase/noop e estado local. 

Não fazemos:

> “remover Supabase inteiro”.

Fazemos:

### Produção

```text
encontrar todos os consumidores
→ garantir backend
→ migrar hooks
→ testar
→ remover import Supabase daquela capacidade
```

Depois:

### WEEKLOG

O mesmo.

Depois Lista.

Depois financeiro.

Checklist global:

* mapear 48 imports;
* marcar `R0 / R1 / R2 / futuro`;
* impedir novos imports Supabase via lint;
* migrar somente o Core;
* ao final do R2: **zero noop/Supabase no Core**;
* manter legado fora do Core temporariamente;
* só remover `supabase/` completamente após decisão posterior.

---

# Fase 6 — Orçamento como domínio real

Hoje orçamento ainda tem dependência de `localStorage` e serialização em `ProductionOrder.notes`; isso foi identificado como um gap real no contrato frontend/backend. 

Target:

```text
Budget
└── BudgetRevision
      └── approval
```

Estados simples:

```text
DRAFT
SUBMITTED
APPROVED
SUPERSEDED
```

Não precisamos criar uma engine sofisticada.

Precisamos:

* persistência;
* revisão;
* autor;
* timestamp;
* aprovação vinculada à revisão;
* alteração pós-aprovação cria revisão nova;
* revisão anterior continua disponível;
* OP referencia orçamento/revisão.

---

# Fase 7 — Produção → WEEKLOG de forma confiável

Esse é um dos pontos mais importantes do sistema.

Hoje o diagnóstico encontrou operações sequenciais em que a OP pode ser concluída e a geração derivada falhar depois. 

Precisamos transformar:

```text
PATCH Production
→ tenta WEEKLOG
→ catch
→ "skipped"
```

em uma transição robusta.

Checklist:

* `completeProductionOrder()` como service;
* operação idempotente;
* unique constraint adequada;
* `$transaction` onde aplicável;
* se geração derivada falhar:

  * estado explícito;
  * possibilidade de retry;
  * não duplicar;
* auditoria;
* teste concorrente.

Não precisa Kafka.

Não precisa RabbitMQ.

Não precisa microservice.

Precisamos de **uma boa transação + retry simples e persistente**.

---

# Fase 8 — WEEKLOG

Checklist mínimo:

* entidade própria;
* referência à Produção;
* técnico;
* cliente;
* período;
* serviços;
* valores quando cabíveis;
* validação;
* ator que validou;
* timestamp;
* método:

  * authenticated confirmation;
  * signature;
* import externo;
* proveniência;
* idempotência;
* retificação.

---

# Fase 9 — Lista

Precisamos preservar uma regra que ficou muito clara:

```text
WEEKLOG ≠ Lista
```

Uma Lista pode receber trabalhos de semanas diferentes. Isso foi explicitamente consolidado na validação pós-reunião. 

Modelagem conceitual:

```text
PaymentList
├── ListItem -> WEEKLOG / trabalho
├── status
│   ├── pending
│   └── paid
└── source document
```

Checklist:

* entidade Lista;
* itens explícitos;
* número sequencial;
* multissemanas;
* documento importado;
* técnico;
* cliente;
* status;
* timestamps;
* técnico vê só seus itens;
* empresa vê conjunto autorizado.

---

# Fase 10 — Confronto

O sistema já tem bastante coisa reaproveitável.

Então não criaria um novo “motor financeiro”.

Fluxo:

```text
Lista importada
      ↓
parse/OCR
      ↓
normalização
      ↓
matching por placa/chassi
      ↓
WEEKLOG
      ↓
diferenças
      ↓
humano decide
```

Comparar:

* veículo;
* serviço;
* valor;
* desconto;
* retificação.

E registrar:

```text
matched
accepted_difference
rejected
needs_rectification
```

---

# Fase 11 — Financeiro canônico

Aqui quero evitar qualquer ambiguidade.

A regra final deve estar literalmente documentada:

```text
Executado
= WEEKLOG

Reconhecido
= Lista

Esperado
= Lista validada + pendente

Recebido
= Lista paga

Disponível
= Recebido - Despesas
```

Checklist:

* remover esperado derivado diretamente de WEEKLOG;
* recebido só usa Lista paga;
* distribuição manual;
* despesas scoped;
* obrigações;
* técnico enxerga própria projeção;
* empresa enxerga agregado autorizado;
* parceiro conforme participação;
* queries tenant-scoped;
* dinheiro usando Decimal, não `float` de JS como verdade final.

---

# Fase 12 — Storage e documentos

O MinIO já existe e deve ser mantido. O diagnóstico confirma backend de storage e uso parcial no frontend. 

Mas precisamos profissionalizar ownership.

Todo arquivo precisa saber:

```text
quem é o dono?
qual tenant?
qual entidade?
quem pode ler?
```

Checklist:

* serviço único de storage;
* bucket allowlist;
* paths gerados pelo backend;
* tamanho máximo;
* MIME validation;
* streaming;
* nenhum base64 gigante;
* download privado;
* signed URL não logada;
* delete consistente;
* ownership por tenant/entidade.

---

# Fase 13 — Frontend profissional

Não quero reescrever o frontend.

Quero estabelecer algumas regras.

### TanStack Query = estado remoto

`localStorage` somente para:

* tema;
* filtros;
* preferências.

Nunca para:

* orçamento;
* aprovação;
* produção;
* WEEKLOG;
* Lista;
* financeiro.

### Telas grandes

O diagnóstico encontrou telas muito grandes e dívida relevante, então quando forem tocadas:

```text
page
├── feature hooks
├── domain form
├── table/list
└── actions
```

Não precisa quebrar tudo arbitrariamente.

### UX

Cada fluxo precisa ter:

* loading;
* empty;
* error;
* success real;
* retry;
* disabled state;
* feedback de persistência.

Nunca:

> toast “salvo com sucesso”

antes de o backend confirmar.

---

# Fase 14 — Testes

Essa é uma das mudanças de cultura mais importantes.

O DoD definido no roadmap já exige UI autoritativa, contrato, auth/tenant, persistência/retry, testes e rollback. 

Eu criaria três níveis.

### Unitários

* policies;
* cálculos financeiros;
* state transitions;
* budget revision;
* identidade.

### Integração

Com PostgreSQL de teste:

* auth;
* workspace A/B;
* técnico own;
* orçamento;
* Produção;
* WEEKLOG;
* Lista;
* financeiro;
* storage.

### E2E

Seis fluxos obrigatórios:

1. técnico independente;
2. técnico vinculado;
3. cliente valida WEEKLOG;
4. import WEEKLOG;
5. import Lista + Confronto;
6. Lista pending → paid → financeiro.

---

# Fase 15 — CI/CD

Todo PR deveria passar:

```text
npm ci
↓
lint
↓
typecheck
↓
unit
↓
integration
↓
prisma validate
↓
migration smoke
↓
frontend build
↓
backend build
↓
docker build
```

E depois:

```text
merge main
↓
staging
↓
smoke test
↓
homologação
↓
produção
```

Não deploy manual de:

> “entrei na VPS, alterei seis arquivos e reiniciei”.

---

# Fase 16 — Observabilidade

Precisamos conseguir responder:

> “o que quebrou, para quem, quando e em qual request?”

Logging estruturado:

```text
requestId
actorUserId
workspaceId
route
entityId
duration
status
errorCode
```

Não logar:

* senha;
* JWT;
* API key;
* documentos inteiros;
* PII desnecessária.

Além disso:

* remover os probes `127.0.0.1:7777`;
* Sentry configurado;
* audit log para ações críticas;
* health endpoint;
* readiness endpoint.

---

# Fase 17 — Performance pragmática

Não vamos “otimizar tudo”.

Vamos corrigir problemas reais já identificados:

* N+1 de People;
* N+1 de WEEKLOG;
* escrita dentro de GET;
* reconciliação global;
* paginação;
* índices;
* `Promise.all` sem limite;
* upload/base64 em memória;
* polling duplicado;
* scheduler meteorológico.

Não colocaria Redis agora.

Nem fila externa.

Nem cache sofisticado.

---

# Fase 18 — Scheduler

Hoje o scheduler meteorológico está no processo HTTP; isso vira problema se existirem duas instâncias.

Solução simples:

* worker separado; **ou**
* lock no PostgreSQL.

Checklist:

* idempotente;
* lock;
* sem overlap;
* retry limitado;
* log de início/fim/falha.

---

# Ordem real de execução

Eu seguiria exatamente esta sequência:

### Marco 0

**Engenharia de projeto**

Repo → baseline → Docker → env → staging → CI → seed → Prisma baseline.

### Marco 1

**Fundação ligada ao produto**

Auth → RequestContext → tenant → object authorization → técnico pessoal → cliente → storage.

### Marco 2

**Operação**

Veículo/foto → orçamento → revisão → OP → Produção → WEEKLOG → validação → retificação → import.

### Marco 3

**Lista + Financeiro**

Lista → import → confronto → esperado → recebido → despesas → distribuição → obrigações.

### Marco 4

**Hardening**

Testes → performance → observabilidade → backup → homologação → release.

Isso também continua coerente com a sequência validada no projeto: R0 Fundação → R1 Operação móvel → R2 Lista/Financeiro, deixando R3/R4 e os módulos futuros para depois. 

---

# Definition of Done que eu colocaria no projeto

Uma tarefa **não pode ser marcada como Done** até passar:

* [ ] UI usa o caminho autoritativo;
* [ ] API válida;
* [ ] autenticação;
* [ ] tenant/scope;
* [ ] autorização do objeto;
* [ ] persistência;
* [ ] reload;
* [ ] retry/idempotência;
* [ ] erros explícitos;
* [ ] sem secrets/PII nos logs;
* [ ] teste unitário quando aplicável;
* [ ] teste integração;
* [ ] A/B tenant quando aplicável;
* [ ] E2E quando crítico;
* [ ] legado daquela capacidade removido;
* [ ] CI verde;
* [ ] docs/ADR atualizados;
* [ ] rollback conhecido.

Essa deveria ser quase uma **constituição do projeto**.

---

## Os primeiros 15 tickets que eu abriria

1. Confirmar repo canônico e tag baseline.
2. Criar backup e registro do Commit de Início.
3. Tornar Docker Compose portátil.
4. Completar `.env.example` + validation.
5. Local/test/staging reproduzíveis.
6. Pipeline CI mínimo.
7. Seed A/B.
8. Baseline Prisma.
9. Remover probes debug.
10. Corrigir autorregistro/admin.
11. Criar `RequestContext`.
12. Aplicar object auth nas primeiras rotas Core.
13. Proteger `/extract/*` + storage.
14. Fechar técnico independente/vinculado.
15. Iniciar fatia **Orçamento → Produção → WEEKLOG**.

Depois disso o projeto começa a caminhar com muito menos risco.

O ponto central é: **não quero que a EverGreen apenas “conserte a Operix”**. Quero que, ao final desses 30–40 dias, exista também uma **base de engenharia melhor do que a que recebemos**: repo organizado, ambiente reproduzível, arquitetura compreensível, banco versionado, testes, CI, segurança, observabilidade e regras de domínio explícitas. Isso é o que evita a Operix voltar ao mesmo estado seis meses depois.


Sim. Para a Operix, eu **não usaria “vibe coding” solto**. O melhor modelo é um híbrido:

**Spec-Driven como controle → TDD/Contract Tests como prova → Loop Engineering como execução → memória compartilhada no repositório como contexto durável.**

Isso aproveita muito bem IA sem deixar o agente “inventar o sistema” a cada sessão.

## A arquitetura de trabalho que eu recomendo

Pensa em quatro camadas:

```text
1. SOURCE OF TRUTH
   Requisitos + arquitetura + domínio + decisões

            ↓

2. SPEC DA FATIA
   O que exatamente será feito agora

            ↓

3. LOOP DE ENGENHARIA
   analisar → planejar → implementar → testar → revisar

            ↓

4. VERIFICAÇÃO
   testes + CI + code review + critérios de aceite
```

A IA pode fazer muito trabalho em 2 e 3.

Mas **1 e 4 limitam o que ela pode fazer**.

---

# 1. Spec-Driven deve ser a espinha dorsal

Vocês já começaram muito bem com:

```text
spec.md
plan.md
tasks.md
findings.md
open-questions.md
```

Eu continuaria isso, mas agora por **fatia vertical real**, não por “projeto inteiro”.

Exemplo:

```text
specs/
├── 000-operix-diagnostic/
├── 001-foundation-tenant-context/
│   ├── spec.md
│   ├── plan.md
│   ├── tasks.md
│   ├── acceptance.md
│   └── decisions.md
│
├── 002-budget-production/
├── 003-production-weeklog/
├── 004-weeklog-list/
├── 005-list-confrontation/
└── 006-finance-core/
```

Isso é muito melhor do que um agente receber:

> “Arruma a Operix.”

Ele recebe:

> “Implemente `003-production-weeklog`, obedecendo spec, arquitetura e critérios de aceite.”

A diferença de qualidade é enorme.

---

# 2. Cada spec precisa ter uma estrutura rígida

Eu usaria sempre:

```md
# Contexto

# Problema

# Atores afetados

# Estado atual

# Target state

# Regras de negócio

# Invariantes

# Escopo

# Fora de escopo

# Contratos/API

# Alterações de dados

# Segurança / tenancy

# Casos de erro

# Critérios de aceite

# Testes obrigatórios

# Migração / compatibilidade

# Rollback

# Questões abertas
```

Para a IA isso é excelente, porque elimina ambiguidade.

Por exemplo, numa spec de WEEKLOG:

```text
INVARIANTE:
um ProductionOrder só pode gerar um WEEKLOG canônico
para aquela conclusão operacional.

RETRY:
reexecutar a operação não pode duplicar WEEKLOG.

TENANCY:
um técnico de Workspace A nunca pode ler WEEKLOG de B.

FAILURE:
falha na criação do WEEKLOG não pode desaparecer como falso sucesso.
```

A IA programa muito melhor quando recebe **invariantes**, não apenas histórias de usuário.

---

# 3. Não faria TDD puro em tudo

Eu faria **TDD orientado a risco**.

Porque aplicar Red → Green → Refactor religiosamente em componente visual simples pode consumir tempo sem retorno.

Mas para a Operix eu exigiria TDD/test-first em:

* tenancy;
* autorização;
* financeiro;
* transições de estado;
* idempotência;
* orçamento/revisão;
* Produção → WEEKLOG;
* WEEKLOG → Lista;
* retificação;
* cálculo financeiro;
* import/confronto.

Exemplo:

Antes de mexer em `ProductionOrder → WEEKLOG`:

```text
TESTE 1
Concluir OP gera WEEKLOG.

TESTE 2
Concluir novamente não duplica WEEKLOG.

TESTE 3
Workspace B não acessa WEEKLOG de A.

TESTE 4
Falha derivada fica recuperável.

TESTE 5
Retry posterior completa o fluxo.
```

Só depois o agente implementa.

Isso força a IA a resolver **o comportamento**, e não apenas fazer a aplicação parar de reclamar.

---

# 4. Para frontend, eu usaria Acceptance-Driven mais que TDD

Por exemplo:

```text
DADO
um técnico autenticado em mobile

QUANDO
abre uma Produção e adiciona uma foto

ENTÃO
a foto deve persistir

E
continuar visível após reload

E
um técnico de outro tenant não deve acessá-la
```

Então:

```text
Vitest
→ regras/componentes

Playwright
→ fluxo real
```

Não tentaria unit-testar cada botão.

---

# 5. O Loop Engineering seria o motor

Essa é provavelmente a parte mais importante para programar com agentes.

Para cada tarefa:

```text
UNDERSTAND
↓
PLAN
↓
CHANGE
↓
TEST
↓
INSPECT
↓
FIX
↓
REVIEW
↓
DOCUMENT
```

Eu faria a IA seguir sempre este loop.

### Etapa 1 — Understand

Antes de editar:

* ler spec;
* encontrar arquivos relacionados;
* entender modelo de dados;
* localizar consumidores;
* localizar testes;
* localizar caminhos legados;
* explicar impacto.

**Nenhum código ainda.**

### Etapa 2 — Plan

O agente produz algo como:

```text
Arquivos a alterar:
- backend/src/routes/productionOrders.ts
- backend/src/modules/weeklogs/weeklog.service.ts
- backend/prisma/schema.prisma
- src/hooks/useProductionOrders.ts
- tests/integration/weeklog.test.ts

Arquivos que não serão alterados:
...

Migration:
...

Riscos:
...
```

Só então implementa.

### Etapa 3 — Implement

Mudanças pequenas.

Idealmente um objetivo por commit.

### Etapa 4 — Verify

Rodar:

```text
lint
typecheck
unit
integration
targeted e2e
```

### Etapa 5 — Self-review

A IA revisa o próprio diff perguntando:

* introduzi novo `any`?
* confiei em ID vindo do cliente?
* existe caminho sem tenancy?
* adicionei `localStorage`?
* deixei Supabase?
* existe race condition?
* os erros aparecem?
* há dado sensível em log?

### Etapa 6 — Human review

Para mudanças P0/P1.

---

# 6. A memória compartilhada é essencial — mas não deve ser “memória da IA”

Esse ponto é muito importante.

Eu **não faria a memória primária depender de ChatGPT, Claude, Cursor ou qualquer agente**.

A memória principal do projeto deve morar no Git.

A IA é consumidora dessa memória.

## Eu faria quatro níveis

### Nível 1 — memória constitucional

Poucos arquivos, muito estáveis.

```text
docs/
├── PROJECT.md
├── DOMAIN.md
├── ARCHITECTURE.md
├── ENGINEERING_RULES.md
└── GLOSSARY.md
```

#### `PROJECT.md`

Responde:

* o que é Operix;
* objetivo atual;
* escopo contratado;
* o que é futuro;
* prioridades.

#### `DOMAIN.md`

Define:

* workspace;
* técnico independente;
* técnico vinculado;
* cliente;
* WEEKLOG;
* Lista;
* retificação;
* financeiro.

#### `ARCHITECTURE.md`

Define:

* React;
* Express;
* Prisma;
* PostgreSQL;
* MinIO;
* boundaries;
* padrões.

#### `ENGINEERING_RULES.md`

Exemplo:

```text
- nunca confiar em workspaceId do frontend
- nenhuma feature nova usa Supabase
- nenhum dado crítico usa localStorage
- toda migration é versionada
- toda rota Core possui auth + object auth
- toda mudança financeira possui teste
```

#### `GLOSSARY.md`

Evita o maior problema de IA em sistemas de domínio:

> chamar `PaymentOrder`, `Lista`, `WEEKLOG` e `ServiceOrder` de coisas diferentes a cada sessão.

---

# 7. Nível 2 — ADRs

Toda decisão arquitetural relevante vira:

```text
docs/adr/
├── 001-tenant-context.md
├── 002-canonical-client.md
├── 003-budget-revisions.md
├── 004-weeklog-vs-list.md
├── 005-financial-sources.md
└── ...
```

Formato:

```md
# Status

Accepted

# Context

# Decision

# Alternatives considered

# Consequences
```

Isso é **ouro para agente de IA**.

Porque daqui três semanas ele não vai tentar reverter uma decisão que já foi discutida.

---

# 8. Nível 3 — memória da feature

Dentro da spec:

```text
specs/003-production-weeklog/
├── spec.md
├── plan.md
├── tasks.md
├── acceptance.md
└── decisions.md
```

Essa é a memória temporária daquela implementação.

Depois que terminar:

* decisão relevante → ADR;
* conhecimento estável → DOMAIN/ARCHITECTURE;
* resto permanece no histórico da spec.

---

# 9. Nível 4 — memória efêmera do agente

Pode haver:

```text
.agent/
├── current-task.md
├── findings.md
└── handoff.md
```

Ou equivalente do ambiente que vocês usarem.

Mas essa memória é descartável.

Nunca deveria conter uma decisão que só existe ali.

A regra seria:

> **Se outro desenvolvedor precisa saber daqui a três meses, vai para Git.**

---

# 10. Hierarquia de fonte de verdade

Eu colocaria isso literalmente em `AGENTS.md`.

```text
Prioridade de contexto:

1. Código + banco atual
2. Spec ativa
3. ADRs aceitos
4. DOMAIN.md
5. ARCHITECTURE.md
6. ENGINEERING_RULES.md
7. Documentação histórica/auditoria
8. Memória do agente/chat
```

Mas há uma nuance:

Para **requisito**, a spec é autoridade.

Para **estado atual**, o código é autoridade.

Exemplo:

```text
Spec:
WEEKLOG deve ser X.

Código:
atualmente faz Y.

Conclusão:
implementar X.

NÃO:
assumir que Y é a regra porque está no código.
```

---

# 11. `AGENTS.md` seria obrigatório

Na raiz:

```text
AGENTS.md
```

Esse arquivo deveria ensinar qualquer agente novo em 2 minutos.

Algo como:

```md
# Operix Agent Instructions

## Mission
Stabilize existing brownfield system without unnecessary rewrites.

## Current priority
R0 + R1 + R2.

## Never
- introduce new Supabase dependencies
- use localStorage for business data
- trust tenant IDs from client
- implement future modules
- refactor unrelated code

## Before coding
1. Read relevant spec.
2. Read DOMAIN.md.
3. Read applicable ADRs.
4. Inspect current implementation.
5. Produce plan.

## After coding
1. lint
2. typecheck
3. tests
4. tenant A/B tests
5. inspect diff
6. update task/spec
```

Isso ajuda Cursor, Claude Code, Codex e outros agentes.

---

# 12. Eu teria agentes com papéis diferentes

Não faria um único agente implementar e declarar sozinho que está perfeito.

### Agent 1 — Explorer

Só lê.

Entrega:

* current state;
* arquivos;
* riscos;
* dependências.

Não edita.

### Agent 2 — Implementer

Recebe:

* spec;
* plano aprovado;
* findings do Explorer.

Implementa.

### Agent 3 — Reviewer

Não recebe a justificativa emocional do implementer.

Olha:

* diff;
* spec;
* testes.

Pergunta:

> atende mesmo?

### Agent 4 — QA/Security

Especialmente para:

* tenancy;
* auth;
* financeiro;
* storage.

Isso pode ser feito até com o mesmo modelo em sessões diferentes.

A separação de contexto é mais importante do que ser “outro modelo”.

---

# 13. Para tarefas pequenas, não precisa dessa cerimônia toda

Eu usaria níveis.

### L0 — trivial

Copy, CSS, texto.

```text
implement → lint → visual check
```

### L1 — pequena

Componente isolado.

```text
plan curto → implement → tests
```

### L2 — domínio

Backend + banco + frontend.

```text
spec → plan → tests → implement → review
```

### L3 — crítico

Auth, tenancy, financeiro, migrations.

```text
spec
→ ADR se necessário
→ threat/risk analysis
→ tests first
→ implementation
→ reviewer agent
→ security agent
→ human approval
```

Isso evita burocracia artificial.

---

# 14. O padrão ideal para Operix é Vertical Slice Engineering

Eu não organizaria os trabalhos assim:

```text
Semana 1:
arrumar frontend inteiro

Semana 2:
arrumar backend inteiro

Semana 3:
arrumar banco inteiro
```

Isso é péssimo para brownfield.

Faria:

### Slice 1

```text
Orçamento
UI
↓
API
↓
tenant
↓
DB
↓
reload
↓
tests
```

Done.

### Slice 2

```text
Produção
...
```

### Slice 3

```text
WEEKLOG
...
```

O diagnóstico já concluiu que a migração anterior foi feita por arquivo/chamada em vez de por capacidade vertical — exatamente uma das causas do estado híbrido atual. 

Então não devemos repetir o mesmo erro.

---

# 15. Eu colocaria um Quality Gate automático para IA

Antes de o agente poder dizer “pronto”:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
```

Para domínio crítico:

```bash
npm run test:tenant
npm run test:e2e -- production-weeklog
```

E o prompt do agente literalmente diz:

> Você não pode marcar uma tarefa como concluída se qualquer gate falhar.

---

# 16. Prompt base de implementação

Algo assim:

```text
Você está trabalhando na Operix.

Leia obrigatoriamente:

AGENTS.md
docs/PROJECT.md
docs/DOMAIN.md
docs/ARCHITECTURE.md
docs/ENGINEERING_RULES.md
ADRs relacionadas
spec ativa

Não altere código antes de:

1. identificar current state;
2. listar arquivos envolvidos;
3. mapear persistência atual;
4. mapear autorização;
5. identificar legado Supabase/localStorage;
6. propor plano;
7. listar testes necessários.

Princípios:

- preservar código reaproveitável;
- não fazer refactor horizontal;
- não aumentar escopo;
- backend é autoridade;
- tenancy sempre server-side;
- nenhuma nova dependência Supabase;
- nenhuma persistência de negócio em localStorage;
- mudanças financeiras exigem teste;
- migration precisa preservar dados;
- retry não pode duplicar efeitos.

Após implementar:

- rode lint;
- typecheck;
- testes;
- integração;
- E2E aplicável;
- revise seu próprio diff;
- liste riscos residuais;
- atualize tasks.md.

Se algo da spec for ambíguo:
PARE e registre em open question.
Não invente regra de negócio.
```

Esse prompt já reduz muito o “vibe drift”.

---

# 17. Como eu faria o loop diário

Na prática:

### Início

Você ou Gustavo escolhem:

```text
SPEC-003
TASK-07
Produção concluída gera WEEKLOG idempotente
```

### Agent Explorer

> investiga.

### Agent Implementer

> faz plano.

Vocês aprovam rapidamente.

### Implementação

Agente codifica e roda testes.

### Reviewer Agent

> revisa diff contra spec.

### Humano

Só verifica:

* decisões;
* risco;
* comportamento.

Merge.

---

# 18. E a memória compartilhada pode ter índice gerado automaticamente

Além dos markdowns, dá para ter:

```text
docs/AI_CONTEXT.md
```

Gerado automaticamente com:

* specs ativas;
* ADRs aceitos;
* módulos;
* modelos;
* endpoints;
* branches;
* backlog atual.

Mas eu **não editararia isso manualmente**.

Um script pode reconstruir.

Exemplo:

```bash
npm run context:build
```

E gerar:

```text
AI_CONTEXT.md
```

Assim o agente começa uma sessão com um mapa atual.

---

# 19. Não usaria vector database como fonte primária

Pode ser útil depois para buscar:

* docs;
* ADRs;
* código;
* histórico.

Mas eu não faria:

> “nossa memória do projeto está num Pinecone”.

Isso cria outro sistema para manter.

Para uma base de ~130k LOC, Git + busca semântica do agente + docs bem estruturados já são suficientes.

Vector store é **índice**, não fonte de verdade.

---

# 20. Um detalhe que eu considero muito importante: Context Budget

Não enfie:

* 19 relatórios;
* 90 minutos de reunião;
* 130 mil LOC;
* 80 requisitos;

em todo prompt.

Isso piora a IA.

A arquitetura documental deve permitir:

```text
AGENTS.md
   ↓
qual spec?
   ↓
quais ADRs?
   ↓
quais arquivos?
```

Ou seja, **progressive disclosure**.

Contexto mínimo suficiente.

---

# 21. Meu modelo final

Eu chamaria o processo de:

## **Spec-Driven Vertical Engineering**

Com quatro mecanismos:

### Spec

define **o que**.

### Tests

provam **se funciona**.

### Engineering Loop

define **como a IA trabalha**.

### Shared Project Memory

garante **continuidade entre agentes e sessões**.

Visualmente:

```text
                   PROJECT MEMORY
      ┌────────────────────────────────┐
      │ Domain · Architecture · ADRs   │
      │ Engineering Rules · Glossary   │
      └───────────────┬────────────────┘
                      │
                      v
                 ACTIVE SPEC
                      │
          ┌───────────┴───────────┐
          v                       v
     Acceptance               Test Plan
          │                       │
          └───────────┬───────────┘
                      v
              ENGINEERING LOOP

        Explore
           ↓
         Plan
           ↓
      Tests First*
           ↓
       Implement
           ↓
        Verify
           ↓
      Self Review
           ↓
      Agent Review
           ↓
       Human Gate
           ↓
         Merge
           ↓
   Update Project Memory

* obrigatório nos domínios críticos
```

Para a Operix, considero isso bem mais robusto do que simplesmente “usar Cursor/Claude/Codex e ir pedindo features”.

A IA passa a atuar **como um engenheiro dentro de um sistema de engenharia**, não como a própria arquitetura do projeto.

E é exatamente o tipo de estrutura que eu adotaria num brownfield com multi-tenancy e financeiro: liberdade alta para gerar código, mas **liberdade baixa para inventar regra, arquitetura ou fonte de verdade**.

Implementaria isso **dentro do próprio repositório**, aproveitando o que a Operix já tem (`.specify/`, `specs/000-operix-diagnostic/`, `docs/audit/`, `.claude/`) em vez de introduzir mais uma metodologia paralela. O objetivo é que qualquer agente — Codex, Claude Code, Cursor etc. — entre no repo e encontre a mesma fonte de verdade.

A implantação prática seria esta:

1. **Crie uma camada canônica de contexto na raiz do repo.** Eu adicionaria `AGENTS.md` e uma pasta `docs/project/`. O `AGENTS.md` seria curto e obrigatório; ele diz ao agente onde buscar contexto e quais regras nunca quebrar. A memória durável ficaria em Git, não em chats ou memória proprietária de um agente.

```text
operix/
├── AGENTS.md
├── docs/
│   ├── project/
│   │   ├── PROJECT.md
│   │   ├── DOMAIN.md
│   │   ├── ARCHITECTURE.md
│   │   ├── ENGINEERING_RULES.md
│   │   └── GLOSSARY.md
│   ├── adr/
│   ├── audit/                 # já existe
│   └── runbooks/
│
├── specs/
│   ├── 000-operix-diagnostic/ # já existe
│   ├── 001-foundation-context/
│   ├── 002-budget-production/
│   ├── 003-production-weeklog/
│   ├── 004-weeklog-list/
│   └── 005-finance-core/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   ├── e2e/
│   └── security/
│
└── .github/
    ├── workflows/
    └── pull_request_template.md
```

Isso encaixa muito bem na estrutura atual da Operix, que já possui `.specify`, specs e documentação técnica — portanto não estamos criando uma segunda fonte de verdade. 

O `AGENTS.md` da raiz poderia começar assim:

```md
# Operix — Agent Instructions

## Mission

Stabilize and evolve the existing Operix brownfield system.
Preserve reusable implementation.
Do not rewrite unrelated areas.

## Current scope

Current contracted priority:

R0 — foundation required by the Core
R1 — mobile operations
R2 — List / Confrontation / essential Finance

R3, R4 and future modules are NOT part of the current implementation
unless explicitly required by an active spec.

## Source of truth

For product requirements:
1. Active spec
2. Accepted ADRs
3. docs/project/DOMAIN.md
4. docs/project/PROJECT.md
5. meeting/audit documents

For current implementation:
1. Code
2. Database/schema
3. Tests
4. Audit documentation

Never infer current behavior only from a product document.

## Mandatory rules

- Never introduce a new Supabase dependency.
- Never use localStorage as canonical business persistence.
- Never trust workspaceId/userId/technicianId sent by the frontend.
- Tenant and object authorization are server-side.
- Financial rules require automated tests.
- Critical effects must be idempotent.
- Do not implement future modules opportunistically.
- Do not refactor unrelated code.
- Do not declare a feature done because the UI renders.

## Before editing code

Read:
- this file
- active spec
- relevant ADRs
- relevant DOMAIN sections

Then:
1. inspect current implementation;
2. identify UI, API, DB and authorization paths;
3. identify legacy Supabase/localStorage paths;
4. write implementation plan;
5. define tests.

## Before completion

Run:
- lint
- typecheck
- unit tests
- relevant integration tests
- relevant tenant isolation tests
- relevant E2E

Review your diff against the active spec.
Update tasks.md and ADR/documentation where necessary.
```

Depois você cria os cinco documentos estáveis. `PROJECT.md` fala **o que estamos construindo agora**; `DOMAIN.md`, **como o negócio funciona**; `ARCHITECTURE.md`, **como o software deve ser estruturado**; `ENGINEERING_RULES.md`, **o que é obrigatório tecnicamente**; e `GLOSSARY.md`, **qual é a linguagem oficial**.

No `DOMAIN.md`, por exemplo, eu colocaria literalmente:

```md
# Core domain

## Technician — independent

Operates in a personal isolated context.
Can own clients and execute:
Budget -> Production -> WEEKLOG -> List -> Finance.

Does not receive a full employee hierarchy.

## Technician — workspace linked

Operates inside a Workspace.
May only access own operational and financial projection.

Must never receive aggregated company/other-technician finance.

## WEEKLOG

Represents executed/validated work.

WEEKLOG is NOT a Payment List.

## Payment List

Represents work recognized commercially by the client.

One List may contain items from multiple WEEKLOG periods.

## Finance canonical sources

Executed = WEEKLOG
Recognized = List
Expected = validated pending List
Received = paid List
Available = Received - Expenses
```

Isso impede um agente novo de reinventar conceitos que já foram fechados. A separação WEEKLOG × Lista e as fontes financeiras são justamente redesenhos estruturais que a validação identificou. 

Para arquitetura, eu registraria decisões permanentes em ADR. O primeiro conjunto deveria ser:

```text
docs/adr/
001-request-context-and-tenancy.md
002-user-person-membership-identity.md
003-canonical-client.md
004-budget-revisions.md
005-weeklog-vs-payment-list.md
006-financial-sources.md
007-storage-ownership.md
008-supabase-migration-strategy.md
009-critical-transition-idempotency.md
```

Não precisa escrever dez páginas em cada um. Um ADR bom para vocês pode ter 1–2 páginas:

```md
# ADR-005 — WEEKLOG and Payment List

Status: Accepted

## Context

Legacy code partially treats WEEKLOG / ServiceOrder and PaymentOrder/List
as a sequential 1:1 process.

Business validation established that this is incorrect.

A List may contain works from multiple weeks.

## Decision

WEEKLOG and Payment List are distinct aggregates.

A PaymentList contains explicit items referencing recognized works.

Finance Expected is derived from validated pending Lists.

## Consequences

- do not derive List identity from WEEKLOG week;
- payment/list creation must not be a hidden side effect of reading WEEKLOG;
- migrations must preserve legacy relationships;
- finance queries must move to List as canonical commercial source.
```

A partir daí vem o **Spec-Driven real**. Não faça uma spec “Implementar Operix”. Faça uma spec por fatia vertical.

A próxima poderia ser:

```text
specs/001-foundation-context/
├── spec.md
├── plan.md
├── tasks.md
├── acceptance.md
└── findings.md
```

O `spec.md` responde somente **o que precisa acontecer**:

```md
# 001 — Foundation Context

## Problem

The application has authentication and workspace concepts,
but several backend routes trust workspace/object identifiers
provided by the client.

## Target

Every Core request receives an authoritative server-side context.

## Invariants

- Workspace B cannot access Workspace A resources.
- A linked technician sees only own resources when scope=own.
- A platform role is not the same as a workspace role.
- Public registration cannot create privileged platform roles.
- A request cannot elevate scope by changing query/body parameters.

## In scope

- auth bootstrap
- platform vs workspace roles
- RequestContext
- workspace membership validation
- object authorization helper
- technician own context
- A/B isolation tests

## Out of scope

- redesign all roles
- R3 personnel management
- platform support impersonation
- advanced audit UI

## Acceptance

...
```

A `plan.md` é produzida **depois que o agente inspeciona o código**. Ela não deve ser inventada antes de ele localizar `auth.ts`, `permissionPolicy.ts`, `useWorkspace`, rotas afetadas etc.

O fluxo então passa a ser:

```text
spec
  ↓
explore current code
  ↓
plan
  ↓
tests
  ↓
implementation
  ↓
verification
  ↓
review
  ↓
merge
```

### Como usar TDD sem burocratizar

Eu começaria TDD já na `001-foundation-context`.

Antes de corrigir tenancy, escrevemos algo equivalente a:

```ts
describe("workspace isolation", () => {
  it("allows user A to access an object owned by workspace A");
  it("denies user A access to an object owned by workspace B");
  it("ignores a forged workspaceId from the query string");
});

describe("technician own scope", () => {
  it("returns records belonging to the current technician");
  it("does not return another technician's records");
});
```

Para UI simples, não precisa TDD fanático.

Mas para **tenant, autorização, financeiro, migrations e transições**, o teste vem primeiro.

Isso é especialmente necessário porque hoje há rotas como People e Locations sem escopo suficiente e Service Orders confiando em `workspace_id` fornecido pelo cliente. 

### O primeiro dataset de testes também deveria nascer agora

Crie um seed fixo:

```text
Workspace A
  Owner A
  Technician A
  Client A

Workspace B
  Owner B
  Technician B
  Client B

Independent Technician C
```

Depois adicione:

```text
Budget A
Production A
WEEKLOG A
Pending List A
Paid List A
Expense A
```

Assim qualquer agente consegue reproduzir:

```text
A pode ver A? sim.
A pode ver B? não.
Técnico A vê financeiro agregado? não.
Owner A vê workspace A? sim.
```

Esse dataset vale mais que dezenas de testes improvisados.

### Depois configure o Loop Engineering no prompt do agente

Você não precisa manualmente digitar um prompt gigantesco toda vez.

Crie, por exemplo:

```text
.claude/commands/implement-spec.md
```

ou equivalente da ferramenta.

O conteúdo:

```md
Implement the requested task from the active Operix spec.

PHASE 1 — UNDERSTAND

Do not modify code.

Read:
- AGENTS.md
- active spec
- relevant project docs
- accepted ADRs

Inspect:
- current files
- API path
- persistence
- authorization
- existing tests
- Supabase/localStorage legacy paths

Return:
- current state
- files involved
- risks
- uncertainties

PHASE 2 — PLAN

Write or update plan.md.

List:
- files to change
- migration if required
- tests
- compatibility strategy
- rollback strategy

Do not implement unresolved business rules.

PHASE 3 — TEST

For critical domain behavior, write failing tests first.

PHASE 4 — IMPLEMENT

Implement only the active task.
Do not perform unrelated refactors.

PHASE 5 — VERIFY

Run all required quality gates.

PHASE 6 — REVIEW

Review your own diff for:
- tenancy bypass
- missing object authorization
- new any
- new Supabase usage
- localStorage business state
- silent errors
- non-idempotent side effects
- secret/PII logging
- missing tests

PHASE 7 — HANDOFF

Update tasks.md.

Report:
- implemented
- tests
- migrations
- residual risks
- open questions

Do not mark complete if a mandatory gate is failing.
```

A grande sacada é: **o agente não recebe permissão para começar codando**.

Primeiro ele tem que entender.

### Em seguida configure CI

No `package.json`, eu convergiria para scripts claros:

```json
{
  "scripts": {
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "test:unit": "...",
    "test:integration": "...",
    "test:tenant": "...",
    "test:e2e": "...",
    "build": "..."
  }
}
```

E `.github/workflows/ci.yml`:

```text
checkout
→ setup Node
→ npm ci
→ lint
→ typecheck
→ unit
→ PostgreSQL de teste
→ Prisma migrations
→ integration
→ tenant tests
→ build frontend/backend
```

Não colocaria toda a suíte E2E pesada em toda edição local, mas em PR para `main`, os fluxos essenciais precisam rodar.

A auditoria encontrou praticamente ausência de testes backend e pouquíssimos testes frontend, portanto essa infraestrutura é uma mudança estrutural importante, não perfumaria. 

### Para memória compartilhada entre IAs, faça aliases, não cópias

Você provavelmente vai usar mais de uma ferramenta.

Então não faça:

```text
CLAUDE.md com uma verdade
CURSOR.md com outra
Codex instructions com outra
```

Faça:

```text
AGENTS.md = fonte canônica
```

E nos arquivos específicos:

```md
# CLAUDE.md

Read and follow ./AGENTS.md.
```

```md
# .cursor/rules/operix.mdc

Canonical engineering instructions:
@AGENTS.md
```

Se uma ferramenta não consegue incluir arquivo, copie apenas o bootstrap:

> “Before doing any work, read AGENTS.md.”

Assim não existe “Claude acha A, Codex acha B”.

---

## Como começar amanhã, literalmente

Eu não começaria ainda por “implementar orçamento”.

Faria uma **Spec 001 — Foundation Context & Engineering Baseline**.

O objetivo dela seria deixar pronto:

```text
repo canônico
+
baseline Git
+
Docker local
+
env
+
staging
+
CI
+
Prisma baseline
+
seed A/B
+
RequestContext
+
tenant isolation
+
test infrastructure
```

Mas cuidado: não precisa terminar uma plataforma de DevOps inteira antes de tocar o produto.

Assim que tivermos:

```text
CI
+ DB testável
+ RequestContext
+ primeiro teste A/B
```

já podemos começar a fatia seguinte:

```text
002 — Budget → Production
```

Depois:

```text
003 — Production → WEEKLOG
004 — WEEKLOG → List / import / confrontation
005 — Finance
```

E cada uma deixa a fundação um pouco mais forte.

---

## Como fica uma tarefa individual para um agente

Em vez de:

> “arruma o WEEKLOG”

o ticket seria:

```text
SPEC: 003-production-weeklog
TASK: T07

Goal:
Make completion of a ProductionOrder create or recover its
canonical WEEKLOG without duplicate records.

Required behavior:
- completed OP remains completed;
- WEEKLOG is created exactly once;
- retry does not duplicate;
- workspace isolation applies;
- linked technician only sees own;
- failure is visible/recoverable;
- legacy noop path is removed for this capability.

Before coding:
inspect existing productionOrders.ts,
upsertWeeklogFromProduction(),
ServiceOrder relationships,
frontend mutation and tests.

Mandatory tests:
- normal completion
- repeated completion
- retry after derived failure
- workspace A/B
- technician own scope
```

Isso é o que transforma AI coding em engenharia.

---

## E eu não criaria ainda memória vetorial, RAG próprio ou banco de contexto

Para a Operix hoje isso seria **complexidade a mais para resolver um problema que ainda não existe**.

Temos ~131k LOC e documentação razoavelmente controlável. 

Git + markdown + busca de código + busca semântica do próprio agente já resolvem.

Mais tarde podemos criar um:

```text
scripts/build-ai-context.mjs
```

que gere automaticamente um:

```text
docs/project/AI_CONTEXT.generated.md
```

com:

* specs ativas;
* ADRs;
* models;
* routes;
* scripts;
* últimos migrations.

Mas isso é conveniência, não fundação.

---

### Minha recomendação de implementação inicial

Eu faria **um commit exclusivamente de infraestrutura de engenharia**, sem alterar comportamento do Operix:

```text
chore: establish Operix engineering workflow
```

Incluindo:

```text
AGENTS.md
docs/project/*
docs/adr/README.md
spec template
PR template
CI inicial
test directories
CONTRIBUTING.md
```

E o próximo:

```text
spec: define foundation request context
```

criando `specs/001-foundation-context/`.

**Só o terceiro conjunto de commits começa a alterar comportamento de produção.**

Isso nos dá uma fronteira muito limpa entre:

**“sistema que recebemos”**

e

**“Operix sob engenharia da EverGreen”.**

Esse seria meu ponto de partida.
