# Validação do Handover e Viabilidade da Fase 4B

**Data**: 2026-09-05  
**Escopo**: comparação estática e preparação; nenhum teste 4B executado; nenhum código de produto alterado  
**Fonte confidencial**: `QW-Nexus_Handover_Tecnico (1).pdf`, 6 páginas, SHA-256 `A5435125F2A6D2A2A2E0DFC59D36E3E48E6CD5C13072C3BF8C91543C029963A4`  
**Regra de manuseio**: valores de credenciais foram deliberadamente omitidos. Este relatório contém somente nomes, classes de segredo, locais e riscos.

## 1. Parecer de prontidão

**A Fase 4B ainda não pode ser executada com segurança.** A arquitetura é reproduzível localmente, mas o ambiente atual não está operacional e o caminho de bootstrap não é autocontido. Os bloqueios objetivos são:

1. Docker CLI/Compose estão instalados, porém o daemon Docker Desktop não está ativo.
2. `node_modules` não existe na raiz nem em `backend/`; `npm ci` ainda não foi executado.
3. `.env` e `backend/.env` não existem; não há conjunto de credenciais exclusivamente local/sandbox aprovado.
4. `docker-compose.yml` possui contextos absolutos do host de deploy, inexistentes nesta máquina. A sintaxe é válida, mas `docker compose up --build` não é localmente reproduzível como documentado no README.
5. A imagem da API executa `node dist/index.js`, sem `prisma migrate deploy` ou `prisma db push` no startup.
6. Existe apenas uma migration Prisma incremental, que altera `billing_clients`; ela não cria as 44 tabelas em um PostgreSQL vazio. `prisma migrate deploy` sozinho não é bootstrap válido.
7. Não há seed/bootstrap versionado para o dataset multi-workspace, e `Client` operacional não possui endpoint de criação.
8. O processo da API agenda ingestão meteorológica automática após 8 segundos e a cada 15 minutos, sem flag de desativação. Um ambiente-base precisa bloquear egress.
9. O frontend possui fallback de telemetria externo embutido e 48 importadores Supabase. O navegador de teste precisa bloquear egress não autorizado.
10. Faltam decisões de negócio sobre owner/admin, tenant canônico e atomicidade, além de contas e sandboxes dedicados.

Parecer: **viável de forma condicional em ambiente descartável**, após os gates acima. Nenhuma dependência da 4B justifica acesso ou testes em produção.

## 2. Handover versus código e auditoria

Classificações: `CONFIRMADA PELO CÓDIGO`, `PARCIALMENTE CONFIRMADA`, `DIVERGENTE DO CÓDIGO`, `REQUER RUNTIME`.

