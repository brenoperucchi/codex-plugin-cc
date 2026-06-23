# RFC — Camada Proativa ("Driver") do Agentic Loop · v3 (pós-review do Codex)

> **Status:** rascunho consolidado para debate (Você / Claude / Codex·ChatGPT).
> **Tipo:** plano de design. Nada de código nesta fase.
> **Complementa:** [`docs/AGENTIC_LOOP_DEV_WORKFLOW.md`](../AGENTIC_LOOP_DEV_WORKFLOW.md).
> **Incorpora:** (a) a review humana em [`docs/AGENTIC_LOOP_DEV_WORKFLOW_REVIEW.md`](../AGENTIC_LOOP_DEV_WORKFLOW_REVIEW.md);
> (b) a **review adversarial do Codex** (`task_id: RFC-DRIVER-V2`, veredito `approve_with_changes`, no inbox do contabil) — empírica sobre o backlog real (22 `To Do`: 8 com paths nas ACs, 17 com `references`).
> **Decisões de enquadramento (fundador):** v1 = **propose-only**; gatilho = **cadência `/loop`** (self-paced no início — ver §12).
> **Como debater:** rotear este arquivo via `node tools/review-loop.mjs request --artifact docs/plans/vamos-escreve-o-plano-twinkly-sun.md --transport ws --ask "..."`.

---

## 1. Contexto (por que existe)

O caso **TASK-182** (extrair copy hardcoded → i18n) provou que o **motor** funciona ponta
a ponta: plano com 7 ACs endurecido por 2 reviews adversariais → `codex-ws --write` →
review do diff (Claude) → smoke Playwright → commit/Done. **O que faltou não foi
ferramenta — foi o *controlador*.** Quem descobriu o que fazer, ranqueou, escopou,
escreveu o handoff e puxou o próximo ciclo foi o humano, do zero.

Este RFC externaliza **apenas o controlador** (etapas **Discover → Propor → Iterate**),
mantendo o fundador no portão. O motor (Execute/Verify) **não muda**.

**Critério de sucesso do v1 (o que ele tem que provar):**
> O Driver escolhe e estrutura a próxima task — útil, segura e pequena — **melhor do que a
> triagem manual do zero**. Se isso não se provar (§10, métrica), não vale avançar para
> escrita/automação.

---

## 2. Escopo

### No escopo (v1) — *propose-only, read-only, dry-run*
- **Seletor determinístico** (sem LLM) sobre o backlog do `contabil` — decide seleção/zona/tamanho.
- **Um** passo de juízo via `codex-ws --schema` (read-only), **só se o gate determinístico
  passou**, que rascunha escopo/ACs/verify_plan/riscos (task md tratado como dado não confiável).
- Emite **um Proposal Artifact** (contrato §5) **ou** um artefato `needs_*` auditável + **resumo dos descartes**.
- Apresenta ao humano (Gate-A). **Não escreve nada** (nem inbox, nem `.state`, nem git).

### Fora do escopo (v1) — fica para v1.5 / v2
- `approve --write-inbox` (escreve o handoff) e `defer` (persiste estado).
- Persistência da máquina de estados de decisão (§5) — v1 **emite o formato**, não persiste.
- Classe **auto-executa** (sem Gate-A): só v2, e só via **whitelist opt-in** (`auto_eligible: true`), nunca por classificação automática.
- Cadência agendada (relógio). v1 é self-paced (§12).
- Qualquer toque em zona sensível (sempre humano).

> **Correção de escopo (vs. review §5):** a review propõe contrato de 14 campos, 7 estados,
> fingerprint e 3 subcomandos. Metade só importa quando se **escreve** estado — que o v1
> não faz. O dry-run v1 emite o artefato no **formato** do contrato (forward-compatible),
> mas **sem** persistência nem máquina de estados. Cutline em §15.

---

## 3. Arquitetura (v1)

Driver fino, **sem priorização própria** (lê os sinais do backlog) e **sem protocolo novo**.

