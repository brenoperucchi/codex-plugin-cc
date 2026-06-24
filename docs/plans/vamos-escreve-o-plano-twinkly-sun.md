# RFC — Camada Proativa ("Driver") do Agentic Loop · v3 (pós-review do Codex)

> **Status:** design record vivo. v1/v1.5 dry-run já existem como tooling local em
> `tools/` (gitignored); o próximo gate é medir utilidade antes de qualquer escrita **do
> Driver** (`approve --write-inbox`). A **camada de verificação (§19)** é um componente à
> parte, com seu próprio gate de escrita (A.5 = comentário no PR).
> **Tipo:** plano de design + registro de execução. Esta revisão é apenas documental.
> **Complementa:** [`docs/AGENTIC_LOOP_DEV_WORKFLOW.md`](../AGENTIC_LOOP_DEV_WORKFLOW.md).
> **Incorpora:** (a) a review humana em [`docs/AGENTIC_LOOP_DEV_WORKFLOW_REVIEW.md`](../AGENTIC_LOOP_DEV_WORKFLOW_REVIEW.md);
> (b) a **review adversarial do Codex** (`task_id: RFC-DRIVER-V2`, veredito `approve_with_changes`, no inbox do contabil) — empírica sobre o backlog real (22 `To Do`: 8 com paths nas ACs, 17 com `references`).
> **Decisões de enquadramento (fundador):** v1 = **propose-only**; gatilho = **cadência `/loop`** (self-paced no início — ver §12).
> **Como debater:** rotear este arquivo via `node tools/review-loop.mjs request --artifact docs/plans/vamos-escreve-o-plano-twinkly-sun.md --transport ws --ask "..."`.
> **Leitura rápida para Claude:** não implementar `approve`/`defer` ainda; o caminho
> atual é `propose --dry-run`, com proposer opcional em porta dedicada `:4510`, nunca no
> `:4500` usado por sessões vivas.
> **Princípio de comunicação — linguagem de design de negócio:** o acompanhamento do trabalho
> (e dos handoffs **Claude↔Codex**) conta *o que está acontecendo e por que importa pra você*,
> em termos de **produto** — não de código. Cada passo entrega um resultado em linguagem de
> negócio; o detalhe técnico é secundário, entra só quando for preciso pra decidir, e fica
> separado. Ex.: em vez de *"o proposer marcou `partial`"*, dizer *"a próxima tarefa dá pra
> começar, mas parte dela precisa da sua decisão antes de rodar."* Quem acompanha olha
> **decisões e impacto**, não implementação. Vale **hoje** para minhas respostas e este doc;
> aplicá-lo ao **output do Driver/verify é requisito futuro** — a saída atual ainda imprime
> termos técnicos (`size_objective`, `verify_plan`, `decision`).

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

### No escopo (estado atual v1/v1.5) — *propose-only, read-only, dry-run*
- **Seletor determinístico** (sem LLM) sobre o backlog do `contabil` — decide seleção/zona/tamanho.
- Passo de juízo **opcional** via `codex-ws --schema` (`--proposer`, read-only), **só se o gate
  determinístico passou**, que rascunha escopo/ACs/verify_plan/riscos (task md tratado como
  dado não confiável).
- Emite **um envelope de Proposal** (contrato §5) **ou** um resultado sem proposta + **resumo dos descartes**.
- Apresenta ao humano (Gate-A). **Não escreve nada** (nem inbox, nem `.state`, nem git).

### Fora do escopo (estado atual) — fica para próximo incremento / v2
- `approve --write-inbox` (escreve o handoff) e `defer` (persiste estado).
- Persistência da máquina de estados de decisão (§5) — v1 **emite o formato**, não persiste.
- Classe **auto-executa** (sem Gate-A): só v2, e só via **whitelist opt-in** (`auto_eligible: true`), nunca por classificação automática.
- Cadência agendada (relógio). v1 é self-paced (§12).
- Qualquer toque em zona sensível (sempre humano).

> **Correção de escopo (vs. review §5):** o contrato agora é dividido em dois níveis:
> envelope do Driver (stdout) e payload do Proposer (`tools/propose.schema.json`). Fingerprint,
> `proposal_id` real e máquina de estados persistida só importam quando houver escrita, fora do v1.

---

## 3. Arquitetura (v1)

Driver fino, **sem priorização própria** (lê os sinais do backlog) e **sem protocolo novo**.

