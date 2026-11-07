import "./module-effects";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease } from "./module-release";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "./ports";

/** Real notify SDK process for callers that compose activity through routed calls. */
export async function installActivityModule(ports: StewardPorts, workspaceId: string) {
  const dataDir = await mkdtemp("/tmp/chrona-activity-module-test-"), resources = join(dataDir, "platform/builtin");
  await mkdir(resources, { recursive: true });
  await cp(join(import.meta.dirname, "builtin/notify"), join(resources, "notify"), { recursive: true });
  await seedTestModuleRelease(resources, "notify");
  const runtime = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  ports.dataDir = dataDir;
  ports.moduleBuiltinResources = resources;
  ports.sandbox = { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule };
  const release = await resolveBuiltinRelease(ports, "notify");
  const module = await ports.db.module.create({ data: { workspaceId, name: "notify", builtin: true, activeHash: release.hash } });
  await ports.db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
  return async () => { await moduleSupervisor(ports).stop(); await rm(dataDir, { recursive: true, force: true }); };
}
