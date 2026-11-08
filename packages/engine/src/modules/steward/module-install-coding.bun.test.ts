import { expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import "./module-effects";
import { agentFixture } from "./agent-application.fixtures";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { createExternalModuleInstaller, installExternal, refreshInstallationReceipts } from "./module-install";
import { createModules } from "./modules";
import { moduleSupervisor } from "./module-supervisor";
import { callSync, CallError } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { setModuleSettings } from "./module-overview";


test.each(["coding", "editor"] as const)("actual %s package installs through author tests and startup without configured projects", async name => {
  const f = await agentFixture(), ports = f.ports, db = ports.db, dir = ports.dataDir;
  const workspace = { id: f.workspaceId };
  await db.run.delete({ where: { id: "agent-run" } });
  ports.moduleExternalResources = join(dir, "external");
  ports.moduleTypecheck = resolve(import.meta.dirname, "../../../../integrations/src/steward/module-typecheck");
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
  } finally { await f.close(); }
}, 60_000);
