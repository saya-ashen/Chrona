import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { modulePermissions } from "./module-overview";
import { createSecrets } from "./secrets";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-permissions-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-27T15:00:00Z"), publicUrl: null,
    provider: { name: "fake", async health() { throw new Error("Permissions must not probe providers"); }, start() { throw new Error("Permissions must not execute providers"); } },
    sandbox: { available: true, isolated: false, startModule() { throw new Error("Permissions must not execute modules"); } } };
  const workspaceId = (await db.workspace.create({ data: { name: "permissions" } })).id;
  const module = await db.module.create({ data: { workspaceId, name: "example", activeHash: "approved-v1", status: "active" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true,
    secrets: [{ name: "fixture_credential", label: "Fixture", fields: [{ name: "token", label: "Token" }] }] });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  return { db, ports, workspaceId, module };
}

test("secret permissions project configured and saved metadata without exposing credentials or executing code", async () => {
  const f = await fixture();
  expect(await modulePermissions(f.ports, f.workspaceId, f.module.name)).toMatchObject({ module: "example", activeHash: "approved-v1", secrets: [{ name: "fixture_credential", configured: false, fields: [{ saved: false }] }] });
  f.ports.secretConfigured = async name => name === "fixture_credential";
  expect(await modulePermissions(f.ports, f.workspaceId, f.module.id)).toMatchObject({ secrets: [{ configured: true, fields: [{ saved: false }] }] });
  f.ports.secretConfigured = async () => false;
  await createSecrets(f.ports.dataDir).write("fixture_credential", { token: "synthetic-credential-never-returned" });
  const view = await modulePermissions(f.ports, f.workspaceId, f.module.name);
  expect(view).toMatchObject({ secrets: [{ configured: true, updatedAt: expect.any(String), fields: [{ saved: true }] }] });
  expect(JSON.stringify(view)).not.toContain("synthetic-credential-never-returned");
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
});

test("model permissions report declared limits and kernel budgets without a central model mapping", async () => {
  const f = await fixture(), version = await f.db.moduleVersion.findFirstOrThrow({ where: { moduleId: f.module.id } });
  const manifest = moduleManifestSchema.parse({ ...version.manifest as object, uses: ["agent.complete"], model: { tier: "fast", maxCalls: 2, maxOutputTokens: 100 } });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest } });
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 4, maxOutputTokens: 500, dailyCalls: 20, eventTimeoutMs: 5000, moduleDailyCalls: { example: 7 } } } } });
  const view = await modulePermissions(f.ports, f.workspaceId, f.module.name) as { model: unknown };
  expect(view.model).toEqual({ tier: "fast", maxCallsPerEvent: 2, dailyCap: 7, today: { calls: 0, inputTokens: 0, outputTokens: 0 } });
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
});

test("permissions stay workspace scoped and tolerate an installed module without an active manifest", async () => {
  const f = await fixture(), other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(modulePermissions(f.ports, other.id, f.module.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(modulePermissions(f.ports, f.workspaceId, "missing")).rejects.toMatchObject({ code: "not_found" });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: null } });
  expect(await modulePermissions(f.ports, f.workspaceId, f.module.name)).toMatchObject({ activeHash: null, capabilities: [], secrets: [], model: null, grants: [], approvals: [] });
});
