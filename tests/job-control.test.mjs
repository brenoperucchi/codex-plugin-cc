import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  isStreamableProgressLine,
  resolveCancelableJob,
  resolveResultJob
} from "../plugins/codex/scripts/lib/job-control.mjs";
import { collectWorkspaceJobsAcrossRoots, resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";

describe("job-control cross-workspace fallback", () => {
  let pluginDataDir;
  let currentWorkspace;
  let previousPluginData;

  beforeEach(() => {
    pluginDataDir = mkdtempSync(path.join(tmpdir(), "job-control-cross-"));
    currentWorkspace = mkdtempSync(path.join(tmpdir(), "job-control-cwd-"));
    previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  });

  afterEach(() => {
    if (previousPluginData === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    }
    rmSync(pluginDataDir, { recursive: true, force: true });
    rmSync(currentWorkspace, { recursive: true, force: true });
  });

  function writeRemoteWorkspaceJob(slug, job) {
    const stateDir = path.join(pluginDataDir, "state", slug);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "state.json"),
      `${JSON.stringify({ version: 1, jobs: [job] }, null, 2)}\n`,
      "utf8"
    );
    return stateDir;
  }

  it("buildSingleJobSnapshot falls back to cross-workspace by job id", () => {
    const job = {
      id: "task-abc-running",
      status: "running",
      workspaceRoot: "/some/other/repo",
      logFile: path.join(pluginDataDir, "log.txt"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const stateDir = writeRemoteWorkspaceJob("remote-aaaaaaaaaaaaaaaa", job);

    const snapshot = buildSingleJobSnapshot(currentWorkspace, "task-abc-running");
    assert.equal(snapshot.crossWorkspace, true);
    assert.equal(snapshot.crossWorkspaceStateDir, stateDir);
    assert.equal(snapshot.workspaceRoot, "/some/other/repo");
    assert.equal(snapshot.job.id, "task-abc-running");
    assert.equal(snapshot.job.status, "running");
  });

  it("buildSingleJobSnapshot still throws when job id is unknown anywhere", () => {
    assert.throws(
      () => buildSingleJobSnapshot(currentWorkspace, "task-nope"),
      /No job found for "task-nope"/
    );
  });

  it("resolveResultJob falls back to cross-workspace finished job", () => {
    const job = {
      id: "task-done-1",
      status: "completed",
      workspaceRoot: "/some/other/repo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeRemoteWorkspaceJob("remote-bbbbbbbbbbbbbbbb", job);

    const result = resolveResultJob(currentWorkspace, "task-done-1");
    assert.equal(result.crossWorkspace, true);
    assert.equal(result.workspaceRoot, "/some/other/repo");
    assert.equal(result.job.id, "task-done-1");
  });

  it("resolveResultJob rejects cross-workspace job that is still running", () => {
    const job = {
      id: "task-still-running",
      status: "running",
      workspaceRoot: "/some/other/repo"
    };
    writeRemoteWorkspaceJob("remote-cccccccccccccccc", job);

    assert.throws(
      () => resolveResultJob(currentWorkspace, "task-still-running"),
      /is still running in another workspace/
    );
  });

  it("resolveCancelableJob falls back to cross-workspace running job by id", () => {
    const job = {
      id: "task-cancelable",
      status: "running",
      workspaceRoot: "/some/other/repo",
      pid: 0
    };
    writeRemoteWorkspaceJob("remote-dddddddddddddddd", job);

    const result = resolveCancelableJob(currentWorkspace, "task-cancelable", { env: {} });
    assert.equal(result.crossWorkspace, true);
    assert.equal(result.workspaceRoot, "/some/other/repo");
    assert.equal(result.job.id, "task-cancelable");
  });

  it("resolveCancelableJob rejects a non-active cross-workspace match with a clear message", () => {
    const job = {
      id: "task-not-active",
      status: "completed",
      workspaceRoot: "/some/other/repo"
    };
    writeRemoteWorkspaceJob("remote-eeeeeeeeeeeeeeee", job);

    assert.throws(
      () => resolveCancelableJob(currentWorkspace, "task-not-active", { env: {} }),
      /Nothing to cancel/
    );
  });

  it("resolveCancelableJob without reference still requires a local active job", () => {
    assert.throws(
      () => resolveCancelableJob(currentWorkspace, "", { env: {} }),
      /No active Codex jobs to cancel/
    );
  });
});

describe("multi-root state scan", () => {
  let primaryDataDir;
  let legacyRoot;
  let currentWorkspace;
  let previousPluginData;
  let previousLegacyRoots;

  beforeEach(() => {
    primaryDataDir = mkdtempSync(path.join(tmpdir(), "multi-root-primary-"));
    legacyRoot = mkdtempSync(path.join(tmpdir(), "multi-root-legacy-"));
    currentWorkspace = mkdtempSync(path.join(tmpdir(), "multi-root-cwd-"));
    previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
    previousLegacyRoots = process.env.CODEX_COMPANION_LEGACY_ROOTS;
    process.env.CLAUDE_PLUGIN_DATA = primaryDataDir;
    process.env.CODEX_COMPANION_LEGACY_ROOTS = legacyRoot;
  });

  afterEach(() => {
    if (previousPluginData === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    }
    if (previousLegacyRoots === undefined) {
      delete process.env.CODEX_COMPANION_LEGACY_ROOTS;
    } else {
      process.env.CODEX_COMPANION_LEGACY_ROOTS = previousLegacyRoots;
    }
    rmSync(primaryDataDir, { recursive: true, force: true });
    rmSync(legacyRoot, { recursive: true, force: true });
    rmSync(currentWorkspace, { recursive: true, force: true });
  });

  function writeStateAt(rootDir, slug, state) {
    const stateDir = path.join(rootDir, slug);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    return stateDir;
  }

  it("findJobByIdAcrossWorkspaces falls through to a legacy root", () => {
    const job = {
      id: "task-only-in-legacy",
      status: "completed",
      workspaceRoot: "/legacy/repo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const stateDir = writeStateAt(legacyRoot, "legacy-foo-0011223344556677", {
      version: 1,
      jobs: [job]
    });

    const snapshot = buildSingleJobSnapshot(currentWorkspace, "task-only-in-legacy");
    assert.equal(snapshot.crossWorkspace, true);
    assert.equal(snapshot.crossWorkspaceStateDir, stateDir);
    assert.equal(snapshot.job.id, "task-only-in-legacy");
  });

  it("buildStatusSnapshot --all merges jobs for the same workspace across roots", () => {
    const primaryStateDir = resolveStateDir(currentWorkspace);
    const slug = path.basename(primaryStateDir);

    writeStateAt(path.join(primaryDataDir, "state"), slug, {
      version: 1,
      jobs: [
        {
          id: "task-primary",
          status: "completed",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:00:00.000Z"
        }
      ]
    });

    writeStateAt(legacyRoot, slug, {
      version: 1,
      jobs: [
        {
          id: "task-legacy",
          status: "completed",
          createdAt: "2026-05-22T09:00:00.000Z",
          updatedAt: "2026-05-22T09:00:00.000Z"
        }
      ]
    });

    const merged = collectWorkspaceJobsAcrossRoots(currentWorkspace)
      .map((job) => job.id)
      .sort();
    assert.deepEqual(merged, ["task-legacy", "task-primary"]);

    const snapshot = buildStatusSnapshot(currentWorkspace, { all: true, env: {} });
    const ids = [...snapshot.running, ...(snapshot.latestFinished ? [snapshot.latestFinished] : []), ...snapshot.recent]
      .map((job) => job.id)
      .sort();
    assert.deepEqual(ids, ["task-legacy", "task-primary"]);
  });
});

describe("isStreamableProgressLine (#372 stderr filter)", () => {
  // The foreground task observer tails the job log to stderr for live progress.
  // It must echo only progress lines, never the persisted block bodies (assistant
  // message, Final output, reasoning), or it duplicates Codex's answer onto stderr
  // alongside the rendered stdout result.
  it("keeps timestamped progress lines", () => {
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:39.925Z] Starting Codex Task."), true);
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:42.000Z] Turn completed."), true);
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:43.000Z] Assistant message captured: OK"), true);
  });

  it("drops block titles whose bodies render on stdout", () => {
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:43.000Z] Final output"), false);
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:43.000Z] Assistant message"), false);
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:43.000Z] Reasoning summary"), false);
    assert.equal(isStreamableProgressLine("[2026-06-13T06:15:43.000Z] Subagent design-challenger message"), false);
  });

  it("drops block-body lines, including ones that start with a bracket (#372)", () => {
    assert.equal(isStreamableProgressLine("OK"), false);
    assert.equal(isStreamableProgressLine("the full assistant answer body line"), false);
    assert.equal(isStreamableProgressLine("[1] https://example.com a markdown reference"), false);
    assert.equal(isStreamableProgressLine("[P2] a finding Codex wrote in its answer"), false);
    assert.equal(isStreamableProgressLine('["a", "b", "c"]'), false);
    assert.equal(isStreamableProgressLine("[2026-06-13] partial date only"), false);
    assert.equal(isStreamableProgressLine(""), false);
    assert.equal(isStreamableProgressLine(null), false);
  });
});
