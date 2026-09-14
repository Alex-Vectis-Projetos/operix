# Diagnóstico Técnico Brownfield Final — Operix / QW Nexus

**Data**: 2026-09-07  
**Status**: CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS  
**Fase**: 7 — Backlog consolidado, roadmap e relatório final  
**Natureza**: diagnóstico técnico; não é proposta comercial, implementação ou homologação de produção

## 1. Sumário Executivo

A Operix possui uma base de produto relevante e recuperável: frontend React/Vite extenso, API Express com 189 endpoints, PostgreSQL/Prisma com 44 modelos, autenticação JWT, MinIO e integrações materialmente implementadas para Stripe, SMTP, OCR/IA, clima e rotas. Não se recomenda reescrever o sistema integralmente.

Ao mesmo tempo, a plataforma aparenta estar mais pronta do que arquiteturalmente está. A migração Supabase→stack própria foi feita por trechos: 45 fluxos funcionais ainda se relacionam com o cliente legado, alguns são neutralizados pela `noopSupabaseFacade`, outros usam REST, e estados relevantes permanecem em `localStorage` ou em campos `notes`/JSON. Assim, abrir um modal, atualizar uma tabela ou exibir toast não comprova persistência, reload, isolamento ou integração de produção.

Os riscos que bloqueiam uso confiável não são predominantemente visuais. São fundacionais: autorregistro privilegiado; mistura entre papel de plataforma e papel de workspace; ausência de `TenantContext` obrigatório; autorização por objeto inconsistente em 16 de 20 domínios prioritários; baseline Prisma incompleto; ownership de documentos/storage insuficiente; e efeitos não atômicos no fluxo OP→WEEKLOG→PaymentOrder→financeiro.

O plano recomendado é **recuperar e estabilizar por fatias verticais**, preservando UI, contratos, modelos e integrações úteis. O backlog final contém **40 itens**: **29 de estabilização/correção** e **11 de evolução**, distribuídos em **10 P0, 19 P1, 10 P2 e 1 P3**. O roadmap começa por segurança/tenant/banco/testes, segue por identidade/empresa, Produção, WEEKLOG/Financeiro, pessoas/clientes, documentos e locais/mapa; somente depois entram PDR/IA e white-label/multilíngue.

## 2. Escopo e Metodologia

O diagnóstico cobriu inventário físico/lógico, arquitetura e dados, 131 funcionalidades, 189 endpoints, 226 call sites REST, contratos, segurança, performance, dívida técnica, handover, 53 requisitos de target state e dependências G1–G9. A metodologia percorreu UI→hook→contrato→autorização→persistência→efeito derivado e separou:

- **evidência estática confirmada**: mecanismo diretamente demonstrável no código;
- **observação manual complementar**: superfícies visualmente acessadas, sem generalização;
- **hipótese runtime**: extensão/resultado depende de ambiente, dados, concorrência ou provedor;
- **target state**: intenção do cliente, não prova do comportamento atual.

Referencial: ISO/IEC 25010; ISO/IEC/IEEE 29148; OWASP API Security Top 10 2023; NIST SP 800-63B; RFC 9110; Twelve-Factor App; Strangler Fig; princípios ACID e de menor privilégio.

Relatórios especializados:

- [Inventário do repositório](repository-inventory.md)
- [Arquitetura e modelo de dados](architecture-and-data-model.md)
- [Inventário funcional](functional-inventory.md)
- [Contratos e bugs](api-contracts-and-bugs.md)
- [Validação do handover](handover-validation.md)
- [Segurança, performance e dívida](security-performance-and-technical-debt.md)
- [Target state do cliente](client-target-state.md)
- [Gap analysis](gap-analysis.md)
- [Backlog e roadmap canônico](stabilization-and-evolution-roadmap.md)
- [Plano runtime completo](runtime-test-plan.md) e [mínimo](minimum-runtime-validation.md)

## 3. Estado Atual da Plataforma

