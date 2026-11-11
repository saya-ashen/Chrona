import { afterEach, expect, mock, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ExecutionPrincipal, type KernelExecutionStart, type KernelPlacementView, type KernelLocation, type ExecutionView, type WorkCleanupReceipt, primitiveInputs, primitiveOutputs } from "@chrona/contracts/steward";
import { callSync, enqueueCall, type Caller } from "../../packages/engine/src/modules/steward/module-calls";
import { testDb } from "../../packages/engine/src/modules/steward/test-db";
import agentManifest from "../../packages/engine/src/modules/steward/builtin/agent/module.json";
import { createExecutionDelivery } from "../../packages/engine/src/modules/steward/execution-delivery";
import { createExecutionEventStore } from "../../packages/engine/src/modules/steward/execution-event-store";
import { createExecutions } from "../../packages/engine/src/modules/steward/execution";
import { executionDigest } from "../../packages/engine/src/modules/steward/execution-state";
import type { StewardPorts } from "../../packages/engine/src/modules/steward/ports";

const databases: ReturnType<typeof testDb>[] = [], directories: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.$disconnect();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture(kind: "local" | "application" = "local") {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "router-test" } })).id;
  async function module(name: string, uses: string[] = ["agent.run", "agent.placement", "agent.locations", "agent.cleanup", "agent.get"]) {
    const row = await db.module.create({ data: { workspaceId, name, activeHash: "hash", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: "hash", manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses, authority: uses.includes("*") ? "owner" : undefined }), source: "user", intent: {}, report: {}, status: "approved" } });
    return { kind: "module" as const, moduleId: row.id, module: name, hash: "hash" };
  }
  const caller = await module("execution-test"), other = await module("other"), application = await module("execution-application", []);
  const receiver = await db.module.findUniqueOrThrow({ where: { id: application.moduleId } });
  const baseline = { kind: "commit" as const, digest: "a".repeat(40) }, local = { executorId: "server", projectRef: "repo", mappingRevision: 1 };
  const placement = kind === "local" ? { kind: "local" as const, projectRef: "repo", mappingRevision: 1 }
    : { kind: "application" as const, applicationId: application.moduleId, targetRef: "target", targetRevision: 1, projectRef: "repo" };
  const now = new Date("2026-11-06T12:00:00Z"), dataDir = await mkdtemp(join(tmpdir(), "q-router-test-")); directories.push(dataDir);
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now,
    executionLocations: async principal => kind === "local" && principal.caller.kind === "module" && principal.caller.moduleId === caller.moduleId ? [local] : [],
    resolveExecutionPlacement: async (principal, selected) => {
      if (principal.caller.kind !== "owner" && principal.caller.moduleId !== caller.moduleId) throw new Error("No configured grant");
      return { ...selected, executorId: "server", executor: "server", executorGeneration: 1, canonicalPath: dataDir, directoryIdentity: executionDigest(selected.projectRef), label: "Fixed local workspace", baseline };
    },
    executionServerWorkspace: { prepare: async request => ({
      bindingDigest: executionDigest(request), cwd: join(dataDir, request.workspaceRef), projectDirectoryIdentity: request.grant.directoryIdentity,
      workspaceDirectoryIdentity: executionDigest(request.workspaceRef), verifiedAt: now.toISOString(), sourceReceipt: null,
      workspace: { workspaceRef: request.workspaceRef, mode: request.input.workspace.mode, baseline, state: "ready", sourceReceipt: null, retained: true }, release() {},
    }) } };
  ports.executionEvents = createExecutionEventStore(ports); ports.executions = createExecutions(ports);
  const delivery = createExecutionDelivery(ports);
  const principal: ExecutionPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: caller.moduleId, hash: caller.hash } };
  const key = generateKeyPairSync("ed25519");
  const authority = kind === "application" ? await delivery.approveAuthority({ ...principal, caller: { kind: "owner" } }, {
    receiver: { workspaceId, moduleId: receiver.id, hash: receiver.activeHash!, activationId: receiver.activationId },
    subjectId: "stable-target", epoch: 1, keyId: "stop-key", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    verifierId: "ed25519", verifierVersion: "1", approvalId: "host-approval",
    scope: { callerModuleIds: [caller.moduleId], targets: [{ targetRef: "target", targetRevision: 1, projectRef: "repo", directoryIdentity: executionDigest("repo"), baseline, workspaceModes: ["existing", "independent_worktree"] }] },
  }) : null;
  const request: KernelExecutionStart = { kind: "execution", workId: "work", commandKey: "start", goal: "private goal must not be stored in routed invocation", workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: "2026-11-07T00:00:00Z",
    ...(placement.kind === "local" ? { placement, budget: { timeoutMs: 60_000, maxToolCalls: 2 } }
      : { placement, budget: { timeoutMs: 60_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 100 } }) };
  const { workId, commandKey, goal, ...scope } = request;
  const input = { ...scope, executionId: workId, requestKey: commandKey, prompt: goal };
  const origin = (who: Caller = caller) => ({ workspaceId, caller: who, chain: [], path: [] });
  const call = (tool: string, args: unknown, who: Caller = caller) => callSync(ports, origin(who), `agent.${tool}`, args);
  return { db, ports, workspaceId, caller, other, application, authority, principal, delivery, module, input, request, origin, call };
}
function output<T>(reply: { output: unknown }): T { return reply.output as T; }
for (const kind of ["local", "application"] as const) test(`real routed Agent ${kind} run and placement persist original module identity and bounded workspace facts`, async () => {
  const f = await fixture(kind);
  const start = output<{ execution: ExecutionView; placement: KernelPlacementView }>(await f.call("run", f.input));
  const row = await f.db.executionAttempt.findUniqueOrThrow({ where: { id: start.execution.attemptId } });
  expect(row).toMatchObject({ moduleId: f.caller.moduleId, callerHash: "hash", callerKey: `module:${f.caller.moduleId}`, resolvedCwd: kind === "local" ? expect.any(String) : null });
  expect(start.placement).toMatchObject({ placement: f.input.placement, online: true, workspace: { state: kind === "local" ? "ready" : "requested", retained: true } });
  expect(start.placement.workspace).not.toHaveProperty("sourceReceipt");
  expect(output<KernelPlacementView>(await f.call("placement", { executionId: "work" }))).toEqual(start.placement);
  expect(output<KernelPlacementView>(await f.call("placement", { "execution-id": "work" }))).toEqual(start.placement);
  const invocation = await f.db.moduleInvocation.findFirstOrThrow({ where: { target: "agent", tool: "run" } });
  expect(invocation).toMatchObject({ args: {}, output: {}, callerModuleId: f.caller.moduleId, callerHash: "hash", status: "succeeded" });
  expect(await f.db.run.count()).toBe(1);
  expect(output<{ execution: ExecutionView; placement: KernelPlacementView }>(await f.call("run", f.input))).toEqual(start);
  expect(await f.db.run.count()).toBe(1);
  await expect(f.call("run", { ...f.input, prompt: "changed request" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count()).toBe(1);
});
for (const kind of ["local", "application"] as const) test(`${kind}: other module, owner-authorized entry, workspace and stale hash cannot widen placement or cleanup scope`, async () => {
  const f = await fixture(kind); await f.call("run", f.input);
  const cleanup = mock(async () => ({ workId: "work", workspaceRef: "unreachable", state: "removed" as const, reason: "", previewDigest: null })); f.ports.executionWorkspaces = { cleanup };
  for (const caller of [f.other, await f.module("entry", ["*"])]) {
    await expect(f.call("placement", { executionId: "work" }, caller)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.call("cleanup", { workId: "work", commandKey: "preview", op: "preview" }, caller)).rejects.toMatchObject({ code: "not_found" });
  }
  const another = (await f.db.workspace.create({ data: { name: "another" } })).id;
  await expect(callSync(f.ports, { ...f.origin(), workspaceId: another }, "agent.placement", { executionId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.caller.moduleId }, data: { activeHash: "changed" } });
  await expect(f.call("placement", { executionId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.call("cleanup", { workId: "work", commandKey: "preview", op: "preview" })).rejects.toMatchObject({ code: "forbidden" });
  expect(cleanup).not.toHaveBeenCalled();
});
for (const kind of ["local", "application"] as const) test(`${kind} locations are configured scoped grants with current availability and no host directory identity`, async () => {
  const f = await fixture(kind);
  const page = output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 1 }));
  expect(page).toEqual({ locations: [{ placement: f.input.placement, label: kind === "local" ? "Fixed local workspace" : "target", online: true, baseline: f.input.workspace.baseline, workspaceModes: ["existing", "independent_worktree"] }], after: null });
  expect(JSON.stringify(page)).not.toContain("directoryIdentity"); expect(JSON.stringify(page)).not.toContain("canonicalPath");
  expect(output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, f.other))).toEqual({ locations: [], after: null });
  const entry = await f.module("entry", ["*"]);
  expect(output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 10 }, entry))).toEqual(kind === "local" ? { locations: [], after: null } : page);
  if (kind === "application") {
    await f.db.module.update({ where: { id: f.application.moduleId }, data: { status: "paused" } });
    expect(output<{ locations: KernelLocation[] }>(await f.call("locations", { limit: 1 })).locations[0]!.online).toBe(false);
    await expect(f.call("run", f.input)).rejects.toMatchObject({ code: "forbidden" });
    await f.db.module.update({ where: { id: f.application.moduleId }, data: { status: "active" } });
    expect(output<{ locations: KernelLocation[] }>(await f.call("locations", { limit: 1 })).locations[0]!.online).toBe(true);
  }
  await expect(f.call("locations", { limit: 1, after: "foreign-cursor" })).rejects.toMatchObject({ code: "not_found" });
  f.ports.executionLocations = undefined;
  expect(output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 1 }))).toEqual(kind === "local" ? { locations: [], after: null } : page);
});
test("location pagination cursor stays scoped, rechecks current grants and rejects revoked application authority", async () => {
  const f = await fixture("application"), base = { executorId: "server", projectRef: "local", mappingRevision: 1 };
  f.ports.executionLocations = async principal => principal.caller.kind === "module" && principal.caller.moduleId === f.caller.moduleId ? [base, base, { ...base, projectRef: "second" }] : [];
  const first = output<{ locations: KernelLocation[]; after: string }>(await f.call("locations", { limit: 1 }));
  expect(first.locations).toHaveLength(1); expect(first.after).toHaveLength(64);
  const second = output<{ locations: KernelLocation[]; after: string }>(await f.call("locations", { limit: 1, after: first.after }));
  expect(second.locations).toHaveLength(1); expect(second.locations).not.toEqual(first.locations);
  const third = output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 1, after: second.after }));
  expect(third.locations).toHaveLength(1); expect(third.after).toBeNull();
  expect(new Set([...first.locations, ...second.locations, ...third.locations].map(item => executionDigest(item.placement))).size).toBe(3);
  await expect(f.call("locations", { limit: 1, after: first.after }, f.other)).rejects.toMatchObject({ code: "not_found" });
  f.ports.executionLocations = async () => [];
  const revokedLocal = [first, second, third].flatMap(page => page.locations).find(item => item.placement.kind === "local")!;
  await expect(f.call("locations", { limit: 1, after: executionDigest(revokedLocal.placement) })).rejects.toMatchObject({ code: "not_found" });
  await f.db.executionAuthority.update({ where: { id: f.authority!.id }, data: { revokedAt: f.ports.now() } });
  expect(output<{ locations: KernelLocation[]; after: string | null }>(await f.call("locations", { limit: 1 }))).toEqual({ locations: [], after: null });
  await expect(f.call("run", f.input)).rejects.toMatchObject({ code: "forbidden" });
});
test("local cleanup retains scoped principal and exact preview/confirm arguments; absent adapter never removes", async () => {
  const f = await fixture(); const admitted = output<{ placement: KernelPlacementView }>(await f.call("run", f.input));
  const preview = { workId: "work", commandKey: "preview", op: "preview" as const };
  await expect(f.call("cleanup", preview)).rejects.toMatchObject({ code: "unavailable" });
  const receipt = { workId: "work", workspaceRef: admitted.placement.workspace.workspaceRef, state: "blocked" as const, reason: "retained", previewDigest: "a".repeat(64) };
  const cleanup = mock(async () => receipt); f.ports.executionWorkspaces = { cleanup };
  expect(output<WorkCleanupReceipt>(await f.call("cleanup", preview))).toEqual(receipt);
  const principal: ExecutionPrincipal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: f.caller.moduleId, hash: "hash" } };
  expect(cleanup).toHaveBeenCalledWith(principal, { workId: "work", commandKey: "preview", action: "preview" });
  const confirm = { ...preview, commandKey: "confirm", op: "confirm", previewDigest: receipt.previewDigest };
  expect(output<WorkCleanupReceipt>(await f.call("cleanup", confirm))).toEqual(receipt);
  expect(cleanup).toHaveBeenLastCalledWith(principal, { workId: "work", commandKey: "confirm", action: "confirm", previewDigest: receipt.previewDigest });
  f.ports.executionWorkspaces.cleanup = async () => ({ ...receipt, workspaceRef: "foreign" });
  await expect(f.call("cleanup", preview)).rejects.toMatchObject({ code: "conflict" });
  for (const row of await f.db.moduleInvocation.findMany({ where: { target: "agent", tool: "cleanup" } })) {
    expect(row.args).toEqual({});
    if (row.status === "succeeded") expect(row.output).toMatchObject({ state: "blocked", reason: "retained" });
    else expect(row.output).toBeNull();
  }
});
test("router validates Agent inputs/outputs, denies non-module callers and prevents async run/cleanup persistence", async () => {
  const f = await fixture();
  for (const tool of ["run", "placement", "locations", "cleanup", "get"]) {
    for (const caller of [{ kind: "provider" as const, runId: "run" }, { kind: "kernel" as const }, { kind: "owner" as const, via: null }]) await expect(f.call(tool, {}, caller)).rejects.toMatchObject({ code: "forbidden" });
  }
  for (const args of [{ ...f.input, caller: { kind: "owner" } }, { ...f.input, workspace: { ...f.input.workspace, cwd: "/untrusted" } }, { ...f.input, placement: { executorId: "device", projectRef: "repo", mappingRevision: 1 } }]) await expect(f.call("run", args)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("cleanup", { workId: "work", commandKey: "confirm", op: "confirm" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("cleanup", { workId: "work", commandKey: "preview", action: "preview" })).rejects.toMatchObject({ code: "invalid" });
  // Transaction handles do not share database-scoped doubles: use the current declared release manifest.
  const agent = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "agent", activeHash: "release", status: "active", builtin: true } });
  await f.db.moduleVersion.create({ data: { moduleId: agent.id, hash: "release", manifest: moduleManifestSchema.parse(agentManifest), source: "builtin", intent: {}, report: {}, status: "approved" } });
  for (const [tool, raw] of [["run", f.input], ["cleanup", { workId: "work", commandKey: "preview", op: "preview" }]] as const) {
    await expect(f.db.$transaction(tx => enqueueCall({ tx, ports: f.ports, origin: f.origin(), target: `agent.work-${tool}`, raw }, { key: `async-${tool}` }))).rejects.toMatchObject({ code: "invalid" });
  }
  f.ports.executions = { ...f.ports.executions!, get: async () => ({}) as never };
  await expect(f.call("get", { executionId: "work" })).rejects.toThrow("Local capability output contract mismatch");
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

test("owner-authorized entry uses star authority and Agent run transforms the request for local admission", async () => {
  const f = await fixture(), entry = await f.module("entry", ["*"]);
  const started = output<{ execution: ExecutionView; placement: KernelPlacementView }>(await f.call("run", f.input));
  const prepare = mock(f.ports.executionServerWorkspace!.prepare); f.ports.executionServerWorkspace = { prepare };
  const owned = output<{ execution: ExecutionView; placement: KernelPlacementView }>(await f.call("run", f.input, entry));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0]![0]).toMatchObject({ principal: { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "owner" } }, input: { ...f.request, placement: { executorId: "server", projectRef: "repo", mappingRevision: 1 } }, phase: "admission" });
  expect(await f.db.executionAttempt.findUnique({ where: { id: owned.execution.attemptId } })).toMatchObject({ callerKey: "owner", moduleId: null, callerHash: null });
  expect(output<ExecutionView>(await f.call("get", { executionId: "work" }))).toEqual(started.execution);
  await expect(f.call("get", { executionId: "work", runId: "foreign" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.call("get", { executionId: "work", attemptId: "foreign" })).rejects.toMatchObject({ code: "conflict" });
  f.ports.executionServerWorkspace = undefined;
  await expect(f.call("run", { ...f.input, executionId: "new", requestKey: "new" })).rejects.toMatchObject({ code: "unavailable" });
  f.ports.executions = undefined;
  await expect(f.call("get", { executionId: "work" })).rejects.toMatchObject({ code: "unavailable" });
});
