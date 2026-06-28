---
id: TASK-1
title: Camada de transporte MCP / job-relay para o plugin (iniciativa)
status: To Do
assignee: []
created_date: '2026-06-25 22:59'
updated_date: '2026-06-26 15:01'
labels:
  - mcp
  - transport
  - plugin
  - architecture
dependencies: []
references:
  - tools/codex-ws.mjs
  - tools/review-loop.mjs
  - tools/lib/ws-appserver.mjs
  - ~/Devs/contabil/backlog/inbox-watcher.sh
documentation:
  - doc-1 — Camada de transporte MCP / job-relay — design e review do Codex
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Substituir o transporte fragmentado do plugin (codex-ws ponto-a-ponto + inbox de arquivos + daemon tmux + review-loop) por uma **camada única** com **MCP como fachada** e uma **fila de jobs durável por baixo**.

POR QUÊ: hoje "ficar conectando" dá dor (app-server por tarefa, tmux, fios por ponta) e não há garantias de mensageria (entrega/retry/dedup/ordem/durabilidade) — são informais e quebram em casos reais.

DECISÃO DE ESCOPO (right-sizing, da review adversarial do Codex — veredito `solido_com_mudancas`): NÃO construir o roteador MCP multi-máquina completo agora. Começar pelo **job-relay durável + fachada MCP local** (entrega ~80% com muito menos risco), reusando `codex-ws` para a chamada síncrona ao servidor Codex. Cross-machine/segurança = fase futura.

PRINCÍPIOS (ver doc-1): MCP é fachada, não barramento; base assíncrona (`dispatch → job_id → poll/subscribe`), síncrono só como conveniência; worker-servidor (Codex app-server) não precisa de loop, worker-interativo (sessão Claude) precisa; resultado gravado como job durável antes de responder.

Esta é a task-pai. O trabalho real está nas subtasks. Está "Done" quando as subtasks de escopo near-term (relay + fachada + dispatch + migração) estiverem Done.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Transporte central (near-term) COMPLETO e em PR. Subtasks 1.1–1.4 Done, 4 commits na branch `feat/mcp-job-relay` (d61c4ca relay · 51e1e45 fachada · 239b9b5 worker · 53e5f35 channel). Suíte 364/364; cada camada passou por 2 gates do Codex (plano+código). PR #1 (feat → main no fork origin): https://github.com/brenoperucchi/codex-plugin-cc/pull/1 — inclui o §21 (design) + o backlog/. Restam: 1.5 (cross-machine, futuro/gated) e o follow-up da 1.4 (#1/#5: adaptador --transport relay no review-loop + paridade). Caveats e2e no corpo do PR (channel wake/discovery/execução real do Codex precisam de install real).
<!-- SECTION:NOTES:END -->
