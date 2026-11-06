import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionToolContracts, moduleManifestSchema, type ExecutionPrincipal, type ExecutionStartV2, type ExecutionPlacementView, type ExecutionView, type WorkLocation, type WorkCleanupReceipt } from "@chrona/contracts/steward";
import { callSync, enqueueCall, registerSystemModule, type Caller } from "./module-calls";
import { executions } from "./system/executions";
import { testDb } from "./test-db";
import { createExecutionV2Admission } from "./execution-admission";
import { createExecutionEventStore } from "./execution-event-store";
import { createExecutions } from "./execution";
import { executionDigest } from "./execution-state";
import type { StewardPorts } from "./ports";

registerSystemModule(executions);
const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "router-test" } })).id;
  async function module(name: string, uses: string[] = ["executions.start-v2", "executions.placement", "executions.locations", "executions.workspace-cleanup"]) {
    const row = await db.module.create({ data: { workspaceId, name, activeHash: "hash", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: "hash", manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses }), source: "user", intent: {}, report: {}, status: "approved" } });
    return { kind: "module" as const, moduleId: row.id, module: name, hash: "hash" };
  }
  const caller = await module("coding"), other = await module("other");
  const baseline = { kind: "commit" as const, digest: "a".repeat(40) }, placement = { executorId: "device", projectRef: "repo", mappingRevision: 1 };
  const now = new Date("2026-11-06T12:00:00Z"); let online = false;
  await db.executionExecutor.create({ data: { id: "device", workspaceId, ownerId: "owner", label: "fixture", credentialHash: "fixture-not-secret", incarnation: "daemon" } });
  const ports: StewardPorts = { db, dataDir: await mkdtemp(join(tmpdir(), "q-router-test-")), publicUrl: null, now: () => now,
    executionLocations: async principal => principal.caller.kind === "module" && principal.caller.moduleId === caller.moduleId ? [placement] : [],
    resolveExecutionPlacement: async (principal, selected) => {
      if (principal.caller.kind !== "module" || principal.caller.moduleId !== caller.moduleId) throw new Error("No configured grant");
      return { ...selected, executor: "device", executorGeneration: 1, directoryIdentity: executionDigest(selected.projectRef), label: "Fixed device", baseline };
    },
    executorAdmission: { online: async () => online ? { executorId: "device", generation: 1, incarnation: "daemon", authorizedUntil: new Date(now.getTime() + 60_000) } : null,
      reserve: async () => { throw new Error("Not claimed in router tests"); }, prepare: async () => { throw new Error("Not claimed in router tests"); } } };
  ports.executionEvents = createExecutionEventStore(ports); ports.executions = createExecutions(ports); ports.executionV2Admission = createExecutionV2Admission(ports);
  const input: ExecutionStartV2 = { kind: "execution", workId: "work", commandKey: "start", goal: "private goal must not be stored in routed invocation", placement, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: "2026-11-07T00:00:00Z", budget: { timeoutMs: 60_000, maxToolCalls: 2 } };
  const origin = (who: Caller = caller) => ({ workspaceId, caller: who, chain: [], path: [] });
  const call = (tool: string, args: unknown, who: Caller = caller) => callSync(ports, origin(who), `executions.${tool}`, args);
  return { db, ports, workspaceId, caller, other, module, input, origin, call, setOnline: (value: boolean) => { online = value; } };
}
function output<T>(reply: { output: unknown }): T { return reply.output as T; }
test("real routed v2 start and placement persist original module identity and bounded workspace facts", async () => {
  const f = await fixture();
  const start = output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("start-v2", f.input));
  const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: start.execution.attemptId } });
  expect(row).toMatchObject({ moduleId: f.caller.moduleId, callerHash: "hash", callerKey: `module:${f.caller.moduleId}`, resolvedCwd: null });
  expect(start.placement).toMatchObject({ online: false, workspace: { state: "requested", sourceReceipt: null, retained: true } });
  expect(output<ExecutionPlacementView>(await f.call("placement", { workId: "work" }))).toEqual(start.placement);
  f.setOnline(true); expect(output<ExecutionPlacementView>(await f.call("placement", { workId: "work" })).online).toBe(true);
  const invocation = await f.db.moduleInvocation.findFirstOrThrow({ where: { tool: "start-v2" } });
  expect(invocation).toMatchObject({ args: {}, output: {}, callerModuleId: f.caller.moduleId, callerHash: "hash", status: "succeeded" });
  expect(await f.db.run.count()).toBe(1);
  expect(output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("start-v2", f.input))).toEqual({ ...start, placement: { ...start.placement, online: true } });
  expect(await f.db.run.count()).toBe(1);
});
test("owner, other module, workspace and stale hash cannot widen v2 placement or cleanup scope", async () => {
  const f = await fixture(); await f.call("start-v2", f.input);
  const cleanup = mock(async () => ({ workId: "work", workspaceRef: "unreachable", state: "removed" as const, reason: "", previewDigest: null })); f.ports.executionWorkspaces = { cleanup };
  for (const caller of [f.other, { kind: "owner" as const, via: null }]) {
    await expect(f.call("placement", { workId: "work" }, caller)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.call("workspace-cleanup", { workId: "work", commandKey: "preview", action: "preview" }, caller)).rejects.toMatchObject({ code: "not_found" });
  }
  const another = (await f.db.workspace.create({ data: { name: "another" } })).id;
  await expect(callSync(f.ports, { ...f.origin(), workspaceId: another }, "executions.placement", { workId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { activeHash: "changed" } });
  await expect(f.call("placement", { workId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  expect(cleanup).not.toHaveBeenCalled();
});
test("locations are configured scoped grants with current online state and no host directory identity", async () => {
  const f = await fixture();
  const page = output<{ locations: unknown[]; after: string | null }>(await f.call("locations", { limit: 1 }));
  expect(page).toEqual({ locations: [{ ...f.input.placement, label: "Fixed device", kind: "device", online: false, baseline: f.input.workspace.baseline, workspaceModes: ["existing", "independent_worktree"] }], after: null });
  expect(JSON.stringify(page)).not.toContain("directoryIdentity"); expect(JSON.stringify(page)).not.toContain("canonicalPath");
  expect(output<{ locations: WorkLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, f.other))).toEqual({ locations: [], after: null });
  expect(output<{ locations: WorkLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, { kind: "owner", via: null }))).toEqual({ locations: [], after: null });
  f.setOnline(true); expect(output<{ locations: { online: boolean }[] }>(await f.call("locations", { limit: 1 })).locations[0]!.online).toBe(true);
  await expect(f.call("locations", { limit: 1, after: "foreign-cursor" })).rejects.toMatchObject({ code: "not_found" });
  f.ports.executionLocations = undefined; await expect(f.call("locations", { limit: 1 })).rejects.toMatchObject({ code: "unavailable" });
});
test("location pagination cursor stays scoped, rechecks current grants and rejects revoked device", async () => {
  const f = await fixture(); const base = f.input.placement;
  f.ports.executionLocations = async () => [base, base, { ...base, projectRef: "second" }];
  const first = output<{ locations: unknown[]; after: string }>(await f.call("locations", { limit: 1 }));
  expect(first.locations).toHaveLength(1); expect(first.after).toHaveLength(64);
  const second = output<{ locations: unknown[]; after: string | null }>(await f.call("locations", { limit: 1, after: first.after }));
  expect(second.locations).toHaveLength(1); expect(second.locations).not.toEqual(first.locations); expect(second.after).toBeNull();
  await f.db.executionExecutor.update({ where: { id: "device" }, data: { revokedAt: f.ports.now() } });
  await expect(f.call("locations", { limit: 1 })).rejects.toMatchObject({ code: "forbidden" });
});
test("cleanup retains scoped principal and exact preview/confirm arguments; absent adapter never removes", async () => {
  const f = await fixture(); const admitted = output<{ placement: ExecutionPlacementView }>(await f.call("start-v2", f.input));
  const preview = { workId: "work", commandKey: "preview", action: "preview" as const };
  await expect(f.call("workspace-cleanup", preview)).rejects.toMatchObject({ code: "unavailable" });
  const receipt = { workId: "work", workspaceRef: admitted.placement.workspace.workspaceRef, state: "blocked" as const, reason: "retained", previewDigest: "a".repeat(64) };
  const cleanup = mock(async () => receipt); f.ports.executionWorkspaces = { cleanup };
  expect(output<WorkCleanupReceipt>(await f.call("workspace-cleanup", preview))).toEqual(receipt);
  const principal: ExecutionPrincipal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: f.caller.moduleId, hash: "hash" } };
  expect(cleanup).toHaveBeenCalledWith(principal, preview);
  const confirm = { ...preview, commandKey: "confirm", action: "confirm", previewDigest: receipt.previewDigest };
  expect(output<WorkCleanupReceipt>(await f.call("workspace-cleanup", confirm))).toEqual(receipt); expect(cleanup).toHaveBeenLastCalledWith(principal, confirm);
  f.ports.executionWorkspaces.cleanup = async () => ({ ...receipt, workspaceRef: "foreign" });
  await expect(f.call("workspace-cleanup", preview)).rejects.toMatchObject({ code: "conflict" });
  for (const row of await f.db.moduleInvocation.findMany({ where: { tool: "workspace-cleanup" } })) expect(row.args).toEqual({});
});
test("router validates v2 inputs/outputs, denies provider/kernel and prevents async start/cleanup persistence", async () => {
  const f = await fixture();
  for (const tool of ["start-v2", "placement", "locations", "workspace-cleanup"]) {
    for (const caller of [{ kind: "provider" as const, runId: "run" }, { kind: "kernel" as const }]) await expect(f.call(tool, {}, caller)).rejects.toMatchObject({ code: "forbidden" });
  }
  for (const args of [{ ...f.input, caller: { kind: "owner" } }, { ...f.input, workspace: { ...f.input.workspace, cwd: "/untrusted" } }]) await expect(f.call("start-v2", args)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("workspace-cleanup", { workId: "work", commandKey: "confirm", action: "confirm" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.db.$transaction(tx => enqueueCall({ tx, ports: f.ports, origin: f.origin(), target: "executions.start-v2", raw: f.input }, { key: "async" }))).rejects.toMatchObject({ code: "invalid" });
  f.ports.executionV2Admission = { start: async () => ({ execution: {}, placement: {} }) as never };
  await expect(f.call("start-v2", f.input)).rejects.toThrow("output does not match");
  expect(await f.db.run.count()).toBe(0);
});
test("all new routes have strict declared output schemas and preserve existing v1 outputs", () => {
  for (const name of ["start-v2", "placement", "locations", "workspace-cleanup"]) {
    const tool = executionToolContracts.find(tool => tool.name === name)!;
    expect(tool.visibility).toEqual(["owner", "modules"]); expect(tool.output.safeParse({}).success).toBe(false);
  }
  expect(executionToolContracts.find(tool => tool.name === "start")!.output.safeParse({ workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", projectRef: "repo", status: "queued", cancelRequested: false, stopConfirmed: false }).success).toBe(true);
});

test("owner-authorized entry uses existing star authority while v2 routes need no legacy service", async () => {
  const f = await fixture(), entry = await f.module("entry", ["*"]);
  const started = output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("start-v2", f.input));
  const start = mock(async () => started); f.ports.executionV2Admission = { start }; f.ports.executions = undefined;
  await f.call("start-v2", f.input, entry);
  expect(start).toHaveBeenCalledWith({ workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "owner" } }, f.input);
  expect(output<ExecutionPlacementView>(await f.call("placement", { workId: "work" }))).toEqual(started.placement);
  await expect(f.call("get", { workId: "work" })).rejects.toMatchObject({ code: "unavailable" });
  f.ports.executionV2Admission = undefined;
  await expect(f.call("start-v2", f.input)).rejects.toMatchObject({ code: "unavailable" });
});