| ID | Afirmação relevante do handover | Classificação | Evidência e confronto |
|---|---|---|---|
| HV-01 | Frontend React/Vite servido por Nginx | CONFIRMADA PELO CÓDIGO | `package.json`, `Dockerfile.frontend` e `nginx.conf`; runtime não foi iniciado. |
| HV-02 | Backend Node/Express/TypeScript em container | CONFIRMADA PELO CÓDIGO | `backend/package.json`, `backend/Dockerfile` e `backend/src/index.ts`. |
| HV-03 | PostgreSQL 16 com Prisma e cerca de 44 modelos | CONFIRMADA PELO CÓDIGO | Compose referencia PostgreSQL 16; `schema.prisma` tem 44 modelos e datasource PostgreSQL. |
| HV-04 | Banco está pronto para subir por migrations | DIVERGENTE DO CÓDIGO | há uma única migration incremental; ela não materializa o schema completo em banco vazio; Dockerfile não executa migration. |
| HV-05 | MinIO substitui o Supabase Storage | PARCIALMENTE CONFIRMADA | backend S3/MinIO, 10 buckets e bootstrap existem; 12+ consumidores continuam no storage legado/noop e o runtime MinIO não foi validado. |
| HV-06 | MinIO possui quatro buckets públicos e API interna | CONFIRMADA PELO CÓDIGO | `lib/minio.ts` define 10 buckets, quatro públicos; compose expõe apenas o console ao host e mantém a API na rede Docker. |
| HV-07 | Autenticação própria por JWT substitui Supabase Auth | PARCIALMENTE CONFIRMADA | login/register/me e middleware JWT existem; ainda há resíduos Supabase em autenticação auxiliar, convites, permissões e sessões. |
| HV-08 | “Supabase não é mais utilizado” | DIVERGENTE DO CÓDIGO | 48 arquivos frontend importam o cliente; 45 participam de fluxos funcionais e a facade noop mascara operações. Migrações, functions e host legado também permanecem. |
| HV-09 | API possui os módulos listados no inventário do handover | CONFIRMADA PELO CÓDIGO | 25 arquivos em `backend/src/routes` mais `/api/health`; a Fase 4A catalogou 189 endpoints. |
| HV-10 | Rotas marcadas como privadas exigem JWT | PARCIALMENTE CONFIRMADA | muitas usam `requireAuth`, mas autenticação não garante autorização por tenant; `/api/extract/*` é público e há funções de alto impacto sem RBAC adequado. |
| HV-11 | Stripe implementa checkout, portal e webhook | CONFIRMADA PELO CÓDIGO | `lib/stripe.ts` e `routes/billing.ts`; assinatura de webhook é validada. |
| HV-12 | Stripe está configurado em sandbox/test | REQUER RUNTIME | o código prefere sandbox fora de produção, porém pode fazer fallback para live se apenas a chave live estiver presente. A configuração do provedor não foi consultada. |
| HV-13 | OCR/IA usa Gemini com fallback OpenAI | CONFIRMADA PELO CÓDIGO | `lib/ai.ts` ordena Gemini e OpenAI; cinco rotas de extração consomem o serviço. Sucesso, quota e custos requerem runtime. |
| HV-14 | SMTP transacional está implementado | CONFIRMADA PELO CÓDIGO | Nodemailer usa `SMTP_*` e `EMAIL_FROM`; entregabilidade/autenticação requerem sandbox runtime. |
| HV-15 | OpenRouteService com fallback de rota/geocodificação | PARCIALMENTE CONFIRMADA | ORS e Nominatim estão no handler; sem chave, o cálculo possui comportamento alternativo. Precisão e limites requerem runtime. |
| HV-16 | Clima usa Tomorrow.io, NASA e Meteostat | PARCIALMENTE CONFIRMADA | Tomorrow é lido; o worker também usa MeteoFrance, NOAA e Open-Meteo públicos. `NASA_API_KEY` e `METEOSTAT_RAPIDAPI_KEY` são passados pelo compose, mas não são consumidos pelo worker atual. |
| HV-17 | Job meteorológico roda no processo a cada 15 minutos | CONFIRMADA PELO CÓDIGO | `index.ts:108-115`: primeiro disparo após 8 s e `setInterval` de 15 min. Múltiplas réplicas executariam o mesmo job. |
| HV-18 | Docker Compose orquestra Postgres, MinIO, API e frontend | PARCIALMENTE CONFIRMADA | quatro serviços, dois volumes e dependências existem; contextos de build absolutos impedem reprodução local sem correção ou comandos diretos. |
| HV-19 | API health check testa conexão PostgreSQL | CONFIRMADA PELO CÓDIGO | `GET /api/health` executa `SELECT 1`; não testa MinIO nem integrações externas. |
| HV-20 | Buckets MinIO são criados automaticamente | CONFIRMADA PELO CÓDIGO | `ensureBuckets()` roda após `app.listen`; falha é apenas registrada e não derruba API, portanto health “ok” não comprova storage. |
| HV-21 | Credenciais principais foram rotacionadas na data indicada | REQUER RUNTIME | somente consoles/provedores e tentativas autenticadas poderiam comprovar; nenhuma verificação ou rotação foi executada. |
| HV-22 | `keys.txt` contém segredos legados versionados | DIVERGENTE DO CÓDIGO | arquivo não existe no checkout e não apareceu na busca nominal do histórico; o PDF comprova armazenamento plaintext, mas a alegação sobre o arquivo/repositório exige auditoria completa de objetos Git e artefatos externos. |
| HV-23 | `.env` já carregou credenciais do ambiente | PARCIALMENTE CONFIRMADA | `.env` não existe hoje, mas commits históricos contêm variáveis preenchidas; `.env.development` preenchido continua rastreado. Valores não foram registrados. |
| HV-24 | Credencial SSH/host foi entregue fora do PDF | REQUER RUNTIME | não foi localizada no material acessível e não é necessária para preparar uma 4B local. Não solicitar acesso de produção para esta fase. |

