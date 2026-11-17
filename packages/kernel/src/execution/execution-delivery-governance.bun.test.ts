import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ExecutionPrincipal, type ExecutionSignedStop, type ExecutionDeliveryTarget, type ExecutionDeliveryFinal, type KernelExecutionStart } from "@chrona/contracts/steward";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { createExecutionDelivery } from "./execution-delivery";
import { createExecutionEventStore } from "./execution-event-store";
import { callExecutionDeliveryCarrier } from "./execution-delivery-carrier";
import { executionDigest } from "./execution-delivery-digest";
import { RemoteExecutionApp } from "../../../../.generated/applications/remote-execution/app";
import { RoutedKernelPort } from "../../../../.generated/applications/remote-execution/kernel-port";
import { Store } from "../../../../.generated/applications/remote-execution/store";
import { digest, readStored, type Delivery, type Target } from "../../../../.generated/applications/remote-execution/contracts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb({ injectedAgent: false }); cleanup.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "native governance" } });
  const caller = await db.module.create({ data: { workspaceId: workspace.id, name: "caller", activeHash: "b".repeat(40) } });
  const receiver = await db.module.create({ data: { workspaceId: workspace.id, name: "remote-execution", activeHash: "a".repeat(40) } });
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dirname, "../../../../.generated/applications/remote-execution/module.json"), "utf8")));
  await db.moduleVersion.create({ data: { moduleId: receiver.id, hash: receiver.activeHash!, manifest, status: "approved", report: {}, intent: {}, source: "user" } });
  const now = new Date("2026-11-09T10:00:00Z"), ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/s5-native-governance", publicUrl: null };
  ports.executionEvents = createExecutionEventStore(ports);
  const who = { workspaceId: workspace.id, moduleId: receiver.id, hash: receiver.activeHash!, activationId: receiver.activationId };
  const scope = { ...who, receiverActivationId: who.activationId, manifest };
  const call = (input: unknown) => callExecutionDeliveryCarrier(ports, scope, input);
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: caller.id, hash: caller.activeHash! } };
  const key = generateKeyPairSync("ed25519"), service = createExecutionDelivery(ports), baseline = { kind: "commit" as const, digest: "c".repeat(40) };
  const device = { deviceId: "device", generation: 1, incarnation: "incarnation", keyId: "key" };
  const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const approval = { receiver: who, subjectId: device.deviceId, epoch: 1, keyId: device.keyId, publicKey, verifierId: "ed25519" as const, verifierVersion: "1" as const, approvalId: "approval", scope: { callerModuleIds: [caller.id], targets: [{ targetRef: "project", targetRevision: 1, projectRef: "project", directoryIdentity: "directory", baseline, workspaceModes: ["existing" as const, "independent_worktree" as const] }] } };
  await service.approveAuthority({ ...principal, caller: { kind: "owner" } }, approval);
  const subject = { subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId };
  const input: KernelExecutionStart = { kind: "execution", workId: "work", commandKey: "start", goal: "offline governance", placement: { kind: "application", applicationId: receiver.id, targetRef: "project", targetRevision: 1, projectRef: "project" }, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: "2026-11-09T12:00:00Z", budget: { timeoutMs: 60000, maxToolCalls: 1, maxModelCalls: 1, maxOutputTokens: 100 } };
  const reconcile = (extra: Record<string, unknown> = {}) => call({ operation: "reconcile", key: "snapshot", ...subject, snapshotId: "snapshot", page: 0, complete: true, items: [], ...extra });
  const final: ExecutionDeliveryFinal = { outcome: "cancelled", error: null, throughSourceSeq: 0, baseline, finalMessage: null, missing: false };
  function proof(target: ExecutionDeliveryTarget, finalDigest: string): ExecutionSignedStop {
    const statement: ExecutionSignedStop["statement"] = { target, kind: "never_started", processIdentity: null, finalDigest, sourceThrough: 0, observedAt: now.toISOString() };
    return { statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), key.privateKey).toString("base64") };
  }
  return { db, ports, who, scope, call, principal, key, service, input, subject, reconcile, final, proof, approval, publicKey, device, baseline };
}
function item(target: ExecutionDeliveryTarget) { return { deliveryId: target.deliveryId, launchDigest: target.launchDigest, state: "intent", journalSeq: 0, sourceWatermark: 0 }; }

