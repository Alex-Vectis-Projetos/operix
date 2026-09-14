# Fase 5C — Consolidação do Target State do Cliente

**Projeto**: Operix / QW Nexus  
**Data**: 2026-09-05  
**Fonte primária**: `docs/Relatorio_Plano_de_Ataque_QW_Nexus.pdf` (Alex, 14 páginas)  
**Escopo**: consolidação documental; sem execução 4B/5B, sem Fase 6 e sem alteração de produto

## 1. Regra de fonte de verdade e método

Este documento mantém duas trilhas separadas:

- **CURRENT STATE**: somente o que o código e as auditorias das Fases 1–5A demonstram. Código não executado continua `NÃO TESTADO` ou `REQUER RUNTIME`.
- **TARGET STATE**: intenção, prioridade e critérios expressos pelo cliente. Afirmações do PDF como “funciona”, “existente” ou “indisponível” não comprovam comportamento técnico.

O PDF foi lido integralmente e suas 14 páginas foram renderizadas para conferência de tabelas, diagramas e referências visuais. As capturas das páginas 3 e 11–14 foram usadas apenas para localizar a UI apresentada; elas não são especificação visual final nem evidência de funcionamento.

Foram extraídos **53 requisitos**: **7 correções/restaurações**, **18 evoluções**, **14 redesenhos**, **13 itens a preservar/não alterar** e **1 requisito que exige confirmação**.

## 2. Classificações e gates técnicos

### 2.1 Classificação do target

- **CORREÇÃO / RESTAURAÇÃO**: capacidade apresentada como existente/esperada e atualmente indisponível ou estaticamente quebrada.
- **EVOLUÇÃO**: comportamento novo que estende o produto.
- **REDESENHO**: target incompatível com a semântica/modelagem atual.
- **PRESERVAR / NÃO ALTERAR**: restrição explícita do cliente; não comprova que a implementação atual funcione.
- **REQUER CONFIRMAÇÃO**: a intenção não define suficientemente ator, alcance ou regra.

### 2.2 Tipos do confronto preliminar

`BUG EXISTENTE`, `MIGRAÇÃO INCOMPLETA`, `PROBLEMA DE MODELAGEM`, `NOVA FEATURE`, `REDESENHO`, `SEM GAP RELEVANTE` e `REQUER RUNTIME` são usados apenas para preparar a Fase 6; não constituem execução dessa fase.

### 2.3 Gates estruturais derivados da Fase 5A

| Gate | Dependência técnica |
|---|---|
| G1 | corrigir autorregistro/bootstrap administrativo |
| G2 | separar papel global de plataforma do papel do workspace |
| G3 | estabelecer `TenantContext` server-side e autorização por objeto |
| G4 | criar baseline Prisma/migrations e ambiente reproduzível |
| G5 | definir ownership, tenant e ciclo de vida de documentos/storage |
| G6 | concluir a fatia Supabase correspondente, eliminando noop/falso sucesso |
| G7 | criar testes backend/contrato/tenant como gate de regressão |
| G8 | obter decisão de domínio/modelagem ainda aberta |
| G9 | comprovar comportamento na 4B sanitizada antes de chamar algo de funcional/quebrado em runtime |

## 3. Requisitos consolidados

### 3.1 Produção

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-001 | Produção | Restaurar “Nova Ordem de Produção” | clicar, preencher, salvar e visualizar a OP | 01 | PDF p.2, p.10 | botão e diálogo existem em `ProductionPage.tsx`; runtime não executado | CORREÇÃO / RESTAURAÇÃO | REQUER RUNTIME | G3,G4,G7,G9 |
| CTS-002 | Produção | OP pode nascer diretamente em produção | criar OP sem orçamento prévio, iniciando em “Em Produção” | 01 | PDF p.2 | `BLANK.status="in_production"` e POST REST existem; fluxo não executado | CORREÇÃO / RESTAURAÇÃO | REQUER RUNTIME | G3,G4,G7,G9 |
| CTS-003 | Produção | Preservar Orçamento→Produção | aprovar orçamento continua criando/abrindo a OP sem regressão | 02 | PDF p.2, p.10 | fluxo existe, mas orçamento vive em `localStorage`/`notes` | PRESERVAR / NÃO ALTERAR | MIGRAÇÃO INCOMPLETA | G3,G4,G6,G7,G8,G9 |
| CTS-004 | Produção | Preservar ciclo Em Produção→Pausado→Finalizado | estados mudam, persistem e aparecem no quadro | 01 | PDF p.2 | statuses, board e PATCH existem estaticamente | PRESERVAR / NÃO ALTERAR | REQUER RUNTIME | G3,G7,G9 |
| CTS-005 | Produção | Manter log/histórico operacional | cada alteração relevante reaparece cronologicamente | 01 | PDF p.2 | `OrderTimeline` existe, mas `useProductionTimeline` está `enabled:false` e retorna vazio | CORREÇÃO / RESTAURAÇÃO | BUG EXISTENTE | G3,G4,G7 |