```
  /loop (self-paced)  ──►  node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run [--proposer --url ws://127.0.0.1:4510]
        │
        │  PREFLIGHT A: backlog acessível? .state legível?  (senão → STOP, avisa)
        │  PREFLIGHT B: se --proposer, app-server dedicado :4510 no ar? (recusa :4500)
        │
        │  (1) SELECTOR  [determinístico, sem cota — driver.mjs]  ◄── fronteira de segurança
        │        status=To Do · deps todas Done · fora de zona sensível (fail-closed)
        │        · tem AC executável · tamanho-objetivo (ACs + references + corpo) ≤5 arquivos
        │        rank atual: milestone(m-N/título) → priority → menos deps abertas → task_id
        │        dedup: pula `deferred`/`paused` no `.state` (atual; `question` aberta no inbox = futuro)
        │        gate bloqueou (sensível/needs_planning/needs_human_sizing)? → emite needs_* e NÃO chama o proposer
        │                                   │  top-1 elegível + rejected_candidates_summary
        │  (2) PROPOSER OPCIONAL  [juízo — codex-ws --schema, read-only] · task md = DADO não confiável
        │        codex-ws "<task file delimitado>" --schema propose.schema.json --json
        │        → payload tipado (§5.2). NÃO pode fabricar testabilidade.
        ▼
  (3) GATE-A (humano)  ◄── 1 proposta + "por que as próximas não entraram"
        │   decisão: approved | rejected | deferred | needs_planning | needs_human_sizing | sensitive_advisory
        ▼
  ───────────────  fronteira do v1 (acima = read-only)  ───────────────
        │   futuro: node tools/driver.mjs approve <proposal_id> --write-inbox   (revalida fingerprint)
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
# v1/v1.5 local: propor, sem escrever nada
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run --proposer --url ws://127.0.0.1:4510

# futuro (fora do escopo agora): congela a proposta por id e só então escreve o handoff
node tools/driver.mjs approve  prop_YYYYMMDD_NNN --write-inbox     # revalida fingerprint antes
node tools/driver.mjs defer    prop_YYYYMMDD_NNN --reason "escopo > 5 arquivos"
```

O proposer **não** deve usar `ws://127.0.0.1:4500`; essa porta fica reservada para uso vivo
do `codex-ws`. O Driver atual recusa `:4500` e espera uma instância dedicada, por exemplo
`ws://127.0.0.1:4510`.

`approve` **revalida o `task_fingerprint` E a elegibilidade externa** (status, deps, zona,
`.state`, `question` no inbox, worktrees ativos) antes de escrever — **não** re-roda o
ranking (não invalida só porque surgiu task melhor depois). Se a task mudou ou a
elegibilidade caiu entre `propose` e `approve`, congela como `stale` e volta pro seletor
(§11). *(Correção do Codex: fingerprint sozinho é fraco — estado externo muda sem a task mudar.)*

---

## 5. Contrato do Proposal Artifact + estados de decisão

Formaliza dois contratos diferentes, para evitar drift entre documento e código:

### 5.1 Envelope do Driver (`--json`, stdout)

Este é o objeto que `tools/driver.mjs` monta. Em dry-run, `proposal_id` e
`task_fingerprint` ficam `null` porque ainda não existe congelamento/escrita. Os campos de
juízo (`ac_assessment`, `auto_acs`, `manual_acs`, e `scope`/`why_now`/`risks` preenchidos)
**só aparecem com `--proposer`**; sem proposer, o skeleton não os inclui e `decision` fica `pending`.

```json
{
  "generated_for": "/home/.../Devs/contabil",
  "counts": { "todo": 22, "eligible": 4 },
  "proposal": {
    "proposal_id": null,
    "task_id": "TASK-182",
    "task_fingerprint": null,
    "selected_by": { "milestone": "m-1", "priority": "high", "dependencies_done": true },
    "scope": null,
    "acceptance_criteria": [{ "text": "...", "checked": false }],
    "verify_plan": ["bin/rspec"],
    "size_objective": { "files": 4, "signals": ["acs", "references", "body_paths"], "confidence": "objective" },
    "zone": "safe",
    "why_now": null,
    "why_now_evidence": [],
    "risks": [],
    "decision": "pending",
    "note": "..."
  },
  "proposer": null,
  "rejected_candidates_summary": [ { "task_id": "TASK-191", "reason": "sensitive_zone: billing" } ]
}
```

### 5.2 Payload do Proposer (`tools/propose.schema.json`)

Este é o schema entregue ao `codex-ws --schema`. Ele não inclui metadados de seleção nem
estado persistido; só devolve o juízo sobre a task já selecionada:

