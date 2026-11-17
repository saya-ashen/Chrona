import { createTestAgentContext } from "../__testing__/test-provider";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import { createRuns, liveRuns } from "../execution/runs";
import { assertExecutionModuleIdle } from "../execution/execution-module-guard";
import { fenceAgentModule, fenceAgentModuleIn, fenceAgentVersionChange } from "./module-drain";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-agent-drain-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "Agent drain" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-17T00:00:00Z"), publicUrl: null };
  const caller = await db.module.create({ data: { workspaceId, name: "caller", activeHash: "caller-v1" } });
  const provider = await db.module.create({ data: { workspaceId, name: "provider", activeHash: "provider-v1" } });
  await db.moduleVersion.create({ data: { moduleId: caller.id, hash: caller.activeHash!, status: "approved", source: "user", intent: {}, report: {}, manifest: {} } });
  const session = await db.agentContext.create({ data: { workspaceId, ownerId: "owner", moduleId: caller.id, hash: caller.activeHash! } });
  const runs = createRuns(ports, workspaceId);
  const queued = await runs.enqueue({ sessionId: session.id, lane: "background", trigger: "source", prompt: "Work" });
  await db.agentRunAdmission.create({ data: { runId: queued.id, moduleId: caller.id, hash: caller.activeHash!, targets: [], content: [] } });
  let aborted = 0;
  async function bind(kind: "conversation" | "completion") {
    await db.agentRunProvider.create({ data: { runId: queued.id, providerId: "fixed", moduleId: provider.id, hash: provider.activeHash!, revision: "fixed-revision", declaration: {}, providerOptions: {}, kind } });
  }
  async function launch(kind: "conversation" | "completion") {
    const run = (await runs.claimNext("background"))!;
    await bind(kind);
    await db.providerLaunch.create({ data: { runId: run.id, digest: "fixed-launch" } });
    liveRuns.set(run.id, { done: new Promise(() => {}), async inject() {}, async abort() { aborted++; } });
    cleanups.push(async () => { liveRuns.delete(run.id); });
    return run;
  }
  const idle = (moduleId: string) => db.$transaction(tx => assertExecutionModuleIdle(tx, moduleId));
  return { db, ports, workspaceId, caller, provider, session, runs, queued, bind, launch, idle, aborted: () => aborted };
}

for (const kind of ["conversation", "completion"] as const) for (const owner of ["caller", "provider"] as const) {
  test.each(["running", "unknown"] as const)(`${kind} ${owner} drain retains capacity after %s until actual Provider exit`, async stage => {
    const f = await fixture(), run = await f.launch(kind);
    if (stage === "unknown") await f.db.$transaction(tx => f.runs.finishRunIn(tx, run.id, { outcome: "failed", sessionId: null, error: "Observer lost" }, f.ports.now()));
    await fenceAgentModule(f.ports, f.workspaceId, f[owner].id);
    expect(f.aborted()).toBe(1);
    await expect(f.runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.idle(f[owner].id)).rejects.toMatchObject({ code: "conflict" });
    const independent = await createTestAgentContext(f.db, f.workspaceId);
    const tail = await f.runs.enqueue({ sessionId: independent.id, lane: "background", trigger: "source", prompt: "Next" });
    expect(await f.runs.claimNext("background")).toBeNull();
    await f.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
    expect(await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "cancelled", stopStatus: "confirmed" });
    await f.idle(f[owner].id);
    expect((await f.runs.claimNext("background"))?.id).toBe(tail.id);
  });
}

test.each(["caller", "provider"] as const)("%s drain cancels an unlaunched Run and same-hash activation does not fence", async owner => {
  const f = await fixture();
  await f.bind("conversation");
  await fenceAgentVersionChange(f.ports, f.workspaceId, f[owner].id, f[owner].activeHash!);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f[owner].id } })).executionFenceAt).toBeNull();
  await f.db.$transaction(tx => fenceAgentModuleIn(f.ports, tx, f.workspaceId, f[owner].id));
  await f.idle(f[owner].id);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: f.queued.id } })).toMatchObject({ status: "cancelled", stopStatus: "confirmed" });
  expect(await f.runs.claimNext("background")).toBeNull();
});
