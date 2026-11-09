import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema, type ModuleTool } from "@chrona/contracts/steward";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { moduleOutputImpacts, outputImpactSummary } from "./module-output-impact";

const output = (type: string) => ({ type: "object", properties: { value: { type } }, required: ["value"], additionalProperties: false });
const manifest = (name: string, tools: unknown[], uses: string[] = []) => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses, tools });
const tool = (name = "read", overrides: Partial<ModuleTool> = {}): ModuleTool => manifest("target", [{ name, description: name, visibility: ["modules"], idempotent: true, parameters: { type: "object", properties: {}, required: [] }, output: output("string"), ...overrides }]).tools[0]!;

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(tools = [tool()]) {
  // This detector needs only persistence; avoid test-db's provider/supervisor import graph.
  const root = mkdtempSync(join(tmpdir(), "chrona-impact-test-"));
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }));
  const databaseUrl = `file:${join(root, "test.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../../../../../prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "contract impacts" } });
  const app = await db.module.create({ data: { workspaceId: workspace.id, name: "target", activeHash: "old" } });
  const oldManifest = manifest("target", tools);
  await db.moduleVersion.create({ data: { moduleId: app.id, hash: "old", manifest: oldManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const makeCaller = async (name: string, uses: string[] = [], options: { builtin?: boolean; versionStatus?: string; status?: string; workspaceId?: string } = {}) => {
    const caller = await db.module.create({ data: { workspaceId: options.workspaceId ?? workspace.id, name, activeHash: `${name}-hash`, builtin: options.builtin ?? false, status: options.status ?? "active" } });
    await db.moduleVersion.create({ data: { moduleId: caller.id, hash: caller.activeHash!, manifest: manifest(name, [], uses), source: options.builtin ? "builtin" : "user", status: options.versionStatus ?? "approved", intent: {}, report: {} } });
    return caller;
  };
  const impacts = (nextTools: ModuleTool[]) => moduleOutputImpacts(db, workspace.id, app.id, manifest("target", nextTools));
  return { db, workspace, app, oldManifest, makeCaller, impacts };
}

const contractChanges: { name: string; next: ModuleTool | null }[] = [
  { name: "added required input", next: tool("read", { parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }) },
  { name: "recursive input schema", next: tool("read", { parameters: { type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false } } }, required: [] } }) },
  { name: "output schema", next: tool("read", { output: output("integer") }) },
  { name: "narrowed audience", next: tool("read", { visibility: ["owner"] }) },
  { name: "removed module audience", next: tool("read", { visibility: ["provider"] }) },
  { name: "idempotency", next: tool("read", { idempotent: false }) },
  { name: "deletion", next: null },
];
for (const { name, next } of contractChanges) test(`contract impact detects ${name} for callers without declared uses`, async () => {
  const f = await fixture();
  // Deliberately create out of order; evidence must stay deterministic.
  await f.makeCaller("undeclared");
  await f.makeCaller("exact", ["target.read"]);
  await f.makeCaller("star", ["*"]);
  expect(await f.impacts(next ? [next] : [])).toEqual([
    { caller: "exact", targets: ["target.read"] },
    { caller: "star", targets: ["target.read"] },
    { caller: "undeclared", targets: ["target.read"] },
  ]);
});

test("documentation, object keys and visibility order do not change a contract", async () => {
  const original = tool("read", { visibility: ["modules", "owner"], parameters: { type: "object", properties: { value: { type: "string" }, filters: { type: "array", items: { type: "object", properties: { enabled: { type: "boolean" } } } } }, required: ["value"] } });
  const f = await fixture([original]);
  await f.makeCaller("caller", ["*"]);
  const reordered = tool("read", { ...original, description: "Updated tool documentation", visibility: ["owner", "modules"],
    parameters: { required: ["value"], properties: { filters: { type: "array", items: { type: "object", properties: { enabled: { type: "boolean" } }, additionalProperties: false, required: [] } }, value: { type: "string" } }, type: "object" },
    output: { additionalProperties: false, required: ["value"], properties: { value: { type: "string" } }, type: "object" },
    examples: [{ description: "Updated example", args: { value: "example" } }], sideEffects: ["Documented effect"], errors: [{ code: "missing", description: "Documented error", recovery: "Retry later" }] });
  expect(await f.impacts([reordered])).toEqual([]);
});

test("owner-only tools affect only current approved wildcard callers, regardless of exact uses", async () => {
  const f = await fixture([tool("read", { visibility: ["owner"] })]);
  await f.makeCaller("exact", ["target.read"]);
  await f.makeCaller("undeclared");
  await f.makeCaller("owner", ["*"]);
  const next = tool("read", { visibility: ["owner"], idempotent: false });
  expect(await f.impacts([next])).toEqual([{ caller: "owner", targets: ["target.read"] }]);
  // Widening does not invent existing consumers outside the old audience.
  expect(await f.impacts([tool("read", { visibility: ["modules"] })])).toEqual([{ caller: "owner", targets: ["target.read"] }]);
  expect(await f.impacts([])).toEqual([{ caller: "owner", targets: ["target.read"] }]);
});

test("caller admission uses the current approved manifest, never historical wildcard declarations", async () => {
  const f = await fixture([tool("read", { visibility: ["owner"] })]);
  const caller = await f.makeCaller("caller", ["*"]);
  const next = [tool("read", { visibility: ["owner"], output: output("integer") })];
  expect(await f.impacts(next)).toEqual([{ caller: "caller", targets: ["target.read"] }]);
  await f.db.moduleVersion.create({ data: { moduleId: caller.id, hash: "current", status: "approved", source: "user", manifest: manifest("caller", [], ["target.read"]), intent: {}, report: {} } });
  await f.db.module.update({ where: { id: caller.id }, data: { activeHash: "current" } });
  expect(await f.impacts(next)).toEqual([]);
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: caller.id, hash: "current" } }, data: { manifest: manifest("caller", [], ["*"]), status: "pending_review" } });
  expect(await f.impacts(next)).toEqual([]);
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: caller.id, hash: "current" } }, data: { status: "approved" } });
  expect(await f.impacts(next)).toEqual([{ caller: "caller", targets: ["target.read"] }]);
});

test("impacts exclude paused, unapproved, stale, malformed and cross-workspace callers including builtins", async () => {
  const f = await fixture();
  await f.makeCaller("valid");
  await f.makeCaller("approved-builtin", [], { builtin: true });
  await f.makeCaller("unapproved-builtin", ["*"], { builtin: true, versionStatus: "pending_review" });
  for (const versionStatus of ["building", "pending_review", "rejected"]) await f.makeCaller(`status-${versionStatus.replaceAll("_", "-")}`, ["*"], { versionStatus });
  await f.makeCaller("paused", ["*"], { status: "paused" });
  const foreign = await f.db.workspace.create({ data: { name: "other workspace" } });
  await f.makeCaller("foreign", ["*"], { workspaceId: foreign.id });
  const stale = await f.makeCaller("stale", ["*"]);
  await f.db.module.update({ where: { id: stale.id }, data: { activeHash: "missing" } });
  const inactive = await f.makeCaller("inactive", ["*"]);
  await f.db.module.update({ where: { id: inactive.id }, data: { activeHash: null } });
  for (const [name, stored] of [["malformed", {}], ["mismatched", manifest("different", [], ["*"])]] as const) {
    const caller = await f.makeCaller(name, ["*"]);
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: caller.id, hash: caller.activeHash! } }, data: { manifest: stored } });
  }
  expect(await f.impacts([tool("read", { output: output("integer") })])).toEqual([
    { caller: "approved-builtin", targets: ["target.read"] },
    { caller: "valid", targets: ["target.read"] },
  ]);
});

test("multiple changed targets retain evidence order, ignoring new and inaccessible tools", async () => {
  const f = await fixture([tool(), tool("gone"), tool("private", { visibility: ["kernel"] }), tool("owner-only", { visibility: ["owner"] })]);
  await f.makeCaller("caller");
  await f.makeCaller("owner", ["*"]);
  const impacts = await f.impacts([tool("read", { idempotent: false }), tool("private", { visibility: ["kernel"], idempotent: false }), tool("new-tool")]);
  expect(impacts).toEqual([
    { caller: "caller", targets: ["target.read", "target.gone"] },
    { caller: "owner", targets: ["target.read", "target.gone", "target.owner-only"] },
  ]);
  expect(outputImpactSummary(impacts)).toEqual(["caller：target.read、target.gone", "owner：target.read、target.gone、target.owner-only"]);
});

test("adding an entirely new tool has no existing consumer impact", async () => {
  const f = await fixture();
  await f.makeCaller("exact", ["target.new-tool"]);
  await f.makeCaller("star", ["*"]);
  await f.makeCaller("undeclared");
  expect(await f.impacts([tool(), tool("new-tool"), tool("new-owner", { visibility: ["owner"] })])).toEqual([]);
});

test("the previous target contract must belong to this workspace and approved active version", async () => {
  const f = await fixture();
  await f.makeCaller("caller");
  const candidate = manifest("target", [tool("read", { idempotent: false })]);
  const foreign = await f.db.workspace.create({ data: { name: "other workspace" } });
  expect(await moduleOutputImpacts(f.db, foreign.id, f.app.id, candidate)).toEqual([]);
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.app.id, hash: "old" } }, data: { status: "pending_review" } });
  expect(await f.impacts(candidate.tools)).toEqual([]);
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.app.id, hash: "old" } }, data: { status: "approved", manifest: manifest("different", f.oldManifest.tools) } });
  expect(await f.impacts(candidate.tools)).toEqual([]);
});
