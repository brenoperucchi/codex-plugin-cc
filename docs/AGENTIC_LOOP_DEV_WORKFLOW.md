# Agentic Loop de Desenvolvimento — `@openai/codex-plugin-cc`

> Documento de processo. **Não** introduz código nem automação nova. Descreve como
> usar IA (Claude Code + o próprio plugin Codex) de forma **proativa, verificável e
> segura** neste repositório, saindo do modelo "prompt isolado" para um **loop de
> trabalho** com memória, verificação e condições de parada.
>
> Escrito para um **desenvolvedor solo** que usa IA como copiloto avançado. O objetivo
> é **aumentar proatividade com segurança**, nunca remover o fundador do processo.
>
> Contexto deste checkout: fork de adoção em `adopt/miketv-base`, com remotes
> `upstream` (openai), `miketv`, `opnd` e `origin`. Boa parte do trabalho recorrente
> aqui é **portar/adotar mudanças de upstream** — o loop trata isso como uma fonte de
> backlog de primeira classe.

---

## 1. Objetivo

Transformar o uso atual — disparar `/codex:review` ou `/codex:rescue` quando me lembro,
sem fio condutor — em um **ciclo repetível** no qual a IA:

1. **Descobre** o estado real do repositório (testes, build, tarefas abertas no
   `openspec/`, `[Unreleased]` do CHANGELOG, commits de upstream ainda não portados);
2. **Propõe** uma melhoria **pequena** e alinhada ao backlog/estratégia;
3. **Executa** dentro de um escopo controlado e reversível;
4. **Verifica** com os portões reais do projeto (`npm test`, `npm run build`) e,
   quando faz sentido, com o próprio Codex como revisor adversarial;
5. **Registra** o que foi feito na memória durável do projeto (openspec, CHANGELOG,
   commits convencionais);
6. **Para** e pede decisão humana sempre que tocar uma zona sensível, crescer demais,
   ou faltar informação que só o fundador tem.

O alvo **não** é automação cega. É proatividade **enquadrada**: a IA pode sugerir e
até executar melhorias de baixo risco sozinha; nas áreas perigosas ela **para no
portão** e espera você.

---

## 2. Diferença entre prompt isolado e loop proativo

| Dimensão | Prompt isolado (`Ask → Answer → Stop`) | Loop proativo (`Discover → … → Iterate`) |
|---|---|---|
| Gatilho | Eu lembro de pedir | Cadência (por PR / bug / sprint / diário) |
| Contexto | O que eu colei no prompt | Estado real lido do repo a cada ciclo |
| Priorização | Nenhuma | Backlog: tarefas `[ ]` no openspec, testes vermelhos, port de upstream |
| Memória | Some no fim da sessão | openspec + CHANGELOG + commits + findings docs |
| Verificação | "parece certo" | `npm test` + `npm run build` verdes vs. **baseline** |
| Revisão | Eu, se lembrar | Papel **verifier** separado (Codex adversarial / subagente / humano) |
| Parada | Quando a resposta sai | **Stop conditions** explícitas (zona sensível, escopo, custo) |
| Custo | Invisível | Orçamento por ciclo (arquivos, turns de Codex, tempo) |
| Reversibilidade | Edita o working tree direto | Branch dedicado / `--worktree` / commits atômicos |

O ponto que "ninguém te conta": **o loop só é útil se a Verificação e a Parada forem
tão fortes quanto a Execução.** Um loop sem verifier e sem stop condition não é
proatividade — é dívida técnica automatizada.

---

## 3. Princípios de segurança

1. **Read-only por padrão.** Toda descoberta e revisão é não-destrutiva. Escrita só
   acontece após um plano aprovado e em escopo pequeno.
2. **Humano no portão das zonas sensíveis.** Ver §7 e §8. A IA pode *propor* um diff
   para essas áreas, mas **não aplica sozinha**.
3. **Verificação obrigatória.** Nada é "pronto" sem `npm test` sem falhas net-new vs.
   baseline **e** `npm run build` limpo. (A skill `codex-result-handling` do próprio
   plugin já proíbe auto-aplicar correções vindas de review — esse princípio é nativo.)
