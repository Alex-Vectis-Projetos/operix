# Operix — Visão do Projeto e Escopo Master

**Engenharia**: EverGreen  
**Cliente / Produto**: Operix (QW-Nexus)  
**Natureza**: Estabilização, Recuperação e Evolução Brownfield  

---

## 1. O que é o Operix
O Operix é uma plataforma de gestão operacional e financeira focada no setor automotivo e de reparação (funilaria, martelinho de ouro / PDR e restauração pós-tempestades de granizo). Ele gerencia o ciclo completo do serviço:
1. Inspeção, levantamento de danos e orçamento técnico do veículo;
2. Ordem de Produção (OP) em oficina ou em campo móvel;
3. Consolidação operacional de serviços semanais executados (WEEKLOG);
4. Validação e aprovação técnica com cliente;
5. Reconhecimento comercial através de Listas de Faturamento multissemanais;
6. Confronto (reconciliação de faturamento contra o executado);
7. Gestão financeira de receitas, despesas operacionais e distribuição de valores aos técnicos.

---

## 2. Fases de Engenharia e Escopo Contratado

A estratégia adotada é a entrega por **Fatias Verticais Progressivas (*Vertical Slice Engineering*)**, priorizando estabilidade e segurança:

### R0 — Fundação Técnica, Autoridade e Multi-Tenancy (Prioridade P0)
* Fechamento imediato do autorregistro público de administrador (`/api/auth/register`).
* Implementação do `RequestContext` obrigatório server-side.
* Separação estrita entre Papel Global de Plataforma e Papel de Workspace/Tenant.
* Autorização por objeto (*Object-Level Authorization*) deny-by-default (combate a BOLA/IDOR).
* Governança de Storage MinIO: *ownership* mandatória por entidade/workspace e URLs assinadas de download com expiração.
* Reconciliação do baseline relacional Prisma (PostgreSQL) para viabilizar migrações reproduzíveis sem perda de dados.
* Implementação de suíte de testes de isolamento A/B de tenant.

### R1 — Operação Móvel (Prioridade P1)
* **Orçamento como Domínio Real**: versionamento de orçamentos e fotos de danos persistidos no banco de dados (eliminação do `localStorage` e strings em `ProductionOrder.notes`).
* **Produção**: gerenciamento de veículos, ordens de produção e fotos com vínculos canônicos.
* **Transição Atômica OP $\rightarrow$ WEEKLOG**: conclusão de Ordem de Produção gerando registro canônico de WEEKLOG com chave de idempotência e recuperação explícita de falhas.
* **Retificação de Serviço**: reabertura de serviços reprovados vinculados diretamente ao trabalho original na OP.

### R2 — Lista, Confronto e Financeiro Essencial (Prioridade P1)
* **Lista de Pagamento (*PaymentList*)**: agregação comercial multissemanas de trabalhos reconhecidos pelo cliente.
* **Importador & Confronto**: pipeline de importação de planilhas/OCR de clientes e motor de confronto contra os WEEKLOGs do sistema, registrando discrepâncias aprovadas ou rejeitadas.
* **Financeiro Canônico**: aplicação estrita das fórmulas de caixa:
  * $\text{Executado} = \text{WEEKLOG}$
  * $\text{Reconhecido} = \text{Lista}$
  * $\text{Esperado} = \text{Lista validada pendente}$
  * $\text{Recebido} = \text{Lista paga}$
  * $\text{Disponível} = \text{Recebido} - \text{Despesas}$
* Distribuição manual de repasses a técnicos e registro de despesas operacionais com tenant scope.

### Módulos Fora de Escopo / Futuros (Não Implementar nesta Fase)
* R3 / RH corporativo completo (férias, folha, ponto);
* R4 / Marketplace de peças e contratações;
* Automações genéricas e chatbots autônomos;
* Mecanismo de cobrança e billing SaaS complexo (Stripe em produção);
* Aplicativo mobile nativo (o foco do cliente é web responsiva mobile-first com câmera e performance rápida no navegador).
