import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleManifestSchema, type AgentProviderRegistration } from "@chrona/contracts/steward";
import { registerAgentProvider } from "../agent/agent-provider";
import { startLocalProvider } from "./local-runtime";
import { createRuns } from "./runs";
import { callSync, kernelOrigin } from "../modules/module-calls";
import { testModuleProcess } from "../__testing__/module-test-process";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import "../modules/module-effects";

// The retired application-admit layer duplicated this gate. A registered fake
// isolates authentication from Pi policy and records every endpoint dispatch.
test.each([
  [null, null, true], [null, 30_000, true],
  [1, null, false], [1, 60_001, false], [1, 60_000, true], [1, 30_000, true],
] as const)("registered provider timeout=%s deadline offset=%s accepted=%s", async (minutes, offset, accepted) => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-deadline-auth-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id: name, args } = event.trigger; requests.push({ name, args });
    if (name === "health") return { result: { name: "deadline", available: true, sandboxed: false, error: null } };
    return { result: {} };
  });
  const now = new Date(), ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "deadline auth", settings: { runTimeoutMinutes: minutes } } })).id;
    const declaration: AgentProviderRegistration = { id: "deadline", name: "Deadline fake", protocolVersion: 1,
      capabilities: { conversation: true, completion: false, native: false, images: false, interactions: false, resume: false },
      endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release" } };
    const string = { type: "string" }, object = { type: "object", properties: {}, additionalProperties: true };
    const properties = { ...Object.fromEntries(["operationId", "runId", "token", "lane", "cwd", "sessionDir", "prompt", "systemPrompt", "resources", "callbacks"].map(key => [key, string])), sessionId: { type: ["string", "null"] }, deadline: { type: ["string", "null"] }, providerOptions: object };
    const module = await db.module.create({ data: { workspaceId, name: "deadline-backend", status: "active", activeHash: "v1" } });
    const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["runtime-callback.event"], tools: Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "health" ? {} : properties }, output: {} })) });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "user", status: "approved", intent: {}, report: {} } });
    const caller = { kind: "module" as const, module: module.name, moduleId: module.id, hash: "v1" };
    await registerAgentProvider(ports, workspaceId, caller, declaration);
    const sessionId = (await db.session.create({ data: { workspaceId, key: "web:deadline", source: "owner" } })).id;
    const runs = createRuns(ports, workspaceId);
    await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
    const run = (await runs.claimNext("foreground"))!;
    const deadline = offset === null ? null : new Date(now.getTime() + offset);
    const before = requests.length;
    const start = startLocalProvider(ports, workspaceId, { runId: run.id, token: run.token, lane: "foreground", cwd: run.cwd, sessionDir: run.cwd, sessionId: null, prompt: run.prompt, systemPrompt: "", resources: "minimal", deadline });
    if (accepted) {
      const handle = await start;
      expect(await db.providerLaunch.count({ where: { runId: run.id } })).toBe(1);
      const dispatched = requests.find(row => row.name === "start")!.args;
      expect(dispatched.deadline).toBe(deadline?.toISOString() ?? null);
      await callSync(ports, { ...kernelOrigin(workspaceId), caller }, "runtime-callback.event", { callbackId: dispatched.callbacks, event: { kind: "settled", operationId: run.id, outcome: { outcome: "finished", sessionId: null, error: null } } });
      expect(await handle.done).toMatchObject({ outcome: "finished" });
    } else {
      await expect(start).rejects.toMatchObject({ code: "forbidden" });
      expect(requests).toHaveLength(before);
      expect(await db.providerLaunch.count({ where: { runId: run.id } })).toBe(0);
    }
    expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ deadlineAt: run.deadlineAt, leaseUntil: run.leaseUntil });
  } finally {
    await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true });
    await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true });
  }
});
