---
id: TASK-1.5
title: >-
  Cross-machine: auth, authz por agente/projeto, isolamento e auditoria (FUTURO
  — gated)
status: To Do
assignee: []
created_date: '2026-06-25 23:11'
updated_date: '2026-06-28 16:36'
labels:
  - mcp
  - transport
  - relay
  - security
  - future
dependencies:
  - TASK-1.2
documentation:
  - doc-1 — Camada de transporte MCP / job-relay — design e review do Codex
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§21)
parent_task_id: TASK-1
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FUTURO / GATED — NAO iniciar antes de "multi-maquina" ser uma meta confirmada. Registrado aqui para nao se perder.

CONTEXTO (ver doc-1, secao Riscos, e §21 do plano): o v1 do relay e single-machine (fachada MCP local + store em arquivo). Levar o relay para MULTI-MAQUINA (Claude@A, Claude@B, Codex@C plugados num relay remoto) so compensa quando esse for o objetivo de verdade. E e uma superficie SENSIVEL: o relay passaria a rotear tarefas que ESCREVEM arquivos entre maquinas. A review do Codex foi enfatica que isso exige garantias fortes antes de ligar.

POR QUE: travar o escopo — deixar claro que multi-maquina nao e o v1, e que quando for, vem com um pacote de seguranca obrigatorio (abaixo).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Auth forte entre agentes e relay (identidade verificavel de cada ponta)
- [ ] #2 Authz por agente/projeto + escopo de ferramentas (quem pode mandar o que para quem)
- [ ] #3 Isolamento por workspace (um agente nao alcanca o workspace de outro)
- [ ] #4 Log de auditoria por mensagem/job/tool-invocation
- [ ] #5 Protecao contra prompt/tool injection atravessando maquinas
- [ ] #6 Modelo de ameaca documentado antes de habilitar qualquer rota cross-machine
- [ ] #7 Decisao explicita do substrato de fila durável para multi-processo/multi-maquina (Postgres queue / Redis Streams / NATS / Temporal) — fora do file-store single-machine do v1
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MODELO DE ROTEAMENTO MULTI-SESSÃO / MULTI-CLOUD (esclarecido com o fundador) — a 1.5 deve nascer com isso:

TIJOLOS: cada sessão/instância = identidade (RELAY_AGENT) + inbox (relay://inbox/<id>); todo job tem `from` (remetente) e `to` (destinatário). Não é broadcast — é roteamento por identidade.

NUMA MÁQUINA (1.1–1.4, PROVADO): (a) AVISO roteado por identidade — quando um job completa, só a sessão do REMETENTE acorda (filtro from===RELAY_AGENT); job novo numa inbox → só o dono daquela inbox. (teste A/B: A recebe, B não). (b) EXECUÇÃO single-flight via claim/lease — vários workers tentam, EXATAMENTE UM pega e roda; nunca dois. 'Todos recebem?' só se duas sessões tiverem a MESMA identidade (mirror — evitar). Regra: identidade ÚNICA por sessão = roteamento preciso.

MULTI-MÁQUINA/CLOUD (ESTA TASK): hoje o cofre é um ARQUIVO + lock numa máquina — sessões em máquinas diferentes têm cofres SEPARADOS, não se enxergam. SOLUÇÃO: trocar arquivo+lock por um SUBSTRATO COMPARTILHADO em rede (Postgres queue / Redis Streams / NATS) que todas as máquinas acessam. O MESMO modelo (identidade + inbox + claim atômico) se estende cross-machine — é TROCA DE SUBSTRATO, NÃO REDESENHO. O que entra de NOVO é a camada de segurança (já nos ACs): auth por agente, authz (quem manda pra quem), isolamento de workspace, auditoria, anti-injeção atravessando máquinas. NOTA: o channel (wake) é do lado Claude/Claude Code (local à máquina onde a sessão roda); cross-machine o 'aviso' chega via o substrato + a sessão local consome (channel) ou polla.
<!-- SECTION:NOTES:END -->
