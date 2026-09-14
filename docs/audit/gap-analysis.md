# Fase 6 — Gap Analysis: Current State vs Target State

**Projeto**: Operix / QW Nexus  
**Data**: 2026-09-05  
**Escopo**: análise estática dos 53 requisitos CTS; sem runtime, 4B/5B, migrations, implementação ou estimativas  
**Fonte canônica do target**: `docs/audit/client-target-state.md` (`CTS-001` a `CTS-053`)

## 1. Método, regras de leitura e taxonomia

O confronto foi feito requisito a requisito entre o target consolidado na Fase 5C e as evidências das Fases 1–5A. A classificação principal descreve o **gap atual**, não a origem do pedido do cliente. Assim, um item chamado de “restauração” pelo cliente pode permanecer `REQUER VALIDAÇÃO RUNTIME` quando UI, rota e persistência existem estaticamente, mas nunca foram executadas.

Categorias principais usadas: `SEM GAP MATERIAL`, `BUG / RESTAURAÇÃO`, `MIGRAÇÃO INCOMPLETA`, `IMPLEMENTAÇÃO PARCIAL`, `NÃO IMPLEMENTADA`, `REQUER REDESENHO`, `REQUER DECISÃO DE NEGÓCIO` e `REQUER VALIDAÇÃO RUNTIME`.

Naturezas abreviadas na matriz:

- `EST` estabilização; `COR` correção funcional; `MIG` migração; `REF` refatoração estrutural;
- `DOM` modelagem de domínio; `SEG` segurança; `INF` infraestrutura; `NEW` nova feature;
- `UX` UX/UI; `PRES` preservação/regressão.

Nos gates, `P:` significa **precondition**, que precisa ser resolvida antes de iniciar o requisito com segurança; `D:` significa **dependency**, tratável dentro do mesmo bloco. `Bxx!` indica decisão BUSINESS que impede fechar o desenho; `Bxx?` indica parte condicionada que não impede mapear a maior parte do trabalho. `4B = SIM` significa que há evidência comportamental pendente, não que todo o gap dependa de runtime.

O impacto segue a definição solicitada: `LOCAL`, `MULTIMÓDULO` ou `ESTRUTURAL`. A reutilização avalia a capacidade diretamente relacionada ao requisito; componentes genéricos não transformam uma feature ausente em implementação parcial.

## 2. Matriz consolidada — 53 requisitos

