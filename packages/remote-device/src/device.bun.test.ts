import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createHash, verify } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executionDeliveryFinalSchema, executionSignedStopSchema, executionDeliverySourceSchema } from "@chrona/contracts/steward";
import { privateRoot } from "@chrona/git-workspaces";
import { PROMPT_PROTOCOL, type ModelInput } from "@chrona/remote-model";
import { initializeConfig, loadConfig, localMapping, localPi, saveConfig, type DeviceConfig } from "./config";
import { RemoteDevice } from "./device";
import { MODEL_GATEWAY_GAP, kernelPiDriver, supervisedProcessDriver, type LaunchDriver } from "./driver";
import { DeviceDirectoryLock, Journal } from "./journal";
import { appDigest, executionDigest, stopProof, validateDelivery, type Delivery, type Report } from "./protocol";
import { DeviceHTTP, DeviceHTTPError, type SnapshotItem, type Transport } from "./transport";
// Integration-only imports exercise the real application contract/SQLite relay.
// The standalone CLI/build has no engine, app, server or test dependency.
import { RemoteExecutionApp } from "../../../.generated/applications/remote-execution/app";
import { Store } from "../../../.generated/applications/remote-execution/store";
import { canonical, nativeDigest, type KernelDeliveryPort, type KernelRequest, type Packet } from "../../../.generated/applications/remote-execution/contracts";

let helperRoot: string, helper: string;
const cleanup: (() => Promise<void> | void)[] = [];
beforeAll(() => {
  helperRoot = realpathSync(mkdtempSync(join(tmpdir(), "chrona-device-helper-"))); helper = join(helperRoot, "guardian");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/process"))), "..");
  const result = spawnSync(process.env.CC ?? "cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", join(packageRoot, "native/guardian.c"), "-o", helper], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr); chmodSync(helper, 0o700);
});
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
afterAll(() => rmSync(helperRoot, { recursive: true, force: true }));
const callArgs = (input: unknown) => ({ input: JSON.stringify(input) });
const receiver = { moduleId: "remote-app", hash: "a".repeat(40), activationId: "activation" };

/** Independently checks exact kernel statement bytes, final and contiguous source.
 * This fixture is deliberately offline and does not claim real kernel admission.
 */
