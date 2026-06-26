---
id: doc-2
title: Log de aprendizados do processo (para melhorar o MCP e suas camadas)
type: other
created_date: '2026-06-25 23:16'
updated_date: '2026-06-26 14:17'
---
# Log de aprendizados do processo

> **Propósito:** registro vivo e analisável dos aprendizados sobre o **processo** (o agentic loop,
> a colaboração Claude↔Codex, o transporte MCP e suas camadas), para melhorar o MCP ao longo do tempo.
> **Como usar:** sempre que surgir um aprendizado, **apêndice uma entrada** no formato abaixo. Mantenha
> analisável: cada entrada tem `data · [área] · título`, a observação, e a **implicação para o MCP/camadas**.
> Áreas: `design · friction · reuse · process · ux · value · handoff`.
> Relacionado: `doc-1` (design do transporte), `task-1.*` (implementação), `tools/driver-metrics.jsonl` (métrica do Driver).

---

## Entradas

### 2026-06-25 · [design] MCP é fachada, não barramento
O Codex (review adversarial) corrigiu o impulso de usar MCP como barramento confiável. **Implicação:**
as garantias de mensageria (entrega/retry/dedup/ordem/durabilidade) moram no **job-relay** (task-1.1);
o MCP é só a API de controle (task-1.2). Não depender de MCP como bus.

### 2026-06-25 · [design] "Sem timer" é ilusão → base assíncrona
A volta síncrona (chamada bloqueante) parecia "sem timer", mas o timeout sempre existe em algum lugar
(cliente/proxy/rede/app-server) e quebra em turno longo. **Implicação:** a base do dispatch é **assíncrona**
(`dispatch → job_id → poll/subscribe`); o síncrono é só atalho (task-1.3).

### 2026-06-25 · [friction] **O problema do gatilho recorre** (o aprendizado mais central)
"Quem puxa o turn?" aparece em DOIS lugares: no Driver (etapa Iterate) e no worker do MCP. Um LLM **não age
sem um turn**; uma subscription MCP só **acorda um processo vivo**, não executa trabalho. **Implicação:** a
camada de **loop/worker** é tão importante quanto o transporte. O relay resolve o encanamento, não a autonomia
— cada ponta interativa precisa de um loop explícito. (RESOLVIDO na entrada de 2026-06-26 sobre Channels.)

### 2026-06-25 · [reuse] ~75% do job-store durável já existe no plugin
`state.mjs` + `event-stream.mjs` + `tracked-jobs.mjs` + `broker-lifecycle.mjs` já dão persistência por-workspace,
log de eventos e daemon detached. **Implicação:** construir o relay **sobre** o que existe, não greenfield —
mantém o escopo enxuto (o right-sizing do Codex).

### 2026-06-25 · [friction] gerenciar app-server por tarefa é a dor que o relay resolve
Subir/derrubar o `:4510` por rodada (e o `pkill` dando exit 144 ao matar o app-server) é exatamente o
"ficar conectando". **Implicação:** o broker (app-server persistente via Unix socket) que o relay-worker reusa
faz isso **sumir** — o usuário não gerencia mais app-server à mão.

### 2026-06-25 · [process] doc deriva do código (drift) — a review adversarial é o que pega
Várias rodadas de review do Codex pegaram o doc **prometendo mais do que o código entrega** (overclaiming).
**Implicação:** design records precisam separar **"atual vs futuro"** explicitamente; e a review adversarial
(Codex) deve ficar **no loop**.

### 2026-06-25 · [ux] linguagem de design de negócio é requisito da camada
O fundador acompanha **resultado + impacto**, não código. **Implicação:** o output do loop/MCP deve narrar em
linguagem de negócio — deve entrar no design da fachada/observabilidade do relay.