| CTS | Domínio | Target | Current | Gap principal | Natureza | Reuso | Impacto | Gates | Open Question | 4B? | Tratamento futuro |
|---|---|---|---|---|---|---|---|---|---|:---:|---|
| CTS-001 | B. Produção | Criar, salvar e visualizar nova OP | `ProductionPage` + POST `/production-orders` existem; cadeia não executada | REQUER VALIDAÇÃO RUNTIME | EST, COR, PRES | ALTA — UI, hook, rota e modelo existem | MULTIMÓDULO | P:G3,G4,G9; D:G7 | — | SIM | Exercitar em laboratório; corrigir somente a camada que falhar e preservar contratos válidos |
| CTS-002 | B. Produção | OP direta inicia “Em Produção”, sem orçamento | `BLANK.status=in_production` e POST existem; persistência não comprovada | REQUER VALIDAÇÃO RUNTIME | EST, COR, PRES | ALTA — fluxo estático quase completo | MULTIMÓDULO | P:G3,G4,G9; D:G7 | — | SIM | Provar create→reload→board; só então decidir se há correção |
| CTS-003 | B/C. Produção→WEEKLOG | Preservar Orçamento→Produção | orçamento fica em `localStorage`/`notes`; criação de OP existe | MIGRAÇÃO INCOMPLETA<br>Sec.: domínio + atomicidade | MIG, DOM, PRES | MÉDIA — UI/cálculo/OP servem, orçamento não é entidade | ESTRUTURAL | P:G3,G4,G8; D:G6,G7,G9 | B03?, B04? | SIM | Modelar orçamento/versionamento sem big-bang; preservar conversão e definir falha parcial |
| CTS-004 | B. Produção | Ciclo Em Produção→Pausado→Finalizado | status, board e PATCH existem; máquina não executada | REQUER VALIDAÇÃO RUNTIME | EST, PRES | ALTA — estados e transição estão presentes | MULTIMÓDULO | P:G3,G9; D:G7 | — | SIM | Testar transições, reload e permissões; registrar regressão automatizada |
| CTS-005 | B. Produção | Histórico cronológico operacional | `OrderTimeline` existe, mas `useProductionTimeline` está desabilitado e devolve vazio | BUG / RESTAURAÇÃO | COR, PRES | MÉDIA — apresentação existe; fonte/eventos precisam ser religados | LOCAL | P:G3,G4; D:G7 | — | NÃO | Restaurar fonte persistente e trilha auditável, com teste de ordenação |
| CTS-006 | A. Fundação/Empresa | Administrativo cria múltiplas empresas | múltiplos `Workspace` são possíveis, mas não há `Company`; ator “administrativo” é ambíguo | REQUER DECISÃO DE NEGÓCIO<br>Sec.: redesenho + segurança | DOM, SEG | MÉDIA — workspace/onboarding são aproveitáveis | ESTRUTURAL | P:G1,G2,G3,G4,G8; D:G7 | B08! | NÃO | Alex define autoridade Operix×tenant; depois materializar aggregate e caso de uso |
| CTS-007 | A. Empresa/Workspace | Cada empresa cria exatamente um workspace isolado | onboarding cria workspace, não uma empresa canônica 1:1 | REQUER REDESENHO | DOM, REF | MÉDIA — criação de workspace e membership permanecem úteis | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B08? | NÃO | Introduzir identidade de empresa e invariante 1:1 com migração de dados |
| CTS-008 | A. Tenant isolation | Alternar empresa nunca mistura dados, papéis ou marca | 16/20 domínios têm isolamento inadequado; IDs/workspace vêm do cliente | REQUER REDESENHO<br>Sec.: segurança/tenancy | SEG, REF | BAIXA — UI de contexto existe, enforcement não | ESTRUTURAL | P:G1,G2,G3,G4; D:G7 | B08? | NÃO | Tornar `TenantContext` e autorização por objeto invariantes server-side |
| CTS-009 | A. Empresa/Workspace | Seletor de empresa ativa acima do Painel | `WorkspaceSwitcher` alterna memberships no TopBar, sem semântica `Company` | REQUER REDESENHO<br>Sec.: validação runtime | REF, UX | MÉDIA — seletor e troca de contexto são reutilizáveis | ESTRUTURAL | P:G2,G3,G4,G8,G9; D:G7 | B08? | SIM | Reancorar seletor no contexto canônico e validar troca sem vazamento/reload |
| CTS-010 | A. Empresa/Settings | Nome/logo refletem empresa ativa | `CompanySetting` é único por `userId`, não por workspace | REQUER REDESENHO | DOM, UX, SEG | MÉDIA — formulários/branding servem, ownership não | ESTRUTURAL | P:G3,G4,G5,G8; D:G7 | B08? | NÃO | Mover ownership da marca para empresa/workspace e migrar assets com segurança |
| CTS-011 | A. Profile/Empresa | Separar perfil pessoal de dados empresariais | `/settings/company` e modelo por usuário misturam os conceitos | REQUER REDESENHO | DOM, REF | MÉDIA — telas e parte dos campos são aproveitáveis | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B08? | NÃO | Separar aggregates, contratos e autorização de perfil vs empresa |
| CTS-012 | A. Navegação/Auth | Sem empresa, exibir somente Perfil + Painel/Radar | sidebar só verifica permissões, não existência de workspace | IMPLEMENTAÇÃO PARCIAL<br>Sec.: segurança | NEW, UX, SEG | ALTA — sidebar, sessão e contexto já existem | ESTRUTURAL | P:G1,G2,G3; D:G7 | B08? | NÃO | Derivar estado “sem tenant” no servidor/cliente e negar módulos operacionais |
| CTS-013 | A/J. Navegação/Módulos | Liberar módulos operacionais apenas com workspace válido | `useWorkspaceModules` considera workspaces integralmente habilitados | IMPLEMENTAÇÃO PARCIAL | NEW, UX, SEG | ALTA — mecanismo de módulos e menus existe | ESTRUTURAL | P:G2,G3; D:G7 | B08? | NÃO | Aplicar gate central por contexto e preservar decisão futura sobre módulos legados |
| CTS-014 | A. Perfil/Empresa | “Criar empresa” dentro do Perfil | fluxo existe apenas no onboarding e não há `Company` | REQUER REDESENHO | DOM, NEW, UX | MÉDIA — onboarding pode virar caso de uso compartilhado | ESTRUTURAL | P:G1,G2,G3,G4,G8; D:G7 | B08? | NÃO | Extrair criação reutilizável após fechar aggregate e autoridade |
| CTS-015 | D. Colaboradores | Renomear Pessoas/Nova Pessoa | UI mantém “Pessoas”/“Nova Pessoa” | NÃO IMPLEMENTADA | UX | ALTA — alteração textual/localização sobre tela existente | LOCAL | D:G7 | — | NÃO | Atualizar nomenclatura após separar semanticamente internos/externos |
| CTS-016 | D. Colaboradores | `Person` representa somente pessoal interno | `Person.type` mistura internos, técnicos e prestadores; clientes são concorrentes | REQUER REDESENHO | DOM, REF, MIG | BAIXA — campos civis servem; semântica/tipos não | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B01? | NÃO | Definir estratégia incremental de reclassificação e preservar histórico |
| CTS-017 | D. Colaboradores | Nome próprio/família, completo e foto opcional | há `fullName`; nomes separados/foto de `Person` não têm contrato claro | IMPLEMENTAÇÃO PARCIAL | DOM, MIG, UX | MÉDIA — cadastro base e storage genérico existem | ESTRUTURAL | P:G3,G4,G5; D:G7 | — | NÃO | Estender identidade interna e vincular avatar com ownership |
| CTS-018 | D. Colaboradores | Catálogo extensível de cargos internos | `role/department` livres e quatro tipos operacionais misturam taxonomias | REQUER REDESENHO | DOM, REF | BAIXA — campos livres ajudam migração, não governança | ESTRUTURAL | P:G3,G4,G8; D:G7 | B08? | NÃO | Modelar catálogo/versionamento e separar cargo de permissão |
| CTS-019 | D. Colaboradores | Endereço, telefone/WhatsApp e e-mail persistentes | `Person` possui endereço/e-mail/telefone, estrutura incompleta | IMPLEMENTAÇÃO PARCIAL | DOM, NEW, UX | ALTA — maior parte do formulário/modelo existe | MULTIMÓDULO | P:G3,G4; D:G7 | — | NÃO | Completar contrato/normalização e validar escopo tenant |
| CTS-020 | D. Colaboradores | Dados bancários do colaborador | não há estrutura explícita; `fiscalData` genérico não é contrato | NÃO IMPLEMENTADA | DOM, NEW, SEG | BAIXA — cadastro base serve; domínio sensível é novo | MULTIMÓDULO | P:G3,G4,G8; D:G7 | — | NÃO | Modelar dados mínimos, acesso, auditoria e proteção antes da UI |
| CTS-021 | D/E. Documentos pessoais | Pasta organizada de documentos por colaborador | endpoints e MinIO existem; ownership/lifecycle e migração são incompletos | MIGRAÇÃO INCOMPLETA<br>Sec.: segurança/storage | MIG, SEG | MÉDIA — file manager, metadado e MinIO são úteis | ESTRUTURAL | P:G3,G4,G5; D:G6,G7 | B09? | NÃO | Consolidar ownership pessoa→tenant→objeto e ciclo de vida |
| CTS-022 | D. Colaboradores | Preservar status visível/editável | `Person.status` e filtro ativo/inativo existem, sem runtime | REQUER VALIDAÇÃO RUNTIME | PRES | ALTA — modelo, filtro e UI existem | MULTIMÓDULO | P:G3,G9; D:G7 | B02? | SIM | Confirmar persistência/filtragem e cobrir desligamento sem apagar histórico |
| CTS-023 | D. Utilizadores/Clientes | Rede externa separada dos colaboradores | conta/membership são distintos, mas `Person` ainda mistura externos e cliente tem três modelos | REQUER DECISÃO DE NEGÓCIO<br>Sec.: redesenho | DOM, REF | MÉDIA — identidade de acesso existe; conceito de cliente não | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B01!, B08? | NÃO | Alex define cliente canônico; então separar rede externa e migrar referências |
| CTS-024 | D. Identidade | Colaborador não cria Utilizador automaticamente | código atual já não faz criação automática | SEM GAP MATERIAL | PRES | ALTA — ausência de acoplamento automático é preservável | LOCAL | D:G7,G9 | B12 respondida | SIM | Criar teste negativo de regressão; nenhum vínculo automático |
| CTS-025 | D. Identidade | Utilizador não cria Colaborador automaticamente | fluxo atual já não cria `Person` | SEM GAP MATERIAL | PRES | ALTA — comportamento estrutural coincide | LOCAL | D:G7,G9 | B12 respondida | SIM | Preservar separação e testar ausência de efeito colateral |
| CTS-026 | D/A. Utilizadores/RBAC | Funções externas não reutilizam cargos internos | memberships têm papéis, mas papel local/global é acoplado e People sobrepõe tipos | REQUER REDESENHO<br>Sec.: segurança | DOM, SEG, REF | BAIXA — vocabulário parcial existe; autoridade está incorreta | ESTRUTURAL | P:G1,G2,G3,G4,G8; D:G7 | B08? | NÃO | Separar papel global, membership, persona externa e cargo RH |
| CTS-027 | D/A. Utilizadores/RBAC | Preservar temporariamente acesso/vínculo existente | REST de members existe, não foi executado e permite escalada local→global | REQUER VALIDAÇÃO RUNTIME<br>Sec.: segurança estrutural confirmada | EST, SEG, PRES | MÉDIA — fluxo pode ser mantido após remover escalada | ESTRUTURAL | P:G1,G2,G3,G9; D:G7 | B02?, B08?, B10? | SIM | Provar happy path em A/B; preservar UX, nunca a vulnerabilidade |
| CTS-028 | E. Documentos por país | Selecionar, listar e editar requisitos | modelo/rotas existem; runtime não validado | REQUER VALIDAÇÃO RUNTIME | PRES | ALTA — cadeia estática está presente | MULTIMÓDULO | P:G9; D:G7 | — | SIM | Teste de não regressão sem remodelar catálogo |
| CTS-029 | E. Documentos por país | Não remodelar/apagar neste ciclo | catálogo é global; DELETE devolve 405; mudança não foi autorizada | SEM GAP MATERIAL | PRES | ALTA — a restrição exige preservação, não implementação | LOCAL | — | P07 respondida | NÃO | Congelar escopo e proteger dados por regressão |
| CTS-030 | E. Documentos do colaborador | Botão de pasta ao lado de editar/excluir | lista People não tem ação; `EmbeddedFileManager`/REST existem | MIGRAÇÃO INCOMPLETA | MIG, UX, SEG | ALTA — composição de capacidades existentes | ESTRUTURAL | P:G3,G5; D:G6,G7 | B09? | NÃO | Integrar o file manager depois do ownership; sem segundo storage |
| CTS-031 | E/J. Documentos | Reutilizar mecanismo existente | file manager REST existe; `/documents` ainda usa Supabase noop | MIGRAÇÃO INCOMPLETA<br>Sec.: segurança/tenancy | MIG, SEG, PRES | ALTA — backend/MinIO e componente são a base | ESTRUTURAL | P:G3,G5; D:G6,G7 | B09? | NÃO | Migrar fatia vertical e eliminar falso sucesso, preservando catálogo por país |
| CTS-032 | F. Locais | Local é filial/unidade tenant-scoped reutilizável | `Location` existe; workspace opcional/confiado e sem integração operacional | REQUER REDESENHO | DOM, SEG, REF | MÉDIA — CRUD/campos são aproveitáveis | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B13? | NÃO | Tornar tenant obrigatório e fechar semântica/vínculos do local |
| CTS-033 | F. Locais | Endereço e contatos persistem | modelo/form já possuem os campos; runtime ausente | REQUER VALIDAÇÃO RUNTIME | PRES | ALTA — contrato estático existente | MULTIMÓDULO | P:G3,G9; D:G7 | — | SIM | Provar salvar→recarregar→listar dentro do tenant |
| CTS-034 | F. Locais | Gerente, telefone e e-mail persistem | campos livres e formulário existem; vínculo a colaborador é indefinido | REQUER VALIDAÇÃO RUNTIME<br>Sec.: decisão condicional | PRES | ALTA — campos atuais atendem a leitura mínima | MULTIMÓDULO | P:G3,G9; D:G7 | B13? | SIM | Validar persistência; Alex decide contato livre vs relação sem bloquear o teste atual |
| CTS-035 | F. Locais | Status Ativo/Pausado/Encerrado | modelo/UI oferecem apenas `active/inactive` | IMPLEMENTAÇÃO PARCIAL | DOM, NEW, UX | MÉDIA — mecanismo de status/filtro existe | MULTIMÓDULO | P:G3,G4,G8; D:G7 | — | NÃO | Definir transições e migrar `inactive` sem perda semântica |
| CTS-036 | F. Locais | GPS e link Maps/Waze | latitude/longitude/link não existem em `Location` | NÃO IMPLEMENTADA | DOM, NEW, UX | BAIXA — CRUD serve; campos/validação/geocodificação são novos | MULTIMÓDULO | P:G3,G4,G8; D:G7 | — | NÃO | Modelar coordenadas canônicas e links derivados/validados |
| CTS-037 | F. Locais | Local não desaparece após salvar | CRUD REST existe; desaparecimento alegado não foi reproduzido | REQUER VALIDAÇÃO RUNTIME | COR, EST | INDETERMINADA SEM RUNTIME — causa pode estar em UI, contrato, tenant ou banco | MULTIMÓDULO | P:G3,G4,G9; D:G7 | — | SIM | Reproduzir request/response/reload; não prescrever correção antes da causa |
| CTS-038 | F/G. Local→Mapa | Local ativo com GPS alimenta Operações/Equipes | mapa não consulta `Location`; deriva operações de `ServiceOrder` | REQUER REDESENHO | DOM, REF, MIG | MÉDIA — mapa, Location e rotas existem separadamente | ESTRUTURAL | P:G3,G4,G8; D:G6,G7 | B13? | NÃO | Criar projeção tenant-scoped de locais reais para o mapa único |
| CTS-039 | G. Mapa | Manter uma única instância com camadas | `OperationalMap` já concentra Radar/Operações/Equipes/Ordens | SEM GAP MATERIAL | PRES | ALTA — estrutura coincide com a restrição | LOCAL | D:G7,G9 | P06 respondida | SIM | Preservar arquitetura de mapa único e cobrir regressão visual |
| CTS-040 | G. Radar | Radar liga/desliga independentemente de Operações | toggle/layer existem; provedor/WebGL não executados | REQUER VALIDAÇÃO RUNTIME | EST, PRES | ALTA — layer e controle existem | MULTIMÓDULO | P:G9; D:G7 | — | SIM | Validar com egress controlado e estado vazio/erro do provedor |
| CTS-041 | G/F. Mapa/Operações | Operações mostra Locations ativos por GPS real | camada usa cidade hardcoded e jitter sobre `ServiceOrder` | REQUER REDESENHO<br>Sec.: migração + dados sintéticos | DOM, REF, MIG | MÉDIA — renderização/camadas servem; fonte não | ESTRUTURAL | P:G3,G4,G8; D:G6,G7 | — | NÃO | Substituir fonte aproximada por projeção de Location autorizada |
| CTS-042 | G. Mapa/Equipes | Mostrar somente equipes reais relacionadas | layer consome backend events; telemetria frontend ainda cai no noop e tenant é fraco | MIGRAÇÃO INCOMPLETA<br>Sec.: segurança + runtime | MIG, SEG, EST | MÉDIA — layer/event endpoint existem | ESTRUTURAL | P:G2,G3,G9; D:G6,G7 | B08?, B11? | SIM | Fechar fonte de geolocalização, tenant e atualização; depois validar |
| CTS-043 | G/C. Mapa/Ordens | Mostrar ordens reais da empresa ativa | layer usa `ServiceOrder` global e localização aproximada | REQUER REDESENHO<br>Sec.: migração/tenancy | MIG, SEG, REF | MÉDIA — consulta/renderização parcial reutilizável | ESTRUTURAL | P:G2,G3,G4; D:G6,G7,G9 | B06? | SIM | Definir ordem canônica exibida e usar coordenada real tenant-scoped |
| CTS-044 | G. Mapa | Toggles refletem imediatamente sem segundo mapa | state e `setLayoutProperty` existem; runtime WebGL pendente | REQUER VALIDAÇÃO RUNTIME | COR, EST, PRES | ALTA — implementação local presente | LOCAL | P:G9; D:G7 | B11? | SIM | Testar matriz de layers/estados e registrar latência observada |
| CTS-045 | G. Mapa | Sem backend, mostrar vazio; nunca marcador sintético | `CITY_COORDS` + inferência textual + jitter fabricam posição operacional | BUG / RESTAURAÇÃO<br>Sec.: redesenho da fonte | COR, SEG, UX | MÉDIA — mapa/camadas ficam; fonte sintética deve sair | MULTIMÓDULO | P:G3,G4,G8; D:G6,G7 | — | NÃO | Remover representação enganosa; vazio explícito até existir fonte real |
| CTS-046 | H. PDR | Ficha visual por peça/dano | não há entidade, contrato ou UI persistente de peça/dano | NÃO IMPLEMENTADA | DOM, NEW, UX | BAIXA — componentes visuais genéricos só ajudam na apresentação | ESTRUTURAL | P:G3,G4,G5,G8; D:G7 | B04? | NÃO | Modelar PDR/versionamento antes do editor visual |
| CTS-047 | H/E. PDR/Fotos | Foto referencia peça/dano e tenant | `ProductionPhoto` existe, sem peça/dano | NÃO IMPLEMENTADA | DOM, NEW, SEG | MÉDIA — upload/galeria/MinIO são reutilizáveis | ESTRUTURAL | P:G3,G4,G5,G8; D:G7 | B04?, B09? | NÃO | Criar relações/ownership e migrar fotos sem associação como legado explícito |
| CTS-048 | H. IA/PDR | IA estima contagem/severidade com evidência | só existe OCR documental; estimativa visual PDR não foi localizada | NÃO IMPLEMENTADA | DOM, NEW, SEG | BAIXA — cliente de IA é infraestrutura, não modelo de dano | ESTRUTURAL | P:G3,G4,G5,G8; D:G7 | B04? | NÃO | Definir esquema de saída, evidência, quota e avaliação antes do provedor |
| CTS-049 | H. IA/PDR | Humano aceita/corrige/rejeita proposta | workflow, papéis e versionamento não existem nem foram definidos | REQUER DECISÃO DE NEGÓCIO<br>Sec.: não implementada | DOM, NEW, SEG | BAIXA — controles genéricos podem ser reaproveitados | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B04! | NÃO | Alex define autoridade/vigência; então projetar workflow auditável |
| CTS-050 | H. PDR | Totais derivam somente de danos aprovados | cálculo atual é local e não há dano aprovado persistente | NÃO IMPLEMENTADA | DOM, NEW | BAIXA — fórmulas locais exigem validação antes de reuso | ESTRUTURAL | P:G3,G4,G8; D:G7 | B04? | NÃO | Derivar totais no domínio a partir de versão aprovada, nunca do cliente |
| CTS-051 | C/H. Preço/Financeiro | Valor/forfait manual autorizado com trilha | preço/cálculo ficam no navegador e em `notes` | MIGRAÇÃO INCOMPLETA<br>Sec.: domínio financeiro | MIG, DOM, SEG | MÉDIA — UI/cálculos ajudam; fonte de verdade não | ESTRUTURAL | P:G2,G3,G4,G8; D:G7 | B05?, B08? | NÃO | Persistir versão, ator, vigência e congelamento conforme decisão financeira |
| CTS-052 | I/E. White-label | Documento usa marca da empresa ativa | branding/template é `CompanySetting` por usuário | REQUER REDESENHO | DOM, REF, UX | MÉDIA — geradores e assets existem; ownership está errado | ESTRUTURAL | P:G3,G4,G5,G8; D:G7 | B08?, B09? | NÃO | Tornar template/assets tenant-scoped e auditáveis |
| CTS-053 | I. Multilíngue | Gerar documentos PT/EN/FR/DE/ES/IT sem alterar fatos | i18n da UI existe; pipeline documental multilíngue não | NÃO IMPLEMENTADA | NEW, UX, PRES | BAIXA — dicionários/UI não garantem documento correto | MULTIMÓDULO | P:G3,G4,G5,G8; D:G7 | B09? | NÃO | Criar templates versionados por idioma e testes de invariantes de valores |

