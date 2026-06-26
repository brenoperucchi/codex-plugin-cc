---
id: TASK-2.2
title: Decidir tracked-vs-local e produtizar o Driver + polimentos v1.5 (S3/S6)
status: To Do
assignee: []
created_date: '2026-06-25 23:17'
labels:
  - driver
  - plugin
  - polish
dependencies: []
references:
  - tools/driver.mjs
  - tools/driver.test.mjs
  - .gitignore
  - plugins/codex/scripts
documentation:
  - 'docs/plans/vamos-escreve-o-plano-twinkly-sun.md (§15-18, §20)'
  - doc-2 — Log de aprendizados do processo
parent_task_id: TASK-2
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tirar o Driver do limbo "local-only" e fechar os polimentos pendentes.

CONTEXTO (ver §15-18 + §20 do plano): hoje o Driver vive em `tools/` gitignored. Para virar feature compartilhada do plugin ou rodar em CI, precisa ser DECIDIDO: continuar local-only OU mover para dentro do plugin (tracked, ajustando .gitignore e a suite de testes). O changelog ja sinalizou esse ponto.

Polimentos v1.5 pendentes (backlog do proprio Driver, §18): S3 = marcadores ✓/✗ frageis em saida ASCII pura (opcao --ascii ou [x]/[ ]); S6 = gate deterministico leniente (>=1 AC verificavel) gasta 1 turn em tasks que viram needs_planning -> apertar para "maioria verificavel" pouparia cota (otimizacao, nao correcao).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decisao documentada: Driver continua local-only OU vira tracked dentro do plugin, com justificativa
- [ ] #2 Se tracked: mover tools/driver.* para o plugin, ajustar .gitignore e integrar os testes (node --test) sem quebrar a suite/CI atual
- [ ] #3 S3: marcadores de AC com fallback ASCII (flag --ascii ou [x]/[ ]) + teste
- [ ] #4 S6: gate deterministico mais estrito (maioria de ACs verificaveis) + teste; medir reducao de chamadas ao proposer
- [ ] #5 Testes node --test verdes; npm test + npm run build verdes se o Driver virar tracked
- [ ] #6 Doc/§ do plano atualizada com a decisao
<!-- AC:END -->