### 2.1 Convergência com os relatórios anteriores

- `repository-inventory.md` e `architecture-and-data-model.md` acertam a arquitetura alvo PostgreSQL/Prisma/MinIO/JWT e o estado híbrido Supabase.
- `functional-inventory.md` e `api-contracts-and-bugs.md` contradizem de forma demonstrável a frase “Supabase não é mais utilizado”.
- A afirmação anterior de MinIO “funcional” deve ser lida como **implementado estaticamente**; funcionamento real permanece `REQUER RUNTIME`.
- O handover adiciona contexto operacional útil sobre fornecedores, mas não invalida os 29 bugs confirmados na Fase 4A nem resolve tenancy, atomicidade ou contratos divergentes.

## 3. Checklist de variáveis — somente nomes

“Obrigatória” considera o teste indicado, não produção. `Base` significa que a API não inicia corretamente sem ela ou que o container a exige. Variáveis live devem permanecer ausentes na 4B.

| Variável | Obrigatória? | Serviço | Onde é usada | Teste 4B |
|---|---|---|---|---|
| `POSTGRES_DB` | Sim — Base | PostgreSQL | compose/container | todos com persistência |
| `POSTGRES_USER` | Sim — Base | PostgreSQL | compose/container e composição da URL | todos com persistência |
| `POSTGRES_PASSWORD` | Sim — Base | PostgreSQL | compose/container e composição da URL | todos com persistência |
| `POSTGRES_PORT` | Não; default | PostgreSQL | bind do compose | health/inspeção local |
| `DATABASE_URL` | Sim — Base | Prisma/PostgreSQL | `schema.prisma`, `env.ts` | todos os endpoints |
| `NODE_ENV` | Sim por segurança | API/Stripe | `env.ts`, Prisma logs, seleção Stripe | fixar `test` ou `development`; nunca `production` |
| `PORT` | Não; default | API | `env.ts`, `index.ts` | health/API |
| `API_PORT` | Não; default | Docker host | compose | health/API |
| `FRONTEND_PORT` | Não; default | Nginx host | compose | UI/E2E |
| `VITE_API_URL` | Sim — UI | frontend | `lib/api.ts`, build arg | todos os E2E |
| `CORS_ORIGIN` | Sim — UI segura | API | `index.ts` | browser/auth |
| `PUBLIC_APP_URL` | Sim para links | API | recuperação/convites | auth + SMTP |
| `JWT_SECRET` | Sim — Base | Auth | `env.ts`, sign/verify JWT | auth/RBAC/tenant |
| `JWT_EXPIRES_IN` | Não; default | Auth | `lib/jwt.ts` | expiração/token |
| `MINIO_ENDPOINT` | Sim — Storage | MinIO/API | `lib/minio.ts` | G, documentos/fotos |
| `MINIO_ROOT_USER` | Sim — Storage | MinIO/API | container e S3 client | G |
| `MINIO_ROOT_PASSWORD` | Sim — Storage | MinIO/API | container e S3 client | G |
| `MINIO_CONSOLE_PORT` | Não; default | MinIO | bind do compose | inspeção manual |
| `EMAIL_FROM` | Sim para e-mail | SMTP | `lib/email/resend.ts` | K |
| `SMTP_HOST` | Sim para e-mail | SMTP | Nodemailer | K |
| `SMTP_PORT` | Não; default; fixar no sink | SMTP | Nodemailer | K |
| `SMTP_SECURE` | Não; fixar conforme sink | SMTP | Nodemailer | K |
| `SMTP_USER` | Sim para e-mail | SMTP | Nodemailer exige valor | K |
| `SMTP_PASS` | Sim para e-mail | SMTP | Nodemailer exige valor | K |
| `STRIPE_SANDBOX_API_KEY` | Sim para Stripe | Stripe | `lib/stripe.ts` | J |
| `STRIPE_LIVE_API_KEY` | **Não; deve estar ausente** | Stripe live | fallback do client | controle negativo J |
| `STRIPE_WEBHOOK_SECRET` | Opcional/fallback | Stripe webhook | `lib/stripe.ts` | J-03/J-04 |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Sim para webhook sandbox | Stripe webhook | `lib/stripe.ts` | J-02 a J-04 |
| `PAYMENTS_LIVE_WEBHOOK_SECRET` | **Não; deve estar ausente** | Stripe live | `lib/stripe.ts` | controle negativo J |
| `STRIPE_PORTAL_SANDBOX_URL` | Condicional | Stripe portal | billing | J-01 |
| `STRIPE_PORTAL_LIVE_URL` | **Não; deve estar ausente** | Stripe live | billing | controle negativo J |
| `VITE_PAYMENTS_CLIENT_TOKEN` | Sim para checkout UI | Stripe frontend | `lib/stripe.ts`, build arg | J-01 UI |
| `GEMINI_API_KEY` | Um provedor de IA | Gemini | `lib/ai.ts` | I |
| `OPENAI_API_KEY` | Um provedor/fallback | OpenAI | `lib/ai.ts` | I fallback |
| `TOMORROW_API_KEY` | Condicional | Tomorrow.io | `weatherIngest.ts` | L weather pago |
| `TOMORROWIO_API_KEY` | Não — não consumida | placeholder | somente `.env.example` | nenhum até alinhar nome |
| `NASA_API_KEY` | Não — não consumida | placeholder/clima | compose/exemplo, sem leitura atual | nenhum |
| `METEOSTAT_RAPIDAPI_KEY` | Não — não consumida | placeholder/clima | compose/exemplo, sem leitura atual | nenhum |
| `OPENROUTE_API_KEY` | Condicional | OpenRouteService | `routeCalc.ts` | L rota real |
| `VITE_SENTRY_DSN` | Não para 4B | Sentry | `main.tsx` | deve ser bloqueada no navegador |
| `VITE_SUPABASE_URL` | Não para arquitetura alvo | Supabase legado | client/máscara e fluxos legados | B; somente controle de ausência |
| `VITE_SUPABASE_PROJECT_ID` | Não para arquitetura alvo | Supabase legado | código/config histórico | nenhum fluxo alvo |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Não para arquitetura alvo | Supabase legado | client e Edge Functions legadas | B; não fornecer credencial real |
| `PAPPERS_API_KEY` | Não consumida pelo backend atual | placeholder | `.env.example` | nenhum |
| `COMPANIES_HOUSE_API_KEY` | Não consumida pelo backend atual | placeholder | `.env.example` | nenhum |
| `LOVABLE_API_KEY` | Não consumida pelo backend atual | legado | `.env.example`/UI legada | nenhum fluxo alvo |