class KernelFixture implements KernelDeliveryPort {
  packet: Packet | null = null;
  settled = false;
  reports: Report[] = [];
  source = 0;
  identity: unknown = null;
  final: unknown = null;
  modelRequests: { key: string; input: ModelInput }[] = [];
  modelReplies = new Map<string, unknown>();
  modelPending = false;
  modelAnswer: (input: ModelInput) => unknown = () => ({ version: 1, content: "offline", tool_calls: [] });
  constructor(readonly publicKey: string) {}
  async poll() { return { deliveries: this.packet && !this.settled ? [this.packet] : [] }; }
  async deliver(request: KernelRequest) {
    if (request.operation === "model") {
      const payload = request.payload as unknown as { deliveryId: string; launchDigest: string; key: string; input: ModelInput };
      if (!this.packet || payload.deliveryId !== this.packet.target.deliveryId || payload.launchDigest !== this.packet.target.launchDigest || !this.identity) throw new Error("Fixture model target/start mismatch");
      let result = this.modelReplies.get(payload.key);
      if (!result) {
        if (this.modelRequests.length >= this.packet.launch.budget.maxModelCalls || payload.input.maxOutputTokens > this.packet.launch.budget.maxOutputTokens) throw new Error("Fixture trusted model budget exceeded");
        this.modelRequests.push({ key: payload.key, input: payload.input });
        result = this.modelPending ? { status: "pending", reservationId: `fixture-reservation-${this.modelRequests.length}` }
          : { status: "completed", reservationId: `fixture-reservation-${this.modelRequests.length}`, result: { text: JSON.stringify(this.modelAnswer(payload.input)), inputTokens: null, outputTokens: null } };
        this.modelReplies.set(payload.key, result);
      }
      return { version: 1, key: request.key, requestDigest: request.requestDigest, state: "recorded", result };
    }
    if (request.operation === "report") {
      const report = request.payload as unknown as Report;
      if (!this.packet || report.deliveryId !== this.packet.target.deliveryId || report.launchDigest !== this.packet.target.launchDigest) throw new Error("Fixture target mismatch");
      if (!this.reports.some(item => item.reportKey === report.reportKey)) {
        if (report.kind === "cleanup" && (!this.settled || (report.payload.report as { operationKey: string }).operationKey !== report.payload.controlKey)) throw new Error("Fixture cleanup requires verified stop/exact command");
        if (report.kind === "started") this.identity = report.payload;
        if (report.kind === "source") { const records = executionDeliverySourceSchema.parse(report.payload.records); let through = this.source; for (const item of records) if (item.sequence !== ++through) throw new Error("Fixture source order mismatch"); this.source = through; }
        if (report.kind === "final") { this.final = executionDeliveryFinalSchema.parse(report.payload); if ((this.final as { throughSourceSeq: number }).throughSourceSeq !== this.source) throw new Error("Fixture final source mismatch"); }
        if (report.kind === "stop") {
          const proof = executionSignedStopSchema.parse(report.payload);
          if (canonical(proof.statement.target) !== canonical(this.packet.target) || proof.statement.finalDigest !== nativeDigest(this.final) || proof.statement.sourceThrough !== this.source || canonical(proof.statement.processIdentity) !== canonical(this.identity) || !verify(null, Buffer.from(nativeDigest(proof.statement), "hex"), this.publicKey, Buffer.from(proof.signature, "base64"))) throw new Error("Fixture rejected stop signature/fences/final");
          this.settled = true;
        }
        this.reports.push(report);
      }
    }
    // This is the fixture's explicit trusted reconciliation decision. The real
    // application's readiness barrier must wait for this authoritative receipt.
    if (request.operation === "reconcile" && request.payload.complete) {
      const missing = request.payload.missing as unknown[];
      return { version: 1, key: request.key, requestDigest: request.requestDigest, state: "reconciled", result: { recorded: true, reconciled: missing.length === 0, missing, launchable: missing.length === 0 } };
    }
    return { version: 1, key: request.key, requestDigest: request.requestDigest, state: ["revoke", "cancel"].includes(request.operation) ? "pending" : "recorded" };
  }
}
function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Device fixture", "-c", "user.email=device@example.invalid", ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim();
}
async function fixture(mode: "existing" | "independent_worktree" = "existing") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "chrona-remote-device-test-"))), root = join(base, "device"), project = join(base, "project");
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const store = new Store(join(base, "app")); cleanup.push(() => store.close());
  let offline = false, dropReport: string | null = null, rewriteReceipt = false;
  const failedOperations = new Set<string>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (offline) return Response.json({ code: "REMOTE_EXECUTION_UNAVAILABLE" }, { status: 503 });
    const operation = new URL(request.url).pathname.split("/").at(-1)!;
    if (failedOperations.has(operation)) return new Response("unavailable", { status: 503 });
    const body = await request.json() as Record<string, unknown>;
    if (["credential", "ownerId", "caller", "workspaceId", "receiver", "app"].some(key => Object.hasOwn(body, key))) return new Response("forbidden field", { status: 400 });
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return new Response("auth", { status: 403 });
    const args = callArgs({ ...body, credential: match[1] });
    try {
      if (operation === "poll" || operation === "reconcile") {
        app.authorizeDevice(`device-${operation}`, args);
        await app.handle("sync", callArgs({ version: 1 }), { kind: "kernel" });
        // The real app prioritizes terminal/control traffic. Drive retries too:
        // a proof offered ahead of its sources stays pending until they arrive.
        for (let pass = 0; pass < 4; pass++) await app.handle("forward", callArgs({ version: 1 }), { kind: "kernel" });
      }
      const result = await app.handle(`device-${operation}`, args, { kind: "kernel" });
      if (operation === "report" && (body.report as Report).kind === dropReport) { dropReport = null; return new Response("reply lost after commit", { status: 503 }); }
      return Response.json(rewriteReceipt && operation !== "poll" ? { ...result as object, requestDigest: "0".repeat(64) } : result);
    } catch (error) { return Response.json({ code: error instanceof Error ? error.message : "error" }, { status: 409 }); }
  } }); cleanup.push(() => server.stop(true));
  const config = initializeConfig(root, server.url.origin, "device");
  const kernel = new KernelFixture(config.publicKey), app = new RemoteExecutionApp(store, kernel);
  await app.handle("bind", callArgs({ version: 1, workspaceId: "workspace", ownerId: "owner", app: receiver }), { kind: "kernel" });
  const pairing = await app.handle("pairing-create", callArgs({ version: 1, requestKey: "pair", deviceId: config.deviceId, incarnation: config.incarnation, keyId: config.keyId, publicKey: config.publicKey, expiresInMs: 600000 }), { kind: "owner", via: null }) as { code: string };
  const paired = await new DeviceHTTP(config.server, config.credential, null).pair(pairing.code, config.publicKey, "pair-device");
  config.device = paired.device; saveConfig(root, config);
  git(base, ["init", "-q", project]); writeFileSync(join(project, "file.txt"), "baseline"); git(project, ["add", "."]); git(project, ["commit", "-qm", "fixture"]);
  const baseline = { kind: "commit" as const, digest: git(project, ["rev-parse", "HEAD"]) };
  const mapping = localMapping({ workspaceRef: "local-alias", targetRef: "opaque-target", targetRevision: 1, projectRef: "project", path: project, baseline, workspaceModes: [mode] });
  config.mappings = [mapping]; saveConfig(root, config);
  await app.handle("mapping-set", callArgs({ version: 1, requestKey: "map", projectRef: "project", device: config.device, workspaceRef: "local-alias", baseline, directoryIdentity: mapping.directoryIdentity, workspaceModes: mapping.workspaceModes, expectedRevision: 0 }), { kind: "owner", via: null });
  const fence = { workspaceId: "workspace", ownerId: "owner", workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", deliveryId: "delivery", callerModuleId: "coding", callerHash: "b".repeat(40), callerActivationId: "caller-activation", receiverModuleId: receiver.moduleId, receiverHash: receiver.hash, receiverActivationId: receiver.activationId, authorityId: "authority", subjectId: config.deviceId, epoch: config.device!.generation, keyId: config.keyId };
  const launch = { fence, placement: { kind: "application" as const, applicationId: receiver.moduleId, targetRef: mapping.targetRef, targetRevision: mapping.targetRevision, projectRef: mapping.projectRef }, target: { targetRef: mapping.targetRef, targetRevision: mapping.targetRevision, projectRef: mapping.projectRef, directoryIdentity: mapping.directoryIdentity, baseline, workspaceModes: mapping.workspaceModes }, workspaceRef: "kernel-workspace", workspace: { mode, baseline }, goal: "Offline deterministic process fixture", budget: { timeoutMs: 30000, maxToolCalls: 1, maxModelCalls: 1, maxOutputTokens: 1 }, deadlineAt: new Date(Date.now() + 60000).toISOString() };
  const packet: Packet = { target: { ...fence, launchDigest: nativeDigest(launch) }, launch, launchable: true, controls: [] };
  const delivery: Delivery = { version: 1, requestId: "offer", deliveryId: fence.deliveryId, launchDigest: packet.target.launchDigest, packet: packet as Delivery["packet"] };
  const transport = new DeviceHTTP(config.server, config.credential, config.device);
  const open = (driver?: LaunchDriver, deviceTransport: Transport = transport) => { const device = new RemoteDevice(root, config, deviceTransport, driver); cleanup.push(() => device.close()); return device; };
  return { base, root, config, app, store, kernel, packet, delivery, transport, open, offline: (value: boolean) => { offline = value; }, drop: (kind: string) => { dropReport = kind; }, badReceipt: (value: boolean) => { rewriteReceipt = value; }, fail: (operation: string, value: boolean) => { if (value) failedOperations.add(operation); else failedOperations.delete(operation); } };
}
async function until(predicate: () => boolean) { for (let i = 0; i < 200; i++) { if (predicate()) return; await Bun.sleep(10); } throw new Error("Fixture condition timed out"); }
function processDriver(script: string) { return supervisedProcessDriver({ file: "/bin/sh", args: ["-c", script], helperPath: helper, env: { PATH: process.env.PATH, LANG: "C.UTF-8" } }); }
function reports(journal: Journal): Report[] { return journal.db.query<{ envelope: string }, []>("SELECT envelope FROM outbox ORDER BY id").all().map(row => JSON.parse(row.envelope) as Report); }

test("production refuses unsafe Pi launch through actual app loopback; signed never_started reaches independent verifier", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const device = f.open(); await device.tick(); await device.tick();
  const final = f.kernel.reports.find(report => report.kind === "final")!;
  expect(final.payload.outcome).toBe("unavailable"); expect(final.payload.error).toBe(MODEL_GATEWAY_GAP);
  expect(f.kernel.identity).toBeNull(); expect(f.kernel.settled).toBe(true);
  const stop = executionSignedStopSchema.parse(f.kernel.reports.find(report => report.kind === "stop")!.payload);
  expect(stop.statement.kind).toBe("never_started"); expect(stop.statement.processIdentity).toBeNull();
  expect(device.journal.get("delivery")!.state).toBe("stopped"); expect(device.journal.pending()).toEqual([]);
  expect(reports(device.journal)).toHaveLength(2); // app custody ack never destroys local evidence
  expect(statSync(join(f.root, "config.json")).mode & 0o777).toBe(0o600);
  expect(statSync(join(f.root, "journal.sqlite")).mode & 0o777).toBe(0o600);
});