### 3.2 Empresas ativas e workspaces

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-006 | Empresas | Administrativo cria várias empresas | o ator autorizado cria mais de uma empresa | 03 | PDF p.4 | owner pode possuir vários `Workspace`, mas não há entidade `Company`; “administrativo” é ambíguo | REQUER CONFIRMAÇÃO | PROBLEMA DE MODELAGEM | G1,G2,G3,G4,G7,G8 |
| CTS-007 | Empresas | Cada empresa gera workspace próprio | conclusão do cadastro cria exatamente um workspace isolado | 03 | PDF p.4, p.10 | onboarding cria `Workspace` e billing profile; empresa não é aggregate próprio | REDESENHO | PROBLEMA DE MODELAGEM | G2,G3,G4,G7,G8 |
| CTS-008 | Empresas | Isolamento total de contexto | alternar empresa nunca mistura dados, permissões ou branding | 03/10 | PDF p.4, p.10 | 16/20 domínios falharam na matriz estática de isolamento | REDESENHO | REDESENHO | G1,G2,G3,G4,G7 |
| CTS-009 | Empresas | Seletor de empresa ativa | seletor acima do Painel alterna o contexto sem recarregar | 03 | PDF p.4 | `WorkspaceSwitcher` já alterna memberships no TopBar; sem semântica `Company` e em posição diferente | REDESENHO | REDESENHO | G2,G3,G4,G7,G8,G9 |
| CTS-010 | Empresas | Nome e logotipo dinâmicos | header reflete sempre a empresa ativa | 03 | PDF p.4 | branding existe, mas `CompanySetting` é único por `userId`, não por workspace | REDESENHO | PROBLEMA DE MODELAGEM | G3,G4,G5,G7,G8 |
| CTS-011 | Perfil | Separar perfil pessoal de empresa | dados pessoais permanecem no perfil; dados empresariais pertencem à empresa ativa | 03 | PDF p.4 | dados empresariais usam `/settings/company` e modelo por usuário; conceitos permanecem misturados | REDESENHO | PROBLEMA DE MODELAGEM | G2,G3,G4,G7,G8 |
| CTS-012 | Navegação | Sem empresa: somente Perfil + Painel/Radar | conta sem workspace não vê conteúdo operacional inexistente | 04 | PDF p.4, p.10 | sidebar filtra por permissão, não por existência de workspace | EVOLUÇÃO | NOVA FEATURE | G1,G2,G3,G7 |
| CTS-013 | Navegação | Módulos operacionais só após empresa/workspace | menus listados aparecem apenas com contexto válido | 04 | PDF p.4 | `useWorkspaceModules` trata workspaces como totalmente habilitados e a sidebar não faz esse gate | EVOLUÇÃO | NOVA FEATURE | G2,G3,G7 |
| CTS-014 | Perfil/Empresa | “Criar empresa” dentro do Perfil | concluir cadastro empresarial cria workspace e passa a usá-lo | 03 | PDF p.4 | criação existe apenas no onboarding; Settings atual não expõe esse fluxo e não há `Company` | REDESENHO | REDESENHO | G1,G2,G3,G4,G7,G8 |