test("native receiver revoke atomically fences exact generation, queued Runs and offered capacity; receipts survive restart", async () => {
  const f = await fixture();
  await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.who, 1)).deliveries[0]!;
  const queued = await f.service.admit(f.principal, { ...f.input, workId: "queued", commandKey: "queued" });
  const request = { operation: "revoke", key: "revoke", ...f.subject, reason: "owner-device-revoke" };
  await expect(f.call({ ...request, keyId: "foreign-key" })).rejects.toMatchObject({ code: "forbidden" });
  const receipt = await f.call(request);
  expect(receipt).toEqual({ revoked: true, ...f.subject });
  expect(await callExecutionDeliveryCarrier({ ...f.ports }, { ...f.scope }, request)).toEqual(receipt);
  await expect(f.call({ ...request, reason: "changed" })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: queued.execution.attemptId } })).toMatchObject({ capabilityRevokedAt: expect.any(Date), cancelRequestedAt: expect.any(Date), stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ capabilityRevokedAt: expect.any(Date), cancelRequestedAt: expect.any(Date), stopConfirmedAt: null, heldDirectory: expect.any(String) });
  const drain = (await f.service.poll(f.who)).deliveries[0]!;
  expect(drain.launchable).toBe(false); expect(drain.controls).toHaveLength(1);
  await expect(f.service.admit(f.principal, { ...f.input, commandKey: "new", workId: "new" })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.audit.count({ where: { kind: "execution_governance_receipt" } })).toBe(1);
});

test("native cancel is exact-target, immutable and retains unknown stop; retention only observes", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.who)).deliveries[0]!;
  const request = { operation: "cancel", target: d.target, key: "cancel", reason: "lifecycle" };
  await expect(f.call({ ...request, target: { ...d.target, epoch: 2 } })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.call({ ...request, receiver: f.who })).rejects.toMatchObject({ code: "invalid" });
  const receipt = await f.call(request) as { controlKey: string };
  expect(await f.call(request)).toEqual(receipt);
  await expect(f.call({ ...request, reason: "different" })).rejects.toMatchObject({ code: "conflict" });
  const retained = await f.call({ operation: "retention", key: "before" });
  expect(retained).toEqual({ safeToDelete: false, pendingDeliveryIds: [d.target.deliveryId], pendingControlKeys: [receipt.controlKey] });
  expect((await f.service.poll(f.who)).deliveries[0]!.controls[0]!.requestKey).toBe(receipt.controlKey);
  const committed = await f.service.final(f.who, d.target, "final", f.final);
  expect(await f.call({ operation: "retention", key: "final-only" })).toMatchObject({ safeToDelete: false });
  await f.call({ operation: "stop", target: d.target, key: "stop", proof: f.proof(d.target, committed.finalDigest) });
  expect(await f.call({ operation: "retention", key: "stopped-unacked" })).toEqual({ safeToDelete: false, pendingDeliveryIds: [d.target.deliveryId], pendingControlKeys: [receipt.controlKey] });
  const draining = (await f.service.poll(f.who)).deliveries;
  expect(draining).toHaveLength(1);
  expect(draining[0]).toMatchObject({ launchable: false, controls: [{ requestKey: receipt.controlKey, operation: "control", payload: { operation: "cancel" } }] });
  await f.call({ operation: "acknowledge", target: d.target, key: "ack", controlKey: receipt.controlKey });
  expect((await f.service.poll(f.who)).deliveries).toHaveLength(0);
  expect(await f.call({ operation: "retention", key: "unfenced-empty" })).toMatchObject({ safeToDelete: false });
  await f.db.module.update({ where: { id: f.who.moduleId }, data: { executionFenceAt: f.ports.now() } });
  expect(await f.call({ operation: "retention", key: "after" })).toEqual({ safeToDelete: true, pendingDeliveryIds: [], pendingControlKeys: [] });
  expect(await f.call({ operation: "retention", key: "before" })).toEqual(retained);
  expect(await f.db.executionDelivery.count()).toBe(1); expect(await f.db.executionAuthority.count()).toBe(1);
  await expect(f.service.admit(f.principal, { ...f.input, workId: "fenced-new", commandKey: "fenced-new" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.who.moduleId }, data: { activationId: "resumed-activation", executionFenceAt: null } });
  await expect(f.call({ operation: "retention", key: "after" })).rejects.toMatchObject({ code: "forbidden" });
});

