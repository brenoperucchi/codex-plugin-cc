---
id: TASK-1.2
title: Fachada MCP sobre o job-relay (servidor MCP descoberto pelo plugin)
status: Done
assignee: []
created_date: '2026-06-25 23:10'
updated_date: '2026-06-26 06:45'
labels:
  - mcp
  - transport
  - relay
  - facade
dependencies:
  - TASK-1.1
references:
  - plugins/codex/scripts/lib/broker-lifecycle.mjs
  - plugins/codex/scripts/lib/broker-endpoint.mjs
  - plugins/codex/.claude-plugin/plugin.json
  - plugins/codex/hooks/hooks.json
documentation:
  - doc-1 — Camada de transporte MCP / job-relay — design e review do Codex
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§21)
parent_task_id: TASK-1
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A "porta" padrão que Claude e Codex plugam — a fachada MCP do relay. Hoje o plugin NÃO expõe nenhum servidor MCP (é CLI-only: plugin.json sem campo MCP, hooks/commands em CLI).

CONTEXTO (ver doc-1 e §21 do plano): implementar um servidor MCP (JSON-RPC: initialize / call_tool / subscribe) que expõe o job-relay da task-1.1 como tools: register_agent, dispatch -> job_id, poll(job_id)/status; e a inbox de um agente como RESOURCE com subscription. Declarar o servidor no manifesto do plugin para o Claude Code/Codex descobrirem. PRINCIPIO (Codex): MCP e a FACHADA / API de controle, NAO o barramento — a fila/durabilidade/dedup ficam no relay (task-1.1). O processo do relay reusa o padrao de daemon de lib/broker-lifecycle.mjs (endpoint persistido em relay.json, spawn detached+unref, reusa-se-vivo).

POR QUE: dar uma interface unica e padrao (que ambos os agentes ja falam) no lugar do codex-ws ad-hoc + inbox/tmux.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Servidor MCP responde initialize, call_tool e subscribe (protocolo JSON-RPC do MCP)
- [x] #2 Tools expostas: register_agent; dispatch (recebe to/task/request_id, retorna job_id); poll(job_id)/status
- [x] #3 Inbox de um agente exposta como resource com subscription que notifica em mudanca
- [x] #4 Servidor declarado no manifesto do plugin (plugins/codex/.claude-plugin/plugin.json) e descoberto pelo Claude Code (confirmar o campo de manifesto MCP correto)
- [ ] #5 Processo do relay reusa o padrao de lib/broker-lifecycle.mjs: endpoint persistido (relay.json), spawn detached, reusa-se-vivo (singleton por workspace)
- [x] #6 Contrato de timeout explicito: dispatch retorna rapido (job_id); acompanhamento longo via poll/subscribe
- [x] #7 Testes de compatibilidade MCP: timeout de tool call, reconexao, limite de payload
- [x] #8 Documentacao das tools/resources MCP e de como o cliente se conecta
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plano de implementação (TASK-1.2 — fachada MCP)

**Pesquisa (fonte: docs oficiais MCP + Claude Code):** plugin declara MCP via `.mcp.json` na raiz
do plugin (`mcpServers`, `${CLAUDE_PLUGIN_ROOT}`); transporte stdio = JSON-RPC 2.0 **delimitado por
newline** (stdout só protocolo, log no stderr); Node puro serve (sem SDK). Tools aparecem como
`mcp__plugin_codex_relay__<tool>`.

