import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { startMigration } from "./module-generation";
import { migrateData } from "./module-migration";
import { requestStatus } from "./module-status";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

test.each([false, true])("paused app migration preserves state and data (failure=%s)", async failure => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-paused-migration-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "migration" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z"), sandbox: { available: true, isolated: true, async runModule(input) {
    await writeFile(join(input.dataDir, "value.txt"), "migrated");
    return { status: failure ? "failed" : "succeeded", output: "", error: failure ? "synthetic failure" : null, exitCode: failure ? 1 : 0 };
  } } };
  const context = moduleContext(ports, workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "old", dataSchema: 1, status: "paused" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], data: { schema: 2, migrate: "migrate.ts" }, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "next", source: "user", manifest, intent: {}, report: {}, status: "pending_review" } });
  const data = join(context.platform, "data", module.id);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "value.txt"), "original");
  await db.$transaction(tx => startMigration(context, tx, module.id, version.hash, { from: 1, to: 2 }));
  await migrateData(context, { module, version, manifest, from: 1, to: 2 }, "activate");
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "paused", activeHash: failure ? "old" : "next", dataSchema: failure ? 1 : 2 });
  expect(await readFile(join(data, "value.txt"), "utf8")).toBe(failure ? "original" : "migrated");
  if (!failure) {
    expect(await db.schedule.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ status: "paused", nextAt: null });
    await requestStatus(context, module.id, "active", "explicit enable");
    expect(await db.schedule.findFirstOrThrow({ where: { moduleId: module.id } })).toMatchObject({ status: "active", nextAt: expect.any(Date) });
  }
});