test("native reconciliation requires complete contiguous exact-authority snapshots and never certifies journal stop", async () => {
  const f = await fixture();
  expect(await f.reconcile()).toEqual({ recorded: true, reconciled: true, missing: [], launchable: true });
  await f.service.admit(f.principal, f.input);
  await f.service.admit(f.principal, { ...f.input, workId: "second", commandKey: "second" });
  const [a, b] = (await f.service.poll(f.who)).deliveries;
  const missing = await f.reconcile({ key: "missing", snapshotId: "missing" });
  expect(missing).toEqual({ recorded: true, reconciled: true, missing: [a!.target.deliveryId, b!.target.deliveryId].sort(), launchable: false });
  const base = { snapshotId: "paged", key: "page0", page: 0, complete: false, items: [item(a!.target)] };
  expect(await f.reconcile(base)).toMatchObject({ reconciled: false, launchable: false });
  await expect(f.reconcile({ ...base, key: "duplicate-page" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.reconcile({ ...base, key: "page2", page: 2 })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.reconcile({ ...base, key: "page1", page: 1, complete: true, items: [item(b!.target)] })).toMatchObject({ reconciled: true, missing: [], launchable: true });
  await expect(f.reconcile({ key: "wrong", snapshotId: "wrong", items: [{ ...item(a!.target), launchDigest: "f".repeat(64) }] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.reconcile({ key: "epoch", epoch: 2 })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.reconcile({ key: "journal-stop", snapshotId: "journal-stop", items: [{ ...item(a!.target), state: "stopped" }, item(b!.target)] })).toMatchObject({ launchable: false });
  expect(await f.db.executionAttempt.count({ where: { heldDirectory: { not: null }, stopConfirmedAt: null } })).toBe(2);
  expect(await f.reconcile({ key: "missing", snapshotId: "missing" })).toEqual(missing);
});

test("receiver identity cannot cross activation or authority; paused exact receiver can drain", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.who)).deliveries[0]!;
  await expect(callExecutionDeliveryCarrier(f.ports, { ...f.scope, receiverActivationId: "other" }, { operation: "revoke", key: "bad", ...f.subject, reason: "bad" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.who.moduleId }, data: { status: "paused", executionFenceAt: f.ports.now() } });
  await expect(f.call({ operation: "started", target: d.target, key: "start", processIdentity: { id: "p", scope: "s" } })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.reconcile({ key: "paused", snapshotId: "paused", items: [item(d.target)] })).toMatchObject({ launchable: false });
  await f.call({ operation: "cancel", target: d.target, key: "cancel", reason: "paused" });
  const result = await f.call({ operation: "final", target: d.target, key: "final", final: f.final }) as { finalDigest: string };
  expect(await f.call({ operation: "stop", target: d.target, key: "stop", proof: f.proof(d.target, result.finalDigest) })).toMatchObject({ settled: true });
});

test("generation revoke rolls back fences and durable receipt if queued settlement fails", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  f.ports.onExecutionFinishedIn = async () => { throw new Error("fake settlement crash"); };
  const request = { operation: "revoke", key: "revoke", ...f.subject, reason: "test" };
  await expect(f.call(request)).rejects.toThrow("fake settlement crash");
  expect(await f.db.executionAuthority.findFirstOrThrow()).toMatchObject({ revokedAt: null });
  expect(await f.db.executionAttempt.findFirstOrThrow()).toMatchObject({ capabilityRevokedAt: null, heldDirectory: expect.any(String) });
  expect(await f.db.audit.count({ where: { kind: "execution_governance_receipt" } })).toBe(0);
  f.ports.onExecutionFinishedIn = undefined;
  expect(await f.call(request)).toMatchObject({ revoked: true });
});