### 3.1 Divergências de nomenclatura

- Os aliases legados `STRIPE_SECRET_KEY` e `STRIPE_PUBLISHABLE_KEY` não são lidos. O código espera `STRIPE_SANDBOX_API_KEY`/`STRIPE_LIVE_API_KEY` e `VITE_PAYMENTS_CLIENT_TOKEN`.
- Apenas `TOMORROW_API_KEY` é consumida; `TOMORROWIO_API_KEY` e `TOMORROW_APIKEY` não são aliases implementados.
- O alias legado `OPEN_ROUTE` não é lido; o handler consulta `OPENROUTE_API_KEY`.
- O alias legado `API_METEOSTAT_RAPID_API` não é lido; a configuração atual declara `METEOSTAT_RAPIDAPI_KEY`, que também não é consumida pelo worker.
- `NASA_API_KEY` e `METEOSTAT_RAPIDAPI_KEY` existem na configuração, mas o worker atual não os lê.
- `backend/.env.example` omite IA, clima e rota, embora `docker-compose.yml` e o código os aceitem. O exemplo raiz é a fonte mais abrangente, mas contém defaults que não devem ser reutilizados.

## 4. Segurança operacional e backlog de secrets

| Finding | Prioridade | Evidência sem valores | Consequência |
|---|---:|---|---|
| SEC-4B-001 | P0 | o PDF de handover armazena múltiplos segredos reais em texto puro | qualquer cópia/compartilhamento amplia o perímetro de comprometimento |
| SEC-4B-002 | P0 | `POST /api/auth/register` é público e aceita `role: admin`; esse papel libera `requireAdmin` | elevação de privilégio por autorregistro, a confirmar em ambiente local |
| SEC-4B-003 | P1 | `.env.development` preenchido está rastreado; `.env` com variáveis preenchidas existe no histórico | credenciais/configurações permanecem recuperáveis no Git |
| SEC-4B-004 | P1 | frontend contém DSN de telemetria fallback e host Supabase hardcoded | testes locais podem enviar metadados para serviços externos |
| SEC-4B-005 | P1 | exemplos/documentação contêm defaults de autenticação/storage preenchidos | cópia operacional pode criar ambiente previsível/fraco |
| SEC-4B-006 | P1 | o handover afirma exposição em `keys.txt`, mas o arquivo não foi localizado | inventário de segredos está incompleto; outras cópias podem existir |

