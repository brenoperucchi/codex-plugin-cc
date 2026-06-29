---
id: doc-2
title: Log de aprendizados do processo (para melhorar o MCP e suas camadas)
type: other
created_date: '2026-06-25 23:16'
updated_date: '2026-06-28 01:01'
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
camada de **loop/worker** é tão importante quanto o transporte. (RESOLVIDO + PROVADO — ver entradas de
2026-06-26 e 2026-06-28 sobre Channels.)

### 2026-06-25 · [reuse] ~75% do job-store durável já existe no plugin
`state.mjs` + `event-stream.mjs` + `tracked-jobs.mjs` + `broker-lifecycle.mjs` já dão persistência por-workspace,
log de eventos e daemon detached. **Implicação:** construir o relay **sobre** o que existe, não greenfield.

### 2026-06-25 · [friction] gerenciar app-server por tarefa é a dor que o relay resolve
Subir/derrubar o `:4510` por rodada é o "ficar conectando". **Implicação:** o broker (app-server persistente via
Unix socket) que o relay-worker reusa faz isso **sumir** — provado: o worker rodou Codex real sem o usuário
gerenciar app-server.

### 2026-06-25 · [process] doc deriva do código (drift) — a review adversarial é o que pega
Várias rodadas de review do Codex pegaram o doc **prometendo mais do que o código entrega**. **Implicação:**
design records precisam separar **"atual vs futuro"**; e a review adversarial (Codex) deve ficar **no loop**.

### 2026-06-25 · [ux] linguagem de design de negócio é requisito da camada
O fundador acompanha **resultado + impacto**, não código. **Implicação:** o output do loop/MCP deve narrar em
linguagem de negócio — deve entrar no design da fachada/observabilidade do relay.

### 2026-06-25 · [value] Driver: escopar > escolher; o humano pega o ponto cego de domínio
Medição (3 rodadas): o Driver **escopa bem**, a **escolha** é incerta; e o humano pegou um ponto cego fiscal
que a máquina não viu (`source: :sefaz_dfe`). **Implicação:** o gate humano é **parte do design**, não obstáculo.

### 2026-06-25 · [handoff] o round-trip Claude↔Codex funcionou via inbox de arquivos
O caso resNFe rodou pelo inbox de arquivos — **o caminho frágil que o relay substitui**. **Implicação:** validar
(task-1.4) que o relay preserva esse round-trip, com durabilidade e sem tmux.

### 2026-06-25 · [reuse] "reuso" precisa ser SELETIVO — a review pegou um furo de durabilidade antes do código
Reusar o `state.jobs[]` do companion direto NÃO era durável (cap compartilhado poda job; save não-atômico apaga
a fila; sem lock dá double-claim; dedup morre no prune). **Implicação:** reusar os **helpers seguros**, não a
persistência; rodar a review do PLANO antes de codar pagou.

### 2026-06-25 · [process] Gate-B no CÓDIGO pega bugs que a review do PLANO não pega
O Gate-B do código da 1.1 achou 5 bugs que o plano não mostrava (lock TOCTOU, leitura reescrevendo, corrupção→
vazia, índice não-reconstruído). **Implicação:** revisar o **plano** e o **código** são gates DIFERENTES.

### 2026-06-26 · [process] dois gates por camada virou padrão — mas há limites que só o e2e real fecha
1.2/1.3/1.4: cada Gate-B de código achou 4-10 refinamentos que o plano não via. **Aprendizado:** o que depende do
ambiente do Claude Code não fecha com teste local — vira **caveat e2e** explícito + verificação separada.

### 2026-06-26 · [design] a camada de EXECUÇÃO tem perigo próprio: efeito colateral + at-least-once
A 1.3 trouxe o risco mais sério: **execução DUPLA de um turno que ESCREVE**. O fencing impede double-COMPLETE,
não double-RUN. Proteções: heartbeat por timer, escrita default-deny, write-park, single-flight, timeout que
aborta sem órfão, cancel cooperativo. **Implicação:** at-least-once + side effects exige idempotência OU posse
garantida OU não-auto-rerun.

### 2026-06-26 · [design] o "problema do gatilho" tem RESPOSTA OFICIAL: Channels (push)
A resposta inerente **NÃO** é a subscription MCP (o Claude Code ignora `resources/updated`), é o **Channels**:
um MCP server declara `claude/channel` e **EMPURRA** `notifications/claude/channel` → o Claude **AGE**. O relay
virou um channel. **Implicação:** Codex (servidor) é CHAMADO pelo worker; Claude (interativo) é ACORDADO pelo
channel. Caveats: research preview + dev flag + auth Anthropic. Channel é vetor de injeção: content só envelope
mínimo, ids sanitizados, result fica fora (Claude usa `poll`).

### 2026-06-28 · [process] ✅ o channel wake foi VALIDADO numa sessão interativa real (capstone)
Numa sessão `claude --dangerously-load-development-channels server:relay` (build 2.1.193, `RELAY_AGENT=claude-main`)
**ociosa**, um job despachado `claude-main→codex` foi completado pelo worker (**Codex real**) e a sessão
**acordou sozinha**: `← relay: Job … is now completed` → chamou `poll` → reportou o resultado — **sem tmux, sem
input do usuário**. O "problema do gatilho" (a entrada mais central deste log) está **provado na prática**, não só
no papel. **Aprendizado de método:** a automação headless (`claude -p`) NÃO conseguiu mostrar isso (sai entre
turnos) — só a sessão **INTERATIVA** recebe o push; logo "teste e2e de channel = interativo", e um resultado
negativo no headless **não** é evidência contra o recurso (cuidado com falsos negativos por escolher o vehicle
de teste errado). Os caveats e2e que eu listei estão **todos fechados em ambiente real**: execução real do Codex
(worker) ✅, fachada MCP + `poll` ✅, channel wake ✅. Cautela remanescente: é research preview (flag/protocolo
podem mudar) — a fundação (relay+fachada+worker) é GA-estável e independe disso.
