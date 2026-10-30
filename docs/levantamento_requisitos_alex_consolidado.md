# Levantamento Consolidado de Requisitos, Correções e Melhorias

**Sistema:** Plataforma de gestão de orçamentos, produção e WEEKLOG  
**Solicitante dos ajustes:** Alex  
**Fontes:** Vídeos de levantamento — Partes 1, 2 e 3  
**Data da consolidação:** 30/10/2026  
**Natureza:** Registro de requisitos para avaliação, implementação e homologação; não representa funcionalidades já entregues.

## 1. Objetivo e escopo

Consolidar as demandas apontadas por Alex nos três vídeos, abrangendo:

- Criação de orçamentos, geração de PDF e mapeamento visual (Blueprint);
- Cadastro de danos, intervenções e modelos de precificação;
- Aprovação de orçamentos, criação/importação de ordens de serviço (OS) e Kanban de produção;
- Cadastro de colaboradores e atribuição de responsáveis;
- Finalização de serviços, histórico de produção e integração com o WEEKLOG;
- Validação de lotes, identificação da empresa responsável e organização dos documentos operacionais.

**Legenda:** `BUG` = comportamento incorreto; `MELHORIA` = ajuste de experiência ou funcionalidade existente; `NOVO` = funcionalidade nova; `REGRA` = mudança de regra de negócio; `ARQUITETURA` = ajuste de estrutura ou fonte de dados.

## 2. Parte 1 — Orçamentos, PDF e Blueprint

### 2.1. PDF do orçamento

#### ORC-01 — Ajustar elementos visuais do PDF

- **Tipo:** MELHORIA
- **Referência:** Parte 1, 00:30–01:40
- **Contexto:** A estrutura da folha de orçamento foi aprovada, com ajustes pontuais de apresentação.
- **Requisitos:**
  - Aumentar o logotipo/símbolo no canto superior esquerdo.
  - Subir a caixa preta do título `PROTOCOLE DE REPARATION`, ampliando a separação visual entre título e blocos de dados.
- **Critério de aceite:** O PDF gerado apresenta logotipo maior e título reposicionado sem sobrepor outros elementos.

#### ORC-02 — Gerar PDF no idioma ativo do sistema

- **Tipo:** BUG / MELHORIA
- **Referência:** Parte 1, 00:30–01:40
- **Problema:** O PDF permanece em francês mesmo quando a interface está em português.
- **Requisito:** Internacionalizar os textos do PDF e utilizar o idioma ativo no momento da geração: português, francês ou inglês.
- **Critério de aceite:** A mesma proposta, gerada com cada um dos três idiomas ativos, apresenta rótulos e títulos coerentes com o idioma selecionado.

### 2.2. Fluxo de criação do orçamento

#### ORC-03 — Remover etapa de seleção de serviço do scanner

- **Tipo:** MELHORIA
- **Referência:** Parte 1, 01:45–02:22
- **Problema:** `Escanear documento` abre o pop-up `Passo 1/2 — Qual o tipo de serviço?` antes do envio/captura do documento.
- **Requisito:** Ao acionar `Escanear documento`, abrir diretamente a interface de upload/câmera, sem a etapa de escolha entre Mecânica, Funilaria, Martelinho e Montagem.
- **Critério de aceite:** Um clique em `Escanear documento` leva diretamente ao carregamento ou captura do arquivo.

#### ORC-04 — Posicionar `Tipo de orçamento` antes do Blueprint

- **Tipo:** MELHORIA
- **Referência:** Parte 1, 01:45–02:22
- **Problema:** O campo está localizado na seção inferior `Diagnóstico / Intervenção`.
- **Requisito:** Mover `Tipo de orçamento` para o início do formulário, antes de `Mapeamento Visual (Blueprint)`.
- **Critério de aceite:** O tipo de orçamento pode ser definido antes da interação com o mapa do veículo.

### 2.3. Modelos e identificação de peças no Blueprint

#### BLP-01 — Incluir carrinha/caminhão leve com caçamba aberta

- **Tipo:** NOVO
- **Referência:** Parte 1, 02:23–04:15
- **Requisito:** Adicionar ao catálogo de carrocerias o veículo com frente semelhante à van e carroceria aberta atrás, nas variantes:
  - Cabine simples;
  - Cabine dupla.