Backlog futuro, **não executado nesta fase**:

1. Rotacionar todas as credenciais pós-handover, incluindo chaves de API, banco, JWT, SMTP, MinIO, Stripe e telemetria.
2. Localizar e remover `keys.txt` de todos os artefatos; se versionado em outra branch/repositório, expurgar conforme processo aprovado.
3. Remover `.env.development` do tracking e substituir segredos/configurações sensíveis por secret manager; manter somente templates sem valores reutilizáveis.
4. Verificar todos os objetos, branches, tags, reflogs, forks, CI artifacts e backups do Git com scanner de segredos; revogar antes de reescrever histórico.
5. Eliminar fallback hardcoded de telemetria e introduzir opt-in/kill switch para ambientes locais.
6. Separar inequivocamente credenciais sandbox/live e impedir fallback para live quando `NODE_ENV != production`.
7. Fechar autorregistro de papel privilegiado; bootstrap do primeiro admin deve ser out-of-band, auditável e uso único.

## 5. Preparação exata do ambiente local/sanitizado

### 5.1 Dependências

- PowerShell 7, Git, Node 20 e npm 10.
- Docker Desktop/Engine e Compose v2 ativos.
- Acesso de rede inicialmente **bloqueado** para API e navegador, liberado por allowlist somente nos testes I-L.
- Credenciais novas e exclusivas de teste, mantidas em variáveis do processo ou secret manager; nenhum `.env` versionado.
- Cliente HTTP que preserve headers/body e Playwright/browser isolado para evidências.

### 5.2 Gerar segredos locais somente em memória

```powershell
function New-LocalHexSecret([int]$Bytes = 32) {
  $buffer = [byte[]]::new($Bytes)
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  [Convert]::ToHexString($buffer)
}

$env:POSTGRES_DB = 'operix_4b'
$env:POSTGRES_USER = 'operix_4b'
$env:POSTGRES_PASSWORD = New-LocalHexSecret 24
$env:JWT_SECRET = New-LocalHexSecret 48
$env:MINIO_ROOT_USER = 'operix_4b'
$env:MINIO_ROOT_PASSWORD = New-LocalHexSecret 24
$env:DATABASE_URL = Read-Host 'DATABASE_URL do banco local' -MaskInput
$env:MINIO_ENDPOINT = 'http://operix-4b-minio:9000'
$env:CORS_ORIGIN = 'http://localhost:8080'
$env:PUBLIC_APP_URL = 'http://localhost:8080'
```

Não executar `Get-ChildItem Env:`, `docker inspect` sem filtro nem comandos que imprimam essas variáveis. Limpar o terminal/processo ao terminar.

### 5.3 Subir infraestrutura descartável sem alterar Dockerfiles

O compose atual não pode ser usado para build local por causa dos contextos absolutos. Até a correção permanente, a 4B pode usar comandos diretos e nomes rigidamente prefixados:

```powershell
docker network create --internal operix-4b-net
docker volume create operix-4b-postgres-data
docker volume create operix-4b-minio-data

docker run -d --name operix-4b-postgres --network operix-4b-net `
  -p 127.0.0.1:5432:5432 `
  -e POSTGRES_DB -e POSTGRES_USER -e POSTGRES_PASSWORD `
  -v operix-4b-postgres-data:/var/lib/postgresql/data postgres:16-alpine

docker run -d --name operix-4b-minio --network operix-4b-net `
  -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 `
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD `
  -v operix-4b-minio-data:/data minio/minio:latest server /data --console-address ':9001'
```

O uso de tags `latest` reduz reprodutibilidade. Antes da execução real, registrar e fixar digest aprovado sem alterar a lógica do produto.

### 5.4 Build, Prisma e API

```powershell
docker build -t operix-api:4b -f backend/Dockerfile backend
docker run --rm --network operix-4b-net -e DATABASE_URL operix-api:4b `
  npx prisma validate --schema prisma/schema.prisma