```
  /loop (self-paced)  ──►  node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run
        │
        │  PREFLIGHT: app-server ws://127.0.0.1:4500 no ar? backlog acessível?  (senão → STOP, avisa)
        │
        │  (1) SELECTOR  [determinístico, sem cota — driver.mjs]  ◄── fronteira de segurança
        │        status=To Do · deps todas Done · fora de zona sensível (fail-closed)
        │        · tem AC executável · tamanho-objetivo (ACs + references + corpo) ≤5 arq/≤150 LOC
        │        rank: milestone(m-N) → priority → menos deps abertas → created_date
        │        dedup: pula `deferred` ativo (fingerprint igual) e `question` aberta no inbox
        │        gate bloqueou (sensível/needs_planning/needs_human_sizing)? → emite needs_* e NÃO chama o proposer
        │                                   │  top-1 elegível + rejected_candidates_summary
        │  (2) PROPOSER  [juízo — codex-ws --schema, read-only]  · task markdown = DADO não confiável
        │        codex-ws "<task file delimitado>" --schema propose.schema.json --json
        │        → Proposal Artifact (§5).  NÃO pode fortalecer AC fraco (→ needs_planning)
        ▼
  (3) GATE-A (humano)  ◄── 1 proposta + "por que as próximas não entraram"
        │   decisão: approved | rejected | deferred | needs_planning | needs_human_sizing | sensitive_advisory
        ▼
  ───────────────  fronteira do v1 (acima = read-only)  ───────────────
        │   v1.5+: node tools/driver.mjs approve <proposal_id> --write-inbox   (revalida fingerprint)
        ▼
  MOTOR (inalterado): inbox-watcher → /codex:rescue --worktree → review-loop (Codex adversarial)
                      + bin/rspec / npm run smoke:* → review do diff (Gate-B humano) → commit/Done
        │
        ▼
  (4) ITERATE: próxima rodada do /loop re-dispara o SELECTOR (1 proposta/rodada)
```

**Por quê:** parsing, fechamento de dependências, zona e tamanho são **determinísticos** →
ficam em `driver.mjs` (testável, custo zero). Só o rascunho de escopo/ACs vai pro
`codex-ws --schema`. `/loop` dá cadência self-paced de graça.

---

## 4. Comandos do driver (propose / approve / defer)

Separados de propósito — **propor e agir não são o mesmo passo** (review §2.10/§3.4):

```bash
# v1 (única coisa implementada agora): propor, sem escrever nada
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run

# v1.5+ (fora do escopo agora): congela a proposta por id e só então escreve o handoff
node tools/driver.mjs approve  prop_YYYYMMDD_NNN --write-inbox     # revalida fingerprint antes
node tools/driver.mjs defer    prop_YYYYMMDD_NNN --reason "escopo > 5 arquivos"
```

`approve` **revalida o `task_fingerprint` E a elegibilidade externa** (status, deps, zona,
`.state`, `question` no inbox, worktrees ativos) antes de escrever — **não** re-roda o
ranking (não invalida só porque surgiu task melhor depois). Se a task mudou ou a
elegibilidade caiu entre `propose` e `approve`, congela como `stale` e volta pro seletor
(§11). *(Correção do Codex: fingerprint sozinho é fraco — estado externo muda sem a task mudar.)*

---

## 5. Contrato do Proposal Artifact + estados de decisão

Formaliza o artefato (review §3.1/§3.3). **v1 emite este formato; não persiste a máquina de estados.**

```json
{
  "proposal_id": "prop_YYYYMMDD_NNN",
  "task_id": "TASK-182",
  "task_fingerprint": "sha256-do-conteudo-da-task",
  "selected_by": { "milestone": "m-1", "priority": "high", "dependencies_done": true, "created_date": "2026-06-20" },
  "scope": "...",
  "acceptance_criteria": [],
  "verify_plan": [],
  "size_objective": { "files": 4, "loc": 120, "signals": ["acs", "references", "body_paths"], "confidence": "objective|unknown" },
  "size_llm_estimate": { "files": 4, "loc": 130, "note": "advisory — não é gate" },
  "zone": "safe | sensitive | unknown",
  "why_now": "...",
  "why_now_evidence": [],
  "risks": [],
  "rejected_candidates_summary": [ { "task_id": "TASK-191", "reason": "sensitive_zone: billing" } ],
  "decision": "pending | approved | rejected | deferred | needs_planning | needs_human_sizing | sensitive_advisory"
}
```