4. **Escopo pequeno e rastreável.** Um item de trabalho por ciclo, ligado a um
   `openspec/changes/<nome>`, uma issue, um commit de upstream, ou um findings doc.
5. **Memória durável, não poluidora.** Decisões vão para `openspec/.../design.md`,
   resumo de usuário-final para o `CHANGELOG.md`, e o porquê para a mensagem de commit
   (Conventional Commits). Nada de scratch `.md` solto na raiz.
6. **Sem segredos.** Nunca ler/ecoar/commitar `~/.codex/config.toml`, tokens, ou os
   diretórios de estado (`~/.codex-companion/state/`). `tools/` e `output/` são
   gitignored — mantê-los assim.
7. **Reversibilidade.** Trabalhar em branch dedicado (nunca direto em `main`);
   experimentos arriscados em `/codex:rescue --worktree` (isola em
   `.claude/worktrees/<jobId>/`).
8. **Fidelidade ao upstream.** Sendo um fork de adoção, preferir **portar com
   atribuição** (commits `port:`/`merge:` já citam `openai/codex-plugin-cc#NNN`) a
   reescrever — divergência gratuita encarece futuros merges.

---

## 4. Fontes de contexto do projeto

Mapa do que cada artefato representa para o loop. **A maior parte da "memória de
produto" deste repo é spec-driven (openspec) + git, não documentos de PM.**

| Fonte | Papel no loop | Onde |
|---|---|---|
| `CLAUDE.md` | Convenções invioláveis (ESM-only, sem deps, sync de versão, subagente fino) | raiz |
| `README.md` / `README.zh-CN.md` | Contrato externo do produto (comandos, flags, garantias read-only) | raiz |
| `openspec/changes/<nome>/proposal.md` | **Backlog + decisões**: Why / What Changes / Impact | por change |
| `openspec/changes/<nome>/tasks.md` | **Tarefas abertas** (checkbox `[ ]`/`[x]`, agrupadas por fase) | por change |
| `openspec/changes/<nome>/design.md` | **Decisões, Riscos, trade-offs** (Risk tables) | por change |
| `openspec/changes/archive/<data>-<nome>/` | Histórico de changes concluídas | arquivo |
| `openspec/specs/*` | Contratos de capability (worktree-lifecycle/output/dispatch), estilo Gherkin | top-level |
| `docs/superpowers/plans/*` + `specs/*` | Planos de implementação TDD (passos `[ ]`, captura de **baseline de falhas**) | docs |
| `ISSUE-370-FINDINGS.md` | **Investigação de bug**: TL;DR, root cause c/ refs de linha, repro, resolução, follow-ups | raiz (untracked) |
| `CHANGELOG.md` | Mudanças visíveis ao usuário (Keep a Changelog + SemVer; seção `[Unreleased]`) | raiz |
| Histórico Git | **Critérios/decisões implícitos**; Conventional Commits (`feat`/`fix`/`test`/`docs`/`port`/`merge`) | `git log` |
| Remotes `upstream`/`miketv` | **Backlog de port**: o que existe lá e ainda não foi adotado aqui | `git log HEAD..upstream/main` |
| `tools/review-loop.md`, `tools/bench/`, `tools/codex-ws.CONTRACT.md` | Tooling local (gitignored) p/ review file-based e medição de transporte | `tools/` |
| `.github/workflows/pull-request-ci.yml` | **Portão objetivo de aceite**: o que a CI exige num PR | `.github/` |
| `.githooks/pre-push` → `scripts/pre-push-check.mjs` | Portão de release (bump de versão + entrada no CHANGELOG) | `.githooks/` |

**Lacunas honestas (não inventar o que não existe):** não há `ROADMAP.md`, backlog
ágil, documento de sprint, métricas, nem Definition of Done unificado. O "DoD" deste
projeto é, na prática: *testes verdes + build limpo + (se visível) entrada no CHANGELOG
+ commit convencional + a Verification task da change correspondente*. Também **não há
lint, formatter nem security scanner** configurados — isso muda como a etapa Verify
precisa ser feita (§5.4).

---