```json
{
  "scope": "...",
  "acceptance_criteria_assessment": [
    { "ac": "...", "verifiable": true, "note": "como verificar" }
  ],
  "verify_plan": ["bin/rspec"],
  "why_now": "...",
  "why_now_evidence": ["..."],
  "risks": ["..."],
  "recommended_decision": "pending | partial | needs_planning"
}
```

Estados atuais de proposta: `pending · partial · needs_planning`.
Outcomes do seletor/resumo de descartes: `deferred · blocked · sensitive_advisory ·
needs_planning · needs_human_sizing · too_big`. Estados humanos futuros continuam fora do
v1: `approved · rejected · deferred`.

---

## 6. O que reusar (não reinventar)

| Necessidade | Reuso existente | Caminho |
|---|---|---|
| Propor (read-only, tipado, opcional) | `codex-ws.mjs --schema` → `payload` | `tools/codex-ws.mjs` |
| Review adversarial (no motor) | `review-loop.mjs request --transport ws` | `tools/review-loop.mjs` |
| Protocolo ws | `WsClient` (connect/newThread/runTurn{outputSchema}) | `tools/lib/ws-appserver.mjs` |
| Backlog + ACs + prioridade + deps | TASKs markdown + `<!-- AC:BEGIN -->` | `~/Devs/contabil/backlog/tasks/` |
| Ordenação | milestones `m-0..m-6` + `priority` | `~/Devs/contabil/backlog/milestones/` |
| Estado por task (dedup; v1.5+) | `.state/<id>.yml` + `task_fingerprint` | `~/Devs/contabil/backlog/inbox/.state/` |
| Roteamento do handoff (v1.5+) | `inbox-watcher.sh` | `~/Devs/contabil/backlog/inbox-watcher.sh` |
| Cadência self-paced | skill `/loop` | — |
| Verify (motor) | `bin/rspec`, `npm run smoke:month-close`, `bin/brakeman`/`bundler-audit` | `~/Devs/contabil` |

**Onde mora hoje:** `tools/driver.mjs` no **codex-plugin-cc** (já `--contabil-dir`-aware),
mantendo o `contabil` como repo puro de produto+backlog. Observação operacional:
`tools/` está gitignored/local-only; se o Driver virar artefato compartilhado, esse ponto
precisa ser revisto antes de depender dele em CI ou em outro checkout.

---

## 7. Política de seleção (determinística, sem inventar prioridade)

**Filtros duros (todos obrigatórios), em `driver.mjs`:** `status: To Do`; todas as
`dependencies` `Done`; **fora de zona sensível** (§8) por label, path em `references` e título; tem AC com
itens checkbox que nomeiam um **check executável**; **tamanho-objetivo ≤5 arquivos**.

**Ranqueamento (só sinais existentes no código atual):** `milestone → priority → menos deps
abertas → task_id`. `created_date` continua desejável como desempate futuro se o parser do
backlog passar a expor esse campo de forma confiável.

**Tamanho — o maior risco técnico (medido pelo Codex no backlog real):** das 22 tasks
`To Do`, só **8 nomeiam paths nas ACs**, 13 no corpo/ACs e **17 têm `references`** — então
**AC-only mataria o seletor** (quase tudo cairia em `needs_human_sizing`). Por isso o
`size_objective` usa **múltiplos sinais**: paths nas ACs **+** `references` do frontmatter
**+** paths citados no corpo (o campo `documentation` **não** é lido hoje). Confiança auto-reportada de LLM **não é
calibrada** → estimativa de LLM não é gate. Sem nenhum sinal objetivo → `unknown`: **não
some silenciosamente** — vira um artefato
**`needs_human_sizing` auditável** ("provavelmente a próxima, mas dimensione você"). Isso
mantém o seletor útil e evita **starvation** (§11).

**Fronteira de segurança (anti-injection, Codex):** quem decide seleção/zona/tamanho é o
**seletor determinístico** (`driver.mjs`), **não** o LLM. O proposer só é chamado se o
gate determinístico já passou, recebe o markdown da task **delimitado como dado não
confiável**, e só pode preencher o schema fixo — limitando o raio de um prompt injection
vindo do backlog (§11).

**AC fraco (review §3.2 + v1.5):** o proposer pode reformular AC para clareza, mas **não
pode transformar** uma task sem critério verificável em "executável". Nenhum AC verificável
→ `needs_planning`; mistura de ACs verificáveis e manuais → `partial`, separado em
`auto_acs` e `manual_acs`, sem promover execução incompleta.

