import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleOutputImpacts } from "./module-output-impact";

const output = (type: string) => ({ type: "object", properties: { value: { type } }, required: ["value"], additionalProperties: false });
const manifest = (name: string, tools: unknown[], uses: string[] = []) => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses, tools });
const tool = (name: string, schema: unknown, visibility: string[] = ["modules"]) => ({ name, description: name, visibility, idempotent: true, parameters: { type: "object", properties: {}, required: [] }, output: schema });

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), workspace = await db.workspace.create({ data: { name: "output impacts" } });
  cleanups.push(() => db.$disconnect());
  const app = await db.module.create({ data: { workspaceId: workspace.id, name: "target", activeHash: "old" } });
  const oldManifest = manifest("target", [tool("read", output("string")), tool("gone", output("boolean"))]);
  await db.moduleVersion.create({ data: { moduleId: app.id, hash: "old", manifest: oldManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const ports = { db } as never;
  const makeCaller = async (name: string, uses: string[]) => {
    const caller = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-hash` } });
    await db.moduleVersion.create({ data: { moduleId: caller.id, hash: `${name}-hash`, manifest: manifest(name, [], uses), source: "user", status: "approved", intent: {}, report: {} } });
    return caller;
  };
  return { db, ports, workspace, app, oldManifest, makeCaller };
}

test("output contract impact is canonical, notices exact dependencies and removed tools", async () => {
  const f = await fixture();
  await f.makeCaller("exact", ["target.read", "target.gone"]);
  const reordered = manifest("target", [tool("read", { additionalProperties: false, required: ["value"], properties: { value: { type: "string" } }, type: "object" }), tool("gone", output("boolean"))]);
  expect(await moduleOutputImpacts(f.db, f.workspace.id, f.app.id, reordered)).toEqual([]);
  const removedAndChanged = manifest("target", [tool("read", output("integer"))]);
  expect(await moduleOutputImpacts(f.db, f.workspace.id, f.app.id, removedAndChanged)).toEqual([{ caller: "exact", targets: ["target.read", "target.gone"] }]);
});

test("wildcard is impacted only for owner-visible targets, and consumers are recomputed from current active versions", async () => {
  const f = await fixture();
  const next = manifest("target", [tool("read", output("integer"), ["owner"])]);
  expect(await moduleOutputImpacts(f.db, f.workspace.id, f.app.id, next)).toEqual([]);
  await f.makeCaller("star", ["*"]);
  expect(await moduleOutputImpacts(f.db, f.workspace.id, f.app.id, next)).toEqual([{ caller: "star", targets: ["target.read"] }]);
  await f.db.module.update({ where: { id: (await f.db.module.findFirstOrThrow({ where: { name: "star" } })).id }, data: { status: "paused" } });
  expect(await moduleOutputImpacts(f.db, f.workspace.id, f.app.id, next)).toEqual([]);
});