### 2.1 Controle de completude e contagens

| Categoria principal | Total |
|---|---:|
| SEM GAP MATERIAL | 4 |
| BUG / RESTAURAÇÃO | 2 |
| MIGRAÇÃO INCOMPLETA | 6 |
| IMPLEMENTAÇÃO PARCIAL | 5 |
| NÃO IMPLEMENTADA | 8 |
| REQUER REDESENHO | 14 |
| REQUER DECISÃO DE NEGÓCIO | 3 |
| REQUER VALIDAÇÃO RUNTIME | 11 |
| **Total** | **53** |

Há **33 CTS associados a pelo menos uma decisão BUSINESS aberta**, mas só **3** têm `REQUER DECISÃO DE NEGÓCIO` como categoria principal. Nos outros 30, a maior parte do gap já é determinável e a pergunta condiciona regra, migração ou aceite. **18 CTS** carregam evidência 4B (`G9`) e **31** têm impacto estrutural.

Reutilização: **19 ALTA**, **22 MÉDIA**, **11 BAIXA**, **0 NENHUMA** e **1 INDETERMINADA SEM RUNTIME**. Impacto: **7 LOCAL**, **15 MULTIMÓDULO** e **31 ESTRUTURAL**.

## 3. Análise estrutural por domínio

### A. Fundação / Plataforma — CTS-006 a CTS-014 e CTS-026/027