**Dedup/convergência:** task adiada recebe `deferred` + `reason` + **`task_fingerprint`**
no `.state/<id>.yml` (v1.5+ escreve; v1 só **lê**). Se a task for reescopada, o fingerprint
muda e o defer antigo expira sozinho. O seletor pula `deferred`/`paused`/`pause_reason` no
`.state` (comportamento atual de `tools/driver.mjs`). *`question` aberta no inbox = requisito
futuro, ainda sem teste.*

**Transparência (review §2.8/§3.5):** sempre emitir `rejected_candidates_summary` (por que
as próximas não entraram) — torna o seletor auditável sem virar shortlist (uma proposta principal/rodada).

---

## 8. Zonas sensíveis — sempre gate humano

`contabil` é app contábil real. **Hard human-gate** por **match** de sinal sensível (label · path em `references` · keyword no título). **Regra de `unknown` (código atual):** a task só vira `unknown`→sensível quando **não tem label NEM `references`** (nenhum sinal pra julgar); com label não-sensível ou `references` não-sensíveis → `safe`. Ou seja, **não** é "tudo que não é claramente safe = sensível" — é fail-closed no *match* e na *ausência total de sinal* (cobertura mais ampla = backlog, §11):

- **contabil:** billing · fiscal/impostos · ledger/dinheiro · autenticação · autorização (Pundit/policies) · migrations · webhooks · pagamentos · dados financeiros/fiscais · produção/deploy.
- **codex-plugin-cc:** `sandbox_mode`/`approval_policy` (`lib/codex-config.mjs`) · spawn/kill (`lib/process.mjs`, `lib/spawner.mjs`) · broker lifecycle · stop-review-gate · estado/jobs/worktrees · manifestos de release · marketplace/publish · `~/.codex/config.toml` · credenciais/tokens.

> No v1 (propose-only) isso é naturalmente contido: nada auto-executa, então o pior caso é
> propor algo sensível que o humano rejeita. A regra fail-closed importa de verdade no v2.

---

## 9. Stop / Cost (v1)

- **Preflight obrigatório:** backlog acessível; se `--proposer`, app-server dedicado
  `ws://127.0.0.1:4510` no ar; senão **STOP** com mensagem clara (não falhar silencioso).
- **1 proposta por rodada**; SELECTOR sem cota; PROPOSER = 0 ou 1 turn `codex-ws --schema`
  (read-only, barato).
- **Falha do proposer (comportamento atual):** **1 tentativa** `codex-ws`; se falhar (erro ou schema inválido), mantém o **esqueleto determinístico** + nota, **sem retry** (`tools/driver.mjs`). *Retry 2×/escalonamento explícito = backlog.* Conjunto vazio ou todas sensíveis já aparece no resumo de descartes (escala pro humano naturalmente).
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
| Re-proposta de rejeitadas / divergência | dedup atual = `.state/` `deferred`/`paused`/`pause_reason`. *Expiração por `task_fingerprint` e `question` aberta = futuro.* |
| Escape sensível | fail-closed no *match* (label/ref/título) e quando não há sinal nenhum; **não** cobre "label não-sensível mas zona real desconhecida"; v1 propose-only contém (humano no Gate-A) |
| **Zona não cobre paths só de AC/corpo** | `zoneOf` inspeciona só `labels` + `references` + título, **não** `acPaths`/`bodyPaths` — path sensível citado só em AC/corpo escapa da zona (mas conta no tamanho). *Ampliar = backlog.* |
| Queima de cota | preflight; 1 proposta/rodada; SELECTOR sem cota |
| Estimativa "pequena" falsa | `size_objective` (sinais objetivos), não confiança de LLM |
| **Backlog que mente** (status stale: To Do mas morto) | "sem commits recentes" é só **sinal fraco**, nunca blocker (Codex: ausência de churn ≠ task morta); sinal melhor = commits **mais novos que `updated_date`** nos paths → staleness/conflito |
| **`why_now` circular** (só repete o ranking) | `why_now_evidence` exige fato externo (bloqueia downstream, deadline, regressão recente), não os sinais de rank |
| **Grafo de deps incompleto** (mantido à mão) | Gate-A humano é a rede final; nomear como risco na proposta |
| **Colisão com trabalho humano** | pular `In Progress`; checar worktrees/inbox ativos antes de propor |
| **Staleness propose→approve** | `approve` revalida `task_fingerprint`; muda → `stale`, volta ao seletor |
| **App-server fora do ar** | preflight (§9) aborta a rodada com mensagem, não trava |
| **Prompt/backlog injection** (task md tenta sequestrar o proposer) | task markdown = **dado não confiável**, delimitado; o **seletor determinístico** (não o LLM) decide seleção/zona/tamanho; proposer só preenche schema fixo |
| **Parser/schema drift** do markdown do backlog | parser não crasha. *Hoje, frontmatter sem fechamento → `status` vazio → a task é **silenciosamente excluída** (não é `To Do`); virar `needs_planning` auditável = backlog.* |
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

