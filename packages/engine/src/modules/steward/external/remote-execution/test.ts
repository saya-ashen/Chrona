import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteExecutionApp } from "./app";
import { reserveReport } from "./budget";
import { digest, hashSecret, launchDigest, nativeDigest, parseJSON, readStored, validate, type AppFence, type Caller, type Delivery, type DeviceFence, type Launch, type Packet, type Receipt, type Report } from "./contracts";
import { publicKey, signedStop, TrustedKernel } from "./harness";
import { RoutedKernelPort } from "./kernel-port";
import { Store } from "./store";
// @ts-expect-error The installed application test SDK supplies this module.
import { startModule } from "chrona/testing";

const kernelCaller = { kind: "kernel" } as const, owner = { kind: "owner", via: null } as const;
const identity: AppFence = { moduleId: "remote-app", hash: "a".repeat(40), activationId: "activation-1" };
const baseline = { kind: "commit", digest: "c".repeat(40) } as const;
const input = (value: unknown) => ({ input: JSON.stringify(value) });
let requestNumber = 0;
const requestId = () => `request-${++requestNumber}`;
const root = await mkdtemp(join(tmpdir(), "remote-execution-test-"));
let faultAt = "";
const crash = (point: string) => { if (point === faultAt) { faultAt = ""; throw Error(`crash:${point}`); } };
const trusted = new TrustedKernel(join(root, "kernel-fixture.sqlite"));
let store!: Store;
let app: RemoteExecutionApp;
function reopen() {
  store = new Store(join(root, "private"), crash);
  const port = new RoutedKernelPort(trusted.call, id => readStored<Delivery>("delivery", store.delivery(id)!.envelope).packet.target);
  app = new RemoteExecutionApp(store, port, () => Date.parse("2026-01-01T00:00:00Z"));
}
async function call<T = Record<string, unknown>>(tool: string, data: unknown = { version: 1 }, caller: Caller = kernelCaller): Promise<T> {
  return await app.handle(tool, input(data), caller) as T;
}
function packet(device: DeviceFence, suffix = "1"): Packet {
  const fence = { workspaceId: "workspace", ownerId: "owner", workId: `work-${suffix}`, sessionId: `session-${suffix}`, runId: `run-${suffix}`, attemptId: `attempt-${suffix}`, deliveryId: `delivery-${suffix}`, callerModuleId: "caller", callerHash: "b".repeat(40), callerActivationId: "caller-activation", receiverModuleId: identity.moduleId, receiverHash: identity.hash, receiverActivationId: identity.activationId, authorityId: "authority-1", subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId };
  const launch: Launch = { fence, placement: { kind: "application", applicationId: identity.moduleId, targetRef: device.deviceId, targetRevision: 1, projectRef: "project" }, target: { targetRef: device.deviceId, targetRevision: 1, projectRef: "project", directoryIdentity: "directory-1", baseline, workspaceModes: ["existing"] }, workspaceRef: "workspace-ref", workspace: { mode: "existing", baseline }, goal: "Offline bounded fixture", budget: { timeoutMs: 10000, maxToolCalls: 1, maxModelCalls: 1, maxOutputTokens: 100 }, deadlineAt: "2026-01-01T01:00:00Z" };
  return { target: { ...fence, launchDigest: launchDigest(launch) }, launch, launchable: true, controls: [] };
}
try {
  reopen();
  await call("bind", { version: 1, ownerId: "owner", workspaceId: "workspace", app: identity });
  await assert.rejects(call("status", { version: 1 }, { kind: "module", module: "evil", moduleId: "evil", hash: "a" }), { code: "forbidden" });
  await assert.rejects(call("bind", { version: 1, ownerId: "evil", workspaceId: "workspace", app: identity }, owner), { code: "forbidden" });
  const pairingRequest = { version: 1, requestKey: requestId(), deviceId: "device", incarnation: "incarnation-1", expiresInMs: 600000, keyId: "key-1", publicKey };
  const pairing = await call<Receipt & { code: string; device: DeviceFence }>("pairing-create", pairingRequest, owner);
  assert.deepEqual(await call("pairing-create", pairingRequest, owner), pairing);
  const credential = Buffer.alloc(32, 7).toString("base64url");
  const pair = { version: 1, requestId: requestId(), code: pairing.code, publicKey, credential };
  const paired = await call("device-pair", pair);
  assert.deepEqual(await call("device-pair", { ...pair, requestId: requestId() }), paired);
  await assert.rejects(call("device-pair", { ...pair, credential: Buffer.alloc(32, 8).toString("base64url") }), { code: "conflict" });
  const device = pairing.device, auth = { version: 1, device, credential };
  assert.equal(store.device(device.deviceId, device.generation)!.credential_hash, hashSecret(credential));
  await call("mapping-set", { version: 1, requestKey: requestId(), projectRef: "project", expectedRevision: 0, device, workspaceRef: "workspace-ref", baseline, directoryIdentity: "directory-1", workspaceModes: ["existing"] }, owner);
  const p = packet(device); p.launch.workspaceRef = "kernel-workspace-ref"; p.target.launchDigest = launchDigest(p.launch);
  p.controls = [{ requestKey: "write-1", operation: "control", payload: { operation: "write", text: "offline control" } }];
  trusted.offer(p);
  faultAt = "delivery:before-commit";
  await assert.rejects(call("sync"), /crash/);
  assert.equal(store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM deliveries").get()!.n, 0);
  faultAt = "delivery:after-commit";
  await assert.rejects(call("sync"), /crash/);
  await call("sync");
  assert.equal(store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM deliveries").get()!.n, 1);
  await call("sync");
  assert.equal(store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM deliveries").get()!.n, 1);
  assert.equal((await call<{ messages: { kind: string }[] }>("device-poll", { ...auth, requestId: requestId() })).messages.filter(m => m.kind === "launch").length, 0);
  await call("device-reconcile", { ...auth, requestId: requestId(), snapshotId: "initial", page: 0, complete: true, items: [] });
  await call("forward");
  faultAt = "poll:after-commit";
  await assert.rejects(call("device-poll", { ...auth, requestId: requestId() }), /crash/);
  const polled = await call<{ messages: { messageKey: string; localWorkspaceRef: string }[] }>("device-poll", { ...auth, requestId: requestId() });
  assert.equal(polled.messages.length, 2);
  assert.ok(polled.messages.every(message => message.localWorkspaceRef === "workspace-ref"));
  assert.deepEqual((await call<{ messages: unknown[] }>("device-poll", { ...auth, requestId: requestId() })).messages, polled.messages);
  assert.equal(store.db.query<{ offered: number }, []>("SELECT offered FROM outbox WHERE channel='device' AND kind='launch'").get()!.offered, 1);
  const report = (kind: Report["kind"], payload: Record<string, unknown>) => ({ ...auth, requestId: requestId(), report: { version: 1 as const, requestId: requestId(), deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, reportKey: kind === "source" ? `source:${(payload.records as { sequence: number }[])[0]!.sequence}` : kind === "stop" ? `stop:${digest(payload)}` : kind, kind, payload } });
  const controlAck = report("control-ack", { controlKey: "write-1" }); controlAck.report.reportKey = `ack:${digest(["write-1"])}`;
  const ackReceipt = await call("device-report", controlAck); await call("forward");
  assert.deepEqual(await call("device-report", controlAck), ackReceipt);
  assert.equal(store.db.query<{ acknowledged: number }, []>("SELECT acknowledged FROM outbox WHERE channel='device' AND kind='control'").get()!.acknowledged, 1);
  const started = report("started", { id: "process-1", scope: "scope-1" });
  const startedReceipt = await call("device-report", started);
  assert.deepEqual((await call<{ messages: unknown[] }>("device-poll", { ...auth, requestId: requestId() })).messages, []);
  assert.deepEqual(await call("device-report", { ...started, requestId: requestId(), report: { ...started.report, requestId: requestId(), reportKey: started.report.reportKey } }), startedReceipt);
  await assert.rejects(call("device-report", { ...started, report: { ...started.report, payload: { id: "different", scope: "scope-1" } } }), { code: "conflict" });
  await call("forward");
  const modelRequest = { ...auth, requestId: requestId(), deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, key: "model-1", input: {prompt:"offline text",maxOutputTokens:30} };
  const modelReceipt = await call("device-model", modelRequest);
  assert.equal(modelReceipt.status,"completed");
  assert.deepEqual(await call("device-model",{...modelRequest,requestId:requestId()}),modelReceipt);
  await assert.rejects(call("device-model",{...modelRequest,input:{...modelRequest.input,prompt:"different"}}),{code:"conflict"});
  assert.equal(trusted.db.query<{n:number},[]>("SELECT COUNT(*) n FROM receipts WHERE operation='model'").get()!.n,1);
  const source = report("source", { records: [{ sequence: 1, at: "2026-01-01T00:00:00Z", payload: { type: "message", messageId: "message-1", role: "assistant", text: "offline", complete: true } }] });
  faultAt = "report:before-commit";
  await assert.rejects(call("device-report", source), /crash/);
  assert.equal(store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM inbox WHERE scope LIKE 'report:%' AND envelope LIKE '%source%'").get()!.n, 0);
  faultAt = "report:after-commit";
  await assert.rejects(call("device-report", source), /crash/);
  const fixedSource = await call("device-report", source);
  store.close(); reopen();
  await call("bind", { version: 1, ownerId: "owner", workspaceId: "workspace", app: identity });
  assert.deepEqual(await call("device-report", source), fixedSource);
  assert.equal(store.device(device.deviceId, device.generation)!.ready, 0);
  await call("sync");
  await call("device-reconcile", { ...auth, requestId: requestId(), snapshotId: "restart", page: 0, complete: true, items: [{ deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, state: "running", journalSeq: 1, sourceWatermark: 1 }] });
  assert.equal((await call<{ messages: unknown[] }>("device-poll", { ...auth, requestId: requestId() })).messages.length, 0);
  await call("forward");
  faultAt = "forward:after-kernel-commit";
  await call("forward"); // Lost kernel reply: fixed kernel receipt survives; local outbox stays pending.
  const kernelSourceCount = () => trusted.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM receipts WHERE operation='source'").get()!.n;
  assert.equal(kernelSourceCount(), 1); await call("forward"); assert.equal(kernelSourceCount(), 1);
  const finalPayload = { outcome: "finished", error: null, throughSourceSeq: 1, baseline, finalMessage: null, missing: false };
  const finalRequest = report("final", finalPayload);
  const finalReceipt = await call("device-report", finalRequest); await call("forward");
  assert.deepEqual(await call("device-report", { ...finalRequest, requestId: requestId(), report: { ...finalRequest.report, requestId: requestId(), reportKey: finalRequest.report.reportKey } }), finalReceipt);
  await assert.rejects(call("device-report", { ...finalRequest, report: { ...finalRequest.report, payload: { ...finalPayload, outcome: "failed" } } }), { code: "conflict" });
  await assert.rejects(call("device-report", report("source", { records: [{ ...(source.report.payload.records as Record<string, unknown>[])[0], sequence: 2 }] })), { code: "conflict" });
  await assert.rejects(call("device-model", { ...modelRequest, key: "new-after-final" }), { code: "conflict" });
  assert.deepEqual(await call("device-model", modelRequest), modelReceipt, "a fixed earlier model receipt still drains after final");
  assert.equal(trusted.db.query<{ settled: number }, []>("SELECT settled FROM offers").get()!.settled, 0);
  const statement = { target: p.target, kind: "exited", processIdentity: started.report.payload, finalDigest: nativeDigest(finalPayload), sourceThrough: 1, observedAt: "2026-01-01T00:00:00Z" };
  await call("device-report", report("stop", { ...signedStop(statement), signature: "invalid" })); await call("forward");
  assert.equal(trusted.db.query<{ settled: number }, []>("SELECT settled FROM offers").get()!.settled, 0);
  await call("device-report", report("stop", signedStop(statement))); await call("forward");
  assert.equal(trusted.db.query<{ settled: number }, []>("SELECT settled FROM offers").get()!.settled, 1);
  // Cleanup is a fixed preview -> confirm protocol delivered by the kernel.
  const previewDigest = "e".repeat(64);
  trusted.cleanup(p.target.deliveryId, { requestKey: "cleanup-preview", operation: "cleanup", payload: { op: "preview", workId: p.target.workId, commandKey: "cleanup-preview" } });
  await call("sync");
  const cleanupPoll = await call<{ messages: { kind: string; envelope: { control: { operation: string } } }[] }>("device-poll", { ...auth, requestId: requestId() });
  assert.equal(cleanupPoll.messages[0]!.envelope.control.operation, "cleanup");
  const cleanupRequest = report("cleanup", { controlKey: "cleanup-preview", report: { workId: p.target.workId, workspaceRef: p.launch.workspaceRef, state: "retained", reason: "preview retains workspace", previewDigest, operationKey: "cleanup-preview" } });
  cleanupRequest.report.reportKey = `cleanup:${digest(["cleanup-preview"])}`;
  faultAt = "report:after-commit"; await assert.rejects(call("device-report", cleanupRequest), /crash/);
  const previewReceipt = await call("device-report", cleanupRequest); await call("forward");
  assert.deepEqual(await call("device-report", cleanupRequest), previewReceipt);
  trusted.cleanup(p.target.deliveryId, { requestKey: "cleanup-confirm", operation: "cleanup", payload: { op: "confirm", workId: p.target.workId, commandKey: "cleanup-confirm", previewDigest } });
  await call("sync");
  const confirmRequest = report("cleanup", { controlKey: "cleanup-confirm", report: { workId: p.target.workId, workspaceRef: p.launch.workspaceRef, state: "removed", reason: "confirmed exact preview", previewDigest, operationKey: "cleanup-confirm" } });
  confirmRequest.report.reportKey = `cleanup:${digest(["cleanup-confirm"])}`;
  await call("device-report", confirmRequest); await call("forward");
  assert.equal(trusted.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM receipts WHERE operation='cleanup-report'").get()!.n, 2);
  await assert.rejects(call("device-report", { ...confirmRequest, report: { ...confirmRequest.report, payload: { ...confirmRequest.report.payload, report: { ...(confirmRequest.report.payload.report as object), previewDigest: "f".repeat(64) } } } }), { code: "conflict" });
  const status = await call<{ deliveries: { stopState: string }[] }>("status", { version: 1 }, owner);
  assert.equal(status.deliveries[0]!.stopState, "unknown");
  assert.throws(() => store.db.exec("DELETE FROM receipts"), /immutable/);
  assert.throws(() => store.db.exec("DELETE FROM outbox"), /retain/);
  assert.throws(() => store.write("budget", () => reserveReport(store, p.target.deliveryId, 1_048_577, "source")), { code: "budget_exceeded" });
  const revoked = await call("device-revoke", { version: 1, requestKey: requestId(), deviceId: device.deviceId, generation: device.generation }, owner);
  assert.equal(revoked.state, "kernel-revocation-pending");
  assert.equal(store.device(device.deviceId, device.generation)!.state, "revoking");
  await assert.rejects(call("pairing-create", { ...pairingRequest, requestKey: requestId() }, owner), { code: "device_active" });
  await call("forward");
  assert.equal(store.device(device.deviceId, device.generation)!.state, "revoked");
  await assert.rejects(call("device-report", report("source", { records: [{ ...(source.report.payload.records as Record<string, unknown>[])[0], sequence: 2 }] })), { code: "revoked" });
  const generation2 = await call<{ device: DeviceFence }>("pairing-create", { ...pairingRequest, requestKey: requestId() }, owner);
  assert.equal(generation2.device.generation, 2);
  assert.deepEqual(await call("device-report", finalRequest), finalReceipt);
  const lifecycle = await call("lifecycle", { version: 1, requestKey: requestId(), action: "remove" });
  assert.equal(lifecycle.mayDeleteData, false); assert.equal(lifecycle.retained, true);
  assert.ok(store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE kind='cancel' AND acknowledged=0").get()!.n > 0);
  for (const bad of ['{"version":1,"version":1}', '{"version":1,"\\u0076ersion":1}', '{"n":9007199254740992}', '{"x":"\\ud800"}']) assert.throws(() => parseJSON(bad));
  assert.throws(() => parseJSON(' '.repeat(524289)), { code: "too_large" });
  assert.throws(() => validate("device-poll", { ...auth, requestId: "" }));
  assert.throws(() => validate("device-poll", { ...auth, requestId: "   " }));
  assert.throws(() => validate("native-target", { ...p.target, epoch: 0 }));
  assert.throws(() => validate("native-launch", { ...p.launch, deadlineAt: "bad-date" }));
  assert.throws(() => validate("device-poll", { ...auth, requestId: "valid", command: "shell" }));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const bytes = await readFile(join(root, "private", "remote-execution.sqlite"));
  assert.equal(bytes.includes(Buffer.from(credential)), false);

  // Revocation commits locally before I/O. A never-polled delivery cannot
  // launch while offline; native cancel receipts and later polling converge
  // on one immutable device-control envelope.
  const offlineKernel = new TrustedKernel(join(root, "offline-kernel.sqlite"));
  const offlineStore = new Store(join(root, "offline-private"));
  const offlinePort = new RoutedKernelPort(offlineKernel.call, id => readStored<Delivery>("delivery", offlineStore.delivery(id)!.envelope).packet.target);
  const offlineApp = new RemoteExecutionApp(offlineStore, offlinePort, () => Date.parse("2026-01-01T00:00:00Z"));
  const oc = async (tool: string, value: unknown, caller: Caller = kernelCaller) => await offlineApp.handle(tool, input(value), caller) as Record<string, unknown>;
  try {
    await oc("bind", { version: 1, workspaceId: "workspace", ownerId: "owner", app: identity });
    const paired = await oc("pairing-create", { ...pairingRequest, requestKey: "offline-pairing", deviceId: "offline-device" }, owner);
    const od = paired.device as DeviceFence, oa = { version: 1, requestId: "offline-auth", device: od, credential };
    await oc("device-pair", { ...pair, code: paired.code });
    await oc("mapping-set", { version: 1, requestKey: "offline-map", projectRef: "project", expectedRevision: 0, device: od, workspaceRef: "workspace-ref", baseline, directoryIdentity: "directory-1", workspaceModes: ["existing"] }, owner);
    offlineKernel.offer(packet(od, "offline")); await oc("sync", { version: 1 }); await oc("forward", { version: 1 });
    await oc("device-reconcile", { ...oa, snapshotId: "offline-snapshot", page: 0, complete: true, items: [] }); await oc("forward", { version: 1 });
    assert.equal(offlineStore.device(od.deviceId, od.generation)!.ready, 1);
    await oc("device-revoke", { version: 1, requestKey: "offline-revoke", deviceId: od.deviceId, generation: od.generation }, owner);
    assert.deepEqual((await oc("device-poll", oa)).messages, []);
    await oc("forward", { version: 1 });
    assert.equal(offlineStore.device(od.deviceId, od.generation)!.state, "revoked");
    const count = () => offlineStore.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE channel='device' AND kind='control'").get()!.n;
    assert.equal(count(), 1);
    await oc("sync", { version: 1 }); assert.equal(count(), 1, "native poll must replay the same cancel envelope");
    const messages = (await oc("device-poll", oa)).messages as { kind: string }[];
    assert.ok(messages.every(message => message.kind === "control"));
    assert.equal(offlineStore.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE channel='device' AND kind='launch' AND offered=1").get()!.n, 0);
  } finally { offlineStore.close(); offlineKernel.close(); }

  // Accepted-before-first-poll restart is safe; an offered launch missing from
  // the next complete journal is quarantined rather than retried.
  const recoveryKernel = new TrustedKernel(join(root, "recovery-kernel.sqlite"));
  let recoveryStore = new Store(join(root, "recovery-private"));
  const recoveryPort = () => new RoutedKernelPort(recoveryKernel.call, id => readStored<Delivery>("delivery", recoveryStore.delivery(id)!.envelope).packet.target);
  let recoveryApp = new RemoteExecutionApp(recoveryStore, recoveryPort(), () => Date.parse("2026-01-01T00:00:00Z"));
  const rc = async (tool: string, value: unknown, caller: Caller = kernelCaller) => await recoveryApp.handle(tool, input(value), caller) as Record<string, unknown>;
  const rbind = () => rc("bind", { version: 1, workspaceId: "workspace", ownerId: "owner", app: identity });
  try {
    await rbind();
    const pairing = await rc("pairing-create", { ...pairingRequest, requestKey: "recovery-pairing" }, owner);
    const rd = pairing.device as DeviceFence, ra = { version: 1, requestId: "recovery-auth", device: rd, credential };
    await rc("device-pair", { ...pair, code: pairing.code });
    await rc("mapping-set", { version: 1, requestKey: "recovery-map", projectRef: "project", expectedRevision: 0, device: rd, workspaceRef: "workspace-ref", baseline, directoryIdentity: "directory-1", workspaceModes: ["existing"] }, owner);
    const rp = packet(rd, "recovery"); recoveryKernel.offer(rp);
    await rc("sync", { version: 1 }); await rc("forward", { version: 1 });
    recoveryStore.close(); recoveryStore = new Store(join(root, "recovery-private"));
    recoveryApp = new RemoteExecutionApp(recoveryStore, recoveryPort(), () => Date.parse("2026-01-01T00:00:00Z")); await rbind();
    await rc("sync", { version: 1 });
    await rc("device-reconcile", { ...ra, snapshotId: "before-first-poll", page: 0, complete: true, items: [] });
    await rc("forward", {version:1});
    assert.equal(((await rc("device-poll", ra)).messages as unknown[]).length, 1);
    assert.equal(recoveryStore.db.query<{ offered: number }, []>("SELECT offered FROM outbox WHERE channel='device' AND kind='launch'").get()!.offered, 1);
    recoveryStore.close(); recoveryStore = new Store(join(root, "recovery-private"));
    recoveryApp = new RemoteExecutionApp(recoveryStore, recoveryPort(), () => Date.parse("2026-01-01T00:00:00Z")); await rbind();
    await rc("sync", { version: 1 });
    const missing = await rc("device-reconcile", { ...ra, snapshotId: "missing-after-offer", page: 0, complete: true, items: [] });
    assert.deepEqual(missing.missing, [rp.target.deliveryId]);
    assert.deepEqual((await rc("device-poll", ra)).messages, []);
    // Lifecycle must not wait behind a stalled forwarding call.
    let release!: (value: unknown) => void;
    const port = recoveryPort(); let blockOnce = true;
    recoveryApp = new RemoteExecutionApp(recoveryStore, { poll: () => port.poll(), deliver: request => {
      const receipt = { version: 1, key: request.key, requestDigest: request.requestDigest, state: "pending" };
      if (!blockOnce) return Promise.resolve(receipt);
      blockOnce = false; return new Promise(resolve => { release = () => resolve(receipt); });
    } });
    await rbind();
    const pending = rc("forward", { version: 1 }); await Promise.resolve();
    const fenced = await rc("lifecycle", { version: 1, requestKey: "concurrent-lifecycle", action: "pause" });
    assert.equal(fenced.mayDeleteData, false); release(undefined); await pending;
    assert.equal(recoveryStore.fenced(), true);
    recoveryStore.close(); recoveryStore = new Store(join(root, "recovery-private"));
    recoveryApp = new RemoteExecutionApp(recoveryStore, recoveryPort()); await rbind();
    assert.equal(recoveryStore.fenced(), true, "same activation cannot clear a lifecycle fence");
    recoveryStore.close(); recoveryStore = new Store(join(root, "recovery-private"));
    recoveryApp = new RemoteExecutionApp(recoveryStore, recoveryPort());
    await rc("bind", { version: 1, workspaceId: "workspace", ownerId: "owner", app: { ...identity, activationId: "activation-after-trusted-resume" } });
    assert.equal(recoveryStore.fenced(), false);
    assert.equal(recoveryStore.device(rd.deviceId, rd.generation)!.ready, 0);
    assert.deepEqual((await rc("device-poll", ra)).messages, []);
  } finally { recoveryStore.close(); recoveryKernel.close(); }

  // Actual SDK subprocess -> authenticated loopback -> routed native adapter ->
  // SQLite/signature fixture. It never returns an unconditional mock success.
  const saved = { module: process.env.CHRONA_MODULE, data: process.env.CHRONA_DATA, content: process.env.CHRONA_CONTENT };
  process.env.CHRONA_MODULE = import.meta.dirname; process.env.CHRONA_DATA = join(root, "sdk-private"); process.env.CHRONA_CONTENT = join(root, "sdk-content");
  const child = await startModule(join(import.meta.dirname, "index.ts"), { stubs: { "runtime-callback.remote-delivery": (args: Record<string, unknown>) => trusted.call("runtime-callback.remote-delivery", args) } });
  try {
    const send = async (id: string, data: unknown, caller: Caller = kernelCaller) => {
      const reply = await child.send({ trigger: { kind: "tool", id, args: input(data), caller, firedAt: "2026-01-01T00:00:00Z" }, now: "2026-01-01T00:00:00Z", params: {} });
      assert.equal(reply.error, undefined); return reply.result!.result as Record<string, unknown>;
    };
    assert.equal((await send("bind", { version: 1, workspaceId: "workspace", ownerId: "owner", app: identity })).state, "bound");
    assert.equal((await send("status", { version: 1 }, owner)).state, "observed");
    assert.equal((await send("sync", { version: 1 })).state, "synchronized");
    const sdkPair = await send("pairing-create", { ...pairingRequest, deviceId: "sdk-device", requestKey: "sdk-pairing" }, owner);
    const sdkDevice = sdkPair.device as DeviceFence;
    await send("device-pair", { ...pair, code: sdkPair.code, requestId: "sdk-pair" });
    const sdkAuth = { version: 1, requestId: "sdk-wire", device: sdkDevice, credential };
    await send("mapping-set", { version: 1, requestKey: "sdk-map", projectRef: "project", expectedRevision: 0, device: sdkDevice, workspaceRef: "workspace-ref", baseline, directoryIdentity: "directory-1", workspaceModes: ["existing"] }, owner);
    const sdkPacket = packet(sdkDevice, "sdk"); sdkPacket.launch.deadlineAt = new Date(Date.now() + 60000).toISOString(); sdkPacket.target.launchDigest = launchDigest(sdkPacket.launch); trusted.offer(sdkPacket);
    await send("device-reconcile", { ...sdkAuth, snapshotId: "sdk-initial", page: 0, complete: true, items: [] });
    assert.equal((await send("device-poll", sdkAuth)).messages instanceof Array, true);
    const sdkPoll = await send("device-poll", sdkAuth); assert.equal((sdkPoll.messages as unknown[]).length, 1);
    const sdkReport = (kind: Report["kind"], payload: Record<string, unknown>) => ({ ...sdkAuth, report: { version: 1, requestId: requestId(), deliveryId: sdkPacket.target.deliveryId, launchDigest: sdkPacket.target.launchDigest, reportKey: kind === "stop" ? `stop:${digest(payload)}` : kind, kind, payload } });
    const sdkProcess = { id: "sdk-process", scope: "sdk-scope" };
    await send("device-report", sdkReport("started", sdkProcess)); await send("forward", { version: 1 });
    const sdkFinal = { ...finalPayload, throughSourceSeq: 0 };
    await send("device-report", sdkReport("final", sdkFinal)); await send("forward", { version: 1 });
    await send("device-report", sdkReport("stop", signedStop({ target: sdkPacket.target, kind: "exited", processIdentity: sdkProcess, finalDigest: nativeDigest(sdkFinal), sourceThrough: 0, observedAt: new Date().toISOString() }))); await send("forward", { version: 1 });
    assert.equal(trusted.db.query<{ settled: number }, []>("SELECT settled FROM offers WHERE id='delivery-sdk'").get()!.settled, 1);
    const callsBefore = child.calls.length;
    const rejected = await child.send({ trigger: { kind: "tool", id: "device-poll", args: input({ ...auth, credential: Buffer.alloc(32, 9).toString("base64url"), requestId: "invalid-auth" }), caller: kernelCaller, firedAt: "2026-01-01T00:00:00Z" }, now: "2026-01-01T00:00:00Z", params: {} });
    assert.ok(rejected.error); assert.equal(child.calls.length, callsBefore);
  } finally {
    await child.stop();
    for (const [env, value] of [["CHRONA_MODULE", saved.module], ["CHRONA_DATA", saved.data], ["CHRONA_CONTENT", saved.content]]) { if (value === undefined) delete process.env[env!]; else process.env[env!] = value; }
  }
  console.log("remote-execution: durable SQLite, crash/replay, native forwarding, signed stop, generation/revoke, lifecycle and SDK tools passed");
} finally { store!.close(); trusted.close(); await rm(root, { recursive: true, force: true }); }
