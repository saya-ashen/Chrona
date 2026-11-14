import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moduleManifestSchema, type AgentProviderRegistration } from "@chrona/contracts/steward";
import { executeContextCommand, type ContextCommand } from "./agent-context-admission";
import { selectContextTools } from "./agent-context-tools";
import { registerAgentProvider, type ProviderBinding } from "./agent-provider";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import type { StewardPorts } from "./ports";
import { createRuns } from "./runs";
import { testDb } from "./test-db";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-drain-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "provider drain" } })).id;
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-13T00:00:00Z") };
  async function install(name: string, tools: unknown[] = []) {
    const module = await db.module.create({ data: { workspaceId, name, status: "active", activeHash: `${name}-v1` } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], uses: [], keepAlive: true, tools });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    return module;
  }
  async function provider(name: string, id = name) {
    const declaration: AgentProviderRegistration = {
      id, name, protocolVersion: 1,
      capabilities: { conversation: true, completion: false, native: true, images: false, interactions: false, resume: true },
      endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", native: "native" },
    };
    const module = await install(name, Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: {} }, output: {} })));
    await registerAgentProvider(ports, workspaceId, { kind: "module", module: name, moduleId: module.id, hash: module.activeHash! }, declaration);
    const registration = await db.agentProvider.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId, id } } });
    return { module, binding: { ...registration, providerId: id } satisfies ProviderBinding };
  }
  const caller = await install("caller");
  const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: caller.id, hash: caller.activeHash! } };
  const selection = await selectContextTools(ports, principal, []);
  function command(name: string, args: Record<string, unknown>, settle = false, binding?: ProviderBinding) {
    return db.$transaction(tx => executeContextCommand(ports, tx, { principal, name, args, settle, selection, binding } satisfies ContextCommand));
  }
  const runs = createRuns(ports, workspaceId);
  async function run(binding: ProviderBinding) {
    const admitted = await command("run", { requestKey: crypto.randomUUID(), kind: "conversation", lane: "background", prompt: "drain test", tools: [], content: [] }, false, binding);
    const runId = (admitted.output as { runId: string }).runId;
    expect((await runs.claimNext("background"))?.id).toBe(runId);
    return runId;
  }
  async function finish(runId: string) {
    await runs.finish(runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
    expect(await db.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: "finished", stopStatus: "confirmed" });
  }
  const idle = (moduleId: string) => db.$transaction(tx => assertExecutionModuleIdle(tx, moduleId));
  return { db, workspaceId, caller, principal, provider, command, run, finish, idle };
}

test("unsettled native admission blocks the bound provider after confirmed stop until exact settlement during drain", async () => {
  const f = await fixture(), bound = await f.provider("bound"), unrelated = await f.provider("unrelated");
  const unrelatedRunId = await f.run(unrelated.binding);
  await f.finish(unrelatedRunId);
  const runId = await f.run(bound.binding);
  const args = { runId, requestKey: "native-unknown", request: { operationId: unrelatedRunId, runId: unrelatedRunId, providerId: unrelated.binding.providerId, moduleId: unrelated.module.id, hash: unrelated.binding.hash } };
  expect(await f.command("native", args)).toMatchObject({ duplicate: false, output: { perform: true, operationId: runId } });
  await f.finish(runId);
  expect(await f.db.agentCommand.findFirstOrThrow({ where: { operation: "native" } })).toMatchObject({ settled: false, moduleId: f.caller.id, hash: f.principal.caller.hash });

  // Even reassigning the registration id must not move the admitted effect to a new backend.
  await f.db.agentProvider.delete({ where: { workspaceId_id: { workspaceId: f.workspaceId, id: bound.binding.providerId } } });
  const replacement = await f.provider("replacement", bound.binding.providerId);
  await expect(f.idle(f.caller.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(f.idle(bound.module.id)).rejects.toMatchObject({ code: "conflict" });
  await f.idle(unrelated.module.id);
  await f.idle(replacement.module.id);

  await f.db.module.updateMany({ where: { id: { in: [f.caller.id, bound.module.id] } }, data: { executionFenceAt: new Date() } });
  await expect(f.command("native", args)).rejects.toMatchObject({ code: "unknown" });
  await expect(f.idle(bound.module.id)).rejects.toMatchObject({ code: "conflict" });
  await f.command("native", args, true);
  expect(await f.db.agentCommand.findFirstOrThrow({ where: { operation: "native" } })).toMatchObject({ settled: true });
  await f.idle(f.caller.id);
  await f.idle(bound.module.id);
});

test("provider drain attributes a command only to the exact admitted caller version and workspace", async () => {
  const f = await fixture(), bound = await f.provider("bound"), runId = await f.run(bound.binding);
  await f.command("native", { runId, requestKey: "native-unknown", request: {} });
  await f.finish(runId);
  const receipt = await f.db.agentCommand.findFirstOrThrow({ where: { operation: "native" } });
  const foreignWorkspace = await f.db.workspace.create({ data: { name: "other workspace" } });
  const foreignModule = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "other caller" } });
  for (const identity of [{ hash: "other-version" }, { moduleId: foreignModule.id }, { workspaceId: foreignWorkspace.id }]) {
    await f.db.agentCommand.update({ where: { id: receipt.id }, data: { hash: receipt.hash, moduleId: receipt.moduleId, workspaceId: receipt.workspaceId, ...identity } });
    await f.idle(bound.module.id);
  }
  await f.db.agentCommand.update({ where: { id: receipt.id }, data: { hash: receipt.hash, moduleId: receipt.moduleId, workspaceId: receipt.workspaceId } });
  await expect(f.idle(bound.module.id)).rejects.toMatchObject({ code: "conflict" });
});