### 3.3 Colaboradores internos

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-015 | Colaboradores | Renomear Pessoas/Nova Pessoa | UI usa “Colaboradores” e “Novo colaborador” | 05 | PDF p.5, p.10 | página usa “Pessoas” e “Nova Pessoa” | EVOLUÇÃO | NOVA FEATURE | G7 |
| CTS-016 | Colaboradores | `Person` passa a representar pessoal interno | cadastros internos não incluem prestador externo ou cliente | 05 | PDF p.5–6 | `Person.type` atual inclui administrativo, técnico e dois tipos de prestador; auditoria também encontrou cliente em modelos concorrentes | REDESENHO | REDESENHO | G2,G3,G4,G7,G8 |
| CTS-017 | Colaboradores | Identificação completa | nome próprio/família, nome completo e foto opcional persistem | 05 | PDF p.5 | `Person` tem `fullName`; nomes separados e foto não são parte clara do modelo `Person` | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G3,G4,G5,G7 |
| CTS-018 | Colaboradores | Catálogo extensível de cargos internos | famílias Direção/Gerência/Chefia/Admin/RH/Financeiro/etc. podem crescer sem reutilizar tipos externos | 05 | PDF p.5 | `Person.role/department` são strings; UI usa quatro tipos operacionais como classificação | REDESENHO | REDESENHO | G3,G4,G7,G8 |
| CTS-019 | Colaboradores | Endereço e contato | endereço, telefone/WhatsApp e e-mail são editáveis e persistentes | 05 | PDF p.5 | `Person` possui address/email/phone, com estrutura parcial | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G3,G4,G7 |
| CTS-020 | Colaboradores | Dados bancários | RIB/IBAN, conta, banco e SWIFT pertencem ao colaborador | 05 | PDF p.5 | não há estrutura bancária explícita em `Person`; `fiscalData` genérico não substitui contrato | EVOLUÇÃO | NOVA FEATURE | G3,G4,G7,G8 |
| CTS-021 | Colaboradores | Documentos pessoais | documentos enviados ficam organizados na pasta do colaborador | 05/06 | PDF p.5, p.7, p.10 | endpoints de documentos de pessoa e MinIO existem, mas ownership/lifecycle é incompleto | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G3,G4,G5,G6,G7 |
| CTS-022 | Colaboradores | Preservar conceito de status | status do colaborador permanece visível e editável | 05 | PDF p.5 | `Person.status` e filtro ativo/inativo existem | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G3,G7,G9 |

### 3.4 Utilizadores externos

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-023 | Utilizadores | Rede externa separada de Colaboradores | módulo representa técnicos/prestadores externos e clientes | 07 | PDF p.6, p.10 | login/membership é distinto de Person, mas Person ainda mistura tipos externos e “cliente” tem três modelos | REDESENHO | REDESENHO | G2,G3,G4,G7,G8 |
| CTS-024 | Identidade | Colaborador não cria Utilizador automaticamente | salvar colaborador não cria credencial/membership | 07 | PDF p.6 | comportamento atual já não cria usuário automaticamente | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G7,G9 |
| CTS-025 | Identidade | Utilizador não cria Colaborador automaticamente | criar cliente/técnico externo não cria `Person` interno | 07 | PDF p.6 | comportamento atual já não cria Person automaticamente | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G7,G9 |
| CTS-026 | Utilizadores | Funções externas não compartilham cargos internos | Admin/Associado/Técnico/Cliente permanecem em vocabulário próprio | 07 | PDF p.6 | papéis de membership existem, mas papel global/local é acoplado e People ainda usa tipos sobrepostos | REDESENHO | REDESENHO | G1,G2,G3,G4,G7,G8 |
| CTS-027 | Utilizadores | Preservar temporariamente acesso/vínculo existente | fluxo atual continua disponível até tarefa específica, sem regressão funcional | 07 | PDF p.6 | REST de members existe, porém não foi executado e contém escalada local→global; preservação não inclui vulnerabilidades | PRESERVAR / NÃO ALTERAR | REQUER RUNTIME | G1,G2,G3,G7,G9 |

