# Fase 6.5 — Minimum Viable 4B

**Status**: plano mínimo; nenhum teste executado  
**Origem**: redução dos 74 casos de `runtime-test-plan.md`  
**Ambiente obrigatório**: local, descartável, sanitizado, dois workspaces e egress bloqueado por padrão

## 1. Critério de redução

Permanecem somente cenários capazes de mudar materialmente a classificação do gap, o reaproveitamento, a prioridade ou a decisão “recuperar versus reconstruir”. Controles já provados estaticamente, integrações sem relação com os 14 CTS prioritários e testes úteis apenas para implementação foram removidos deste mínimo — não invalidados.

Um cenário pode conter vários checkpoints, mas usa uma única preparação, sessão e coleta correlacionada. Resultado misto deve ser registrado por checkpoint, sem converter sucesso parcial em `PASS` global.

## 2. Cenários mínimos

### MV4B-01 — Produção: criar, recarregar e percorrer estados

- **Classificação**: MUST RUN BEFORE PROPOSAL
- **CTS cobertos**: CTS-001, CTS-002, CTS-004
- **Hipótese**: UI, POST, modelo e PATCH existentes permitem recuperar a criação direta e o ciclo de estados sem reconstruir o módulo.
- **Pré-condição**: laboratório A/B; usuário owner/admin de A; cliente e dados sintéticos; API/DB ativas; sem integrações externas.
- **Ação**: abrir Nova Ordem, criar OP diretamente em “Em Produção”, recarregar/listar, pausar, retomar/finalizar e recarregar novamente.
- **Evidência necessária**: requests/responses sanitizados, IDs fictícios, estado antes/depois no banco, screenshots dos checkpoints e ausência de chamadas Supabase/produção.
- **Impacto se passar**: mantém `REQUER VALIDAÇÃO RUNTIME` resolvido positivamente e sustenta reutilização alta; backlog concentra regressão, timeline e fundação tenant.
- **Impacto se falhar**: reclassifica os CTS afetados para `BUG / RESTAURAÇÃO`; localiza a falha em UI, contrato ou persistência e amplia a recuperação do core.
- **Altera escopo?** Sim — define recuperar fluxo existente ou restaurar múltiplas camadas.
- **Altera prioridade?** Sim — falha no core eleva a correção antes das evoluções.

### MV4B-02 — Empresa ativa e acesso de membros

- **Classificação**: MUST RUN BEFORE PROPOSAL
- **CTS cobertos**: CTS-009, CTS-027
- **Hipótese**: switcher e REST de memberships são reutilizáveis, embora G1–G3 continuem obrigatórios para corrigir autoridade e isolamento.
- **Pré-condição**: workspaces A/B; owner com membership em ambos; admin/técnico apenas em A; sentinelas de dados distintas; egress bloqueado.
- **Ação**: alternar A↔B no seletor e confirmar contexto/branding/dados; entrar como membro A e exercer somente o vínculo permitido, incluindo controle negativo sobre B.
- **Evidência necessária**: sequência de contexto, chamadas e respostas por workspace, claims redigidas, consultas/contagens A/B e before/after de memberships.
- **Impacto se passar**: preserva componentes de switch/members e restringe o redesenho à autoridade, `Company` e `TenantContext`.
- **Impacto se falhar**: amplia F0/F2 para reconstrução do contexto e/ou fluxo de acesso; qualquer cruzamento A→B confirma prioridade P0.
- **Altera escopo?** Sim — decide quanto da troca de contexto e membership pode ser conservado.
- **Altera prioridade?** Sim — vazamento ou escalada prevalece sobre backlog funcional.

### MV4B-03 — Persistência cadastral mínima

- **Classificação**: MUST RUN BEFORE PROPOSAL
- **CTS cobertos**: CTS-022, CTS-028, CTS-033, CTS-034, CTS-037
- **Hipótese**: People, requisitos documentais por país e Location possuem cadeias REST recuperáveis; o desaparecimento de Local pode ser defeito localizado ou consequência sistêmica de contrato/tenant.
- **Pré-condição**: owner/admin A; Location e Colaborador sintéticos; requisito documental descartável ou registro preexistente do dataset; snapshot do banco.
- **Ação**: editar status do colaborador; listar/editar requisito por país sem remodelar; criar Local com endereço/contatos/gerente, salvar, recarregar, sair/entrar e reencontrar o registro.
- **Evidência necessária**: request/response por checkpoint, linhas before/after, reload real, filtros/listagens e prova de que B permaneceu inalterado.
- **Impacto se passar**: mantém alto reaproveitamento cadastral e limita o trabalho a tenancy, novos estados/GPS e vínculo canônico do gerente.
- **Impacto se falhar**: reclassifica somente os checkpoints falhos para restauração e identifica se o problema é transversal a People/Location/documentos.
- **Altera escopo?** Sim — especialmente para CTS-037 e para a extensão segura de Location.
- **Altera prioridade?** Sim — perda após salvar ou mistura de tenant antecede evolução de GPS/mapa.