- **Observação:** Preservar os modelos já existentes de Van e Furgão.
- **Critério de aceite:** Ambas as variantes estão disponíveis na seleção de modelos e podem ser mapeadas visualmente.

#### BLP-02 — Corrigir regiões superiores das laterais da Van

- **Tipo:** BUG
- **Referência:** Parte 1, 02:23–04:15
- **Problema:** Nas vistas `4 — Lateral Esquerda` e `5 — Lateral Direita`, cliques na região superior e até em pontos mais baixos da lateral são identificados como `Teto`.
- **Requisito:** Ajustar as áreas clicáveis para identificar, conforme a vista e a posição:
  - Coluna direita dianteira;
  - Coluna direita traseira;
  - Coluna esquerda dianteira;
  - Coluna esquerda traseira.
- **Critério de aceite:** Cliques nas colunas laterais selecionam a peça correspondente, sem serem atribuídos indevidamente ao teto.

### 2.4. Cadastro de danos e precificação

#### DAN-01 — Ampliar escala de diâmetro/tamanho da mossa

- **Tipo:** MELHORIA
- **Referência:** Parte 1, 04:18–07:58
- **Situação atual:** Níveis de 1 a 5.
- **Requisito:** Disponibilizar níveis sequenciais de 1 a 10, **preferencialmente de 1 a 15**.
- **Contexto operacional:** Diferentes ocorrências de granizo produzem tamanhos variados; Alex também utiliza níveis superiores (a partir do 8) para caracterizar danos associados a batidas/acidentes.
- **Critério de aceite:** O editor permite selecionar os níveis definidos e persiste corretamente o tamanho informado.
- **Ponto a confirmar:** Adotar definitivamente a escala 1–10 ou 1–15 e estabelecer o significado técnico de cada nível.

#### DAN-02 — Compatibilizar tipos de dano com a escala ampliada

- **Tipo:** MELHORIA / REGRA
- **Referência:** Parte 1, 04:18–07:58
- **Requisito:** Revisar a lista `Tipo de Dano / Avaria` — por exemplo: Granizo, Amassado Leve, Médio, Severo, Vinco e Substituição da Peça — para manter coerência com os novos níveis de tamanho.
- **Critério de aceite:** Tipo de dano e nível de mossa podem ser registrados de forma consistente, sem classificações contraditórias.

#### DAN-03 — Exibir total geral de mossas no dossiê

- **Tipo:** NOVO
- **Referência:** Parte 1, 04:18–07:58
- **Requisito:** No `Dossiê Consolidado por Peça`, mostrar um total geral que some a quantidade de mossas registrada em todas as peças do veículo.
- **Exemplo:** 80 mossas no teto + 60 no guarda-lamas = 140. Alterando o teto para 40, o total deve passar automaticamente para 100.
- **Critério de aceite:** O total se atualiza ao adicionar, editar ou remover quantidades de qualquer peça.

#### PRE-01 — Adicionar precificação global `Conjunto / Preço por Tudo`

- **Tipo:** NOVO / REGRA
- **Referência:** Parte 1, 04:18–07:58
- **Situação atual:** `Fixo (Peça)` e `Por Mossa` por peça.
- **Requisito:** Oferecer uma terceira modalidade para estabelecer um único preço fechado para o conjunto de danos do veículo, sem obrigatoriedade de precificar individualmente cada peça.
- **Exemplo:** Veículo com 800 mossas no total, cobrado por um valor global negociado.
- **Critério de aceite:** É possível cadastrar o preço global, exibir o total de mossas e calcular o orçamento sem duplicar a cobrança de itens já abrangidos pelo conjunto.

### 2.5. Catálogo de intervenção

#### INT-01 — Incluir opção genérica `Reparação PDR`

- **Tipo:** MELHORIA
- **Referência:** Parte 1, 08:00–08:23
- **Requisito:** Ao selecionar `Martelinho / PDR` em `Diagnóstico / Intervenção`, manter os tipos detalhados atuais e adicionar uma entrada simples `Reparação PDR` (ou `Reparação em PDR`).
- **Critério de aceite:** O usuário pode escolher a intervenção genérica sem percorrer opções descritivas mais longas.