Estados de decisão (saída possível de cada proposta): `pending · approved · rejected ·
deferred · needs_planning · needs_human_sizing · sensitive_advisory`.

---

## 6. O que reusar (não reinventar)

| Necessidade | Reuso existente | Caminho |
|---|---|---|
| Propor (read-only, tipado) | `codex-ws.mjs --schema` → `payload` | `tools/codex-ws.mjs` |
| Review adversarial (no motor) | `review-loop.mjs request --transport ws` | `tools/review-loop.mjs` |
| Protocolo ws | `WsClient` (connect/newThread/runTurn{outputSchema}) | `tools/lib/ws-appserver.mjs` |
| Backlog + ACs + prioridade + deps | TASKs markdown + `<!-- AC:BEGIN -->` | `~/Devs/contabil/backlog/tasks/` |
| Ordenação | milestones `m-0..m-6` + `priority` | `~/Devs/contabil/backlog/milestones/` |
| Estado por task (dedup; v1.5+) | `.state/<id>.yml` + `task_fingerprint` | `~/Devs/contabil/backlog/inbox/.state/` |
| Roteamento do handoff (v1.5+) | `inbox-watcher.sh` | `~/Devs/contabil/backlog/inbox-watcher.sh` |
| Cadência self-paced | skill `/loop` | — |
| Verify (motor) | `bin/rspec`, `npm run smoke:month-close`, `bin/brakeman`/`bundler-audit` | `~/Devs/contabil` |

**Onde mora (recomendado):** `tools/driver.mjs` no **codex-plugin-cc** (já `--contabil-dir`-aware),
mantendo o `contabil` como repo puro de produto+backlog.

---

## 7. Política de seleção (determinística, sem inventar prioridade)

**Filtros duros (todos obrigatórios), em `driver.mjs`:** `status: To Do`; todas as
`dependencies` `Done`; **fora de zona sensível** (§8) por label **e** path-glob; tem AC com
itens checkbox que nomeiam um **check executável**; **tamanho-objetivo ≤5 arq/≤150 LOC**.

**Ranqueamento (só sinais existentes):** `milestone → priority → menos deps abertas → created_date`.

**Tamanho — o maior risco técnico (medido pelo Codex no backlog real):** das 22 tasks
`To Do`, só **8 nomeiam paths nas ACs**, 13 no corpo/ACs e **17 têm `references`** — então
**AC-only mataria o seletor** (quase tudo cairia em `needs_human_sizing`). Por isso o
`size_objective` usa **múltiplos sinais**: paths nas ACs **+** `references`/`documentation`
do frontmatter **+** paths citados no corpo. Confiança auto-reportada de LLM **não é
calibrada** → o número do LLM (`size_llm_estimate`) é só **advisory**, nunca gate. Sem
nenhum sinal objetivo → `unknown`: **não some silenciosamente** — vira um artefato
**`needs_human_sizing` auditável** ("provavelmente a próxima, mas dimensione você"). Isso
mantém o seletor útil e evita **starvation** (§11).

**Fronteira de segurança (anti-injection, Codex):** quem decide seleção/zona/tamanho é o
**seletor determinístico** (`driver.mjs`), **não** o LLM. O proposer só é chamado se o
gate determinístico já passou, recebe o markdown da task **delimitado como dado não
confiável**, e só pode preencher o schema fixo — limitando o raio de um prompt injection
vindo do backlog (§11).

**AC fraco (review §3.2):** o proposer pode reformular AC para clareza, mas **não pode
transformar** uma task sem critério verificável em "executável". AC fraco/ambíguo/não-testável
→ `needs_planning` (fila humana), nunca proposta de execução.

**Dedup/convergência:** task adiada recebe `deferred` + `reason` + **`task_fingerprint`**
no `.state/<id>.yml` (v1.5+ escreve; v1 só **lê**). Se a task for reescopada, o fingerprint
muda e o defer antigo expira sozinho. O seletor pula `deferred` ativo ou `question` aberta.

