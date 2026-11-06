import { expect, test } from "bun:test";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BUILTIN_MODULE_NAMES } from "@chrona/contracts/steward";
import { seedTestModuleRelease, testReleasePackages } from "./module-release-test-fixture";
import { createExternalModuleInstaller, installExternal, refreshInstallationReceipts } from "./module-install";
import { buildPending } from "./module-build";
import { propose } from "./module-proposal";
import { resolveExternalRelease } from "./module-release";
import { moduleContext } from "./module-context";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { registerBuiltins } from "./module-builtin";
import { moduleSupervisor } from "./module-supervisor";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notice } from "./test-notices";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
const now = new Date("2026-10-22T12:00:00Z");
const shippedResources = resolve(import.meta.dirname, "builtin");
async function fixture(migrated = false) {
  const dataDir = await mkdtemp("/tmp/chrona-remind-");
  const resources = join(dataDir, "resources", "builtin"), externalResources = join(dataDir, "resources", "external");
  await cp(shippedResources, resources, { recursive: true });
  for (const name of BUILTIN_MODULE_NAMES) await seedTestModuleRelease(resources, name);
  await cp(resolve(import.meta.dirname, "external/remind"), join(externalResources, "remind"), { recursive: true });
  await seedTestModuleRelease(externalResources, "remind");
  const db = testDb();
  await db.workspace.create({ data: { id: "w", name: "Reminders" } });
  if (migrated) {
    await db.module.create({ data: { id: "remind-id", workspaceId: "w", name: "remind", builtin: false } });
    await db.schedule.create({ data: { workspaceId: "w", mode: "module", moduleId: "remind-id", rule: { kind: "at", at: now.toISOString() }, text: "legacy-00000000-0000-0000-0000-000000000001", label: "Old label", createdBy: "user", nextAt: now, payload: { text: "Migrated reminder" } } });
  }
  const runtime = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, moduleBuiltinResources: resources, packages: testReleasePackages(resources),
    moduleExternalResources: externalResources, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  async function install() {
    await registerBuiltins(ports, "w");
    if (migrated) {
      const release = await resolveExternalRelease(ports, "remind");
      await propose(moduleContext(ports, "w"), { root: externalResources, dir: "remind", intent: { changes: ["Installed reminder baseline"], preserves: [] }, expectedModuleId: "remind-id", sourceCommit: release.hash, gitBundle: release.git! }, "user");
      await buildPending(moduleContext(ports, "w"));
      expect(await db.module.findUniqueOrThrow({ where: { id: "remind-id" } })).toMatchObject({ activeHash: release.hash });
      await appendFile(join(externalResources, "remind/index.ts"), "\n// Synthetic official update; preserve reminder behavior.\n");
      const updated = await seedTestModuleRelease(externalResources, "remind");
      expect(updated.commit).not.toBe(release.hash);
    }
    const expectedHash = (await resolveExternalRelease(ports, "remind")).hash;
    expect(expectedHash).toMatch(/^[a-f0-9]{40}$/);
    const request = { package: "remind" as const, mode: migrated ? "update" as const : "install" as const, requestKey: "remind-fixture" };
    await installExternal(ports, "w", request);
    await buildPending(moduleContext(ports, "w"));
    await refreshInstallationReceipts(ports, "w");
    expect(await installExternal(ports, "w", request)).toMatchObject({ status: "installed", hash: expectedHash });
  }
  const service = createStewardService(ports), api = service.forWorkspace("w");
  return { db, ports, service, api, install, async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

if (!sandbox.health.available) console.info("SKIP remind real process: bwrap sandbox unavailable");
const sandboxTest = sandbox.health.available ? test : test.skip;
sandboxTest("m_remind_create uses explicit external installation and author tests; its timer survives reactivation", async () => {
  const f = await fixture();
  try {
    await f.install();
    const module = await f.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: "w", name: "remind" } } });
    expect(module).toMatchObject({ builtin: false, status: "active" });
    expect(await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ report: { tests: [{ exitCode: 0 }] } });
    expect(await f.db.approval.count()).toBe(0);
    const session = await f.db.session.create({ data: { workspaceId: "w", key: "web:test", source: "web" } });
    await f.api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Fixture" });
    const run = (await f.api.runs.claimNext("foreground"))!;
    await expect(f.service.tools.call(run.token, "chrona_schedule", { mode: "remind", rule: { kind: "at", at: now.toISOString() }, text: "喝水", label: "Drink water" })).rejects.toThrow();
    const created = await f.service.tools.call(run.token, "m_remind_create", { rule: JSON.stringify({ kind: "at", at: now.toISOString() }), text: "喝水", label: "Drink water" }) as { result: { key: string } };
    expect(await f.db.schedule.findFirstOrThrow({ where: { text: created.result.key } })).toMatchObject({ mode: "module", moduleId: module.id, payload: { text: "喝水" }, label: "Drink water" });
    await f.api.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null });
    await f.api.modules.activate(module.id, module.activeHash!, "rollback");
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await f.api.schedules.fireDue()).toBe(0);
    expect(await notice(f.db, { moduleId: module.id, title: "提醒" })).toMatchObject({ title: "提醒", body: "喝水" });
    expect(await f.db.moduleCall.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ method: "call", status: "executed" });
    expect(await f.db.moduleRun.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ exitCode: 0 });
    expect(await f.db.run.count()).toBe(1);
  } finally { await f.close(); }
}, 30_000);

sandboxTest("explicit external update preserves a stored reminder timer the module lists and fires", async () => {
  const f = await fixture(true);
  try {
    expect(await f.db.schedule.findFirstOrThrow()).toMatchObject({ mode: "module", moduleId: "remind-id", text: "legacy-00000000-0000-0000-0000-000000000001", payload: { text: "Migrated reminder" }, label: "Old label" });
    await f.install();
    const module = await f.db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: "w", name: "remind" } } });
    expect(module).toMatchObject({ id: "remind-id", builtin: false, status: "active" });
    expect(await f.api.schedules.forModule(module.id, "remind").list()).toMatchObject([{ key: "legacy-00000000-0000-0000-0000-000000000001", payload: { text: "Migrated reminder" } }]);
    expect(await f.api.schedules.fireDue()).toBe(1);
    expect(await notice(f.db, { moduleId: module.id, title: "提醒" })).toMatchObject({ title: "提醒", body: "Migrated reminder" });
    expect(await f.db.run.count()).toBe(0);
  } finally { await f.close(); }
}, 30_000);