### 3.5 Documentos

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-028 | Documentos por país | Preservar lógica conceitual | selecionar país, listar e editar requisitos continua possível | restrição | PDF p.7 | modelo/rotas existem; runtime não validado | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G7,G9 |
| CTS-029 | Documentos por país | Não remodelar nem apagar neste ciclo | configuração existente permanece intacta | restrição | PDF p.7, p.10 | catálogo é global e DELETE retorna 405; nenhuma alteração autorizada | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | — |
| CTS-030 | Documentos do colaborador | Ação de pasta ao lado de editar/excluir | pasta abre e lista documentos daquela pessoa | 06 | PDF p.7, p.10 | People lista não possui botão de pasta; há componentes/endpoints reutilizáveis | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G3,G5,G6,G7 |
| CTS-031 | Documentos | Reutilizar mecanismo existente | não criar storage/file-manager paralelo | restrição/06 | PDF p.7 | `EmbeddedFileManager` REST existe; tela global ainda usa Supabase noop e ownership é fraco | PRESERVAR / NÃO ALTERAR | MIGRAÇÃO INCOMPLETA | G3,G5,G6,G7 |

### 3.6 Locais

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-032 | Locais | Entidade operacional de filial/unidade/atuação | cada local é ficha real, tenant-scoped e reutilizável | 08 | PDF p.8, p.10 | `Location` existe, mas workspace é opcional/confiado ao cliente e não há vínculo operacional com mapa | REDESENHO | REDESENHO | G2,G3,G4,G7,G8 |
| CTS-033 | Locais | Endereço e contatos do local | todos os campos mínimos persistem e reaparecem | 08 | PDF p.8 | modelo/form já possuem endereço, telefone e e-mail | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G3,G7,G9 |
| CTS-034 | Locais | Gerente responsável | nome, telefone e e-mail persistem | 08 | PDF p.8 | campos e formulário existem | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G3,G7,G9 |
| CTS-035 | Locais | Status Ativo/Pausado/Encerrado | os três estados são selecionáveis, persistentes e filtráveis | 08 | PDF p.8 | modelo/UI usam apenas `active/inactive` | EVOLUÇÃO | NOVA FEATURE | G3,G4,G7,G8 |
| CTS-036 | Locais | GPS e link Maps/Waze | salvar ponto exato e/ou link navegável | 08 | PDF p.8 | `Location` não possui latitude/longitude/link | EVOLUÇÃO | NOVA FEATURE | G3,G4,G7,G8 |
| CTS-037 | Locais | Local não desaparece após salvar | criar, recarregar e reencontrar na listagem | 08 | PDF p.8, p.14 | CRUD REST existe; alegação de desaparecimento não foi reproduzida | CORREÇÃO / RESTAURAÇÃO | REQUER RUNTIME | G3,G4,G7,G9 |
| CTS-038 | Locais/Mapa | Local alimenta Operações e Equipes | local ativo com GPS aparece no mesmo mapa | 08/09 | PDF p.8–9 | `OperationalMap` não consulta Location; operações são inferidas de ServiceOrder | REDESENHO | REDESENHO | G3,G4,G6,G7,G8 |

### 3.7 Painel e mapa único

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---:|---|---|---|---|---|
| CTS-039 | Mapa | Manter um único mapa | Radar e camadas operacionais compartilham a mesma instância; nenhum segundo mapa | restrição/09 | PDF p.8–10 | `OperationalMap` já concentra as camadas | PRESERVAR / NÃO ALTERAR | SEM GAP RELEVANTE | G7,G9 |
| CTS-040 | Radar | Preservar Radar como função independente | radar pode ser ligado/desligado sem depender de Operações | 09 | PDF p.9 | layer/toggle existe; provedores e runtime não validados | PRESERVAR / NÃO ALTERAR | REQUER RUNTIME | G7,G9 |
| CTS-041 | Mapa/Operações | Operações mostra locais ativos | pontos usam GPS real do cadastro de Location | 09 | PDF p.8–9 | camada existe, mas deriva ServiceOrder por cidade, tabela hardcoded e jitter | REDESENHO | REDESENHO | G3,G4,G6,G7,G8 |
| CTS-042 | Mapa/Equipes | Equipes mostra equipes relacionadas | equipes reais aparecem somente quando existirem | 09 | PDF p.8–9 | layer existe sobre backend events de geolocalização, sem tenant robusto e sem runtime | CORREÇÃO / RESTAURAÇÃO | REQUER RUNTIME | G2,G3,G6,G7,G9 |
| CTS-043 | Mapa/Ordens | Ordens mostra ordens relacionadas | ordens reais da empresa ativa aparecem na camada | 09 | PDF p.9 | layer existe sobre ServiceOrder global e geolocalização aproximada | CORREÇÃO / RESTAURAÇÃO | MIGRAÇÃO INCOMPLETA | G2,G3,G4,G6,G7,G9 |
| CTS-044 | Mapa | Toggles refletem imediatamente | cada botão é validado em todos os estados e não abre outro mapa | 09/10 | PDF p.9–10 | state e `setLayoutProperty` existem; comportamento WebGL/provedor requer runtime | CORREÇÃO / RESTAURAÇÃO | REQUER RUNTIME | G7,G9 |
| CTS-045 | Mapa | Não inventar dados operacionais | ausência de backend produz vazio explícito, nunca marcadores sintéticos | restrição | PDF p.9–10 | ordens são posicionadas por `CITY_COORDS`, inferência textual e jitter determinístico | REDESENHO | REDESENHO | G3,G4,G6,G7,G8 |