O inventário estático classificou 131 capacidades: 28 parciais, 36 quebradas, 4 somente UI, 3 não localizadas e 60 não testadas; nenhuma havia sido comprovada ponta a ponta à época da Fase 3. Posteriormente, houve acesso manual local: várias telas/interações aparentaram funcionar visualmente, dados e integrações continuaram heterogêneos e o console apresentou ruído. Essa observação eleva confiança apenas sobre acessibilidade visual geral; não altera automaticamente as classificações por módulo.

Para uma função ser considerada pronta para produção, deve fechar, conforme aplicável:

```text
UI → API/contrato → autenticação/autorização → persistência → reload
   → isolamento tenant → integração adjacente → erro explícito → testes
```

## 4. Arquitetura Atual

```text
React/Vite SPA
├── apiRequest → Express/JWT → Prisma → PostgreSQL
├── storage helper → Express → MinIO
├── imports Supabase → façade noop/legado
├── localStorage/estado React
└── integrações externas via API ou browser

Express
├── 26 famílias / 189 endpoints
├── JWT + política de permissões
├── módulos operacionais/financeiros
├── Stripe, SMTP, OCR/IA, clima e ORS
└── scheduler meteorológico dentro do processo HTTP
```

A arquitetura alvo própria existe parcialmente. O problema é a falta de uma fronteira única de tenant, domínio e migração entre os caminhos coexistentes.

## 5. Principais Problemas Sistêmicos

### 5.1 Arquitetura híbrida e falsa completude funcional

Há REST/Express/Prisma real e reutilizável. Também há 48 importadores Supabase, dos quais 45 participam de capacidades funcionais: 13 têm substituto REST total/parcial, 22 dependem de backend/domínio ausente, 3 existem apenas no legado e 7 são mistos/órfãos. A `noopSupabaseFacade` pode retornar `{data:null,error:null}` e bloquear rede, fazendo leitura parecer vazia e mutação parecer bem-sucedida.

O padrão aparece em pagamentos, reconciliação, documentos, dashboard, frota, marketplace, automação, IA, auditoria e consentimento. Orçamento/PDR acrescenta outro caminho: dados em `localStorage` e posterior serialização em `ProductionOrder.notes`. A consequência não é “todo o sistema é frontend”; é que uma mesma função pode ter UI completa, persistência parcial e integração diferente conforme a tela.

### 5.2 Causas-raiz dominantes

1. migração por arquivo/chamada, não por capacidade vertical;
2. tenant e objeto autorizados pelo parâmetro do cliente;
3. papéis de plataforma/workspace representados pelo mesmo estado;
4. aggregates fragmentados para identidade, cliente, WEEKLOG e financeiro;
5. persistência estruturada substituída por texto/JSON/localStorage;
6. efeitos derivados fora de uma unidade de trabalho/recuperação;
7. ausência de baseline/testes/gates reproduzíveis;
8. módulos visíveis sem backend correspondente ou decisão de portfólio.

## 6. Segurança e Multi-Tenancy

Os maiores achados confirmados são:

- registro público aceita/persiste `admin` e devolve sessão;
- alteração de membership também altera papel global;
- 16/20 domínios prioritários têm isolamento inadequado;
- documentos e MinIO aceitam ownership/bucket/path insuficientemente governados;
- JWT pode ficar em `localStorage` e query string;
- OCR/IA é público e clima possui ações de alto impacto sem papel suficiente;
- reconciliação automática opera globalmente;
- segredos foram entregues em texto puro e configuração/histórico exigem contenção.

Autenticação não equivale a autorização. Validar um bearer token prova identidade, não prova que aquele usuário pode ler/alterar o objeto indicado. A correção deve combinar `TenantContext` server-side, deny-by-default, autorização do objeto pai, repositories/use cases tenant-scoped, constraints compostas e plano de plataforma separado.

Existem controles positivos: bcrypt custo 12, reset curto vinculado ao hash vigente, releitura do usuário ativo, Helmet, allowlist CORS e verificação de assinatura Stripe. Eles reduzem risco, mas não corrigem os achados sistêmicos.

## 7. Persistência e Integração de Dados

