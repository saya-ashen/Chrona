import { expect, test } from "bun:test";
import { z } from "zod";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { moduleManifestSchema, kernelCleanupReceiptSchema, executionSignedStopSchema, type KernelExecutionStart } from "@chrona/contracts/steward";
import { createExecutionDelivery, kernelExecutionCleanup } from "@chrona/kernel";
import { testDb } from "@chrona/kernel/test-support";
import { registerLocalModule } from "../../kernel/src/modules/module-registry";
import { createServerApp } from "../../../apps/server/src/app";
import { createStewardRuntime } from "../../../apps/server/src/steward-runtime";
import { resetEnvCacheForTests } from "../../../apps/server/src/config/env";
import { privateRoot } from "@chrona/workspaces";
import { initializeConfig, localMapping, localPi, saveConfig } from "./config";
import { DeviceHTTP } from "./transport";
import { RemoteDevice } from "./device";
import { kernelPiDriver } from "./driver";

const command = process.env.CHRONA_TEST_PI_COMMAND;
// Explicit opt-in: these are real local processes, all HTTP binds to loopback,
// and the model I/O boundary is deterministic. No external model/network calls.
test.skipIf(!command || process.env.CHRONA_TEST_DEVICE_HTTP !== "1" || process.platform !== "linux")("standalone device traverses production HTTP, real app SDK and trusted kernel through actual Pi and cleanup", async () => {
  const oldKey = process.env.API_KEY, ownerKey = "offline-device-fixture-owner";
  process.env.API_KEY = ownerKey; resetEnvCacheForTests();
  const base = realpathSync(await mkdtemp(join(tmpdir(), "chrona-device-production-"))), db = testDb({ injectedAgent: false });
  let runtime: ReturnType<typeof createStewardRuntime> | undefined, server: ReturnType<typeof Bun.serve> | undefined, device: RemoteDevice | undefined;
  try {
    await db.workspace.create({ data: { id: "ws_default", name: "Device acceptance" } });
    const source = fileURLToPath(new URL("../../../.generated/applications/remote-execution", import.meta.url));
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(source, "module.json"), "utf8")));
    const appModule = await db.module.create({ data: { workspaceId: "ws_default", name: "remote-execution", activeHash: "c".repeat(40) } });
    await db.moduleVersion.create({ data: { moduleId: appModule.id, hash: appModule.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const code = join(base, "kernel/platform/store", appModule.activeHash!); await mkdir(code, { recursive: true }); await cp(source, code, { recursive: true });
    runtime = createStewardRuntime(db, { dataDir: join(base, "kernel"), provider: null });
    const app = await createServerApp({ steward: runtime }); server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    const root = join(base, "device"), project = join(base, "project"); await mkdir(project); await writeFile(join(project, "fixture.txt"), "native-device-http-tool");
    const git = (args: string[]) => { const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Offline", "-c", "user.email=offline@example.invalid", ...args], { cwd: project, encoding: "utf8" }); if (result.status !== 0) throw new Error("Fixture Git failed"); return result.stdout.trim(); };
    git(["init", "--quiet"]); git(["add", "."]); git(["commit", "--quiet", "-m", "baseline"]);
    const baseline = { kind: "commit" as const, digest: git(["rev-parse", "HEAD"]) }, config = initializeConfig(root, server.url.origin, "production-device");
    const owner = async (operation: string, input: unknown) => { const response = await fetch(new URL(`/api/remote-execution/owner/v1/${operation}`, server!.url), { method: "POST", headers: { authorization: `Bearer ${ownerKey}` }, body: JSON.stringify(input) }); const result = await response.json(); expect({ status: response.status, result }).toMatchObject({ status: 200 }); return result; };
    const pairing = await owner("pairing-create", { version: 1, requestKey: "pair", deviceId: config.deviceId, incarnation: config.incarnation, keyId: config.keyId, publicKey: config.publicKey, expiresInMs: 60000 });
    config.device = (await new DeviceHTTP(config.server, config.credential, null).pair(pairing.code, config.publicKey, "pair-request")).device;
    const mapping = localMapping({ workspaceRef: "local-project-alias", targetRef: "project", targetRevision: 1, projectRef: "project", path: project, baseline, workspaceModes: ["independent_worktree"] }); config.mappings.push(mapping);
    config.pi = localPi({ command: command!, expectedVersion: "1.5.0" }); saveConfig(root, config);
    await owner("mapping-set", { version: 1, requestKey: "mapping", projectRef: "project", device: config.device, workspaceRef: mapping.workspaceRef, baseline, directoryIdentity: mapping.directoryIdentity, workspaceModes: mapping.workspaceModes, expectedRevision: 0 });
    const receiver = { workspaceId: "ws_default", moduleId: appModule.id, hash: appModule.activeHash!, activationId: appModule.activationId };
    const caller = await db.module.create({ data: { workspaceId: "ws_default", name: "device-http-caller", activeHash: "d".repeat(40) } });
    const callerManifest = moduleManifestSchema.parse({ name: caller.name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], uses: ["agent.complete"], model: { tier: "fake", maxCalls: 2, maxOutputTokens: 400 } });
    await db.moduleVersion.create({ data: { moduleId: caller.id, hash: caller.activeHash!, manifest: callerManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const callerCode = join(base, "kernel/platform/store", caller.activeHash!); await mkdir(callerCode, { recursive: true }); await writeFile(join(callerCode, "index.ts"), 'import {on} from "chrona";on("tool",async()=>({result:null}));');
    await db.workspace.update({ where: { id: "ws_default" }, data: { settings: { timezone: "UTC", moduleModel: { maxCallsPerEvent: 2, maxOutputTokens: 400, dailyCalls: 2, eventTimeoutMs: 20000 } } } });
    let gatewayCalls = 0, sawNativeTool = false;
    registerLocalModule({ name: "agent", description: "Offline model boundary", unrecorded: ["complete"], tools: [{ name: "complete", description: "Offline completion", idempotent: false, visibility: ["kernel"], parameters: { type: "object", properties: {}, required: [] }, input: z.object({ prompt: z.string(), system: z.string().optional(), maxOutputTokens: z.number(), declaredTier: z.string(), effectiveHardLimits: z.object({ maxCallsPerEvent: z.number(), maxOutputTokens: z.number(), eventTimeoutMs: z.number() }), timeoutMs: z.number() }), output: z.object({ text: z.string(), inputTokens: z.number(), outputTokens: z.number() }) }], async handle(_context, _tool, args) {
      const input = z.object({ prompt: z.string(), maxOutputTokens: z.number(), effectiveHardLimits: z.object({ maxOutputTokens: z.number() }) }).parse(args);
      gatewayCalls++; expect(input.maxOutputTokens).toBeLessThanOrEqual(400); expect(input.effectiveHardLimits.maxOutputTokens).toBe(400);
      sawNativeTool ||= input.prompt.includes('"role":"tool"') && input.prompt.includes("native-device-http-tool");
      return { text: JSON.stringify(sawNativeTool ? { version: 1, content: "Full device HTTP completion verified", tool_calls: [] } : { version: 1, content: null, tool_calls: [{ id: "read_device_http", name: "read", arguments: { path: "fixture.txt" } }] }), inputTokens: 2, outputTokens: 3 };
    } }, db);
    await owner("authority", { receiver, subjectId: config.deviceId, epoch: config.device!.generation, keyId: config.keyId, publicKey: config.publicKey, verifierId: "ed25519", verifierVersion: "1", approvalId: "owner-approved-device", scope: { callerModuleIds: [caller.id], targets: [{ targetRef: mapping.targetRef, targetRevision: 1, projectRef: "project", directoryIdentity: mapping.directoryIdentity, baseline, workspaceModes: mapping.workspaceModes }] } });
    const helper = join(base, "guardian"), guardian = fileURLToPath(new URL("../../process/native/guardian.c", import.meta.url));
    expect(spawnSync("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", guardian, "-o", helper]).status).toBe(0);
    const profiles = join(root, "profiles"); privateRoot(profiles);
    device = new RemoteDevice(root, config, new DeviceHTTP(config.server, config.credential, config.device), kernelPiDriver({ pi: config.pi, helperPath: helper, chronaExtension: fileURLToPath(new URL("../../pi/resources/chrona-tools.ts", import.meta.url)), profileRoot: profiles }));
    await device.tick(); // Initial empty journal must reconcile BEFORE offer.
    const service = createExecutionDelivery(runtime.ports), principal = { workspaceId: "ws_default", ownerId: "owner", caller: { kind: "module" as const, moduleId: caller.id, hash: caller.activeHash! } };
    const input: KernelExecutionStart = { kind: "execution", workId: "full-device-work", commandKey: "start", goal: "Read fixture.txt and report its contents", placement: { kind: "application", applicationId: receiver.moduleId, targetRef: "project", targetRevision: 1, projectRef: "project" }, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: new Date(Date.now() + 60000).toISOString(), budget: { timeoutMs: 30000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 } };
    await service.admit(principal, input); await device.tick(); await device.idle(); await device.tick(); await device.tick();
    expect(gatewayCalls).toBe(2); expect(sawNativeTool).toBe(true);
    const attempt = device.journal.attempts()[0]!; expect(attempt.state).toBe("stopped"); expect(attempt.localWorkspaceRef).toBe("local-project-alias");
    expect(await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.delivery.packet.target.attemptId } })).toMatchObject({ heldDirectory: null, stopConfirmedAt: expect.any(Date) });
    expect(await db.moduleCall.count({ where: { moduleId: caller.id, method: "model", status: "executed" } })).toBe(2);
    const final = device.journal.db.query<{ envelope: string }, []>("SELECT envelope FROM outbox WHERE report_key='final'").get()!;
    expect(JSON.parse(final.envelope).payload).toMatchObject({ outcome: "finished", finalMessage: { text: "Full device HTTP completion verified" } });
    const previewCommand = { op: "preview" as const, workId: input.workId, commandKey: "preview" }; expect(await kernelExecutionCleanup(runtime.ports, principal, previewCommand)).toMatchObject({ state: "pending" });
    await device.tick(); await device.tick(); const preview = kernelCleanupReceiptSchema.parse(await kernelExecutionCleanup(runtime.ports, principal, previewCommand)); expect(preview.state).toBe("retained"); expect(typeof preview.previewDigest).toBe("string");
    const confirm = { op: "confirm" as const, workId: input.workId, commandKey: "confirm", previewDigest: preview.previewDigest! }; expect(await kernelExecutionCleanup(runtime.ports, principal, confirm)).toMatchObject({ state: "pending" });
    await device.tick(); await device.tick(); expect(await kernelExecutionCleanup(runtime.ports, principal, confirm)).toMatchObject({ state: "removed", previewDigest: preview.previewDigest });
    expect(await readFile(join(project, "fixture.txt"), "utf8")).toBe("native-device-http-tool");

    // Claim and cancel in the kernel before the device has seen this identity.
    // The authenticated app must relay it only for journal/never-started drain.
    const cancelledInput = { ...input, workId: "cancel-before-device-journal", commandKey: "start-cancelled" };
    await service.admit(principal, cancelledInput);
    const held = (await service.poll(receiver)).deliveries.find(packet => packet.target.workId === cancelledInput.workId)!;
    expect(held.launchable).toBe(true); expect(device.journal.get(held.target.deliveryId)).toBeNull();
    await service.control(principal, cancelledInput.workId, "cancel-before-device-offer", { operation: "cancel" });
    const beforeDrain = await db.executionAttempt.findUniqueOrThrow({ where: { id: held.target.attemptId } });
    expect(beforeDrain.stopConfirmedAt).toBeNull(); expect(beforeDrain.heldDirectory).not.toBeNull();
    await device.tick(); await device.tick(); await device.tick();
    const drained = device.journal.get(held.target.deliveryId)!;
    expect(drained.state).toBe("stopped"); expect(drained.processIdentity).toBeNull(); expect(drained.locks).toEqual([]);
    const drainReports = device.journal.db.query<{ envelope: string }, [string]>("SELECT envelope FROM outbox WHERE delivery_id=? ORDER BY id").all(held.target.deliveryId).map(row => JSON.parse(row.envelope) as { kind: string; payload: unknown });
    expect(drainReports.map(report => report.kind)).toEqual(["final", "stop", "control-ack"]);
    expect(drainReports[0]!.payload).toMatchObject({ outcome: "cancelled", throughSourceSeq: 0 });
    const proof = executionSignedStopSchema.parse(drainReports[1]!.payload);
    expect(proof.statement.kind).toBe("never_started"); expect(proof.statement.target).toEqual(held.target); expect(proof.statement.processIdentity).toBeNull();
    expect(await db.executionAttempt.findUniqueOrThrow({ where: { id: held.target.attemptId } })).toMatchObject({ heldDirectory: null, stopConfirmedAt: expect.any(Date) });
    expect(gatewayCalls).toBe(2); expect(await db.moduleCall.count({ where: { moduleId: caller.id, method: "model", status: "executed" } })).toBe(2);
  } finally {
    await device?.close(); await server?.stop(true); await runtime?.stop(); await db.$disconnect(); await rm(base, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = oldKey; resetEnvCacheForTests();
  }
}, 60000);
