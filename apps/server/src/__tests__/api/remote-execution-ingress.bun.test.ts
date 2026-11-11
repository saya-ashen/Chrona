import { expect, test } from "bun:test";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { registerLocalModule } from "../../../../../packages/engine/src/modules/steward/module-registry";
import { generateKeyPairSync, randomBytes, sign, createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type KernelExecutionStart, type ExecutionDeliveryFinal } from "@chrona/contracts/steward";
import { createExecutionDelivery, callSync, moduleSupervisor } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { createServerApp } from "../../app";
import { createStewardRuntime } from "../../steward-runtime";
import { resetEnvCacheForTests } from "../../config/env";

const ownerKey = "s5-owner-only-key", deviceKey = "d".repeat(64), prefix = "/api/remote-execution/device/v1/";
// A temporary application exercises the real SDK process/channel and generic carrier independently of
// the production remote application's device protocol. All execution facts still go to the real kernel DB.
const probeSource = `import { chrona, on, ModelError } from "chrona";
import { createHash } from "node:crypto";
let binding;
const hash = value => createHash("sha256").update(value).digest("hex");
const expected = ${JSON.stringify(createHash("sha256").update(deviceKey).digest("hex"))};
on("tool", async event => {
  const input = JSON.parse(event.args.input);
  if (event.caller?.kind !== "kernel") throw new ModelError("forbidden", "forbidden");
  if (event.id === "bind") { binding = input; return { result: { state: "bound" } }; }
  if (!binding || hash(input.credential) !== expected) throw new ModelError("forbidden", "forbidden");
  return { result: await chrona.call("runtime-callback.remote-delivery", input.action ?? { operation: "poll" }) };
});`;
async function fixture(key: string | null = ownerKey, production = false) {
  const prior = process.env.API_KEY;
  if (key === null) delete process.env.API_KEY; else process.env.API_KEY = key;
  resetEnvCacheForTests();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-s5-http-"));
  await db.workspace.create({ data: { id: "ws_default", name: "S5 owner" } });
  const toolNames = ["bind", ...["pair", "poll", "report", "reconcile", "model"].map(name => `device-${name}`), ...(production ? ["sync", "forward", "lifecycle", "pairing-create", "mapping-set", "device-revoke", "status"] : [])];
  const ownerTools = ["pairing-create", "mapping-set", "device-revoke", "status"];
  const tools = toolNames.map(name => ({ name, description: name, visibility: [ownerTools.includes(name) ? "owner" : "kernel"], parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
      output: {}
}));
  const applicationSource = fileURLToPath(new URL("../../../../../packages/engine/src/modules/steward/external/remote-execution", import.meta.url));
  const manifest = moduleManifestSchema.parse(production ? JSON.parse(await readFile(join(applicationSource, "module.json"), "utf8")) : { name: "remote-execution", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], tools });
  const receiver = await db.module.create({ data: { workspaceId: "ws_default", name: manifest.name, activeHash: production ? "5".repeat(40) : "s5-http-probe" } });
  await db.moduleVersion.create({ data: { moduleId: receiver.id, hash: receiver.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const code = join(dataDir, "platform/store", receiver.activeHash!);
  await mkdir(code, { recursive: true });
  if (production) await cp(applicationSource, code, { recursive: true });
  else await writeFile(join(code, "index.ts"), probeSource);
  const runtime = createStewardRuntime(db, { dataDir, provider: null });
  const app = await createServerApp({ steward: runtime });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const selectedDeviceKey = production ? randomBytes(32).toString("base64url") : deviceKey;
  const post = (path: string, input: unknown = {}, credential = selectedDeviceKey, headers: Record<string, string> = {}) => fetch(new URL(path, server.url), { method: "POST", headers: { authorization: `Bearer ${credential}`, ...headers }, body: typeof input === "string" ? input : JSON.stringify(input) });
  return { db, receiver, runtime, app, server, post, async close() { await server.stop(true); await runtime.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); if (prior === undefined) delete process.env.API_KEY; else process.env.API_KEY = prior; resetEnvCacheForTests(); } };
}

test("exact loopback device ingress reaches only the approved application; identity and bearer cannot be forged", async () => {
  const f = await fixture();
  try {
    for (const operation of ["pair", "poll", "report", "reconcile", "model"]) {
      const response = await f.post(prefix + operation);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ deliveries: [] });
    }
    expect((await f.post(prefix + "poll", {}, ownerKey)).status).toBe(403);
    expect((await f.post(prefix + "poll", {}, randomBytes(32).toString("hex"), { "x-chrona-caller": "kernel", "x-chrona-module-token": "forged", "x-forwarded-for": "127.0.0.1" })).status).toBe(403);
    for (const path of [prefix + "poll/", prefix + "poll/extra", prefix + "unknown", "/api/remote-execution/owner/v1/authority"]) expect((await f.post(path)).status).toBe(401);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect((await fetch(new URL(prefix + "poll", f.server.url), { method, headers: { authorization: `Bearer ${deviceKey}` } })).status).toBe(401);
    for (const input of [{ credential: deviceKey }, { caller: { kind: "owner" } }, { workspaceId: "another" }, "{bad"]) expect((await f.post(prefix + "poll", input)).status).toBe(400);
    expect((await f.post(prefix + "poll", "x".repeat(524_289), deviceKey, { "content-length": "524289" })).status).toBe(413);
    const invalid = await f.app.request(prefix + "poll", { method: "POST", headers: { authorization: `Bearer ${deviceKey}` }, body: new Uint8Array([255]) }); expect(invalid.status).toBe(400);
    const chunked = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(524_289)); controller.close(); } });
    expect((await f.app.request(prefix + "poll", { method: "POST", headers: { authorization: `Bearer ${deviceKey}`, "content-length": "1" }, body: chunked } as RequestInit)).status).toBe(413);
    expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain(deviceKey);
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.receiver.id, hash: f.receiver.activeHash! } }, data: { status: "candidate" } });
    expect((await f.post(prefix + "poll")).status).toBe(403);
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.receiver.id, hash: f.receiver.activeHash! } }, data: { status: "approved" } });
    await f.db.module.update({ where: { id: f.receiver.id }, data: { status: "paused" } });
    expect((await f.post(prefix + "poll")).status).toBe(403);
  } finally { await f.close(); }
}, 30_000);