O PostgreSQL/Prisma cobre parcela relevante do produto, mas o histórico de banco não é reproduzível por `migrate deploy`: uma migration incremental não cria as 44 tabelas. Vínculos financeiros e operacionais usam referências escalares/optional workspace e carecem de FKs/uniques capazes de impedir duplicidade e mistura tenant.

Também há fragmentação conceitual:

| Conceito | Representações atuais | Consequência |
|---|---|---|
| Identidade/acesso | `User`, `AppUser`, `Profile`, `Person` | IDs e lifecycle não canônicos |
| Cliente | `Client`, `BillingClient`, `Person(type=client)`/conta | operação e faturamento divergem |
| WEEKLOG | `ServiceOrder` + visão semanal/listas | semântica/referência ambígua |
| Empresa | `Workspace` + `CompanySetting` por usuário | branding/contexto incorreto |
| Documento | metadado Prisma + objeto MinIO + legado | ownership/lifecycle fragmentado |

## 8. Migração Supabase → Stack Própria

A migração recomendada segue o padrão Strangler Fig por fatia funcional, não um “big bang” horizontal. Cada fatia deve alinhar UI, API, autorização, modelo, migração de dados, integração, testes e retirada do legado. A façade noop deve primeiro deixar de produzir sucesso silencioso; só depois cada import é removido com aceite específico.

Fatia prioritária de reaproveitamento: PaymentOrder, documentos, receitas/dashboard, convites e telas financeiras que já possuem REST. Fatias sem backend (Frota, Marketplace, automação genérica, IA orquestrada, consentimento etc.) dependem de decisão de portfólio antes de qualquer porte.

## 9. Estado Funcional por Domínio

| Domínio | Estado sustentado | Reuso | Tratamento |
|---|---|---|---|
| Auth/workspace | REST/JWT/materialidade alta; autoridade insegura | alto | estabilizar e redesenhar papéis/tenant |
| Produção | UI/API/modelo existem; timeline quebrado; runtime mínimo pendente | alto | recuperar e testar |
| WEEKLOG/listas/pagamento | material, porém ambíguo, híbrido e não atômico | médio | redesenhar relações e migrar UI |
| Financeiro/reconciliação | amplo, mas global/frágil | médio | conter P0 antes de uso |
| Pessoas/locais | CRUD reaproveitável; tenant/modelo incompletos | médio-alto | estabilizar e estender |
| Documentos | MinIO/REST/file manager úteis; ownership/tela global incompletos | alto periférico | fechar vertical segura |
| Mapa/Radar | mapa único/toggles aproveitáveis; fontes aproximadas/híbridas | médio-alto | preservar shell, substituir dados |
| PDR/IA visual | não implementado como domínio | baixo no core | nova evolução após fundação |
| Frota/Marketplace/Automação/Copiloto | UI/legado sem backend equivalente suficiente | variável | decisão de portfólio |

## 10. Produção / WEEKLOG / Financeiro

A OP pode nascer por UI/REST e a entrega tenta gerar WEEKLOG. A validação de WEEKLOG tenta gerar PaymentOrder/lista. O problema é que cada efeito ocorre em etapas separadas e falhas são capturadas sem unidade de recuperação obrigatória. Repetição/concorrência pode duplicar derivados porque `findFirst`+`create` não é apoiado por constraints suficientes.

A reconciliação amplia o risco: pode apagar/recriar dados automáticos globalmente e criar ajuste/evento em passos distintos. A sequência recomendada é: validar B03/B06/B07/B05; estabelecer tenant/constraints; recuperar Produção; modelar WEEKLOG; fechar idempotência/pendência; só então consolidar reconciliação/ledger.

## 11. Pessoas / Clientes / Utilizadores

O target de Alex confirma que Colaboradores internos e Utilizadores externos não devem criar um ao outro automaticamente. Essa separação deve ser preservada. O que precisa mudar é a clareza dos aggregates e relações: cargo interno não é permissão; membership não é pessoa de RH; e cliente de operação/faturamento/relacionamento precisa de identidade canônica, sujeita à validação B01.

O cadastro interno ganhará catálogo extensível, identificação, contato, dados bancários protegidos e documentos. A rede externa conservará papéis próprios. Lifecycle de convite/desligamento deve revogar ações futuras sem apagar autoria/histórico.

