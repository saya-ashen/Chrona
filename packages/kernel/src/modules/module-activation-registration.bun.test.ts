import { installTestModuleVersion } from "../__testing__/module-release-test-fixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "../__testing__/module-test-process";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";
import "./module-effects";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

test("a lost activation response does not replay the handler or pause the application", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-activation-"));
  const workspace = await db.workspace.create({ data: { name: "Activation delivery" } });
  let deliveries = 0;
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind === "activated") { deliveries++; throw new Error("Activation response lost"); }
    return {};
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  const supervisor = moduleSupervisor(ports);
  cleanups.push(async () => { await supervisor.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const manifest = moduleManifestSchema.parse({ name: "activation-entry", entry: "index.ts", tests: ["test.ts"], activated: true, keepAlive: true, effects: [] });
  const app = await db.module.create({ data: { workspaceId: workspace.id, name: manifest.name, activeHash: "activation-v1" } });
  const hash = await installTestModuleVersion(ports, app, manifest);
  await supervisor.reconcile();
  for (let attempt = 0; attempt < 100 && !await db.moduleRun.count({ where: { moduleId: app.id, triggerId: "activated" } }); attempt++) await Bun.sleep(10);
  for (let attempt = 0; attempt < 3; attempt++) await supervisor.reconcile();
  expect(deliveries).toBe(1);
  expect(await db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "active", activeHash: hash });
});
