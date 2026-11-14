import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { admitContextPrimitive } from "./agent-context";
import { reconcileAgentStops } from "./agent-recovery";
import { registerAgentProvider } from "./agent-provider";
import { createRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testProviderManifest } from "./test-provider-process";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import "./module-effects";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test.each([false, true])("restart reconciles only a persisted stop receipt (confirmed=%s), never starts another Provider", async confirmed => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-stop-recovery-");
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }), () => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "recovery" } });
  const application = await db.module.create({ data: { workspaceId: workspace.id, name: "entry", activeHash: "version" } });
  await db.moduleVersion.create({ data: { moduleId: application.id, hash: "version", status: "approved", source: "user", manifest: { name: "entry", entry: "index.ts", effects: [], tools: [], tests: ["test.ts"] }, intent: {}, report: {} } });
  const principal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module" as const, moduleId: application.id, hash: "version" } };
  const calls: string[] = [];
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id, args } = event.trigger; calls.push(id);
    return { result: { operationId: String(args.operationId), outcome: confirmed ? { outcome: "finished", sessionId: "continued", error: null } : null, failure: !confirmed } };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(() => moduleSupervisor(ports).stop());
  const backend = await db.module.create({ data: { workspaceId: workspace.id, name: "test-provider", activeHash: "backend-version", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: backend.id, hash: "backend-version", status: "approved", source: "user", manifest: testProviderManifest, intent: {}, report: {} } });
  const binding = await registerAgentProvider(ports, workspace.id, { kind: "module", module: backend.name, moduleId: backend.id, hash: backend.activeHash! }, {
    id: "receipt-provider", name: "Receipt Provider", protocolVersion: 1,
    capabilities: { conversation: true, completion: false, native: false, images: false, interactions: false, resume: true },
    endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release" },
  });
  const context = await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string };
  await admitContextPrimitive(ports, principal, "run", { contextId: context.contextId, requestKey: "run", prompt: "offline", lane: "foreground", tools: [], content: [] });
  const runs = createRuns(ports, workspace.id), run = (await runs.claimNext("foreground"))!;
  // Admission already froze the selected Provider before this host died.
  expect(await db.agentRunProvider.findUniqueOrThrow({ where: { runId: run.id } })).toMatchObject({ providerId: binding.id, moduleId: backend.id, hash: backend.activeHash });
  await db.providerLaunch.create({ data: { runId: run.id, digest: "fixed" } });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "disconnected" });
  await db.audit.deleteMany();
  await reconcileAgentStops(ports, workspace.id);
  expect(calls).toEqual(["status"]);
  expect(await db.run.count()).toBe(1);
  expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ stopStatus: confirmed ? "confirmed" : "unknown", status: confirmed ? "finished" : "failed" });
  if (confirmed) expect(await db.session.findUniqueOrThrow({ where: { id: context.contextId } })).toMatchObject({ providerSessionId: "continued" });
});