**Transparência (review §2.8/§3.5):** sempre emitir `rejected_candidates_summary` (por que
as próximas não entraram) — torna o seletor auditável sem virar shortlist (uma proposta principal/rodada).

---

## 8. Zonas sensíveis — sempre gate humano (regra: **unknown = sensitive**)

`contabil` é app contábil real. **Hard human-gate**, detecção **fail-closed** (label + path-glob; desconhecido → sensível):

- **contabil:** billing · fiscal/impostos · ledger/dinheiro · autenticação · autorização (Pundit/policies) · migrations · webhooks · pagamentos · dados financeiros/fiscais · produção/deploy.
- **codex-plugin-cc:** `sandbox_mode`/`approval_policy` (`lib/codex-config.mjs`) · spawn/kill (`lib/process.mjs`, `lib/spawner.mjs`) · broker lifecycle · stop-review-gate · estado/jobs/worktrees · manifestos de release · marketplace/publish · `~/.codex/config.toml` · credenciais/tokens.

> No v1 (propose-only) isso é naturalmente contido: nada auto-executa, então o pior caso é
> propor algo sensível que o humano rejeita. A regra fail-closed importa de verdade no v2.

---

## 9. Stop / Cost (v1)

- **Preflight obrigatório:** app-server `ws://127.0.0.1:4500` no ar + backlog acessível; senão **STOP** com mensagem clara (não falhar silencioso).
- **1 proposta por rodada**; SELECTOR sem cota; PROPOSER = 1 turn `codex-ws --schema` (read-only, barato).
- **Escala pro humano** quando: conjunto de candidatas vazio; toda candidata em zona sensível; `codex-ws` falha 2× seguidas; schema inválido; proposer **discorda do seletor** sobre zona/tamanho.
- Relatório por rodada no formato da §10 do `AGENTIC_LOOP_DEV_WORKFLOW.md`.

---

## 10. Verify (motor) + **métrica de utilidade** (o gate real do v1)

O driver **não** verifica nada sozinho no v1 — só **propõe** o `verify_plan` que o motor executará:

| Mudança | Comando(s) |
|---|---|
| docs / i18n / testes | `bin/rspec` (fast) |
| comportamento / system | `bin/rspec spec/system` |
| UI fiscal-adjacente | `npm run smoke:month-close` (Playwright) |
| perto de sensível | `bin/brakeman` + `bin/bundler-audit` |

Regra dos **2 verificadores independentes** (Codex adversarial + Playwright) para tudo que toca UI de dinheiro — herdada do motor.

**Métrica de utilidade (gate real do v1) — formalizada (Codex: precisa de baseline mínimo):**
registrar, por rodada, um log estruturado (sem chamar nada — só anotação humana):

| Campo | O que mede |
|---|---|
| `run_id`, `task_id` | identificação |
| `manual_triage_seconds` | quanto você levaria pra escolher/escopar essa task **do zero** |
| `agreement` | você teria escolhido a **mesma** task? (sim/não) |
| `scope_reuse` | usou o `scope`/`ACs` como veio · editou · refez do zero |
| `minutes_saved` | estimativa de tempo poupado vs. triagem manual |

**Thresholds de promoção** (decidir antes de rodar; números a calibrar): só promover a
`approve`/`--write-inbox` se, em **N ≥ 10** rodadas, `agreement ≥ 70%` **e** `scope_reuse`
≠ "refez do zero" na maioria **e** `minutes_saved` líquido positivo. Senão, o driver não
bate a triagem manual → não automatizar.

---

## 11. Modos de falha e blindagens

