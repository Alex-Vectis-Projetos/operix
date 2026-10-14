# CATALOG-001 — Catálogo automotivo global, normalização e enriquecimento

**Status:** proposta técnica para revisão e implementação • **Data:** 14/10/2026  
**Fontes:** levantamento do schema e inventário fornecido em `Texto colado(20261014-044635).txt`; reunião com Alex de 01/09/2026.  
**Limite de validação:** este documento não examinou diretamente os arquivos completos `schema.prisma`, `AGENTS.md`, `decisions.md` da Spec 003 nem o estado atual da aplicação. Nomes e campos novos abaixo são propostas, não contratos existentes confirmados. Não executar SQL/migrations sem comparar com o repositório.

## 1. Objetivo e decisões

Normalizar **104 entradas legadas** de `INTERVENTION_CATALOG` (32 `mechanics`, 18 `pdr`, 27 `body_paint`, 27 `assembly_disassembly`) e enriquecer serviços, sem reescrever snapshots existentes. O orçamento continuará a armazenar descrição, quantidade, preço e impostos congelados por revisão. A seleção terá referência opcional ao catálogo relacional. Um serviço pode ser combinado a região/peça, tipo de dano e método de execução; esses conceitos não são sinônimos.

**Confirmado em reunião:** Alex pediu serviços mais ricos (34:50–36:46), citou PDR, montagem/desmontagem, funilaria/pintura e mecânica (12:19), e preço manual pelo profissional (13:43–14:21). **Decisão de produto proposta:** biblioteca global PT/FR, visibilidade por workspace, taxonomia normalizada, sugestão de roteamento sem autorizar serviço, e rollout progressivo.

### Fora de escopo

Reprecificar contratos antigos; alterar `WeeklogEntry.servicesSnapshot` ou `PaymentListItem.servicesSnapshot` existentes; gerar serviço financeiro automaticamente ao selecionar catálogo; substituir o comando canônico de finalização da OS; automatizar preço de reparos pelo diâmetro de granizo; assumir novas taxas fiscais ou tempos de fabricante.

## 2. Semântica do domínio

- **Categoria** = agrupador hierárquico (ex.: Mecânica → Freios); não é um item cobrável por padrão.
- **Serviço catalogado** = intervenção executável (ex.: substituir pastilhas de freio), com unidade e categoria.
- **Operação** = verbo/tipo técnico (`diagnose`, `repair`, `replace`, `remove_install`, `paint`, `calibrate`, `inspect`, `clean`, `maintain`).
- **Região/peça** = entidade do veículo (`hood`, `roof`, `front_left_door`), opcional conforme serviço.
- **Tipo de dano** = `hail`, `dent_small`, `scratch`, etc.; não é sinônimo de intervenção.
- **Material** = componente orçamentário separado de mão de obra (tinta/verniz/primer), não serviço de execução.
- **Etapa operacional** = sugestão de roteamento, não autorização nem imposição de passo obrigatório.
- **Snapshot financeiro** = valor e descrição efetivamente aprovados/registrados na revisão e na consolidação, independentes do cadastro editável.

## 3. Modelagem relacional proposta (Prisma ilustrativo)

**Atenção:** os modelos abaixo são *novos*; ajustar `@relation`, nomes, tipos e políticas de delete ao schema real antes de aplicar. A FK `workspaceId` de itens locais deve referenciar `Workspace` conforme as constraints reais. IDs não conferem autorização; toda leitura/escrita deve usar `RequestContext.activeWorkspaceId`.

```prisma
model ServiceCategory {
  id          String   @id @default(uuid())
  code        String   @unique
  parentId    String?
  parent      ServiceCategory?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: Restrict)
  children    ServiceCategory[] @relation("CategoryTree")
  sortOrder   Int      @default(0)
  active      Boolean  @default(true)
  items       ServiceCatalogItem[]
  translations ServiceCategoryTranslation[]
  @@map("service_categories")
}

model ServiceCategoryTranslation {
  id         String @id @default(uuid())
  categoryId String
  locale     String // pt-BR / fr-FR
  name       String
  category   ServiceCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  @@unique([categoryId, locale])
  @@map("service_category_translations")
}

model ServiceCatalogItem {
  id                     String @id @default(uuid())
  code                   String
  workspaceId            String? // null = global
  categoryId             String
  operationType          String
  unitType               String // service/hour/panel/damage/part etc.
  requiresVehicleRegion  Boolean @default(false)
  requiresQuantity       Boolean @default(false)
  defaultStageCode       String?
  isActive               Boolean @default(true)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  category               ServiceCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  translations           ServiceCatalogTranslation[]
  workspaceConfigs       WorkspaceServiceConfig[]
  @@unique([id, workspaceId])
  @@index([categoryId, isActive])
  @@index([workspaceId, isActive])
  @@map("service_catalog_items")
}

model ServiceCatalogTranslation {
  id         String @id @default(uuid())
  itemId     String
  locale     String
  name       String
  description String?
  item       ServiceCatalogItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@unique([itemId, locale])
  @@map("service_catalog_translations")
}

model WorkspaceServiceConfig {
  id           String @id @default(uuid())
  workspaceId  String
  catalogItemId String
  enabled      Boolean @default(true)
  customLabel  String?
  defaultPrice Decimal? @db.Decimal(12, 2)
  currencyCode String? // must accompany price; enforce in domain/SQL
  defaultStageCode String?
  catalogItem  ServiceCatalogItem @relation(fields: [catalogItemId], references: [id], onDelete: Restrict)
  @@unique([workspaceId, catalogItemId])
  @@map("workspace_service_configs")
}
```