O target multiempresa não pode ser obtido apenas movendo o switcher ou duplicando `CompanySetting`. Hoje `Workspace`, `Membership`, papel global e configuração por usuário formam quatro fronteiras incompatíveis com “empresa ativa”. `G1` e `G2` fecham a confiança; `G3` impõe isolamento; `G4` permite migrar dados; `G7` impede regressão. B08 bloqueia o ator e o alcance do plano Operix, mas não impede identificar que a correção é estrutural.

Superfícies principais: `backend/src/routes/auth.ts`, `workspaces.ts`, `account.ts`, `settings.ts`, `permissionPolicy.ts`, `User`, `UserRole`, `Membership`, `Workspace`, `CompanySetting`, `useAuth`, `useWorkspace`, `WorkspaceSwitcher`, `AppSidebar` e `useWorkspaceModules`.

### B. Produção — CTS-001 a CTS-005

Nova OP, criação direta e estados têm alta capacidade reutilizável, mas continuam sem prova comportamental. O gap material já confirmado é o histórico desabilitado e a persistência inadequada do orçamento. A 4B pode reduzir ou ampliar o trabalho de restauração dos CTS-001/002/004, mas não elimina a necessidade estrutural do CTS-003 nem o bug do CTS-005.

Superfícies: `ProductionPage.tsx`, componentes de produção/orçamento, hooks `useProductionOrders`/`useProductionTimeline`, rotas `/production-orders`, `ProductionOrder`, `ProductionPhoto`, `ServiceOrder` e documentos derivados.

