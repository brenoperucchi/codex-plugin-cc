---
id: TASK-2.1
title: >-
  Medir a utilidade do Driver (§10) — ~10 rodadas reais — antes de habilitar
  escrita
status: In Progress
assignee: []
created_date: '2026-06-25 23:17'
labels:
  - driver
  - metric
  - gate
dependencies: []
references:
  - tools/driver.mjs
  - tools/driver-metrics.jsonl
documentation:
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§10)
  - tools/driver-metrics.jsonl
  - doc-2 — Log de aprendizados do processo
parent_task_id: TASK-2
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O GATE antes de qualquer automacao/escrita do Driver: provar que ele poupa trabalho de verdade.

CONTEXTO (ver §10 do plano + doc-2 + tools/driver-metrics.jsonl): a medicao JA COMECOU (3 rodadas registradas). Cada rodada = rodar o Driver numa proposta real (quando voce de fato vai pegar a proxima task) e julgar. Hipotese atual (doc-2): o Driver ESCOPA bem (poupa trabalho) mas a ESCOLHA e incerta -> se confirmar, pivotar pro fluxo --task (voce escolhe, ele escopa).

COMO RODAR UMA RODADA: subir app-server dedicado (codex app-server --listen ws://127.0.0.1:4510, NUNCA o :4500 vivo), `node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --proposer [--task TASK-NNN]`, julgar (voce teria escolhido? o escopo poupou tempo?), apendar no metrics log, derrubar o :4510.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 >= 10 rodadas reais registradas em tools/driver-metrics.jsonl
- [ ] #2 Cada rodada com: agreement (teria escolhido a mesma?), scope_reuse (usou como veio/editou/refez), minutes_saved
- [ ] #3 Veredito documentado contra os thresholds do §10 (agreement >= 70%, scope_reuse != refez na maioria, minutes_saved liquido positivo)
- [ ] #4 Se 'escopar > escolher' se confirmar, registrar a recomendacao de adotar o fluxo --task (humano escolhe, Driver escopa)
<!-- AC:END -->