test("real public Pi native launch survives disconnect, cancels escaped descendant, and emits exact signed stop plus durable control ack", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const device = f.open(processDriver("setsid sleep 60 & echo child:$!; echo ready; wait"));
  await device.tick();
  await until(() => reports(device.journal).some(report => report.kind === "source" && JSON.stringify(report.payload).includes("ready")));
  const output = reports(device.journal).filter(report => report.kind === "source").map(report => (report.payload.records as { payload: { delta: string } }[]).map(record => record.payload.delta).join("")).join("");
  const pid = Number(/child:(\d+)/.exec(output)![1]); expect(existsSync(`/proc/${pid}`)).toBe(true);
  f.offline(true); await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  expect(device.journal.get("delivery")!.state).toBe("running"); expect(existsSync(`/proc/${pid}`)).toBe(true);
  const control = { requestKey: "cancel", operation: "control" as const, payload: { operation: "cancel" as const } }; f.packet.controls.push(control);
  await f.app.handle("control", callArgs({ version: 1, requestId: "cancel", deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
  f.offline(false); f.drop("control-ack"); await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  expect(device.journal.get("delivery")!.state).toBe("stopped"); expect(existsSync(`/proc/${pid}`)).toBe(false);
  expect(device.journal.pending().some(item => item.report.kind === "control-ack")).toBe(true);
  await device.tick(); await device.tick();
  expect(f.kernel.settled).toBe(true);
  const stop = executionSignedStopSchema.parse(f.kernel.reports.find(report => report.kind === "stop")!.payload);
  expect(stop.statement.kind).toBe("exited"); expect(stop.statement.processIdentity?.scope).toBe("descendants");
  expect(stop.statement.sourceThrough).toBeGreaterThan(0);
  expect(f.kernel.reports.find(report => report.kind === "final")!.payload.outcome).toBe("cancelled");
  expect(f.kernel.reports.filter(report => report.kind === "control-ack")).toHaveLength(1);
  expect(device.journal.pending()).toEqual([]); expect(reports(device.journal).some(report => report.kind === "source")).toBe(true);
}, 15000);

test("lost final reply retries identical durable report after restart, without process replay", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  let launches = 0;
  const baseDriver = processDriver("echo completed; exit 0"), driver: LaunchDriver = { availability: baseDriver.availability, launch(input) { launches++; return baseDriver.launch(input); } };
  let device = f.open(driver); await device.tick(); await device.idle();
  f.drop("final"); await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  const retained = device.journal.pending().find(item => item.report.kind === "final")!.report;
  await device.close(); device = f.open(driver); await device.tick(); await device.tick();
  expect(launches).toBe(1); expect(f.kernel.settled).toBe(true);
  expect(reports(device.journal).find(report => report.kind === "final")).toEqual(retained);
  expect(f.kernel.reports.find(report => report.kind === "final")!.payload.outcome).toBe("finished");
});

for (const boundary of ["spawn_possible", "running"] as const) test(`restart ${boundary} stays unknown, retains locks and never replays or signs a stop`, async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const journal = new Journal(f.root); journal.bind(f.config.device); journal.accept(f.delivery, "local-alias"); journal.transition("delivery", "spawn_possible");
  if (boundary === "running") journal.transition("delivery", "running", { id: "old-process", scope: "descendants" }); journal.close();
  let launches = 0;
  const device = f.open({ availability: () => ({ available: true }), launch() { launches++; throw new Error("Must never launch"); } });
  await device.tick(); expect(launches).toBe(0); expect(device.journal.get("delivery")!.state).toBe("unknown");
  expect(reports(device.journal)).toEqual([]); expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(2);
  const altered = structuredClone(f.delivery); altered.deliveryId = "replacement"; altered.packet.launch.fence.deliveryId = altered.deliveryId; altered.packet.target.deliveryId = altered.deliveryId; altered.launchDigest = altered.packet.target.launchDigest = executionDigest(altered.packet.launch);
  expect(() => device.journal.accept(altered, "local-alias")).toThrow();
  expect(f.kernel.settled).toBe(false);
});

test("restarted intent produces never_started before reconciliation, and directory lock prevents a second owner", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const journal = new Journal(f.root); journal.bind(f.config.device); journal.accept(f.delivery, "local-alias"); journal.close();
  const device = f.open(); expect(() => f.open()).toThrow("already in use");
  await device.tick(); expect(device.journal.get("delivery")!.state).toBe("stopped");
  expect(executionSignedStopSchema.parse(reports(device.journal).find(report => report.kind === "stop")!.payload).statement.kind).toBe("never_started");
});

test("all exact launch/caller/receiver/authority fences are checked, and signature binds final and source watermark", async () => {
  const f = await fixture();
  expect(executionDigest(f.packet.launch)).toBe(nativeDigest(f.packet.launch));
  expect(appDigest({ Z: 1, a: 2, _b: 3 })).toBe(createHash("sha256").update(canonical({ Z: 1, a: 2, _b: 3 })).digest("hex"));
  for (const field of Object.keys(f.delivery.packet.target)) {
    const changed = structuredClone(f.delivery), target = changed.packet.target as Record<string, unknown>;
    target[field] = typeof target[field] === "number" ? Number(target[field]) + 1 : `changed-${target[field]}`;
    expect(() => validateDelivery(changed, f.config.device!)).toThrow();
  }
  const journal = new Journal(f.root); journal.bind(f.config.device); journal.accept(f.delivery, "local-alias");
  const changed = structuredClone(f.delivery); changed.packet.launch.fence.callerActivationId = "new-caller"; changed.packet.target.callerActivationId = "new-caller"; changed.launchDigest = changed.packet.target.launchDigest = executionDigest(changed.packet.launch);
  expect(() => journal.accept(changed, "local-alias")).toThrow("immutable"); journal.close();
  f.kernel.packet = f.packet; const device = f.open(); await device.tick();
  const proof = executionSignedStopSchema.parse(reports(device.journal).find(report => report.kind === "stop")!.payload);
  for (const mutation of [{ ...proof.statement, sourceThrough: 100 }, { ...proof.statement, finalDigest: "0".repeat(64) }, { ...proof.statement, target: { ...proof.statement.target, receiverActivationId: "changed" } }]) expect(verify(null, Buffer.from(nativeDigest(mutation), "hex"), f.config.publicKey, Buffer.from(proof.signature, "base64"))).toBe(false);
  expect(verify(null, Buffer.from(JSON.stringify(proof.statement)), f.config.publicKey, Buffer.from(proof.signature, "base64"))).toBe(false);
});

test("bad acknowledgment cannot discard outbox or open the launch barrier", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const device = f.open(); f.badReceipt(true); await expect(device.tick()).rejects.toThrow("receipt mismatch");
  expect(device.journal.attempts()).toEqual([]);
  const g = await fixture(); g.kernel.packet = g.packet;
  const other = g.open(); await other.tick(); g.badReceipt(true);
  const final = reports(other.journal).find(report => report.kind === "final")!;
  other.journal.db.query("UPDATE outbox SET receipt=NULL WHERE report_key=?").run(final.reportKey);
  expect(other.journal.pending()).toHaveLength(1);
  await expect(other.flush()).rejects.toThrow("receipt mismatch"); expect(other.journal.pending().find(item => item.report.kind === "final")!.report).toEqual(final);
});

test("config rejects shared permissions, identity/key mutation and non-loopback plaintext origins", async () => {
  const f = await fixture();
  chmodSync(join(f.root, "config.json"), 0o644); expect(() => loadConfig(f.root)).toThrow("permissions"); chmodSync(join(f.root, "config.json"), 0o600);
  expect(() => new DeviceHTTP("http://example.invalid", f.config.credential, f.config.device)).toThrow("HTTPS");
  const config = JSON.parse(readFileSync(join(f.root, "config.json"), "utf8")) as DeviceConfig; config.keyId = "changed"; saveConfig(f.root, config); expect(() => loadConfig(f.root)).toThrow("identity");
  const lock = new DeviceDirectoryLock(f.root); expect(() => new DeviceDirectoryLock(f.root)).toThrow("already in use"); lock.close();
});