### C. WEEKLOG / Listas / Financeiro — CTS-003, CTS-043 e CTS-051

O catálogo CTS não contém uma nova especificação autônoma de WEEKLOG, PaymentOrder ou reconciliação. Ele toca esses domínios por três cruzamentos: conversão de orçamento/OP, definição de “ordens” no mapa e preço manual. Isso não autoriza escolher entre OS×PaymentOrder e invoice×payment. B03, B05, B06 e B07 permanecem necessárias para fechar atomicidade, referência e reconciliação. Os achados S5A-004/S5A-010 e B4A-025–029 continuam fundação da futura recuperação do produto, mesmo sem um CTS exclusivo.

Superfícies: `ServiceOrder`, `PaymentOrder`, `FinancialRecord`, `Reconciliation`, `ProfitRule`, `ServiceOrderDistribution`, rotas `serviceOrders.ts`, `paymentOrders.ts`, `finance.ts` e fluxos financeiros Supabase residuais.

### D. Pessoas — CTS-015 a CTS-027

Renomear a tela é local; separar os conceitos não é. `Person` precisa deixar de codificar rede externa, cargos internos precisam deixar de representar permissão e o target de clientes externos não pode ser fechado antes de B01. A decisão B12 já eliminou qualquer sincronização automática: testes devem provar a ausência desse efeito, enquanto um eventual vínculo manual permanece fora do target conhecido.