# Somente banco local descartável. Nunca executar contra produção.
docker run --rm --network operix-4b-net -e DATABASE_URL operix-api:4b `
  npx prisma db push --schema prisma/schema.prisma

docker run -d --name operix-4b-api --network operix-4b-net `
  -p 127.0.0.1:4000:4000 `
  -e NODE_ENV=test -e PORT=4000 -e DATABASE_URL -e JWT_SECRET `
  -e CORS_ORIGIN -e PUBLIC_APP_URL `
  -e MINIO_ENDPOINT -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD `
  operix-api:4b
```

`prisma migrate deploy` deve ser executado apenas como diagnóstico de status depois de existir um baseline correto. Hoje ele não substitui `db push` no banco descartável e não deve ser aplicado a produção.

### 5.5 Frontend

```powershell
$env:VITE_API_URL = 'http://localhost:4000/api'
docker build -t operix-frontend:4b -f Dockerfile.frontend `
  --build-arg VITE_API_URL --build-arg VITE_PAYMENTS_CLIENT_TOKEN .
docker run -d --name operix-4b-frontend -p 127.0.0.1:8080:80 operix-frontend:4b
```

Antes de abrir a UI, configurar o browser de teste para abortar hosts de Sentry e Supabase. A rede interna do container não bloqueia requisições feitas pelo navegador no host.

### 5.6 Bootstrap de identidade e dados

1. Criar um admin global local por `POST /api/auth/register`. Isto também reproduz SEC-4B-002; usar somente no banco descartável.
2. Registrar Owner A e Owner B como usuários locais e fazer cada um chamar `POST /api/workspaces`; “owner” é derivado de `Workspace.ownerUserId`, não é role aceita no JWT.
3. Como cada owner, criar manager/admin e technician pelo endpoint de members. Capturar a senha temporária apenas no cofre efêmero do teste, nunca em relatório/log.
4. Criar locations e people pela API autenticada, com marcadores distintos A/B.
5. Criar `BillingClient` via billing ops.
6. Inserir `Client` operacional por comando Prisma/SQL limitado ao banco descartável, pois não existe endpoint de criação. Esta lacuna impede bootstrap API-only.
7. Criar OP, WEEKLOG/ServiceOrder, PaymentOrder, documents e financial records pelas APIs, mantendo IDs e ownership no manifesto de execução sanitizado.

### 5.7 MinIO e health checks

Os 10 buckets são criados por `ensureBuckets()` ao iniciar a API. Como falha MinIO não derruba o processo, validar separadamente:

```powershell
docker exec operix-4b-postgres pg_isready -U $env:POSTGRES_USER -d $env:POSTGRES_DB
Invoke-WebRequest -UseBasicParsing 'http://localhost:9000/minio/health/live'
Invoke-RestMethod 'http://localhost:4000/api/health'
Invoke-WebRequest -Method Head -UseBasicParsing 'http://localhost:8080/'
docker logs --since 5m operix-4b-api
```

Não registrar saída de environment/inspect. Confirmar buckets por cliente S3/MinIO usando credenciais do processo e registrar somente nomes/contagens.

### 5.8 Rollback total do laboratório

Após exportar evidências sanitizadas, remover somente recursos prefixados `operix-4b-*`:

