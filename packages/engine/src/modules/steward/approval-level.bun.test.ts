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
  ["a tool for modules", { tools: [{ name: "price", description: "p", visibility: ["modules"], parameters: { type: "object", properties: {}, required: [] } }] }, ["供其他模块调用 price"]],
] as const)("added capabilities: %s", (_, part, added) => {
  expect(addedCapabilities(manifest(), manifest(part))).toEqual([...added]);
});

/** One module with an active version and a candidate; the level comes only from these facts. */
async function assess(next: Record<string, unknown>, { isolated = true, fresh = false, schema = 1, restore = false, emptyData = false } = {}) {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "level" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "prices", activeHash: fresh ? null : "a", dataSchema: schema } });
  if (!fresh) await db.moduleVersion.create({ data: { moduleId: module.id, hash: "a", manifest: manifest(), source: "user", intent: {}, report: {}, status: "approved" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "b", manifest: manifest(next), source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const payload = { kind: "activate_module", moduleId: module.id, hash: "b", ...(restore ? { restore: { schema: 1, snapshotAt: "x" } } : {}) };
  const dataDir = emptyData ? mkdtempSync(join(tmpdir(), "chrona-level-")) : undefined;
  return db.$transaction(tx => assessApproval(tx, { isolated, ...(dataDir ? { dataDir } : {}) }, { action: "activate_module", title: "启用", payload }));
}
test.each([
  ["same capabilities", {}, {}, "green", "更新 prices，能力不变", true],
  ["new capability", { effects: ["notify_user", "network"] }, {}, "yellow", "更新 prices，能力有增加", true],
  ["new app", {}, { fresh: true }, "yellow", "启用新应用 prices", true],
  ["unisolated sandbox", {}, { isolated: false }, "red", "更新 prices，能力不变", true],
  ["acts as the user", { uses: ["chat.send"] }, {}, "red", "更新 prices，能力有增加", true],
  ["credential that can leave", { effects: ["notify_user", "network"], secrets: ["okx_demo"] }, {}, "red", "更新 prices，能力有增加", true],
  ["data migration", { data: { schema: 2, migrate: "migrate.ts" } }, {}, "red", "更新 prices，能力不变", false],
  ["schema change without data", { data: { schema: 2 } }, { emptyData: true }, "green", "更新 prices，能力不变", true],
  ["data restore", {}, { restore: true }, "red", "回滚 prices 并恢复旧数据，此后写入的数据会丢失", false],
] as const)("module version level: %s", async (_, next, facts, level, headline, reversible) => {
  expect(await assess(next, facts)).toMatchObject({ level, brief: { headline, reversible } });
});

test.each([
  ["schedule", undefined, "yellow"], ["modify_external", undefined, "yellow"], ["modify_external", "red", "red"],
  ["send_external_message", undefined, "red"], ["delete_data", undefined, "red"], ["purchase", undefined, "red"],
  ["change_policy", undefined, "red"], ["access_host_path", undefined, "red"], ["share_third_party", "yellow", "red"],
] as const)("action %s (asked %s) is %s: a caller can raise, never lower", async (action, asked, level) => {
  const db = testDb(); dbs.push(db);
  expect(await db.$transaction(tx => assessApproval(tx, { isolated: true }, { action, title: "做一件事", payload: {}, ...(asked ? { level: asked } : {}) }))).toMatchObject({ level, brief: { headline: "做一件事" } });
});
