---
id: TASK-2
title: 'Produtizar o Driver (agentic loop): de tools/ local para feature do plugin'
status: To Do
assignee: []
created_date: '2026-06-25 23:16'
labels:
  - driver
  - agentic-loop
  - plugin
dependencies: []
references:
  - tools/driver.mjs
  - tools/driver.test.mjs
  - tools/propose.schema.json
documentation:
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§1-18)
  - tools/driver-metrics.jsonl
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O Driver propose-only (§1-18 do plano docs/plans/vamos-escreve-o-plano-twinkly-sun.md) JA EXISTE e foi provado, mas vive em `tools/` (gitignored, local-only): `tools/driver.mjs` + `tools/driver.test.mjs` (33/33) + `tools/propose.schema.json`. Esta iniciativa o transforma em feature do plugin de verdade.

CONTEXTO: o Driver le o backlog do contabil e PROPOE a proxima task pequena/segura (Discover+Plan), parando no gate humano (propose-only, nao escreve nada). O gate antes de QUALQUER escrita e a metrica de utilidade (§10): provar que escopar/propor poupa trabalho. O valor medido ate agora (doc-2): o Driver escopa bem, a escolha e incerta, e o humano pega o ponto cego de dominio.

Esta e a task-pai. O trabalho real esta nas subtasks: medir utilidade, decidir tracked-vs-local + produtizar, e so depois habilitar a primeira escrita (approve).
<!-- SECTION:DESCRIPTION:END -->
