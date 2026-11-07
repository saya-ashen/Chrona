import { afterEach, expect, test } from "bun:test";
import { activityRecords, activityRecordsOutput } from "./activity";
import { activityView } from "./builtin/notify/activity";
const listActivity = (ports: StewardPorts, workspaceId: string, args: Parameters<typeof activityView>[1]) => activityView(async (target, input) => {
  expect(target).toBe("activity.records");
  return activityRecordsOutput.parse(await activityRecords(ports, workspaceId, input));
}, args);
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const w = (await db.workspace.create({ data: { name: "activity" } })).id;
  const web = await db.module.create({ data: { workspaceId: w, name: "web", activeHash: "5caef53c00" } });
  const version = await db.moduleVersion.create({ data: { moduleId: web.id, hash: "2a501daa00", manifest: {}, source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const approval = await db.approval.create({ data: { workspaceId: w, moduleId: web.id, action: "activate_module", title: "启用模块 web", detail: "", preview: "", payload: {} } });
  let at = Date.parse("2026-10-27T04:00:00Z");
  const add = (kind: string, subjectId: string | null, details: object, actorKey = "chrona") => db.audit.create({ data: { workspaceId: w, kind, subjectId, actorKey, details, createdAt: new Date(at += 1000) } });
  const ports: StewardPorts = { db, dataDir: "/nonexistent", now: () => new Date(at), publicUrl: null };
  return { db, w, web, version, approval, add, ports };
}

test.each([
  ["approval_created", "approval", {}, "生成审批「启用模块 web」", "web"],
  ["approval_resolved", "approval", { decision: "approve", source: "web" }, "你批准了「启用模块 web」（网页）", "web"],
  ["approval_resolved", "approval", { decision: "deny", source: "qq" }, "你拒绝了「启用模块 web」（QQ）", "web"],
  ["module_submission", "module", { hash: "2a501daa00" }, "web 提交了候选版本 2a501daa", "web"],
  ["module_build_started", "version", {}, "开始检查 web 的候选版本 2a501daa", "web"],
  ["module_build_settled", "version", { succeeded: false }, "web 的候选版本 2a501daa 检查失败", "web"],
  ["module_activate", "module", { hash: "5caef53c00" }, "web 已切换到版本 5caef53c", "web"],
  ["module_auto_activated", "module", { hash: "5caef53c00" }, "web 已自动启用版本 5caef53c", "web"],
  ["module_runtime_incident", "module", { status: "retrying", failures: 2, attempts: [{ action: "failure" }], evidence: { reason: "Module disconnected" } }, "web 运行出错（第 2 次），正在有限重启：Module disconnected", "web"],
  ["module_runtime_incident", "module", { status: "unresolved", failures: 3, attempts: [{ action: "failure" }], evidence: { reason: "stopped" } }, "web 运行出错 3 次，自动恢复已停止：stopped", "web"],
  ["module_runtime_incident", "module", { status: "verifying", attempts: [{ action: "failure" }, { action: "connected" }] }, "web 已重新连接，功能待实际调用验证", "web"],
  ["module_runtime_incident", "module", { status: "verifying", attempts: [{ action: "verified" }] }, "web 部分能力已验证恢复，其余仍待验证", "web"],
  ["module_runtime_incident", "module", { status: "recovered", attempts: [{ action: "verified" }], deliveryUnknown: false }, "web 已验证恢复（未重放失败调用）", "web"],
  ["module_runtime_incident", "module", { status: "recovered", attempts: [{ action: "verified" }], deliveryUnknown: true }, "web 已验证恢复（未重放失败调用；此前有结果未知的调用，请核对外部效果）", "web"],
  ["module_disabled", "module", { source: "owner" }, "你暂停了 web", "web"],
  ["module_enabled", "module", { source: "owner" }, "你恢复了 web", "web"],
  ["module_disabled", "module", { source: "automatic", incidentId: "i" }, "web 连续失败 3 次，已自动暂停（关联故障）", "web"],
  ["module_disabled", "module", { source: "cli" }, "你在命令行暂停了 web", "web"],
  ["module_enabled", "module", { source: "cli" }, "你在命令行恢复了 web", "web"],
  ["module_disabled", "module", { source: "remove" }, "删除前暂停了 web", "web"],
  ["module_disabled", "module", { source: "chrona", reason: "检查设置" }, "Chrona 暂停了 web：检查设置", "web"],
  ["module_enabled", "module", { source: "chrona" }, "Chrona 恢复了 web", "web"],
  ["module_enabled", "module", { source: "owner", unrestoredLegacyPause: true }, "你恢复了 web；旧的自动暂停没有记录日程，相关日程仍保持暂停", "web"],
  ["module_rollback", "module", { automatic: true, hash: "1234567890" }, "web 新版本启动失败，已自动回滚到 12345678", "web"],
  ["module_rollback", "module", { hash: "1234567890" }, "web 已回滚到版本 12345678", "web"],
  ["settings_updated", null, { moduleModel: {}, builds: {} }, "你修改了设置：模块模型、构建", null],
  ["secret_set", null, { name: "okx_demo" }, "你设置了凭据 okx_demo", null],
] as const)("activity wording: %s %j", async (kind, subject, details, text, module) => {
  const f = await fixture();
  const subjectId = subject === "approval" ? f.approval.id : subject === "module" ? f.web.id : subject === "version" ? f.version.id : null;
  await f.add(kind, subjectId, details);
  expect((await listActivity(f.ports, f.w, {})).items).toMatchObject([{ kind, text, module }]);
});

test("audit facts exclude raw details, credentials and other workspaces", async () => {
  const f = await fixture();
  await f.add("settings_updated", null, { notifications: { token: "private-notification-credential" }, moduleModel: { apiKey: "private-model-credential" } });
  await f.add("module_runtime_incident", f.web.id, { id: "safe", status: "retrying", evidence: { reason: "token=private-token", raw: "private-raw" }, request: "private-request", token: "private-token" });
  const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
  await f.db.audit.create({ data: { workspaceId: foreign.id, actorKey: "chrona", kind: "secret_set", details: { name: "foreign-name" } } });
  const facts = activityRecordsOutput.parse(await activityRecords(f.ports, f.w, {}));
  const encoded = JSON.stringify(facts);
  for (const value of ["private-notification-credential", "private-model-credential", "private-token", "private-raw", "private-request", "foreign-name"]) expect(encoded).not.toContain(value);
  expect(facts.rows.find(row => row.kind === "settings_updated")!.details).toEqual({ settingsKeys: ["notifications", "moduleModel"] });
  expect(facts.rows).toHaveLength(2);
});

test("activity aggregates nonconsecutive incident snapshots before limiting, preserving the newest row", async () => {
  const f = await fixture();
  await f.add("module_runtime_incident", f.web.id, { id: "a", status: "retrying", failures: 1 });
  await f.add("module_runtime_incident", f.web.id, { id: "b", status: "unresolved", failures: 3 });
  await f.add("module_runtime_incident", f.web.id, { id: "a", attempts: [{ action: "connected" }], status: "verifying" });
  const newest = await f.add("module_runtime_incident", f.web.id, { id: "a", attempts: [{ action: "verified" }], status: "recovered" });
  const view = await listActivity(f.ports, f.w, {});
  expect(view.items).toHaveLength(2);
  expect(view.items[0]).toMatchObject({ id: newest.id, at: newest.createdAt.toISOString(), text: "web 已验证恢复（未重放失败调用）（共 3 次更新）" });
  expect(view.items[1]!.text).toBe("web 运行出错 3 次，自动恢复已停止：见诊断");
  expect((await listActivity(f.ports, f.w, { limit: 1 })).items).toEqual(view.items.slice(0, 1));
  expect((await listActivity(f.ports, f.w, { limit: 2 })).items).toEqual(view.items);
});

test("activity aggregates incidents across scanned pages", async () => {
  const f = await fixture();
  await f.add("module_runtime_incident", f.web.id, { id: "a", status: "retrying", failures: 1 });
  for (let i = 0; i < 201; i++) await f.add("grant_created", null, { reason: "green module update" });
  const newest = await f.add("module_runtime_incident", f.web.id, { id: "a", status: "recovered" });
  const view = await listActivity(f.ports, f.w, {});
  expect(view.items).toHaveLength(1);
  expect(view.items[0]).toMatchObject({ id: newest.id, at: newest.createdAt.toISOString(), text: "web 已验证恢复（未重放失败调用）（共 2 次更新）" });
});

test("activity finds a quiet app beyond 300 rows of another app's activity", async () => {
  const f = await fixture();
  const other = await f.db.module.create({ data: { workspaceId: f.w, name: "busy" } });
  const quiet = await f.add("module_activate", f.web.id, { hash: "quiet123" });
  for (let i = 0; i < 301; i++) await f.add("module_activate", other.id, { hash: "busy1234" });
  const view = await listActivity(f.ports, f.w, { module: "web", limit: 30 });
  expect(view.items).toMatchObject([{ id: quiet.id, module: "web", text: "web 已切换到版本 quiet123" }]);
  expect(view.items).toHaveLength(1);
  expect(view.before).toBeNull();
});

test("activity caps failure reasons at 120 characters", async () => {
  const f = await fixture();
  await f.add("module_runtime_incident", f.web.id, { status: "retrying", failures: 1, evidence: { reason: "长".repeat(150) } });
  expect((await listActivity(f.ports, f.w, {})).items[0]!.text).toBe(`web 运行出错（第 1 次），正在有限重启：${"长".repeat(120)}`);
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
