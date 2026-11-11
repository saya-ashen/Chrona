import { expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleSupervisor } from "./module-supervisor";
import { callSync, kernelOrigin } from "./module-calls";
import { notifyLifecycle } from "./notify-user";
import { recordApprovalFact, seedFactConsumer } from "./notification-facts";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveExternalRelease } from "./module-release";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import type { StewardPorts } from "./ports";

test("web.today routes through the real web and notify modules without recursion or moving decisions", async () => {
  registerSystemModules();
  const dataDir = await mkdtemp("/tmp/chrona-overview-routed-"), resources = join(dataDir, "platform/external"), db = testDb();
  const runtime = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-07T04:00:00Z"), publicUrl: null, moduleExternalResources: resources,
    sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "overview" } })).id;
    for (const name of ["web", "notify"]) {
      await mkdir(resources, { recursive: true });
      await cp(join(import.meta.dirname, "external", name), join(resources, name), { recursive: true });
      await seedTestModuleRelease(resources, name);
      const release = await resolveExternalRelease(ports, name);
      const module = await db.module.create({ data: { workspaceId, name, builtin: false, activeHash: release.hash } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
      if (name === "notify") await seedFactConsumer(db, workspaceId, module.id, ports.now());
      await mkdir(join(dataDir, "platform/store", release.hash), { recursive: true });
      await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
    }
    const entry = await db.module.create({ data: { workspaceId, name: "owner-entry", activeHash: "e".repeat(64) } });
    await db.moduleVersion.create({ data: { moduleId: entry.id, hash: entry.activeHash!, manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", keepAlive: true, effects: [], uses: ["*"], tests: ["test.ts"],
        authority: "owner"
    }), source: "user", status: "approved", intent: {}, report: {} } });
    const approval = await db.approval.create({ data: { workspaceId, action: "modify_external", title: "更新外部记录", detail: "修改项目记录", preview: "用户决定", payload: { kind: "fixture_external_change" } } });
    await recordApprovalFact(db, approval);
    await recordApprovalFact(db, approval);
    await notifyLifecycle(db, ports, workspaceId, "paused-fixture", { kind: "module-paused", app: "fixture" });
    expect(await db.kernelFact.count({ where: { consumedAt: null } })).toBe(2);
    expect(await db.moduleInvocation.count({ where: { target: "notify", tool: "approval" } })).toBe(0);
    await callSync(ports, kernelOrigin(workspaceId), "notify.list", {});
    for (let i = 0; i < 100 && await db.kernelFact.count({ where: { consumedAt: { not: null } } }) < 2; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(await db.kernelFact.count({ where: { consumedAt: { not: null } } })).toBe(2);
    const origin = { workspaceId, caller: { kind: "module" as const, module: entry.name, moduleId: entry.id, hash: entry.activeHash! }, chain: [], path: [] };
    const view = (await callSync(ports, origin, "web.today", {})).output;
    expect(view).toMatchObject({
      generatedAt: ports.now().toISOString(),
      approvals: expect.arrayContaining([expect.objectContaining({ id: approval.id })]),
      upcoming: [],
      updates: expect.arrayContaining([expect.objectContaining({ title: "需要你批准：更新外部记录", body: "修改项目记录\n\n用户决定", channel: "in_app" })]),
      health: { queuedNotifications: expect.any(Number), failedNotifications: 0 },
    });
    expect(await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "open" });
    expect(await db.moduleInvocation.count({ where: { target: "web", tool: "today", status: "succeeded" } })).toBe(1);
    expect((await callSync(ports, kernelOrigin(workspaceId), "notify.list", {})).output).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: "模块连续失败，已暂停", body: expect.stringContaining("fixture") })]) });
    await expect(callSync(ports, origin, "notify.lifecycle", { key: "forged", kind: "module-paused", facts: "{}" })).rejects.toMatchObject({ code: "not_found" });
    await db.module.updateMany({ where: { workspaceId, name: "web" }, data: { status: "paused" } });
    await expect(callSync(ports, origin, "web.today", {})).rejects.toMatchObject({ code: "unavailable" });
    expect((await callSync(ports, origin, "activity.runtime", {})).output).toMatchObject({ provider: { available: false } });
    await expect(callSync(ports, origin, "notify.approval", { approval: "fake", title: "fake", action: "fake", detail: "", preview: "" })).rejects.toMatchObject({ code: "not_found" });
    expect((await callSync(ports, kernelOrigin(workspaceId), "notify.list", {})).output).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: "需要你批准：更新外部记录" })]) });
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);