## 5. Loop proposto

```
            ┌─────────── MEMÓRIA DURÁVEL (openspec / CHANGELOG / commits) ───────────┐
            │                                                                         │
  Discover ─┴→ Plan ──(aprovação?)──> Execute ──> Verify ──> Verifier ──> Stop? ──> Iterate
     ▲   (lê estado)  (escopo pequeno)  (branch)   (test+build)  (Codex/humano)  │       │
     │                                                                            │       │
     └──────────────────────── re-hidrata o contexto a cada ciclo ◄──────────────┴───────┘
                          (Cost control e Stop conditions cruzam TODAS as fases)
```

### 5.1 Discover

Objetivo: reconstruir o estado real **antes** de propor qualquer coisa. Esta etapa é
também a **re-hidratação de memória** entre execuções.

**Ler (read-only):**
- `CLAUDE.md` (convenções) e o `git status` / `git log --oneline -20` (o que mudou).
- `openspec/changes/*/tasks.md` — procurar caixas `[ ]` (tarefas abertas).
- `CHANGELOG.md` seção `[Unreleased]` — o que está pendente de release.
- `docs/superpowers/plans/*` e qualquer `ISSUE-*-FINDINGS.md` — investigações em aberto.
- `openspec/changes/*/design.md` — riscos e decisões já tomadas (não recontestar).

**Rodar (read-only / barato):**
```bash
git status --short && git log --oneline -20
git fetch upstream miketv 2>/dev/null
git log --oneline HEAD..upstream/main     # backlog de port (upstream)
git log --oneline HEAD..miketv/main       # backlog de port (base miketv)
npm test                                   # baseline REAL desta máquina
npm run build                              # type-check limpo?
grep -rn "TODO\|FIXME\|XXX" plugins/ tools/ scripts/   # dívidas marcadas
gh pr list 2>/dev/null ; gh issue list 2>/dev/null     # se houver GitHub configurado
```

**Como identificar tarefas abertas (prioridade):**
1. Build quebrado ou teste **vermelho net-new** (comparado à baseline).
2. Caixas `[ ]` em `openspec/changes/*/tasks.md`.
3. Commits em `upstream`/`miketv` ainda não portados.
4. Itens em "Remaining follow-ups" de findings docs (ex.: `ISSUE-370-FINDINGS.md`).
5. Limpeza de `[Unreleased]` antes de um release.

**Entender o contexto do produto:** o README é o contrato. Toda mudança visível
(comando, flag, garantia read-only) tem que continuar verdadeira nele.

**Detectar risco antes de implementar:** verificar se os arquivos que a tarefa tocaria
estão na **lista de zonas sensíveis** (§7/§8). Se sim → a etapa Plan já nasce com
"requer aprovação humana".

> ⚠️ **Baseline antes de comparar.** Documentos antigos citam "4–7 falhas ambientais
> pré-existentes"; uma execução recente desta árvore deu **268 testes / 0 falhas**. Por
> isso o ciclo **sempre** captura a baseline com `npm test` no início — "pronto" é
> *sem falhas net-new vs. a baseline de hoje*, não um número fixo.

### 5.2 Plan

Transformar uma oportunidade em plano executável **pequeno**.

**Formato do plano** (escolher o mais leve que sirva):
- Mudança trivial/local → uma nota curta em `docs/plans/<slug>.md` (3–6 linhas:
  objetivo, arquivos, como verificar, risco).
- Mudança com decisões/risco → seguir o padrão openspec: `proposal.md` (Why / What
  Changes / Impact) + `tasks.md` (passos `[ ]` por fase, estilo TDD) + `design.md`
  (decisões + Risks table) sob `openspec/changes/<nome>/`.

**Critérios para escolher uma tarefa pequena (todos devem valer):**
- 1 capability/intenção; ≈ **≤ 5 arquivos** e **≤ ~150 linhas líquidas**;
- cabe em **uma** rodada de `npm test`;
- tem um **critério de aceite verificável** antes de começar;
- **não** toca nenhuma zona sensível (senão → aprovação humana primeiro).