**REFINAMENTO DE ESCOPO (AC#5):** o daemon `broker-lifecycle` **não é necessário** na 1.2. O relay
(1.1) é arquivo + lock interprocesso, então o servidor MCP (subprocesso que o Claude Code sobe, 1 por
sessão) chama o `relay-jobs.mjs` **direto** e todos compartilham o mesmo `relay-state.json` via lock.
Sem processo central. (O daemon só faria sentido para um relay de longa duração / worker-loop da 1.3.)
→ Proposta: marcar AC#5 como não-aplicável à 1.2.

**Arquivos:**
- NOVO `plugins/codex/.mcp.json` — declara o servidor `relay` (command: node, args: [script via `${CLAUDE_PLUGIN_ROOT}`]).
- NOVO `plugins/codex/scripts/relay-mcp-server.mjs` — servidor stdio JSON-RPC (Node built-ins) que adapta `lib/relay-jobs.mjs`.

**Protocolo:** initialize (protocolVersion 2025-11-25; capabilities {tools:{}, resources:{subscribe:true}}; serverInfo); notifications/initialized; ping; tools/list; tools/call; resources/list; resources/read; resources/subscribe (+ notifications/resources/updated via fs.watch no relay-state.json).

**Tools (adaptadores finos sobre o relay):**
- `dispatch(to, task, request_id, ttl_ms?)` → enqueue → {job_id, deduped} (retorna rápido — AC#6).
- `poll(job_id)` → getJob → {relayState, result, attempts, ...}.
- `register_agent(agent_id)` → ack + inbox_uri (`relay://inbox/<agent_id>`).
(claim/complete/fail/cancel = lado worker, ficam na 1.3 com o worker-loop.)

**Resources:**
- `relay://inbox/<agent>` → resources/read devolve os jobs `queued` endereçados a esse agente.
- resources/list → inboxes dos agentes vistos no store.
- resources/subscribe(uri) + fs.watch(relay-state.json) → emite `notifications/resources/updated`.

**Testes** `tests/relay-mcp-server.test.mjs` (spawn do servidor como child process, JSON-RPC por stdin/stdout, CLAUDE_PLUGIN_DATA temp):
handshake initialize; tools/list (schemas); dispatch→job_id + poll(job_id) round-trip via o store compartilhado; resources/read da inbox; método desconhecido → erro JSON-RPC -32601; linha malformada → erro/ignora. (subscribe: ack + 1 teste leve de notificação por fs.watch, ou anotado se flaky.)

**Verificação:** `node --test tests/relay-mcp-server.test.mjs` + suíte completa. Discovery real pelo Claude Code só se confirma instalado (não dá e2e aqui — anotar). `npm run build` (tsc) não roda no ambiente.

**Fora de escopo (1.2):** tools de worker (claim/complete) + worker-loop, dispatch_and_wait/codex-ws (1.3); daemon; cross-machine.

**Disciplina:** este plano → review do Codex → código → Gate-B (como na 1.1). Sem commit até decisão.

## Refinamentos pós-review do Codex (veredito: solido_com_mudancas; 'sem daemon' ACEITO)

- **fs.watch = wake-up best-effort, NÃO entrega.** Verdade = resources/read/poll. Subscription = fs.watch + debounce + **fallback por polling** + **update inicial logo após o ack** do subscribe; mudanças depois são coalescidas.
- **register_agent passa a PERSISTIR** um registro de agentes no store (`agents[agentId]={registeredAt,lastSeen}`) — dá significado + torna a inbox visível antes de chegar job (resolve a corrida). Nova função em relay-jobs.mjs: `registerAgent`/`listAgents`.
- **resources/templates/list** com `relay://inbox/{agent}` (assinar inbox vazia sem corrida); resources/list = inboxes dos agentes registrados.
- **stdio hardening:** writes no stdout SERIALIZADAS (fila), limite de tamanho de linha/payload, backpressure de process.stdout.write, parse error → erro JSON-RPC + processo VIVO (nunca crasha).
- **initialize:** ecoar a protocolVersion do cliente se suportada; senão outra suportada ou -32602. Não emitir notificações antes do initialize. notifications/initialized não é exigido antes de responder initialize.
- **capabilities:** `resources:{subscribe:true}` (NÃO prometer listChanged no v1).
- **erros JSON-RPC:** -32700 parse (id:null), -32600 request inválido, -32601 método, -32602 params, -32603 interno. Linha malformada → responde erro e CONTINUA.
- **validação de input:** to / request_id / ttl_ms / tamanho do task; cap/limite na resposta de inbox (resources/read).
- **store corrompido → erro interno estruturado (-32603), não crash.**

**Testes adicionais (Codex):** 2+ servidores MCP child no mesmo CLAUDE_PLUGIN_DATA (dispatch concorrente mesmo request_id → 1 dedup, sem corrupção); contenção/lock-timeout → erro JSON-RPC limpo; fs.watch off → polling ainda emite update; subscribe ANTES da inbox existir + dispatch depois; linha gigante/sem newline → limite + erro limpo + processo vivo; handshake negativo (versão incompatível, request antes de initialize); store corrompido → erro interno; teste estático do .mcp.json (${CLAUDE_PLUGIN_ROOT} + script existe).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementado: `plugins/codex/.mcp.json` (declara o servidor MCP 'relay'; passa CLAUDE_PROJECT_DIR/CLAUDE_PLUGIN_DATA) + `plugins/codex/scripts/relay-mcp-server.mjs` (servidor stdio JSON-RPC newline, Node puro) + extensão em `lib/relay-jobs.mjs` (registerAgent/listAgents/inboxFor + campo `agents`) + `tests/relay-mcp-server.test.mjs` (19 testes) + doc `plugins/codex/scripts/relay-mcp.md`.

DECISÃO sem-daemon (AC#5 N/A, aprovada pelo fundador + aceita pelo Codex): Claude Code sobe 1 servidor por sessão; todos compartilham o relay-state.json via lock. Provado pelo teste de 2 servidores deduplicando o mesmo request_id.

Gate-B (review do código pelo Codex, veredito solido_com_mudancas) achou 10 refinamentos — todos aplicados: handshake real (rejeita request antes do initialize; ping ok; não notifica antes do notifications/initialized); agent_id encode/decode simétrico na URI (+ URI inválida → -32602, não crash); leitor de stdin com guard incremental de OOM (linha gigante → -32600 + vivo); cap de bytes no resources/read; validação (ttl>=0, tamanho de ids); watcher unref+close-on-idle; stdout EPIPE não derruba (handler + writeChain.catch); .mcp.json passa o env. +6 testes.

ACs: #1-4,6-8 cumpridos. #5 (daemon) N/A pelo refinamento aprovado. #4: declarado via `.mcp.json` (mecanismo correto — a pesquisa corrigiu o 'plugin.json' da AC); discovery e2e pelo Claude Code só se confirma instalado (caveat na doc). Fachada 19/19; suíte completa 336/336. Sem commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Entregue a fachada MCP (TASK-1.2) — a porta de entrada padrão sobre o relay durável.

**O que:** servidor MCP stdio (JSON-RPC 2.0 newline, Node puro) que expõe o relay como tools (`register_agent`, `dispatch`→job_id idempotente, `poll`) e resources (`relay://inbox/{agent}` + template + subscribe). Declarado em `plugins/codex/.mcp.json` → auto-descoberto pelo Claude Code. Arquivos: `.mcp.json`, `scripts/relay-mcp-server.mjs`, `scripts/relay-mcp.md`, extensão em `lib/relay-jobs.mjs` (registro de agentes), `tests/relay-mcp-server.test.mjs` (19 testes). Commit `51e1e45`.

**Decisão sem-daemon** (aprovada pelo fundador + aceita pelo Codex): 1 servidor por sessão; todos compartilham o `relay-state.json` via lock. Provado pelo teste de 2 servidores deduplicando o mesmo request_id.

**Qualidade:** dois gates do Codex — plano (`solido_com_mudancas`, aceitou sem-daemon) e código Gate-B (`solido_com_mudancas`, 10 refinamentos aplicados: lifecycle initialize-first, ids URI-safe, guard de OOM no stdin, cap de bytes, validação, cleanup de watcher, EPIPE, códigos JSON-RPC). 19 testes da fachada; suíte completa 336/336.

**ACs:** #1-4,6-8 cumpridos; #5 (daemon) N/A pelo refinamento aprovado. **Caveat e2e:** discovery real pelo Claude Code + o env/cwd que ele passa ao servidor MCP só se confirmam num **install real** (registrado na doc `relay-mcp.md`).

**Próximas:** 1.3 (dispatch async + dispatch_and_wait via codex-ws + worker-loop), 1.4 (migração), 1.5 (cross-machine).
<!-- SECTION:FINAL_SUMMARY:END -->
