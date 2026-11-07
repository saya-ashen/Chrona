import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import "./module-effects";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { testDb } from "./test-db";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { createExternalModuleInstaller, installExternal, refreshInstallationReceipts } from "./module-install";
import { createModules } from "./modules";
import { moduleSupervisor } from "./module-supervisor";
import { callSync, CallError } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { setModuleSettings } from "./module-overview";
import type { StewardPorts } from "./ports";

test.each(["coding", "editor"] as const)("actual %s package installs through author tests and startup without configured projects", async name => {
  const dir = await mkdtemp("/tmp/chrona-coding-install-test-"), db = testDb();
  const workspace = await db.workspace.create({ data: { name: "Fresh coding installation" } });
  const sandbox = createScriptSandbox({ dataDir: dir, executionMode: "trusted-local" });
  const ports: StewardPorts = { db, dataDir: dir, publicUrl: null, now: () => new Date(), moduleExternalResources: join(dir, "external"), moduleTypecheck: resolve(import.meta.dirname, "../../../../integrations/src/steward/module-typecheck"), moduleSdk: resolve(import.meta.dirname, "../../../../integrations/src/steward/module-sdk"), sandbox: { ...sandbox.health, runModule: sandbox.runModule, startModule: sandbox.startModule } };
  registerSystemModules();
  ports.executionLocations = async () => [];
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  try {
    await cp(resolve(import.meta.dirname, "external", name), join(dir, "external", name), { recursive: true });
    await seedTestModuleRelease(ports.moduleExternalResources!, name);
    const request = { package: name, mode: "install" as const, requestKey: "fresh" };
    expect(await installExternal(ports, workspace.id, request)).toMatchObject({ status: "building" });
    await createModules(ports, workspace.id).buildPending();
    await refreshInstallationReceipts(ports, workspace.id);
    expect(await installExternal(ports, workspace.id, request)).toMatchObject({ status: "installed", error: null });
    const module = await db.module.findFirstOrThrow({ where: { name } });
    const version = await db.moduleVersion.findFirstOrThrow({ where: { moduleId: module.id } });
    expect(module.activeHash).toBe(version.hash);
    expect(version.status).toBe("approved");
    expect(version.report).toMatchObject({ typecheck: { status: "passed" }, tests: [{ exitCode: 0 }, { exitCode: 0 }] });
    if (name === "coding") {
      await moduleSupervisor(ports).refreshHealth(module.id);
      expect(moduleSupervisor(ports).readiness(module.id, version.hash)).toMatchObject({ status: "needs_configuration", stale: false });
      ports.executionLocations = async () => { throw new CallError("unavailable", "Execution placements unavailable"); };
      await setModuleSettings(ports, workspace.id, name, {});
      expect(moduleSupervisor(ports).readiness(module.id, version.hash)).toMatchObject({ status: "needs_configuration", stale: false });
      await expect(callSync(ports, { workspaceId: workspace.id, caller: { kind: "owner", via: "test" }, chain: [], path: [] }, "coding.work", { input: "{}" })).rejects.toMatchObject({ code: "invalid" });
    }
    expect(await db.run.count()).toBe(0);
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
}, 60_000);
