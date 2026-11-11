import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderRunInput } from "@chrona/contracts/steward";
import { agent } from "./system/agent";
import { registerAgentProvider } from "./agent-provider";
import { startLocalProvider } from "./local-runtime";
import { createRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import "./module-effects";

const string = { type: "string" };
const declaration: AgentProviderRegistration = {
  id: "completion-fixture", name: "Completion fixture", protocolVersion: 1,
  capabilities: { conversation: false, completion: true, native: false, images: false, interactions: false, resume: false },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", complete: "complete" },
};

/** Real approved module routing, admission and SQLite accounting; only the external Provider is controlled. */
export async function approvedCompletionFixture(cleanups: (() => Promise<void>)[]) {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-late-completion-");
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "late completion", settings: { moduleModel: { maxCallsPerEvent: 4, maxOutputTokens: 20, dailyCalls: 10, eventTimeoutMs: 5000 } } } })).id;
  const requests: string[] = [], releases: { status: string; events: number }[] = [];
  let status: Record<string, unknown> = { outcome: null, failure: true };
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id, args } = event.trigger; requests.push(id);
    if (id === "health") return { result: { name: declaration.id, supportsRunModel: true, complete: true, available: true, sandboxed: false, error: null } };
    if (id === "complete") return { result: { operationId: args.commandKey } };
    if (id === "status") return { result: { operationId: args.operationId, ...status } };
    if (id === "release") releases.push({ status: (await db.moduleCall.findFirstOrThrow({ where: { method: "model" } })).status, events: await db.runEvent.count({ where: { kind: "completion" } }) });
    return { result: {} };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const backend = await db.module.create({ data: { workspaceId, name: "approved-completion-provider", status: "active", activeHash: "provider-v1" } });
  const tools = Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "health" ? {} : name === "complete" ? { commandKey: string, prompt: string, maxOutputTokens: { type: "number" }, timeoutMs: { type: "number" } } : { operationId: string } }, output: {} }));
  await db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: backend.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], tools }), intent: {}, report: {} } });
  await registerAgentProvider(ports, workspaceId, { kind: "module", module: backend.name, moduleId: backend.id, hash: backend.activeHash! }, declaration);
  const callerModule = await db.module.create({ data: { workspaceId, name: "completion-caller", status: "active", activeHash: "caller-v1" } });
  await db.moduleVersion.create({ data: { moduleId: callerModule.id, hash: callerModule.activeHash!, status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: callerModule.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.run", "agent.read", "agent.stop"], model: { tier: "any", maxCalls: 4, maxOutputTokens: 20 } }), intent: {}, report: {} } });
  const caller = { kind: "module" as const, module: callerModule.name, moduleId: callerModule.id, hash: callerModule.activeHash! };
  const invoke = (name: string, args: Record<string, unknown>, key = name) => agent.handle({ ports, workspaceId, caller, call: { id: key, key }, run: { eventKey: "execution:late-completion" } }, name, args);
  const admitted = await invoke("run", { kind: "completion", prompt: "private prompt", providerOptions: { maxOutputTokens: 10 } }, "admit") as { runId: string };
  const runs = createRuns(ports, workspaceId), claimed = await runs.claimNext("background"), row = await db.run.findUniqueOrThrow({ where: { id: admitted.runId } });
  expect(claimed?.runId).toBe(row.id);
  const input: ProviderRunInput = { runId: row.id, token: claimed!.token, lane: "background", cwd: row.cwd, sessionDir: join(dataDir, "sessions"), sessionId: null, prompt: row.prompt, systemPrompt: "system", resources: "configured", deadline: row.deadlineAt };
  async function becomeUnknown() {
    const handle = await startLocalProvider(ports, workspaceId, input);
    await expect(handle.done).rejects.toMatchObject({ code: "unknown" });
    await runs.finish(row.id, { outcome: "unavailable", sessionId: null, error: "Lost completion observation" });
  }
  return { db, ports, workspaceId, caller, input, runId: row.id, invoke, requests, releases, becomeUnknown, setStatus: (value: Record<string, unknown>) => { status = value; } };
}
