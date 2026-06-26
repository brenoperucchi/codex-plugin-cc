---
id: doc-1
title: Camada de transporte MCP / job-relay — design e review do Codex
type: other
created_date: '2026-06-25 22:58'
---
# Camada de transporte MCP / job-relay — design

> Referência durável para as tasks de implementação. Resume a discussão de arquitetura e a
> **review adversarial do Codex** (veredito `solido_com_mudancas`). Leia antes de executar qualquer task.

## Problema

O plugin (codex-plugin-cc) orquestra colaboração entre LLMs (Claude planeja/escopa, Codex implementa — o "motor"). Hoje o transporte é **ponto-a-ponto e fragmentado**:
- `codex-ws` — WebSocket JSON-RPC ao app-server do Codex (ex.: `ws://127.0.0.1:4500`). Síncrono, mesma máquina.
- inbox de arquivos (`backlog/inbox/`) + daemon `inbox-watcher` que roteia por `tmux send-keys`. Frágil.
- `review-loop` — wrapper sobre os dois.

Dor: "ficar conectando" — subir app-server por tarefa, amarrar tmux, fios por ponta. Sem garantias de mensageria (entrega, retry, dedup, ordem, durabilidade) — hoje são informais.

## Proposta (a "nova estrutura")

Uma **camada de transporte única** entre os agentes, com **MCP como fachada** e uma **fila durável por baixo** (NÃO o MCP como barramento). Claude e Codex já falam MCP, então a fachada é a língua comum que ambos plugam.

### Decisão central (corrigida pela review do Codex)
- **MCP é a FACHADA / API de controle**, não o barramento confiável. Bom para: registrar agente, criar job, consultar status, expor inbox como *resource*. Ruim como semântica central de fila distribuída.
- **A base é ASSÍNCRONA:** `dispatch → job_id → acompanha (poll/subscribe)`. O modo síncrono (`dispatch_and_wait(timeout=30s)`) é **conveniência para tarefas curtas, não a base** — o "sem timer" é ilusão (o timeout sempre existe em algum lugar: cliente, proxy, rede, app-server).
- **Worker que é servidor (Codex app-server) NÃO precisa de loop** — o relay chama via codex-ws (turn/start → turn/completed). **Worker interativo (sessão Claude) PRECISA de um loop** que puxa a mailbox (problema do gatilho; subscription só acorda um processo vivo, não executa trabalho).
- **Mesmo no modo síncrono, o resultado é gravado como job durável ANTES de responder** (sobrevive a queda/restart).

## Right-sizing (o ponto mais importante do Codex — custo/benefício)

> Para o que se faz HOJE (Claude manda tarefa pro Codex e recebe a volta), **NÃO é preciso o roteador MCP completo.** Manter o `codex-ws` (chamada síncrona ao servidor Codex) e trocar só o pedaço frágil (inbox/tmux) por um **"relay simples com trabalhos persistidos"** entrega ~80% com muito menos risco.

O roteador MCP **completo + cross-machine** só compensa quando o objetivo for **multi-máquina + multi-agente + auditável**. Antes disso é over-engineering.

→ **Sequência:** primeiro o **job-relay durável + fachada MCP local** (o 80%), reusando codex-ws para a chamada ao servidor Codex. Multi-máquina/segurança = fase futura.

## Garantias que precisam ser EXPLÍCITAS (não implícitas — onde quebra na vida real)

- **Modelo de job:** `queued | claimed | running | completed | failed | cancelled | expired`.
- **Idempotência/dedup:** `request_id` idempotente, `job_id`, `attempt`, `ack`, `lease`, retry policy.
- **Persistência DURÁVEL** no relay (não só memória).
- **Backpressure:** limite por agente, tamanho de payload, fila máxima, TTL, prioridade.
- **Cancelamento + heartbeat.**
- **Contrato de timeout:** curto para `dispatch`; longo via `poll/subscribe`.
- **Logs auditáveis** por mensagem/job/tool-invocation.
- **Separação:** "mensagem de coordenação" vs "execução com permissão de ESCRITA".
- **Fallback** quando o Codex app-server cai/reinicia/perde o turno.
- **Compat real** com Claude Code/Codex MCP: timeouts, reconexão, streaming, subscriptions, limites de payload.

## Substrato (a decidir)

Codex sugeriu, para o barramento confiável: **Postgres queue · Redis Streams · NATS · RabbitMQ · Temporal**. MCP como fachada; gRPC/HTTP direto (codex-ws) quando há servidor real; WebSocket/SSE só para notificação/streaming, não como fonte da verdade.

## Riscos (Codex)

- MCP como barramento é off-label → reconstruir mal o que uma fila já resolve.
- Chamada bloqueante longa quebra por timeout/proxy/idle/rede/restart; relay segurando N chamadas = gargalo.
- Cross-machine roteando tarefas com escrita = superfície sensível (auth, authz por agente/projeto, isolamento de workspace, auditoria, criptografia, revogação, injeção atravessando máquinas).
- Semântica de execução ambígua se sem `job_id`/dedup/estado persistido.

## Resumo em uma frase

A ideia é boa como **orquestrador com API MCP**, mas perigosa se vendida como "MCP substitui broker + websocket + inbox + review-loop" sem implementar as garantias que esses caminhos davam informalmente. Comece pelo **job-relay durável (80%, menos risco)**; trate o roteador MCP multi-máquina como visão futura.
