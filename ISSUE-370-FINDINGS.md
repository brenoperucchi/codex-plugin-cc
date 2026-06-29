# Issue #370 — "tasks silently die at ~10 minutes" — root cause + fix plan

**Status:** ✅ **Fixed (Fix B, task/rescue path) on branch work in progress.** Root cause confirmed with a
deterministic repro; the foreground `task` path now runs the Codex turn in the detached worker and only
*observes* it, so it survives the 10-minute Bash ceiling. See "## Resolution (implemented)" below.
**Upstream issue:** https://github.com/openai/codex-plugin-cc/issues/370
**Investigated against:** plugin v1.0.4 (`807e03a`), installed copy at
`~/.claude/plugins/cache/openai-codex/codex/1.0.4/` (identical to `plugins/codex/` in this repo).

---

## TL;DR

- `/codex:rescue` (and any `task` run **without `--background`**) executes the Codex turn **inline, in the foreground process**. That process runs under Claude Code's **Bash-tool hard ceiling of 600 000 ms (10 min)**, which SIGTERMs the process tree at 10 min.
- The **`--background` path is immune**: it spawns a worker with `detached: true` (POSIX `setsid` → new session/process group), which survives the SIGTERM. The broker is also already detached.
- So long foreground tasks get **killed mid-turn at ~10 min → the job is left stuck in `status: "running"` with a frozen log forever** (the broker never receives turn-completion because the in-flight turn was killed).
- **Proven:** a 12-minute task run **detached** completes cleanly; the same length run **foreground** dies at 10 min. The broker's completion bookkeeping is **fine** — this is purely a dispatch/lifecycle issue.

---

## Symptom

Long-running rescue/task dispatches (≈10 min+) never return a result. From the Claude side the
forwarder returns "still running"; the job stays `running` indefinitely; the per-job log freezes at
whatever the agent was doing around the 10-minute mark. Short tasks (seconds–minutes) work fine.

## Root cause (with line references)

`plugins/codex/scripts/codex-companion.mjs`:

- **`handleTask(argv)` — line 732.** Branch split:
  - `if (options.background)` (**line 758**) → `enqueueBackgroundTask` → `spawnDetachedTaskWorker`. **Survives.**
  - else (**foreground, default**, lines 777–792) → `runForegroundCommand(job, () => executeTaskRun({...}))`.
    The Codex turn runs **inline in the current process**. **Killed at the 10-min Bash ceiling.**
- **`spawnDetachedTaskWorker(cwd, jobId)` — line 641.** Spawns `task-worker` with
  `detached: true` (**line 646**) + `child.unref()` (**line 650**). `detached: true` on POSIX makes the
  child a session leader (`setsid`), so the harness SIGTERM at 10 min does **not** reach it.
- **`DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000` — line 67** (used by `waitForSingleJobSnapshot`, line 315):
  even a healthy 5–10 min job makes the foreground observer return `waitTimedOut` after only **4 min**,
  so the forwarder reports "still running" well before completion.
- `plugins/codex/scripts/lib/broker-lifecycle.mjs` — `spawnBrokerProcess` (line ~59) already uses
  `detached` + `unref`; the broker process is **not** the problem.

**Why it bit every long dispatch:** `/codex:rescue` defaults to **foreground** when neither `--wait`
nor `--background` is present (see `plugins/codex/commands/rescue.md`). So long rescues always took the
inline path → 10-min kill.

Issue #370 corroborates: Claude Code's Bash tool enforces a 600 000 ms ceiling and **SIGTERM propagates
to the process tree**; the proposed workaround is to detach long dispatches into a separate session
(`setsid`/tmux + isolated socket).

## Evidence / deterministic reproduction

Topology (discovered at runtime):
- `~/.claude/plugins/data/codex-openai-codex/state/<workspace-slug>/state.json` — canonical job store
  (`status`, `phase`, `startedAt`, `completedAt`, `turnId`, `logFile`).
- `.../broker.json` — `endpoint`/`pid` + `logFile` (the broker log lives at `/tmp/cxc-*/broker.log`).
- `.../jobs/<job-id>.log` — per-job streamed log.

**Decisive experiment (detached survives >10 min):**