### Unicidade de `code` com `workspaceId` anulável

`@@unique([workspaceId, code])` isolado **não garante** unicidade global com `NULL` em PostgreSQL. Adicionar índices SQL parciais:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_items_global_code_uq
  ON service_catalog_items (code) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_items_local_code_uq
  ON service_catalog_items (workspace_id, code) WHERE workspace_id IS NOT NULL;
```

Se `workspaceId` for um namespace e não um campo Prisma mapeado, ajustar `@map("workspace_id")` ou os índices conforme a migração gerada. `@@unique([id, workspaceId])` não valida a visibilidade de itens globais em FKs compostas: adotar verificação de acesso na camada de serviço e, onde possível, policies SQL/RLS específicas. Uma configuração de workspace só pode apontar a item global ou item de propriedade do mesmo workspace.

### Referências aditivas

- `ProductionTask.catalogItemId String?` com FK opcional `ON DELETE SET NULL` (preferir soft-disable de itens).
- Para novos itens de orçamento, adicionar ao JSON `catalogItemId?`, `catalogCode?`, `catalogVersion?` como metadados; continuar congelando `description`, `quantity`, `unit_price`, `total`, `carPartCode` onde aplicável.
- `VehicleDamagePoint` segue independente, ligado a peças/danos; referência ao item comercial deve ser explicitamente modelada quando necessária, não inferida só por `contracted=true`.
- `BudgetRevision`, `ProductionOrder.performedServices`, `WeeklogEntry` e `PaymentListItem` permanecem com formatos legados aceitos.
- Não usar cascade-delete de item catalogado para apagar `ProductionTask` nem lançamentos históricos.

## 4. Catálogo de famílias alvo

| Código | Categoria global | Tipo | Etapa sugerida (somente quando aplicável) |
|---|---|---|---|
| pdr | PDR / granizo | especialidade | PDR |
| assembly_disassembly | Montagem/desmontagem | especialidade | Desmontagem / Montagem |
| bodywork | Funilaria e carroceria | especialidade | Funilaria |
| paint | Pintura e acabamento | especialidade | Preparação de Pintura / Pintura |
| mechanics | Mecânica geral | especialidade | Mecânica |
| brakes_suspension | Freios, direção e suspensão | especialidade | Mecânica |
| electrical_adas | Elétrica, eletrônica e ADAS | especialidade | Mecânica / Diagnóstico |
| diagnostics | Diagnóstico e inspeção | especialidade | Diagnóstico |
| glass_exterior | Vidros e externos | especialidade | Desmontagem / Montagem |
| wheels_tires | Rodas e pneus | especialidade | Mecânica |
| hvac | Climatização | especialidade | Mecânica |
| detailing | Estética e detalhamento | especialidade | Conferência / acabamento |

A descrição das 104 entradas legadas e sua classificação preliminar está no artefato irmão `operix_catalog_legacy_mapping.csv`. `legacy.*` é **identificador de reconciliação proposto**, não substituto automático de códigos oficiais. Critérios de disposição: `service_candidate` (possível intervenção), `review_generic_or_classification` (genérico/grupo), `damage_or_attribute` (avaria/atributo), `method_or_assessment` (método/avaliação). Todos marcados `pending`: classificação sujeita a auditoria.

## 5. Pacote inicial de serviços candidatos novos (PT/FR)

A lista abaixo **não é um seed homologado**: verificar contra os 104 legados e desduplicar por significado, categoria e operação. Nenhuma linha traz preço obrigatório.

| Code candidato | Português | Français | Família | Unidade sugerida |
|---|---|---|---|---|
| pdr.hail_panel_repair | Reparação PDR de painel por granizo | Débosselage sans peinture d'un panneau grêlé | pdr | panel |
| pdr.glue_pulling | Reparação PDR por tração com cola | Débosselage sans peinture par collage | pdr | service |
| pdr.dent_access_internal | Acesso interno para reparação PDR | Accès intérieur pour débosselage sans peinture | pdr | service |
| pdr.dent_access_limited | Reparação PDR com acesso limitado | Débosselage sans peinture à accès limité | pdr | service |
| assembly.remove_headliner | Remoção do forro de teto | Dépose de la garniture de pavillon | assembly_disassembly | service |
| assembly.install_headliner | Reinstalação do forro de teto | Repose de la garniture de pavillon | assembly_disassembly | service |
| assembly.remove_door_trim | Remoção do acabamento da porta | Dépose de la garniture de porte | assembly_disassembly | service |
| assembly.install_door_trim | Reinstalação do acabamento da porta | Repose de la garniture de porte | assembly_disassembly | service |
| bodywork.panel_straightening | Endireitamento de painel | Redressage de panneau | bodywork | panel |
| bodywork.structural_measurement | Medição da geometria estrutural | Mesure de la géométrie de caisse | bodywork | service |
| paint.color_matching | Ajuste de cor e colorimetria | Recherche de teinte et colorimétrie | paint | service |
| paint.blending | Transição de pintura entre painéis | Raccord de peinture entre éléments | paint | panel |
| paint.undercoat_application | Aplicação de fundo preparador | Application d'apprêt | paint | panel |
| paint.clearcoat_application | Aplicação de verniz | Application de vernis | paint | panel |
| paint.post_paint_polish | Polimento após pintura | Polissage après peinture | paint | panel |
| mechanics.engine_oil_change | Troca de óleo do motor | Vidange d'huile moteur | mechanics | service |
| mechanics.coolant_pump_replace | Substituição da bomba d'água | Remplacement de pompe à eau | mechanics | service |
| mechanics.clutch_replace | Substituição da embreagem | Remplacement de l'embrayage | mechanics | service |
| brakes.front_pad_replace | Substituição de pastilhas dianteiras | Remplacement des plaquettes avant | brakes_suspension | axle |
| brakes.brake_fluid_change | Troca de fluido de freio | Remplacement du liquide de frein | brakes_suspension | service |
| suspension.damper_replace | Substituição de amortecedor | Remplacement d'amortisseur | brakes_suspension | part |
| electrical.battery_test | Teste de bateria | Contrôle de batterie | electrical_adas | service |
| adas.camera_calibration | Calibração de câmera ADAS | Calibrage de caméra ADAS | electrical_adas | service |
| adas.radar_calibration | Calibração de radar ADAS | Calibrage de radar ADAS | electrical_adas | service |
| diagnostics.pre_repair_scan | Diagnóstico eletrônico pré-reparação | Diagnostic électronique avant réparation | diagnostics | service |
| diagnostics.post_repair_scan | Diagnóstico eletrônico pós-reparação | Diagnostic électronique après réparation | diagnostics | service |
| glass.windshield_replace | Substituição de para-brisa | Remplacement de pare-brise | glass_exterior | part |
| wheels.tire_balance | Balanceamento de roda | Équilibrage de roue | wheels_tires | wheel |
| hvac.leak_diagnosis | Diagnóstico de fuga do ar-condicionado | Recherche de fuite de climatisation | hvac | service |
| detailing.delivery_clean | Limpeza de entrega | Nettoyage avant restitution | detailing | service |

Revisar traduções francesas com especialista local antes de disponibilização comercial. Para tarefas com implicação de segurança (estrutura, airbags, ADAS, refrigerante, freios), catálogo não substitui procedimento do fabricante, certificações ou legislação aplicável. Diâmetros/gradações de granizo e tempos não devem ser impostos globalmente sem validação técnica.

## 6. APIs propostas (contratos a validar contra rotas existentes)

- `GET /api/service-catalog/categories?locale=fr-FR` — árvore de categorias visíveis.
- `GET /api/service-catalog/items?categoryCode=...&q=...&locale=...&active=true&cursor=...` — paginação, busca e efetiva combinação global/local.
- `GET /api/service-catalog/items/:id` — definição e compatibilidades; item global ou do workspace ativo.
- `POST /api/service-catalog/items` — criar item **local** no workspace ativo; sem opção de criar global por esta rota.
- `PATCH /api/service-catalog/items/:id` — editar item **local** pertencente ao workspace ativo.
- `PATCH /api/workspace/service-catalog/:itemId` — ativar/desativar, nome local, preço sugerido, setor sugerido.
- `POST /api/budgets/:id/revisions` — manter contrato existente, permitir metadados opcionais de catálogo em linhas; servidor valida acesso a IDs fornecidos.

Contrato de item retornado (exemplo ilustrativo):

```json
{
  "id": "uuid",
  "code": "paint.blending",
  "categoryCode": "paint",
  "locale": "fr-FR",
  "name": "Raccord de peinture entre éléments",
  "unitType": "panel",
  "operationType": "paint",
  "source": "system",
  "enabledForWorkspace": true,
  "defaultPrice": null,
  "currencyCode": null,
  "defaultStageCode": "paint"
}
```

Regras API: autorização por `activeWorkspaceId`, permissão de gerenciamento de catálogo local distinta de leitura, validação de UUID e code, `Decimal` serializado como string em contratos monetários, paginação, limite de busca, auditoria de mudanças e erros sem divulgar dados entre tenants. `defaultPrice` é sugestão configurável, nunca substitui preço congelado no orçamento.

## 7. Migração e rollout sem alterar históricos

1. **Inspecionar repositório e ambiente:** confirmar schema e relações, formatos exatos dos payloads e endpoints, regras `AGENTS.md`/Spec 003, e revisar backups/restauração de staging.
2. **Migration aditiva:** criar tabelas de catálogo, traduções, configs e índices parciais. Nunca alterar JSON histórico.
3. **Seed idempotente:** `upsert` de categorias globais e itens por código com índice adequado. Distinguir inserção de alteração semântica: códigos publicados não podem ser reaproveitados para serviço diferente.
4. **Tabela de aliases legados:** `LegacyServiceAlias` proposta com `legacyCategory`, `legacyLabel`, `locale`, `catalogItemId?`, `resolution` e `reviewedBy?`; não exigir correspondência 1:1 para rótulos genéricos.
5. **Enriquecimento:** inserir novos itens após desduplicação; habilitar subconjunto PDR/R&I no piloto, outras famílias por workspace.
6. **Compatibilidade dupla:** front-end usa novo serviço de leitura sob feature flag; fallback legado enquanto migração é validada. Gravações novas usam snapshots com metadados opcionais.
7. **Produção:** adicionar `catalogItemId?` em tarefas novas; preservar `serviceCategory`, `carPartCode`, `description`, `commercialAmount` como dados operacionais efetivos.
8. **Observabilidade e ativação:** verificar erros de seleção, itens não resolvidos, visibilidade por tenant, custo de queries, desempenho de orçamento; ativar progressivamente.
9. **Rollback:** desligar feature flag e voltar ao catálogo anterior; manter tabelas novas sem drop destrutivo até migração estabilizar.

## 8. Critérios de aceite e testes obrigatórios

- Os **104** rótulos legados estão reconciliados no inventário; nenhum foi apagado ou assumido automaticamente como intervenção executável.
- Consulta por idioma retorna PT/FR e fallback explícito quando tradução não existe.
- Itens globais visíveis a todos os workspaces habilitados; itens locais visíveis apenas ao proprietário; workspace A não lê/edita item local de B, mesmo por UUID conhecido.
- Tentativa de criar o mesmo `code` global 2 vezes falha no banco; mesmo `code` local no mesmo workspace falha; códigos locais iguais em workspaces diferentes não conflitam.
- Seeds executados duas vezes não criam linhas duplicadas nem renomeiam serviços históricos.
- Novos orçamentos conservam descrições, unidades, valores `Decimal(12,2)` e IVA próprios; renomear um serviço não altera uma `BudgetRevision` antiga.
- Importação de `performedServices` avulsa e leitura de `ServiceOrder` legada continuam funcionando.
- `ProductionTask` sem `catalogItemId` continua válida e legível; criação com ID de outro workspace é rejeitada.
- A sugestão de etapa de produção não cria tarefas não autorizadas, não modifica OS finalizada e não contorna o comando canônico de finalização.
- `WeeklogEntry.servicesSnapshot` e `PaymentListItem.servicesSnapshot` não são alterados por seeds, tradução, edição ou desativação de catálogo.
- Export do orçamento e impressão permanecem consistentes em PT/FR, com fallback documentado.
- Testar rollback da feature flag, paginação, busca, concorrência e cenário sem preço sugerido.

## 9. Checklist de arquivos/contratos a confirmar no repositório antes do PR

- `prisma/schema.prisma` completo, nomes das relações, índices e migrações existentes.
- `src/components/production/BudgetDialog.tsx`, `INTERVENTION_CATALOG` e persistência da revisão.
- `src/components/production/VehicleBlueprint5Views.tsx`, `CAR_PARTS`, `DAMAGE_TYPES`.
- APIs e serviços de `ProductionTask`, `ProductionOrder`, WEEKLOG e listas.
- `AGENTS.md` e `specs/003-production-weeklog/decisions.md` para operações terminais/retificações.
- Políticas reais de exclusão, RLS, tenants, currencies e internacionalização.

**Gate para código:** design de esquema + tabela de aliases revisados, auditoria de todos os writes de orçamento e contratos imutáveis verificada. Este documento serve como especificação de implementação, **não** como comprovação de que as migrações foram aplicadas.
