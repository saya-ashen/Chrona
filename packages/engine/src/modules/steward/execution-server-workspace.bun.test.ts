import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ExecutionStartV2 } from "@chrona/contracts/steward";
import type { PreparedServerWorkspace, ServerWorkspaceRequest, StewardPorts } from "./ports";
import { localDirectoryIdentity, prepareLockedLocalWorkspace } from "../../../../integrations/src/executor/workspaces";
import { createServerWorkspacePreparer } from "../../../../../apps/server/src/execution-server-workspace";
import { testDb } from "./test-db";
import { createExecutionV2Admission } from "./execution-admission";
import { createExecutionEventStore } from "./execution-event-store";
import { createExecutions } from "./execution";
import { createRuns } from "./runs";
import { executionDigest } from "./execution-state";
import { executionRunInput } from "./execution-context";
import { captureExecutionChanges } from "./execution-result";
import { createHash } from "node:crypto";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
function git(cwd: string, args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 5000 });
  if (result.status !== 0) throw new Error(result.stderr || "fixture Git failed");
  return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-q-server-test-")), dataDir = await mkdtemp(join(tmpdir(), "chrona-q-server-data-test-"));
  git(root, ["init", "-q"]); await writeFile(join(root, "AGENTS.md"), "TEMP WORKSPACE RULES"); await writeFile(join(root, "file.txt"), "base\n");
  git(root, ["add", "."]); git(root, ["-c", "user.name=Q fixture", "-c", "user.email=q@example.invalid", "commit", "-qm", "fixture"]);
  const baseline = { kind: "commit" as const, digest: git(root, ["rev-parse", "HEAD"]) }, identity = localDirectoryIdentity(root);
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "server-test" } })).id;
  const module = await db.module.create({ data: { workspaceId, name: "coding", activeHash: "hash", status: "active" } });
  const principal: ExecutionPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  const calls: ServerWorkspaceRequest[] = []; let locks = 0;
  let afterPrepare: ((request: ServerWorkspaceRequest, prepared: PreparedServerWorkspace) => Promise<void>) | undefined;
  const managedRoot = join(dataDir, "execution-workspaces");
  const host = createServerWorkspacePreparer(dataDir, () => new Date());
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(),
    resolveExecutionPlacement: async (_, placement) => ({ ...placement, executorId: "server", executor: "server", executorGeneration: 1, canonicalPath: root, directoryIdentity: identity, baseline, label: "fixture" }),
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: root, baseline: `commit:${baseline.digest}` }),
    executionServerWorkspace: { async prepare(request) {
      calls.push(request);
      const prepared = await host.prepare(request);
      locks++;
      let released = false;
      const result: PreparedServerWorkspace = { ...prepared, bindingDigest: executionDigest(request), verifiedAt: new Date().toISOString(), release() { if (released) return; prepared.release(); released = true; locks--; } };
      try { await afterPrepare?.(request, result); return result; } catch (error) { result.release(); throw error; }
    } } };
  ports.executionEvents = createExecutionEventStore(ports);
  const input = (key = "one", mode: "existing" | "independent_worktree" = "independent_worktree"): ExecutionStartV2 => ({ kind: "execution", workId: key, commandKey: key, goal: "Fixture goal", placement: { executorId: "server", projectRef: "repo", mappingRevision: 1 }, workspace: { mode, baseline }, queueExpiresAt: new Date(Date.now() + 3600_000).toISOString(), budget: { timeoutMs: 60_000, maxToolCalls: 2 } });
  return { root, db, ports, principal, calls, managedRoot, input, admission: createExecutionV2Admission(ports), runs: createRuns(ports, workspaceId), locks: () => locks, hook: (value: typeof afterPrepare) => { afterPrepare = value; } };
}
test("two real independently prepared Git worktrees claim concurrently and run actual isolated child writers", async () => {
  const f = await fixture(), a = await f.admission.start(f.principal, f.input("one")), b = await f.admission.start(f.principal, f.input("two"));
  expect(a.execution.attemptId).not.toBe(b.execution.attemptId); expect(f.locks()).toBe(0); expect(a.placement.workspace.sourceReceipt).toBeNull();
  const [first, second] = [await f.runs.claimNext("background"), await f.runs.claimNext("background")];
  expect(first).not.toBeNull(); expect(second).not.toBeNull(); expect(first!.cwd).not.toBe(second!.cwd);
  expect(await f.runs.claimNext("background")).toBeNull(); expect(f.locks()).toBe(0);
  for (const run of [first!, second!]) {
    const context = await executionRunInput(f.ports, run); expect(context?.cwd).toBe(run.cwd); expect(context?.prompt).toContain("TEMP WORKSPACE RULES");
  }
  const code = 'await Bun.write("worker-proof.txt",process.cwd());console.log("ready");for await(const part of Bun.stdin.stream()){if(part.length)break;}await Bun.write("worker-finished.txt","done");';
  const children = [first!, second!].map(run => Bun.spawn([process.execPath, "-e", code], { cwd: run.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
  const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 5000);
  try {
    await Promise.all(children.map(async child => { const ready = await child.stdout.getReader().read(); expect(new TextDecoder().decode(ready.value)).toBe("ready\n"); }));
    expect(children.every(child => child.exitCode === null)).toBe(true); expect(children[0]!.pid).not.toBe(children[1]!.pid);
    for (const run of [first!, second!]) expect(await readFile(join(run.cwd, "worker-proof.txt"), "utf8")).toBe(run.cwd);
    for (const child of children) { child.stdin.write("finish\n"); child.stdin.end(); }
    expect(await Promise.all(children.map(child => child.exited))).toEqual([0, 0]);
    for (const run of [first!, second!]) {
      git(run.cwd, ["add", "."]); git(run.cwd, ["-c", "user.name=Q fixture", "-c", "user.email=q@example.invalid", "commit", "-qm", "worker result"]);
      await captureExecutionChanges(f.ports, run.id);
      await f.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
    }
    expect((await createExecutions(f.ports).resultSource(f.principal, a.execution)).changes?.files.some(file => file.path === "worker-proof.txt")).toBe(true);
  } finally { clearTimeout(timer); for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); await Promise.all(children.map(child => child.exited)); }
  expect((await f.db.executionAttempt.findMany()).every(row => row.stopConfirmedAt !== null && row.heldDirectory === null)).toBe(true);
  expect(git(f.root, ["worktree", "list", "--porcelain"]).split("worktree ").length - 1).toBe(3);
}, 20_000);

test("claim rechecks source bytes, not admission receipt; a failed check leaves token queued and releases lock", async () => {
  const f = await fixture(), input = f.input("source", "existing");
  input.workspace.source = { files: [{ path: "file.txt", sha256: createHash("sha256").update("base\n").digest("hex") }] };
  const admitted = await f.admission.start(f.principal, input);
  expect(admitted.placement.workspace.sourceReceipt).toBeNull();
  const before = await f.db.run.findUniqueOrThrow({ where: { id: admitted.execution.runId } });
  await writeFile(join(f.root, "file.txt"), "changed\n");
  await expect(f.runs.claimNext("background")).rejects.toThrow("Source manifest differs");
  expect(await f.db.run.findUnique({ where: { id: before.id } })).toMatchObject({ tokenHash: before.tokenHash, startedAt: null, status: "queued" }); expect(f.locks()).toBe(0);
  await writeFile(join(f.root, "file.txt"), "base\n"); expect(await f.runs.claimNext("background")).not.toBeNull();
  const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } });
  expect(row.sourceReceipt).toMatchObject({ stage: "claim", fileCount: 1 }); expect(f.locks()).toBe(0);
});
test("caller revocation after preparation rejects second transaction; original key keeps stable identities on recovery", async () => {
  const f = await fixture(), input = f.input();
  f.hook(async request => { if (request.phase === "admission") await f.db.module.updateMany({ data: { status: "paused" } }); });
  await expect(f.admission.start(f.principal, input)).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count()).toBe(0); expect(f.locks()).toBe(0);
  f.hook(undefined); await f.db.module.updateMany({ data: { status: "active" } });
  const admitted = await f.admission.start(f.principal, input);
  expect(f.calls[0]!.attemptId).toBe(admitted.execution.attemptId); expect(f.calls[0]!.workspaceRef).toBe(admitted.placement.workspace.workspaceRef);
  expect(f.calls[1]!.attemptId).toBe(f.calls[0]!.attemptId);
});
test("same key changed payload races with preparation and is rejected before a second tree operation", async () => {
  const f = await fixture(), input = f.input(); let ready!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.hook(async () => { ready(); await gate; });
  const first = f.admission.start(f.principal, input);
  try { await reached; await expect(f.admission.start(f.principal, { ...input, goal: "different" })).rejects.toMatchObject({ code: "conflict" }); expect(f.calls).toHaveLength(1); }
  finally { release(); }
  const admitted = await first; const replay = await f.admission.start(f.principal, input);
  expect(replay.execution).toEqual(admitted.execution); expect(f.calls).toHaveLength(1); expect(f.locks()).toBe(0);
});
test("cancellation during claim preflight seals the candidate; the preparation lock is released on null claim", async () => {
  const f = await fixture(), admitted = await f.admission.start(f.principal, f.input());
  f.hook(async request => { if (request.phase === "claim") await createExecutions(f.ports).cancel(f.principal, { op: "cancel", ...admitted.execution, commandKey: "cancel" }); });
  expect(await f.runs.claimNext("background")).toBeNull(); expect(f.locks()).toBe(0);
  expect(await createExecutions(f.ports).get(f.principal, admitted.execution.workId)).toMatchObject({ status: "cancelled", stopConfirmed: true });
});
test("binding tamper and prepare busy never create Run; exact original key retries the original identity", async () => {
  const f = await fixture(), input = f.input("busy", "existing");
  const held = await prepareLockedLocalWorkspace({ binding: { executorId: "server" }, work: { workId: "holder", workspaceRef: "holder", workspaceMode: "existing", baseline: input.workspace.baseline }, mapping: { placement: input.placement, canonicalPath: f.root, directoryIdentity: localDirectoryIdentity(f.root), baseline: input.workspace.baseline }, managedRoot: f.managedRoot });
  try { await expect(f.admission.start(f.principal, input)).rejects.toThrow(); expect(await f.db.run.count()).toBe(0); } finally { held.release(); }
  const attemptId = f.calls[0]!.attemptId;
  f.hook(async (_, prepared) => { prepared.bindingDigest = "0".repeat(64); });
  await expect(f.admission.start(f.principal, input)).rejects.toMatchObject({ code: "conflict" }); expect(f.locks()).toBe(0);
  f.hook(undefined); const admitted = await f.admission.start(f.principal, input); expect(admitted.execution.attemptId).toBe(attemptId);
  expect(await readdir(join(f.managedRoot, "locks"))).toEqual([]);
});
test("v1 and server v2 existing workspace holds exclude one another; server adapter absence does not affect v1", async () => {
  const f = await fixture(), input = f.input("v2", "existing"); await f.admission.start(f.principal, input);
  await expect(createExecutions(f.ports).start(f.principal, { workId: "v1", commandKey: "v1", goal: "fixture", projectRef: "repo", budget: input.budget })).rejects.toMatchObject({ code: "conflict" });
  const g = await fixture(); g.ports.executionServerWorkspace = undefined;
  await expect(g.admission.start(g.principal, g.input())).rejects.toMatchObject({ code: "unavailable" });
  expect(await createExecutions(g.ports).start(g.principal, { workId: "v1", commandKey: "v1", goal: "fixture", projectRef: "repo", budget: input.budget })).toMatchObject({ status: "queued" });
  expect(await g.runs.claimNext("background")).not.toBeNull();
});

