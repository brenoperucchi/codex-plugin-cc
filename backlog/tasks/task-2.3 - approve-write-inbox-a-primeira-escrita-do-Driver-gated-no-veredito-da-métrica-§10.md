---
id: TASK-2.3
title: >-
  approve --write-inbox: a primeira escrita do Driver (gated no veredito da
  métrica §10)
status: To Do
assignee: []
created_date: '2026-06-25 23:17'
labels:
  - driver
  - write
  - gated
dependencies:
  - TASK-2.1
references:
  - tools/driver.mjs
  - ~/Devs/contabil/backlog/inbox-watcher.sh
documentation:
  - 'docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§4, §5, §11)'
  - doc-2 — Log de aprendizados do processo
parent_task_id: TASK-2
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A ponte que liga uma proposta aprovada ao motor — a PRIMEIRA escrita do Driver.

GATE: NAO iniciar antes do veredito positivo da task-2.1 (metrica de utilidade). Se o Driver nao provar que poupa trabalho, nao se habilita escrita.

CONTEXTO (ver §4, §5, §11 do plano): hoje o Driver e propose-only (nao escreve). `approve <proposal_id> --write-inbox` congela a proposta (proposal_id + task_fingerprint), REVALIDA a elegibilidade externa (status, deps, zona, .state, question no inbox, worktrees ativos) antes de escrever — sem re-rodar o ranking — e entao escreve o handoff que o motor consome. `defer` persiste o estado de adiamento. Se a task mudou/elegibilidade caiu entre propose e approve, congela como `stale` e volta ao seletor.

NOTA DE INTEGRACAO: se a camada de transporte (task-1.*) ja existir, o handoff deve ir pela fachada MCP/relay (dispatch) em vez do inbox de arquivos.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 approve <proposal_id> --write-inbox revalida task_fingerprint E elegibilidade externa antes de escrever; nao re-roda o ranking
- [ ] #2 Proposta que mudou/perdeu elegibilidade entre propose e approve congela como `stale` e volta ao seletor (nao escreve)
- [ ] #3 defer <proposal_id> persiste o estado de adiamento (deferred + reason + fingerprint) no .state
- [ ] #4 Escreve o handoff de forma idempotente (via inbox OU via a fachada MCP/relay, se ja existir)
- [ ] #5 Testes node --test cobrindo approve (sucesso, stale, dedup) e defer
- [ ] #6 Documentado que esta task so e habilitada apos o veredito positivo da task-2.1
<!-- AC:END -->
