---
id: TASK-1.1
title: 'Job-relay durável: request_id/dedup + fila/claim sobre o store existente'
status: Done
assignee: []
created_date: '2026-06-25 23:10'
updated_date: '2026-06-26 06:09'
labels:
  - mcp
  - transport
  - relay
  - durability
dependencies: []
references:
  - plugins/codex/scripts/lib/state.mjs
  - plugins/codex/scripts/lib/tracked-jobs.mjs
  - plugins/codex/scripts/lib/event-stream.mjs
  - plugins/codex/scripts/lib/job-control.mjs
documentation:
  - doc-1 — Camada de transporte MCP / job-relay — design e review do Codex
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§21)
parent_task_id: TASK-1
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O coração da camada de transporte: uma fila de jobs DURÁVEL que dá entrega/retry/dedup/ordem que hoje são informais.

CONTEXTO (ver doc-1 e §21 do plano docs/plans/vamos-escreve-o-plano-twinkly-sun.md): ~75% disto JÁ EXISTE e deve ser REUSADO, não reinventado — `lib/state.mjs` (job records + persistência por-workspace via `upsertJob`/`loadState`, cap `MAX_JOBS=50`), `lib/event-stream.mjs` (`.events.jsonl` como log durável), `lib/tracked-jobs.mjs` (`runTrackedJob`). O DELTA é: (a) `request_id` + dedup por chave `(workspace, request_id)` com result cacheado (hoje dedup é só por `id`); (b) estados explícitos de fila/claim (`queued/claimed/running/completed/failed/cancelled/expired`) com claim TTL (hoje o job spawna na hora). v1 é SINGLE-MACHINE → store em arquivo (o que já existe); NÃO introduzir Postgres/Redis (isso é fase multi-máquina).

POR QUÊ: sem essas garantias explícitas, o transporte quebra em casos reais (queda no meio, retry duplicando) — foi o ponto central da review do Codex.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Modelo de estados de job explícito e documentado: queued, claimed, running, completed, failed, cancelled, expired
- [x] #2 request_id aceito no job e dedup por (workspace, request_id): reenviar o mesmo request_id retorna o MESMO job e o result cacheado, sem criar job novo
- [x] #3 Operacoes de fila: claim(jobId, workerId), release, complete; claim expira por TTL e o job volta a queued
- [x] #4 Persistencia duravel: matar o processo no meio e o job + estado sobrevivem em disco e sao recuperaveis
- [x] #5 Reusa lib/state.mjs, lib/event-stream.mjs e lib/tracked-jobs.mjs (nao duplica a camada de persistencia)
- [x] #6 Testes node --test cobrindo: ciclo de vida completo, dedup por request_id, claim/release/expire
- [x] #7 Schema do job e a logica de dedup/claim documentados (atualizar a doc do modulo)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plano de implementação (TASK-1.1)

