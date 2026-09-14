# Registros de Decisões de Arquitetura (ADRs)

Este repositório registra todas as decisões de arquitetura e design estrutural tomadas no Operix. 

---

## 1. Por que usamos ADRs?
ADRs fornecem um registro histórico imutável e contextualizado das razões pelas quais escolhemos uma determinada solução técnica em detrimento de outras. Isso impede que agentes de IA ou novos engenheiros tentem reverter decisões previamente debatidas e aprovadas.

---

## 2. Estrutura Padrão de um ADR

Todo arquivo em `docs/adr/` deve seguir o formato numérico `XXX-titulo-descritivo.md` e conter as seguintes seções:

```markdown
# ADR-XXX: [Título da Decisão]

**Status**: [Proposto | Aceito | Substituído | Rejeitado]  
**Data**: YYYY-MM-DD  
**Decisores**: EverGreen Engineering Team  
**Fatia Afetada**: [Ex: R0 - Fundação, R1 - Operação]

## Contexto
Qual é o problema ou necessidade técnica/negocial que motivou esta decisão? Quais eram as limitações do código atual?

## Decisão
Qual é a solução arquitetural adotada? Quais padrões foram aplicados?

## Alternativas Consideradas
- **Alternativa A**: Prós e contras; por que foi descartada.
- **Alternativa B**: Prós e contras; por que foi descartada.

## Consequências
- **Positivas**: Ganhos de segurança, performance, clareza ou sustentabilidade.
- **Negativas / Trade-offs**: Complexidade adicional ou esforço de migração gerado.
```

---

## 3. Índice de ADRs Previstas (Backlog Canônico)

As seguintes ADRs estão mapeadas para formalização à medida que as respectivas fatias forem atacadas:

| ADR | Título | Status | Fatia |
|---|---|---|:---:|
| [ADR-001](001-request-context-and-tenancy.md) | RequestContext Mandatório e Isolamento Multi-Tenant Server-Side | **Aceito** | R0 |
| [ADR-002](002-user-person-membership-identity.md) | Desacoplamento Canônico de Identidade (User, Membership, Person) | *Planejada* | R0 |
| [ADR-003](003-canonical-client.md) | Unificação do Modelo de Cliente Operacional e Comercial | *Planejada* | R0 |
| [ADR-004](004-budget-revisions.md) | Versionamento Imutável de Orçamentos e Eliminação de LocalStorage | *Planejada* | R1 |
| [ADR-005](005-weeklog-vs-payment-list.md) | Separação Semântica e Estrutural entre WEEKLOG e Lista de Pagamento | *Planejada* | R1/R2 |
| [ADR-006](006-financial-sources.md) | Fórmulas Canônicas e Precisão Decimal no Fluxo de Caixa | *Planejada* | R2 |
| [ADR-007](007-storage-ownership.md) | Governança de Storage MinIO por Entidade e Presigned URLs | *Planejada* | R0 |
| [ADR-008](008-supabase-migration-strategy.md) | Eliminação Progressiva da Façade Supabase por Fatias Verticais | *Planejada* | R0–R2 |
| [ADR-009](009-critical-transition-idempotency.md) | Idempotência e Transações Atômicas na Conclusão de Ordens de Produção | *Planejada* | R1 |
