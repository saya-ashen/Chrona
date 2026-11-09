import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { callSync, type Caller, type SystemModule } from "./module-calls";
import { isOwnerCaller } from "./module-owner";
import type { StewardPorts } from "./ports";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import { approvals } from "./system/approvals";
import { settings } from "./system/settings";
import { secrets } from "./system/secrets";
import { activity } from "./system/activity";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-owner-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "owner" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-08T12:00:00Z"), publicUrl: null };
  const api = createStewardService(ports).forWorkspace(workspaceId);
  async function moduleNamed(name: string, part: Record<string, unknown> = {}): Promise<Extract<Caller, { kind: "module" }>> {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], ...part });
    const module = await db.module.create({ data: { workspaceId, name, activeHash: "v1" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    return { kind: "module", moduleId: module.id, module: name, hash: "v1" };
  }
  const direct = (caller: Caller, system: SystemModule, tool: string, args: Record<string, unknown> = {}) => system.handle({ ports, workspaceId, caller }, tool, args);
  const routed = (caller: Caller, target: string, args: Record<string, unknown> = {}) => callSync(ports, { workspaceId, caller, chain: [], path: [] }, target, args);
  return { db, ports, workspaceId, api, moduleNamed, direct, routed };
}

const management: { system: SystemModule; tool: string; args?: Record<string, unknown> }[] = [
  { system: approvals, tool: "list" },
  { system: approvals, tool: "resolve", args: { approval: "missing", decision: "approve" } },
  { system: settings, tool: "update", args: { settings: '{"timezone":"UTC"}' } },
  { system: secrets, tool: "list" },
  { system: secrets, tool: "set", args: { name: "demo_key", value: '{"key":"private"}' } },
  { system: secrets, tool: "remove", args: { name: "demo_key" } },
  { system: activity, tool: "consumer" },
];

test("management tools are owner-visible and deny exact uses, root listeners and chat entry inference", async () => {
  const f = await fixture();
  const exact = management.map(({ system, tool }) => `${system.name}.${tool}`);
  for (const part of [{ uses: exact }, { listen: "/", uses: exact }, { uses: ["chat.send", ...exact] }]) {
    const caller = await f.moduleNamed(`ordinary-${await f.db.module.count()}`, part);
    expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(false);
    for (const { system, tool, args } of management) {
      expect(system.tools.find(item => item.name === tool)!.visibility).toEqual(["owner"]);
      await expect(f.direct(caller, system, tool, args)).rejects.toMatchObject({ code: "forbidden" });
      await expect(f.routed(caller, `${system.name}.${tool}`, args)).rejects.toMatchObject({ code: "forbidden" });
    }
  }
});

test("owner authority binds workspace, id, name, active hash/status and approved parsed wildcard version", async () => {
  const f = await fixture(), caller = await f.moduleNamed("checked", { uses: ["*"] });
  expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(true);
  expect(await f.db.$transaction(tx => isOwnerCaller(tx, f.workspaceId, caller))).toBe(true);
  for (const bad of [{ ...caller, moduleId: "missing" }, { ...caller, module: "forged" }, { ...caller, hash: "stale" }, { kind: "system", module: "web" }, { kind: "kernel" }, { kind: "provider", runId: "run" }] satisfies Caller[]) {
    expect(await isOwnerCaller(f.db, f.workspaceId, bad)).toBe(false);
    await expect(f.direct(bad, settings, "update", { settings: '{}' })).rejects.toMatchObject({ code: "forbidden" });
  }
  const elsewhere = (await f.db.workspace.create({ data: { name: "elsewhere" } })).id;
  expect(await isOwnerCaller(f.db, elsewhere, caller)).toBe(false);
  await expect(settings.handle({ ports: f.ports, workspaceId: elsewhere, caller }, "update", { settings: '{}' })).rejects.toMatchObject({ code: "forbidden" });
  for (const data of [{ status: "paused" }, { status: "failed" }, { status: "active", activeHash: "v2" }, { activeHash: null }]) {
    await f.db.module.update({ where: { id: caller.moduleId }, data });
    expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(false);
    await expect(f.routed(caller, "approvals.list")).rejects.toMatchObject({ code: "forbidden" });
  }
  await f.db.module.update({ where: { id: caller.moduleId }, data: { status: "active", activeHash: "v1" } });
  const where = { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } };
  await f.db.moduleVersion.update({ where, data: { status: "candidate" } });
  expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(false);
  await expect(f.direct(caller, secrets, "list")).rejects.toMatchObject({ code: "forbidden" });
  for (const manifest of [{ name: "checked", uses: ["*"] }, { name: "forged", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["*"] }]) {
    await f.db.moduleVersion.update({ where, data: { status: "approved", manifest } });
    expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(false);
  }
});