for (const blocked of ["report", "reconcile"]) test(`cancellation still drains while ${blocked} fails; failed reconciliation cannot admit new launches`, async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const device = f.open(processDriver("echo ready; sleep 60")); await device.tick();
  await until(() => reports(device.journal).some(report => report.kind === "source"));
  const control = { requestKey: "cancel-during-failure", operation: "control" as const, payload: { operation: "cancel" as const } };
  await f.app.handle("control", callArgs({ version: 1, requestId: "control", deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
  if (blocked === "reconcile") f.store.db.exec("UPDATE devices SET ready=0");
  f.fail(blocked, true); await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  expect(device.journal.get("delivery")!.state).toBe("stopped");
  expect(reports(device.journal).find(report => report.kind === "final")!.payload.outcome).toBe("cancelled");
  expect(reports(device.journal).some(report => report.kind === "control-ack")).toBe(true);
  f.fail(blocked, false); await device.tick(); await device.tick(); expect(f.kernel.settled).toBe(true);
});

for (const placement of ["packet", "batch"] as const) test(`cancel before first journal drains a nonlaunchable ${placement} offer without reaching the driver`, async () => {
  const f = await fixture();
  const forbidden: LaunchDriver = { availability: () => { throw new Error("Drain-only identity must not reach the driver"); }, launch: () => { throw new Error("Drain-only identity must never spawn"); } };
  let device = f.open(forbidden); await device.tick();
  const cancel = { requestKey: "cancel-before-journal", operation: "control" as const, payload: { operation: "cancel" as const } };
  f.packet.launchable = false; f.packet.controls = [cancel]; f.kernel.packet = f.packet;
  const transport: Transport = {
    reconcile: items => f.transport.reconcile(items), report: report => f.transport.report(report),
    async poll() {
      const poll = await f.transport.poll();
      return placement === "batch" ? poll : { ...poll, messages: poll.messages.filter(item => item.kind === "launch").map(item => ({ ...item, envelope: f.delivery })) };
    },
  };
  await device.close(); device = f.open(forbidden, transport);
  if (placement === "batch") f.drop("stop");
  if (placement === "batch") await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError); else await device.tick();
  const attempt = device.journal.get("delivery")!;
  expect(attempt.state).toBe("stopped"); expect(attempt.processIdentity).toBeNull();
  expect(reports(device.journal).map(report => report.kind)).toEqual(["final", "stop", "control-ack"]);
  expect(reports(device.journal)[0]!.payload.outcome).toBe("cancelled");
  const stop = executionSignedStopSchema.parse(reports(device.journal)[1]!.payload);
  expect(stop.statement.kind).toBe("never_started"); expect(stop.statement.target).toEqual(f.packet.target); expect(stop.statement.processIdentity).toBeNull();
  await device.close(); device = f.open(forbidden, transport); await device.tick(); await device.tick();
  expect(f.kernel.settled).toBe(true); expect(device.journal.attempts()).toHaveLength(1); expect(reports(device.journal)).toHaveLength(3);
  expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(0);
});

for (const boundary of ["spawn_possible", "running", "unknown"] as const) test(`nonlaunchable cancellation preserves previously journaled ${boundary} uncertainty`, async () => {
  const f = await fixture(), journal = new Journal(f.root); journal.bind(f.config.device); journal.accept(f.delivery, "local-alias"); journal.transition("delivery", "spawn_possible");
  if (boundary === "running") journal.transition("delivery", "running", { id: "old-native-identity", scope: "descendants" });
  if (boundary === "unknown") journal.transition("delivery", "unknown"); journal.close();
  f.packet.launchable = false; f.packet.controls = [{ requestKey: "late-cancel", operation: "control", payload: { operation: "cancel" } }]; f.kernel.packet = f.packet;
  const device = f.open({ availability: () => { throw new Error("Cannot replay an uncertain attempt"); }, launch: () => { throw new Error("Must never spawn"); } });
  await device.tick(); await device.tick();
  expect(device.journal.get("delivery")!.state).toBe("unknown"); expect(reports(device.journal)).toEqual([]); expect(f.kernel.settled).toBe(false);
  expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(2);
});

for (const mode of ["nonlaunchable", "expired"] as const) test(`${mode} offer cannot spawn even if repeated by the transport`, async () => {
  const f = await fixture(); f.packet.launchable = mode !== "nonlaunchable";
  if (mode === "expired") {
    f.packet.launch.deadlineAt = new Date(Date.now() - 1000).toISOString();
    f.delivery.launchDigest = f.packet.target.launchDigest = executionDigest(f.packet.launch);
  }
  f.kernel.packet = f.packet;
  const transport: Transport = {
    reconcile: items => f.transport.reconcile(items), report: report => f.transport.report(report),
    async poll() {
      const result = await f.transport.poll();
      return { ...result, messages: [{ messageKey: "repeat", kind: "launch", localWorkspaceRef: "local-alias", envelope: f.delivery }] };
    },
  };
  const device = f.open({ availability: () => { throw new Error("Must not reach driver"); }, launch: () => { throw new Error("Must never spawn"); } }, transport);
  await device.tick();
  if (mode === "nonlaunchable") expect(device.journal.attempts()).toEqual([]);
  else {
    expect(device.journal.get("delivery")!.state).toBe("stopped");
    expect(reports(device.journal).find(report => report.kind === "final")!.payload.outcome).toBe("timed_out");
    expect(executionSignedStopSchema.parse(reports(device.journal).find(report => report.kind === "stop")!.payload).statement.kind).toBe("never_started");
  }
});

test("actual spawn observes durable config, immutable journal, capacity and physical workspace locks", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const native = processDriver("printf 'verified\\n'"), driver: LaunchDriver = {
    availability: native.availability,
    launch(input) {
      expect(loadConfig(f.root)).toEqual(f.config);
      const journal = new Journal(f.root);
      try {
        const attempt = journal.get("delivery")!;
        expect(attempt.state).toBe("spawn_possible"); expect(attempt.localWorkspaceRef).toBe("local-alias");
        expect(attempt.delivery.packet.launch.workspaceRef).toBe("kernel-workspace"); expect(attempt.locks.length).toBeGreaterThan(0);
        expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(2);
      } finally { journal.close(); }
      return native.launch(input);
    },
  };
  const device = f.open(driver); await device.tick(); await device.idle(); await device.tick(); await device.tick();
  expect(f.kernel.settled).toBe(true);
});