### MV4B-04 — Mapa único, Radar e camadas operacionais

- **Classificação**: SHOULD RUN IF LAB AVAILABLE
- **CTS cobertos**: CTS-040, CTS-042, CTS-043, CTS-044
- **Hipótese**: a instância do mapa e os toggles podem ser preservados, mesmo que as fontes de Equipes/Ordens precisem de migração/redesenho.
- **Pré-condição**: browser isolado; mapa carregável; dados sintéticos de equipe/ordem A e B; provedores externos bloqueados ou sandbox/allowlist; captura de console/rede.
- **Ação**: ligar/desligar Radar, Operações, Equipes e Ordens em combinações; observar atualização imediata, vazio explícito e ausência de segundo mapa; confirmar que dados B não aparecem em A.
- **Evidência necessária**: screenshots comparáveis, estado de layers, rede/console sanitizados, origem de cada marcador e comparação A/B.
- **Impacto se passar**: confirma reuso alto do shell/toggles; backlog permanece focado em fonte real, tenancy e telemetria.
- **Impacto se falhar**: adiciona restauração do componente/provedor ao redesenho das fontes e pode antecipar o cluster F4.
- **Altera escopo?** Sim — distingue reaproveitar o mapa de reconstruir também sua camada de apresentação.
- **Altera prioridade?** Sim, mas abaixo de produção/tenant/persistência; por isso não bloqueia a proposta se o laboratório atrasar.

## 3. Resultado da redução

| Necessidade | Cenários | Quantidade |
|---|---|---:|
| MUST RUN BEFORE PROPOSAL | MV4B-01, MV4B-02, MV4B-03 | 3 |
| SHOULD RUN IF LAB AVAILABLE | MV4B-04 | 1 |
| CAN RUN DURING IMPLEMENTATION | nenhum dentro do mínimo | 0 |
| **Total mínimo** | **14 CTS cobertos em 4 cenários** | **4 de 74** |

Os outros 70 casos permanecem no plano completo para execução seletiva durante implementação, validação de segurança/performance ou quando uma mudança exigir seu gate. Eles não são condição automática para proposta.

## 4. Preparação da Fase 7

### Clusters que já podem ser fechados no nível macro

- **F3 — Documentos e storage**: retenção mínima de 180 dias está pronta para validação; archive/delete/backup e ownership são decisões de engenharia.
- **F6 — White-label e multilíngue**: target e gap são conhecidos; depende da fundação, mas não de nova decisão funcional para entrar no roadmap.

“Fechado no nível macro” não significa arquitetura definitiva, esforço final ou aceite runtime.

### Clusters condicionais

- **F0**: decisão sobre poderes Operix e evidência MV4B-02.
- **F1**: regra de falha OP→WEEKLOG/lista e evidência MV4B-01.
- **F2**: validação do cliente canônico/gerente, regra de desligamento, autoridade e MV4B-02/03.
- **F4**: validação de WEEKLOG/gerente e evidências MV4B-03/04.
- **F5**: versão pós-aprovação PDR e congelamento/reabertura do valor do técnico.
- **F7**: decisão de portfólio P02 sobre módulos legados sem CTS próprio.

### Prioridade que já pode ser preparada, sem iniciar a Fase 7

- **P0 técnico**: G1/G2/G3, isolamento por objeto/tenant, bootstrap administrativo, plano plataforma×tenant, baseline Prisma/testes e ownership documental/storage.
- **P1 candidato**: bugs estáticos e migrações do produto atual, incluindo timeline, falso sucesso Supabase, dados sintéticos do mapa e persistência cadastral que falhar no MV4B-03.
- **P2 candidato**: evolução local/UX sem impacto de segurança ou integridade, sempre depois das fundações.

Não devem receber esforço ou prazo final: restauração dos CTS do mínimo antes do resultado runtime; F0/F1/F2/F4/F5/F7 antes das decisões correspondentes; arquitetura PDR/financeira antes de B03/B04/B05/B07; módulos legados antes de P02; integrações externas antes de sandbox e política de egress.

## 5. Limite

Nenhum cenário foi executado. Este documento não autoriza 4B/5B, produção, migrations, criação de dados, acesso a provedores, implementação, estimativas ou Fase 7.