**Relacionar com backlog/estratégia:** todo plano cita sua origem — `openspec change`,
issue `#NNN`, commit de upstream a portar, ou follow-up de findings. Sem origem
rastreável, não entra no ciclo.

**Quando pedir aprovação humana (antes de executar):** qualquer zona sensível (§7),
qualquer mudança de comportamento visível ao usuário, qualquer bump de versão/release,
ou qualquer ambiguidade de intenção de produto.

**Evitar escopo grande demais:** se o plano passa do orçamento de arquivos/linhas, ou
precisa de `design.md`, **pare e entregue a proposta para aprovação** em vez de
executar. Quebrar em sub-tarefas é preferível a um diff gigante.

### 5.3 Execute

Implementar a mudança aprovada, de forma controlada e reversível.

**Onde:** branch dedicado a partir do alvo certo; para algo arriscado ou que você quer
isolar do working tree, `/codex:rescue --worktree` (cria
`.claude/worktrees/<jobId>/` num branch próprio).

**Tipos de tarefa permitidos (podem ser executados e depois verificados):**
- Documentação (README, CHANGELOG `[Unreleased]`, docs/, openspec).
- **Testes** novos ou reforçados (test-first para bugs).
- Sincronização de comentários/JSDoc/typedef com o código (drift de typedef é um
  problema recorrente aqui — ver `docs/superpowers/.../race.md` Task 6).
- Strings de render/formatting (`lib/render.mjs`) sem mudar contrato.
- **Correção de bug localizada**, sempre com um teste que falha primeiro.
- **Port de um commit upstream bem-escopado**, com atribuição no commit.

**Tipos proibidos para execução automática:** ver §8 (resumo: políticas de
sandbox/approval, spawn/kill de processo, broker lifecycle, semântica do
stop-review-gate, manifestos de versão/release, `~/.codex`, push/publish).

**Tamanho máximo de alteração:** orçamento de §5.2 (≤ ~5 arquivos / ≤ ~150 linhas por
ciclo). Estourou → para e replaneja.

**Cuidados com dados sensíveis:** nunca incluir conteúdo de `config.toml`, tokens, ou
caminhos de estado em diffs, logs ou no CHANGELOG. Output de ferramentas fica em
`output/`/`tools/` (gitignored).

**Análogos a billing/auth/impostos/integrações neste repo** (não há billing literal,
mas há equivalentes de mesmo peso de risco): o **código de política de segurança**
(`lib/codex-config.mjs` — `sandbox_mode`, `approval_policy`), a **execução de
processos** (`lib/process.mjs`, `lib/spawner.mjs`), o **consumo de cota do Codex**
(cada turn custa) e o **artefato publicado** (marketplace/plugin). Tratar todos como
"zona sensível" — §7/§8.

### 5.4 Verify

Validar cada alteração com os portões **reais** do projeto.

**Obrigatório (sempre):**
```bash
npm test            # node --test tests/*.test.mjs  → sem falhas net-new vs baseline
npm run build       # tsc type-check (checkJs/noEmit) → limpo
```
- Se types do app-server estiverem desatualizados e o build reclamar:
  `npm run prebuild` (requer o binário `codex` no PATH) regenera
  `.generated/app-server-types/`.
- Antes de um push/release: `npm run check-version` (sincronia
  `package.json` ↔ `plugin.json`).

**Lint / security scan:** **não existem** neste repo (sem ESLint/Prettier/CodeQL/
semgrep/`npm audit` configurados). **Substitutos honestos** até que existam:
- revisão manual do diff;
- rodar o **próprio plugin** sobre o diff: `/codex:review` (correção) e, para mudanças
  com decisão/risco, `/codex:adversarial-review` (desafia a abordagem). Isso é
  dogfooding e já tem histórico de pegar bugs reais (o CHANGELOG 1.4.0 registra 3 bugs
  HIGH encontrados por `/codex:adversarial-review`).
- (Melhoria futura, §13: adicionar `npm audit`/um linter — não fingir que já existe.)

**Validação manual sugerida:** se tocou um comando/prompt (`commands/*.md`,
`prompts/*.md`), fazer o smoke test no estilo das *Verification tasks* do openspec
(ex.: recarregar o plugin e invocar o comando).