**Cutline histórico do v1 mínimo (já implementado localmente; revalidar antes de promover):**
1. `tools/driver.mjs propose --contabil-dir … --dry-run` — **stdout-only**;
2. parser de task markdown (frontmatter + ACs + `references`); não crasha *(hoje task malformada some por `status` vazio; `needs_planning` auditável = futuro)*;
3. selector determinístico (filtros + rank + `rejected_candidates_summary`);
4. detector de zona **fail-closed**;
5. `size_objective` **multi-sinal** (ACs + `references` + corpo); sem sinal → `needs_human_sizing` auditável;
6. leitura **read-only** de `.state` para dedup;
7. `propose.schema.json` (payload do Proposer, §5.2);
8. `codex-ws --schema` **só com `--proposer` e só se o gate determinístico passou** (gate bloqueou → emite descarte sem gastar turn);
9. output JSON + resumo Markdown em **stdout**;
10. testes `node --test` com fixtures.

**NÃO implementar:** `approve` · `defer` · `--write-inbox` · escrita real em `.state` ·
integração com `inbox-watcher` · modo auto · clock diário · qualquer escrita em backlog/inbox/git.

---

## 16. Arquivos críticos (futuro — não tocar agora)

- `tools/driver.mjs` — seletor + cola local-only (gitignored hoje).
- `tools/codex-ws.mjs` · `tools/review-loop.mjs` · `tools/lib/ws-appserver.mjs` — reuso.
- `~/Devs/contabil/backlog/tasks/`, `backlog/milestones/` — entrada (read).
- `~/Devs/contabil/backlog/inbox/.state/` — dedup (read no v1; write no v1.5+).
- `~/Devs/contabil/backlog/inbox-watcher.sh` — roteamento (v1.5+).
- `docs/AGENTIC_LOOP_DEV_WORKFLOW.md` — princípios/stop conditions herdados.

---

## 17. Verificação do design + checklists

**Como revalidar o código local (tudo read-only):**
1. **Unit do SELECTOR** (`node --test`): fixtures cobrindo task válida · dependency aberta ·
   sensível por label · sensível por path · sem AC executável · deferred via `.state` (paused) ·
   milestone/priority distintos. Asserta filtro, rank, dedup, fail-closed.
2. **Dry-run real:** `node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run`
   imprime 1 proposta + descartes, **sem** tocar inbox/`.state`/git.
3. **Smoke do PROPOSER:** 1 `codex-ws --schema` → `schemaValid: true`, assessment por AC
   com separação clara entre verificável e manual.

**Pronto para v1 dry-run (checklist histórico; revalidar antes de usar como gate):**
- [ ] `propose --dry-run` executa; preflight do backlog ok.
- [ ] Uma proposta principal + `rejected_candidates_summary`.
- [ ] Envelope do Driver bate com §5.1; payload do Proposer bate com `propose.schema.json`.
- [ ] Zero escrita em `contabil`/inbox/git; `.state` só lido.
- [ ] `unknown` zone → `sensitive`; nenhum AC verificável → `needs_planning`; ACs mistos → `partial`; sem sinal de tamanho → `needs_human_sizing`.
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
- **Descompasso identificado no v1 e resolvido no v1.5:** o filtro determinístico era
  *leniente* (≥1 AC verificável → elegível), enquanto o proposer era *estrito*. A solução
  adotada foi o proposer devolver o **subconjunto verificável** + escopo de "execução
  parcial" (`partial`), mantendo os ACs manuais separados.

### v1.5 — feito (validado pelo self-test do Driver sobre si mesmo)
- **Per-AC assessment + estado `partial`** (resolve o descompasso acima): o proposer avalia
  cada AC; o driver decide `pending`/`partial`/`needs_planning` (`decideFromAssessment`).
- **S2 — separação dura no output:** blocos "▶ Execução automática (N ACs + verify)" vs
  "⏸ Requer sign-off humano (M ACs — NÃO automatizar)" (`splitAcs`) — um `partial` nunca
  promove execução incompleta.
- **S4 — verify_plan por stack:** `detectStack` (Gemfile→rails, package.json→node) — não
  mais `bin/rspec` hardcoded. (33/33 testes.)