## 12. Documentos / Storage

MinIO e REST são bases preserváveis. A fragilidade está no ownership: workspace opcional, bucket/path controlados pelo cliente, JWT em URL, MIME/tamanho confiados e compensação incompleta entre objeto e metadado. Antes de compor a pasta por colaborador, é necessário modelar tenant→entidade→objeto, URL curta/autorizada, hash, classificação, retenção e auditoria.

“Documentos por País” deve ser preservado e não remodelado neste ciclo. Isso não autoriza acesso global inseguro nem outro mecanismo de storage.

## 13. Locais / Mapa / Radar

`Location` já possui CRUD e boa parte dos campos, mas precisa ser tenant-scoped e ganhar lifecycle/GPS/gerente canônico. O mapa único e seus toggles devem ser preservados. As fontes atuais de Operações/Ordens usam cidades tabeladas e jitter, e Equipes depende de telemetria parcialmente migrada; portanto os marcadores não são fonte operacional de produção.

O target exige vazio explícito na ausência de dados e proíbe marcadores inventados. Locations reais, equipes autorizadas e ordens canônicas devem alimentar projeções tenant-scoped no mesmo mapa. Weather/ORS precisam de gateway, quotas, fallback identificável e scheduler independente.

## 14. PDR / IA

Ficha por peça, dano estruturado, foto por peça, estimativa visual e validação humana são novas capacidades. OCR documental existente e cliente Gemini/OpenAI são infraestrutura reaproveitável, não implementação de PDR.

O domínio deve anteceder a IA: ficha/versão, peça, dano, evidência, aprovação, total e preço. IA somente propõe; a decisão humana aceita/corrige/rejeita com proveniência, avaliação, quota, retenção e trilha. B04 e B05 bloqueiam o desenho definitivo.

## 15. Infraestrutura / Deploy / Observabilidade

Postgres, MinIO, API e frontend podem ser reproduzidos por comandos locais; a sessão manual recente confirmou inicialização parcial. Ainda não existe laboratório padronizado A/B nem compose portátil: contextos absolutos, exemplos divergentes, baseline insuficiente e lockfile frontend fora de sincronia impedem uma reprodução limpa de checkout.

### Dívida de observabilidade

Há 27 probes para `127.0.0.1:7777`, console ruidoso, logs sem correlação/política única, telemetria/replay e health que prova DB mas não storage. Ruído por si só é dívida operacional, não vulnerabilidade crítica.

### Risco de segurança em logs

O risco surge se logs/replay contiverem bearer tokens, URLs assinadas, IDs correlacionáveis, payloads documentais, dados pessoais ou respostas brutas de provedor. O sistema precisa de redaction central, classificação de campos, audit log separado, opt-in por ambiente, SLOs e readiness por dependência.

## 16. Dívida Técnica

Os 28 itens D1–D7 se concentram em: handlers monolíticos; aggregates fragmentados; autorização e sessão; arquivos de 1,6k–4,5k linhas e uso amplo de `any`; baixa cobertura; compose/scheduler; e coexistência Supabase/Prisma. Refatoração só deve acompanhar a fatia de negócio em execução. Uma limpeza horizontal de arquivos ou uma reescrita estética aumentaria risco sem fechar persistência/tenant.

## 17. Current State × Target State

Dos 53 CTS: 4 não têm gap material, 2 são bug/restauração, 6 migração incompleta, 5 implementação parcial, 8 não implementadas, 14 exigem redesenho, 3 decisão de negócio e 11 validação runtime. Reutilização foi classificada como alta em 19, média em 22, baixa em 11 e indeterminada em 1.

Conclusão: há base significativa para recuperar, mas 31 requisitos têm impacto estrutural. Prioridade visual 01–10 do cliente deve ser preservada como prioridade de produto; a sequência técnica precisa respeitar as fundações.

## 18. Backlog de Estabilização

O Backlog A contém 29 itens nos grupos:

- A0 Segurança crítica — 6;
- A1 Banco/infraestrutura — 5;
- A2 Migração Supabase — 3;
- A3 Identidade/dados — 4;
- A4 Operação — 6;
- A5 Documentos/storage — 2;
- A6 Locais/mapa — 3.

