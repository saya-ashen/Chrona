import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteExecutionApp } from "./app";
import { Store } from "./store";
import { reserveControl, reserveReport, SOURCE_BYTES } from "./budget";
import { canonical, digest, launchDigest, readStored, type Caller, type Delivery, type DeviceFence, type Launch, type Packet } from "./contracts";
import { publicKey, signedStop, TrustedKernel } from "./harness";
import { RoutedKernelPort } from "./kernel-port";
import { type StorageLimits } from "./storage";

const owner = { kind: "owner", via: null } as const;
const identity = { moduleId: "app", hash: "a".repeat(40), activationId: "active" };
const baseline = { kind: "commit", digest: "b".repeat(40) } as const;
const now = Date.parse("2026-01-01T00:00:00Z");
async function fixture(limits?: StorageLimits) {
  const root = mkdtempSync(join(tmpdir(), "remote-app-liveness-"));
  const kernel = new TrustedKernel(join(root, "kernel.sqlite"));
  let store = new Store(join(root, "app"), undefined, limits);
  const open = () => new RemoteExecutionApp(store, new RoutedKernelPort(kernel.call, id => readStored<Delivery>("delivery", store.delivery(id)!.envelope).packet.target), () => now);
  let app = open(), sequence = 0;
  const call = async (tool: string, value: unknown = { version: 1 }, caller: Caller = { kind: "kernel" }) => await app.handle(tool, { input: JSON.stringify(value) }, caller) as Record<string, unknown>;
  const bind = () => call("bind", { version: 1, workspaceId: "workspace", ownerId: "owner", app: identity });
  await bind();
  const pairing = await call("pairing-create", { version: 1, requestKey: "pairing", deviceId: "device", incarnation: "incarnation", keyId: "key", publicKey, expiresInMs: 600000 }, owner);
  const device = pairing.device as DeviceFence, credential = Buffer.alloc(32, 42).toString("base64url");
  await call("device-pair", { version: 1, requestId: "pair", code: pairing.code, credential, publicKey });
  await call("mapping-set", { version: 1, requestKey: "map", projectRef: "project", expectedRevision: 0, device, workspaceRef: "local", baseline, directoryIdentity: "directory", workspaceModes: ["existing"] }, owner);
  const auth = () => ({ version: 1, requestId: `auth-${++sequence}`, device, credential });
  const packet = (id: string, goal = "run"): Packet => {
    const fence = { workspaceId: "workspace", ownerId: "owner", workId: `work-${id}`, sessionId: `session-${id}`, runId: `run-${id}`, attemptId: `attempt-${id}`, deliveryId: id, callerModuleId: "caller", callerHash: "c".repeat(40), callerActivationId: "caller-active", receiverModuleId: identity.moduleId, receiverHash: identity.hash, receiverActivationId: identity.activationId, authorityId: "authority", subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId };
    const launch: Launch = { fence, placement: { kind: "application", applicationId: identity.moduleId, targetRef: "project", targetRevision: 1, projectRef: "project" }, target: { targetRef: "project", targetRevision: 1, projectRef: "project", directoryIdentity: "directory", baseline, workspaceModes: ["existing"] }, workspaceRef: `workspace-${id}`, workspace: { mode: "existing", baseline }, goal, budget: { timeoutMs: 10000, maxToolCalls: 1, maxModelCalls: 1, maxOutputTokens: 100 }, deadlineAt: new Date(now + 600000).toISOString() };
    return { target: { ...fence, launchDigest: launchDigest(launch) }, launch, launchable: true, controls: [] };
  };
  const offer = async (packet: Packet) => {
    kernel.offer(packet);
    await call("delivery", { version: 1, requestId: `offer-${packet.target.deliveryId}`, deliveryId: packet.target.deliveryId, launchDigest: packet.target.launchDigest, packet });
  };
  const reconcile = async (snapshotId: string, items: unknown[] = []) => {
    await call("device-reconcile", { ...auth(), snapshotId, page: 0, complete: true, items });
    await call("forward");
  };
  return { root, call, auth, packet, offer, reconcile, kernel, get store() { return store; }, async reopen() { store.close(); store = new Store(join(root, "app"), undefined, limits); app = open(); await bind(); }, close() { store.close(); kernel.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("every held claim reaches the journal while old controls remain pending; visits survive restart", async () => {
  const f = await fixture();
  try {
    const packets = [f.packet("one"), f.packet("two"), f.packet("three")];
    for (const p of packets) await f.offer(p);
    for (let i = 0; i < 120; i++) await f.call("control", { version: 1, requestId: `control-${i}`, deliveryId: "one", launchDigest: packets[0]!.target.launchDigest, control: { requestKey: `write-${i}`, operation: "control", payload: { operation: "write", text: "x".repeat(700) } } });
    await f.call("control", { version: 1, requestId: "late-cancel", deliveryId: "one", launchDigest: packets[0]!.target.launchDigest, control: { requestKey: "cancel", operation: "control", payload: { operation: "cancel" } } });
    await f.reconcile("initial");
    const poll = () => f.call("device-poll", f.auth()) as Promise<{ messages: { messageKey: string; kind: string; envelope: Delivery }[] }>;
    const first = await poll();
    expect(first.messages.filter(m => m.kind === "launch").map(m => m.envelope.deliveryId).sort()).toEqual(["one", "three", "two"]);
    const cancelledIdentity = first.messages.find(m => m.kind === "launch" && m.envelope.deliveryId === "one")!.envelope;
    expect(cancelledIdentity.packet.launchable).toBe(false);
    expect(cancelledIdentity.packet.controls[0]!.payload).toEqual({ operation: "cancel" });
    // Cancel closes only its own launch. All remaining held claims arrive even
    // though 90 older controls lead the first batch and none has been ACKed.
    expect(first.messages[0]!.kind).toBe("control");
    const visited = new Set(first.messages.map(m => m.messageKey));
    await f.reopen();
    const second = await poll(); // Controls remain drainable behind the restart barrier.
    expect(second.messages.some(m => !visited.has(m.messageKey))).toBe(true);
    expect(second.messages.some(m => (m.envelope as unknown as { control: { requestKey: string } }).control?.requestKey === "cancel")).toBe(true);
    expect(second.messages.filter(m => m.kind === "launch")).toEqual([]);
    // Simulate losing the first drain-only reply. Only the two launchable
    // identities reached the journal; replaying the cancelled identity remains
    // safe after a complete reconciliation and app restart.
    await f.reconcile("restart", packets.slice(1).map(p => ({ deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, state: "intent", journalSeq: 1, sourceWatermark: 0 })));
    const replay = await poll();
    expect(replay.messages.find(m => m.kind === "launch" && m.envelope.deliveryId === "one")!.envelope.packet).toEqual(cancelledIdentity.packet);
    await expect(f.call("device-poll", { ...f.auth(), device: { ...f.auth().device, generation: 2 } })).rejects.toHaveProperty("code", "fence_mismatch");
  } finally { f.close(); }
});

test("source, gap, final, stop and cancellation retain headroom after aggregate ordinary capacity is exhausted", async () => {
  const f = await fixture();
  try {
    const p = f.packet("source"); await f.offer(p);
    await f.offer(f.packet("other-1")); await f.offer(f.packet("other-2"));
    // Competing retained assignments consume the same device quota. Exhaust
    // ordinary traffic without spending any producer or terminal reservation.
    let filled = 0;
    for (;;) {
      try { f.store.write("pressure", () => reserveReport(f.store, "other-1", 1024, "ordinary")); filled++; }
      catch (error) { expect(error).toHaveProperty("code", "budget_exceeded"); break; }
    }
    expect(filled).toBeGreaterThan(0);
    let sourceBytes = 0, through = 0;
    const report = async (kind: string, payload: Record<string, unknown>, reportKey = kind) => {
      const value = { version: 1, requestId: `report-${++through}`, deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, reportKey, kind, payload };
      const result = await f.call("device-report", { ...f.auth(), report: value });
      return { value, result };
    };
    // One report is enough to expose the old unreserved aggregate quota bug.
    const source = await report("source", { records: [{ sequence: 1, at: new Date(now).toISOString(), payload: { type: "text_delta", messageId: "message", delta: "x".repeat(16000) } }] }, "source:1");
    sourceBytes += Buffer.byteLength(canonical(source.value)); expect(sourceBytes).toBeLessThan(SOURCE_BYTES);
    await report("source", { records: [{ sequence: 2, at: new Date(now).toISOString(), payload: { type: "gap", from: 2, through: 2, reason: "backpressure" } }] }, "source:2");
    const final = { outcome: "failed", error: "bounded producer stopped", throughSourceSeq: 2, baseline, finalMessage: null, missing: true };
    await report("final", final);
    const proof = signedStop({ target: p.target, kind: "never_started", processIdentity: null, finalDigest: (await import("./contracts")).nativeDigest(final), sourceThrough: 2, observedAt: new Date(now).toISOString() });
    await report("stop", proof, `stop:${digest(proof)}`);
    f.store.write("cancel", () => reserveControl(f.store, "source", 1024, true));
    for (let i = 0; i < 5; i++) await f.call("forward");
    expect(f.kernel.db.query<{ settled: number }, [string]>("SELECT settled FROM offers WHERE id=?").get("source")!.settled).toBe(1);
    expect(await f.call("device-report", { ...f.auth(), report: source.value })).toEqual(source.result);
    expect(f.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE channel='kernel' AND acknowledged=0").get()!.n).toBe(0);
  } finally { f.close(); }
});

test("physical page admission exhausts while source, terminal, cancellation and receipts survive restart", async () => {
  const limits = { maxPages: 8192, admissionPages: 256 }, f = await fixture(limits);
  const path = join(f.root, "app/remote-execution.sqlite");
  try {
    const p = f.packet("physical"); await f.offer(p); await f.call("forward");
    const initial = statSync(path);
    // The delivery's committed reserve is an actual SQLite blob, not a byte counter.
    expect(initial.size).toBeGreaterThan(8 * 1024 * 1024);
    expect(initial.blocks * 512).toBeGreaterThanOrEqual(initial.size * 0.95);
    f.store.write("pressure-schema", () => f.store.db.exec("CREATE TABLE physical_pressure(id INTEGER PRIMARY KEY,payload BLOB)"));
    let inserted = 0;
    for (;;) {
      try { f.store.write("physical-pressure", () => f.store.db.query("INSERT INTO physical_pressure(payload) VALUES (zeroblob(4096))").run()); inserted++; }
      catch (error) { expect(error).toHaveProperty("code", "storage_exhausted"); break; }
    }
    expect(inserted).toBeGreaterThan(20);
    expect(f.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM physical_pressure").get()!.n).toBe(inserted);
    // This offer is within the logical device budget and below max_page_count,
    // but its ordinary records cannot consume physical evidence headroom.
    await expect(f.offer(f.packet("rejected"))).rejects.toHaveProperty("code", "storage_exhausted");
    expect(f.store.delivery("rejected")).toBeNull();
    expect(f.store.db.query("SELECT 1 FROM storage_reserves WHERE id='delivery:rejected'").get()).toBeNull();
    const retainedPages = f.store.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
    const report = async (kind: string, payload: Record<string, unknown>, reportKey = kind) => {
      const value = { version: 1, requestId: `physical-${reportKey}`, deliveryId: p.target.deliveryId, launchDigest: p.target.launchDigest, reportKey, kind, payload };
      return { value, receipt: await f.call("device-report", { ...f.auth(), report: value }) };
    };
    for (let sequence = 1; sequence <= 14; sequence++) await report("source", { records: [{ sequence, at: new Date(now).toISOString(), payload: { type: "text_delta", messageId: "message", delta: "x".repeat(16000) } }] }, `source:${sequence}`);
    await report("source", { records: [{ sequence: 15, at: new Date(now).toISOString(), payload: { type: "gap", from: 15, through: 15, reason: "backpressure" } }] }, "source:15");
    const final = { outcome: "failed", error: "physical pressure", throughSourceSeq: 15, baseline, finalMessage: { messageId: "final", text: "x".repeat(24000), truncated: true }, missing: true, changes: { scope: "baseline_to_worktree", status: "partial", reason: "limit", patch: "x".repeat(120000), files: [] } };
    const fixed = await report("final", final);
    for (let i = 0; i < 16; i++) {
      const proof = signedStop({ target: p.target, kind: "never_started", processIdentity: null, finalDigest: (await import("./contracts")).nativeDigest(final), sourceThrough: 15, observedAt: new Date(now + i).toISOString() });
      await report("stop", proof, `stop:${digest(proof)}`);
    }
    await f.call("lifecycle", { version: 1, requestKey: "physical-stop", action: "pause" });
    for (let i = 0; i < 5; i++) await f.call("forward");
    const control = f.store.db.query<{ envelope: string }, []>("SELECT envelope FROM outbox WHERE channel='device' AND kind='control'").get()!;
    const controlKey = (JSON.parse(control.envelope) as { control: { requestKey: string } }).control.requestKey;
    const ack = await report("control-ack", { controlKey }, `ack:${digest([controlKey])}`);
    await f.call("forward");
    expect(f.kernel.db.query<{ settled: number }, [string]>("SELECT settled FROM offers WHERE id=?").get("physical")!.settled).toBe(1);
    // Evidence consumes already allocated pages, without growing the database.
    expect(f.store.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count).toBeLessThanOrEqual(retainedPages);
    await f.reopen();
    expect(await f.call("device-report", { ...f.auth(), report: fixed.value })).toEqual(fixed.receipt);
    expect(await f.call("device-report", { ...f.auth(), report: ack.value })).toEqual(ack.receipt);
    await expect(f.call("device-report", { ...f.auth(), report: { ...fixed.value, payload: { ...final, error: "changed" } } })).rejects.toHaveProperty("code", "conflict");
    expect(f.store.db.query<{ max_page_count: number }, []>("PRAGMA max_page_count").get()!.max_page_count).toBe(limits.maxPages);
    expect(f.store.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()!.journal_mode).toBe("delete");
    expect(statSync(path).size).toBeLessThanOrEqual(limits.maxPages * 4096);
    expect(existsSync(`${path}-wal`)).toBe(false); expect(existsSync(`${path}-journal`)).toBe(false);
    expect(f.store.fenced()).toBe(true);
    expect((await f.call("status", { version: 1 }, owner)).mayDeleteData).toBe(false);
    expect(f.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE channel='kernel' AND acknowledged=0").get()!.n).toBe(0);
  } finally { f.close(); }
}, 20000);
