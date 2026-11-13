import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { moduleManifestSchema, type ProviderAdapter, type ProviderRunInput } from "@chrona/contracts/steward";
import piManifest from "./external/pi/module.json";
import { registerAgentProvider } from "./agent-provider";
import { registerLocalRuntime } from "./local-runtime";
import { moduleSupervisor } from "./module-supervisor";
import { runOwnerBuild } from "./owner-build-run";
import { startOwnerBuild } from "./owner-build";
import type { StewardPorts } from "./ports";
import * as runsModule from "./runs";
import { registerSystemModules } from "./system-modules";
import { testDb } from "./test-db";
import { testProviderProcess } from "./test-provider-process";
import "./module-effects";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = { name: "owner-app", goal: "Offline recovery", intent: { changes: ["repair"], preserves: [] }, requestKey: "offline-build",
  execution: { provider: "pi", model: "openai/gpt-6.1-sol", timeoutMinutes: 10, maxSubmissions: 1 } };

async function fixture({ available = true, failStart = false } = {}) {
  registerSystemModules();
  registerLocalRuntime();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-owner-build-"));
  const workspace = await db.workspace.create({ data: { name: "Offline recovery" } });
  const hash = "offline-pi-v1", manifest = moduleManifestSchema.parse(piManifest);
  const pi = await db.module.create({ data: { workspaceId: workspace.id, name: "pi", status: "active", activeHash: hash } });
  await db.moduleVersion.create({ data: { moduleId: pi.id, hash, manifest, status: "approved", source: "user", intent: {}, report: {} } });
  const other = await db.module.create({ data: { workspaceId: workspace.id, name: "unrelated", status: "active", activeHash: "other-v1" } });
  await db.moduleVersion.create({ data: { moduleId: other.id, hash: "other-v1", manifest: { ...manifest, name: "unrelated", keepAlive: true }, status: "approved", source: "user", intent: {}, report: {} } });
  const seen: ProviderRunInput[] = [], health: string[] = [], started: string[] = [];
  const provider: ProviderAdapter = { name: "pi", supportsRunModel: true,
    async health() { health.push("pi.health"); return { available, sandboxed: false, error: available ? null : "Fixture unavailable" }; },
    start(input) {
      seen.push(input);
      if (failStart) throw new Error("Fixture start failed");
      return { async inject() {}, async abort() {}, done: Promise.resolve({ outcome: "finished", sessionId: null, error: null }) };
    },
  };
  const integrations = resolve(import.meta.dirname, "../../../../integrations/src/steward");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null,
    moduleSdk: join(integrations, "module-sdk"), moduleTypecheck: join(integrations, "module-typecheck") };
  const peer = testProviderProcess({ ...ports, provider }, new Map([[pi.id, workspace.id]]));
  ports.sandbox = { available: true, isolated: false, startModule(input) {
    started.push(basename(input.dataDir));
    if (basename(input.dataDir) !== pi.id) throw new Error("Unrelated module started");
    return peer.startModule(input);
  } };
  cleanups.push(async () => { try { await moduleSupervisor(ports).stop(); } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } });
  await registerAgentProvider(ports, workspace.id, { kind: "module", module: "pi", moduleId: pi.id, hash }, {
    id: "pi", name: "Pi", protocolVersion: 1, capabilities: { conversation: true, completion: false, native: false, images: true, interactions: true, resume: true },
    endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", transcript: "transcript" },
  });
  function expectStopped() {
    expect(health).toContain("pi.health");
    expect(started).toEqual([pi.id]);
    expect(moduleSupervisor(ports).liveHashes().size).toBe(0);
    expect(peer.processes.every(process => process.socket.destroyed)).toBe(true);
    expect(moduleSupervisor(ports).status(other.id, "other-v1", true).state).not.toBe("running");
  }
  return { db, ports, workspace, seen, expectStopped };
}

test("offline recovery reaches registered active Pi without starting unrelated modules", async () => {
  const f = await fixture();
  const receipt = await runOwnerBuild(f.ports, f.workspace.id, request);
  expect(typeof receipt.runId).toBe("string");
  expect(receipt.duplicate).toBe(false);
  const run = await f.db.run.findUniqueOrThrow({ where: { id: receipt.runId } });
  expect(run.endedAt).not.toBeNull();
  expect(run.error ?? "").not.toContain("Module supervisor stopped");
  expect(f.seen).toHaveLength(1);
  expect(f.seen[0]).toMatchObject({ lane: "build", model: request.execution.model });
  f.expectStopped();
});

test("offline recovery stops its Provider after a duplicate return", async () => {
  const f = await fixture();
  const previous = await startOwnerBuild(f.ports, f.workspace.id, request);
  await f.db.run.update({ where: { id: previous.runId }, data: { status: "finished", endedAt: f.ports.now() } });
  expect(await runOwnerBuild(f.ports, f.workspace.id, request)).toMatchObject({ duplicate: true, runId: previous.runId });
  expect(f.seen).toHaveLength(0);
  f.expectStopped();
});

test("offline recovery stops Pi when Provider preflight reports unavailable", async () => {
  const f = await fixture({ available: false });
  await expect(runOwnerBuild(f.ports, f.workspace.id, request)).rejects.toThrow("Authorized build Provider cannot enforce this build's exact model");
  expect(f.seen).toHaveLength(0);
  f.expectStopped();
});

test("offline recovery stops Pi when admission rejects the requested limits", async () => {
  const f = await fixture();
  await expect(runOwnerBuild(f.ports, f.workspace.id, { ...request, execution: { ...request.execution, timeoutMinutes: 120 } })).rejects.toThrow("Build limits cannot exceed the owner's configured caps");
  expect(f.seen).toHaveLength(0);
  f.expectStopped();
});

test("offline recovery stops Pi when the queued build cannot be claimed", async () => {
  const f = await fixture(), createRuns = runsModule.createRuns;
  const factory = spyOn(runsModule, "createRuns").mockImplementation((...args) => ({ ...createRuns(...args), async claimNext() { return null; } }));
  try {
    await expect(runOwnerBuild(f.ports, f.workspace.id, request)).rejects.toThrow("Recovery build was not admitted");
    expect(f.seen).toHaveLength(0);
    f.expectStopped();
  } finally { factory.mockRestore(); }
});

test("offline recovery stops Pi after a Provider execution failure", async () => {
  const f = await fixture({ failStart: true });
  await expect(runOwnerBuild(f.ports, f.workspace.id, request)).rejects.toThrow("pi.start: Private operation failed");
  expect(f.seen).toHaveLength(1);
  f.expectStopped();
});
