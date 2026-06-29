---
id: TASK-1.3
title: >-
  Dispatch: async (base) + dispatch_and_wait via codex-ws + contrato do
  worker-loop
status: Done
assignee: []
created_date: '2026-06-25 23:11'
updated_date: '2026-06-26 17:28'
labels:
  - mcp
  - transport
  - relay
  - dispatch
dependencies:
  - TASK-1.1
  - TASK-1.2
references:
  - tools/codex-ws.mjs
  - plugins/codex/scripts/lib/ws-appserver.mjs
  - tools/review-loop.mjs
documentation:
  - doc-1 — Camada de transporte MCP / job-relay — design e review do Codex
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§21)
parent_task_id: TASK-1
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A semantica de ida-e-volta do transporte.

CONTEXTO (ver doc-1 e §21 do plano):
- BASE = ASSINCRONA: dispatch -> job_id; o resultado vem por poll(job_id) OU por subscription no resource. O sincrono e so conveniencia.
- dispatch_and_wait(timeout): atalho que bloqueia ate o result; se estourar o timeout, degrada para o job_id (assincrono). NAO e a base (o "sem timer" e ilusao — o timeout sempre existe em algum lugar).
- Para worker que e SERVIDOR (Codex app-server): o relay chama via codex-ws (turn/start -> turn/completed) e grava o result como job DURAVEL ANTES de responder (sobrevive a queda/restart). NAO usar o ws://127.0.0.1:4500 vivo — usar instancia/porta dedicada.
- Para worker INTERATIVO (sessao Claude): ele NAO e chamavel como servidor; precisa de um LOOP que puxa a mailbox. Subscription so acorda um processo vivo, nao executa trabalho (o "gatilho" nao some). Este task define e documenta esse contrato de worker-loop.

POR QUE: e o ponto que o Codex mais pressionou — a chamada bloqueante longa quebra; a base tem que ser assincrona e duravel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 dispatch assincrono retorna job_id; o result e obtido por poll(job_id) E por subscription (ambos os caminhos funcionam)
- [x] #2 dispatch_and_wait(timeout) bloqueia ate o result; ao estourar o timeout, degrada para o job_id sem perder o job
- [x] #3 Para worker-servidor: o relay chama o Codex app-server via codex-ws e grava o result como job DURAVEL ANTES de responder (nunca usa o :4500 vivo)
- [x] #4 Cancelamento e heartbeat de job funcionam
- [x] #5 Contrato do worker-loop documentado: worker interativo (Claude) puxa a mailbox via um loop; worker-servidor (Codex) nao precisa de loop
- [x] #6 Teste de falha: matar o relay/worker no meio -> o job sobrevive em disco e o result e recuperavel; reenvio com mesmo request_id nao duplica
- [x] #7 Documentacao do fluxo de dispatch (async/sync) e do contrato de worker-loop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plano de implementação (TASK-1.3 — dispatch + worker)

**Pesquisa/reuso:** `runAppServerTurn(cwd, {prompt, model, effort, sandbox, approvalPolicy, onProgress, outputSchema, persistThread})` em `lib/codex.mjs` = "rodar prompt → resultado". AUTO-gerencia o broker (app-server persistente via **Unix socket**, NÃO o `:4500` ws vivo). Retorna `{status, finalMessage, threadId, touchedFiles, error, ...}`. Config: `resolveCodexSandboxMode`/`resolveCodexAutoApprovalPolicy` (codex-config.mjs). Blueprint: `codex-companion.mjs` handleTask→executeTaskRun. NÃO reusar `runTrackedJob` (amarrado ao store do companion); o relay tem store próprio (relay-jobs.mjs).

**DECISÃO DE ESCOPO — separar coordenação × execução (guardrail do Codex):** a fachada MCP (1.2) fica SÓ coordenação (enqueue/poll/inbox). A EXECUÇÃO (rodar Codex) + `dispatch_and_wait` vão num módulo NOVO `lib/relay-worker.mjs` + entrypoint CLI `relay-worker.mjs`. `dispatch_and_wait` NÃO entra na fachada de coordenação.