### Backlog v1.5 (notas, não feito)
- **S3** — marcadores `✓/✗` frágeis em saída ASCII pura → opcional `--ascii` / `[x]`/`[ ]`.
- **S6** — gate determinístico leniente gasta 1 turn em tasks que viram needs_planning →
  apertar para "maioria verificável" pouparia cota (otimização, não correção).
- **S1** — versionar o schema do proposer se virar contrato compartilhado (hoje moot:
  único consumidor é o `driver.mjs`).

### Próximo passo
Medir a **métrica de utilidade (§10)** em N rodadas reais antes de habilitar
`approve --write-inbox` (a primeira escrita **do Driver**; a camada de verificação tem seu
próprio gate de escrita — §19/A.5).

---

## 19. Camada de Verificação / CI (o estágio **Verify** do loop) — baseline-aware

> Adiciona à estrutura o estágio **Verify** como uma matriz de checks no estilo GitHub CI
> que **separa falha nova (bloqueia) de pré-existente (não bloqueia → roteia)**. Desenho
> consolidado: minha recomendação **+ review adversarial do Codex** (via `codex-ws`, read-only).

> **Status: DESIGN — `tools/verify.mjs` ainda NÃO existe.** Os comandos `verify ...` abaixo são
> o desenho proposto (cutline futura), não ferramentas prontas para rodar.

### Decisões (minha rec + ajustes do Codex)
- **Modo = ler o GitHub CI via `gh`** — matriz fiel, inclui **GitGuardian** (check nativo, só
  existe no GitHub). `gh pr checks` para o resumo; `gh run view --json jobs` para o diagnóstico
  canônico; GitGuardian tratado à parte dos jobs Actions. Subset local (lint+unit) = **fase 2**.
- **Baseline ≠ só job-level** (Codex: job-level mascara regressão dentro de um job já vermelho —
  o buraco adversarial). v1 bloqueia job **GREEN→RED** **e** qualquer **assinatura de falha nova**
  dentro de um job já vermelho. Snapshot do base/main com metadados (`base_sha`, `run_id`,
  `workflow`, `timestamp`), arquivo gitignored em `tools/`.
- **Roteamento = auto-rotear COM travas** (tendência do fundador + guardrail do Codex):
  **dry-run obrigatório**; escreve só com `--apply`. Gems (`scan_ruby`) → **nada** (Dependabot é
  o dono), exceto **anotar exceções** (sem upgrade, conflito de constraint, bundler-audit quebrado
  por config). `test`/`system-test` pré-existente → **um** TASK de tracking, dedup idempotente.

### Onde a camada vive — local vs CI rastreado (decisão)

A `tools/` é gitignored/local-only (§20). Uma camada de *verificação* força a pergunta que o
Driver não forçava: ela é um **gate local do loop** ou **parte da CI compartilhada**? São
destinos diferentes — e a resposta é **faseada**, não excludente.

| | **A — Gate local** (`tools/verify.mjs`) | **A.5 — Local + comenta no PR** | **B — Check rastreado na CI** |
|---|---|---|---|
| O que é | CLIENTE read-only que **lê** o `gh` e classifica; roda na sua máquina / no motor | igual A, mas publica a tabela como **comentário no PR** (`gh pr comment`) | `verify` movido pro repo rastreado + **job no Actions** que classifica e vira **required check** |
| Quem vê | só você | o time, no PR | o time; pode **bloquear merge** |
| Risco à CI verde atual | zero | zero (não toca o YAML) | real (mexe no gate de merge) |
| Baseline | arquivo local (sua visão) | local | **rastreada/versionada** (acordo do time) |
| Esforço | baixo | baixo+ | alto (YAML, permissões, token p/ rotear) |

**Recomendação: A no v1 → A.5 quando útil → B só depois de confiável.**
- **v1 = A.** Prova a lógica baseline-aware (assinaturas, 4-vias, tabela) **sem risco** à CI
  verde do contabil e já serve ao loop (você/o motor rodam pra decidir "pronto"). Coerente
  com o resto (tudo em `tools/`, propose-before-write).
- **A.5** é a socialização barata: mesma ferramenta local, mas a tabela vira comentário no PR
  — visível ao time **sem** virar required check.
- **B** (mover pra repo rastreado + required check + roteamento com `--apply`) é a aposta de
  infra: só depois que a classificação for confiável, igual à disciplina do Driver (provar
  local antes de escrever/compartilhar). Exige decidir o **dono da baseline** (versionada) e
  um **token escopado** para o roteamento.