test("stale preparation and changed immutable caller cannot adopt the original admission intent", async () => {
  const f = await fixture(), input = f.input();
  f.hook(async (_, prepared) => { prepared.verifiedAt = new Date(Date.now() - 6000).toISOString(); });
  await expect(f.admission.start(f.principal, input)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count()).toBe(0); expect(f.locks()).toBe(0);
  f.hook(undefined);
  const module = await f.db.module.findFirstOrThrow();
  await f.db.module.update({ where: { id: module.id }, data: { activeHash: "replacement" } });
  const changed: ExecutionPrincipal = { ...f.principal, caller: { kind: "module", moduleId: module.id, hash: "replacement" } };
  await expect(f.admission.start(changed, input)).rejects.toMatchObject({ code: "conflict" });
  expect(f.calls).toHaveLength(1); expect(await f.db.run.count()).toBe(0);
});
test("claim preparation binds the full stored input before issuing a token", async () => {
  const f = await fixture(), admitted = await f.admission.start(f.principal, f.input());
  const queued = await f.db.run.findUniqueOrThrow({ where: { id: admitted.execution.runId } });
  f.hook(async request => { if (request.phase === "claim") await f.db.run.update({ where: { id: queued.id }, data: { prompt: "changed during preparation" } }); });
  await expect(f.runs.claimNext("background")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.findUnique({ where: { id: queued.id } })).toMatchObject({ status: "queued", startedAt: null, tokenHash: queued.tokenHash });
  expect(f.locks()).toBe(0);
});