**Abordagem:** novo módulo `plugins/codex/scripts/lib/relay-jobs.mjs` construído SOBRE `lib/state.mjs`
(reuso, AC#5) — sem reinventar persistência. Relay-jobs coexistem no mesmo `state.jobs[]`, marcados
com `relay: true` + um campo `relayState` próprio (não mexe na semântica `status` do companion).

**Reuso de state.mjs:** `updateState(cwd, mutate)` (load→muta→save atômico, durável em disco),
`loadState`, `generateJobId("relay")`, `resolveJobEventFile` (append de eventos de transição no
`.events.jsonl` — reuso leve do log; integração plena com event-stream fica na 1.3).

**Máquina de estados (explícita, AC#1):**
`queued → claimed → running → (completed | failed)`; `claimed|running → queued` (release / lease
expirado); `qualquer-não-terminal → cancelled`; `não-terminal com TTL vencido → expired`.
Terminais: completed, failed, cancelled, expired.

**API (clock injetável p/ testar tempo):**
- `enqueue(cwd, {requestId, to, payload, ttlMs})` → **dedup por requestId** (AC#2): se já existe
  relay-job com esse requestId, retorna o mesmo (com result cacheado se completed); senão cria queued.
- `getJob` / `findByRequestId`
- `claim(cwd, jobId, workerId, leaseMs)` (só de queued) · `startRunning` · `release` · `complete`
  (idempotente: re-completar retorna o job) · `fail` · `cancel` (AC#3)
- `sweep(cwd, {now})`: lease vencido → requeue (attempts++); TTL vencido → expired (AC#3)

**Testes** `tests/relay-jobs.test.mjs` (AC#6, isolando o state dir via CLAUDE_PLUGIN_DATA temp):
lifecycle completo; dedup (mesmo requestId → mesmo job + result cacheado); claim/release; complete
idempotente; sweep (requeue por lease + expired por TTL); cancel; **durabilidade** (loadState fresco
após "restart" vê o estado, AC#4); transição ilegal (ex.: complete em queued → no-op).

**Verificação:** `node --test tests/relay-jobs.test.mjs` + `npm run build` (type-check). Doc do schema
no topo do módulo (AC#7).

**Fora de escopo (1.1):** fachada MCP (1.2), dispatch/codex-ws (1.3), Postgres/Redis (multi-máquina).
**Git:** escrevo sem commitar; no commit, branch `feat/mcp-job-relay`.

## Revisão pós-review do Codex (veredito: `repensar`)

O Codex reprovou reusar `state.jobs[]` direto — NÃO é durável. 5 furos confirmados:
1. cap `MAX_JOBS=50` compartilhado PODA relay-job em voo (perda de trabalho).
2. `updateState` (load→muta→save arquivo inteiro) SEM lock → double-claim / lost update.
3. `writeFileSync` não-atômico → crash corrompe `state.json` → `loadState` devolve `jobs:[]` → APAGA a fila.
4. dedup só em `state.jobs[]` morre no prune.
5. `sweep()` sem gatilho definido = semântica fantasma.

**Plano revisado:**
- **STORE SEPARADO** `relay-state.json` no mesmo state dir (reusa só `resolveStateDir`/`generateJobId`/`resolveJobEventFile`; NÃO o `state.json`/`upsertJob`/cap do companion). Cap/retention próprios. Bônus: sem migração do state.json.
- **ESCRITA ATÔMICA:** temp → fsync → rename (+fsync do dir). JSON corrompido → backup `relay-state.json.corrupt-<ts>` + erro recuperável, nunca 'fila vazia' silenciosa.
- **LOCK interprocesso** (lockfile `wx` atômico + quebra de obsoleto) em toda mutação.
- **FENCING token por claim** (`claimToken`): complete/fail só com o token vigente → worker com lease vencido não clobbera job reatribuído.
- **sweep-on-access EXPLÍCITO:** toda API pública roda `sweep` primeiro (sob lock).
- **Contrato de dedup documentado:** dedup por requestId enquanto retido (ativo OU terminal na janela de retenção); após retenção, re-enqueue cria job novo.
- **TTL/retry:** TTL do job desde enqueue; lease desde claim; lease vencido → requeue (attempts++); attempts≥max → failed. FIFO por enqueuedAt.

**Diferidos (não-v1):** stress de concorrência exaustivo (cobertura básica + 1 teste de fencing); retry/backoff sofisticado; prioridade.

**Impacto no §21:** o 'reuso ~75%' da persistência era otimista — a do companion não é durável; o relay reusa os HELPERS (dir/id/event-file) mas implementa persistência própria (atômica+locked).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementado `plugins/codex/scripts/lib/relay-jobs.mjs` (store durável SEPARADO `relay-state.json`): escrita atômica temp→fsync→rename(+fsync do dir); lock interprocesso `wx` + quebra de lock obsoleto; fencing token por claim (complete/fail só com o token vigente); sweep-on-access (lease→requeue, TTL→expired, retention) em toda API; dedup por requestId via índice + janela de retenção; store corrompido → backup `relay-state.json.corrupt-<ts>` + erro recuperável (nunca fila vazia silenciosa). Reusa de state.mjs só os helpers seguros (`resolveStateDir`/`generateJobId`/`resolveJobEventFile`).

Testes `tests/relay-jobs.test.mjs`: 13/13 verdes — lifecycle, dedup-após-complete (result cacheado), claim/segundo-claim, lease→requeue, FENCING (worker stale não completa job reatribuído), TTL→expired, maxAttempts→failed, cancel, complete idempotente, fail terminal/retry, durabilidade (persistência relida), store corrompido→backup+recupera.

Suíte completa: 280/281. A única falha (`investigation.test.mjs` 'plain recon turn...') é FLAKY pré-existente (passa 3/3 isolada; o fixture lê state não-atômico) — não relacionada a esta task. `npm run build` (tsc) não roda neste ambiente (devDeps ausentes); o .mjs é JS válido (node executou os testes). Sem commit (branch alvo `feat/mcp-job-relay`).

Gate-B (review adversarial do CÓDIGO pelo Codex, veredito solido_com_mudancas) achou 5 bugs reais — todos corrigidos: (1) lock TOCTOU (apagava lock de outro processo) → ownership nonce + roubo de lock obsoleto via rename atômico + release CONDICIONAL (só remove se ainda é o dono); (2) lock não-renovado → mitigado pelo release condicional (mtime-renewal/OS locks = hardening futuro, anotado no módulo); (3) leitura reescrevia o store → sweep/ops sinalizam `changed`, persist só quando muda (getJob/list/findByRequestId não escrevem); (4) corrupção virava fila vazia na 2ª chamada → agora falha alto em TODA chamada (arquivo intacto) + `resetStore()` explícito; (5) índice só podado → RECONSTRUÍDO a partir dos jobs (fonte da verdade) em todo load/prune. +3 testes (índice reconstruído, leitura não-reescreve, ops após lease vencido). relay 16/16; suíte completa 317/317 verdes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Entregue o job-relay durável (TASK-1.1) — a fundação da camada de transporte MCP.

**O que:** store de jobs durável, single-machine/multi-processo, com dedup por `request_id` e ciclo claim/lease seguro. Arquivos: `plugins/codex/scripts/lib/relay-jobs.mjs` + `tests/relay-jobs.test.mjs` (16 testes). Commit `d61c4ca` na branch `feat/mcp-job-relay` (sem push).

**Garantias:** store SEPARADO (`relay-state.json`, reusa só os helpers seguros do `state.mjs`); escrita atômica (temp+fsync+rename); leitura não reescreve o store; corrupção falha alto até `resetStore()` explícito (nunca fila vazia silenciosa); lock interprocesso com ownership nonce (roubo atômico de lock obsoleto + release condicional); fencing token por claim; sweep-on-access (lease/TTL); índice de dedup derivado dos jobs.

**Qualidade:** passou por DOIS gates adversariais do Codex — plano (veredito `repensar` → store separado) e código (veredito `solido_com_mudancas` → 5 bugs corrigidos). 7/7 critérios de aceite cumpridos. Suíte completa 317/317.

**Fora de escopo (próximas):** fachada MCP (1.2), dispatch/codex-ws (1.3), migração (1.4), cross-machine/segurança (1.5).
<!-- SECTION:FINAL_SUMMARY:END -->