### 2026-06-25 · [value] Driver: escopar > escolher; o humano pega o ponto cego de domínio
Medição (3 rodadas): o Driver **escopa bem**, a **escolha** é incerta; e o humano pegou um ponto cego fiscal
que a máquina não viu (`source: :sefaz_dfe`). **Implicação:** o gate humano é **parte do design**, não obstáculo.

### 2026-06-25 · [handoff] o round-trip Claude↔Codex funcionou via inbox de arquivos
O caso resNFe rodou pelo inbox de arquivos do contabil — **exatamente o caminho frágil que o relay substitui**.
**Implicação:** validar (task-1.4) que o relay preserva esse round-trip multi-passo, com durabilidade e sem tmux.

### 2026-06-25 · [reuse] "reuso" precisa ser SELETIVO — a review pegou um furo de durabilidade antes do código
O plano da task-1.1 era reusar o `state.jobs[]` do companion direto. O Codex (`repensar`) mostrou que **não é
durável** (cap compartilhado poda job em voo; save não-atômico apaga a fila; sem lock dá double-claim; dedup
morre no prune). **Implicação:** reusar os **helpers seguros**, não a persistência; e rodar a review do PLANO
antes de codar pagou (evitou um relay volátil).

### 2026-06-25 · [process] Gate-B no CÓDIGO pega bugs que a review do PLANO não pega
O Gate-B do código da 1.1 achou 5 bugs que o plano não mostrava (lock TOCTOU, leitura reescrevendo, corrupção→
vazia, índice não-reconstruído). **Implicação:** revisar o **plano** e o **código** são gates DIFERENTES — bugs
de implementação (concorrência, atomicidade) só aparecem no código. Manter os dois no loop.

### 2026-06-26 · [process] dois gates por camada virou padrão — mas há limites que só o e2e real fecha
1.2/1.3/1.4 repetiram plano→review→código→Gate-B; cada Gate-B de código achou 4-10 refinamentos que o plano não
via. **Aprendizado:** o que depende do ambiente do Claude Code (discovery do MCP, env/cwd, o wake real do channel)
**não** fecha com teste local — vira **caveat e2e** explícito + um passo de verificação separado, em vez de uma
falsa sensação de "100% provado".

### 2026-06-26 · [design] a camada de EXECUÇÃO tem perigo próprio: efeito colateral + at-least-once
A 1.3 trouxe o risco mais sério: **execução DUPLA de um turno que ESCREVE**. O fencing impede double-COMPLETE,
não double-RUN. Proteções (Codex): heartbeat por timer, escrita default-deny, write-park (`needs_recovery`,
nunca auto-rerun), single-flight, timeout que aborta sem órfão, cancel cooperativo. **Implicação:** coordenação
é o fácil; **execução com efeito colateral** é onde mora o perigo — at-least-once + side effects exige
idempotência OU posse garantida OU não-auto-rerun.

### 2026-06-26 · [design] o "problema do gatilho" tem RESPOSTA OFICIAL: Channels (push)
As entradas acima circulavam "quem acorda a sessão Claude?". A resposta inerente **NÃO** é a subscription MCP
(o Claude Code ignora `resources/updated`), é o **Channels** (research preview): um MCP server declara
`claude/channel` e **EMPURRA** `notifications/claude/channel` → o Claude **AGE**. O relay virou um channel:
quando um job que a sessão despachou termina, ele empurra "job done" e o Claude age — **substituto direto do
tmux send-keys**. **Implicação:** a assimetria do transporte está **RESOLVIDA** — Codex (servidor) é CHAMADO
pelo worker (1.3); Claude (interativo) é ACORDADO pelo channel (1.4). O "problema do gatilho" (a entrada mais
central deste log) tem solução oficial. **Caveats:** research preview + dev flag (`--dangerously-load-development-channels`)
+ auth Anthropic → caminho com data de validade até sair do preview; o wake real é verificação e2e. E channel é
**vetor de injeção**: content só envelope mínimo (job_id/state), ids sanitizados, result fica fora (Claude usa `poll`).