test("owner-approved key stays separate; real SDK carrier commits source/final and verifies signed stop", async () => {
  const f = await fixture();
  try {
    const key = generateKeyPairSync("ed25519"), baseline = { kind: "commit" as const, digest: "a".repeat(40) };
    const receiver = { workspaceId: "ws_default", moduleId: f.receiver.id, hash: f.receiver.activeHash!, activationId: f.receiver.activationId };
    const authority = { receiver, subjectId: "loopback-target", epoch: 1, keyId: "device-signing-key", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), verifierId: "ed25519", verifierVersion: "1", approvalId: "trusted-owner-approval", scope: { callerModuleIds: [], targets: [{ targetRef: "device", targetRevision: 1, projectRef: "project", directoryIdentity: "loopback-directory", baseline, workspaceModes: ["existing"] }] } };
    const approval = await f.post("/api/remote-execution/owner/v1/authority", authority, ownerKey); expect(approval.status).toBe(200);
    const service = createExecutionDelivery(f.runtime.ports);
    const input: KernelExecutionStart = { kind: "execution", workId: "s5-work", commandKey: "start", goal: "offline loopback probe", placement: { kind: "application", applicationId: f.receiver.id, targetRef: "device", targetRevision: 1, projectRef: "project" }, workspace: { mode: "existing", baseline }, queueExpiresAt: new Date(Date.now() + 60_000).toISOString(), budget: { timeoutMs: 60_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 100 } };
    await service.admit({ workspaceId: "ws_default", ownerId: "owner", caller: { kind: "owner" } }, input);
    const polled = await (await f.post(prefix + "poll")).json(), offered = polled.deliveries[0]; expect(offered).toBeDefined();
    async function action(input: unknown) { const response = await f.post(prefix + "report", { action: input }); expect(response.status).toBe(200); return response.json(); }
    const target = offered.target;
    await action({ operation: "accept", target, key: "accept" });
    const processIdentity = { id: "mock-device-process", scope: "mock-journal" };
    await action({ operation: "started", target, key: "started", processIdentity });
    await action({ operation: "source", target, key: "source", records: [{ sequence: 1, at: new Date().toISOString(), payload: { type: "message", messageId: "mock-message", role: "assistant", text: "working", complete: false } }] });
    const final: ExecutionDeliveryFinal = { outcome: "finished", error: null, throughSourceSeq: 1, baseline, finalMessage: null, missing: false };
    const committed = await action({ operation: "final", target, key: "final", final });
    expect(await action({ operation: "final", target, key: "final", final })).toEqual(committed);
    expect(await f.db.executionAttempt.findUnique({ where: { id: target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
    const statement = { target, kind: "exited", processIdentity, finalDigest: committed.finalDigest, sourceThrough: 1, observedAt: new Date().toISOString() };
    const canonical = (value: unknown): string => value !== null && typeof value === "object" ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}` : JSON.stringify(value);
    const digest = createHash("sha256").update(canonical(statement)).digest();
    await action({ operation: "stop", target, key: "stop", proof: { statement, signature: sign(null, digest, key.privateKey).toString("base64") } });
    expect(await f.db.executionAttempt.findUnique({ where: { id: target.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
    expect(await f.db.run.count()).toBe(1);
    await expect(callSync(f.runtime.ports, { workspaceId: "ws_default", caller: { kind: "owner", via: null }, chain: [], path: [] }, "runtime-callback.remote-delivery", { operation: "poll" })).rejects.toMatchObject({ code: "not_found" });
    await f.db.module.update({ where: { id: receiver.moduleId }, data: { activationId: "replacement-activation" } });
    expect((await f.post(prefix + "poll")).status).toBe(503);
    let renewed: Response | undefined;
    for (let retry = 0; retry < 30; retry++) {
      await Bun.sleep(50);
      renewed = await f.post(prefix + "poll");
      if (renewed.status === 200) break;
    }
    expect(renewed?.status).toBe(200);
    expect(await renewed!.json()).toEqual({ deliveries: [] });
    expect((await f.post(prefix + "report", { action: { operation: "accept", target, key: "old-activation" } })).status).toBe(403);
  } finally { await f.close(); }
}, 30_000);

test("new owner approval fails closed with no actual configured API_KEY", async () => {
  for (const key of [null, "", "   "]) {
    const f = await fixture(key);
    try { for (const operation of ["authority", "cleanup"]) expect((await f.post(`/api/remote-execution/owner/v1/${operation}`, {}, ownerKey)).status).toBe(503); expect(await f.db.executionAuthority.count()).toBe(0); }
    finally { await f.close(); }
  }
}, 30_000);

// This mock device uses only loopback HTTP and Ed25519; the application runs in a real SDK
// process, persists its own outbox, and calls the real generic delivery APIs. No Provider/model.
test("production remote app relays native model, lifecycle, signed stop, and owner cleanup", async () => {
  const f = await fixture(ownerKey, true);
  try {
    const key = generateKeyPairSync("ed25519"), publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
    const baseline = { kind: "commit" as const, digest: "b".repeat(40) }, device = { deviceId: "real-mock-device", generation: 1, incarnation: "mock-incarnation", keyId: "mock-key" };
    let sequence = 0;
    async function deviceRequest(operation: string, input: Record<string, unknown>) {
      const response = await f.post(prefix + operation, { version: 1, requestId: `device-request-${++sequence}`, ...input });
      const result = await response.json(); expect({ status: response.status, result }).toMatchObject({ status: 200 }); return result;
    }
    async function owner(operation: string, input: Record<string, unknown>) {
      const response = await f.post(`/api/remote-execution/owner/v1/${operation}`, input, ownerKey);
      const result = await response.json(); expect({ status: response.status, result }).toMatchObject({ status: 200 }); return result;
    }
    const pairing = await owner("pairing-create", { version: 1, requestKey: "pair", deviceId: device.deviceId, incarnation: device.incarnation, keyId: device.keyId, publicKey, expiresInMs: 60_000 });
    const paired = await deviceRequest("pair", { code: pairing.code, publicKey }); expect(paired).toMatchObject({ device });
    const mapping = await owner("mapping-set", { version: 1, requestKey: "mapping", projectRef: "project", device, workspaceRef: "mock-worktree", baseline, directoryIdentity: "mock-directory", workspaceModes: ["existing", "independent_worktree"], expectedRevision: 0 });
    expect(mapping).toMatchObject({ mappingRevision: 1 });
    const receiver = { workspaceId: "ws_default", moduleId: f.receiver.id, hash: f.receiver.activeHash!, activationId: f.receiver.activationId };
    const actualPiCommand = process.env.CHRONA_TEST_PI_COMMAND;
    const modelLimit = actualPiCommand ? 4 : 2;
    const caller = await f.db.module.create({ data: { workspaceId: "ws_default", name: "http-caller", activeHash: "caller-hash" } });
    const callerManifest = moduleManifestSchema.parse({ name: caller.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.complete"], model: { tier: "fake", maxCalls: modelLimit, maxOutputTokens: 400 } });
    await f.db.moduleVersion.create({ data: { moduleId: caller.id, hash: caller.activeHash!, manifest: callerManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const callerCode = join(f.runtime.ports.dataDir, "platform/store", caller.activeHash!); await mkdir(callerCode, { recursive: true }); await writeFile(join(callerCode, "index.ts"), `import {on} from "chrona";on("tool",async()=>({result:null}));`);
    await f.db.workspace.update({ where: { id: "ws_default" }, data: { settings: { timezone: "UTC", moduleModel: { maxCallsPerEvent: modelLimit, maxOutputTokens: 400, dailyCalls: modelLimit, eventTimeoutMs: 20_000 } } } });
    // Database-scoped deterministic gateway I/O, through the real module router.
    // The application and carrier still run in a real SDK process.
    let gatewayCalls = 0;
    registerLocalModule({ name: "agent", description: "Offline deterministic gateway", unrecorded: ["complete"], tools: [{ name: "complete", description: "Offline completion", idempotent: false, visibility: ["kernel"], parameters: { type: "object", properties: {}, required: [] }, input: z.object({ prompt: z.string(), system: z.string().optional(), maxOutputTokens: z.number(), declaredTier: z.string(), effectiveHardLimits: z.object({ maxCallsPerEvent: z.number(), maxOutputTokens: z.number(), eventTimeoutMs: z.number() }), timeoutMs: z.number() }), output: z.object({ text: z.string(), inputTokens: z.number(), outputTokens: z.number() }) }], async handle(_context, _tool, args) { gatewayCalls++; if (args.prompt === "lost") throw new Error("lost deterministic reply"); const text = typeof args.prompt === "string" && args.prompt.includes('"chrona.remote.text-tools.v1"') ? JSON.stringify(args.prompt.includes("native-tool-through-http") ? { version: 1, content: "HTTP-governed completion verified", tool_calls: [] } : { version: 1, content: null, tool_calls: [{ id: "read_http_fixture", name: "read", arguments: { path: "fixture.txt" } }] }) : "offline completion"; return { text, inputTokens: 3, outputTokens: 4 }; } }, f.db);
    const service = createExecutionDelivery(f.runtime.ports), principal = { workspaceId: "ws_default", ownerId: "owner", caller: { kind: "module" as const, moduleId: caller.id, hash: caller.activeHash! } };
    const start: KernelExecutionStart = { kind: "execution", workId: "production-work", commandKey: "start", goal: "offline production integration", placement: { kind: "application", applicationId: receiver.moduleId, targetRef: "project", targetRevision: 1, projectRef: "project" }, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: new Date(Date.now() + 60_000).toISOString(), budget: { timeoutMs: 60_000, maxToolCalls: modelLimit, maxModelCalls: modelLimit, maxOutputTokens: 400 } };
    await expect(service.admit(principal, start)).rejects.toMatchObject({ code: "forbidden" });
    await owner("authority", { receiver, subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId, publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), verifierId: "ed25519", verifierVersion: "1", approvalId: "production-approved", scope: { callerModuleIds: [caller.id], targets: [{ targetRef: "project", targetRevision: 1, projectRef: "project", directoryIdentity: "mock-directory", baseline, workspaceModes: ["existing", "independent_worktree"] }] } });
    await deviceRequest("reconcile", { device, snapshotId: "startup", page: 0, complete: true, items: [] });
    const ready = await deviceRequest("poll", { device }); expect(ready).toMatchObject({ reconciliationRequired: false, messages: [] });
    await service.admit(principal, start);
    let messages: { kind: string; envelope: Record<string, any> }[] = [];
    for (let retry = 0; retry < 4 && !messages.some(message => message.kind === "launch"); retry++) messages = (await deviceRequest("poll", { device })).messages;
    let launch = messages.find(message => message.kind === "launch")!.envelope;
    expect(launch).toMatchObject({ packet: { target: { subjectId: device.deviceId, epoch: device.generation }, launch: { goal: start.goal } } });
    let target = launch.packet.target; const processIdentity = { id: "loopback-process", scope: "device-journal" };
    async function report(kind: string, payload: unknown, reportKey = kind) {
      return deviceRequest("report", { device, report: { version: 1, requestId: `report-${++sequence}`, deliveryId: target.deliveryId, launchDigest: target.launchDigest, reportKey, kind, payload } });
    }
    await report("started", processIdentity); await deviceRequest("poll", { device });
    const modelRequest = { device, deliveryId: target.deliveryId, launchDigest: target.launchDigest, key: "completed-model", input: { prompt: "offline", maxOutputTokens: 80 } };
    const model = await deviceRequest("model", modelRequest); expect(model).toMatchObject({ status: "completed", result: { text: "offline completion" } });
    expect(await deviceRequest("model", modelRequest)).toEqual(model);
    expect((await f.post(prefix + "model", { version: 1, requestId: "changed-model", ...modelRequest, input: { prompt: "changed", maxOutputTokens: 80 } })).status).toBe(409);
    if (actualPiCommand) {
      const { startRemotePi } = await import("../../../../../packages/remote-model/src/pi");
      const root = f.runtime.ports.dataDir, cwd = join(root, "approved-work"), profileRoot = join(root, "device-profiles"), helperPath = join(root, "guardian");
      await mkdir(cwd); await mkdir(profileRoot, { mode: 0o700 }); await writeFile(join(cwd, "fixture.txt"), "native-tool-through-http");
      const guardian = fileURLToPath(new URL("../../../../../packages/process/native/guardian.c", import.meta.url));
      expect(spawnSync("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", guardian, "-o", helperPath]).status).toBe(0);
      let text = "", requests = 0;
      const handle = startRemotePi({ command: actualPiCommand, expectedVersion: "1.5.0", helperPath, chronaExtension: fileURLToPath(new URL("../../../../../packages/pi/resources/chrona-tools.ts", import.meta.url)), profileRoot, cwd, execution: launch.packet.launch.fence, goal: "Read fixture.txt and report what it contains", deadlineAt: launch.packet.launch.deadlineAt, budget: start.budget, onText(delta) { text += delta; }, async model(key, input) { requests++; return deviceRequest("model", { ...modelRequest, key, input }); } });
      try { expect(await handle.done).toMatchObject({ outcome: "finished", error: null }); expect(text).toContain("HTTP-governed completion verified"); expect(requests).toBe(2); }
      finally { await handle.abort().catch(() => {}); }
    }
    const lostRequest = { ...modelRequest, key: "unknown-model", input: { prompt: "lost", maxOutputTokens: 80 } };
    expect((await f.post(prefix + "model", { version: 1, requestId: "lost-model", ...lostRequest })).status).toBe(503);
    expect(await deviceRequest("model", lostRequest)).toMatchObject({ status: "pending" });
    expect(await deviceRequest("model", { ...modelRequest, key: "budget-denied" })).toMatchObject({ status: "rejected", error: "budget_exceeded" });
    expect(await f.db.moduleCall.count({ where: { moduleId: caller.id, method: "model", status: "executed" } })).toBe(actualPiCommand ? 3 : 1);
    expect(await f.db.moduleCall.count({ where: { moduleId: caller.id, method: "model", status: "pending" } })).toBe(1); expect(gatewayCalls).toBe(modelLimit);
    await service.control(principal, start.workId, "write-command", { operation: "write", text: "offline-input" });
    const controls = (await deviceRequest("poll", { device })).messages;
    expect(controls.some((message: { kind: string }) => message.kind === "control")).toBe(true);
    const jcs = (value: unknown): string => value !== null && typeof value === "object" ? Array.isArray(value) ? `[${value.map(jcs).join(",")}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${jcs((value as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(value);
    const hash = (value: unknown) => createHash("sha256").update(jcs(value)).digest("hex");
    await report("control-ack", { controlKey: "write-command" }, `ack:${hash(["write-command"])}`);
    await report("source", { records: [{ sequence: 1, at: new Date().toISOString(), payload: { type: "message", messageId: "production-message", role: "assistant", text: "loopback source", complete: false } }] }, "source:1");
    const final: ExecutionDeliveryFinal = { outcome: "finished", error: null, throughSourceSeq: 1, baseline, finalMessage: null, missing: false };
    const finalReceipt = await report("final", final); await deviceRequest("poll", { device });
    // Confirm the SDK process exits, then reopen its actual private database.
    await moduleSupervisor(f.runtime.ports).settleModule(receiver.moduleId);
    expect(await report("final", final)).toEqual(finalReceipt);
    expect(await deviceRequest("model", modelRequest)).toEqual(model);
    expect(await deviceRequest("model", lostRequest)).toMatchObject({ status: "pending" });
    expect(gatewayCalls).toBe(modelLimit);
    const row = await f.db.executionDelivery.findUniqueOrThrow({ where: { id: target.deliveryId } }); expect(row.finalDigest).toBeString();
    expect(await f.db.executionAttempt.findUnique({ where: { id: target.attemptId } })).toMatchObject({ heldDirectory: expect.any(String), stopConfirmedAt: null });
    const statement = { target, kind: "exited", processIdentity, finalDigest: row.finalDigest, sourceThrough: 1, observedAt: new Date().toISOString() };
    const nativeCanonical = (value: unknown): string => value !== null && typeof value === "object" ? Array.isArray(value) ? `[${value.map(nativeCanonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${nativeCanonical(v)}`).join(",")}}` : JSON.stringify(value);
    const proof = { statement, signature: sign(null, createHash("sha256").update(nativeCanonical(statement)).digest(), key.privateKey).toString("base64") };
    await report("stop", proof, `stop:${hash(proof)}`); await deviceRequest("poll", { device });
    expect(await f.db.executionAttempt.findUnique({ where: { id: target.attemptId } })).toMatchObject({ heldDirectory: null, stopConfirmedAt: expect.any(Date) });
    // Exact caller scopes remain distinct: an owner cannot impersonate the module.
    expect((await f.post("/api/remote-execution/owner/v1/cleanup", { op: "preview", workId: start.workId, commandKey: "wrong-caller" }, ownerKey)).status).toBe(503);
    await deviceRequest("reconcile", { device, snapshotId: "after-process-restart", page: 0, complete: true, items: [{ deliveryId: target.deliveryId, launchDigest: target.launchDigest, state: "stopped", journalSeq: 4, sourceWatermark: 1 }] });
    expect(await deviceRequest("poll", { device })).toMatchObject({ reconciliationRequired: false });
    const ownerStart = { ...start, workId: "owner-cleanup-work", commandKey: "owner-start" };
    await service.admit({ workspaceId: "ws_default", ownerId: "owner", caller: { kind: "owner" } }, ownerStart);
    const ownerMessages = (await deviceRequest("poll", { device })).messages;
    launch = ownerMessages.find((message: { kind: string }) => message.kind === "launch").envelope;
    target = launch.packet.target;
    await report("started", processIdentity); await deviceRequest("poll", { device });
    const { moduleContext } = await import("../../../../../packages/engine/src/modules/steward/module-context");
    const { requestStatus } = await import("../../../../../packages/engine/src/modules/steward/module-status");
    const context = moduleContext(f.runtime.ports, "ws_default");
    await expect(requestStatus(context, receiver.moduleId, "paused", "offline owner execution")).rejects.toMatchObject({ code: "conflict" });
    expect(await f.db.module.findUniqueOrThrow({ where: { id: receiver.moduleId } })).toMatchObject({ status: "active", executionFenceAt: expect.any(Date) });
    expect((await deviceRequest("poll", { device })).messages.some((message: { kind: string }) => message.kind === "launch")).toBe(false);
    const ownerFinal = { ...final, outcome: "cancelled", error: "lifecycle drain", throughSourceSeq: 0 };
    await report("final", ownerFinal); await deviceRequest("poll", { device });
    const ownerRow = await f.db.executionDelivery.findUniqueOrThrow({ where: { id: target.deliveryId } });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: target.attemptId } })).toMatchObject({ heldDirectory: expect.any(String), stopConfirmedAt: null });
    const ownerStatement = { target, kind: "exited", processIdentity, finalDigest: ownerRow.finalDigest, sourceThrough: 0, observedAt: new Date().toISOString() };
    const ownerProof = { statement: ownerStatement, signature: sign(null, createHash("sha256").update(nativeCanonical(ownerStatement)).digest(), key.privateKey).toString("base64") };
    await report("stop", ownerProof, `stop:${hash(ownerProof)}`); await deviceRequest("poll", { device });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: target.attemptId } })).toMatchObject({ heldDirectory: null, stopConfirmedAt: expect.any(Date) });
    // Owner cleanup is a real kernel preview/confirm exchange relayed to the device.
    const preview = { op: "preview", workId: ownerStart.workId, commandKey: "http-preview" };
    expect((await f.post("/api/remote-execution/owner/v1/cleanup", preview)).status).toBe(401);
    expect(await owner("cleanup", preview)).toMatchObject({ state: "pending" });
    expect((await deviceRequest("poll", { device })).messages.some((message: { kind: string; envelope: { control?: { operation: string } } }) => message.kind === "control" && message.envelope.control?.operation === "cleanup")).toBe(true);
    const cleanup = { workId: ownerStart.workId, workspaceRef: launch.packet.launch.workspaceRef, state: "retained", reason: "offline preview", previewDigest: "d".repeat(64), operationKey: preview.commandKey };
    await report("cleanup", { controlKey: preview.commandKey, report: cleanup }, `cleanup:${hash([preview.commandKey])}`); await deviceRequest("poll", { device });
    expect(await owner("cleanup", preview)).toEqual(cleanup);
    expect((await f.post("/api/remote-execution/owner/v1/cleanup", { op: "confirm", workId: ownerStart.workId, commandKey: "bad-confirm", previewDigest: "e".repeat(64) }, ownerKey)).status).toBe(409);
    const confirm = { op: "confirm", workId: ownerStart.workId, commandKey: "http-confirm", previewDigest: cleanup.previewDigest };
    expect(await owner("cleanup", confirm)).toMatchObject({ state: "pending" }); await deviceRequest("poll", { device });
    const removed = { ...cleanup, state: "removed", operationKey: confirm.commandKey };
    await report("cleanup", { controlKey: confirm.commandKey, report: removed }, `cleanup:${hash([confirm.commandKey])}`); await deviceRequest("poll", { device });
    expect(await owner("cleanup", confirm)).toEqual(removed);
    await owner("device-revoke", { version: 1, requestKey: "http-revoke", deviceId: device.deviceId, generation: device.generation }); await deviceRequest("poll", { device });
    expect(await f.db.executionAuthority.findFirstOrThrow({ where: { receiverModuleId: receiver.moduleId } })).toMatchObject({ revokedAt: expect.any(Date) });
    expect((await f.post(prefix + "model", { version: 1, requestId: "revoked-model", ...modelRequest, key: "after-revoke" })).status).toBe(409);
    expect(await f.db.run.count()).toBe(2); expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain(deviceKey);
  } finally { await f.close(); }
}, 30_000);