### 3.8 Target previamente registrado: PDR, IA, preço e documentos

Estes requisitos continuam válidos como target anterior, mas **não foram priorizados nem detalhados no novo PDF**.

| ID | Domínio | Descrição | Comportamento esperado e critério de aceite | Client priority | Fonte | Current State conhecido | Classificação | Diferença / tipo | Technical dependency |
|---|---|---|---|---|---|---|---|---|---|
| CTS-046 | PDR | Ficha visual por peça | selecionar peça e registrar danos estruturados | não indicada | `spec.md` §2.4 | não localizada no modelo/backend | EVOLUÇÃO | NOVA FEATURE | G3,G4,G5,G7,G8 |
| CTS-047 | PDR/Fotos | Fotos por peça | cada foto referencia peça/dano e tenant | não indicada | `spec.md` §2.4 | `ProductionPhoto` não referencia peça PDR | EVOLUÇÃO | NOVA FEATURE | G3,G4,G5,G7,G8 |
| CTS-048 | IA/PDR | Estimativa IA de danos | IA propõe contagem/severidade com evidência rastreável | não indicada | `spec.md` §2.4 | OCR documental existe; estimativa visual PDR não localizada | EVOLUÇÃO | NOVA FEATURE | G3,G4,G5,G7,G8 |
| CTS-049 | IA/PDR | Validação humana | proposta da IA só se torna decisão após aceitar/corrigir/rejeitar | não indicada | briefing Fase 5C | workflow de validação não localizado | EVOLUÇÃO | NOVA FEATURE | G2,G3,G4,G7,G8 |
| CTS-050 | PDR | Consolidação total de danos | totais por peça e veículo derivam dos danos aprovados | não indicada | `spec.md` §2.4 | cálculo atual é local e sem entidade de dano | EVOLUÇÃO | NOVA FEATURE | G3,G4,G7,G8 |
| CTS-051 | Preço | Preço/forfait manual | usuário autorizado define valor manual com trilha | não indicada | `spec.md` §2.4 | preço/cálculo existe em estado local e `notes` | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G2,G3,G4,G7,G8 |
| CTS-052 | White-label | Documentos por marca do workspace | logo/nome/template pertencem à empresa ativa | não indicada | `spec.md` §2.4 | branding/invoice template é `CompanySetting` por usuário | EVOLUÇÃO | REDESENHO | G3,G4,G5,G7,G8 |
| CTS-053 | Multilíngue | Documentos PT/EN/FR/DE/ES/IT | gerar documento no idioma escolhido sem alterar fatos/valores | não indicada | `spec.md` §2.4 | i18n de UI existe; pipeline documental multilíngue não foi demonstrado | EVOLUÇÃO | MIGRAÇÃO INCOMPLETA | G3,G4,G5,G7,G8 |

## 4. Current State × Target State preliminar