**Arquitetura:**
- `lib/relay-worker.mjs`:
  - `processJob(cwd, job, claimToken, {runTurn, heartbeatMs})` — roda via runTurn (default = wrapper de runAppServerTurn), faz **heartbeat na lease** durante o progresso, complete/fail. **runTurn INJETÁVEL** (testes injetam fake; sem Codex real).
  - `drainOnce(cwd, {agentId='codex', workerId, leaseMs, runTurn})` — claim do próximo job queued p/ o agente → processJob.
  - `dispatchAndWait(cwd, {requestId, to, task, ttlMs, timeoutMs, runTurn})` — enqueue; drive inline (processJob p/ agente runnable); poll até terminal ou timeout; **result gravado DURÁVEL antes de retornar** (AC#3); timeout → degrada p/ {job_id, state} sem perder o job (AC#2).
  - `runWorkerLoop(cwd, {agentId, intervalMs, runTurn})` — loop drainOnce (p/ async; worker standalone).
- `relay-worker.mjs` (CLI): `node relay-worker.mjs --agent codex [--once]`.
- **Convenção de payload Codex:** `{prompt, model?, effort?, write?}`; sem prompt → fail com erro claro.
- **Contrato do worker-loop (doc, AC#5/#7):** worker INTERATIVO (Claude) puxa a mailbox via LOOP (poll inbox → claim → trabalha → complete); worker-SERVIDOR (Codex) é DRIVADO (inline pelo dispatch_and_wait, ou pelo relay-worker CLI) — o app-server não tem loop próprio.

**Async (AC#1):** já existe pela 1.2 (dispatch→job_id + poll + subscription). 1.3 adiciona o EXECUTOR que faz o job sair de queued.

**Sandbox/segurança:** sandbox/approval do config (read-only por padrão; write só com config `auto_review`). É o ponto onde "execução com permissão" entra — separado da coordenação.

**Testes** `tests/relay-worker.test.mjs` (runTurn FAKE injetado, CLAUDE_PLUGIN_DATA temp):
processJob (claim→fake result→completed; heartbeat estende lease em turno longo); dispatchAndWait (enqueue+drive→result durável relido); dispatchAndWait TIMEOUT (fake não completa a tempo → degrada p/ job_id, job não perdido, recuperável); FENCING (lease vencido mid-turn → complete do worker falha, não clobbera); failure (fake erro → job failed); crash/idempotência AC#6 (job running, 'crash' sem completar → sweep requeue após lease; re-dispatch mesmo request_id → dedup).

**Verificação:** `node --test` + suíte. Execução REAL do Codex (runAppServerTurn) NÃO roda nos testes (sem binário; fake injetado) → caveat e2e (igual ao discovery da 1.2).

**Fora de escopo:** migração do review-loop/inbox (1.4); cross-machine (1.5); dispatch_and_wait dentro da fachada MCP (mantido fora pela separação coordenação×execução).

**Disciplina:** plano → review do Codex → código → Gate-B.

## Refinamentos pós-review do Codex (veredito: solido_com_mudancas) — fechar antes de codar

- **Heartbeat por TIMER** dentro de processJob (setInterval a cada leaseMs/3), independente de onProgress — mantém a lease viva durante turno silencioso (evita double-run no caso comum). Lease generosa.
- **Escrita default-DENY + gated:** task.write só roda com writePolicy explícito (param/env `RELAY_ALLOW_WRITES`), NÃO só com config auto_review. write negado → job FAILED antes de chamar runTurn.
- **Política de requeue por tipo:** read-only → requeue na lease expirada (atual). WRITE → NÃO auto-requeue: novo estado terminal `needs_recovery` (evita escrever 2x se o dono morreu). Campo de job `leaseExpiryPolicy: requeue|park` (default requeue; write usa park). `recover(jobId)` move needs_recovery→queued (ação explícita).
- **dispatchAndWait single-flight:** enqueue → se já terminal (dedup) retorna result; senão tenta claim → claimou: roda inline; NÃO claimou: só POLLA. Timeout = AbortController → aborta o turno, NÃO deixa órfão; read-only→volta a queued, write→needs_recovery; retorna {job_id, state, timedOut} sem terminal falso.
- **Cancelamento cooperativo (AC#4):** runTurn aceita {signal}. processJob, no tick do heartbeat, faz getJob: se não está mais claimed-por-nós (cancelado/roubado) → AbortController.abort() → runTurn observa o signal. (Abort REAL de um turno do Codex em andamento é best-effort — caveat e2e; o fake prova o mecanismo.)
- **Isolamento do companion (#7):** confirmar que runAppServerTurn chamado DIRETO (sem runTrackedJob) não grava em state.json; se gravar, ajustar o wrapper default. Caveat e2e.
- **Saúde do worker (#6):** async exige worker ativo — documentar claramente; indicador 'no worker recente' = follow-up (não-v1.3).

**Testes adicionais (Codex):** lease expira em runTurn silencioso → heartbeat timer mantém claimed; sem heartbeat → sweep requeue (RO) / park (write) + complete com token vencido falha; 2 workers disputam → só 1 chama runTurn; dispatchAndWait perde a corrida → só polla; timeout → job_id sem double-run; cancel running → abort observado pelo fake; write negado → falha antes do runTurn; write lease-expiry → needs_recovery; dedup → 2ª chamada não roda de novo; runAppServerTurn não toca state.json (instrumentado/caveat).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementado: `lib/relay-worker.mjs` (processJob/drainOnce/dispatchAndWait/runWorkerLoop, runTurn INJETÁVEL) + `scripts/relay-worker.mjs` (CLI --agent/--once/--allow-writes) + doc `scripts/relay-worker.md` + extensão em `lib/relay-jobs.mjs` (estado needs_recovery, leaseExpiryPolicy, park/recover, sweep park-on-expiry) + `tests/relay-worker.test.mjs` (18 testes). runAppServerTurn confirmado NÃO-poluente do companion (codex.mjs sem writes em state.json).

DECISÃO: execução SEPARADA da fachada de coordenação (guardrail do Codex). dispatch_and_wait fica no worker, não na fachada MCP.

Gate-B do PLANO (solido_com_mudancas) → heartbeat por timer, escrita default-deny, write-park, single-flight, timeout-abort, cancel cooperativo. Gate-B do CÓDIGO (solido_com_mudancas) → 4 bugs corrigidos: (1) processJob checa startRunning().ok (não roda se a posse venceu antes de começar); (2) dispatchAndWait com TETO rígido (timeout+grace) não trava com executor não-abortável (turno continua durável em bg); (3) sinal externo (SIGINT) desce até o turno + sono interrompível; (4) TTL de write em execução → needs_recovery (não expired). +6 testes.

ACs #1-7 cumpridos. Caveat e2e: execução REAL do Codex (turno real, escrita, abort real) não roda nos testes (fake injetado); abort real do turno é best-effort (runAppServerTurn sem AbortSignal nativo). worker 18/18; suíte 354/354. Sem commit.

VALIDADO E2E (caveat fechado): smoke real do worker passou — dispatch → drainOnce → `runAppServerTurn` REAL via broker → job completed com output do Codex de verdade ('RELAY SMOKE OK', threadId real, touchedFiles []). Confirma que o caminho de execução (worker + broker + runAppServerTurn) funciona fora dos testes com fake. Codex na PATH; store isolado (CLAUDE_PLUGIN_DATA temp); read-only.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Entregue o worker + dispatch (TASK-1.3) — a **execução** do transporte: mandar → rodar no Codex → resultado de volta, durável.

**O que:** `lib/relay-worker.mjs` (processJob/drainOnce/dispatchAndWait/runWorkerLoop, runTurn injetável) + CLI `scripts/relay-worker.mjs` + doc `relay-worker.md` + extensão em `relay-jobs.mjs` (estado `needs_recovery`, `leaseExpiryPolicy`, park/recover) + 18 testes. Commit `239b9b5`.

**Separação:** a execução fica FORA da fachada de coordenação (guardrail do Codex) — `dispatch_and_wait` mora no worker.

**Segurança contra double-run com escrita:** heartbeat por timer (mantém a posse em turno silencioso); escrita default-deny; write-park (`needs_recovery`, nunca auto-rerun); single-flight (claim-or-poll); timeout que aborta com teto rígido (não trava, sem órfão); cancel cooperativo; não roda se a posse venceu antes de começar.

**Qualidade:** dois gates do Codex (plano → 7 mudanças de segurança; código Gate-B → 4 bugs corrigidos). 18 testes do worker; suíte completa 354/354. ACs #1-7 cumpridos.

**Caveat e2e:** a execução REAL do Codex (turno real, escrita, abort real) é verificação à parte (testes usam fake injetado); abort do turno é best-effort (runAppServerTurn sem AbortSignal nativo).

**Próximas:** 1.4 (migrar review-loop/inbox → relay; aposentar inbox-watcher/tmux), 1.5 (cross-machine, futuro/gated).
<!-- SECTION:FINAL_SUMMARY:END -->
