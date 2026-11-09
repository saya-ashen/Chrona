import { expect, test } from "bun:test";
import { generateKeyPairSync, sign, createHash, randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executionLaunchSchema, moduleManifestSchema, type ExecutionReceiver, type ExecutionPrincipal, type KernelExecutionStart } from "@chrona/contracts/steward";
import { startRemotePi } from "./pi";
import type { ModelInput } from "./protocol";

const command = process.env.CHRONA_TEST_PI_COMMAND;
const actualPi = test.skipIf(!command || process.platform !== "linux");
async function fixture(unknown = false, applicationRelay = false) {
  // The public Agent fixture owns a real SDK process and isolated database. Its
  // completion executable is a deterministic provider double; the device Pi is
  // the actual installed binary explicitly selected by the test operator.
  const { createExecutionDelivery, createExecutionEventStore, callSync, deliverExecutionApplication, moduleSupervisor } = await import("@chrona/engine");
  const { agentFixture, kernelOrigin } = await import("@chrona/engine/test-support");
  const f = await agentFixture(), db = f.ports.db;
  f.ports.executionEvents = createExecutionEventStore(f.ports);
  let server: ReturnType<typeof Bun.serve> | null = null;
  try {
    const providerPath = join(f.root, "pi"), capPath = join(f.root, "provider-cap"), callsPath = join(f.root, "provider-calls");
    let source = await readFile(providerPath, "utf8");
    source = source.replace("for await (const chunk of process.stdin) {};", "let prompt='';for await (const chunk of process.stdin) prompt+=chunk;");
    source = source.replace("text:'fixture completion'", `text:JSON.stringify(prompt.includes('native-tool-through-kernel')?{version:1,content:'Kernel-governed completion verified',tool_calls:[]}:{version:1,content:null,tool_calls:[{id:'read_fixture',name:'read',arguments:{path:'fixture.txt'}}]})`);
    const hook = "hooks.get('before_provider_request')({payload:{max_completion_tokens:65536}},{model:{provider,id,api:'openai-completions'}});";
    expect(source).toContain(hook);
    source = source.replace(hook, `const payload={max_completion_tokens:65536};hooks.get('before_provider_request')({payload},{model:{provider,id,api:'openai-completions'}});writeFileSync(${JSON.stringify(capPath)},String(payload.max_completion_tokens));writeFileSync(${JSON.stringify(callsPath)},'called',{flag:'a'});${unknown ? "process.exit(1);" : ""}`);
    await writeFile(providerPath, source, { mode: 0o755 });
    await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, "agent.configure", { config: { tiers: { fake: { model: "fake/exact" } }, "preferred-timeout-ms": 20_000 } });
    await db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { timezone: "UTC", moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 400, dailyCalls: 2, eventTimeoutMs: 20_000 } } } });
    const caller = await db.module.create({ data: { workspaceId: f.workspaceId, name: "model-caller", activeHash: "a".repeat(40) } });
    const manifest = moduleManifestSchema.parse({ name: caller.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.complete"], model: { tier: "fake", maxCalls: 2, maxOutputTokens: 400 } });
    await db.moduleVersion.create({ data: { moduleId: caller.id, hash: caller.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const receiverModule = await db.module.create({ data: { workspaceId: f.workspaceId, name: applicationRelay ? "remote-execution" : "delivery-app", activeHash: "b".repeat(40) } });
    const receiver: ExecutionReceiver = { workspaceId: f.workspaceId, moduleId: receiverModule.id, hash: receiverModule.activeHash!, activationId: receiverModule.activationId };
    const principal: ExecutionPrincipal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: caller.id, hash: caller.activeHash! } };
    const key = generateKeyPairSync("ed25519"), baseline = { kind: "commit" as const, digest: "a".repeat(40) }, service = createExecutionDelivery(f.ports);
    const credential = randomBytes(32).toString("base64url"), device = { deviceId: "fixture-device", generation: 1, incarnation: "fixture-incarnation", keyId: "fixture-key" };
    const appCall = async (tool: string, input: unknown, caller: "kernel" | "owner" = "kernel") => {
      try { return await deliverExecutionApplication(f.ports, receiver, tool, { input: JSON.stringify(input) }, caller); }
      catch (error) { throw new Error(`Fixture application tool ${tool} failed`, { cause: error }); }
    };
    const auth = () => ({ version: 1, requestId: randomUUID(), credential, device });
    if (applicationRelay) {
      const engineRoot = dirname(fileURLToPath(import.meta.resolve("@chrona/engine")));
      const source = join(engineRoot, "modules/steward/external/remote-execution");
      const appManifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
      await db.moduleVersion.create({ data: { moduleId: receiver.moduleId, hash: receiver.hash, manifest: appManifest, source: "user", status: "approved", intent: {}, report: {} } });
      const code = join(f.ports.dataDir, "platform/store", receiver.hash);
      await mkdir(code, { recursive: true }); await cp(source, code, { recursive: true });
      await appCall("bind", { version: 1, workspaceId: f.workspaceId, ownerId: "owner", app: { moduleId: receiver.moduleId, hash: receiver.hash, activationId: receiver.activationId } });
      const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
      const pairing = await appCall("pairing-create", { version: 1, requestKey: "pair", deviceId: device.deviceId, incarnation: device.incarnation, keyId: device.keyId, publicKey, expiresInMs: 60_000 }, "owner") as { code: string };
      await appCall("device-pair", { version: 1, requestId: randomUUID(), credential, code: pairing.code, publicKey });
      await appCall("mapping-set", { version: 1, requestKey: "mapping", projectRef: "fixture-project", device, workspaceRef: "fixture-cwd", baseline, directoryIdentity: "fixture-directory", workspaceModes: ["existing"], expectedRevision: 0 }, "owner");
    }
    await service.approveAuthority({ ...principal, caller: { kind: "owner" } }, { receiver, subjectId: "fixture-device", epoch: 1, keyId: "fixture-key", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), verifierId: "ed25519", verifierVersion: "1", approvalId: "owner-fixture-approval", scope: { callerModuleIds: [caller.id], targets: [{ targetRef: "fixture-target", targetRevision: 1, projectRef: "fixture-project", directoryIdentity: "fixture-directory", baseline, workspaceModes: ["existing"] }] } });
    if (applicationRelay) {
      await appCall("device-reconcile", { ...auth(), snapshotId: "startup", page: 0, complete: true, items: [] });
      expect(await appCall("device-poll", auth())).toMatchObject({ reconciliationRequired: false, messages: [] });
    }
    const input: KernelExecutionStart = { kind: "execution", workId: "model-work", commandKey: "start", goal: "Read fixture.txt and report what it contains.", placement: { kind: "application", applicationId: receiver.moduleId, targetRef: "fixture-target", targetRevision: 1, projectRef: "fixture-project" }, workspace: { mode: "existing", baseline }, queueExpiresAt: new Date(Date.now() + 60_000).toISOString(), budget: { timeoutMs: 40_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 } };
    await service.admit(principal, input);
    let delivery: { target: import("@chrona/contracts/steward").ExecutionDeliveryTarget; launch: unknown };
    if (applicationRelay) {
      const polled = await appCall("device-poll", auth()) as { messages: { kind: string; envelope: { packet: typeof delivery } }[] };
      delivery = polled.messages.find(item => item.kind === "launch")!.envelope.packet;
    } else { delivery = (await service.poll(receiver)).deliveries[0]!; await service.accept(receiver, delivery.target, "accept"); }
    const launch = executionLaunchSchema.parse(delivery.launch);
    const identity = { id: "actual-pi-fixture", scope: "descendants" };
    if (applicationRelay) await appCall("device-report", { ...auth(), report: { version: 1, requestId: randomUUID(), deliveryId: delivery.target.deliveryId, launchDigest: delivery.target.launchDigest, reportKey: "started", kind: "started", payload: identity } });
    else await service.started(receiver, delivery.target, "started", identity);
    const profiles = join(f.root, "remote-profiles"), helperPath = join(f.root, "guardian");
    await mkdir(profiles, { mode: 0o700 });
    await writeFile(join(f.input.cwd, "fixture.txt"), "native-tool-through-kernel");
    const processRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/process"))), "..");
    const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
    expect(spawnSync("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", join(processRoot, "native/guardian.c"), "-o", helperPath]).status).toBe(0);
    const requests: { key: string; input: ModelInput }[] = [];
    let text = "";
    const relayErrors: unknown[] = [], modelReceipts: unknown[] = [];
    server = applicationRelay ? Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${credential}`) return new Response(null, { status: 401 });
      try { const receipt = await appCall("device-model", { ...await request.json() as object, credential }); modelReceipts.push(receipt); return Response.json(receipt); }
      catch (error) { relayErrors.push(error); return Response.json({ error: "Application model relay failed" }, { status: 502 }); }
    } }) : null;
    const handle = startRemotePi({ command: command!, expectedVersion: "1.5.0", helperPath, chronaExtension: join(piRoot, "resources/chrona-tools.ts"), profileRoot: profiles, cwd: f.input.cwd, execution: launch.fence, goal: input.goal, deadlineAt: launch.deadlineAt, budget: input.budget,
      onText(delta) { text += delta; }, async model(key, input) {
        requests.push({ key, input });
        if (!server) return service.model(receiver, delivery.target, key, input);
        const response = await fetch(server.url, { method: "POST", headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify({ version: 1, requestId: randomUUID(), device, deliveryId: delivery.target.deliveryId, launchDigest: delivery.target.launchDigest, key, input }) });
        if (!response.ok) throw new Error("Application relay refused model request");
        return response.json();
      },
    });
    return { ...f, db, caller, receiver, service, delivery, identity, key, baseline, requests, handle, capPath, callsPath, relayErrors, modelReceipts, text: () => text, recreate: () => createExecutionDelivery(f.ports),
      appModel: (key: string, input: ModelInput) => appCall("device-model", { ...auth(), deliveryId: delivery.target.deliveryId, launchDigest: delivery.target.launchDigest, key, input }),
      async restartApp() { await moduleSupervisor(f.ports).settleModule(receiver.moduleId); await appCall("bind", { version: 1, workspaceId: f.workspaceId, ownerId: "owner", app: { moduleId: receiver.moduleId, hash: receiver.hash, activationId: receiver.activationId } }); },
      async close() { await server?.stop(true); await f.close(); } };
  } catch (error) { await server?.stop(true); await f.close(); throw error; }
}
const canonical = (value: unknown): string => value !== null && typeof value === "object" ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);
actualPi("actual Pi uses durable kernel model reservations and native tools through the real Agent SDK", async () => {
  const f = await fixture();
  try {
    expect(await f.handle.done).toMatchObject({ outcome: "finished", error: null });
    expect(f.text()).toContain("Kernel-governed completion verified"); expect(f.requests).toHaveLength(2);
    expect(await readFile(f.capPath, "utf8")).toBe("400");
    expect(await f.db.moduleCall.count({ where: { method: "model", status: "executed", moduleId: f.caller.id } })).toBe(2);
    const request = f.requests[0]!;
    const replay = await f.recreate().model(f.receiver, f.delivery.target, request.key, request.input);
    expect(replay).toMatchObject({ status: "completed" });
    expect(await readFile(f.callsPath, "utf8")).toBe("calledcalled");
    expect(await f.service.model(f.receiver, f.delivery.target, "excess-model", request.input)).toMatchObject({ status: "rejected", error: "budget_exceeded" });
    expect(await readFile(f.callsPath, "utf8")).toBe("calledcalled");
    const final = await f.service.final(f.receiver, f.delivery.target, "final", { outcome: "finished", error: null, throughSourceSeq: 0, baseline: f.baseline, finalMessage: null, missing: false });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.delivery.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
    const statement = { target: f.delivery.target, kind: "exited" as const, processIdentity: f.identity, finalDigest: final.finalDigest, sourceThrough: 0, observedAt: new Date().toISOString() };
    await f.service.stop(f.receiver, f.delivery.target, "stop", { statement, signature: sign(null, createHash("sha256").update(canonical(statement)).digest(), f.key.privateKey).toString("base64") });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.delivery.target.attemptId } })).toMatchObject({ stopConfirmedAt: expect.any(Date), heldDirectory: null });
  } finally { await f.handle.abort().catch(() => {}); await f.close(); }
}, 60_000);
actualPi("unknown provider execution stays reserved after kernel restart and cannot be reissued", async () => {
  const f = await fixture(true);
  try {
    expect((await f.handle.done).outcome).toBe("failed"); expect(f.requests).toHaveLength(1);
    const request = f.requests[0]!;
    expect(await f.recreate().model(f.receiver, f.delivery.target, request.key, request.input)).toMatchObject({ status: "pending" });
    await expect(f.recreate().model(f.receiver, f.delivery.target, request.key, { ...request.input, prompt: "changed" })).rejects.toMatchObject({ code: "conflict" });
    expect(await f.db.moduleCall.count({ where: { method: "model", status: "pending", moduleId: f.caller.id } })).toBe(1);
    expect(await readFile(f.callsPath, "utf8")).toBe("called");
    // A second independent uncertain completion consumes the final slot. A
    // recreated service must count both reservations against the same budget.
    await expect(f.recreate().model(f.receiver, f.delivery.target, "second-unknown", request.input)).rejects.toMatchObject({ code: "failed" });
    expect(await f.recreate().model(f.receiver, f.delivery.target, "third-denied", request.input)).toMatchObject({ status: "rejected", error: "budget_exceeded" });
    expect(await f.db.moduleCall.count({ where: { method: "model", status: "pending", moduleId: f.caller.id } })).toBe(2);
    expect(await readFile(f.callsPath, "utf8")).toBe("calledcalled");
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.delivery.target.attemptId } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: expect.any(String) });
  } finally { await f.handle.abort().catch(() => {}); await f.close(); }
}, 60_000);
actualPi("actual Pi traverses an authenticated HTTP fixture and the real remote app SDK/native carrier to kernel model reservations", async () => {
  const f = await fixture(false, true);
  try {
    const result = await f.handle.done;
    expect(f.relayErrors).toEqual([]);
    expect(f.modelReceipts).toEqual([expect.objectContaining({ status: "completed" }), expect.objectContaining({ status: "completed" })]);
    expect(result).toMatchObject({ outcome: "finished", error: null });
    expect(f.text()).toContain("Kernel-governed completion verified"); expect(f.requests).toHaveLength(2);
    expect(await readFile(f.capPath, "utf8")).toBe("400");
    expect(await f.db.moduleCall.count({ where: { moduleId: f.caller.id, method: "model", status: "executed" } })).toBe(2);
    expect(await f.db.executionReceipt.count({ where: { deliveryId: f.delivery.target.deliveryId, operation: "model" } })).toBe(2);
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.delivery.target.attemptId } })).toMatchObject({ heldDirectory: expect.any(String), stopConfirmedAt: null });
  } finally { await f.handle.abort().catch(() => {}); await f.close(); }
}, 60_000);
actualPi("actual remote app restart retains an unknown Pi model reservation without another provider execution", async () => {
  const f = await fixture(true, true);
  try {
    expect((await f.handle.done).outcome).toBe("failed"); expect(f.requests).toHaveLength(1);
    const request = f.requests[0]!;
    await f.restartApp();
    const pending = await f.appModel(request.key, request.input);
    expect(pending).toMatchObject({ status: "pending" });
    await f.restartApp();
    expect(await f.appModel(request.key, request.input)).toEqual(pending);
    await expect(f.appModel(request.key, { ...request.input, prompt: "changed" })).rejects.toMatchObject({ cause: { code: "conflict" } });
    expect(await readFile(f.callsPath, "utf8")).toBe("called");
    expect(await f.db.moduleCall.count({ where: { moduleId: f.caller.id, method: "model", status: "pending" } })).toBe(1);
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.delivery.target.attemptId } })).toMatchObject({ heldDirectory: expect.any(String), stopConfirmedAt: null });
  } finally { await f.handle.abort().catch(() => {}); await f.close(); }
}, 60_000);
