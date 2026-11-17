import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ExecutionReceiver, KernelExecutionStart, ExecutionDeliveryFinal, ExecutionSignedStop, ProviderAdapter } from "@chrona/contracts/steward";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { createExecutionDelivery } from "./execution-delivery";
import { createExecutionEventStore } from "./execution-event-store";
import { executionDigest } from "./execution-state";
import { createRuns } from "./runs";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import { pauseFailedModule } from "../modules/module-effects";
import { moduleContext } from "../modules/module-context";
import { recordModuleActivation } from "../modules/module-evolution";
import { recordModuleExecution } from "../modules/module-failure-policy";
import { executionLaunchSchema, runtimeOutcomeSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import { verifyExecutionStop } from "./execution-delivery-stop";
import { enqueueCall } from "../modules/module-calls";
import { testProviderManifest } from "../test-provider-process";
import { testModuleProcess } from "../modules/module-test-process";
import { registerAgentProvider } from "../agent/agent-provider";
import { CallError } from "../modules/module-call-error";
import { moduleSupervisor } from "../modules/module-supervisor";

import { reserveCompletionIn } from "../modules/module-model-budget";

function reserveCompletion(ports: StewardPorts, scope: Parameters<typeof reserveCompletionIn>[1], params: Parameters<typeof reserveCompletionIn>[2], now: Date) {
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${scope.workspaceId}`;
    return reserveCompletionIn(tx, scope, params, now);
  });
}

const databases: ReturnType<typeof testDb>[] = [];
const modelCleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of modelCleanups.splice(0).reverse()) await close();
  for (const db of databases.splice(0)) await db.$disconnect();
});
async function fixture() {
  const db = testDb(); databases.push(db);
  const workspace = await db.workspace.create({ data: { name: "kernel delivery" } });
  const caller = await db.module.create({ data: { workspaceId: workspace.id, name: "caller", activeHash: "caller-hash" } });
  const app = await db.module.create({ data: { workspaceId: workspace.id, name: "fake-application", activeHash: "app-hash" } });
  let now = new Date("2026-11-09T10:00:00Z");
  const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/s5-kernel-test", publicUrl: null };
  ports.executionEvents = createExecutionEventStore(ports);
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: caller.id, hash: caller.activeHash! } };
  const owner: ExecutionPrincipal = { ...principal, caller: { kind: "owner" } };
  const receiver: ExecutionReceiver = { workspaceId: workspace.id, moduleId: app.id, hash: app.activeHash!, activationId: app.activationId };
  const key = generateKeyPairSync("ed25519"), service = createExecutionDelivery(ports), baseline = { kind: "commit" as const, digest: "a".repeat(40) };
  const approval = { receiver, subjectId: "stable-target", epoch: 1, keyId: "stop-key", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), verifierId: "ed25519" as const, verifierVersion: "1" as const, approvalId: "host-approval", scope: { callerModuleIds: [caller.id], targets: [{ targetRef: "target", targetRevision: 1, projectRef: "project", directoryIdentity: "physical-directory", baseline, workspaceModes: ["existing" as const, "independent_worktree" as const] }] } };
  await service.approveAuthority(owner, approval);
  const input: KernelExecutionStart = { kind: "execution", workId: "work", commandKey: "start", goal: "do fake work", placement: { kind: "application", applicationId: app.id, targetRef: "target", targetRevision: 1, projectRef: "project" }, workspace: { mode: "existing", baseline }, queueExpiresAt: "2026-11-09T12:00:00Z", budget: { timeoutMs: 60_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 100 } };
  const final: ExecutionDeliveryFinal = { outcome: "finished", error: null, throughSourceSeq: 0, baseline, finalMessage: null, missing: false };
  return { db, ports, caller, app, principal, owner, receiver, key, approval, input, final, service, setNow: (next: Date) => { now = next; } };
}
async function installCompletionOutbox(f: Awaited<ReturnType<typeof fixture>>) {
  const manifest = moduleManifestSchema.parse({ name: f.caller.name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "get", description: "Read work", idempotent: true, visibility: ["owner"], parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
      output: {}
}] });
  await f.db.moduleVersion.create({ data: { moduleId: f.caller.id, hash: f.caller.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  f.ports.onExecutionFinishedIn = async (tx, workspaceId, runId) => {
    const attempt = await tx.executionAttempt.findUniqueOrThrow({ where: { runId } });
    await enqueueCall({ tx, ports: f.ports, origin: { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, target: `${f.caller.name}.get`, raw: { input: JSON.stringify({ workId: attempt.workId }) } }, { key: `execution-result:${attempt.id}:${attempt.stopConfirmedAt ? "stopped" : "unknown"}` });
  };
  return f.ports.onExecutionFinishedIn;
}

test("claim and complete launch survive fake-app crash, response loss and restart; signed stop releases once", async () => {
  const f = await fixture(), admitted = await f.service.admit(f.principal, f.input);
  expect(await f.db.run.count()).toBe(1);
  expect(await f.db.executionDelivery.count()).toBe(0);
  const runs = createRuns(f.ports, f.principal.workspaceId);
  // Crash after K2 before poll: delivery is discoverable from persisted state alone.
  expect((await runs.claimNext("background", undefined, { kind: "application" }))?.runId).toBe(admitted.execution.runId);
  const restarted = createExecutionDelivery(f.ports), first = (await restarted.poll(f.receiver)).deliveries[0]!;
  expect((await restarted.poll(f.receiver)).deliveries[0]!.launch).toEqual(first.launch);
  const accepted = await restarted.accept(f.receiver, first.target, "accept");
  expect(await restarted.accept(f.receiver, first.target, "accept")).toEqual(accepted);
  await restarted.started(f.receiver, first.target, "started", { id: "fake-process", scope: "fake-app-journal" });
  const committed = await restarted.final(f.receiver, first.target, "final", f.final);
  expect(await createExecutionDelivery(f.ports).final(f.receiver, first.target, "final", f.final)).toEqual(committed);
  await expect(restarted.final(f.receiver, first.target, "other-final", { ...f.final, missing: true })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.executionAttempt.findUnique({ where: { id: first.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  const statement: ExecutionSignedStop["statement"] = { target: first.target, kind: "exited", processIdentity: { id: "fake-process", scope: "fake-app-journal" }, finalDigest: committed.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  const forged = generateKeyPairSync("ed25519");
  await expect(restarted.stop(f.receiver, first.target, "forged", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), forged.privateKey).toString("base64") })).rejects.toMatchObject({ code: "forbidden" });
  const proof = { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") };
  const stopped = await restarted.stop(f.receiver, first.target, "stop", proof);
  expect(await restarted.stop(f.receiver, first.target, "stop", proof)).toEqual(stopped);
  expect(await f.db.executionAttempt.findUnique({ where: { id: first.target.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect(await f.db.run.findUnique({ where: { id: first.target.runId } })).toMatchObject({ status: "finished" });
});
test("caller and receiver lifecycle fences retain exact drain and block new launches", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const delivery = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.accept(f.receiver, delivery.target, "accept");
  await f.service.fenceModule(f.principal.workspaceId, f.app.id);
  await expect(assertExecutionModuleIdle(f.db, f.app.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(f.service.started(f.receiver, delivery.target, "start-after-fence", { id: "p", scope: "s" })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.service.poll(f.receiver)).deliveries[0]!.launchable).toBe(false);
  await f.service.final(f.receiver, delivery.target, "final", { ...f.final, outcome: "cancelled" });
  const row = await f.db.executionDelivery.findUniqueOrThrow({ where: { id: delivery.target.deliveryId } });
  const statement: ExecutionSignedStop["statement"] = { target: delivery.target, kind: "never_started", processIdentity: null, finalDigest: row.finalDigest!, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  await f.service.stop(f.receiver, delivery.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
  await assertExecutionModuleIdle(f.db, f.app.id);
  await expect(f.service.admit(f.principal, { ...f.input, workId: "new", commandKey: "new" })).rejects.toMatchObject({ code: "forbidden" });
});
test("old authority epochs retain capacity/directory ownership; changed start and receiver fences reject replay", async () => {
  const f = await fixture(), first = await f.service.admit(f.principal, f.input);
  const delivery = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.approveAuthority(f.owner, { ...f.approval, epoch: 2, keyId: "rotated" });
  await expect(f.service.admit(f.principal, { ...f.input, workId: "new", commandKey: "new" })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.service.admit(f.principal, f.input)).execution.runId).toBe(first.execution.runId);
  await expect(f.service.admit(f.principal, { ...f.input, goal: "changed" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.service.accept({ ...f.receiver, activationId: "new-activation" }, delivery.target, "accept")).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.service.accept(f.receiver, { ...delivery.target, epoch: 2 }, "accept")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count()).toBe(1);
});
test("never offered cancel releases atomically; offered cancellation retains occupancy without stop", async () => {
  const f = await fixture(), first = await f.service.admit(f.principal, f.input);
  await f.service.control(f.principal, "work", "cancel", { operation: "cancel" });
  expect(await f.db.executionAttempt.findUnique({ where: { id: first.execution.attemptId } })).toMatchObject({ heldDirectory: null, stopConfirmedAt: expect.any(Date) });
  await f.service.admit(f.principal, { ...f.input, workId: "second", commandKey: "second" });
  const delivery = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.control(f.principal, "second", "cancel", { operation: "cancel" });
  expect(await f.db.executionAttempt.findUnique({ where: { id: delivery.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect((await f.service.poll(f.receiver)).deliveries[0]!.controls).toHaveLength(1);
});

test("source replay is fixed, gaps roll back, and signatures bind source, process and every target fence", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.accept(f.receiver, d.target, "accept");
  await f.service.started(f.receiver, d.target, "start", { id: "process", scope: "process-group" });
  const records = [{ sequence: 1, at: f.ports.now().toISOString(), payload: { type: "message" as const, messageId: "m", role: "assistant" as const, text: "durable", complete: true } }];
  expect(await f.service.source(f.receiver, d.target, "source", records)).toEqual({ throughSourceSeq: 1 });
  expect(await createExecutionDelivery(f.ports).source(f.receiver, d.target, "source", records)).toEqual({ throughSourceSeq: 1 });
  await expect(f.service.source(f.receiver, d.target, "source", [{ ...records[0]!, sequence: 2 }])).rejects.toMatchObject({ code: "conflict" });
  await expect(f.service.source(f.receiver, d.target, "gap", [{ ...records[0]!, sequence: 3 }])).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.executionReceipt.count({ where: { operation: "source" } })).toBe(1);
  const committed = await f.service.final(f.receiver, d.target, "final", { ...f.final, throughSourceSeq: 1 });
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "exited", processIdentity: { id: "process", scope: "process-group" }, finalDigest: committed.finalDigest, sourceThrough: 1, observedAt: f.ports.now().toISOString() };
  for (const changed of [
    { ...statement, kind: "never_started" as const, processIdentity: null },
    { ...statement, processIdentity: { id: "other", scope: "process-group" } },
    { ...statement, sourceThrough: 0 },
    { ...statement, finalDigest: "b".repeat(64) },
    ...["workspaceId", "ownerId", "callerModuleId", "callerHash", "callerActivationId", "receiverModuleId", "receiverHash", "receiverActivationId", "authorityId", "subjectId", "keyId", "runId", "attemptId", "deliveryId", "launchDigest"].map(field => ({ ...statement, target: { ...statement.target, [field]: "c".repeat(64) } })),
  ]) {
    await expect(f.service.stop(f.receiver, d.target, "bad-proof", { statement: changed, signature: sign(null, Buffer.from(executionDigest(changed), "hex"), f.key.privateKey).toString("base64") })).rejects.toMatchObject({ code: "conflict" });
  }
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
});

test("claim, final and stop settlement roll back together with the real completion outbox, snapshot, Run and occupancy", async () => {
  const f = await fixture(), enqueueCompletion = await installCompletionOutbox(f);
  await f.service.admit(f.principal, f.input);
  const events = f.ports.executionEvents!;
  f.ports.executionEvents = { ...events, async saveSnapshot() { throw new Error("fake crash after delivery insert"); } };
  await expect(createRuns(f.ports, f.principal.workspaceId).claimNext("background", undefined, { kind: "application" })).rejects.toThrow("fake crash");
  expect(await f.db.executionDelivery.count()).toBe(0);
  expect(await f.db.run.findFirstOrThrow()).toMatchObject({ status: "queued", startedAt: null });
  f.ports.executionEvents = events;
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  const crashAfterEnqueue: typeof enqueueCompletion = async (tx, workspaceId, runId) => {
    await enqueueCompletion(tx, workspaceId, runId);
    throw new Error("fake crash after completion enqueue");
  };
  const beforeFinal = await f.db.executionSnapshot.findUniqueOrThrow({ where: { attemptId: d.target.attemptId } });
  f.ports.onExecutionFinishedIn = crashAfterEnqueue;
  await expect(f.service.final(f.receiver, d.target, "final", f.final)).rejects.toThrow("fake crash after completion enqueue");
  expect(await f.db.moduleInvocation.count()).toBe(0);
  expect(await f.db.executionDelivery.findUniqueOrThrow({ where: { id: d.target.deliveryId } })).toMatchObject({ finalDigest: null, final: null, finalCommittedAt: null, settledAt: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ capabilityRevokedAt: null, stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: d.target.runId } })).toMatchObject({ status: "running", endedAt: null });
  expect(await f.db.executionSnapshot.findUniqueOrThrow({ where: { attemptId: d.target.attemptId } })).toEqual(beforeFinal);
  expect(await f.db.executionReceipt.count({ where: { operation: "final" } })).toBe(0);
  f.ports.onExecutionFinishedIn = enqueueCompletion;
  const final = await f.service.final(f.receiver, d.target, "final", f.final);
  const unknownCallbacks = await f.db.moduleInvocation.findMany();
  expect(unknownCallbacks.map(row => row.key)).toEqual([`execution-result:${d.target.attemptId}:unknown`]);
  const beforeStop = await f.db.executionSnapshot.findUniqueOrThrow({ where: { attemptId: d.target.attemptId } });
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: final.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  const proof = { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") };
  f.ports.onExecutionFinishedIn = crashAfterEnqueue;
  await expect(f.service.stop(f.receiver, d.target, "stop", proof)).rejects.toThrow("fake crash after completion enqueue");
  expect(await f.db.moduleInvocation.findMany()).toEqual(unknownCallbacks);
  expect(await f.db.executionDelivery.findUniqueOrThrow({ where: { id: d.target.deliveryId } })).toMatchObject({ finalDigest: final.finalDigest, settledAt: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: d.target.runId } })).toMatchObject({ status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" });
  expect(await f.db.executionSnapshot.findUniqueOrThrow({ where: { attemptId: d.target.attemptId } })).toEqual(beforeStop);
  expect(await f.db.executionReceipt.count({ where: { operation: "stop" } })).toBe(0);
  f.ports.onExecutionFinishedIn = enqueueCompletion;
  const restarted = createExecutionDelivery(f.ports), stopped = await restarted.stop(f.receiver, d.target, "stop", proof);
  expect(await createExecutionDelivery(f.ports).stop(f.receiver, d.target, "stop", proof)).toEqual(stopped);
  expect((await f.db.moduleInvocation.findMany()).map(row => row.key).sort()).toEqual([`execution-result:${d.target.attemptId}:unknown`, `execution-result:${d.target.attemptId}:stopped`].sort());
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: d.target.runId } })).toMatchObject({ status: "finished" });
});

test("queued cancel and offered unknown-to-signed-stop completion keep exact outbox keys and identity across replay and restart", async () => {
  const f = await fixture(); await installCompletionOutbox(f);
  const queued = await f.service.admit(f.principal, f.input);
  expect(await f.db.run.findUniqueOrThrow({ where: { id: queued.execution.runId } })).toMatchObject({ status: "queued", startedAt: null });
  expect(await f.db.executionDelivery.count()).toBe(0);
  const cancelled = await f.service.control(f.principal, f.input.workId, "cancel", { operation: "cancel" });
  expect(await createExecutionDelivery(f.ports).control(f.principal, f.input.workId, "cancel", { operation: "cancel" })).toEqual(cancelled);
  expect(await f.db.executionDelivery.count()).toBe(0);
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: queued.execution.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect((await f.db.moduleInvocation.findMany()).map(row => row.key)).toEqual([`execution-result:${queued.execution.attemptId}:stopped`]);

  const offered = await f.service.admit(f.principal, { ...f.input, workId: "offered", commandKey: "offered" });
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  expect(d.target.attemptId).toBe(offered.execution.attemptId);
  const final = await f.service.final(f.receiver, d.target, "final", f.final);
  const unknownCallbacks = await f.db.moduleInvocation.findMany({ orderBy: { key: "asc" } });
  expect(unknownCallbacks.map(row => row.key).sort()).toEqual([`execution-result:${queued.execution.attemptId}:stopped`, `execution-result:${offered.execution.attemptId}:unknown`].sort());
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: offered.execution.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await createExecutionDelivery(f.ports).final(f.receiver, d.target, "final", f.final)).toEqual(final);
  expect(await createExecutionDelivery(f.ports).final(f.receiver, d.target, "final-again", f.final)).toEqual(final);
  expect(await f.db.moduleInvocation.findMany({ orderBy: { key: "asc" } })).toEqual(unknownCallbacks);

  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: final.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  const proof = { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") };
  const stopped = await createExecutionDelivery(f.ports).stop(f.receiver, d.target, "stop", proof);
  const callbacks = await f.db.moduleInvocation.findMany({ orderBy: { key: "asc" } });
  expect(callbacks.map(row => row.key).sort()).toEqual([
    `execution-result:${queued.execution.attemptId}:stopped`,
    `execution-result:${offered.execution.attemptId}:unknown`,
    `execution-result:${offered.execution.attemptId}:stopped`,
  ].sort());
  for (const row of callbacks) expect(row).toMatchObject({ workspaceId: f.principal.workspaceId, target: f.caller.name, tool: "get", mode: "async", status: "queued", caller: "owner", callerModuleId: null, callerHash: null, args: { input: JSON.stringify({ workId: row.key === `execution-result:${queued.execution.attemptId}:stopped` ? f.input.workId : "offered" }) } });
  const restarted = createExecutionDelivery(f.ports);
  expect(await restarted.stop(f.receiver, d.target, "stop", proof)).toEqual(stopped);
  expect(await restarted.stop(f.receiver, d.target, "stop-again", proof)).toEqual(stopped);
  expect(await restarted.final(f.receiver, d.target, "final", f.final)).toEqual(final);
  expect(await restarted.control(f.principal, f.input.workId, "cancel", { operation: "cancel" })).toEqual(cancelled);
  expect(await f.db.moduleInvocation.findMany({ orderBy: { key: "asc" } })).toEqual(callbacks);
});

test("unknown stop occupies the same capacity across authority epochs and independent workspaces", async () => {
  const f = await fixture();
  for (const work of ["one", "two"]) await f.service.admit(f.principal, { ...f.input, workId: work, commandKey: work, workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  const first = (await f.service.poll(f.receiver)).deliveries;
  expect(first).toHaveLength(2);
  for (const d of first) await f.service.final(f.receiver, d.target, "final", f.final);
  await f.service.approveAuthority(f.owner, { ...f.approval, epoch: 2, keyId: "epoch-two" });
  const third = await f.service.admit(f.principal, { ...f.input, workId: "three", commandKey: "three", workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  expect(await createRuns(f.ports, f.principal.workspaceId).claimNext("background", undefined, { kind: "application" })).toBeNull();
  expect(await f.db.run.findUniqueOrThrow({ where: { id: third.execution.runId } })).toMatchObject({ status: "queued" });
  const d = first[0]!, row = await f.db.executionDelivery.findUniqueOrThrow({ where: { id: d.target.deliveryId } });
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: row.finalDigest!, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  // Revoked authority still verifies exact old drain evidence; new work uses the new authority.
  await f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
  expect((await createRuns(f.ports, f.principal.workspaceId).claimNext("background", undefined, { kind: "application" }))?.runId).toBe(third.execution.runId);
});

type ModelRequest = Parameters<NonNullable<ProviderAdapter["complete"]>>[0];
type ModelResult = Awaited<ReturnType<NonNullable<ProviderAdapter["complete"]>>>;
type ModelOperation = { outcome: ReturnType<typeof runtimeOutcomeSchema.parse> | null; failure: boolean; completion?: ModelResult };
async function modelFixture(handler: NonNullable<ProviderAdapter["complete"]>, options: { async?: boolean; lostReceipt?: boolean; accepted?: boolean; status?: () => Promise<void>; abort?: () => Promise<void> } = {}) {
  const f = await fixture();
  f.ports.dataDir = await mkdtemp(join(tmpdir(), "chrona-delivery-model-"));
  modelCleanups.push(async () => {
    await moduleSupervisor(f.ports).stop();
    await rm(f.ports.dataDir, { recursive: true, force: true });
  });
  const requests: { name: string; args: Record<string, unknown> }[] = [], operations = new Map<string, ModelOperation>();
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id: name, args } = event.trigger;
    requests.push({ name, args });
    if (name === "health") return { result: { available: true, sandboxed: false, error: null } };
    if (name === "complete") {
      const { commandKey, configurationRevision, ...request } = args;
      expect(configurationRevision).toBe("configured-model-v1");
      // Model selection belongs to this configured Provider, including omitted request models.
      const complete = () => handler({ ...request, model: "fake-model" } as ModelRequest);
      if (!options.async) return { result: await complete() };
      const operationId = String(commandKey), row: ModelOperation = { outcome: null, failure: false };
      expect(operations.has(operationId)).toBe(false);
      operations.set(operationId, row);
      void complete().then(completion => {
        row.completion = completion;
        row.outcome = { outcome: "finished", sessionId: null, error: null };
      }, error => {
        if (error instanceof CallError && error.code === "failed") row.outcome = { outcome: "failed", sessionId: null, error: error.message };
        else row.failure = true;
      });
      if (options.lostReceipt) throw new CallError("unknown", "Acceptance response lost");
      return { result: { operationId } };
    }
    const operationId = String(args.operationId), row = operations.get(operationId);
    if (!row) throw new CallError("not_found", "Operation not found");
    if (name === "status") { await options.status?.(); return { result: { operationId, ...row } }; }
    if (name === "abort") { await options.abort?.(); return { result: { requested: true } }; }
    if (name === "release") {
      if (!row.outcome) throw new CallError("conflict", "Closure unconfirmed");
      return { result: { released: true } };
    }
    throw new Error(`Unexpected Provider operation: ${name}`);
  });
  f.ports.sandbox = { available: true, isolated: false, startModule: peer.startModule };
  const backend = await f.db.module.create({ data: { workspaceId: f.principal.workspaceId, name: "delivery-model-provider", activeHash: "provider-v1" } });
  const completionOutput = testProviderManifest.tools.find(tool => tool.name === "complete")!.output;
  const statusOutput = testProviderManifest.tools.find(tool => tool.name === "status")!.output, statusProperties = statusOutput.properties;
  if (!statusProperties || typeof statusProperties !== "object") throw new Error("Missing Provider status schema");
  const tools = testProviderManifest.tools.map(tool => ({ ...tool, ...(tool.name === "complete" && options.async ? { output: { type: "object", properties: { operationId: { type: "string" } }, required: ["operationId"] } } : tool.name === "status" ? { output: { ...statusOutput, properties: { ...statusProperties, completion: completionOutput } } } : {}) }));
  const providerManifest = moduleManifestSchema.parse({ ...testProviderManifest, name: backend.name, tools: [...tools, { name: "configure", description: "Provider configuration", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: {} }] });
  await f.db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, manifest: providerManifest, status: "approved", report: {}, intent: {}, source: "user" } });
  await registerAgentProvider(f.ports, f.principal.workspaceId, { kind: "module", module: backend.name, moduleId: backend.id, hash: backend.activeHash! }, {
    id: "delivery-model-fixture", name: "Configured completion fixture", protocolVersion: 1,
    capabilities: { conversation: true, completion: true, native: false, images: false, interactions: false, resume: false },
    endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", complete: "complete" },
    configuration: { tool: "configure", revision: "configured-model-v1" },
  });
  await f.db.workspace.update({ where: { id: f.principal.workspaceId }, data: { settings: { timezone: "UTC", moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 100, dailyCalls: 2, eventTimeoutMs: 5000 } } } });
  const manifest = moduleManifestSchema.parse({ name: f.caller.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.run"], model: { tier: "fake", maxCalls: 2, maxOutputTokens: 100 } });
  await f.db.moduleVersion.create({ data: { moduleId: f.caller.id, hash: f.caller.activeHash!, manifest, status: "approved", report: {}, intent: {}, source: "user" } });
  await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  if (options.accepted !== false) await f.service.accept(f.receiver, d.target, "accept");
  return { ...f, d, manifest, requests, operations };
}
test("model reservation survives unknown gateway outcome and same-key replay never reissues", async () => {
  let calls = 0;
  const f = await modelFixture(async () => { calls++; throw new Error("fake response lost after execution"); });
  const input = { prompt: "private", maxOutputTokens: 80 };
  await expect(f.service.model(f.receiver, f.d.target, "model", input)).rejects.toMatchObject({ code: "failed" });
  const replay = await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "model", input);
  expect(replay).toMatchObject({ status: "pending" });
  expect(calls).toBe(1);
  expect(await f.db.moduleCall.count({ where: { method: "model", status: "pending" } })).toBe(1);
  await expect(f.service.model(f.receiver, f.d.target, "model", { ...input, prompt: "changed" })).rejects.toMatchObject({ code: "conflict" });
  expect(calls).toBe(1);
});
test("model gateway shares ordinary module accounting and receives minimum execution limits", async () => {
  for (const remainingMs of [60_000, 1000]) {
    let calls = 0, observed: ModelRequest | undefined;
    const f = await modelFixture(async args => { calls++; observed = args; return { text: "fake", inputTokens: 3, outputTokens: 4 }; });
    const ordinary = await reserveCompletion(f.ports, { workspaceId: f.principal.workspaceId, moduleId: f.caller.id, hash: f.caller.activeHash!, manifest: f.manifest, eventKey: "execution:other" }, { prompt: "ordinary", maxOutputTokens: 80 }, f.ports.now());
    expect(ordinary).toMatchObject({ error: null, declaredTier: "fake", effectiveHardLimits: { maxCallsPerEvent: 2, maxOutputTokens: 100, eventTimeoutMs: 5000 } });
    expect(executionLaunchSchema.parse(f.d.launch).budget).toMatchObject({ timeoutMs: 60_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 100 });
    const run = await f.db.run.findUniqueOrThrow({ where: { id: f.d.target.runId } });
    f.setNow(new Date(run.deadlineAt!.getTime() - remainingMs));
    const input = { prompt: "fake", maxOutputTokens: 80 };
    expect(await f.service.model(f.receiver, f.d.target, "over-output-budget", { ...input, maxOutputTokens: 101 })).toMatchObject({ status: "rejected", error: "budget_exceeded" });
    expect(calls).toBe(0);
    const result = await f.service.model(f.receiver, f.d.target, "model", input);
    expect(result).toMatchObject({ status: "completed", result: { text: "fake" } });
    expect(observed).toMatchObject({ ...input, timeoutMs: Math.min(5000, remainingMs) });
    expect(await f.service.model(f.receiver, f.d.target, "model", input)).toEqual(result);
    const denied = await f.service.model(f.receiver, f.d.target, "second", input);
    expect(denied).toMatchObject({ status: "rejected", error: "budget_exceeded" });
    expect(await f.service.model(f.receiver, f.d.target, "second", input)).toEqual(denied);
    expect(calls).toBe(1);
    expect(await f.db.moduleCall.count({ where: { method: "model", status: "executed" } })).toBe(1);
  }
});

function completionGate() {
  let resolve!: (result: ModelResult) => void, reject!: (error: Error) => void;
  const promise = new Promise<ModelResult>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function waitForModel(check: () => boolean) {
  for (let count = 0; count < 400; count++) { if (check()) return; await Bun.sleep(5); }
  throw new Error("Provider lifecycle observation did not arrive");
}

test.each([false, true])("registered completion polls its receipt and settles once after actual closure (lost acceptance: %s)", async lostReceipt => {
  const gate = completionGate(); let calls = 0;
  const f = await modelFixture(async args => { calls++; expect(args.model).toBe("fake-model"); return gate.promise; }, { async: true, lostReceipt });
  const input = { prompt: "async completion", maxOutputTokens: 80 };
  const pending = f.service.model(f.receiver, f.d.target, "async", input);
  let settled = false; void pending.finally(() => { settled = true; }).catch(() => {});
  await waitForModel(() => f.requests.some(row => row.name === "status"));
  const reservation = await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } });
  expect(reservation).toMatchObject({ status: "pending", outputTokens: null });
  expect(settled).toBe(false);
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "async", input)).toMatchObject({ status: "pending", reservationId: reservation.id });
  expect(f.requests.some(row => row.name === "release")).toBe(false);
  gate.resolve({ text: "async result", inputTokens: 3, outputTokens: 4 });
  const completed = await pending;
  expect(completed).toMatchObject({ status: "completed", reservationId: reservation.id, result: { text: "async result", inputTokens: 3, outputTokens: 4 } });
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "async", input)).toEqual(completed);
  expect(await f.db.moduleCall.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({ status: "executed", inputTokens: 3, outputTokens: 4 });
  expect(f.requests.filter(row => row.name === "complete")).toHaveLength(1); expect(calls).toBe(1);
  expect(f.requests.filter(row => row.name === "release")).toHaveLength(1);
  expect(f.requests.filter(row => ["status", "release"].includes(row.name)).every(row => row.args.operationId === reservation.id)).toBe(true);
  await expect(f.service.model(f.receiver, f.d.target, "async", { ...input, prompt: "changed" })).rejects.toMatchObject({ code: "conflict" });
});

test.each(["unknown closure", "missing result"] as const)("registered completion retains pending budget and identity on %s", async mode => {
  const gate = completionGate(); let calls = 0;
  const f = await modelFixture(async () => { calls++; return gate.promise; }, { async: true });
  const input = { prompt: "unknown completion", maxOutputTokens: 80 };
  const pending = f.service.model(f.receiver, f.d.target, "unknown", input).then(result => ({ result }), error => ({ error }));
  await waitForModel(() => f.operations.size === 1);
  if (mode === "unknown closure") gate.reject(new Error("Closure is unknown"));
  else f.operations.values().next().value!.outcome = { outcome: "finished", sessionId: null, error: null };
  expect(await pending).toMatchObject({ error: { code: "failed" } });
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "unknown", input)).toMatchObject({ status: "pending" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending", outputTokens: null });
  expect(f.requests.some(row => row.name === "release")).toBe(false);
  await reserveCompletion(f.ports, { workspaceId: f.principal.workspaceId, moduleId: f.caller.id, hash: f.caller.activeHash!, manifest: f.manifest, eventKey: "execution:ordinary" }, input, f.ports.now());
  expect(await f.service.model(f.receiver, f.d.target, "another-key", input)).toMatchObject({ status: "rejected", error: "budget_exceeded" });
  expect(calls).toBe(1);
});

test("completion deadline requests abort but settles timeout only after actual closure", async () => {
  const gate = completionGate(), f = await modelFixture(async () => gate.promise, { async: true });
  const run = await f.db.run.findUniqueOrThrow({ where: { id: f.d.target.runId } }); f.setNow(new Date(run.deadlineAt!.getTime() - 150));
  const input = { prompt: "timeout completion", maxOutputTokens: 80 };
  const pending = f.service.model(f.receiver, f.d.target, "timeout", input).then(result => ({ result }), error => ({ error }));
  await waitForModel(() => f.requests.some(row => row.name === "abort"));
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  expect(f.requests.some(row => row.name === "release")).toBe(false);
  await Bun.sleep(120);
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "timeout", input)).toMatchObject({ status: "pending" });
  gate.reject(new CallError("failed", "Actual closure confirmed"));
  expect(await pending).toMatchObject({ error: { code: "failed", message: "timeout: module model call" } });
  const receipt = await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "timeout", input);
  expect(receipt).toMatchObject({ status: "failed", error: "timeout" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "failed", error: "timeout" });
  expect(f.requests.filter(row => row.name === "complete")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "abort")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "release")).toHaveLength(1);
  expect(f.requests.filter(row => ["status", "abort", "release"].includes(row.name)).every(row => row.args.operationId === (receipt as { reservationId: string }).reservationId)).toBe(true);
});

test("hung status and abort remain bounded and retain pending completion without replay", async () => {
  const never = new Promise<never>(() => {}), f = await modelFixture(async () => never, { async: true, status: () => never, abort: () => never });
  const run = await f.db.run.findUniqueOrThrow({ where: { id: f.d.target.runId } }); f.setNow(new Date(run.deadlineAt!.getTime() - 100));
  const input = { prompt: "hung completion", maxOutputTokens: 80 }, started = Date.now();
  await expect(f.service.model(f.receiver, f.d.target, "hung", input)).rejects.toMatchObject({ code: "failed" });
  expect(Date.now() - started).toBeLessThan(7000);
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "hung", input)).toMatchObject({ status: "pending" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "pending" });
  expect(f.requests.filter(row => row.name === "complete")).toHaveLength(1);
  expect(f.requests.some(row => row.name === "release")).toBe(false);
}, 10000);

test("closed completion exceeding output budget settles failed once and never reissues", async () => {
  const f = await modelFixture(async () => ({ text: "too many tokens", inputTokens: 1, outputTokens: 81 }), { async: true });
  const input = { prompt: "bounded", maxOutputTokens: 80 };
  await expect(f.service.model(f.receiver, f.d.target, "overrun", input)).rejects.toMatchObject({ code: "failed" });
  expect(await createExecutionDelivery(f.ports).model(f.receiver, f.d.target, "overrun", input)).toMatchObject({ status: "failed", error: "provider_error" });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).toMatchObject({ status: "failed", error: "provider_error" });
  expect(f.requests.filter(row => row.name === "complete")).toHaveLength(1);
  expect(f.requests.filter(row => row.name === "release")).toHaveLength(1);
});

test("model delegation requires the accepted delivery and exact receiver before reservation or Provider I/O", async () => {
  const f = await modelFixture(async () => ({ text: "bounded", inputTokens: 1, outputTokens: 1 }), { accepted: false });
  const input = { prompt: "private", maxOutputTokens: 80 };
  await expect(f.service.model(f.receiver, f.d.target, "before-accept", input)).rejects.toMatchObject({ code: "forbidden" });
  await f.service.accept(f.receiver, f.d.target, "accept");
  await expect(f.service.model({ ...f.receiver, activationId: "other" }, f.d.target, "wrong-activation", input)).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.service.model(f.receiver, { ...f.d.target, launchDigest: "b".repeat(64) }, "wrong-target", input)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  expect(f.requests.filter(row => row.name === "complete")).toHaveLength(0);
});

test("public pause fences caller and receiver before idle conflict, then exact drain permits pause and a new activation", async () => {
  const { moduleContext } = await import("../modules/module-context"), { requestStatus } = await import("../modules/module-status");
  for (const side of ["caller", "receiver"] as const) {
    const f = await fixture(); await f.service.admit(f.principal, f.input);
    const d = (await f.service.poll(f.receiver)).deliveries[0]!, moduleId = side === "caller" ? f.caller.id : f.app.id;
    const module = side === "caller" ? f.caller : f.app;
    await f.db.moduleVersion.create({ data: { moduleId, hash: module.activeHash!, manifest: moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [] }), source: "user", status: "approved", intent: {}, report: {} } });
    const context = moduleContext(f.ports, f.principal.workspaceId);
    await expect(requestStatus(context, moduleId, "paused", "test drain")).rejects.toMatchObject({ code: "conflict" });
    const fenced = await f.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    expect(fenced).toMatchObject({ status: "active", executionFenceAt: expect.any(Date) });
    await expect(f.service.admit(f.principal, { ...f.input, workId: "after-fence", commandKey: "after-fence" })).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.service.poll(f.receiver)).deliveries[0]!.launchable).toBe(false);
    const committed = await f.service.final(f.receiver, d.target, "final", { ...f.final, outcome: "cancelled" });
    const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: committed.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
    await f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
    await requestStatus(context, moduleId, "paused", "drained");
    expect(await f.db.module.findUnique({ where: { id: moduleId } })).toMatchObject({ status: "paused" });
    await requestStatus(context, moduleId, "active", "resume");
    const resumed = await f.db.module.findUniqueOrThrow({ where: { id: moduleId } });
    expect(resumed.executionFenceAt).toBeNull(); expect(resumed.activationId).not.toBe(fenced.activationId);
    if (side === "receiver") await expect(f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") })).rejects.toMatchObject({ code: "forbidden" });
  }
});

test("stopped application workspace cleanup is durable, scoped, preview-bound and drains before lifecycle completion", async () => {
  const { kernelExecutionCleanup } = await import("../kernel-execution-tools");
  const f = await fixture(); await f.service.admit(f.principal, { ...f.input, workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  await expect(kernelExecutionCleanup(f.ports, f.principal, { op: "preview", workId: "work", commandKey: "early" })).rejects.toMatchObject({ code: "conflict" });
  const committed = await f.service.final(f.receiver, d.target, "final", f.final);
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: committed.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  await f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
  const preview = { op: "preview" as const, workId: "work", commandKey: "preview" };
  expect(await kernelExecutionCleanup(f.ports, f.principal, preview)).toMatchObject({ state: "pending", operationKey: "preview" });
  await expect(assertExecutionModuleIdle(f.db, f.app.id)).rejects.toMatchObject({ code: "conflict" });
  const offered = (await f.service.poll(f.receiver)).deliveries[0]!;
  expect(offered.controls).toMatchObject([{ operation: "cleanup", requestKey: "preview" }]);
  const report = { workId: "work", workspaceRef: (d.launch as { workspaceRef: string }).workspaceRef, state: "retained" as const, reason: "fake preview verified", previewDigest: "b".repeat(64), operationKey: "preview" };
  await expect(f.service.cleanupReport(f.receiver, d.target, "bad", "preview", { ...report, workspaceRef: "wrong" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.service.cleanupReport(f.receiver, d.target, "preview-report", "preview", report)).toEqual(report);
  expect(await createExecutionDelivery(f.ports).cleanupReport(f.receiver, d.target, "preview-report", "preview", report)).toEqual(report);
  expect(await kernelExecutionCleanup(f.ports, f.principal, preview)).toEqual(report);
  await assertExecutionModuleIdle(f.db, f.app.id);
  await expect(kernelExecutionCleanup(f.ports, f.principal, { op: "confirm", workId: "work", commandKey: "bad-confirm", previewDigest: "c".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
  const confirm = { op: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: report.previewDigest };
  await kernelExecutionCleanup(f.ports, f.principal, confirm);
  await f.service.poll(f.receiver);
  const removed = { ...report, state: "removed" as const, operationKey: "confirm", reason: "fake workspace removed" };
  await f.service.cleanupReport(f.receiver, d.target, "confirm-report", "confirm", removed);
  expect(await kernelExecutionCleanup(f.ports, f.principal, confirm)).toEqual(removed);
  expect((await f.service.poll(f.receiver)).deliveries).toHaveLength(0);
});

test("shared model reservations survive caller removal and cannot refund the workspace allowance", async () => {
  const f = await modelFixture(async () => ({ text: "bounded", inputTokens: 1, outputTokens: 1 }));
  const spender = await f.db.module.create({ data: { workspaceId: f.principal.workspaceId, name: "removed-spender", activeHash: "spent" } });
  const scope = { workspaceId: f.principal.workspaceId, moduleId: spender.id, hash: spender.activeHash!, manifest: { ...f.manifest, name: spender.name }, eventKey: "execution:first" };
  expect((await reserveCompletion(f.ports, scope, { prompt: "one", maxOutputTokens: 10 }, f.ports.now())).error).toBeNull();
  expect((await reserveCompletion(f.ports, scope, { prompt: "two", maxOutputTokens: 10 }, f.ports.now())).error).toBeNull();
  await f.db.module.delete({ where: { id: spender.id } });
  expect(await f.db.moduleCall.count({ where: { method: "model", status: "pending", moduleId: null } })).toBe(2);
  const replacement = await f.db.module.create({ data: { workspaceId: f.principal.workspaceId, name: "replacement", activeHash: "replacement" } });
  expect((await reserveCompletion(f.ports, { ...scope, moduleId: replacement.id, hash: replacement.activeHash!, manifest: { ...f.manifest, name: replacement.name }, eventKey: "execution:replacement" }, { prompt: "third", maxOutputTokens: 10 }, f.ports.now())).error).toBe("budget_exceeded");
});

test("shared execution controls journal application work and never dispatch through a local Provider", async () => {
  const f = await fixture(), admitted = await f.service.admit(f.principal, f.input);
  const { createExecutions } = await import("./execution");
  const executions = createExecutions(f.ports), d = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.accept(f.receiver, d.target, "accept");
  const ref = { workId: admitted.execution.workId, attemptId: admitted.execution.attemptId, runId: admitted.execution.runId };
  await expect(executions.cancel(f.principal, { ...ref, attemptId: "wrong-attempt", op: "cancel", commandKey: "cancel" })).rejects.toMatchObject({ code: "not_found" });
  const send = { ...ref, op: "send" as const, commandKey: "write", text: "continue" };
  expect(await executions.admitControl(f.principal, send)).toEqual({ perform: false, operationId: ref.runId });
  await executions.send(f.principal, send);
  expect((await f.service.poll(f.receiver)).deliveries[0]!.controls).toMatchObject([{ requestKey: "write", operation: "control", payload: { operation: "write", text: "continue" } }]);
  const cancel = { ...ref, op: "cancel" as const, commandKey: "cancel" };
  expect(await executions.cancel(f.principal, cancel)).toMatchObject({ cancelRequested: true, stopConfirmed: false });
  await executions.cancel(f.principal, cancel);
  expect(await f.db.executionCommand.count({ where: { attemptId: ref.attemptId } })).toBe(2);
  expect((await f.service.poll(f.receiver)).deliveries[0]!.controls).toHaveLength(2);
  expect(await f.db.executionAttempt.findUnique({ where: { id: ref.attemptId } })).toMatchObject({ heldDirectory: expect.any(String), stopConfirmedAt: null });
});

async function automaticPause(f: Awaited<ReturnType<typeof fixture>>, module: typeof f.caller) {
  const hash = module.activeHash!;
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: moduleManifestSchema.parse({ name: module.name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }), source: "user", intent: {}, report: {}, status: "approved" } });
  const activation = await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, module.workspaceId), tx, { moduleId: module.id, previousHash: null, hash, generationId: "pause-test" }));
  const execution = { workspaceId: module.workspaceId, moduleId: module.id, hash, activationId: activation.activationId, triggerId: "failure", firedAt: f.ports.now() };
  let failures = 0;
  return { execution, async fail() {
    const resultId = `failure-${++failures}`;
    await f.db.$transaction(tx => recordModuleExecution(tx, { ...execution, resultId, outcome: "failure", now: f.ports.now() }));
    return pauseFailedModule(f.ports, execution, resultId);
  } };
}

test.each(["caller", "receiver"] as const)("automatic %s pause commits its drain before an idle conflict, blocks dispatch and retains unknown capacity", async role => {
  const f = await fixture(), module = role === "caller" ? f.caller : f.app;
  const pause = await automaticPause(f, module);
  const admitted = await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  await f.service.accept(f.receiver, d.target, "accept");
  await f.service.started(f.receiver, d.target, "start", { id: "p", scope: "scope" });
  // A second, unclaimed Run proves the fence also prevents dispatch already in the queue.
  const queued = await f.service.admit(f.principal, { ...f.input, workId: "queued", commandKey: "queued", workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  await pause.fail(); await pause.fail();
  expect(await f.db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "active", executionFenceAt: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ cancelRequestedAt: null, capabilityRevokedAt: null });
  expect(await f.db.executionReceipt.count({ where: { operation: "control" } })).toBe(0);
  await expect(pause.fail()).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "active", activeHash: module.activeHash, activationId: module.activationId, executionFenceAt: expect.any(Date) });
  expect(await f.db.audit.count({ where: { kind: "module_disabled", subjectId: module.id } })).toBe(0);
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ cancelRequestedAt: expect.any(Date), capabilityRevokedAt: expect.any(Date), stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: queued.execution.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: queued.execution.runId } })).toMatchObject({ status: "cancelled", startedAt: null });
  expect(await createRuns(f.ports, module.workspaceId).claimNext("background", undefined, { kind: "application" })).toBeNull();
  await expect(f.service.admit(f.principal, { ...f.input, workId: "blocked", commandKey: "blocked", workspace: { ...f.input.workspace, mode: "independent_worktree" } })).rejects.toMatchObject({ code: "forbidden" });
  // Repeating the pause decision is safe; its already committed cancel remains replayable.
  await expect(pauseFailedModule(f.ports, pause.execution, "failure-3")).rejects.toMatchObject({ code: "conflict" });
  const drained = (await createExecutionDelivery(f.ports).poll(f.receiver)).deliveries;
  expect(drained).toHaveLength(1);
  expect(drained[0]).toMatchObject({ launchable: false, controls: [{ operation: "control", requestKey: `fence:${module.id}`, payload: { operation: "cancel" } }] });
  expect(await f.db.executionReceipt.count({ where: { operation: "control", requestKey: `fence:${module.id}` } })).toBe(1);
  // A committed final with no proof still cannot release capacity or complete the pause.
  const committed = await f.service.final(f.receiver, d.target, "final", { ...f.final, outcome: "cancelled" });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: admitted.execution.runId } })).toMatchObject({ status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" });
  await expect(pauseFailedModule(f.ports, pause.execution, "failure-3")).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  if (role === "caller") await expect(f.service.admit(f.owner, { ...f.input, workId: "occupied", commandKey: "occupied" })).rejects.toMatchObject({ code: "conflict" });
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "exited", processIdentity: { id: "p", scope: "scope" }, finalDigest: committed.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  await f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
  await pauseFailedModule(f.ports, pause.execution, "failure-3");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "paused", activeHash: module.activeHash, activationId: module.activationId });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
});

test("a copied verified-stop brand cannot bypass the private verifier provenance", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.receiver)).deliveries[0]!;
  const committed = await f.service.final(f.receiver, d.target, "final", f.final);
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: committed.finalDigest, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  const proof = { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") };
  const evidence = await f.db.$transaction(tx => verifyExecutionStop(tx, d.target, proof));
  await expect(f.db.$transaction(tx => createRuns(f.ports, f.principal.workspaceId).finishRunIn(tx, d.target.runId, { outcome: "finished", sessionId: null, error: null }, f.ports.now(), { ...evidence }))).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await f.service.stop(f.receiver, d.target, "stop", proof)).toMatchObject({ settled: true });
});


test.each(["hash", "delivery activation", "policy activation"] as const)("automatic pause rechecks the %s after the fence commit", async changed => {
  const f = await fixture(), pause = await automaticPause(f, f.caller);
  for (let i = 1; i <= 3; i++) await f.db.$transaction(tx => recordModuleExecution(tx, { ...pause.execution, resultId: `race-${i}`, outcome: "failure", now: f.ports.now() }));
  let transactions = 0;
  // Simulate a lifecycle writer winning precisely between the independently committed phases.
  const db = new Proxy(f.db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return async (action: Parameters<typeof f.db.$transaction>[0]) => {
      const result = await target.$transaction(action);
      if (++transactions === 1) {
        expect(await f.db.module.findUniqueOrThrow({ where: { id: f.caller.id } })).toMatchObject({ executionFenceAt: expect.any(Date) });
        if (changed === "policy activation") await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.caller.workspaceId), tx, { moduleId: f.caller.id, previousHash: f.caller.activeHash, hash: f.caller.activeHash!, generationId: "same-hash-reactivation" }));
        await f.db.module.update({ where: { id: f.caller.id }, data: { executionFenceAt: null, ...(changed === "hash" ? { activeHash: "replacement" } : changed === "delivery activation" ? { activationId: "replacement" } : {}) } });
      }
      return result;
    };
  } });
  await pauseFailedModule({ ...f.ports, db }, pause.execution, "race-3");
  expect(transactions).toBe(2);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.caller.id } })).toMatchObject({ status: "active", executionFenceAt: null });
  expect(await f.db.audit.count({ where: { kind: "module_disabled", subjectId: f.caller.id } })).toBe(0);
});


test("automatic pause conflict keeps unknown executions in pending capacity", async () => {
  const f = await fixture(), pause = await automaticPause(f, f.caller);
  for (const workId of ["one", "two"]) await f.service.admit(f.principal, { ...f.input, workId, commandKey: workId, workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  const deliveries = (await f.service.poll(f.receiver)).deliveries;
  expect(deliveries).toHaveLength(2);
  for (const d of deliveries) await f.service.final(f.receiver, d.target, "final", f.final);
  await pause.fail(); await pause.fail();
  await expect(pause.fail()).rejects.toMatchObject({ code: "conflict" });
  // The owner bypasses the caller's fence, but still shares the occupied target capacity.
  const pending = await f.service.admit(f.owner, { ...f.input, workId: "owner-pending", commandKey: "owner-pending", workspace: { ...f.input.workspace, mode: "independent_worktree" } });
  const runs = createRuns(f.ports, f.principal.workspaceId);
  expect(await runs.claimNext("background", undefined, { kind: "application" })).toBeNull();
  expect(await f.db.run.findUniqueOrThrow({ where: { id: pending.execution.runId } })).toMatchObject({ status: "queued", startedAt: null });
  expect(await f.db.executionAttempt.count({ where: { stopConfirmedAt: null, run: { startedAt: { not: null } } } })).toBe(2);
  const d = deliveries[0]!, row = await f.db.executionDelivery.findUniqueOrThrow({ where: { id: d.target.deliveryId } });
  const statement: ExecutionSignedStop["statement"] = { target: d.target, kind: "never_started", processIdentity: null, finalDigest: row.finalDigest!, sourceThrough: 0, observedAt: f.ports.now().toISOString() };
  await f.service.stop(f.receiver, d.target, "stop", { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), f.key.privateKey).toString("base64") });
  expect((await runs.claimNext("background", undefined, { kind: "application" }))?.runId).toBe(pending.execution.runId);
});

 test("durable application admission returns while the queue wake remains pending", async () => {
  const f = await fixture();
  let wakes = 0, release!: () => void;
  const wake = new Promise<void>(resolve => { release = resolve; });
  f.ports.onQueued = () => { wakes++; return wake; };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([f.service.admit(f.principal, f.input), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("admission awaited the queue wake")), 1000); })]);
    expect(wakes).toBe(1);
    expect(await f.db.run.findUnique({ where: { id: result.execution.runId } })).toMatchObject({ status: "queued" });
    expect((await f.service.admit(f.principal, f.input)).execution).toEqual(result.execution);
    expect(wakes).toBe(1);
  } finally { clearTimeout(timeout); release(); }
});