## 3. Parte 2 — Aprovação, ordens de serviço e produção

### 3.1. Orçamento aprovado e entrada no Kanban

#### FLX-01 — Corrigir status após assinatura e salvamento

- **Tipo:** BUG / REGRA
- **Referência:** Parte 2, 00:08–01:38
- **Problema:** O orçamento `ORC-2026-0016`, de Maria de Lurdes, exibiu `Orçamento aprovado — Assinado por Maria de Lurdes` após a assinatura, mas continuou como `Rascunho` na listagem após `Salvar Orçamento`.
- **Requisito:** Persistir o estado de aprovação associado à assinatura válida.
- **Critério de aceite:** Após assinar e salvar, o orçamento é apresentado como `Aprovado` também na listagem principal e ao reabrir o registro.

#### FLX-02 — Enviar orçamento aprovado automaticamente à produção

- **Tipo:** BUG / REGRA
- **Referência:** Parte 2, 00:08–01:38
- **Problema:** Os orçamentos `ORC-2026-0016` (Maria de Lurdes) e `ORC-2026-0015` (José Carlos) não apareceram em `Em Produção` após finalização/aprovação.
- **Requisito:** O orçamento aprovado e salvo deve gerar ou alimentar automaticamente a entrada correspondente no Kanban, em `Aguardando Início` ou no estágio inicial aplicável.
- **Critério de aceite:** O orçamento aprovado aparece no Kanban com dados vinculados e sem criar registros duplicados em salvamentos posteriores.

#### ASS-01 — Revisar estabilidade da captura de assinatura

- **Tipo:** BUG (regressão a verificar)
- **Referência:** Parte 2, 00:08–01:38
- **Contexto:** Houve falhas anteriores nas assinaturas desenhada e automática; no teste com Maria de Lurdes, a coleta funcionou.
- **Requisito:** Validar ambas as formas de assinatura e a persistência do resultado.
- **Critério de aceite:** É possível assinar, salvar e reabrir o orçamento sem bloqueio, perda da assinatura ou inconsistência de status.

### 3.2. Modal `+ Nova Ordem` e importação por OCR

#### OS-01 — Editar diretamente os cards de Cliente e Veículo

- **Tipo:** MELHORIA
- **Referência:** Parte 2, 01:39–05:33
- **Problema:** Após `OCR: Importar ordem`, os cards superiores `Cliente e Contato` e `Veículo` são somente leitura, e os campos editáveis aparecem duplicados abaixo.
- **Requisito:** Eliminar os campos duplicados (`Nome (edição)`, `Marca`, `Modelo`, `Placa`, `VIN`, `Cor`) e permitir edição diretamente nos cards originais, inclusive para campos vazios, `null` ou `—`.
- **Campos citados:** Nome, telefone, e-mail, documento, marca, modelo, placa, VIN, cor, ano e quilometragem (KM).
- **Critério de aceite:** Após OCR de uma OS em papel/PDF, qualquer informação incorreta ou ausente pode ser corrigida no próprio card antes de salvar.

#### OS-02 — Cadastrar múltiplos serviços manuais com valores

- **Tipo:** MELHORIA / NOVO
- **Referências:** Parte 2, 03:40–05:33 e 08:16–08:54
- **Contexto:** No fluxo `+ Nova Ordem`, a OS pode ser importada de documento externo e não utilizar o Blueprint.
- **Requisitos:**
  - Disponibilizar um mecanismo de adicionar/confirmar serviços (`+` ou `+ Novo serviço`) na seção `Intervenção / Serviços`, **antes de `Valor Total do Orçamento`**.
  - Permitir descrição e valor individual de cada item.
  - Acrescentar sucessivos serviços à lista, sem substituir os anteriores.
  - Recalcular automaticamente o card verde `Valor Total do Orçamento`.
- **Exemplos:** `DSP`; `Substituição do Capô`; `255 amassados 3 cm > Porta Dianteira Direita`.
- **Critério de aceite:** O usuário inclui vários serviços e respectivos preços, visualiza a lista consolidada e obtém a soma correta no total.

### 3.3. Colaboradores como origem dos responsáveis

