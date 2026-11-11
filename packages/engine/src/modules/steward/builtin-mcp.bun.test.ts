import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleContext, type TestReport } from "./module-context";
import { runTests } from "./module-continuity";
import { testDb } from "./test-db";
import { createExternalModuleInstaller, installExternal, refreshInstallationReceipts } from "./module-install";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { seedTestModuleRelease, testReleasePackages, testReleaseRuntimeChecks } from "./module-release-test-fixture";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { buildPending } from "./module-build";
import { moduleSupervisor } from "./module-supervisor";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { admitted } from "./module-call-admission";

test("MCP installs from its pinned ordinary release, passes SDK checks and activates without a Provider", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-mcp-release-")), db = testDb({ injectedAgent: false });
  const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const resources = join(dataDir, "resources", "external");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: resources, ...testReleaseRuntimeChecks(),
    packages: testReleasePackages(resources), sandbox: { ...sandbox.health, runModule: sandbox.runModule, startModule: sandbox.startModule } };
  try {
    await cp(join(import.meta.dirname, "external", "mcp"), join(resources, "mcp"), { recursive: true });
    const seed = await seedTestModuleRelease(resources, "mcp");
    const release = await resolveExternalRelease(ports, "mcp");
    expect(release).toMatchObject({ name: "mcp", origin: "external", hash: seed.commit, git: { commit: seed.commit } });
    expect(release.manifest).toMatchObject({ name: "mcp", keepAlive: true, listen: "/api/mcp", uses: ["*", "web.page-set"] });
    await expect(resolveBuiltinRelease(ports, "mcp")).rejects.toMatchObject({ code: "not_found", reason: "release_not_found" });
    const workspace = await db.workspace.create({ data: { name: "MCP ordinary release" } });
    ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
    const request = { package: "mcp" as const, mode: "install" as const, requestKey: "mcp-release" };
    const queued = await installExternal(ports, workspace.id, request);
    expect(queued).toMatchObject({ status: "building", hash: seed.commit, approvalId: null });
    await buildPending(moduleContext(ports, workspace.id));
    await refreshInstallationReceipts(ports, workspace.id);
    const pending = await installExternal(ports, workspace.id, request);
    expect(pending.status).toBe("pending_approval");
    await createApprovals({ db, workspaceId: workspace.id, now: ports.now }, action => createModules(ports, workspace.id).onApproved(action)).resolve(pending.approvalId!, { decision: "approve" });
    await refreshInstallationReceipts(ports, workspace.id);
    const installed = await installExternal(ports, workspace.id, request);
    expect(installed, JSON.stringify(installed)).toMatchObject({ status: "installed", moduleId: queued.moduleId, hash: seed.commit, error: null });
    const module = await db.module.findUniqueOrThrow({ where: { id: installed.moduleId! } });
    expect(module).toMatchObject({ name: "mcp", builtin: false, status: "active", activeHash: seed.commit });
    const version = await db.moduleVersion.findFirstOrThrow({ where: { moduleId: module.id } });
    expect(version).toMatchObject({ status: "approved", report: { typecheck: { status: "passed" }, tests: [{ exitCode: 0 }] } });
    expect(await db.moduleVersion.count({ where: { moduleId: module.id } })).toBe(1);
    expect(await db.approval.count({ where: { status: "approved" } })).toBe(1);
    const api = createStewardService(ports).forWorkspace(workspace.id);
    expect((await api.modules.tools()).tools.map(tool => tool.name)).toContain("m_mcp_settings");
    const settings = release.manifest.tools.find(tool => tool.name === "settings")!;
    expect(settings.visibility).toEqual(["owner"]);
    expect(settings.output).toBeDefined();
    expect(await admitted(db, { kind: "owner", via: null }, settings, workspace.id)).toBe(true);
    const ordinaryManifest = moduleManifestSchema.parse({ name: "ordinary-app", entry: "index.ts", keepAlive: true, effects: [], tools: [], tests: ["test.ts"] });
    const ordinary = await db.module.create({ data: { workspaceId: workspace.id, name: "ordinary-app", activeHash: "ordinary-current", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: ordinary.id, hash: "ordinary-current", manifest: ordinaryManifest, source: "user", status: "approved", intent: {}, report: {} } });
    expect(await admitted(db, { kind: "module", module: ordinary.name, moduleId: ordinary.id, hash: "ordinary-current" }, settings, workspace.id)).toBe(false);
    expect(await admitted(db, { kind: "module", module: module.name, moduleId: module.id, hash: module.activeHash! }, settings, workspace.id)).toBe(true);
    expect(await db.run.count()).toBe(0);
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 120_000);

for (const name of ["events", "files", "notify", "mcp"]) {
  test(`${name}: real SDK author tests in an offline temporary module copy`, async () => {
    const dataDir = await mkdtemp(join(tmpdir(), `chrona-${name}-author-`)), db = testDb();
    try {
      const source = join(import.meta.dirname, "external", name), code = join(dataDir, "platform", "store", name);
      await mkdir(code, { recursive: true }); await cp(source, code, { recursive: true });
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
      const sandbox = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
      const reports: TestReport = [];
      const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T04:00:00Z"), ...testReleaseRuntimeChecks(), sandbox: { ...sandbox.health, runModule: sandbox.runModule } }, "author-offline");
      const passed = await runTests(context, code, manifest, reports);
      expect(reports, JSON.stringify(reports)).toHaveLength(manifest.tests.length);
      expect(passed, JSON.stringify(reports)).toBe(true);
      expect(reports.every(report => report.exitCode === 0)).toBe(true);
    } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
  }, 120_000);
}