| Bloco | CURRENT STATE | TARGET STATE | Diferença predominante | Tipo predominante |
|---|---|---|---|---|
| Produção | botão, diálogo, REST e estados existem; timeline retorna vazio; nada executado | criação direta e por orçamento, ciclo e log confiáveis | restaurar/validar sem apagar o fluxo local de orçamento | BUG EXISTENTE + REQUER RUNTIME |
| Empresas/workspaces | Workspace/membership e switcher existem; empresa/configuração é por usuário; isolamento falha | Company separada, 1:1 com workspace, seletor e branding ativo | aggregate e fronteira tenant precisam mudar | PROBLEMA DE MODELAGEM + REDESENHO |
| Colaboradores | Person mistura internos, técnicos e prestadores; alguns dados são genéricos | cadastro interno com cargo extensível, dados completos e documentos | semântica e modelo incompatíveis | REDESENHO |
| Utilizadores | conta/membership distinta, sem auto-criar Person; papéis local/global acoplados | rede externa separada; nenhuma sincronização automática | preservar separação, redesenhar autoridade | REDESENHO |
| Documentos | catálogo por país existe; file manager REST parcial; tela global no noop | preservar catálogo e reutilizar mecanismo por colaborador | religação + ownership, sem novo mecanismo | MIGRAÇÃO INCOMPLETA |
| Locais | CRUD e maioria dos campos existem; sem GPS, 2 status, tenant fraco | entidade operacional persistente com 3 status e geolocalização | extensão + tenant + integração | REDESENHO/NOVA FEATURE |
| Mapa | um mapa e toggles existem; dados operacionais são globais/aproximados | um mapa com camadas reais de Location/equipe/ordem | trocar fonte aproximada por domínio real e validar runtime | REDESENHO + REQUER RUNTIME |
| PDR/IA/documentos | orçamento local; sem peças/danos/IA visual; branding por usuário | domínio PDR, validação humana, forfait e saída white-label/multilíngue | capacidade nova sobre fundação ainda insegura | NOVA FEATURE + REDESENHO |

## 5. Prioridade do cliente × dependência técnica

### 5.1 CLIENT PRIORITY — sequência indicada por Alex

| Ordem | Bloco | Aceite indicado |
|---:|---|---|
| 01 | Restaurar Nova Ordem de Produção | abrir→preencher→salvar→visualizar→mudar estado→confirmar log |
| 02 | Validar produção existente | Orçamento→Produção permanece intacto |
| 03 | Empresas ativas/workspaces | criar empresa→workspace→branding→alternar |
| 04 | Acesso inicial sem empresa | apenas Perfil/Painel/Radar; sem menus operacionais |
| 05 | Colaboradores | nomenclatura, cadastro interno e catálogo de cargos |
| 06 | Documentos do colaborador | pasta por pessoa sem alterar Documentos por País |
| 07 | Separação de Utilizadores | externos permanecem fora de Colaboradores |
| 08 | Locais | cadastro persistente com responsável, status e GPS/link |
| 09 | Mapa operacional | Operações/Equipes/Ordens no mapa existente |
| 10 | Validação final | permissões, isolamento, persistência, realtime e regressão |

### 5.2 TECHNICAL DEPENDENCY — ordem evidenciada pela auditoria

Esta não substitui a prioridade do cliente e ainda não é o roadmap da Fase 7:

1. G1/G2 — fechar autorregistro privilegiado e separar autoridade de plataforma/workspace;
2. G3 — tornar tenant/autorização de objeto uma invariante de servidor;
3. G4 — estabelecer baseline Prisma e laboratório reproduzível;
4. G7 — criar regressão backend/contrato/tenant para preservar o que existe;
5. G8 — decidir aggregates `Company`, identidade externa/interna, cliente e Location;
6. G5 — tornar documento/objeto pertencente a tenant e entidade;
7. G6 — retirar noop e concluir migrações por fatia vertical;
8. G9 — comprovar restaurações e toggles na 4B antes de iniciar evolução.

**Resultado**: os **40 requisitos que implicam correção, evolução, redesenho ou confirmação** dependem de pelo menos um gate P0/estrutural. Os 13 itens “preservar/não alterar” são restrições de mudança; vários ainda dependem de G9 para provar que o comportamento preservado realmente funciona.

## 6. Contradições, substituições e limites

