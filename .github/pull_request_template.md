## Descrição da Mudança

<!-- Resumo claro do problema resolvido e da solução técnica implementada. -->

## Fatia / Spec Relacionada
- **Spec**: `specs/XXX-...` (se aplicável)
- **ADR**: `docs/adr/XXX-...` (se aplicável)

---

## Checklist da Definition of Done (DoD)

Antes de solicitar revisão, confirme se todos os itens foram atendidos:

### 1. Autoridade e Segurança (P0)
- [ ] O `RequestContext` server-side é respeitado (nenhuma confiança em `workspace_id` do cliente).
- [ ] Autorização em nível de objeto (*Object Auth*) foi aplicada com deny-by-default.
- [ ] O isolamento multi-tenant foi validado (Workspace A não acessa Workspace B).
- [ ] Nenhum token JWT, senha ou dado sensível (PII) é exposto em logs.

### 2. Domínio e Persistência
- [ ] Não há chamadas para a façade noop legada do Supabase na fatia tocada.
- [ ] Nenhuma persistência de negócio foi feita em `localStorage`.
- [ ] A mutação relacional é real no PostgreSQL e sobrevive a recarregamento de tela.
- [ ] Efeitos derivados são idempotentes (retentativas não geram duplicidades).

### 3. Qualidade de Código e Testes
- [ ] Schemas e inputs validados com Zod.
- [ ] Zero novos tipos `any` introduzidos.
- [ ] Testes unitários/integração adicionados para cobrir as novas regras.
- [ ] `npm run typecheck` passa sem erros.
- [ ] `npm run lint` passa sem erros.

---

## Como Testar Localmente
<!-- Passos exatos para reproduzir e validar a mudança em ambiente de desenvolvimento. -->
