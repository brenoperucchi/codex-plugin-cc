# Benchmark: inbox-poke (tmux LLM↔LLM) vs codex-plugin-cc (app-server)

## Context

O usuário percebe que delegar trabalho ao Codex via **inbox-poke** (a camada de
comunicação entre LLMs via tmux + arquivos, em `~/Devs/contabil`) está "levando
muito tempo pra processar", e quer **medir qual transporte é mais rápido** para
"entregar uma tarefa ao Codex e receber o resultado de volta":

- **Path A — inbox-poke**: escreve mensagem no `backlog/inbox/` + `bin/inbox-poke contabil-codex "…"` acorda a sessão tmux do Codex → Codex lê o inbox, processa, e **responde escrevendo um novo arquivo no inbox**. Assíncrono, via TUI.
- **Path B — codex-plugin-cc**: `codex-companion.mjs task "…"` → broker/app-server → turn do Codex → resultado síncrono.

Os dois embrulham **o mesmo Codex/modelo** (`~/.codex/config.toml`: `gpt-5.5`,
effort `xhigh`), então o tempo de "pensar" do LLM é comum aos dois — a diferença
está na **sobrecarga de transporte/orquestração**. O resultado esperado é uma
tabela comparativa (mediana/p95 por caminho) e o **delta de overhead de
transporte**.

**Decisões fixadas com o usuário:**
1. Medir **dois workloads**: prompt trivial (isola overhead de transporte) **e** uma tarefa real representativa (read-only).
2. inbox-poke = **round-trip completo** (poke → Codex responde no inbox, detectado por novo arquivo `from: codex`).
3. **Codex real nos dois lados.**

## Approach

Um único script Node ESM (timing de alta resolução com `process.hrtime.bigint()`,
polling de FS, parse de JSON/log dos jobs, **zero dependências npm**):

```
tools/bench/bench-transports.mjs     # entrypoint
tools/bench/README.md                # prereqs + como rodar
```

Relatórios em `output/bench/<timestamp>/{report.json,report.md}` (`output/` já é
gitignored → não vaza). **Adicionar `tools/` ao `.gitignore`** (hoje é untracked
mas não-ignorado; convém travar pra não commitar acidentalmente — já há
`codex-plugin-debug.sh` e `sync-miketv.sh` lá como locais-only).

CLI: `--runs N --warmup 1 --workload both --path both --contabil-dir … --codex-session contabil-codex --summarize-file <rel> --per-run-timeout-ms 180000 [--restart-codex-session] --out-dir output/bench --yes`

### Workloads (texto idêntico nos dois caminhos)
- **Trivial:** `Reply with only the two characters: OK. Do not explain.`
- **Real:** `Summarize the file <ABS_PATH> in exactly 2 bullet points. Read-only; do not modify anything.` — arquivo pequeno e estável sob `~/Devs/contabil`.
- Cada run tem um **marker único** (`BENCH-<epochMs>-<rand6>`) embutido no prompt (e, no Path A, no `task_id` da resposta) pra evitar falso-positivo.

### Path A — por run (round-trip)
1. Escreve 1 arquivo no `backlog/inbox/` (`from: claude, to: codex, task_id: <marker>, kind: question, phase: shaping, ttl_hours: 1`) cujo corpo instrui o Codex a fazer o workload **e responder escrevendo** `backlog/inbox/<ts>--codex-to-claude--bench-reply-<marker>.md` (`from: codex, to: claude, task_id: <marker>`). `t_request_written = now`.
2. `bin/inbox-poke contabil-codex "inbox: bench <marker>. rode inbox-check.sh codex, leia task_id <marker> e responda…"`. Confirma exit 0 + stdout `ok: msg submetida`. `t_poke_returned = exit`.
3. Poll do `backlog/inbox/` a **250ms** pelo arquivo de resposta (match exato do nome + checagem de frontmatter `from: codex` + `task_id == marker`). `t_reply_detected = now`.
4. **Total = `t_reply_detected − t_request_written`**; sub-stages: `poke_delivery = t_poke_returned − t_request_written`, `codex_processing = t_reply_detected − t_poke_returned`.

### Path B — por run (síncrono)
1. `t_spawn` (hrtime) → `node …/codex-companion.mjs task "<prompt>" --json --cwd ~/Devs/contabil` → `t_companion_exit`. **Total = `t_companion_exit − t_spawn`.**
2. Parse do `--json` (`status`, `threadId`, `rawOutput`); aborta se `status !== 0` ou `rawOutput` vazio.
3. Acha o job mais novo em `resolveStateDir(cwd)/jobs/` (`<id>.json` + `<id>.log`) e extrai stages: `queue_to_start = startedAt − createdAt`, `thread_setup = (Thread ready) − (Starting Codex task thread)`, `turn_ms = (Turn completed) − (Turn started)`, `total_job = completedAt − createdAt`.