```powershell
docker rm -f operix-4b-frontend operix-4b-api operix-4b-minio operix-4b-postgres
docker volume rm operix-4b-minio-data operix-4b-postgres-data
docker network rm operix-4b-net
Remove-Item Env:POSTGRES_PASSWORD,Env:JWT_SECRET,Env:MINIO_ROOT_PASSWORD,Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Antes dessa remoção destrutiva, confirmar nomes exatos com `docker ps --filter name=operix-4b` e `docker volume ls --filter name=operix-4b`.

## 6. Dataset mínimo da Fase 4B

Todos os valores devem ser fictícios, identificados por `run_id` e proibidos em produção.

### 6.1 Identidades e memberships

| Identidade | Papel global | Workspace/membership | Uso |
|---|---|---|---|
| Platform Admin | `admin` local | sem membership inicial | billing ops, teste de autorregistro privilegiado |
| Owner A | `admin` no JWT | owner derivado de Workspace A | happy path e gestão A |
| Manager/Admin A | `admin` membership | membro ativo A | RBAC A |
| Technician A | `technician` | membro ativo A | ownership operacional A |
| Owner B | `admin` no JWT | owner derivado de Workspace B | controle tenant B |
| Technician B | `technician` | membro ativo B | controle tenant B |

Adicionar opcionalmente um usuário autenticado sem membership para controles negativos. E-mails devem usar domínio reservado/local; nenhuma pessoa real.

### 6.2 Entidades

| Entidade | Workspace A | Workspace B | Invariante de teste |
|---|---:|---:|---|
| `Location` | 1 | 1 | marcadores distintos e mesmo nome visível |
| `Person` | 2 (manager/técnico) | 1 técnico | nunca cruzar tenant |
| `Client` operacional | 1 | 1 | bootstrap direto local; IDs distintos |
| `BillingClient` | 1 | 1 | testar fragmentação e billing ops |
| `ProductionOrder` | 2 (draft/delivered) | 1 delivered | uma OP deve derivar no máximo um WEEKLOG |
| `ServiceOrder`/WEEKLOG | 2 | 1 | uma validada e outra draft |
| `PaymentOrder` | 2 | 1 | uma derivada e uma manual |
| `Document` | 2 privados + 1 público | 1 privado + 1 público | conteúdo sintético com sentinela A/B |
| `FinancialRecord` | 2 (receita/despesa) | 2 | valores distintos e reconciliação isolada |
| `Reconciliation` | 1 manual/auto | 1 auto | reconstrução A não pode tocar B |
| `ProfitRule`/distribuição | 1 regra | 1 regra | regras devem ser tenant-scoped no esperado |

Usar valores monetários pequenos e distintos, datas dentro de um período fixo, placas/VIN fictícios e arquivos sem PII. O rollback primário é descartar volumes, não tentar “limpar” produção por endpoints.

## 7. Integrações e nível de isolamento

| Integração | Pode usar sandbox/local? | Gate 4B |
|---|---|---|
| PostgreSQL | Sim, container local | banco/volume exclusivo |
| MinIO | Sim, container local | buckets exclusivos e egress interno |
| JWT | Sim, secret efêmero local | nunca reutilizar secret entregue |
| Stripe | Sim, modo test/sandbox | chaves de conta de teste; live ausente; webhook test |
| SMTP | Sim, sink SMTP com AUTH | nenhuma entrega para domínio real |
| Gemini/OpenAI | Não há sandbox local demonstrado | projeto/chave dedicados, hard quota e documentos sintéticos |
| Tomorrow.io | Não há sandbox demonstrado | chave dedicada/allowlist; testes públicos separados |
| NOAA/MeteoFrance/Open-Meteo | APIs públicas externas | egress só na categoria L, cache/evidência sanitizada |
| OpenRouteService/Nominatim | APIs externas | chave de teste e coordenadas sintéticas; respeitar rate limit |
| Supabase | Não necessário para target | não fornecer credencial; bloquear egress e observar legado/noop |
| Sentry | Não necessário | bloquear egress; não usar projeto real |

## 8. Acessos ainda faltantes

- Docker daemon ativo e permissão para criar/remover recursos locais prefixados.
- Aprovação de `prisma db push` **somente** no banco descartável.
- Credenciais novas de Stripe sandbox e webhook sandbox; nenhuma live.
- SMTP sink autenticado.
- Projetos/chaves de teste com quota para Gemini/OpenAI, Tomorrow e ORS, apenas se categorias I/L forem autorizadas.
- Decisão sobre owner/admin, tenant canônico, reconciliação e atomicidade.
- Manifesto de dataset/run ID e diretório seguro para evidências sanitizadas.
- Política de egress para container e navegador.

Não faltam — e não devem ser pedidos — acesso SSH, banco, MinIO ou credenciais de produção para executar a 4B.

## 9. Referencial

- OWASP API Security Top 10 (2023): API1 BOLA, API4 Unrestricted Resource Consumption, API5 Broken Function Level Authorization.
- NIST SP 800-57 e OWASP Secrets Management Cheat Sheet: ciclo de vida, rotação e redução de exposição.
- Twelve-Factor App: configuração externa ao código.
- Prisma Migrate: migrations como histórico reprodutível; `db push` restrito a prototipação/bancos descartáveis.
- RFC 9110: segurança/idempotência dos métodos HTTP.