| Risco | Blindagem |
|---|---|
| Rubber-stamp creep | proposta obriga `scope` + `verify_plan` + `why_now_evidence`; auditoria periódica |
| Teatro de proatividade (busywork) | rank só por milestone/priority; rejeita task sem AC executável |
| Re-proposta de rejeitadas / divergência | `deferred` + `task_fingerprint` no `.state/`; pula `question` aberta |
| Escape sensível | filtro **fail-closed** (unknown → sensível); v1 propose-only já contém |
| Queima de cota | preflight; 1 proposta/rodada; SELECTOR sem cota |
| Estimativa "pequena" falsa | `size_objective` (sinais objetivos), não confiança de LLM |
| **Backlog que mente** (status stale: To Do mas morto) | "sem commits recentes" é só **sinal fraco**, nunca blocker (Codex: ausência de churn ≠ task morta); sinal melhor = commits **mais novos que `updated_date`** nos paths → staleness/conflito |
| **`why_now` circular** (só repete o ranking) | `why_now_evidence` exige fato externo (bloqueia downstream, deadline, regressão recente), não os sinais de rank |
| **Grafo de deps incompleto** (mantido à mão) | Gate-A humano é a rede final; nomear como risco na proposta |
| **Colisão com trabalho humano** | pular `In Progress`; checar worktrees/inbox ativos antes de propor |
| **Staleness propose→approve** | `approve` revalida `task_fingerprint`; muda → `stale`, volta ao seletor |
| **App-server fora do ar** | preflight (§9) aborta a rodada com mensagem, não trava |
| **Prompt/backlog injection** (task md tenta sequestrar o proposer) | task markdown = **dado não confiável**, delimitado; o **seletor determinístico** (não o LLM) decide seleção/zona/tamanho; proposer só preenche schema fixo |
| **Parser/schema drift** do markdown do backlog | parser tolerante + testes de fixture; frontmatter/AC malformado → `needs_planning`, não crash |
| **Starvation** (`unknown=sensitive` + `unknown=size` bloqueiam tudo) | `unknown` vira artefato auditável `needs_*` (não some); 0 candidatas elegíveis → escala pro humano com o motivo de cada descarte |

---

## 12. Cadência (conciliação da decisão)

Você escolheu **cadência `/loop`**; a review (§2.7) recomenda começar **on-demand**. Conciliação:
- **Semanas 1–2:** `/loop` **self-paced** — você dispara cada rodada (`/loop propose` / `node tools/driver.mjs propose … --dry-run`). É "on-demand dentro do `/loop`".
- **Depois:** se as propostas forem úteis (métrica §10) e sem ruído, promover a **agendado** (ex.: 1×/dia).
- Nunca spin curto; sempre 1 proposta/rodada.

---

## 13. Perguntas abertas — resolvidas pela review do Codex

As 4 da v2 foram respondidas (consolidadas acima):
1. **Tamanho:** AC-only não basta → multi-sinal (ACs + `references` + corpo); `unknown` → `needs_human_sizing` auditável (§7).
2. **Métrica:** mensurável **com** baseline mínimo → formalizada com campos + thresholds (§10).
3. **`approve`:** revalida `fingerprint` **+ elegibilidade externa**, **não** re-roda o ranking (§4).
4. **Stale:** "sem commits" é sinal **fraco**; melhor = commits mais novos que `updated_date` (§11).

**Resta a calibrar (empírico, não bloqueia o v1 dry-run):** os números dos thresholds da
§10 (`N`, `agreement`, `minutes_saved`) — só dá pra fixar depois de algumas rodadas reais.

---

## 14. Caminho v2 (registrado, fora do escopo)

Quando o seletor estiver provado: classe **auto-executa** restrita, **opt-in por task**
(`auto_eligible: true` — whitelist), **duplo gate** (whitelist **E** fora da denylist
sensível **E** AC executável **E** `size_objective` **E** passa no seletor), mapeada nos
modos `stepped`/`auto` e no **circuit breaker** que o `inbox-watcher.sh` já tem (8/fase,
teto 25, `notify-send`). Gate-B (review do diff) **nunca** some.

---

## 15. Cutline do v1 mínimo (dry-run)

**Implementar só (cutline estreito do Codex):**
1. `tools/driver.mjs propose --contabil-dir … --dry-run` — **stdout-only**;
2. parser de task markdown (frontmatter + ACs + `references`); malformado → `needs_planning`, não crash;
3. selector determinístico (filtros + rank + `rejected_candidates_summary`);
4. detector de zona **fail-closed**;
5. `size_objective` **multi-sinal** (ACs + `references` + corpo); sem sinal → `needs_human_sizing` auditável;
6. leitura **read-only** de `.state` para dedup;
7. `propose.schema.json` (formato do contrato §5);
8. `codex-ws --schema` **só se o gate determinístico passou** (gate bloqueou → emite `needs_*` sem gastar turn);
9. output JSON + resumo Markdown em **stdout**;
10. testes `node --test` com fixtures.