Superfícies: `Person`, `PersonDocument`, `User`, `AppUser`, `Profile`, `Membership`, `Client`, `BillingClient`, `PeoplePage`, `UsersPage`, `/people`, `/workspaces/:id/members` e billing ops.

### E. Documentos — CTS-021 e CTS-028 a CTS-031

Há mecanismo reaproveitável, mas não ownership suficiente. A sequência sustentável é `G5` antes da composição visual: tenant/entidade/objeto, política de URL e lifecycle; depois a fatia `G6` que liga a tela ao REST/MinIO. “Preservar Documentos por País” proíbe um redesenho do catálogo neste ciclo, mas não legitima metadados globais ou storage sem autorização.

Superfícies: `Document`, `PersonDocument`, `CountryDocumentRequirement`, `EmbeddedFileManager`, página `/documents`, `documents.ts`, `storage.ts`, `minio.ts` e buckets MinIO.

### F. Locais — CTS-032 a CTS-038

Campos cadastrais existentes podem ser reaproveitados. O gap estrutural está em tornar `Location` tenant-scoped e fonte operacional real. B13 afeta o desenho do gerente, não impede validar os campos livres atuais. CTS-037 permanece estritamente runtime: sem request/response/reload não há base para escolher correção.

Superfícies: `Location`, `LocationsPage`, hooks de locais, `/locations`, `OperationalMap`, `ServiceOrder` e geocodificação/ORS.