```bash
# launch a 12-min task in a NEW SESSION (bypasses the 10-min Bash ceiling):
setsid bash -c 'node ~/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs \
  task "Run the shell command sleep 720, then reply concluido. Do not edit anything." --write \
  > /tmp/repro.out 2>&1' &
```

Result (`state.json`): `status: completed`, `phase: done`, `startedAt 05:16:10 → completedAt 05:28:19`
(~12 min), `errorMessage: null`. Log shows `Running command: sleep 720` → `Command completed (exit 0)`
→ `Turn completed.` ✅ — **detached job runs the full 12 min and the broker records `done`.**

**Contrast (foreground via `/codex:rescue`):** identical-length implementation tasks dispatched through
the rescue subagent (foreground default) were left `status: running` with logs frozen for **2h+**
(observed elapsed 2h51m, frozen mid-command) until manually `cancel`led.

**Control:** ~90 s tasks complete cleanly on either path.

## Fix options

### (A) Minimal — make `/codex:rescue` default to `--background`
Change the rescue command flow (`plugins/codex/commands/rescue.md` + the `codex:codex-rescue`
subagent) to dispatch with `--background` and then poll `/codex:status <id>` → `/codex:result <id>`.
Matches #370's suggested direction; small surface; low risk. Downside: loses live foreground streaming
(replaced by polling).

### (B) Correct — make the foreground path survivable (recommended for an upstream PR)
In `handleTask` foreground branch (line 777): instead of running the turn **inline**, route through
`spawnDetachedTaskWorker` (same as background) and have the foreground process **tail the worker's job
log + `waitForSingleJobSnapshot`**. If the foreground observer is killed at 10 min, the **detached
worker keeps running, finishes, and records `done`**, and the result stays retrievable via
`/codex:result`. Net effect: foreground keeps live output, but the work no longer dies silently.
Also bump `DEFAULT_STATUS_WAIT_TIMEOUT_MS` (240000 → ~1 800 000) so the observer doesn't prematurely
report "still running".

Suggested PR: branch `fix/issue-370-foreground-detach`, reference #370, include the deterministic
`sleep 720` repro (detached completes / foreground dies) as evidence.

## Resolution (implemented)

**Fix B, scoped to the task/rescue path**, in `plugins/codex/scripts/codex-companion.mjs`:

- **Foreground `task` no longer runs the turn inline.** `handleTask`'s default (foreground) branch now
  calls `enqueueDetachedTask` (the same detached worker the `--background` path uses) and then
  `observeDetachedTask`, which streams the worker's job log to stderr and polls
  `buildSingleJobSnapshot` until the job reaches a terminal state. When the harness SIGTERMs this
  observer at 10 min, the **detached worker (own session via `setsid`) keeps running, records `done`,
  and the result stays retrievable via `/codex:result <id>`** — no more silent death / stuck `running`.
- **Output parity preserved** so the three foreground consumers keep working unchanged:
  - rescue subagent + CLI (non-JSON): observer prints the stored `rendered` to **stdout** (identical to
    the old inline `execution.rendered`), progress + a `/codex:result <id>` hint go to **stderr**.
  - stop hook (`stop-review-gate-hook.mjs` spawns `task --json` and parses `JSON.parse(stdout).rawOutput`):
    observer prints the stored `result` payload to stdout on success; a thrown failure writes the error
    to stderr with a non-zero exit, exactly like the old inline `main().catch`.
- **`enqueueBackgroundTask` → `enqueueDetachedTask`**, reordered to persist the job record (with its
  `request` payload) **before** spawning the worker, eliminating the worker-reads-before-record race that
  the foreground observer would otherwise surface as a hang. The worker pid is patched into the index
  afterward (via `upsertJob`, merge-only) so `/codex:cancel` can still reach a not-yet-running job.
- **`DEFAULT_STATUS_WAIT_TIMEOUT_MS` 240000 → 1800000** so `/codex:status --wait` (and the observer
  backstop) no longer reports "still running" after only 4 min on a healthy long job.

