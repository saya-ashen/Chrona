import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "../__testing__/test-db";
import { createModuleSupervisor } from "../modules/module-supervisor";
import type { StewardPorts } from "../ports";

test("empty bootstrap creates no builtin Agent and needs no builtin resources", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-no-builtin-");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleBuiltinResources: join(dataDir, "missing-builtin") };
  const supervisor = createModuleSupervisor(ports);
  try {
    const workspace = await db.workspace.create({ data: { name: "empty" } });
    await supervisor.start();
    expect(await db.module.count()).toBe(0);
    expect(await db.moduleVersion.count()).toBe(0);
    expect(await db.approval.count()).toBe(0);
  } finally { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});

test("supervisor startup preserves a paused Pi and never upgrades it from host releases", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-pi-no-upgrade-");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: join(dataDir, "missing-external") };
  const supervisor = createModuleSupervisor(ports);
  try {
    const workspace = await db.workspace.create({ data: { name: "paused Pi" } });
    const pi = await db.module.create({ data: { workspaceId: workspace.id, name: "pi", builtin: false, status: "paused", activeHash: "a".repeat(40) } });
    await db.moduleVersion.create({ data: { moduleId: pi.id, hash: pi.activeHash!, manifest: moduleManifestSchema.parse({ name: "pi", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true }), status: "approved", source: "user", intent: {}, report: {} } });
    await supervisor.start();
    expect(await db.module.findUniqueOrThrow({ where: { id: pi.id } })).toEqual(pi);
    expect(await db.moduleVersion.count()).toBe(1);
    expect(await db.approval.count()).toBe(0);
  } finally { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});
