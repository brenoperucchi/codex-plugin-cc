---
id: TASK-3
title: Camada de verificação / CI baseline-aware (§19) — implementar
status: To Do
assignee: []
created_date: '2026-06-25 23:18'
labels:
  - verify
  - ci
  - plugin
dependencies: []
references:
  - ~/Devs/contabil/.github/workflows/ci.yml
documentation:
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§19)
  - doc-2 — Log de aprendizados do processo
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementar o estagio Verify do loop: uma matriz de checks no estilo GitHub CI que SEPARA falha nova (bloqueia) de pre-existente (nao bloqueia -> roteia). Hoje §19 e DESIGN — `tools/verify.mjs` ainda NAO existe.

CONTEXTO (ver §19 do plano): le a CI do GitHub via `gh` (matriz do contabil: scan_ruby, scan_js, lint, test, system-test + GitGuardian nativo), compara com um snapshot de baseline COM ASSINATURAS (nao so job-level — senao regressao dentro de um job ja vermelho escapa, o buraco que o Codex apontou), classifica 4-vias (new/preexisting/infra-unknown/flaky), e bloqueia sse houver `new`. Alvo escolhido: A.5 (gate local que comenta a tabela no PR). Determinístico, sem turns de Codex.

Esta e a task-pai. Subtasks: o gate local v1 (A) e o comentario idempotente no PR (A.5).
<!-- SECTION:DESCRIPTION:END -->