**NÃO implementar:** `approve` · `defer` · `--write-inbox` · escrita real em `.state` ·
integração com `inbox-watcher` · modo auto · clock diário · qualquer escrita em backlog/inbox/git.

---

## 16. Arquivos críticos (futuro — não tocar agora)

- `tools/driver.mjs` — **novo** (seletor + cola).
- `tools/codex-ws.mjs` · `tools/review-loop.mjs` · `tools/lib/ws-appserver.mjs` — reuso.
- `~/Devs/contabil/backlog/tasks/`, `backlog/milestones/` — entrada (read).
- `~/Devs/contabil/backlog/inbox/.state/` — dedup (read no v1; write no v1.5+).
- `~/Devs/contabil/backlog/inbox-watcher.sh` — roteamento (v1.5+).
- `docs/AGENTIC_LOOP_DEV_WORKFLOW.md` — princípios/stop conditions herdados.

---

## 17. Verificação do design + checklists

**Como validar quando virar código (tudo read-only):**
1. **Unit do SELECTOR** (`node --test`): fixtures cobrindo task válida · dependency aberta ·
   sensível por label · sensível por path-glob · sem AC executável · deferred (fingerprint igual) ·
   `question` aberta · milestone/priority distintos. Asserta filtro, rank, dedup, fail-closed.
2. **Dry-run real:** `node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run`
   imprime 1 proposta + descartes, **sem** tocar inbox/`.state`/git.
3. **Smoke do PROPOSER:** 1 `codex-ws --schema` → `schemaValid: true`, ACs com checks executáveis.

**Pronto para v1 dry-run (checklist):**
- [ ] `propose --dry-run` executa; preflight do app-server ok.
- [ ] Uma proposta principal + `rejected_candidates_summary`.
- [ ] Proposal segue `propose.schema.json`.
- [ ] Zero escrita em `contabil`/inbox/git; `.state` só lido.
- [ ] `unknown` zone → `sensitive`; AC fraco → `needs_planning`; sem sinal de tamanho → `needs_human_sizing`.
- [ ] `node --test` + `npm test` + `npm run build` passam.

---

## 18. Aprendizados do v1 (medidos no backlog real do contabil)

O v1 (SELECTOR + PROPOSER, dry-run) foi construído e provado ponta a ponta —
`tools/driver.mjs` (+ `tools/driver.test.mjs`, 24/24; `tools/propose.schema.json`), tudo
gitignored, sem tocar `codex-ws.mjs` nem o app-server `:4500`; o proposer roda numa porta
**dedicada `:4510`** (guarda recusa o `:4500`), com o markdown da task como dado não confiável.

- **Backlog majoritariamente sensível/bloqueado:** 22 `To Do` → 4 elegíveis; 9 sensíveis,
  4 com dependência aberta, 3 sem AC verificável, 1 paused, 1 too_big. A postura
  fail-closed + human-gate é validada empiricamente.
- **Task limpa-de-executar é rara:** as 2 candidatas top (`TASK-140.15`, `TASK-147`)
  vieram `needs_planning` — o proposer (corretamente) se recusou a fingir testabilidade
  (`ac_assessment=weak_needs_planning` disparou). O valor do Driver é a **triagem + escopo +
  riscos** e dizer com honestidade quando NÃO está pronta.
- **Descompasso a resolver no v1.5:** o filtro determinístico é *leniente* (≥1 AC
  verificável → elegível), o proposer é *estrito* (qualquer AC não-verificável →
  needs_planning). Opções: apertar o determinístico (exigir maioria verificável, poupando
  chamadas ao proposer), ou o proposer devolver o **subconjunto verificável** + escopo de
  "execução parcial".

### Próximo passo
v1.5 (opcional): resolver o descompasso acima; depois, medir a **métrica de utilidade
(§10)** em N rodadas reais antes de habilitar `approve --write-inbox`.