#### CAD-01 — Unificar seletores operacionais em `Cadastros > Colaboradores`

- **Tipo:** ARQUITETURA / MELHORIA
- **Referências:** Parte 2, 05:38–06:36; Parte 3, 03:40–03:55
- **Problema:** Seletores de `Responsável` e `Técnico` utilizam os registros de `Contas > Usuários` (ex.: Alex Souza, Carlos Tech, Alice Client), em vez do cadastro de profissionais.
- **Requisitos:**
  - Remover o item de menu `Usuários` da navegação lateral em `Contas`.
  - Utilizar `Cadastros > Colaboradores` (antigo `Pessoas`) como fonte dos seletores de responsáveis técnicos, operacionais e de produção.
  - Aplicar a mesma origem aos campos do WEEKLOG, inclusive na revisão da importação OCR.
  - Considerar os profissionais já cadastrados (ex.: Nuno Silva, Souza, Steven FLEY).
- **Critério de aceite:** Todos os seletores operacionais exibem colaboradores válidos e não a lista antiga de usuários.
- **Atenção técnica:** Remover o menu não significa excluir indiscriminadamente contas de autenticação; é necessário preservar acessos e vínculos existentes durante a migração.

### 3.4. Conclusão de serviços e transferência

#### PRD-01 — Finalização da OS atualiza Kanban e WEEKLOG

- **Tipo:** REGRA / AUTOMAÇÃO
- **Referência:** Parte 2, 07:12–08:05
- **Contexto:** `Início` e `Previsão de conclusão` já são editáveis adequadamente.
- **Requisito:** Ao preencher `Concluído em` (ou concluir a OS pela ação correspondente) e salvar, mover a ordem para `Finalizado` em Produção e registrar/transferir o serviço para o WEEKLOG.
- **Critério de aceite:** A OS não permanece em etapas iniciais após conclusão e seu registro fica disponível no WEEKLOG sem duplicação.
- **Dependência:** Definir a `Empresa Responsável` no momento da transferência, conforme `WL-07`.

## 4. Parte 3 — Histórico, WEEKLOG e documentos operacionais

### 4.1. Histórico da produção

#### PRD-02 — Arquivar itens finalizados após sete dias

- **Tipo:** NOVO / REGRA
- **Referência:** Parte 3, 00:08–00:59
- **Problema:** A coluna `Finalizado` tende a acumular muitos cartões.
- **Requisito:** Manter cada serviço concluído em `Finalizado` por **7 dias** e, após esse período, removê-lo do Kanban ativo para uma nova aba `Histórico` dentro de Produção, ao lado de `Orçamentos` e `Em Produção`.
- **Critério de aceite:** Ordens concluídas há até 7 dias permanecem visíveis em `Finalizado`; após o prazo, continuam consultáveis em `Histórico`, sem perda de dados.

### 4.2. Validação e assinatura de lotes do WEEKLOG

#### WL-01 — Importações manuais iniciam `Aguardando Validação`

- **Tipo:** BUG / REGRA
- **Referência:** Parte 3, 01:20–02:27
- **Problema:** Lotes importados manualmente, como `PDR` e `Andrezieux`, recebem imediatamente o status `Validado`.
- **Requisito:** Novos lotes importados manualmente devem iniciar em `Aguardando Validação`.
- **Critério de aceite:** Um lote recém-importado só muda para `Validado` após o fluxo formal de validação.

#### WL-02 — Desbloquear assinatura manuscrita no modal de validação

- **Tipo:** BUG
- **Referência:** Parte 3, 01:20–02:27
- **Problema:** A aba `Manuscrita (PNG)` exibe cursor de proibido e impede o desenho.
- **Requisito:** Permitir capturar a assinatura manuscrita no componente de validação quando o perfil tiver permissão para assinar.
- **Critério de aceite:** O quadro aceita os traços, permite confirmar e mantém a assinatura vinculada ao lote.

#### WL-03 — Corrigir falha ao abrir validação de lote já validado

- **Tipo:** BUG
- **Referência:** Parte 3, 02:18
- **Problema:** `Abrir Validação` em lote com status `Validado` provoca `Erro da Aplicação`.
- **Requisito:** Tratar corretamente o estado de lote já validado.
- **Critério de aceite:** O modal abre com as informações de validação ou visualização permitidas, sem derrubar a aplicação.

