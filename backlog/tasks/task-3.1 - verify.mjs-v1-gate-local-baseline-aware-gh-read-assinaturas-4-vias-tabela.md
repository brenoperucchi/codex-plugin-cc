---
id: TASK-3.1
title: >-
  verify.mjs v1: gate local baseline-aware (gh-read + assinaturas + 4-vias +
  tabela)
status: To Do
assignee: []
created_date: '2026-06-25 23:18'
labels:
  - verify
  - ci
  - baseline
dependencies: []
references:
  - ~/Devs/contabil/.github/workflows/ci.yml
  - tools/driver.mjs
documentation:
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§19)
  - doc-2 — Log de aprendizados do processo
parent_task_id: TASK-3
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O gate local read-only (alvo A do §19). Cliente que LE a CI do GitHub e classifica.

CONTEXTO (ver §19 do plano): `tools/verify.mjs` (gitignored, como o Driver), deterministico, sem turns de Codex.
- Le a matriz via `gh run view --json jobs` + `gh pr checks` (GitGuardian e check nativo, tratado a parte).
- `verify baseline --seed --base main`: snapshot do base com metadados (base_sha, run_id, workflow, timestamp) + assinaturas por job.
- Para jobs vermelhos: extrai ASSINATURAS de falha (rspec: id do exemplo) — NAO so job-level, senao regressao nova dentro de um job ja vermelho escapa (o buraco que o Codex apontou).
- Classifica 4-vias: new (bloqueia) / preexisting (roteia) / infra-unknown (cancelled/timeout) / flaky (passou no retry).
- Veredito: bloqueia SSE houver `new`. Render da tabela jobs x status, auditavel (por que bloqueou/liberou).
- `--route` so dry-run nesta task (o --apply que cria TASK e fase 2, na 3.2/futuro).

NAO usar o :4500 vivo; nao escrever nada (read-only nesta task).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 verify baseline --seed grava snapshot do base (base_sha/run_id/workflow/timestamp + por-job + assinaturas)
- [ ] #2 verify status monta a matriz via gh (gh run view --json jobs + gh pr checks, GitGuardian a parte)
- [ ] #3 Classificacao 4-vias correta: GREEN->RED = new; assinatura ausente da baseline em job ja vermelho = new; assinatura presente = preexisting; cancelled/timeout = infra-unknown
- [ ] #4 Assinaturas de rspec extraidas (nao so job-level)
- [ ] #5 Veredito bloqueia SSE houver `new`; tabela auditavel mostra o porque
- [ ] #6 Baseline stale (base_sha mudou) avisa e exige --reseed
- [ ] #7 Testes node --test com fixtures de baseline+run cobrindo os 4 casos de classificacao
- [ ] #8 Read-only: nao escreve nada, nao usa o :4500 vivo
<!-- AC:END -->
