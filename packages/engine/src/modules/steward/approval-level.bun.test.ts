import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { addedCapabilities, assessApproval } from "./approval-level";
import { testDb } from "./test-db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
const manifest = (part: Record<string, unknown> = {}) => moduleManifestSchema.parse({ name: "prices", entry: "index.ts", tests: ["test.ts"], triggers: [{ id: "daily", schedule: { kind: "every", minutes: 60 } }], effects: ["notify_user"], ...part });

test.each([
  ["nothing new", {}, []],
  ["network", { effects: ["notify_user", "network"] }, ["联网"]],
  ["a call", { uses: ["files.read"] }, ["调用 files.read"]],
  ["a credential", { secrets: ["okx_demo"] }, ["读取凭据 okx_demo"]],
  ["a program", { packages: ["ffmpeg"] }, ["系统程序 ffmpeg"]],
  ["a higher memory cap", { limits: { virtualMemoryMb: 4096 } }, ["内存地址空间上限 4096 MB"]],
  ["a tool for modules", { tools: [{ name: "price", description: "p", visibility: ["modules"], parameters: { type: "object", properties: {}, required: [] } }] }, ["供其他模块调用 price"]],
] as const)("added capabilities: %s", (_, part, added) => {
  expect(addedCapabilities(manifest(), manifest(part))).toEqual([...added]);
});
test("a memory cap is bounded, and keeping the same cap adds nothing", () => {
  expect(moduleManifestSchema.safeParse({ name: "prices", entry: "index.ts", tests: ["test.ts"], limits: { virtualMemoryMb: 16384 } }).success).toBe(false);
  expect(addedCapabilities(manifest({ limits: { virtualMemoryMb: 4096 } }), manifest({ limits: { virtualMemoryMb: 4096 } }))).toEqual([]);
});

