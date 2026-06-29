---
id: TASK-3.2
title: 'verify A.5: comentário idempotente da tabela no PR (+ roteamento dry-run)'
status: To Do
assignee: []
created_date: '2026-06-25 23:19'
labels:
  - verify
  - ci
  - pr-comment
  - gated
dependencies:
  - TASK-3.1
references:
  - ~/Devs/contabil/.github/workflows/ci.yml
documentation:
  - docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§19)
  - doc-2 — Log de aprendizados do processo
parent_task_id: TASK-3
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O alvo escolhido (A.5): a tabela baseline-aware vira comentario no PR, visivel ao time — sem virar required check nem bloquear merge.

CONTEXTO (ver §19 do plano): A.5 e a PRIMEIRA ESCRITA (remota) da camada de verificacao, gated — so depois do gate local (task-3.1) ser confiavel, e atras da flag `--comment`.
- `verify status --comment` publica a tabela no PR de forma IDEMPOTENTE: marcador oculto (ex.: <!-- verify-table:<chave> -->) + `gh api` para localizar e dar PATCH no comentario existente. ATENCAO: `gh pr comment --body` sozinho CRIA comentario novo (nao e idempotente); `--edit-last --create-if-none` edita o ultimo comentario do autor, nao um identificado por chave.
- Roteamento das pre-existentes: `--route` = dry-run (lista as chaves de dedup ci-preexisting:<job>:<base>:<assinatura>); o `--route --apply` que CRIA um TASK de tracking e FASE 2 (gated), com dedup idempotente (nao reabrir issue fechado). Gems (scan_ruby) ficam com o Dependabot.

FORA DESTA TASK (B): required check, bloquear merge, mover verify pro repo rastreado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 verify status --comment publica a tabela no PR de forma idempotente via marcador oculto + gh api (find+PATCH)
- [ ] #2 Rodar 2x -> 1 unico comentario (atualiza o existente, nao cria novos)
- [ ] #3 --route (dry-run) lista as chaves de dedup ci-preexisting:<job>:<base>:<assinatura> sem escrever
- [ ] #4 --route --apply (criar TASK de tracking) marcado como FASE 2/gated, com dedup por chave estavel (nao reabre fechado)
- [ ] #5 Gems (scan_ruby) -> anota 'Dependabot cobre', nao cria TASK
- [ ] #6 Testes cobrindo a idempotencia do comentario (mock do gh api)
<!-- AC:END -->