Cada item possui estado, evidência, causa raiz, impacto, correção, target, aceite, dependências, prioridade, esforço e confiança no [roadmap canônico](stabilization-and-evolution-roadmap.md).

## 19. Roadmap de Evolução

O Backlog B contém 11 itens: multiempresa/estado sem empresa; Colaboradores; Utilizadores/rede externa; Local operacional; quatro itens PDR/IA/preço; dois itens white-label/multilíngue; e uma decisão de portfólio. Novas features não são usadas para mascarar bugs atuais.

## 20. Priorização P0/P1/P2/P3

| Prioridade | Total | Interpretação |
|---|---:|---|
| P0 | 10 | confiança/segurança sistêmica, tenant, baseline/testes, fluxo financeiro e storage |
| P1 | 19 | core confiável, migração funcional e integrações operacionais |
| P2 | 10 | evolução e estabilização não bloqueante |
| P3 | 1 | decisão de portfólio, sem compromisso de implementação |

P0 não significa “código feio”; significa risco grave ou bloqueio de uso seguro. PDR/IA é grande, mas permanece P2 até as fundações porque é evolução, não falha de segurança atual.

## 21. Dependências e Sequência Recomendada

```text
FOUNDATION 0  Segurança + TenantContext + banco + testes + ownership
      ↓
FOUNDATION 1  Identidade + Company/Workspace + dados canônicos
      ↓
VERTICAL 1    Produção
      ↓
VERTICAL 2    WEEKLOG + Financeiro
      ↓
VERTICAL 3    Colaboradores / Utilizadores / Clientes
      ↓
VERTICAL 4    Documentos
      ↓
VERTICAL 5    Locais / Mapa / Radar
      ↓
EVOLUTION 1   PDR / IA / preço
      ↓
EVOLUTION 2   White-label / multilíngue

PORTFOLIO     Frota/Marketplace/Automação/Copiloto somente após decisão
```

Verticais 3 e 4 podem avançar em paralelo depois das fundações quando não disputarem migrations/ownership. A ordem exata de UI do cliente pode ser intercalada, desde que nenhum gate seja contornado.

## 22. Itens Preserváveis

Principais ativos reaproveitáveis:

1. design system, shell, rotas e grande parte das telas React;
2. API Express e cliente REST central;
3. schema Prisma como mapa atual, após baseline/migração;
4. login/bcrypt/reset e partes do middleware JWT;
5. Workspace/Membership, onboarding e switcher como ponto de partida;
6. UI/REST/modelo de ProductionOrder e board;
7. MinIO, helper REST e `EmbeddedFileManager` após ownership;
8. assinatura do webhook Stripe e fluxos checkout/portal;
9. SMTP, OCR/IA, clima e ORS como gateways a endurecer;
10. mapa único, toggles/layers e i18n/PDF como infraestrutura de apresentação.

Preservar não significa aceitar vulnerabilidades, falso sucesso ou semântica incorreta.

## 23. Itens que Exigem Redesenho

Exigem redesenho material: autoridade global/workspace, `TenantContext`, Company/Workspace/settings, cliente canônico, identidade IAM/RH, WEEKLOG, reconciliação/ledger, ownership documental, Location operacional e fontes do mapa, PDR/versionamento/IA e branding por empresa. O roadmap identifica 18 itens com redesenho estrutural material, 12 com migração material e 17 com validação runtime residual; classificações e IDs estão explicitados e podem se sobrepor.

## 24. Decisões Pendentes

### Decisões que impedem implementação definitiva

1. B02 — acesso/histórico após desligamento;
2. B03 — falha OP→WEEKLOG/lista: pendência, reversão ou outra regra;
3. B04 — versão/alteração após aprovação PDR;
4. B05 — congelamento e reabertura do valor do técnico;
5. B07 — quem valida/desfaz/reabre reconciliação e qual processo é canônico;
6. B08 — poderes da Operix sobre tenants.

### Premissas evergreen a validar, não respostas de Alex