### G. Dashboard / Mapa / Radar — CTS-039 a CTS-045

A instância única e os controles de layer são reutilizáveis. O problema é a origem do dado: posição de ordens é fabricada por cidade/jitter, equipes dependem de telemetria parcialmente migrada e o tenant não é imposto. O primeiro tratamento seguro do CTS-045 é estado vazio explícito; a visualização real só vem depois de Location/equipe/ordem canônicas.

Superfícies: `OperationalMap`, dashboard, `useGeolocation`, backend events, `/weather/*`, `/route/*`, `/service-orders` e `Location`.

### H. PDR / IA — CTS-046 a CTS-051

OCR documental não é estimativa de dano. O domínio mínimo precisa representar peça, dano, evidência, versão, decisão humana e total derivado. B04 bloqueia o workflow e a vigência; B05 condiciona preço/congelamento. Reusar `ProductionPhoto`, MinIO, componentes visuais e o cliente de IA reduz trabalho periférico, mas não elimina a nova modelagem nem os controles de custo, privacidade e avaliação.

### I. White-label / multilíngue — CTS-052/053

Branding por usuário é incompatível com documento por empresa ativa. UI i18n também não comprova templates documentais corretos. A solução futura deve preservar fatos/valores entre idiomas, versionar templates e herdar ownership documental; por isso CTS-052 é estrutural e CTS-053 multimódulo.

### J. Módulos legados/secundários

Não existe CTS autônomo que autorize restaurar, reimplementar ou remover Frota, Marketplace, Automação, Copiloto, Consentimento, Auditoria ou Soft Delete. P02 continua parcialmente respondida. Na Fase 7 esses módulos devem aparecer como **decisão de portfólio condicionada**, não ser embutidos no custo dos 53 CTS nem apagados por inferência.

## 4. Foundation Dependency Map

```text
G1 Bootstrap administrativo ─┐
G2 Papel global vs workspace ├── Plano de controle confiável
                             ├── Empresa/Workspace (CTS-006..014)
                             └── Utilizadores/RBAC (CTS-023,026,027)

G3 TenantContext server-side
├── Pessoas e clientes (CTS-016..023)
├── Locais (CTS-032..038)
├── Produção/WEEKLOG/Financeiro (CTS-001..005,043,051)
├── Documentos/Storage (CTS-021,030,031,047,052,053)
├── Mapa operacional (CTS-038,041..045)
└── PDR/IA (CTS-046..050)

G4 Baseline Prisma/ambiente
├── migração de aggregates e campos canônicos
├── constraints tenant/FK/unique
└── laboratório repetível para G9

G5 Ownership documental/storage ── documentos, fotos PDR, branding e templates
G6 Migração Supabase/noop ───────── documentos, mapa/equipes e fluxos híbridos
G7 Testes backend/contrato/tenant ─ todos os CTS com mudança ou preservação
G8 Decisão de domínio ───────────── empresa, cliente, cargos, Location, PDR e preço
G9 Evidência 4B ─────────────────── restaurações e preservações ainda não executadas
```

Recorrência objetiva no catálogo: **G7 52**, **G3 45**, **G4 35**, **G8 26**, **G9 18**, **G2 17**, **G5 10**, **G6 9** e **G1 6**. G7 é transversal; G3/G4 são as fundações técnicas mais recorrentes. A prioridade 01–10 de Alex continua sendo prioridade de produto, não ordem executável.

## 5. Clusters de trabalho para a Fase 7

Os clusters abaixo são agrupamentos de dependência, não cronograma, sprint ou estimativa.