#### WL-04 — Permitir validação excepcional pelo administrador

- **Tipo:** NOVO / REGRA DE PERMISSÃO
- **Referência:** Parte 3, 01:20–02:27
- **Situação atual:** A auto-validação é bloqueada quando o usuário participou dos serviços do lote.
- **Requisito solicitado:** Disponibilizar ao administrador uma opção explícita para validar e assinar em substituição ao responsável habitual quando o chefe de oficina/gerente do cliente não puder fazê-lo, permitindo prosseguir para `Ordens de pagamento`.
- **Critério de aceite:** Somente perfis autorizados conseguem usar essa exceção e a validação registra quem efetivamente aprovou o lote.
- **Recomendação de governança:** Registrar justificativa, data/hora e identidade do administrador; não registrar a assinatura como se tivesse sido realizada pelo terceiro ausente.

### 4.3. Sincronização e semântica dos lotes

#### WL-05 — Exibir todos os lotes nas visões detalhadas do WEEKLOG

- **Tipo:** BUG / MELHORIA
- **Referência:** Parte 3, 04:03–08:50
- **Problema observado:** `Lotes Semanais (WEEKLOG Canônico)` apresenta 9 lotes (3 importados e 6 oriundos da Produção), mas `Arquivo Histórico / Legado - Leitura` apresenta apenas 2 acordeões/listas.
- **Requisito:** Disponibilizar uma lista detalhada correspondente a todos os lotes semanais, independentemente da origem, incluindo veículos, placas, técnicos e valores.
- **Critério de aceite:** Os 9 lotes do cenário de teste podem ser localizados nas respectivas visualizações detalhadas, sem registros omitidos ou duplicados.

#### WL-06 — Diferenciar proprietário do veículo e empresa parceira

- **Tipo:** REGRA / MODELO DE DADOS
- **Referência:** Parte 3, 04:03–08:50
- **Definições:**
  - **Produção — Cliente do veículo:** proprietário/segurado associado à OS (ex.: Sebastien Frecon, Maria de Lurdes, Test PO Link).
  - **WEEKLOG — Empresa Responsável:** empresa parceira que contratou os serviços e receberá a consolidação/faturamento B2B (ex.: KRAKEN, PDR-TEAM, QUALITY WORK).
- **Requisito:** No WEEKLOG, a dimensão `Cliente` deve representar a empresa responsável pelo lote, sem substituir os dados do proprietário do veículo na OS.
- **Critério de aceite:** Um veículo vinculado a uma pessoa na Produção aparece sob a empresa parceira correta no WEEKLOG.

#### WL-07 — Selecionar `Empresa Responsável` ao finalizar e transferir

- **Tipo:** NOVO / REGRA
- **Referência:** Parte 3, 07:16–08:28
- **Requisito:** Adicionar um seletor `Empresa Responsável` ao modal `Finalizar e transferir para WEEKLOG`, com opções provenientes de `Cadastros > Clientes` (clientes profissionais/empresas).
- **Comportamento:** Ao confirmar a finalização, enviar o serviço para o WEEKLOG já associado à empresa escolhida, permitindo o agrupamento correto em lotes (ex.: PDR-TEAM ou KRAKEN).
- **Critério de aceite:** A empresa escolhida persiste no registro transferido e orienta sua associação/agrupamento no WEEKLOG.
- **Dependência:** O mesmo dado precisa ser solicitado caso a conclusão seja realizada pelo campo `Concluído em`, e não apenas por arrastar o cartão no Kanban.

### 4.4. Organização dos documentos operacionais

#### DOC-01 — Corrigir isolamento da árvore de pastas

- **Tipo:** BUG / ARQUITETURA
- **Referência:** Parte 3, 08:52–09:39
- **Problema:** Na árvore `OPERACIONAL` do WEEKLOG, as pastas de 2026 (`HOMOLOG-R07C VECTIS > Plataforma > Documentos`) e 2027 (`Operações > Documentos`) exibem os mesmos itens, como `Week 40 - 2026`, `Week 43 - 2026` e `BMW SÉRIE 1`.
- **Requisito:** Isolar a consulta e a exibição dos arquivos conforme **Ano / Cliente / Plataforma / Semana**.
- **Critério de aceite:** Abrir a pasta de um ano, cliente ou plataforma não apresenta arquivos de outra origem, salvo quando realmente associados à mesma hierarquia.