> Nuance: mesmo em A, `verify.mjs` **lê** a CI remota → exige branch/PR já rodado. Execução
> **local** dos checks (pré-push, sem GitHub) é outra coisa — o subset local da fase 2.

**Alvo escolhido (fundador): A.5.** A camada para em "local + comenta no PR": `tools/verify.mjs`
fica em `tools/` (gitignored, lê o `gh`) e publica a tabela baseline-aware como comentário no PR.
**Atenção — A.5 é uma ESCRITA (remota, no PR):** não confundir com o "nada escrito ainda" do v1
do Driver (§2) — são componentes diferentes, cada um com seu gate. A.5 é a **primeira escrita da
camada de verificação**, gated: só depois do **A** (read-only) ser confiável e atrás da flag
`--comment`. **Idempotência** exige **marcador oculto** (`<!-- verify-table:<chave> -->`) + `gh api`
para localizar e dar **PATCH** no comentário existente — `gh pr comment --body` sozinho **cria**
comentário novo (não é idempotente); `--edit-last --create-if-none` edita o último comentário do
autor, não um identificado por chave. **Fora do alvo:** required check, bloquear merge, mover pra
repo rastreado, baseline versionada compartilhada (isso é B). Fasear: **v1 = A** (read-only) →
**A.5** (escreve no PR, gated).

### Como funciona — `tools/verify.mjs` (gitignored, determinístico, **sem turns de Codex**)
1. `gh run view <id> --json jobs` (branch atual) + `gh pr checks` → matriz por job:
   `scan_ruby · scan_js · lint · test · system-test · GitGuardian`.
2. Jobs vermelhos: `gh run view --log-failed` → extrair **assinaturas**: rspec → id do exemplo
   (`path:line` / full description); rubocop → `cop+path`; brakeman/bundler-audit → advisory/CVE.
   *(v1: assinaturas de rspec — o maior risco de regressão escondida; lint/security = fase 2.)*
3. **Baseline** `tools/.verify-baseline/<repo-slug>.json`: por job `{ conclusion, signatures[] }`
   + metadados. Seedada de um run `gh` do base: `verify baseline --seed --base main`.
4. **Classificação 4-vias** por falha: `new` (bloqueia) · `preexisting` (roteia) ·
   `infra-unknown` (cancelled/timeout → nem bloqueia nem roteia; sinaliza humano) ·
   `flaky` (passou no retry → anota, não bloqueia).
   - GREEN na baseline e RED agora → `new`; assinatura ausente da baseline em job já vermelho → `new`;
     assinatura presente na baseline → `preexisting`.
5. **Render** da tabela jobs×status com anotações (igual à tabela do fundador) + **por que** bloqueou/liberou (auditável).
6. **Veredito:** bloqueia sse houver qualquer `new`; `preexisting` → roteia (se `--route`).
7. **Baseline stale:** se o `base_sha` atual ≠ o da baseline → avisa e exige `--reseed`.

### Roteamento (dedup idempotente)
- Chave estável **por categoria, não por run**: `ci-preexisting:<job>:<base>:<assinatura-normalizada>`
  (assinatura sem timestamp/path-temp/ordem). Marcador persistente no corpo do issue/TASK.
- Antes de criar: buscar abertos por essa chave → aberto: comenta/atualiza, não cria; fechado:
  **não reabre** sem flag dedicada.
- `--route` = preview (dry-run) · `--route --apply` = escreve. Gems → "Dependabot cobre" (+ exceções).

### Integração com o loop
- É o **Verify** do `AGENTIC_LOOP_DEV_WORKFLOW.md §5.4`. O `verify_plan` do Driver vira o
  subconjunto de jobs relevantes; **"pronto" = sem `new`** (não um nº fixo de verdes).

### Cutline v1 / fase 2 (alvo **A.5**)
- **v1 (= A):** `verify baseline --seed` + `verify status` (gh-read · matriz + GitGuardian ·
  classificação 4-vias · assinaturas de rspec · tabela auditável · veredito) + `--route` **dry-run**.
- **A.5 (próximo incremento — o alvo; é ESCRITA remota, gated):** `verify status --comment` →
  publica a tabela no PR de forma **idempotente** via marcador oculto + `gh api` (find+PATCH);
  `gh pr comment --body` sozinho criaria comentário novo (não-idempotente).
- **Fase 2:** `--route --apply` (cria TASK, gated) · assinaturas de lint/security · subset
  local pré-push · flaky por retry · múltiplos workflows.
- **Fora do alvo (B):** required check / bloquear merge / mover `verify` pro repo rastreado.