**Critérios mínimos para "pronto":**
- `npm test` sem falhas net-new; `npm run build` limpo;
- se visível ao usuário → entrada em `CHANGELOG.md [Unreleased]`;
- README ainda verdadeiro;
- typedef ↔ estado em sincronia (quando aplicável);
- commit no padrão convencional, ligado ao item de origem.

### 5.5 Memory / State

Como não perder o que foi feito — **e** como não poluir o projeto.

| O que registrar | Onde |
|---|---|
| **Decisões / trade-offs** | `openspec/changes/<nome>/design.md` (ou `docs/superpowers/specs/*`) |
| **Hipóteses / investigação de bug** | `docs/plans/<slug>.md` ou um `*-FINDINGS.md` (ver nota abaixo) |
| **Tarefas concluídas** | marcar `[x]` no `tasks.md` correspondente |
| **Mudança visível ao usuário** | `CHANGELOG.md [Unreleased]` |
| **O porquê de cada mudança** | mensagem de commit (Conventional Commits) — memória durável e gratuita |
| **Change concluída** | mover `openspec/changes/<nome>/` → `openspec/changes/archive/<data>-<nome>/` |

**Como atualizar documentação sem poluir:** preferir editar o doc canônico a criar
novos; manter notas de scratch fora da raiz. *(Nota crítica: `ISSUE-370-FINDINGS.md`
está hoje **na raiz e untracked** — viola a convenção "scripts/paths relativos, raiz
limpa". O primeiro ciclo piloto (§11) realoca isso para `docs/`.)*

**Como não perder contexto entre execuções:** a etapa **Discover é a re-hidratação** —
cada ciclo recomeça relendo `tasks.md` aberto + `git log` + `[Unreleased]`. A memória
do *processo* (suas preferências de como eu trabalho) vive no diretório de memória do
Claude Code, separado do repo.

### 5.6 Verifier (papel separado)

Separar **quem implementa** de **quem revisa** — mesmo sendo um dev solo, o verifier é
um *passe independente*, não a mesma cabeça que escreveu o código.

- **Executor:** Claude implementa no branch/worktree (§5.3).
- **Verifier (escolher um, por ordem de força):**
  1. `/codex:adversarial-review` sobre o diff — desafia abordagem, design, race
     conditions, suposições;
  2. `/codex:review` — revisão de correção;
  3. um **subagente fresco** revisando o diff sem viés de implementação;
  4. **você** (humano), obrigatório para zonas sensíveis e releases.

**O verifier procura:** regressões (suíte completa), divergência do `spec.md`/
`design.md`, drift de typedef, dessincronia de versão/CHANGELOG, toque em zona
sensível, e **scope creep**.

**O verifier pode REJEITAR** → volta para Plan (§5.2). Rejeição não é falha do ciclo;
é o ciclo funcionando.

### 5.7 Stop Condition

Parar e devolver a decisão ao humano quando **qualquer** uma valer:

- `npm test` tem falha **net-new** vs. baseline, ou `npm run build` falha;
- a mudança toca **zona sensível**: política `sandbox_mode`/`approval_policy`
  (`lib/codex-config.mjs`), spawn/kill de processo (`lib/process.mjs`,
  `lib/spawner.mjs`), `broker-lifecycle`, semântica do `stop-review-gate`, deleção de
  estado/jobs, `~/.codex/*`, ou manifestos `package.json`/`plugin.json`/
  `marketplace.json`;
- a tarefa **cresceu** além do orçamento (§5.8) ou passou a precisar de `design.md`;
- `spec.md`/`design.md` **contradiz o código** e não está claro qual é a verdade;
- **custo/cota do Codex** subindo (o README alerta que o review-gate pode "drenar
  limites de uso rapidamente" — exemplo literal de stop por custo);
- falta **informação que só o fundador tem** (intenção de produto; divergir ou não do
  upstream);
- o **pre-push hook** bloquearia (falta bump/CHANGELOG) e você não está pronto para
  release.

### 5.8 Cost Control

Controlar custo (cota do Codex) e tempo por ciclo.

- **Arquivos:** ≤ ~5 alterados por ciclo.
- **Comandos de verificação:** ≤ 1 `npm test` + ≤ 1 `npm run build` por passe (não
  ficar re-rodando a suíte de 30s à toa).
- **Turns de Codex:** cada `/codex:review`, `/codex:rescue`, `/codex:adversarial-review`
  **gasta cota**. Limitar a 1 verifier-pass por ciclo; manter o **review-gate
  desligado** por padrão (ligá-lo cria loop Claude↔Codex que drena cota).
- **Tempo:** time-box de ~30–60 min de relógio por ciclo.
- **Escolher transporte/modelo barato** quando aplicável: o `tools/review-loop` mostra
  `ws` (~22 ms de overhead) vs. `tmux` (~12 s); o alias `spark` (→ `gpt-5.3-codex-spark`)
  e `--effort` baixo para passes rápidos. Tarefas longas → `--background` (sobrevivem ao
  teto de 10 min do Bash, conforme `ISSUE-370-FINDINGS.md`).
- **Quando parar e pedir decisão humana:** zona sensível, release, scope creep, ou **2
  falhas consecutivas** de teste no mesmo ciclo.

### 5.9 Iterate

Repetir de forma útil — sem virar loop infinito.

**Tipos de ciclo e cadência sugerida:**
| Ciclo | Quando | Foco |
|---|---|---|
| **Por PR** | antes de abrir/mergear | `/codex:review` + checagem de CHANGELOG/versão |
| **Por bug** | bug reportado | findings doc → teste que falha → fix → verify |
| **Por sprint / semanal** | bloco dedicado | varrer `[ ]` do openspec + backlog de port upstream |
| **Diário (leve)** | início do dia | triagem: `git status`, testes vermelhos, novos commits de upstream |

**Como escolher a próxima ação** (mesma prioridade da Discover): (1) vermelho/build
quebrado → (2) `[ ]` aberto no openspec → (3) port de upstream/miketv → (4) limpeza de
`[Unreleased]` pré-release → (5) limpeza oportunista pequena.

**Relatório final:** ao fim de cada ciclo, produzir o relatório de §10.

---

## 6. Tipos de tarefas permitidas (execução + verificação, sem aprovação prévia)

- Documentação: README/CHANGELOG `[Unreleased]`/docs/openspec.
- Testes novos ou reforçados (incl. test-first para bugs).
- Sincronização de comentários/JSDoc/typedef ↔ código.
- Ajustes de strings de render/format que não mudam contrato.
- Correção de bug **localizada** (≤ orçamento), com teste que falha primeiro.
- Port de **um** commit upstream bem-escopado, com atribuição.
- Rascunho de `proposal.md`/`tasks.md` no openspec (planejar não é executar).

## 7. Tipos de tarefas que exigem aprovação humana (a IA propõe o diff; você aplica)

- Qualquer mudança de **comportamento visível ao usuário**: `commands/*.md`,
  `prompts/*.md`, novas flags, alteração de garantias (ex.: "read-only").
- **Política de segurança**: `lib/codex-config.mjs` (`sandbox_mode`, `approval_policy`).
- **Lifecycle de processo/broker**: `lib/process.mjs`, `lib/spawner.mjs`,
  `lib/broker-lifecycle.mjs`.
- **Stop-review-gate** (`stop-review-gate-hook.mjs`) — semântica e ativação.
- Operações **git/worktree** destrutivas (`lib/git.mjs`, `lib/workspace.mjs`).
- Mudança de **schema de estado** (`lib/state.mjs`).
- **Release**: bump em `package.json`/`package-lock.json`/`plugin.json`/
  `marketplace.json` + seção versionada do CHANGELOG.
- Decisão de **divergir do upstream** (em vez de portar).

## 8. Tipos de tarefas proibidas para execução automática

- **Auto-aplicar correções** vindas de uma review sem revisão humana (a skill
  `codex-result-handling` já proíbe explicitamente).
- Editar `~/.codex/config.toml` ou qualquer credencial/segredo.
- `git push` (especialmente `--no-verify`) sem aprovação; push direto em `main`.
- Publicar/release no marketplace.
- Deletar jobs/estado/worktrees, ou operações `--force`.
- Refactors em massa ou reescrita ampla de código de upstream.
- Ligar o review-gate de forma desassistida (custo/cota).

---

## 9. Comandos de validação

| Comando | O que valida | Quando |
|---|---|---|
| `npm test` | Suíte completa (`node --test tests/*.test.mjs`, ~268 testes, ~30 s) | sempre (baseline na Discover; gate na Verify) |
| `npm run build` | Type-check (`tsc`, checkJs/noEmit) | sempre na Verify |
| `npm run prebuild` | Regenera tipos do app-server (requer `codex` no PATH) | quando o build acusa types desatualizados |
| `npm run check-version` | Sincronia `package.json` ↔ `plugin.json` | antes de push/release |
| `node --test tests/<arquivo>.test.mjs` | Um arquivo de teste isolado | iteração rápida durante Execute |
| pre-push hook (`scripts/pre-push-check.mjs`) | Bump de versão + entrada no CHANGELOG (+ aviso de README) | no `git push` (instalar via `npm run setup-hooks`) |
| `/codex:review` (diff) | Revisão de correção pelo Codex | Verify de mudanças não-triviais |
| `/codex:adversarial-review` (diff) | Desafia abordagem/design/risco | Verify de mudanças com decisão/risco |
| CI (`pull-request-ci.yml`) | `npm ci` + install codex + `npm test` + `npm run build` (Node 22) | no PR (espelho dos gates locais) |

**Não disponível (não inventar):** lint, formatter, security scanner. Para a função de
"security pass", usar `/codex:adversarial-review` + revisão manual até que um scanner
real seja adicionado (§13).

---

## 10. Formato de relatório ao final de cada ciclo

```markdown
## Ciclo <data> — <slug curto>

- **Origem (backlog):** <openspec change | issue #NNN | upstream commit | findings>
- **Tipo de ciclo:** <PR | bug | sprint | diário>
- **Mudança:** <1–2 frases>
- **Arquivos (N):** <lista>  (orçamento: ≤5 / ≤~150 linhas — respeitado? sim/não)

### Verify
- `npm test`: <baseline X/Y> → <agora X/Y>  (falhas net-new? sim/não)
- `npm run build`: <limpo | erro>
- Verifier: <`/codex:adversarial-review` | `/codex:review` | subagente | humano> → <aprovado | rejeitado: motivo>

### Zonas sensíveis
- Tocou alguma? <não | sim: quais> → <se sim: PAROU e pediu aprovação>

### Memória
- CHANGELOG `[Unreleased]` atualizado? <sim/não/N-A>
- tasks.md marcado `[x]`? <sim/não/N-A>
- Commit: <hash + mensagem convencional>

### Próximo
- **Próxima ação sugerida:** <...>
- **Bloqueios / precisa do fundador:** <...>
```

---

## 11. Proposta de primeiro ciclo piloto

**Escolha de baixo risco, real e que exercita o loop inteiro** sem tocar código de
runtime:

**Piloto: organizar a memória de planejamento solta (docs-only).**

- **Origem:** convenção do `CLAUDE.md` (raiz limpa) + a seção *"Remaining follow-ups
  (optional)"* de `ISSUE-370-FINDINGS.md`.
- **Discover:** confirmar que `ISSUE-370-FINDINGS.md` está na raiz e untracked, e que
  `docs/plans/` já existe; capturar baseline `npm test` / `npm run build`.
- **Plan:** mover `ISSUE-370-FINDINGS.md` → `docs/findings/issue-370.md` (ou
  `docs/plans/`); decidir se `docs/plans/eu-quero-fazer-um-calm-wolf.md` deve ser
  versionado ou ignorado. Nota curta em `docs/plans/`. **Sem mudança de código.**
- **Execute:** o `git mv` / criação de `docs/findings/`.
- **Verify:** `npm test` + `npm run build` (devem permanecer idênticos à baseline —
  docs não afetam); revisão visual do diff.
- **Memory:** commit `docs: relocate issue-370 findings under docs/` (não é mudança de
  usuário-final → **não** mexer em versão/CHANGELOG `[Unreleased]` de produto).
- **Stop/aprovação:** nenhuma zona sensível tocada → pode seguir; ainda assim, **você
  aprova o commit**.

**Alternativa igualmente segura:** capturar formalmente a **baseline de testes** (a
fonte de verdade do "pronto") num `docs/plans/test-baseline.md`, já que docs antigos
divergem (4–7 falhas vs. 0). Isso paga dividendo em todo ciclo futuro.

**Por que este piloto:** exercita Discover→Plan→Execute→Verify→Memory→relatório de
ponta a ponta, com risco ~zero, e já corrige uma violação real de convenção — provando
o loop antes de apontá-lo para código sensível.

---

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Loop desgovernado / cota drenada** (ex.: review-gate ligado) | Gate **off** por padrão; ≤1 verifier-pass/ciclo; time-box; `spark`/`--effort` baixo; `--background` p/ tarefas longas |
| **Auto-edição de código de política sensível** (sandbox/approval, process, broker) | Allowlist rígida (§6); zonas sensíveis (§7/§8) **sempre** passam por humano |
| **Falso "pronto"** por falhas pré-existentes mascarando regressão | **Capturar baseline** no Discover; comparar net-new (mesmo método dos planos superpowers) |
| **Perda de contexto entre execuções** | Discover = re-hidratação (relê tasks/log/CHANGELOG); decisões em openspec/commits, não na sessão |
| **Divergência do upstream** encarecendo merges futuros | Preferir `port:`/`merge:` com atribuição; registrar divergências deliberadas em `design.md` |
| **Vazamento de segredo** (config.toml, tokens, estado) | Nunca ler/ecoar/commitar; manter `tools/` e `output/` gitignored |
| **Ausência de lint/security scanner** | Substituir por `/codex:adversarial-review` + revisão manual; planejar adicionar `npm audit`/linter (§13) — sem fingir que existe |
| **Drift de typedef/JSDoc** (recorrente em `lib/codex.mjs`) | Passo de Verify: conferir `@typedef` ↔ estado; teste/grep dedicado |
| **Mudança de comportamento visível sem rastro** | Gate: README ainda verdadeiro + CHANGELOG `[Unreleased]` antes de "pronto" |
| **Release acidental** (bump/manifests/push) | pre-push hook + `check-version`; release é §7 (aprovação humana explícita) |

---

## 13. Próximos passos

1. **Rodar o ciclo piloto (§11)** e produzir o primeiro relatório (§10) — validar o
   processo antes de escalar.
2. **Fixar a baseline de testes** em `docs/plans/test-baseline.md` (fonte de verdade do
   "sem falhas net-new").
3. **Decidir o destino dos docs de planejamento** soltos: versionar sob `docs/` o que é
   memória útil; ignorar o que é scratch.
4. **Tornar o backlog de port visível**: um comando/alias para
   `git log --oneline HEAD..upstream/main` (e `miketv/main`) na rotina de Discover.
5. **(Opcional, melhoria de portão)** adicionar um passo leve de qualidade — `npm
   audit` e/ou um linter mínimo — como uma `openspec change` própria, já que hoje não
   existem (não tratar como pronto até existir).
6. **Codificar este loop** como prática recorrente: ou como uma `openspec/changes/`
   ("agentic-dev-loop"), ou amarrado a uma cadência via `/loop` (ex.: triagem diária),
   sempre com as Stop Conditions de §5.7 ativas.

> **Conclusão crítica.** Este repositório **já tem** quase todos os primitivos do loop:
> `/codex:review` e `/codex:adversarial-review` (verifier), `/codex:rescue --worktree`
> (execução isolada), `/codex:observe` (observabilidade), `npm test` + `npm run build`
> + pre-push hook (verificação), e `openspec`/`CHANGELOG`/commits (memória). O que falta
> **não é ferramenta nova** — é **disciplina de ciclo, memória explícita e condições de
> parada**. É exatamente isso que este documento padroniza. O fundador continua no
> portão de toda zona sensível; a IA ganha proatividade no resto.