## 5. Fluxo de negócio consolidado

1. **Orçamento:** selecionar tipo → opcionalmente importar documento → mapear danos/serviços → precificar → gerar PDF no idioma ativo.
2. **Aprovação:** coletar assinatura → salvar → registrar status `Aprovado`.
3. **Produção:** criar/associar automaticamente a OS e colocá-la na fila inicial do Kanban; também permitir importar OS externa por OCR.
4. **Execução:** atribuir responsáveis a partir de `Colaboradores`, registrar serviços, valores e datas.
5. **Conclusão:** marcar `Concluído em` ou finalizar pelo Kanban → selecionar `Empresa Responsável` → mover para `Finalizado` e transferir para WEEKLOG.
6. **WEEKLOG:** consolidar os serviços por empresa parceira/lote, disponibilizar a revisão/validação e registrar assinaturas.
7. **Pós-conclusão:** manter a OS finalizada no Kanban por 7 dias e depois exibi-la em `Histórico`; organizar documentos com separação por ano/cliente/plataforma/semana.

## 6. Dependências e pontos para definição

| Tema | Dependência ou definição necessária |
|---|---|
| Escala das mossas | Confirmar implementação de 1–10 ou 1–15 e a descrição de cada nível. |
| Precificação por conjunto | Definir como a modalidade global convive com itens individuais para impedir dupla cobrança. |
| Aprovação → Produção | Garantir transição transacional e idempotente: salvar novamente não deve duplicar OS. |
| Usuários × Colaboradores | Definir migração e vínculo entre identidades de login, permissões e registros profissionais. |
| Conclusão → WEEKLOG | Exigir ou tratar seleção da empresa responsável em todos os caminhos de conclusão. |
| Lotes e visualizações | Confirmar o papel da aba `Arquivo Histórico / Legado - Leitura` e como ela deve exibir lotes canônicos. |
| Validação excepcional | Formalizar permissões, trilha de auditoria e representação correta de assinatura por substituição. |
| Histórico de produção | Definir contagem dos 7 dias a partir do registro efetivo de conclusão. |

## 7. Checklist de homologação

- [ ] Logotipo e título do PDF ajustados.
- [ ] PDF traduzido conforme português, francês e inglês.
- [ ] Scanner abre diretamente upload/câmera.
- [ ] `Tipo de orçamento` aparece antes do Blueprint.
- [ ] Carroceria de cabine simples e dupla adicionada.
- [ ] Cliques nas laterais da Van identificam as colunas corretas.
- [ ] Escala de mossas ampliada e tipos de dano revisados.
- [ ] Total geral de mossas é recalculado automaticamente.
- [ ] Preço por conjunto funciona sem dupla cobrança.
- [ ] `Reparação PDR` adicionada ao catálogo.
- [ ] Orçamento assinado persiste como `Aprovado`.
- [ ] Orçamento aprovado entra na Produção sem duplicatas.
- [ ] Assinaturas do orçamento funcionam de maneira estável.
- [ ] Dados dos cards de cliente e veículo são diretamente editáveis após OCR.
- [ ] Serviços manuais e seus preços alimentam o total da OS.
- [ ] Seletores de responsável/técnico utilizam `Colaboradores`.
- [ ] Conclusão atualiza Kanban e transfere a OS para o WEEKLOG.
- [ ] OS finalizadas passam ao Histórico após 7 dias.
- [ ] Lotes importados iniciam `Aguardando Validação`.
- [ ] Assinatura manuscrita no WEEKLOG funciona.
- [ ] Abertura de lote validado não causa erro da aplicação.
- [ ] Exceção administrativa de validação segue permissões e rastreabilidade.
- [ ] Todos os lotes são acessíveis nas visualizações detalhadas.
- [ ] WEEKLOG distingue cliente do veículo e empresa responsável.
- [ ] Modal de conclusão permite selecionar a empresa responsável.
- [ ] Documentos respeitam ano, cliente, plataforma e semana.
