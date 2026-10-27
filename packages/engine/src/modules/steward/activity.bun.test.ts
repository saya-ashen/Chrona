import { afterEach, expect, test } from "bun:test";
import { listActivity } from "./activity";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const w = (await db.workspace.create({ data: { name: "activity" } })).id;
  const web = await db.module.create({ data: { workspaceId: w, name: "web", activeHash: "5caef53c00" } });
  const version = await db.moduleVersion.create({ data: { moduleId: web.id, hash: "2a501daa00", manifest: {}, source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const approval = await db.approval.create({ data: { workspaceId: w, moduleId: web.id, action: "activate_module", title: "启用模块 web", detail: "", preview: "", payload: {}, level: "red" } });
  let at = Date.parse("2026-10-27T04:00:00Z");
  const add = (kind: string, subjectId: string | null, details: object, actorKey = "chrona") => db.audit.create({ data: { workspaceId: w, kind, subjectId, actorKey, details, createdAt: new Date(at += 1000) } });
  const ports: StewardPorts = { db, dataDir: "/nonexistent", now: () => new Date(at), publicUrl: null };
  return { db, w, web, version, approval, add, ports };
}

test.each([
  ["approval_created", "approval", {}, "生成审批「启用模块 web」（高风险）", "web"],
  ["approval_review", "approval", { outcome: "passed" }, "AI 复核「启用模块 web」：通过", "web"],
  ["approval_review", "approval", { outcome: "unavailable" }, "AI 复核「启用模块 web」：未能完成，改为问你", "web"],
  ["approval_resolved", "approval", { decision: "approve", source: "web" }, "你批准了「启用模块 web」（网页）", "web"],
  ["approval_resolved", "approval", { decision: "deny", source: "qq" }, "你拒绝了「启用模块 web」（QQ）", "web"],
  ["module_submission", "module", { hash: "2a501daa00" }, "web 提交了候选版本 2a501daa", "web"],
  ["module_build_started", "version", {}, "开始检查 web 的候选版本 2a501daa", "web"],
  ["module_build_settled", "version", { succeeded: false }, "web 的候选版本 2a501daa 检查失败", "web"],
  ["module_activate", "module", { hash: "5caef53c00" }, "web 已切换到版本 5caef53c", "web"],
  ["module_auto_activated", "module", { hash: "5caef53c00" }, "web 已自动更新到版本 5caef53c（低风险，复核通过）", "web"],
  ["module_runtime_incident", "module", { hash: "x", evidence: { reason: "Module disconnected" } }, "web 运行出错：Module disconnected", "web"],
  ["settings_updated", null, { moduleModel: {}, builds: {} }, "你修改了设置：模块模型、构建", null],
  ["secret_set", null, { name: "okx_demo" }, "你设置了凭据 okx_demo", null],
  ["approval_habits", null, { suggestions: ["stop_asking", "waiting"] }, "生成本周审批习惯建议（2 条）", null],
] as const)("activity wording: %s %j", async (kind, subject, details, text, module) => {
  const f = await fixture();
  const subjectId = subject === "approval" ? f.approval.id : subject === "module" ? f.web.id : subject === "version" ? f.version.id : null;
  await f.add(kind, subjectId, details);
  expect((await listActivity(f.ports, f.w, {})).items).toMatchObject([{ kind, text, module }]);
});

test("activity hides internal rows and Chrona's own green grants, filters by app and pages back by time", async () => {
  const f = await fixture();
  await f.add("tool_started", null, {});
  await f.add("grant_created", "g", { reason: "green module update", moduleId: f.web.id });
  for (let i = 0; i < 3; i++) await f.add("module_activate", f.web.id, { hash: `hash${i}abcd` });
  await f.add("settings_updated", null, { notifications: {} });
  const first = await listActivity(f.ports, f.w, { module: "web", limit: 2 });
  expect(first.items.map(item => item.text)).toEqual(["web 已切换到版本 hash2abc", "web 已切换到版本 hash1abc"]);
  expect((await listActivity(f.ports, f.w, { module: "web", before: first.before! })).items.map(item => item.text)).toEqual(["web 已切换到版本 hash0abc"]);
  expect((await listActivity(f.ports, f.w, {})).items).toHaveLength(4);
});