test("receiver governance cannot reach another receiver or successor device generation", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const old = (await f.service.poll(f.who)).deliveries[0]!;
  const other = await f.db.module.create({ data: { workspaceId: f.who.workspaceId, name: "other-receiver", activeHash: f.who.hash } });
  await f.db.moduleVersion.create({ data: { moduleId: other.id, hash: f.who.hash, manifest: f.scope.manifest, status: "approved", report: {}, intent: {}, source: "user" } });
  const foreignCall = (input: unknown) => callExecutionDeliveryCarrier(f.ports, { ...f.scope, moduleId: other.id, receiverActivationId: other.activationId }, input);
  await expect(foreignCall({ operation: "cancel", target: old.target, key: "foreign", reason: "foreign" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(foreignCall({ operation: "revoke", ...f.subject, key: "foreign", reason: "foreign" })).rejects.toMatchObject({ code: "forbidden" });
  const next = await f.service.approveAuthority({ ...f.principal, caller: { kind: "owner" } }, { ...f.approval, epoch: 2, keyId: "next-key", approvalId: "next-approval" });
  const newer = await f.service.admit(f.principal, { ...f.input, workId: "next", commandKey: "next" });
  await f.call({ operation: "revoke", ...f.subject, key: "old-revoke", reason: "old-generation-only" });
  expect(await f.db.executionAuthority.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({ revokedAt: null });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: newer.execution.attemptId } })).toMatchObject({ capabilityRevokedAt: null, cancelRequestedAt: null, stopConfirmedAt: null, heldDirectory: expect.any(String) });
  await expect(f.reconcile({ key: "cross-generation", snapshotId: "cross-generation", epoch: 2, keyId: "next-key", items: [item(old.target)] })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: other.id }, data: { executionFenceAt: f.ports.now() } });
  expect(await foreignCall({ operation: "retention", key: "foreign-only" })).toEqual({ safeToDelete: true, pendingDeliveryIds: [], pendingControlKeys: [] });
});

async function actualApp() {
  const f = await fixture(), root = await mkdtemp(join(tmpdir(), "s5-native-app-governance-"));
  let fault: (point: string) => void = () => {};
  let store = new Store(root, point => fault(point));
  cleanup.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const port = new RoutedKernelPort(async (_target, args) => f.call(args), id => readStored<Delivery>("delivery", store.delivery(id)!.envelope).packet.target as Target);
  let app = new RemoteExecutionApp(store, port, () => f.ports.now().getTime());
  const invoke = (name: string, input: Record<string, unknown>, owner = false) => app.handle(name, { input: JSON.stringify(input) }, owner ? { kind: "owner", via: null } : { kind: "kernel" }) as Promise<Record<string, any>>;
  const binding = { version: 1, workspaceId: f.who.workspaceId, ownerId: "owner", app: { moduleId: f.who.moduleId, hash: f.who.hash, activationId: f.who.activationId } };
  await invoke("bind", binding);
  const pairing = await invoke("pairing-create", { version: 1, requestKey: "pairing", deviceId: "device", incarnation: "incarnation", keyId: "key", publicKey: f.publicKey, expiresInMs: 600000 }, true);
  const credential = Buffer.alloc(32, 42).toString("base64url"), auth = { version: 1, requestId: "device", credential, device: pairing.device };
  await invoke("device-pair", { version: 1, requestId: "pair", code: pairing.code, credential, publicKey: f.publicKey });
  await invoke("mapping-set", { version: 1, requestKey: "mapping", projectRef: "project", expectedRevision: 0, device: pairing.device, workspaceRef: "local-alias", baseline: f.baseline, directoryIdentity: "directory", workspaceModes: ["existing", "independent_worktree"] }, true);
  return { ...f, invoke, auth, setFault: (hook: (point: string) => void) => { fault = hook; }, restart: async () => { store.close(); store = new Store(root, point => fault(point)); app = new RemoteExecutionApp(store, port, () => f.ports.now().getTime()); await invoke("bind", binding); } };
}