test("checked wildcard and real owners manage resources while preserving caller provenance and secret declarations", async () => {
  const f = await fixture();
  const wildcard = await f.moduleNamed("checked", { uses: ["*"] });
  const ordinary = await f.moduleNamed("ordinary");
  for (const caller of [wildcard, { kind: "owner", via: null }, { kind: "owner", via: "web" }] satisfies Caller[]) {
    expect(await isOwnerCaller(f.db, f.workspaceId, caller)).toBe(true);
    expect(await f.routed(caller, "approvals.list")).toMatchObject({ output: [] });
    const updated = await f.routed(caller, "settings.update", { settings: '{"timezone":"UTC"}' });
    expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: updated.callId } })).toMatchObject({
      caller: caller.kind === "module" ? `module:${caller.moduleId}` : "owner",
      callerModuleId: caller.kind === "module" ? caller.moduleId : null,
      callerHash: caller.kind === "module" ? caller.hash : null,
    });
    await f.routed(caller, "activity.consumer", { module: ordinary.moduleId });
    await f.routed(caller, "secrets.set", { name: "demo_key", value: '{"key":"private"}' });
    expect(await f.routed(caller, "secrets.list")).toMatchObject({ output: [{ name: "demo_key", configured: true }] });
    await expect(f.direct(caller, secrets, "get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
    const approval = await f.api.approvals.create({ action: "modify_external", moduleId: ordinary.moduleId, title: "Decide", detail: "", preview: "", payload: {} });
    for (const scope of ["once", "always"]) {
      await expect(f.routed(caller, "approvals.resolve", { approval: approval.id, decision: "approve", scope })).rejects.toMatchObject({ code: "invalid" });
      expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("open");
    }
    await f.routed(caller, "approvals.resolve", { approval: approval.id, decision: "deny" });
    expect(await f.db.audit.findFirstOrThrow({ where: { kind: "approval_resolved", subjectId: approval.id } })).toMatchObject({ details: { source: caller.kind === "module" ? caller.module : caller.via ?? "owner" } });
    await f.routed(caller, "secrets.remove", { name: "demo_key" });
  }
  expect(await f.direct(ordinary, settings, "get")).toHaveProperty("timezone", "UTC");
  for (const caller of [wildcard, { kind: "owner", via: null }] satisfies Caller[]) {
    const discovered = await f.routed(caller, "modules.tools", { query: "approvals" });
    expect(discovered.output).not.toEqual(expect.arrayContaining([expect.objectContaining({ target: "approvals.grants" })]));
    expect(discovered.output).not.toEqual(expect.arrayContaining([expect.objectContaining({ target: "approvals.revoke-grant" })]));
    for (const target of ["approvals.grants", "approvals.revoke-grant", "schedules.list", "schedules.create", "projects.list"]) {
      await expect(f.routed(caller, target)).rejects.toMatchObject({ code: "not_found" });
    }
  }
});

test("secret reads require a declaration in the current approved active version even for checked owners", async () => {
  const f = await fixture();
  f.ports.secrets = async () => ({ token: "private-token" });
  for (const uses of [["secrets.get"], ["*"]]) {
    const undeclared = await f.moduleNamed(`undeclared-${await f.db.module.count()}`, { uses });
    await expect(f.direct(undeclared, secrets, "get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
    const declared = await f.moduleNamed(`declared-${await f.db.module.count()}`, { uses, secrets: ["demo_key"] });
    expect(await f.routed(declared, "secrets.get", { name: "demo_key" })).toMatchObject({ output: { value: { token: "private-token" } } });
    await expect(f.direct({ ...declared, hash: "stale" }, secrets, "get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: declared.moduleId, hash: declared.hash } }, data: { status: "candidate" } });
    await expect(f.direct(declared, secrets, "get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: declared.moduleId, hash: declared.hash } }, data: { status: "approved" } });
    await f.db.module.update({ where: { id: declared.moduleId }, data: { status: "paused" } });
    await expect(f.direct(declared, secrets, "get", { name: "demo_key" })).rejects.toMatchObject({ code: "forbidden" });
  }
});
