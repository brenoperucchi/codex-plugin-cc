# Relay MCP server

The **MCP facade** over the durable job-relay (`lib/relay-jobs.mjs`). It lets agents
(Claude, Codex) dispatch and track jobs through a standard MCP interface instead of
ad-hoc transports.

## How it is wired

Declared in [`plugins/codex/.mcp.json`](../.mcp.json):

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/relay-mcp-server.mjs"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}",
        "CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

When the plugin is installed, Claude Code auto-discovers and connects this server at
session start. It is a **stdio** server speaking **newline-delimited JSON-RPC 2.0**
(one JSON object per line; stdout is protocol-only, logs go to stderr).

**No daemon.** Claude Code spawns one server process per session; every instance talks
to the *same* per-workspace `relay-state.json` directly, coordinated by the relay's
interprocess lock. The durable store is the shared state — there is no central process.

Tools/resources appear to the model as `mcp__plugin_codex_relay__<tool>`.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `register_agent` | `agent_id` (string) | `{agentId, inboxUri, registeredAt, lastSeen}` — makes the agent's inbox discoverable before any job arrives |
| `dispatch` | `to` (string), `task` (any JSON), `request_id` (string), `ttl_ms?` (number ≥ 0) | `{job_id, deduped, state}` — enqueues and returns **immediately**; idempotent by `request_id` |
| `poll` | `job_id` (string) | `{found, job_id, state, result, error, attempts}` |

`dispatch` is coordination only: `task` is an opaque payload that is **not executed** by
this server (worker-side `claim`/`complete` and execution arrive in TASK-1.3).

## Resources

- `relay://inbox/{agent}` — a resource template (`resources/templates/list`). Reading
  `relay://inbox/<agent>` returns `{jobs, truncated}` — the jobs currently **queued** for
  that agent (capped by count and bytes).
- `resources/list` returns the inboxes of registered agents.
- `resources/subscribe` on an inbox registers a subscription and sends an initial
  `notifications/resources/updated`. Updates are **best-effort wake-ups** (via `fs.watch`
  + a polling fallback); the source of truth is always `resources/read` / `poll`. A missed
  notification only means a late refresh, never a lost job.

## Channel: cross-session "job done" notifications (replaces tmux send-keys)

The relay server is also a **Claude Code channel** (research preview): it can **push** a
notification into a *running* Claude session when a background job finishes — so the agent
acts on it without anyone injecting keystrokes into a terminal (the old tmux/`inbox-watcher`
hack). This is the inherent answer to "how does one CLI session learn a job finished?".

- The session's agent identity comes from the **`RELAY_AGENT`** env var. The channel only
  emits when it is set; without it the capability is still declared but **nothing is pushed**
  (never broadcast to the wrong session).
- The server watches `relay-state.json` and emits `notifications/claude/channel` when:
  - a **terminal** job (`completed`/`failed`/`needs_recovery`/`cancelled`/`expired`) that
    **this agent dispatched** (`from === RELAY_AGENT`) finishes, or
  - a **new `queued`** job lands in this agent's inbox (`to === RELAY_AGENT`).
- The `dispatch` tool stamps `from = RELAY_AGENT` itself (never trusted from arguments).
- **Injection guard:** the event content is a minimal envelope (`job_id`, `state`) and tells
  Claude to treat it as a notification only and call `poll` for the result. The untrusted job
  result/payload is **never** put in the channel content.
- Events are de-duplicated (one per logical transition) and seeded at startup (no flood of
  historical completions). The channel is a **signal**; `poll`/the inbox resource/the durable
  store remain the source of truth.

**Enabling it** (research preview — needs Claude Code ≥ v2.1.80, Anthropic auth, not
Bedrock/Vertex):

```bash
RELAY_AGENT=claude-main claude --dangerously-load-development-channels server:relay
```

This, together with the worker (TASK-1.3), replaces the fragile transport: **Codex** (a
server) is *driven* by the worker, and **Claude** (an interactive session) is *woken* by the
channel — so `inbox-watcher.sh` + `tmux send-keys` are no longer needed.

## Timeout contract

`dispatch` returns a `job_id` fast; long-running tracking happens via `poll` or an inbox
subscription. There are no long-blocking tool calls.

## Limits & lifecycle

- `initialize` must be the first request (others before it get JSON-RPC `-32600`; `ping`
  is always allowed). Notifications are not emitted before `notifications/initialized`.
- Per-message size cap (`RELAY_MCP_MAX_LINE`, default 5 MB), per-task cap (1 MB), inbox
  read response cap (1 MB). Malformed lines return a JSON-RPC error and never crash the
  server.
- JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` method, `-32602`
  params, `-32603` internal (e.g. a corrupt store surfaces as `-32603`, not a crash).

## Caveat (needs real-install verification)

Workspace resolution uses `CLAUDE_PROJECT_DIR` (falling back to `process.cwd()`), passed
through `.mcp.json` env. End-to-end discovery and the exact spawn cwd/env that Claude Code
provides to plugin MCP servers should be confirmed on a real install.
