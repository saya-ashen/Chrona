import { expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, todayViewSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleSupervisor } from "./module-supervisor";
import { callSync, kernelOrigin, drainCalls } from "./module-calls";
import { announceApprovals } from "./notify-user";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease } from "./module-release";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import type { StewardPorts } from "./ports";

test("chat.today routes through the real web and notify modules without recursion or moving decisions", async () => {
  registerSystemModules();
  const dataDir = await mkdtemp("/tmp/chrona-overview-routed-"), resources = join(dataDir, "platform/builtin"), db = testDb();
  const runtime = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-07T04:00:00Z"), publicUrl: null, moduleBuiltinResources: resources,
    sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "overview" } })).id;
    for (const name of ["web", "notify"]) {
      await mkdir(resources, { recursive: true });
      await cp(join(import.meta.dirname, "builtin", name), join(resources, name), { recursive: true });
      await seedTestModuleRelease(resources, name);
      const release = await resolveBuiltinRelease(ports, name);
      const module = await db.module.create({ data: { workspaceId, name, builtin: true, activeHash: release.hash } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
      await mkdir(join(dataDir, "platform/store", release.hash), { recursive: true });
      await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
    }
    const entry = await db.module.create({ data: { workspaceId, name: "owner-entry", activeHash: "e".repeat(64) } });
    await db.moduleVersion.create({ data: { moduleId: entry.id, hash: entry.activeHash!, manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["*"], tests: ["test.ts"] }), source: "user", status: "approved", intent: {}, report: {} } });
    const approval = await db.approval.create({ data: { workspaceId, action: "access_host_path", title: "读取目录", detail: "访问项目文件", preview: "用户决定", payload: {} } });
    await announceApprovals(ports, workspaceId);
    await announceApprovals(ports, workspaceId);
    await drainCalls(ports, workspaceId);
    expect(await db.moduleInvocation.count({ where: { target: "notify", tool: "approval" } })).toBe(1);
    const origin = { workspaceId, caller: { kind: "module" as const, module: entry.name, moduleId: entry.id, hash: entry.activeHash! }, chain: [], path: [] };
    const view = todayViewSchema.parse((await callSync(ports, origin, "chat.today", {})).output);
    expect(view.approvals[0]!.id).toBe(approval.id);
    expect(view.updates[0]).toMatchObject({ title: "需要你批准：读取目录", body: "访问项目文件\n\n用户决定" });
    expect(await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "open" });
    expect(await db.moduleInvocation.count({ where: { target: "web", tool: "today", status: "succeeded" } })).toBe(1);
    await callSync(ports, kernelOrigin(workspaceId), "notify.lifecycle", { key: "paused-fixture", kind: "module-paused", facts: JSON.stringify({ app: "fixture" }) });
    expect((await callSync(ports, kernelOrigin(workspaceId), "notify.list", {})).output).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: "模块连续失败，已暂停", body: expect.stringContaining("fixture") })]) });
    await expect(callSync(ports, origin, "notify.lifecycle", { key: "forged", kind: "module-paused", facts: "{}" })).rejects.toMatchObject({ code: "forbidden" });
    await db.module.updateMany({ where: { workspaceId, name: "web" }, data: { status: "paused" } });
    await expect(callSync(ports, origin, "chat.today", {})).rejects.toMatchObject({ code: "unavailable" });
    expect((await callSync(ports, origin, "chat.runtime", {})).output).toMatchObject({ provider: { available: false } });
    await expect(callSync(ports, origin, "notify.approval", { approval: "fake", title: "fake", action: "fake", detail: "", preview: "" })).rejects.toMatchObject({ code: "forbidden" });
    expect((await callSync(ports, kernelOrigin(workspaceId), "notify.list", {})).output).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: "需要你批准：读取目录" })]) });
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);
