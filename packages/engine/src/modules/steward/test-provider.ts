import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AgentProviderRegistration } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callSync, kernelOrigin } from "./module-calls";
import { testProviderManifest, testProviderProcess } from "./test-provider-process";
import { registerLocalRuntime } from "./local-runtime";
import { registerSystemModules } from "./system-modules";
import "./module-effects";

type Fixture = { ports?: StewardPorts; install(workspaceId: string): Promise<void> };
const fixtures = new WeakMap<StewardPorts["db"], Fixture>();
const moduleName = "test-provider";
const versionHash = "test-provider-wire-v1";

/** Prepare fixture state without installing a module or taking over the kernel's agent namespace. */
export function registerTestProvider(db: StewardPorts["db"]): StewardPorts["db"] {
  const fixture: Fixture = { async install() { throw new Error("Bind testProviderPorts before installing a Provider fixture"); } };
  const extended = db.$extends({ query: { workspace: { async create({ args, query }) {
    // Include identity for fixture installation while preserving the caller's selection.
    const workspace = await query(args.select ? { ...args, select: { ...args.select, id: true } } : args);
    if (fixture.ports?.provider && workspace.id) await fixture.install(workspace.id);
    if (args.select && !args.select.id) delete workspace.id;
    return workspace;
  } } } }) as unknown as StewardPorts["db"];
  fixtures.set(extended, fixture);
  return extended;
}

/**
 * Bind the fake adapter and sandbox explicitly once ports exist. Call before creating
 * workspaces (outside a transaction), or after committing existing workspaces.
 * testDb stays synchronous; databases that never bind ports acquire no extra modules.
 */
export async function testProviderPorts<T extends StewardPorts>(ports: T): Promise<T> {
  const fixture = fixtures.get(ports.db);
  if (!fixture) throw new Error("testProviderPorts requires testDb() with injectedAgent enabled");
  if (fixture.ports) {
    if (fixture.ports !== ports) throw new Error("Test Provider ports are already bound for this database");
    for (const workspace of await ports.db.workspace.findMany({ select: { id: true } })) await fixture.install(workspace.id);
    return ports;
  }
  registerSystemModules();
  registerLocalRuntime();
  const modules = new Map<string, string>();
  const peer = testProviderProcess(ports, modules);
  const sandbox = ports.sandbox;
  ports.sandbox = { available: sandbox?.available ?? true, isolated: sandbox?.isolated ?? false, ...sandbox, startModule(input) {
    if (basename(input.codeDir) === versionHash && modules.has(basename(input.dataDir))) return peer.startModule(input);
    if (!sandbox?.startModule) throw new Error("Module sandbox unavailable");
    return sandbox.startModule(input);
  } };
  fixture.ports = ports;
  fixture.install = async workspaceId => {
    if (!ports.provider) return;
    const module = await ports.db.module.upsert({ where: { workspaceId_name: { workspaceId, name: moduleName } }, create: { workspaceId, name: moduleName, status: "active", activeHash: versionHash }, update: {} });
    if (module.activeHash !== versionHash || module.status !== "active") throw new Error("Test Provider module identity changed");
    await ports.db.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: module.id, hash: versionHash } }, create: { moduleId: module.id, hash: versionHash, manifest: testProviderManifest, status: "approved", source: "user", intent: {}, report: {} }, update: {} });
    modules.set(module.id, workspaceId);
    const provider = ports.provider;
    const declaration: AgentProviderRegistration = {
      id: provider.name, name: provider.name, protocolVersion: 1,
      capabilities: { conversation: true, completion: !!provider.complete, native: false, images: true, interactions: true, resume: true },
      endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", transcript: "transcript", ...(provider.complete ? { complete: "complete" } : {}) },
    };
    await callSync(ports, { ...kernelOrigin(workspaceId), caller: { kind: "module", module: moduleName, moduleId: module.id, hash: versionHash } }, "agent.register", declaration, { key: `test-provider:${randomUUID()}` });
    // Rebinding a renamed fake replaces only this fixture module's old registration.
    await ports.db.agentProvider.deleteMany({ where: { workspaceId, moduleId: module.id, id: { not: provider.name } } });
  };
  for (const workspace of await ports.db.workspace.findMany({ select: { id: true } })) await fixture.install(workspace.id);
  return ports;
}