**Scope decision — review/adversarial-review intentionally left inline (open question #3 resolved).**
Their long-running path is *already* detached at a different layer: `commands/review.md` runs the
companion under Claude Code's `Bash(..., run_in_background: true)`, which is immune to the 10-minute
foreground ceiling. The companion's `review --background` is pinned to **inline, full-result** behavior
by `tests/runtime.test.mjs:898` (`launchPayload.review`/`codex.stdout` asserted), and the foreground
review flow is intentionally limited to "clearly tiny, roughly 1-2 files" reviews. Rerouting review
through the detached worker would break that pinned contract for no real safety gain, so it was excluded.
(If a long `/codex:review --wait` ever needs the same protection, the safe move is a command-level nudge
to background, not a companion-level reroute.)

**Tests:** `node --test tests/*.test.mjs` → 83 pass / 4 fail, where the 4 failures are **pre-existing and
environmental** (they fail identically on the pristine tree — `resolveStateDir` resolves to a non-temp
path on this machine for the hand-written-state `status`/`result` fixtures). New regression test:
`tests/runtime.test.mjs` → *"foreground task survives its observer being killed mid-run and stays
retrievable (#370)"* launches a foreground `task` as its own process-group leader, SIGKILLs the
observer's group mid-turn, and asserts the detached worker still drives the job to `completed` and
`/codex:result` returns it.

## Immediate workaround (no code change)

Dispatch long rescues with **`--background`** and poll status/result:

```
/codex:rescue --background "<long task>"
/codex:status <jobId>
/codex:result <jobId>
```

## Debug tooling

`tools/codex-plugin-debug.sh` (copied into this fork). Subcommands:

- `diag` (default, read-only) — runtime/auth, jobs from `state.json`, broker.log, and a verdict that
  flags jobs stuck in `running` with a frozen log; for stuck `turnId`s it greps `broker.log` for a
  matching completion event (the Fato A vs Fato B discriminator).
- `watch` — live loop of active jobs + log age.
- `tap` — `tail -f` broker.log + newest job log.
- `locate` — greps the broker source for the status-write / turn-complete handlers.
- `repro [min] "<task>"` — launches a long task **detached** (`setsid`) to bypass the 10-min ceiling.
  ⚠️ avoid backticks/`$` in the task text (shell substitution).
- `instrument` / `restore` — backup + guidance to add `[DBG]` tracers to the broker / revert.
- `cancelall` — cancel all running jobs.
- `fork` — `gh fork` + clone.

Repro recipe to catch a *genuine* hang live (foreground path):
```bash
# from a repo with a real long task; dispatch via the rescue subagent (foreground), then:
tools/codex-plugin-debug.sh watch     # watch log_age climb past 10 min
tools/codex-plugin-debug.sh diag      # verdict: running + frozen log = the 10-min kill
```

## Key files

| File | What |
|---|---|
| `plugins/codex/scripts/codex-companion.mjs` | `handleTask` (732), bg branch (758), fg inline (777), `spawnDetachedTaskWorker` (641, `detached:true` 646), `DEFAULT_STATUS_WAIT_TIMEOUT_MS` (67), `waitForSingleJobSnapshot` (315), `handleTaskWorker` (795) |
| `plugins/codex/scripts/lib/broker-lifecycle.mjs` | broker spawn (already detached) |
| `plugins/codex/commands/rescue.md` | rescue dispatch flow (defaults to foreground) |

## Open questions — resolved

1. ✅ `--background` avoids the hang (it always spawned the detached worker). Fix B now gives the
   foreground path the same survivability.
2. ✅ Chose **B**. Confirmed `task-worker` → `runTrackedJob` writes the full `result` payload + `rendered`
   to the job file, so a killed foreground observer loses nothing — `/codex:result` reads exactly that.
3. ✅ Investigated. `review`/`adversarial-review` foreground IS inline, **but** their long-running path is
   already detached at the Bash-tool layer (`run_in_background: true`) and their `--background` inline
   behavior is pinned by tests, so they were intentionally left as-is. See "Scope decision" above.
4. ✅ Added (`tests/runtime.test.mjs`, the "#370" test described under "## Resolution").

## Remaining follow-ups (optional, for the upstream PR)

- Consider a one-line note in `commands/rescue.md` / the rescue agent that a foreground rescue killed at
  the 10-min ceiling is now recoverable via `/codex:result <id>` (the observer already prints that hint to
  stderr at dispatch, so it is self-documenting at runtime).
- The streamed foreground progress now shows the worker's timestamped log lines on stderr (instead of the
  old `[codex] <message>` lines). Functionally equivalent; flag it in the PR description.