| Cluster | CTS incluídos | Problema resolvido | Dependências principais | Risco | Capacidade reutilizável | Decisões abertas | Evidência 4B necessária |
|---|---|---|---|---|---|---|---|
| F0 — Fundação multiempresa e segurança | 006–014 | autoridade, empresa ativa, workspace, isolamento, branding e acesso sem empresa | G1,G2,G3,G4,G7,G8 | crítico; blast radius cross-tenant | workspace, membership, onboarding e switcher | B08; B01 repercute clientes | CTS-009; matriz A/B de contexto |
| F1 — Produção e continuidade operacional | 001–005 | criação direta/por orçamento, estados e histórico | G3,G4,G7,G9; G6/G8 no orçamento | alto; regressão do core e efeitos derivados | UI/REST/modelo de OP e board | B03,B04 | CTS-001–004; idempotência e reload |
| F2 — Pessoas, utilizadores e clientes | 015–027 | separar RH, acesso externo, cargos, dados e documentos | G1–G5,G7,G8 | crítico; identidade, PII e privilégios | People/Users, memberships e campos civis | B01,B02,B08,B09,B10,B13; B12 respondida | CTS-022,024,025,027 e isolamento A/B |
| F3 — Documentos e storage | 028–031 | preservar catálogo e concluir file manager seguro | G3,G5,G6,G7 | crítico; BOLA, perda/órfãos e retenção | MinIO, REST e `EmbeddedFileManager` | B09 | CTS-028 e testes de ownership/storage |
| F4 — Locais, mapa e radar | 032–045 | Location real alimenta o único mapa sem dados sintéticos | G2–G4,G6–G9 | alto; geolocalização falsa/cross-tenant e provedores | CRUD Location, mapa, layers, weather/route | B06,B08,B11,B13 | CTS-033/034/037/039/040/042–044 |
| F5 — PDR, IA e precificação | 046–051 | domínio de dano, fotos, proposta IA, aprovação, total e forfait | G2–G5,G7,G8 | alto; decisão humana, custo IA e integridade de preço | fotos/MinIO, UI de orçamento e cliente IA | B04,B05,B08,B09 | não define existência; 4B futura valida integrações após modelagem |
| F6 — Saída white-label e multilíngue | 052–053 | documentos por marca/idioma da empresa ativa | G3–G5,G7,G8 | alto; documento incorreto ou vazamento de marca/dado | geradores PDF, assets e i18n | B08,B09 | validação de templates/provedores apenas depois da fundação |
| F7 — Portfólio legado/secundário | nenhum CTS dedicado; restrição CTS-013/031/039 | decidir manter, portar, ocultar ou encerrar módulos fora do catálogo | P02, G6,G7 | alto se escopo implícito for tratado como compromisso | inventário Fase 3 e alguns backends parciais | P02 | 4B somente para módulos explicitamente mantidos |

## 6. Decisões e evidências que condicionam a Fase 7

É possível estruturar a Fase 7 com itens condicionais, mas não fechar desenho, aceite ou sequência técnica dos blocos afetados sem:

- **B01** cliente canônico;
- **B03** comportamento de falha parcial;
- **B04** versionamento/aprovação PDR;
- **B05** valor financeiro do técnico e congelamento;
- **B06** semântica/referência de WEEKLOG;
- **B07** natureza e autoridade das reconciliações;
- **B08** fronteira Operix×tenant;
- **B09** retenção/ciclo documental;
- **B13** gerente de Local livre ou relacionado.

B02 e B10 refinam lifecycle de identidade/convite; B11 já define imediatismo para os toggles, mas ainda carece de SLA nos demais módulos. Elas não impedem o mapa macro, porém impedem critérios de aceite completos nas respectivas histórias.

Os casos 4B que podem materialmente alterar escopo/prioridade são: CTS-001/002/004 (se o fluxo de OP falha e onde), CTS-009 (troca real de contexto), CTS-022/027/028/033/034/037 (persistência e RBAC), CTS-040/042/044 (layers, telemetria e atualização) e CTS-043 (shape real das ordens). CTS-003 mantém migração/modelagem mesmo se o happy path passar; CTS-024/025 e CTS-039 são principalmente gates de não regressão.

## 7. Conclusões para a futura “Fase 2” de implementação

1. Recuperar o produto atual, corrigir fundação e evoluir o target precisam ser trilhas separadas, embora compartilhem gates.
2. `TenantContext`, autoridade plataforma/tenant, baseline Prisma e testes são pré-condições; não devem ser diluídos em patches por tela.
3. Migração deve ocorrer por fatias verticais, removendo o noop somente quando UI, contrato, autorização, persistência e regressão estiverem fechados.
4. Company/Workspace, pessoa/usuário/cliente, WEEKLOG/financeiro e PDR são decisões de domínio, não simples CRUDs.
5. Documentos, fotos, marca e templates devem herdar um único modelo de ownership e lifecycle.
6. A 4B reduz incerteza de restauração e validação; ela não resolve decisões BUSINESS nem transforma gaps estruturais em ajustes locais.

## 8. Limite da entrega e referencial

Esta Fase 6 não executou runtime, não alterou produto, schema, Docker, migrations, dados, integrações ou credenciais e não produziu horas, prazo, preço, sprint ou proposta comercial.

Referencial: ISO/IEC 25010 (adequação funcional, segurança e manutenibilidade); ISO/IEC/IEEE 29148 (rastreabilidade e verificabilidade de requisitos); OWASP API Security Top 10 2023 (BOLA/BFLA/consumo); Evans e Vernon (bounded contexts e invariantes de domínio); Fowler (Strangler Fig e migração incremental); Gray & Reuter (unidades de trabalho, atomicidade e recuperação).