### Fairness controls
- **Warm-up descartado** em cada caminho (1 run): broker do Path B aquece (`ensureBrokerSession`) e **não é derrubado** entre runs; sessão Codex do Path A já com repo carregado.
- **N = 5** pra validar o harness barato, depois **N = 10** pra medir (mediana/p95/min/max). Custo: `(N+1)×2 caminhos×2 workloads` turns reais (N=10 → 44; N=5 → 24). Exigir `--yes` antes de gastar cota.
- **Mesmo prompt, mesmo repo** (Path B com `--cwd ~/Devs/contabil`), **mesmo modelo/effort** (ambos no default do config; o delta cancela o tempo comum de LLM — **o delta é a métrica-cabeçalho**, não os totais absolutos).
- **Bloat de contexto da sessão persistente (Path A)** é o maior risco de injustiça: prompts minúsculos + flag `--restart-codex-session` (reinicia a sessão Codex por run, espelhando o thread-fresh do Path B) + log de drift por índice de run. Default: sessão persistente + drift logging; `--restart-codex-session` pro comparativo estrito.
- Path B **sem `--resume-last`** (thread novo por run). **Daemon `inbox-watcher.sh` OFF** (poke manual; sem circuit breaker).
- Interleave `A,B,A,B…` por workload (mantém o broker quente; evita skew de carga). Registrar `os.loadavg()` por run.

### Métricas / relatório
- Por (caminho × workload): `total` mediana/p95/min/max/mean/stddev; stage breakdowns; `success_rate`; série run-index×latência (drift).
- **Headline:** `delta_trivial = median(total_A) − median(total_B)` (transporte puro) e `delta_real`; além de "overhead não-Codex" de cada caminho (`total − codex_work`).
- `report.md` com tabela por workload (A vs B lado a lado), breakdown, delta e **Caveats**.

## Files

| Ação | Caminho |
|---|---|
| Criar | `tools/bench/bench-transports.mjs`, `tools/bench/README.md` |
| Editar | `.gitignore` (adicionar `tools/`) — guarda de footprint |
| Reusar (Path A) | `~/Devs/contabil/bin/inbox-poke`, `backlog/inbox-check.sh`, `backlog/inbox/README.md` (protocolo + naming + frontmatter), `backlog/inbox/archive/` (cleanup) |
| Reusar (Path B) | `plugins/codex/scripts/codex-companion.mjs` (`task --json --cwd`, `status`, `result`, `cancel`), `lib/tracked-jobs.mjs` (`startedAt`/`completedAt`, linhas `[ISO] message`), `lib/state.mjs` (`resolveStateDir`/`resolveJobsDir`) |

Funções puras primeiro (`pollForFile`, `stats`), depois Path B (mais simples),
depois Path A, e por último `--restart-codex-session` (mais frágil, atrás da flag).

## Verification

1. **Preflight (aborta com mensagem clara):** `tmux has-session -t contabil-codex` + capture-pane confirma prompt do Codex (sessão oficial via `bin/contabil-codex`); `codex-companion.mjs setup --json` → `ready=true`; `pgrep -f inbox-watcher.sh` vazio (daemon off); `backlog/inbox/` sem mensagens `to: codex` pendentes (senão `--allow-dirty-inbox`); arquivo do workload real existe; `output/bench/` gravável.
2. **Dry-run:** `node tools/bench/bench-transports.mjs --runs 1 --warmup 0 --path A` e `--path B` — valida detecção/parse gastando o mínimo de cota.
3. **Medição:** `--runs 5` (sanidade) → `--runs 10 --yes`.
4. **Ler** `output/bench/<ts>/report.md`: tabela por workload + delta + caveats. Conferir `success_rate` (runs abortados não entram nas stats).
5. **Cleanup automático:** por run, `mv` dos arquivos bench (request + reply) pro `backlog/inbox/archive/`; em abort do Path B, `cancel <jobId>` pra não deixar worker órfão gastando cota; broker fica quente até o fim (derrubar é opcional).

## Risks / Caveats

- **Stages não são apples-to-apples** entre A e B (o "transporte" do A inclui sleeps fixos do `inbox-poke` + pickup do TUI + o Codex rodar `inbox-check` e escrever o arquivo de resposta; o do B é programático). **O total round-trip é a comparação justa**; os breakdowns são orientativos.
- **Quantum de poll de 250ms** nos dois lados (Path A: poll do reply; Path B: `FOREGROUND_OBSERVE_POLL_INTERVAL_MS`) → piso de ruído ~250ms, **simétrico** (não enviesa o delta, mas não super-interpretar ganhos sub-250ms).
- **effort `xhigh`** faz até o "OK" demorar segundos; tudo bem porque o tempo de LLM **cancela no delta** — mas os totais absolutos serão grandes. Documentar modelo/effort no header do relatório.
- **Path B foreground não passa pelo teto de 10min** do Claude Code aqui (o harness chama o companion direto via Node `spawn`, não pela Bash tool) — irrelevante pra tarefas pequenas.
- **Custo de cota** real: ver N acima; começar em N=5.
- **Confiabilidade do `inbox-poke`**: tem fallback `C-m` + verificação; se a sessão Codex estiver presa num modal, a run aborta (NÃO auto-enviar `--escape`, que interromperia trabalho ativo). 3 aborts seguidos num caminho → para aquele caminho e sinaliza.