### Riscos (Codex) → mitigações
| Risco | Mitigação |
|---|---|
| Job já vermelho mascara regressão nova | **assinaturas por-teste**, não só job-level |
| Flaky → spam de backlog | classe `flaky` (passou no retry) + dedup por assinatura |
| Baseline stale / seedada do run errado | metadados `base_sha`/`run_id`; exige `--reseed` se o base mudou |
| GitGuardian nativo difere dos jobs Actions | ler via `gh pr checks`, tratar como check à parte |
| Infra classificada como produto | classe `infra-unknown` separada |
| Dedup frágil por texto cru | assinatura **normalizada** + marcador persistente |
| `--apply` polui o backlog | dry-run obrigatório; `--apply` gated; fechado não reabre |

### Verificação do design (quando virar código)
1. Unit (`node --test tools/verify.test.mjs`): classificação 4-vias com fixtures de baseline+run
   (GREEN→RED · assinatura nova em job vermelho · assinatura pré-existente · cancelled).
2. Dry-run real (read-only): `node tools/verify.mjs status --base main` num PR do contabil →
   conferir a tabela vs. a CI real do GitHub.
3. `--route` (dry-run) lista as chaves de dedup sem escrever; rodar 2× → **idempotente** (zero duplicata).

---

## 20. Changelog do Documento

### 2026-06-24 — princípio de comunicação + camada de verificação
- Cabeçalho: adicionado o **princípio de comunicação em linguagem de design de negócio** — o
  acompanhamento e os handoffs Claude↔Codex narram *o que acontece e por que importa*, com o
  técnico secundário/separado.
- Registrada a **§19 (Camada de Verificação / CI, baseline-aware)**, alvo **A.5**: gate local
  (`tools/verify.mjs`) que lê a CI via `gh`, separa falha nova de pré-existente, e comenta a
  tabela no PR — sem virar required check nem bloquear merge.
- **Alinhamento do doc com a realidade do código** (review de findings): A.5 declarada como
  **escrita remota gated** (não confundir com o "nada escrito" do Driver); corrigida a
  **idempotência** do comentário (marcador oculto + `gh api`, não `gh pr comment` puro);
  `verify.mjs` marcado como **design — ainda não existe**; dedup atual = `.state`
  `deferred`/`paused` (`question` = futuro); campos do proposer no envelope marcados como
  **opcionais**; aplicar o princípio de negócio ao **output do loop** = requisito futuro.
- **2ª rodada de alinhamento** (findings): `unknown=sensitive` é **estreito** (só sem label E
  sem `references`), não amplo; a zona inspeciona só `references` (não `acPaths`/`bodyPaths`);
  `documentation` não é lido no tamanho; task malformada **some** por `status` vazio (não vira
  `needs_planning`); falha do proposer = **1 tentativa + fallback** (sem retry 2×); `question`
  aberta e expiração por `task_fingerprint` = futuros; envelope sem `--proposer` não traz
  `ac_assessment`/`auto_acs`/`manual_acs` (`decision` = `pending`).

### 2026-06-23 — revisão de coerência para Claude
- Atualizado o cabeçalho: este arquivo agora se declara como **design record vivo**, não
  como RFC puramente pré-implementação. A implementação local v1/v1.5 em `tools/` é
  reconhecida explicitamente.
- Separado o contrato em dois níveis: **envelope do Driver** (`--json`, stdout) e **payload
  do Proposer** (`tools/propose.schema.json`). Isso remove a confusão entre o artefato
  completo e o schema passado ao `codex-ws`.
- Corrigida a arquitetura de app-server: o núcleo determinístico não precisa de app-server;
  o proposer é opcional, usa porta dedicada `ws://127.0.0.1:4510` e deve recusar `:4500`.
- Alinhado o gate de tamanho com o código atual: v1/v1.5 mede **número de arquivos** por
  sinais objetivos; LOC e `size_llm_estimate` não são contrato vigente.
- Alinhado o ranking com o código atual: `milestone → priority → deps → task_id`.
  `created_date` fica como melhoria futura se o parser expuser esse campo de forma confiável.
- Registrado que `tools/` está gitignored/local-only. Antes de tratar o Driver como
  ferramenta compartilhada ou CI, será preciso mover/trackear esses arquivos.
- Atualizada a semântica de ACs fracos para v1.5: `pending` quando todos são verificáveis,
  `partial` quando há subconjunto automatizável, `needs_planning` quando nenhum é verificável.
- Marcadas as seções de cutline/checklist como **históricas** e sujeitas a revalidação antes
  de qualquer promoção para `approve --write-inbox`.