- B01 cliente conceitualmente único/interligado;
- B06 WEEKLOG como consolidação semanal;
- B09 retenção documental mínima de 180 dias;
- B13 gerente de Local como Colaborador;
- partes conhecidas de B04/B05/B07/B08 sobre atores e interligação.

B10 (convites) e B11 (SLA fora do mapa) podem ser refinidas durante implementação; B12 foi respondida: não há criação automática Colaborador↔Utilizador. P02 continua decisão de portfólio.

## 25. Validações Runtime Residuais

A ausência da 4B integral não invalida o diagnóstico:

- **confirmado estaticamente**: autorregistro, acoplamento de papéis, ausência de tenant/ownership/constraints, façade noop, endpoints ausentes, timeline desabilitado, dados sintéticos do mapa e scheduler no processo;
- **observado manualmente**: acesso visual geral, interações aparentes, ruído de console e persistência/integrações heterogêneas, sem generalização por módulo;
- **depende de runtime**: create/reload/estados de OP, troca A/B, persistência cadastral, toggles/mapa, concorrência/idempotência, Stripe/SMTP/IA/clima/ORS;
- **permanece estrutural independentemente do runtime**: autoridade, tenant, baseline, ownership, clientes/identidade/WEEKLOG e migração vertical.

Executar no início da implementação: MV4B-01, MV4B-02 e MV4B-03. MV4B-04 é recomendado se houver laboratório. Não é necessário executar automaticamente todos os 74 casos; selecionar os demais conforme a fatia alterada.

Nunca executar em produção: BOLA/IDOR, autorregistro privilegiado, falhas induzidas, concorrência/replay, rebuild/delete financeiro, leitura/delete de paths alheios, payloads malformados/limites, Stripe live, SMTP real, IA com documentos reais, múltiplas réplicas de scheduler para provocação, `prisma db push`, reset/truncate ou rotação não coordenada.

## 26. Conclusão e Próximos Passos

### Top 10 problemas atuais

1. Autorregistro público de admin.
2. Papel local altera autoridade global/plataforma.
3. Ausência de TenantContext/autorização por objeto.
4. Reconciliação/financeiro global e relações frágeis.
5. Documentos/MinIO sem ownership uniforme e JWT em URL.
6. `noopSupabaseFacade` e caminhos híbridos gerando falso sucesso.
7. Baseline Prisma/seed/compose não reproduzíveis de forma limpa.
8. OP→WEEKLOG→PaymentOrder não atômico/idempotente.
9. Identidades de cliente/pessoa/utilizador fragmentadas.
10. Testes/observabilidade insuficientes e scheduler acoplado à API.

### Top 10 ações recomendadas

1. Fechar cadastro privilegiado e definir bootstrap.
2. Separar plano de plataforma dos papéis de workspace.
3. Implementar TenantContext e autorização por objeto deny-by-default.
4. Criar baseline Prisma, dataset A/B e CI de migrations/tenant.
5. Conter secrets e planejar rotação pós-handover.
6. Implementar ownership documental/storage e retirar token de URLs.
7. Tornar façade noop falha explícita e migrar por fatias.
8. Executar os três cenários MV4B obrigatórios.
9. Recuperar Produção e tornar OP→WEEKLOG→pagamento recuperável/idempotente.
10. Consolidar identidade/cliente/WEEKLOG antes de PDR/IA e mapa operacional.

### Recuperar versus reescrever

**Recomendação: recuperar e redesenhar seletivamente, não reescrever integralmente.** A UI, API, modelos e integrações existentes representam investimento reaproveitável. Uma reescrita descartaria conhecimento e repetiria risco de requisitos; patches pontuais manteriam as causas-raiz. A estratégia correta é fundação forte e migração vertical, retirando legado somente quando cada capacidade estiver comprovada.

### Estado final

O diagnóstico está **CONCLUÍDO COM VALIDAÇÕES RUNTIME RESIDUAIS**. A implementação pode ser planejada no nível de clusters e prioridades; estimativa comercial/cronograma definitivo deve aguardar as seis decisões, quatro premissas aplicáveis e os três cenários runtime mínimos.