| ID | Evidência anterior | Nova fonte | Tratamento |
|---|---|---|---|
| CON-01 | `spec.md` previa “vínculo opcional de acesso” a partir do colaborador e o plano mencionava sincronização | PDF p.6 proíbe comunicação/criação **automática** nos dois sentidos | hipótese de sincronização automática é substituída; vínculo manual futuro continua aberto |
| CON-02 | auditorias chamavam ausência de sincronização Person↔User de gargalo | Alex define entidades com finalidades diferentes | ausência de auto-sync deixa de ser gap; fragmentação técnica e IDs sem relação ainda são dívida |
| CON-03 | `Person` atual inclui técnico/prestadores e documentação antiga o tratava amplamente | Colaboradores deve representar somente pessoal interno; externos vão para Utilizadores | target exige redesenho semântico/modelagem |
| CON-04 | comentários do código falam em arquitetura “single-workspace” enquanto o hook lista vários workspaces | cliente exige várias empresas/workspaces por administrativo | nova fonte confirma multiempresa como target; current continua híbrido |
| CON-05 | PDF chama Nova Ordem indisponível e cita log “existente” | código contém botão/POST/status, mas timeline está desabilitado | indisponibilidade requer 4B; timeline é bug estático |
| CON-06 | PDF pede preservar produção, realtime, radar e módulos que “já funcionam” | inventário encontrou 0 funcionalidades classificadas FUNCIONAL e realtime legado inativo | registrar como intenção de não regressão, nunca como comprovação técnica |
| CON-07 | empresa hoje é `CompanySetting` único por usuário | target exige dados/branding por empresa/workspace ativo | redesenho de ownership, não simples mudança de tela |
| CON-08 | mapa já possui Operações/Equipes/Ordens | target exige dados reais de Location e proíbe dados fictícios | manter mapa único, substituir fontes aproximadas e validar toggles |
| CON-09 | novo PDF coloca clientes na rede de Utilizadores | o código ainda tem `Client`, `BillingClient` e Person/contas concorrentes | entidade canônica de cliente continua explicitamente aberta |

## 7. Open Questions — efeito da nova fonte

Após revisão integral, o registro contém **53 questões/decisões**:

- **5 RESPONDIDAS PELO ALEX**: nenhuma sincronização automática; mapa único; preservar Documentos por País; experiência sem empresa; criação direta de OP;
- **4 PARCIALMENTE RESPONDIDAS**: fronteira Operix×tenant, latência/realtime, destino dos módulos legados e telas que exigem atualização imediata;
- **23 CONTINUAM ABERTAS**, incluindo cliente canônico, WEEKLOG, valor financeiro do técnico, reconciliações, falha parcial, retenção, versões/aprovação PDR e permissões detalhadas;
- **21 NÃO SÃO PERGUNTAS PARA O CLIENTE**: 12 decisões ENGINEERING e 9 políticas SECURITY.

O detalhamento individual está em `specs/000-operix-diagnostic/open-questions.md`.

## 8. Inputs preparados para a Fase 6

Sem iniciar a Fase 6, ficam prontos:

1. catálogo rastreável de 53 requisitos com fonte e aceite;
2. separação formal entre current e target;
3. classificação inicial correção/evolução/redesenho/preservação/confirmação;
4. confronto preliminar e tipo de gap por requisito;
5. prioridade do cliente preservada em sequência 01–10;
6. gates técnicos G1–G9 associados individualmente;
7. contradições e substituições de hipóteses anteriores;
8. perguntas de negócio ainda necessárias para fechar o target;
9. restrições explícitas: sem segundo mapa, sem auto-sync, sem remodelar documentos por país e sem dados fictícios.

## 9. Limite desta entrega

Nenhuma classificação `CORREÇÃO / RESTAURAÇÃO` confirma falha em runtime quando o código apenas apresenta uma cadeia estática. Não foram executadas Fases 4B, 5B ou 6; não foram alterados código, schema, Docker, dados, integrações ou credenciais.

### Referencial

- ISO/IEC 25010 — adequação funcional, compatibilidade, confiabilidade e segurança.
- IEEE/ISO/IEC 29148 — requisitos rastreáveis, verificáveis e separados de solução.
- Cohn, M. — critérios de aceite como comportamento observável, não detalhe de implementação.
- Fowler, M. — migração incremental e separação entre estabilização brownfield e evolução.