test("uncertain native stop never signs exited, releases capacity or acknowledges cancel", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  let rejectClose: (reason: Error) => void = () => {};
  const closed = new Promise<{ code: number | null; signal: string | null }>((_, reject) => { rejectClose = reject; });
  const device = f.open({ availability: () => ({ available: true }), launch: () => ({ identity: { id: "uncertain-native", scope: "descendants" }, closed, stop: () => rejectClose(new Error("native stop unproven")), write: () => {} }) });
  await device.tick();
  const control = { requestKey: "uncertain-cancel", operation: "control" as const, payload: { operation: "cancel" as const } };
  await f.app.handle("control", callArgs({ version: 1, requestId: "cancel", deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
  await device.tick();
  expect(device.journal.get("delivery")!.state).toBe("unknown");
  expect(reports(device.journal).map(report => report.kind)).toEqual(["started"]);
  expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(2);
  expect(device.journal.get("delivery")!.locks.length).toBeGreaterThan(0);
});

test("an app-offered delivery missing from the local journal blocks reconciliation and all launches", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  await f.transport.reconcile([]); const offered = await f.transport.poll(); expect(offered.messages).toHaveLength(1);
  f.packet.launchable = false; f.packet.controls = [{ requestKey: "missing-cancel", operation: "control", payload: { operation: "cancel" } }];
  await f.app.handle("control", callArgs({ version: 1, requestId: "missing-cancel", deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control: f.packet.controls[0] }), { kind: "kernel" });
  const device = f.open({ availability: () => { throw new Error("Cannot admit with missing journal"); }, launch: () => { throw new Error("Must not spawn"); } });
  await expect(device.tick()).rejects.toThrow("missing device journal");
  expect(device.journal.attempts()).toEqual([]); expect(reports(device.journal)).toEqual([]); expect(f.kernel.settled).toBe(false);
});

const piCommand = process.env.CHRONA_TEST_PI_COMMAND;
test.skipIf(!piCommand || process.platform !== "linux")("actual Pi RPC crosses device HTTP/app relay, journals model reservations and produces independently verified signed stop", async () => {
  const f = await fixture();
  f.config.pi = localPi({ command: piCommand!, expectedVersion: "1.5.0" }); saveConfig(f.root, f.config);
  const profiles = join(f.root, "profiles"); privateRoot(profiles);
  const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
  f.packet.launch.budget = { timeoutMs: 25000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 };
  f.packet.launch.goal = "Read file.txt, then report its contents.";
  f.packet.target.launchDigest = f.delivery.launchDigest = nativeDigest(f.packet.launch);
  f.kernel.packet = f.packet;
  let sawToolResult = false;
  f.kernel.modelAnswer = input => {
    const request = JSON.parse(input.prompt);
    expect(request.protocol).toBe(PROMPT_PROTOCOL);
    if (f.kernel.modelRequests.length === 1) return { version: 1, content: null, tool_calls: [{ id: "read_file", name: "read", arguments: { path: "file.txt" } }] };
    sawToolResult = request.messages.some((message: { role: string; content: unknown }) => message.role === "tool" && JSON.stringify(message.content).includes("baseline"));
    return { version: 1, content: "Verified baseline from native read", tool_calls: [] };
  };
  const device = f.open(kernelPiDriver({ pi: f.config.pi, profileRoot: profiles, helperPath: helper, chronaExtension: join(piRoot, "resources/chrona-tools.ts") }));
  await device.tick(); await device.idle(); await device.tick(); await device.tick();
  expect(device.journal.get("delivery")!.state).toBe("stopped");
  expect(f.kernel.settled).toBe(true); expect(f.kernel.modelRequests).toHaveLength(2);
  expect(new Set(f.kernel.modelRequests.map(request => request.key)).size).toBe(2);
  expect(sawToolResult).toBe(true);
  expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM models WHERE receipt IS NOT NULL").get()!.n).toBe(2);
  expect(device.journal.db.query<{ receipt: string }, []>("SELECT receipt FROM models").all().map(row => JSON.parse(row.receipt).status)).toEqual(["completed", "completed"]);
  expect(f.kernel.reports.find(report => report.kind === "final")!.payload).toMatchObject({ outcome: "finished", finalMessage: { text: "Verified baseline from native read" } });
  const model = f.kernel.modelRequests[0]!;
  expect(() => device.journal.modelRequest("delivery", model.key, model.input)).toThrow("live delivery");
  const stop = executionSignedStopSchema.parse(f.kernel.reports.find(report => report.kind === "stop")!.payload);
  expect(stop.statement.kind).toBe("exited"); expect(stop.statement.processIdentity!.scope).toBe("descendants");
}, 30000);

test("pending cleanup and unsupported input never starve later cancellation", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const native = processDriver("echo ready; sleep 60");
  const device = f.open({ ...native, launch(input) { const handle = native.launch(input); return { ...handle, write() { throw new Error("Unsupported interactive input"); } }; } });
  await device.tick();
  for (const control of [
    { requestKey: "cleanup-pending", operation: "cleanup", payload: { op: "preview", workId: "work", commandKey: "cleanup-command" } },
    { requestKey: "answer-pending", operation: "control", payload: { operation: "answer", requestId: "question", answer: { decision: "cancel" } } },
    { requestKey: "cancel-after-unsupported", operation: "control", payload: { operation: "cancel" } },
  ]) await f.app.handle("control", callArgs({ version: 1, requestId: control.requestKey, deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
  await expect(device.tick()).rejects.toThrow("Unsupported interactive input");
  expect(device.journal.get("delivery")!.state).toBe("stopped");
  expect(reports(device.journal).filter(report => report.kind === "control-ack").map(report => report.payload.controlKey)).toEqual(["cancel-after-unsupported"]);
  expect(reports(device.journal).find(report => report.kind === "cleanup")?.payload.report).toMatchObject({ state: "blocked" });
  expect(readFileSync(join(f.base, "project/file.txt"), "utf8")).toBe("baseline");
});

test("model input is durable before possible I/O, bound to one key and never replayed after restart", async () => {
  const f = await fixture();
  let journal = new Journal(f.root); journal.bind(f.config.device!); journal.accept(f.delivery, "local-alias"); journal.transition("delivery", "spawn_possible");
  const input = { prompt: "offline", system: "system", maxOutputTokens: 1 };
  journal.modelRequest("delivery", "model-key", input);
  expect(journal.db.query<{ receipt: string | null }, []>("SELECT receipt FROM models").get()!.receipt).toBeNull();
  expect(() => journal.modelRequest("delivery", "model-key", input)).toThrow("must not replay");
  expect(() => journal.modelRequest("delivery", "model-key", { ...input, prompt: "changed" })).toThrow("conflict");
  expect(() => journal.modelRequest("delivery", "different-key", input)).toThrow("capacity");
  journal.close(); journal = new Journal(f.root);
  expect(() => journal.modelRequest("delivery", "model-key", input)).toThrow("must not replay");
  journal.modelReceipt("delivery", "model-key", { status: "pending", reservationId: "fixed-reservation" });
  expect(() => journal.modelReceipt("delivery", "model-key", { status: "pending", reservationId: "replacement-reservation" })).toThrow("Conflicting model receipt");
  expect(() => journal.modelReceipt("delivery", "missing-key", { status: "pending", reservationId: "fixed-reservation" })).toThrow("Unknown model reservation");
  journal.db.query("UPDATE models SET input=?").run(JSON.stringify({ ...input, prompt: "corrupted" })); journal.close();
  expect(() => new Journal(f.root)).toThrow("Retained model checksum mismatch");
});

for (const failure of ["pending", "missing-route"] as const) test.skipIf(!piCommand || process.platform !== "linux")(`actual Pi ${failure} keeps the model outcome durable and never creates a replacement reservation`, async () => {
  const f = await fixture();
  f.config.pi = localPi({ command: piCommand!, expectedVersion: "1.5.0" }); saveConfig(f.root, f.config);
  const profiles = join(f.root, "profiles"); privateRoot(profiles);
  const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
  f.packet.launch.budget = { timeoutMs: 10000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 };
  f.packet.target.launchDigest = f.delivery.launchDigest = nativeDigest(f.packet.launch); f.kernel.packet = f.packet;
  if (failure === "pending") f.kernel.modelPending = true; else f.fail("model", true);
  let device = f.open(kernelPiDriver({ pi: f.config.pi, profileRoot: profiles, helperPath: helper, chronaExtension: join(piRoot, "resources/chrona-tools.ts") }));
  await device.tick(); await device.idle(); await device.tick(); await device.tick();
  expect(device.journal.get("delivery")!.state).toBe("stopped"); expect(f.kernel.settled).toBe(true);
  const final = f.kernel.reports.find(report => report.kind === "final")!;
  expect(final.payload.outcome).toBe("unavailable"); expect(final.payload.error).toContain("execution.model");
  expect(f.kernel.modelRequests).toHaveLength(failure === "pending" ? 1 : 0);
  expect(device.journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM models").get()!.n).toBe(1);
  const row = device.journal.db.query<{ receipt: string | null }, []>("SELECT receipt FROM models").get()!;
  expect(row.receipt === null ? null : JSON.parse(row.receipt).status).toBe(failure === "pending" ? "pending" : null);
  await device.close(); device = f.open(); await device.tick();
  expect(f.kernel.modelRequests).toHaveLength(failure === "pending" ? 1 : 0);
  expect(device.journal.pending()).toEqual([]);
}, 15000);

async function cleanupControl(f: Awaited<ReturnType<typeof fixture>>, command: { op: "preview"; workId: string; commandKey: string } | { op: "confirm"; workId: string; commandKey: string; previewDigest: string }) {
  const control = { requestKey: command.commandKey, operation: "cleanup", payload: command };
  await f.app.handle("control", callArgs({ version: 1, requestId: command.commandKey, deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
}
function cleanupReceipts(device: RemoteDevice) {
  return reports(device.journal).filter(report => report.kind === "cleanup").map(report => report.payload.report as { operationKey: string; state: string; previewDigest: string | null });
}
async function stoppedWorktree() {
  const f = await fixture("independent_worktree"); f.kernel.packet = f.packet;
  let cwd = "";
  const native = processDriver("printf 'clean worktree\\n'"), device = f.open({ ...native, launch(input) { cwd = input.cwd; return native.launch(input); } });
  await device.tick(); await device.idle(); await device.tick(); await device.tick();
  expect(device.journal.get("delivery")!.state).toBe("stopped"); expect(f.kernel.settled).toBe(true); expect(existsSync(cwd)).toBe(true);
  return { f, device, cwd };
}

test("actual app cleanup preview/confirm removes only the owned stopped worktree and lost receipt retries after restart", async () => {
  const { f, cwd, device: original } = await stoppedWorktree(); let device = original;
  await cleanupControl(f, { op: "preview", workId: "work", commandKey: "preview" }); await device.tick(); await device.tick();
  const preview = cleanupReceipts(device).find(receipt => receipt.operationKey === "preview")!;
  expect(preview.state).toBe("retained"); expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/); expect(existsSync(cwd)).toBe(true);
  await cleanupControl(f, { op: "confirm", workId: "work", commandKey: "confirm", previewDigest: preview.previewDigest! }); f.drop("cleanup");
  await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  expect(existsSync(cwd)).toBe(false); expect(readFileSync(join(f.base, "project/file.txt"), "utf8")).toBe("baseline");
  const fixed = device.journal.pending().find(item => item.report.kind === "cleanup")!.report;
  expect(fixed.payload.report).toMatchObject({ state: "removed", operationKey: "confirm", previewDigest: preview.previewDigest });
  await device.close(); device = f.open(); await device.tick(); await device.tick();
  expect(reports(device.journal).find(report => report.reportKey === fixed.reportKey)).toEqual(fixed);
  expect(device.journal.pending()).toEqual([]); expect(f.kernel.reports.filter(report => report.kind === "cleanup")).toHaveLength(2);
  expect(() => device.journal.cleanupRequest("delivery", { op: "confirm", workId: "work", commandKey: "confirm", previewDigest: "0".repeat(64) })).toThrow("key conflict");
  expect(() => device.journal.cleanupReceipt("delivery", { op: "confirm", workId: "work", commandKey: "confirm", previewDigest: preview.previewDigest! }, { ...fixed.payload.report as object, state: "unknown" })).toThrow();
});

test("cleanup binds preview facts: changed worktree and bad digest remain retained with fixed blocked receipts", async () => {
  const { f, device, cwd } = await stoppedWorktree();
  await cleanupControl(f, { op: "preview", workId: "work", commandKey: "preview" }); await device.tick();
  const preview = cleanupReceipts(device)[0]!;
  await cleanupControl(f, { op: "confirm", workId: "work", commandKey: "bad-digest", previewDigest: "0".repeat(64) }); await device.tick();
  expect(cleanupReceipts(device).at(-1)).toMatchObject({ state: "blocked", previewDigest: "0".repeat(64) });
  writeFileSync(join(cwd, "untracked.txt"), "retained change");
  await cleanupControl(f, { op: "confirm", workId: "work", commandKey: "dirty", previewDigest: preview.previewDigest! }); await device.tick();
  expect(cleanupReceipts(device).at(-1)).toMatchObject({ state: "blocked", previewDigest: preview.previewDigest });
  expect(readFileSync(join(cwd, "untracked.txt"), "utf8")).toBe("retained change"); expect(existsSync(cwd)).toBe(true);
});

for (const boundary of ["before-effect", "after-effect"] as const) test(`ambiguous cleanup restart ${boundary} reports unknown and never repeats deletion`, async () => {
  const { f, device: original, cwd } = await stoppedWorktree();
  await cleanupControl(f, { op: "preview", workId: "work", commandKey: "preview" }); await original.tick();
  const preview = cleanupReceipts(original)[0]!, command = { op: "confirm" as const, workId: "work", commandKey: "interrupted-confirm", previewDigest: preview.previewDigest! };
  await cleanupControl(f, command);
  original.journal.cleanupRequest("delivery", command); // FULL commit immediately before an effect is possible.
  if (boundary === "after-effect") git(join(f.base, "project"), ["worktree", "remove", "--", cwd]);
  await original.close(); const device = f.open(); await device.tick(); await device.tick();
  expect(cleanupReceipts(device).find(receipt => receipt.operationKey === command.commandKey)).toMatchObject({ state: "unknown", previewDigest: command.previewDigest });
  expect(existsSync(cwd)).toBe(boundary === "before-effect");
  await device.tick(); expect(existsSync(cwd)).toBe(boundary === "before-effect");
  expect(cleanupReceipts(device).filter(receipt => receipt.operationKey === command.commandKey)).toHaveLength(1);
});

test.skipIf(!piCommand || process.platform !== "linux")("actual Pi dialog is durably offered and answered through the app with one fixed control acknowledgement", async () => {
  const f = await fixture();
  f.config.pi = localPi({ command: piCommand!, expectedVersion: "1.5.0" }); saveConfig(f.root, f.config);
  const profiles = join(f.root, "profiles"); privateRoot(profiles);
  const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
  const extension = join(f.root, "dialog-extension.ts");
  writeFileSync(extension, `import base from ${JSON.stringify(join(piRoot, "resources/chrona-tools.ts"))};import {writeFileSync} from 'node:fs';export default function(api){base(api);api.on('before_agent_start',async(_event,ctx)=>{if(await ctx.ui.confirm('Device offline confirmation','Continue?',{timeout:10000}))writeFileSync('dialog-confirmed.txt','confirmed');});}`, { mode: 0o600 });
  f.packet.launch.budget = { timeoutMs: 20000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 };
  f.packet.target.launchDigest = f.delivery.launchDigest = nativeDigest(f.packet.launch); f.kernel.packet = f.packet;
  const device = f.open(kernelPiDriver({ pi: f.config.pi, helperPath: helper, chronaExtension: extension, profileRoot: profiles }));
  await device.tick();
  const questions = () => reports(device.journal).filter(report => report.kind === "source").flatMap(report => report.payload.records as { payload: { type: string; question?: { requestId: string; status: string } } }[]).filter(record => record.payload.type === "question");
  await until(() => questions().some(record => record.payload.question!.status === "pending"));
  await device.flush();
  const requestId = questions().find(record => record.payload.question!.status === "pending")!.payload.question!.requestId;
  const control = { requestKey: "answer-fixed-key", operation: "control", payload: { operation: "answer", requestId, answer: { decision: "submit", value: true } } };
  await f.app.handle("control", callArgs({ version: 1, requestId: "owner-answer", deliveryId: "delivery", launchDigest: f.delivery.launchDigest, control }), { kind: "kernel" });
  f.drop("control-ack"); await expect(device.tick()).rejects.toBeInstanceOf(DeviceHTTPError);
  await device.idle(); await device.tick(); await device.tick();
  expect(readFileSync(join(f.base, "project/dialog-confirmed.txt"), "utf8")).toBe("confirmed");
  expect(questions().map(record => record.payload.question!.status)).toEqual(["pending", "answered"]);
  expect(reports(device.journal).filter(report => report.kind === "control-ack")).toHaveLength(1);
  expect(device.journal.db.query<{ state: string }, []>("SELECT state FROM controls WHERE control_key='answer-fixed-key'").get()!.state).toBe("applied");
  expect(f.kernel.settled).toBe(true); expect(f.kernel.reports.find(report => report.kind === "final")!.payload.outcome).toBe("finished");
}, 30000);

test("two stable subject slots admit distinct projects; third cannot prevent accepted work or controls", async () => {
  const f = await fixture(), journal = new Journal(f.root); journal.bind(f.config.device);
  const next = (id: string) => { const value = structuredClone(f.delivery); value.deliveryId = id; value.packet.launch.fence.deliveryId = value.packet.target.deliveryId = id; value.packet.launch.target.directoryIdentity = `directory-${id}`; value.launchDigest = value.packet.target.launchDigest = executionDigest(value.packet.launch); return value; };
  journal.accept(f.delivery, "local-alias"); journal.accept(next("second"), "local-alias");
  expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM capacity").get()!.n).toBe(4);
  expect(() => journal.accept(next("third"), "local-alias")).toThrow(); expect(journal.attempts()).toHaveLength(2);
  journal.db.exec("DELETE FROM capacity; DELETE FROM events; DELETE FROM attempts"); journal.close();
  const offered = [f.delivery, next("second"), next("third")]; let available = 0;
  const device = f.open({ availability() { available++; return { available: false, reason: "offline fixture" }; }, launch() { throw new Error("unreachable"); } }, { ...f.transport, reconcile: async () => ({}), poll: async () => ({ version: 1, state: "offered", reconciliationRequired: false, messages: offered.map(envelope => ({ messageKey: envelope.deliveryId, kind: "launch" as const, localWorkspaceRef: "local-alias", envelope })) }), report: async () => { throw new Error("offline"); } });
  await expect(device.tick()).rejects.toThrow();
  expect(available).toBe(2); expect(device.journal.get("third")).toBeNull();
  expect(device.journal.get("delivery")!.state).toBe("stopped"); expect(device.journal.get("second")!.state).toBe("stopped");
});

test("receiver rotation requires reconciled poll, settled capacity and every retained outbox receipt", async () => {
  const f = await fixture(); f.kernel.packet = f.packet; const device = f.open(); await device.tick(); await device.tick();
  const next = structuredClone(f.delivery); next.deliveryId = "resumed"; next.packet.target.deliveryId = next.packet.launch.fence.deliveryId = "resumed";
  next.packet.target.receiverActivationId = next.packet.launch.fence.receiverActivationId = "resumed-activation";
  next.launchDigest = next.packet.target.launchDigest = executionDigest(next.packet.launch);
  expect(() => device.journal.accept(next, "local-alias")).toThrow("reconcile");
  device.journal.db.query("UPDATE outbox SET receipt=NULL WHERE report_key='final'").run();
  expect(() => device.journal.accept(next, "local-alias", true)).toThrow("reconcile"); await device.flush();
  expect(device.journal.accept(next, "local-alias", true).created).toBe(true);
  expect(device.journal.get("delivery")!.delivery.packet.target.receiverActivationId).toBe(receiver.activationId);
  expect(() => device.journal.accept({ ...next, deliveryId: "changed" }, "local-alias", true)).toThrow();
});

test("source flood commits a bounded gap and final plus signed stop drain through the actual app", async () => {
  const f = await fixture(); f.kernel.packet = f.packet;
  const device = f.open(processDriver("yes source-flood | head -c 700000; sleep 60"));
  await device.tick(); await device.idle();
  // Each app forwarding pass has a wall-clock budget; keep polling until verified stop.
  do { await device.tick(); } while (!f.kernel.settled);
  const source = reports(device.journal).filter(report => report.kind === "source");
  expect(source.length).toBeLessThanOrEqual(513);
  const last = source.at(-1)!.payload.records as { payload: { type: string; reason?: string; from?: number; through?: number } }[];
  expect(last.at(-1)!.payload).toEqual({ type: "gap", from: source.length, through: source.length, reason: "backpressure" });
  expect(f.kernel.reports.find(report => report.kind === "final")!.payload.missing).toBe(true);
  expect(f.kernel.settled).toBe(true); expect(device.journal.pending()).toEqual([]);
}, 60000);

test("receiver rotation refreshes the complete settled snapshot before admitting the new activation", async () => {
  const f = await fixture(), next = structuredClone(f.delivery);
  next.deliveryId = "resumed"; next.packet.target.deliveryId = next.packet.launch.fence.deliveryId = "resumed";
  next.packet.target.receiverActivationId = next.packet.launch.fence.receiverActivationId = "resumed-activation";
  next.launchDigest = next.packet.target.launchDigest = executionDigest(next.packet.launch);
  let offer = f.delivery; const snapshots: SnapshotItem[][] = [];
  const device = f.open(undefined, {
    reconcile: async items => { snapshots.push(structuredClone(items)); return {}; },
    poll: async () => ({ version: 1, state: "offered", reconciliationRequired: false, messages: [{ messageKey: offer.deliveryId, kind: "launch", localWorkspaceRef: "local-alias", envelope: offer }] }),
    report: async report => { const { requestId, reportKey: _, ...business } = report; return { version: 1, requestId, receiptId: report.reportKey, requestDigest: appDigest(business), committedAt: new Date().toISOString(), state: "durably-received-evidence-unverified" }; },
  });
  await device.tick(); offer = next;
  await expect(device.tick()).rejects.toThrow("reconcile"); expect(device.journal.get("resumed")).toBeNull();
  await device.tick(); expect(device.journal.get("resumed")!.state).toBe("stopped");
  expect(snapshots).toHaveLength(2); expect(snapshots[1]![0]!.deliveryId).toBe("delivery"); expect(snapshots[1]![0]!.state).toBe("stopped");
});

test("actual SQLite admission exhaustion preserves reserved terminal/control custody and unknown ownership after restart", async () => {
  const f = await fixture(), limits = { maxPages: 8192, admissionPages: 256 };
  let journal = new Journal(f.root, limits); cleanup.push(() => journal.close());
  journal.bind(f.config.device); journal.accept(f.delivery, "local-alias");
  journal.transition("delivery", "spawn_possible"); journal.transition("delivery", "running", { id: "retained-owner", scope: "descendants" });
  journal.modelRequest("delivery", "model-before-pressure", { prompt: "reserved before possible I/O", maxOutputTokens: 1 });
  const terminal = structuredClone(f.delivery);
  terminal.deliveryId = terminal.packet.target.deliveryId = terminal.packet.launch.fence.deliveryId = "terminal";
  terminal.packet.launch.target.directoryIdentity = "terminal-directory";
  terminal.launchDigest = terminal.packet.target.launchDigest = executionDigest(terminal.packet.launch);
  journal.accept(terminal, "local-alias"); journal.transition("terminal", "spawn_possible");
  const processIdentity = { id: "terminal-owner", scope: "descendants" }; journal.transition("terminal", "running", processIdentity);
  for (let i = 0; i < 99; i++) journal.control("terminal", `ordinary-${i}`, { requestKey: `ordinary-${i}`, operation: "control", payload: { operation: "write", text: "x" } });
  const path = join(f.root, "journal.sqlite"), allocated = statSync(path);
  expect(allocated.size).toBeGreaterThan(17 * 1024 * 1024);
  expect(allocated.blocks * 512).toBeGreaterThanOrEqual(allocated.size * 0.95);
  journal.write(() => journal.db.exec("CREATE TABLE physical_pressure(id INTEGER PRIMARY KEY,payload BLOB)"));
  let inserted = 0;
  for (;;) {
    try { journal.write(() => journal.db.query("INSERT INTO physical_pressure(payload) VALUES (zeroblob(4096))").run()); inserted++; }
    catch (error) { expect(error).toHaveProperty("code", "storage_exhausted"); break; }
  }
  expect(inserted).toBeGreaterThan(20);
  const rejected = structuredClone(terminal); rejected.deliveryId = rejected.packet.target.deliveryId = rejected.packet.launch.fence.deliveryId = "rejected";
  rejected.packet.launch.target.directoryIdentity = "rejected-directory";
  rejected.launchDigest = rejected.packet.target.launchDigest = executionDigest(rejected.packet.launch);
  // Free a subject slot only through a real terminal transition below. Admission
  // is checked again afterward, so capacity conflicts cannot stand in for pressure.
  const report = (kind: Report["kind"], payload: Report["payload"], reportKey = kind as string): Report => ({ version: 1, requestId: `physical-${reportKey}`, deliveryId: "terminal", launchDigest: terminal.launchDigest, kind, reportKey, payload });
  const final = executionDeliveryFinalSchema.parse({ outcome: "cancelled", error: "bounded physical pressure", throughSourceSeq: 513, baseline: terminal.packet.launch.workspace.baseline, finalMessage: { messageId: "last", text: "x".repeat(24000), truncated: true }, missing: true, changes: { scope: "baseline_to_worktree", status: "partial", reason: "limit", patch: "x".repeat(120000), files: [] } });
  journal.write(() => {
    for (let sequence = 1; sequence <= 512; sequence++) journal.enqueue(report("source", { records: [{ sequence, at: "2026-01-01T00:00:00Z", payload: { type: "text_delta", messageId: "m", delta: "x" } }] }, `source:${sequence}`));
    journal.enqueue(report("source", { records: [{ sequence: 513, at: "2026-01-01T00:00:00Z", payload: { type: "gap", from: 513, through: 513, reason: "backpressure" } }] }, "source:513"));
    journal.enqueue(report("final", final));
    for (let i = 0; i < 16; i++) {
      const proof = stopProof(terminal.packet.target, final, processIdentity, f.config.privateKey, new Date(Date.parse("2026-01-01T00:00:00Z") + i).toISOString());
      journal.enqueue(report("stop", proof, `stop:${appDigest(proof)}`));
    }
    journal.transition("terminal", "stopped"); journal.transition("delivery", "unknown");
  });
  expect(() => journal.accept(rejected, "local-alias")).toThrow("Physical SQLite admission exhausted");
  expect(journal.get("rejected")).toBeNull();
  expect(journal.db.query("SELECT 1 FROM storage_reserves WHERE id='delivery:rejected'").get()).toBeNull();
  expect(() => journal.control("terminal", "too-late-write", { requestKey: "too-late-write", operation: "control", payload: { operation: "write", text: "x" } })).toThrow("last slot");
  expect(journal.control("terminal", "cancel", { requestKey: "cancel", operation: "control", payload: { operation: "cancel" } })).toBe("new");
  journal.write(() => {
    for (const key of [...Array.from({ length: 99 }, (_, i) => `ordinary-${i}`), "cancel"]) journal.appliedControl("terminal", key, report("control-ack", { controlKey: key }, `ack:${appDigest([key])}`));
    for (const { id, report: value } of journal.pending()) {
      const { requestId, reportKey: _, ...business } = value;
      journal.acknowledge(id, { version: 1, requestId, receiptId: "r".repeat(3500), requestDigest: appDigest(business), committedAt: "2026-01-01T00:00:00Z", state: "durably-received-evidence-unverified" });
    }
  });
  journal.modelReceipt("delivery", "model-before-pressure", { status: "pending", reservationId: "fixed-reservation" });
  expect(journal.pending()).toEqual([]);
  journal.close(); journal = new Journal(f.root, limits);
  expect(journal.get("terminal")!.state).toBe("stopped");
  expect(journal.get("delivery")!.state).toBe("unknown");
  expect(journal.get("delivery")!.processIdentity).toEqual({ id: "retained-owner", scope: "descendants" });
  expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM capacity WHERE delivery_id='delivery'").get()!.n).toBe(2);
  expect(journal.pending()).toEqual([]);
  expect(journal.accept(f.delivery, "local-alias").created).toBe(false);
  expect(() => journal.transition("delivery", "spawn_possible")).toThrow("Forbidden journal transition");
  expect(() => journal.modelRequest("delivery", "model-before-pressure", { prompt: "reserved before possible I/O", maxOutputTokens: 1 })).toThrow();
  expect(() => journal.accept(rejected, "local-alias")).toThrow("Physical SQLite admission exhausted");
  expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM physical_pressure").get()!.n).toBe(inserted);
  expect(journal.db.query<{ max_page_count: number }, []>("PRAGMA max_page_count").get()!.max_page_count).toBe(limits.maxPages);
  expect(journal.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()!.journal_mode).toBe("delete");
  expect(statSync(path).size).toBeLessThanOrEqual(limits.maxPages * 4096);
  expect(existsSync(`${path}-wal`)).toBe(false); expect(existsSync(`${path}-journal`)).toBe(false);
  expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE report_key LIKE 'source:%'").get()!.n).toBe(513);
  expect(journal.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE report_key LIKE 'stop:%'").get()!.n).toBe(16);
}, 30000);
