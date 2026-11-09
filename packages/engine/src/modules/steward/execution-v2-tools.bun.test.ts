import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ExecutionPrincipal, type ExecutionStartV2, type ExecutionPlacementView, type ExecutionView, type WorkLocation, type WorkCleanupReceipt } from "@chrona/contracts/steward";
import { callSync, enqueueCall, type Caller } from "./module-calls";
import { primitiveInputs, primitiveOutputs } from "./builtin/agent/primitives";
import { testDb } from "./test-db";
import agentManifest from "./builtin/agent/module.json";
import { createExecutionV2Admission } from "./execution-admission";
import { createExecutionEventStore } from "./execution-event-store";
import { createExecutions } from "./execution";
import { executionDigest } from "./execution-state";
import type { StewardPorts } from "./ports";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "router-test" } })).id;
  async function module(name: string, uses: string[] = ["agent.run", "agent.placement", "agent.locations", "agent.cleanup", "agent.get"]) {
    const row = await db.module.create({ data: { workspaceId, name, activeHash: "hash", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: "hash", manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses }), source: "user", intent: {}, report: {}, status: "approved" } });
    return { kind: "module" as const, moduleId: row.id, module: name, hash: "hash" };
  }
  const caller = await module("execution-test"), other = await module("other");
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
  const request: ExecutionStartV2 = { kind: "execution", workId: "work", commandKey: "start", goal: "private goal must not be stored in routed invocation", placement, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: "2026-11-07T00:00:00Z", budget: { timeoutMs: 60_000, maxToolCalls: 2 } };
  const { workId, commandKey, goal, ...scope } = request;
  const input = { ...scope, executionId: workId, requestKey: commandKey, prompt: goal };
  const origin = (who: Caller = caller) => ({ workspaceId, caller: who, chain: [], path: [] });
  const call = (tool: string, args: unknown, who: Caller = caller) => callSync(ports, origin(who), `agent.${tool}`, args);
  return { db, ports, workspaceId, caller, other, module, input, request, origin, call, setOnline: (value: boolean) => { online = value; } };
}
function output<T>(reply: { output: unknown }): T { return reply.output as T; }
test("real routed Agent run and placement persist original module identity and bounded workspace facts", async () => {
  const f = await fixture();
  const start = output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("run", f.input));
  const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: start.execution.attemptId } });
  expect(row).toMatchObject({ moduleId: f.caller.moduleId, callerHash: "hash", callerKey: `module:${f.caller.moduleId}`, resolvedCwd: null });
  expect(start.placement).toMatchObject({ online: false, workspace: { state: "requested", sourceReceipt: null, retained: true } });
  expect(output<ExecutionPlacementView>(await f.call("placement", { executionId: "work" }))).toEqual(start.placement);
  f.setOnline(true); expect(output<ExecutionPlacementView>(await f.call("placement", { "execution-id": "work" })).online).toBe(true);
  const invocation = await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "agent", tool: "run" } });
  expect(invocation).toMatchObject({ args: {}, output: {}, callerModuleId: f.caller.moduleId, callerHash: "hash", status: "succeeded" });
  expect(await f.db.run.count()).toBe(1);
  expect(output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("run", f.input))).toEqual({ ...start, placement: { ...start.placement, online: true } });
  expect(await f.db.run.count()).toBe(1);
});
test("other module, owner-authorized entry, workspace and stale hash cannot widen placement or cleanup scope", async () => {
  const f = await fixture(); await f.call("run", f.input);
  const cleanup = mock(async () => ({ workId: "work", workspaceRef: "unreachable", state: "removed" as const, reason: "", previewDigest: null })); f.ports.executionWorkspaces = { cleanup };
  for (const caller of [f.other, await f.module("entry", ["*"])]) {
    await expect(f.call("placement", { executionId: "work" }, caller)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.call("cleanup", { workId: "work", commandKey: "preview", action: "preview" }, caller)).rejects.toMatchObject({ code: "not_found" });
  }
  const another = (await f.db.workspace.create({ data: { name: "another" } })).id;
  await expect(callSync(f.ports, { ...f.origin(), workspaceId: another }, "agent.placement", { executionId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { activeHash: "changed" } });
  await expect(f.call("placement", { executionId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  expect(cleanup).not.toHaveBeenCalled();
});
test("locations are configured scoped grants with current online state and no host directory identity", async () => {
  const f = await fixture();
  const page = output<{ locations: unknown[]; after: string | null }>(await f.call("locations", { limit: 1 }));
  expect(page).toEqual({ locations: [{ ...f.input.placement, label: "Fixed device", kind: "device", online: false, baseline: f.input.workspace.baseline, workspaceModes: ["existing", "independent_worktree"] }], after: null });
  expect(JSON.stringify(page)).not.toContain("directoryIdentity"); expect(JSON.stringify(page)).not.toContain("canonicalPath");
  expect(output<{ locations: WorkLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, f.other))).toEqual({ locations: [], after: null });
  const entry = await f.module("entry", ["*"]);
  expect(output<{ locations: WorkLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, entry))).toEqual({ locations: [], after: null });
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
  const f = await fixture(); const admitted = output<{ placement: ExecutionPlacementView }>(await f.call("run", f.input));
  const preview = { workId: "work", commandKey: "preview", action: "preview" as const };
  await expect(f.call("cleanup", preview)).rejects.toMatchObject({ code: "unavailable" });
  const receipt = { workId: "work", workspaceRef: admitted.placement.workspace.workspaceRef, state: "blocked" as const, reason: "retained", previewDigest: "a".repeat(64) };
  const cleanup = mock(async () => receipt); f.ports.executionWorkspaces = { cleanup };
  expect(output<WorkCleanupReceipt>(await f.call("cleanup", preview))).toEqual(receipt);
  const principal: ExecutionPrincipal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: f.caller.moduleId, hash: "hash" } };
  expect(cleanup).toHaveBeenCalledWith(principal, preview);
  const confirm = { ...preview, commandKey: "confirm", action: "confirm", previewDigest: receipt.previewDigest };
  expect(output<WorkCleanupReceipt>(await f.call("cleanup", confirm))).toEqual(receipt); expect(cleanup).toHaveBeenLastCalledWith(principal, confirm);
  f.ports.executionWorkspaces.cleanup = async () => ({ ...receipt, workspaceRef: "foreign" });
  await expect(f.call("cleanup", preview)).rejects.toMatchObject({ code: "conflict" });
  for (const row of await f.db.moduleInvocation.findMany({ where: { target: "agent", tool: "cleanup" } })) {
    expect(row.args).toEqual({}); expect(row.output).toEqual(row.status === "succeeded" ? {} : null);
  }
});
test("router validates Agent inputs/outputs, denies non-module callers and prevents async run/cleanup persistence", async () => {
  const f = await fixture();
  for (const tool of ["run", "placement", "locations", "cleanup", "get"]) {
    for (const caller of [{ kind: "provider" as const, runId: "run" }, { kind: "kernel" as const }, { kind: "owner" as const, via: null }]) await expect(f.call(tool, {}, caller)).rejects.toMatchObject({ code: "forbidden" });
  }
  for (const args of [{ ...f.input, caller: { kind: "owner" } }, { ...f.input, workspace: { ...f.input.workspace, cwd: "/untrusted" } }]) await expect(f.call("run", args)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("cleanup", { workId: "work", commandKey: "confirm", action: "confirm" })).rejects.toMatchObject({ code: "invalid" });
  // Transaction handles do not share database-scoped doubles: use the actual release declaration.
  const agent = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "agent", activeHash: "release", status: "active", builtin: true } });
  await f.db.moduleVersion.create({ data: { moduleId: agent.id, hash: "release", manifest: moduleManifestSchema.parse(agentManifest), source: "builtin", intent: {}, report: {}, status: "approved" } });
  for (const [tool, raw] of [["run", f.input], ["cleanup", { workId: "work", commandKey: "preview", action: "preview" }]] as const) {
    await expect(f.db.$transaction(tx => enqueueCall({ tx, ports: f.ports, origin: f.origin(), target: `agent.${tool}`, raw }, { key: `async-${tool}` }))).rejects.toMatchObject({ code: "invalid" });
  }
  f.ports.executionV2Admission = { start: async () => ({ execution: {}, placement: {} }) as never };
  await expect(f.call("run", f.input)).rejects.toThrow("Local capability output contract mismatch");
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleInvocation.count({ where: { mode: "async" } })).toBe(0);
});
test("Agent primitives declare validated outputs and accept current execution inputs", () => {
  for (const name of ["run", "placement", "locations", "cleanup", "get"] as const) {
    expect(primitiveOutputs[name].safeParse({}).success).toBe(false);
  }
  expect(primitiveInputs.placement.safeParse({ executionId: "work" }).success).toBe(true);
  expect(primitiveInputs.placement.safeParse({ workId: "work" }).success).toBe(false);
});

test("owner-authorized entry uses star authority and Agent run transforms the request for v2 admission", async () => {
  const f = await fixture(), entry = await f.module("entry", ["*"]);
  const started = output<{ execution: ExecutionView; placement: ExecutionPlacementView }>(await f.call("run", f.input));
  const start = mock(async () => started); f.ports.executionV2Admission = { start };
  await f.call("run", f.input, entry);
  expect(start).toHaveBeenCalledWith({ workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "owner" } }, f.request);
  expect(output<ExecutionView>(await f.call("get", { executionId: "work" }))).toEqual(started.execution);
  await expect(f.call("get", { executionId: "work", runId: "foreign" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.call("get", { executionId: "work", attemptId: "foreign" })).rejects.toMatchObject({ code: "conflict" });
  f.ports.executionV2Admission = undefined;
  await expect(f.call("run", f.input)).rejects.toMatchObject({ code: "unavailable" });
  f.ports.executions = undefined;
  await expect(f.call("get", { executionId: "work" })).rejects.toMatchObject({ code: "unavailable" });
});