/** One module with an active version and a candidate; the level comes only from these facts. */
async function assess(next: Record<string, unknown>, { isolated = true, executionMode, fresh = false, schema = 1, restore = false, emptyData = false, previous = {} as Record<string, unknown> }: { isolated?: boolean; executionMode?: "legacy" | "trusted-local" | "required-isolation"; fresh?: boolean; schema?: number; restore?: boolean; emptyData?: boolean; previous?: Record<string, unknown> } = {}) {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "level" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "prices", activeHash: fresh ? null : "a", dataSchema: schema } });
  if (!fresh) await db.moduleVersion.create({ data: { moduleId: module.id, hash: "a", manifest: manifest(previous), source: "user", intent: {}, report: {}, status: "approved" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "b", manifest: manifest(next), source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const payload = { kind: "activate_module", moduleId: module.id, hash: "b", ...(restore ? { restore: { schema: 1, snapshotAt: "x" } } : {}) };
  const dataDir = emptyData ? mkdtempSync(join(tmpdir(), "chrona-level-")) : undefined;
  return db.$transaction(tx => assessApproval(tx, { isolated, ...(executionMode ? { executionMode } : {}), ...(dataDir ? { dataDir } : {}) }, { action: "activate_module", title: "启用", payload }));
}
test.each([
  ["same capabilities", {}, {}, "green", "更新 prices，能力不变", true],
  ["new capability", { effects: ["notify_user", "network"] }, {}, "yellow", "更新 prices，能力有增加", true],
  ["new app", {}, { fresh: true }, "yellow", "启用新应用 prices", true],
  ["unisolated legacy sandbox", {}, { isolated: false }, "red", "更新 prices，能力不变", true],
  ["trusted local without isolation", {}, { isolated: false, executionMode: "trusted-local" }, "green", "更新 prices，能力不变", true],
  ["required isolation unavailable", {}, { isolated: false, executionMode: "required-isolation" }, "red", "更新 prices，能力不变", true],
  ["acts as the user", { uses: ["chat.send"] }, {}, "red", "更新 prices（入口模块），能力有增加", true],
  ["credential that can leave", { effects: ["notify_user", "network"], secrets: ["okx_demo"] }, {}, "red", "更新 prices，能力有增加", true],
  ["network added to a credential", { effects: ["notify_user", "network"], secrets: ["okx_demo"] }, { previous: { secrets: ["okx_demo"] } }, "red", "更新 prices，能力有增加", true],
  ["credential and network kept", { effects: ["notify_user", "network"], secrets: ["okx_demo"] }, { previous: { effects: ["notify_user", "network"], secrets: ["okx_demo"] } }, "green", "更新 prices，能力不变", true],
  ["entry module, nothing new", { uses: ["chat.send"] }, { previous: { uses: ["chat.send"] } }, "yellow", "更新 prices（入口模块），能力不变", true],
  ["entry module gains a capability", { uses: ["chat.send", "files.read"] }, { previous: { uses: ["chat.send"] } }, "red", "更新 prices（入口模块），能力有增加", true],
  ["new entry module", { uses: ["chat.send"] }, { fresh: true }, "red", "启用新应用 prices（入口模块）", true],
  ["data migration", { data: { schema: 2, migrate: "migrate.ts" } }, {}, "red", "更新 prices，能力不变", false],
  ["schema change without data", { data: { schema: 2 } }, { emptyData: true }, "green", "更新 prices，能力不变", true],
  ["data restore", {}, { restore: true }, "red", "回滚 prices 并恢复旧数据，此后写入的数据会丢失", false],
] as const)("module version level: %s", async (_, next, facts, level, headline, reversible) => {
  expect(await assess(next, facts)).toMatchObject({ level, brief: { headline, reversible } });
});

test("output contract changes raise single and group approvals and identify the current dependent caller", async () => {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "output impact approval" } });
  const target = await db.module.create({ data: { workspaceId: workspace.id, name: "target", activeHash: "a", dataSchema: 1 } });
  const caller = await db.module.create({ data: { workspaceId: workspace.id, name: "caller", activeHash: "c", dataSchema: 1 } });
  const oldTool = { name: "read", description: "read", visibility: ["modules"], callers: undefined, idempotent: true, parameters: { type: "object", properties: {}, required: [] }, output: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } };
  const newTool = { ...oldTool, output: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] } };
  await db.moduleVersion.create({ data: { moduleId: target.id, hash: "a", manifest: manifest({ tools: [oldTool] }), source: "user", intent: {}, report: {}, status: "approved" } });
  await db.moduleVersion.create({ data: { moduleId: target.id, hash: "b", manifest: manifest({ tools: [newTool] }), source: "provider", intent: {}, report: {}, status: "pending_review" } });
  await db.moduleVersion.create({ data: { moduleId: caller.id, hash: "c", manifest: manifest({ name: "caller", uses: ["target.read"] }), source: "user", intent: {}, report: {}, status: "approved" } });
  const payload = { kind: "activate_module", moduleId: target.id, hash: "b" };
  const single = await db.$transaction(tx => assessApproval(tx, { isolated: true, executionMode: "trusted-local" }, { action: "activate_module", title: "update", payload }));
  expect(single).toMatchObject({ level: "yellow", brief: { added: [expect.stringContaining("调用方依赖契约变化：caller")] } });
  const other = await db.module.create({ data: { workspaceId: workspace.id, name: "other", activeHash: "o", dataSchema: 1 } });
  await db.moduleVersion.create({ data: { moduleId: other.id, hash: "o", manifest: manifest(), source: "user", intent: {}, report: {}, status: "approved" } });
  await db.moduleVersion.create({ data: { moduleId: other.id, hash: "p", manifest: manifest(), source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const group = await db.$transaction(tx => assessApproval(tx, { isolated: true, executionMode: "trusted-local" }, { action: "activate_module", title: "group", payload: { kind: "activate_modules", versions: [{ moduleId: target.id, hash: "b" }, { moduleId: other.id, hash: "p" }] } }));
  expect(group).toMatchObject({ level: "yellow", brief: { added: expect.arrayContaining([expect.stringContaining("调用方依赖契约变化：caller")]) } });
});

test.each([
  ["schedule", undefined, "yellow"], ["modify_external", undefined, "yellow"], ["modify_external", "red", "red"],
  ["send_external_message", undefined, "red"], ["delete_data", undefined, "red"], ["purchase", undefined, "red"],
  ["change_policy", undefined, "red"], ["access_host_path", undefined, "yellow"], ["share_third_party", "yellow", "red"],
] as const)("action %s (asked %s) is %s: a caller can raise, never lower", async (action, asked, level) => {
  const db = testDb(); dbs.push(db);
  expect(await db.$transaction(tx => assessApproval(tx, { isolated: true }, { action, title: "做一件事", payload: {}, ...(asked ? { level: asked } : {}) }))).toMatchObject({ level, brief: { headline: "做一件事" } });
});