test("actual app adapter uses native reconciliation, lost revoke ACK replay and native exact cancel with signed drain", async () => {
  const f = await actualApp();
  await f.invoke("device-reconcile", { ...f.auth, snapshotId: "initial", page: 0, complete: true, items: [] });
  expect((await f.invoke("forward", { version: 1 })).pending).toBe(0);
  const admitted = await f.service.admit(f.principal, f.input);
  await f.invoke("sync", { version: 1 }); await f.invoke("forward", { version: 1 });
  const poll = await f.invoke("device-poll", f.auth), launch = poll.messages[0].envelope as Delivery;
  expect(poll.messages).toHaveLength(1); expect(poll.messages[0].localWorkspaceRef).toBe("local-alias");
  await f.invoke("device-revoke", { version: 1, requestKey: "revoke", deviceId: "device", generation: 1 }, true);
  let lost = true;
  f.setFault(point => { if (lost && point === "forward:after-kernel-commit") { lost = false; throw new Error("fake lost native ACK"); } });
  const lostReply = await f.invoke("forward", { version: 1 });
  expect(lost).toBe(false); expect(lostReply.pending).toBe(1);
  await f.restart();
  expect((await f.invoke("forward", { version: 1 })).pending).toBe(0);
  expect(await f.db.executionAuthority.findFirstOrThrow()).toMatchObject({ revokedAt: expect.any(Date) });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  const controls = await f.invoke("device-poll", f.auth);
  expect(controls.messages.some((message: { kind: string }) => message.kind === "control")).toBe(true);
  const target = launch.packet.target as ExecutionDeliveryTarget;
  const report = (kind: string, payload: Record<string, unknown>) => f.invoke("device-report", { ...f.auth, report: { version: 1, requestId: `report-${kind}`, deliveryId: target.deliveryId, launchDigest: target.launchDigest, reportKey: kind === "stop" ? `stop:${digest(payload)}` : kind, kind, payload } });
  await report("final", f.final); await f.invoke("forward", { version: 1 });
  await report("stop", f.proof(target, executionDigest(f.final))); await f.invoke("forward", { version: 1 });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: target.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  expect(await f.db.run.count()).toBe(1);
});

test("actual app cannot replace native missing-journal reconciliation with local readiness", async () => {
  const f = await actualApp();
  const admitted = await f.service.admit(f.principal, f.input);
  await f.invoke("sync", { version: 1 }); await f.invoke("forward", { version: 1 });
  const delivery = await f.db.executionDelivery.findFirstOrThrow();
  // The native packet was offered to the application, but no device journal can
  // account for it. Neither a private relay DB nor restart certifies non-launch.
  await f.invoke("device-reconcile", { ...f.auth, snapshotId: "missing", page: 0, complete: true, items: [] });
  expect((await f.invoke("forward", { version: 1 })).pending).toBe(0);
  const poll = await f.invoke("device-poll", f.auth);
  expect(poll.reconciliationRequired).toBe(true); expect(poll.messages).toHaveLength(0);
  const status = await f.invoke("status", { version: 1 }, true);
  expect(status.devices[0].reconciliationRequired).toBe(true);
  await f.restart();
  expect((await f.invoke("device-poll", f.auth)).messages).toHaveLength(0);
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: admitted.execution.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  expect(await f.call({ operation: "retention", key: "missing-retention" })).toMatchObject({ safeToDelete: false, pendingDeliveryIds: [delivery.id] });
  expect(await f.db.run.count()).toBe(1);
});

test("native readiness requires the durable source frontier and refuses final-with-unknown-stop", async () => {
  const f = await fixture(); await f.service.admit(f.principal, f.input);
  const d = (await f.service.poll(f.who)).deliveries[0]!;
  await f.service.accept(f.who, d.target, "accept");
  await f.service.started(f.who, d.target, "started", { id: "process", scope: "group" });
  await f.service.source(f.who, d.target, "source", [{ sequence: 1, at: f.ports.now().toISOString(), payload: { type: "message", messageId: "m", role: "assistant", text: "durable", complete: true } }]);
  const check = (snapshotId: string, state: string, sourceWatermark: number) => f.reconcile({ key: snapshotId, snapshotId, items: [{ ...item(d.target), state, sourceWatermark }] });
  expect(await check("behind", "running", 0)).toMatchObject({ launchable: false });
  expect(await check("ahead", "running", 2)).toMatchObject({ launchable: false });
  expect(await check("matching", "running", 1)).toMatchObject({ launchable: true });
  expect(await check("regressed", "intent", 1)).toMatchObject({ launchable: false });
  expect(await check("ambiguous", "spawn_possible", 1)).toMatchObject({ launchable: false });
  await f.service.final(f.who, d.target, "final", { ...f.final, throughSourceSeq: 1 });
  expect(await check("final-unknown", "running", 1)).toMatchObject({ launchable: false });
  expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: d.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
});
