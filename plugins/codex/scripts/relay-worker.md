# Relay worker & dispatch flows

The **execution** side of the MCP transport. It drives queued relay jobs to a result.
It is intentionally separate from the MCP coordination facade (`relay-mcp-server.mjs`):
the facade only coordinates (enqueue/poll); only the worker runs turns (which can
write files). Code: `lib/relay-worker.mjs`; CLI: `relay-worker.mjs`.

## The two dispatch flows

**Async (the base).** A client calls the facade's `dispatch` → gets a `job_id` back
immediately → tracks via `poll(job_id)` or an inbox subscription. The job sits `queued`
until a worker picks it up. **Async jobs only execute while a worker is running** — run
`node relay-worker.mjs --agent codex`.

**Sync convenience (`dispatchAndWait`).** Enqueues and waits for the result. It is
**single-flight**: it tries to claim the job; if another worker already owns it, it only
**polls** (it never runs the same job twice). On timeout it **aborts** the turn (no
orphaned run) and returns `{job_id, state, timedOut}` — the durable result (if any) is
always written before returning. Not exposed on the coordination facade.

## Worker-loop contract

- **Codex (a server)** does not need a loop of its own. The worker *drives* it by calling
  `runAppServerTurn` (the plugin's app-server, over a Unix socket — never the live
  `ws://:4500`). So "the relay calls Codex" = the worker calls the app-server on demand.
- **An interactive worker (a Claude session)** cannot be called like a server, so it needs
  its **own loop**: poll its inbox (`relay://inbox/<self>`) → claim → do the work → complete.
  A subscription only *wakes* a live process; it does not execute work. (This is the
  recurring "who pulls the turn?" problem — the transport moves messages, not autonomy.)

## Write safety

Running a turn with write access has real side effects, so:

- **Writes are denied by default.** A job whose payload has `write: true` only runs with
  `allowWrites` (the `--allow-writes` CLI flag). Otherwise the job fails before any turn runs.
- A **write job whose lease expires is parked** (`needs_recovery`), never auto re-run — we
  cannot know whether the dead owner already committed the writes. Use `recover(job_id)` to
  explicitly put it back to `queued`, or re-dispatch with a new `request_id`.
- Read-only jobs are safe to **requeue** on lease expiry.

## Job lifecycle safety (recap)

- **Heartbeat by timer** keeps the lease alive during a silent turn, so the job is not
  requeued and re-run while a worker is alive.
- **Fencing token** per claim: a worker whose lease expired cannot complete a reassigned job.
- **Cancellation is cooperative**: cancelling the job makes the worker's heartbeat tick abort
  the turn (best-effort for a real Codex turn, which has no native abort).

## Codex job payload

A job addressed to `codex` carries `{ prompt, model?, effort?, write? }`. A payload without a
`prompt` fails with a clear error.

## Caveat (needs real-run verification)

Tests inject a fake `runTurn`, so the worker lifecycle (heartbeat, claim, timeout, cancel,
dedup, write-park) is fully covered without a Codex binary. The **real** `runAppServerTurn`
execution (a live Codex turn, file writes, real abort behaviour) is a separate end-to-end
verification step.
