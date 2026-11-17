import { localDirectoryIdentity } from "@chrona/workspaces";
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExecutionPrincipal, type LocalExecutionProjectGrant } from "@chrona/contracts/steward";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { executionDigest } from "./execution-state";
import { createExecutionWorkspaceCleanup } from "./execution-workspace-cleanup";
import { createExecutionWorkspaceCleanupHost } from "../../../../apps/server/src/execution-workspace-cleanup";
import { createServerWorkspacePreparer } from "../../../../apps/server/src/execution-server-workspace";
import { createExecutionEventStore } from "./execution-event-store";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "chrona-cleanup-cross-test-"));
  const git = (args: string[]) => { const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Cleanup test", "-c", "user.email=cleanup@example.invalid", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }); if (r.status !== 0) throw new Error("Git fixture failed"); return r.stdout.trim(); };
  git(["init", "-q"]); writeFileSync(join(root, "file"), "base"); git(["add", "."]); git(["commit", "-qm", "baseline"]);
  return { root, baseline: { kind: "commit" as const, digest: git(["rev-parse", "HEAD"]) }, identity: localDirectoryIdentity(root) };
}
async function setup() {
  const db = testDb(), project = repo(), dataDir = mkdtempSync(join(tmpdir(), "chrona-cleanup-host-test-")), now = new Date();
  const workspace = await db.workspace.create({ data: { name: "Cleanup cross-layer" } });
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "owner" } };
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now };
  ports.executionEvents = createExecutionEventStore(ports);
  const executorId = "server", placement = { executorId, projectRef: "project", mappingRevision: 1 };
  let grant: LocalExecutionProjectGrant = { ...placement, executor: "server", executorId: "server", executorGeneration: 1, directoryIdentity: project.identity, canonicalPath: project.root, baseline: project.baseline, label: "Fixture" };
  ports.resolveExecutionPlacement = async () => grant;
  const session = await db.session.create({ data: { workspaceId: workspace.id, key: crypto.randomUUID(), source: "web" } });
  const run = await db.run.create({ data: { workspaceId: workspace.id, sessionId: session.id, lane: "background", trigger: "execution", provider: "fixture", prompt: "cleanup", cwd: dataDir, status: "finished", startedAt: now, deadlineAt: new Date(now.getTime() + 60000), tokenHash: "fixture" } });
  const a = await db.executionAttempt.create({ data: { workspaceId: workspace.id, ownerId: "owner", callerKey: "owner", workId: "work", commandKey: "start", requestDigest: "fixture", runId: run.id, executorId, executorGeneration: 1, projectRef: "project", mappingRevision: 1, projectDigest: executionDigest(grant), directoryIdentity: project.identity, logDir: dataDir, baseline: `commit:${project.baseline.digest}`, budget: { timeoutMs: 60000, maxToolCalls: 2 }, workspaceRef: "workspace", workspaceMode: "independent_worktree", queueExpiresAt: new Date(now.getTime() + 60000), stopConfirmedAt: now, stopEvidence: { kind: "provider_exited" } } });
  const cleanup = createExecutionWorkspaceCleanup(ports, createExecutionWorkspaceCleanupHost(dataDir)); ports.executionWorkspaces = cleanup;
  return { db, ports, principal, project, a, run, cleanup, grant, dataDir, setGrant: (value: typeof grant) => { grant = value; } };
}
test("server host with real SQLite verifies stop/holds and removes only owned independent tree", async () => {
  const f = await setup();
  try {
    const grant = f.grant; if (grant.executor !== "server") throw new Error("server fixture");
    const prepared = await createServerWorkspacePreparer(f.dataDir, f.ports.now).prepare({ principal: f.principal, grant, phase: "claim", attemptId: f.a.id, workspaceRef: "workspace", input: { kind: "execution", workId: "work", commandKey: "start", goal: "cleanup", placement: { executorId: "server", projectRef: "project", mappingRevision: 1 }, workspace: { mode: "independent_worktree", baseline: f.project.baseline }, queueExpiresAt: f.a.queueExpiresAt!.toISOString(), budget: { timeoutMs: 60000, maxToolCalls: 2 } } }); prepared.release();
    const p = await f.cleanup.cleanup(f.principal, { action: "preview", workId: "work", commandKey: "preview" }); expect(p.state).toBe("retained");
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { heldDirectory: "held" } });
    await expect(f.cleanup.cleanup(f.principal, { action: "confirm", workId: "work", commandKey: "held", previewDigest: p.previewDigest! })).rejects.toMatchObject({ code: "conflict" });
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { heldDirectory: null } });
    const input = { action: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: p.previewDigest! }, result = await f.cleanup.cleanup(f.principal, input);
    expect(result.state).toBe("removed"); expect(existsSync(prepared.cwd)).toBe(false); expect(existsSync(f.project.root)).toBe(true); expect(await f.cleanup.cleanup(f.principal, input)).toEqual(result);
  } finally { await f.db.$disconnect(); }
});

test("admitted cleanup verifies and settles across a fence, retaining exact replay while rejecting fresh cleanup", async () => {
  const f = await setup();
  try {
    const module = await f.db.module.create({ data: { workspaceId: f.principal.workspaceId, name: "cleanup-owner", activeHash: "original" } });
    const principal: ExecutionPrincipal = { ...f.principal, caller: { kind: "module", moduleId: module.id, hash: "original" } };
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { moduleId: module.id, callerHash: "original", callerKey: `module:${module.id}` } });
    let calls = 0;
    const cleanup = createExecutionWorkspaceCleanup(f.ports, async (request, input, verify) => {
      calls++;
      await f.db.module.update({ where: { id: module.id }, data: { executionFenceAt: f.ports.now() } });
      const { assertExecutionModuleIdle } = await import("./execution-module-guard");
      await expect(f.db.$transaction(tx => assertExecutionModuleIdle(tx, module.id))).rejects.toMatchObject({ code: "conflict" });
      await verify();
      return { workId: input.workId, workspaceRef: request.workspaceRef, state: "removed", reason: "Confirmed synthetic cleanup", previewDigest: null };
    });
    const input = { action: "preview" as const, workId: "work", commandKey: "admitted-cleanup" };
    const result = await cleanup.cleanup(principal, input);
    expect(await cleanup.cleanup(principal, input)).toEqual(result);
    expect(calls).toBe(1);
    await expect(cleanup.cleanup(principal, { ...input, commandKey: "fresh-cleanup" })).rejects.toMatchObject({ code: "forbidden" });
    const { assertExecutionModuleIdle } = await import("./execution-module-guard");
    await f.db.$transaction(tx => assertExecutionModuleIdle(tx, module.id));
    await f.db.module.update({ where: { id: module.id }, data: { activeHash: "replacement" } });
    await expect(cleanup.cleanup(principal, input)).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.db.$disconnect(); }
});
