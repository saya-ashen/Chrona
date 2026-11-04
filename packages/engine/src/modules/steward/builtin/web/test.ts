import { strict as assert } from "node:assert";
import { builder } from "./src/system/spec";
import { diagnosticNodes, checksText } from "./src/system/diagnostics";
import { detailSpec, selectedTab } from "./src/system/detail";
import { settingValue } from "./src/system/forms";
import type { Diagnostic } from "./src/system/detail-types";
import { catalog } from "./catalog";
import { pageErrors } from "./pages";
import { systemCall } from "./src/system/adapter";
import { todaySpec } from "./src/system/today";
import { activitySpec } from "./src/system/activity";
import { appsSpec } from "./src/system/apps";
import { settingsSpec, liveGrant, scheduleActions } from "./src/system/settings";
import { modelValue } from "./src/system/model-settings";
import { chatSpec, selectedSession, openMessages, type Message } from "./src/system/chat";
import type { ReplyEvent } from "./src/system/adapter";
import { localTime, Time } from "./src/display";
import { loginSpec } from "./src/system/login";
import { systemPage } from "./src/system/page";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

type Args = Record<string, unknown>;
const calls: [string, Args][] = [];
const stub = (target: string, answer: (args: Args) => unknown) => [target, (args: Args) => { calls.push([target, args]); return answer(args); }] as const;
const module = await startModule("index.ts", { stubs: Object.fromEntries([
  stub("chat.today", () => ({ approvals: [] })),
  stub("chat.session", args => ({ id: args.session, key: "web:k1" })),
  stub("chat.send", () => ({ sessionId: "s1", messageId: "m1" })),
  stub("chat.messages", () => []),
  stub("approvals.resolve", args => ({ id: args.approval })),
  stub("modules.diagnostics", args => [{ moduleId: args.module, incidents: [] }]),
  stub("modules.system", args => ({ name: "memory", args })),
  stub("modules.overview", args => ({ kind: "app", module: args.module })), stub("modules.settings-set", args => args),
  stub("activity.list", args => ({ items: [{ id: "x", at: "2026-10-27T04:42:00.000Z", kind: "module_activate", module: "web", text: "web 已切换到版本 5caef53c" }], before: null, args })),
  stub("modules.permissions", args => ({ module: args.module, capabilities: ["联网"], secrets: [], model: null, grants: [], approvals: [] })),
  stub("modules.tools", args => args.query === "files"
    ? [{ target: "files.list", description: "List", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] }, idempotent: true }, { target: "files.delete", description: "Delete", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, idempotent: false }]
    : [{ target: "planning.get", description: "Get", inputSchema: { type: "object", properties: {}, required: [] }, idempotent: true }]),
  stub("modules.list", () => [{ id: "m-files", name: "files", status: "active" }, { id: "m-p", name: "planning", status: "paused" }]),
  stub("planning.get", () => ({ plan: 1 })),
  stub("modules.stop-build", args => ({ status: "build_stopped", sessionId: args.session })),
  stub("modules.revise-build", args => ({ status: "build_revised", sessionId: args.session })),
  stub("settings.get", () => ({ notifications: {} })), stub("settings.grants", () => []), stub("settings.preferences", () => []), stub("schedules.list", () => []),
  stub("secrets.list", () => [{ name: "okx_demo", configured: false, updatedAt: null, modules: ["okx-ai-trader"] }]), stub("secrets.set", args => ({ name: args.name, configured: true })), stub("secrets.remove", args => ({ name: args.name, configured: false })), stub("secrets.authorize", () => ({ url: "https://accounts.example/auth", redirectUri: "https://chrona.example/oauth/callback", expiresAt: "2026-11-02T04:00:00Z" })),
  stub("settings.update", args => args), stub("chat.answer", args => args), stub("schedules.update", args => args),
  stub("content.read", args => {
    if (args.ref === "files/missing.png") return null;
    return { base64: png.toString("base64"), mime: args.ref === "files/no.svg" ? "image/svg+xml" : "image/png", size: png.length, sha256: "fixture" };
  }),
  stub("chat.file", args => ({ base64: Buffer.from(`file ${args.ref}`).toString("base64"), mime: "text/plain" })),
]) });
async function get(path: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(`http://module${path}`, { unix: module.httpSocket, ...init }); }
    catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
const post = async (path: string, body: unknown) => get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
// Exercise the shipped specs directly; browser acceptance checks the mounted renderer.
async function checkHealthRendering() {
  const view = { approvals: [], upcoming: [], updates: [], apps: [], sessions: [], problems: [] as Args[] };
  const health = { configuredStatus: "paused", runtime: { state: "paused" }, activeHash: "same-hash",
    activation: { activationId: "current", hash: "same-hash", status: "verified", observedCapabilities: ["tool:read"] },
    consecutiveFailures: 2, incident: { status: "verifying", pendingTriggers: ["tool:write"], deliveryUnknown: true },
    contractFailureCount: 4, nextAction: "检查实际效果", truncated: true,
    evolution: [{ status: "failed", candidateHash: "same-hash", activatedAt: "2026-11-04", changes: [], checks: {}, affectedCallers: [], observedCapabilities: [], dataHandling: "保留数据", nextAction: "查看恢复条件", rollback: { result: "blocked", reason: "条件不符" } }],
    incidents: [
      { activationId: "current", attribution: "activation" },
      { activationId: "earlier", attribution: "activation" },
      { attribution: "legacy-unattributed" },
    ].map(item => ({ ...item, hash: "same-hash", status: "unresolved", failures: 1, lastAt: "2026-11-04", evidence: { reason: "失败" }, attempts: [], pendingTriggers: [] })) };
  const rendered = () => JSON.stringify(todaySpec({ today: view, runs: [] }));
  assert.doesNotMatch(rendered(), /需要处理的应用/);
  view.problems = ["unresolved", "verifying", "retrying", null].map(incidentStatus => ({ module: "示例应用", moduleId: "app-1", incidentStatus, contractFailures: 4, nextAction: "检查实际效果" }));
  const today = rendered();
  for (const text of ["需要处理的应用（4）", "/apps/app-1", "未解决，需要处理", "连接已恢复，功能待验证", "正在有限恢复", "输出不符合契约 4 次", "检查实际效果"]) assert.ok(today.includes(text), text);
  assert.ok(today.indexOf("需要处理的应用") < today.indexOf("接下来"));
  const b = builder();
  diagnosticNodes(b, { view: health as Diagnostic }, "app-1", "示例应用");
  const diagnostics = JSON.stringify(b.finish("诊断", []));
  const ordered = ["配置：已暂停", "当前版本 same-hash", "连续失败 2/3", "连接已恢复，功能待验证", "待验证能力：tool:write", "此前调用结果不确定", "输出契约不符 4 次（当前版本）", "检查实际效果", "记录较多，摘要可能不完整", "已采取保护：自动恢复受阻", "历史"];
  for (const [index, text] of ordered.entries()) {
    assert.ok(diagnostics.includes(text), text);
    if (index) assert.ok(diagnostics.indexOf(ordered[index - 1]!) < diagnostics.indexOf(text), text);
  }
  for (const label of ["当前版本 · 版本", "更早的启用 · 版本", "旧记录（归属未知） · 版本", "故障证据", "已观测功能：tool:read"]) assert.ok(diagnostics.includes(label), label);
  const articles = Object.values(b.finish("", []).elements).filter(node => node.type === "Article").slice(-3);
  assert.deepEqual(articles.map(node => b.finish("", []).elements[node.children![0]!]!.props.text), ["未解决，需要处理", "更早的启用", "旧记录（归属未知）"]);
  for (const article of articles.slice(1)) {
    const status = b.finish("", []).elements[article.children![1]!]!;
    assert.equal(status.props.variant, "muted");
    assert.equal(status.props.text, "该次启用结束时：未解决，需要处理");
  }
  assert.equal(checksText({ tests: { count: 3, failed: 0 } }), "测试 3 项全部通过");
  assert.equal(checksText({ tests: { count: 3, failed: 1 }, smoke: "passed" }), "测试 3 项，失败 1；smoke: 通过");
  assert.equal(checksText({ typecheck: { status: "passed", errorCount: 0 }, continuity: { status: "failed", callers: { affected: 2, checked: 3 } }, smoke: { status: "unrecorded" } }), "typecheck: status 通过、errorCount 0；continuity: status 失败、callers affected 2、checked 3；smoke: status 未记录");
  const errorPage = systemPage({ name: "error", message: "读取失败 <script>" });
  assert.deepEqual(errorPage.data, {});
  assert.match(JSON.stringify(errorPage.spec({})), /读取失败 <script>.*返回今天/);
  assert.equal(Object.values(errorPage.spec({}).elements).filter(node => node.type === "Alert").length, 1);
  assert.match(JSON.stringify(systemPage({ name: "login", message: "请重新输入" }).spec({})), /请重新输入/);
  assert.deepEqual(systemPage({ name: "activity", module: "a/b" }).data, { activity: { tool: "activity", args: { module: "a/b" } } });
  assert.deepEqual(systemPage({ name: "app", id: "a/b", tab: "activity", session: "" }).data.diagnostics!.args, { id: "a/b" });
  assert.match(JSON.stringify(systemPage({ name: "chat", path: "/chat/new" }).spec({ sessions: [] })), /ChatStream/);
  const readable = builder();
  diagnosticNodes(readable, { view: { ...health, evolution: [{ ...health.evolution[0]!, checks: { tests: { count: 3, failed: 1 } } }] } as Diagnostic }, "app-1", "示例应用");
  assert.match(JSON.stringify(readable.finish("", [])), /检查：测试 3 项，失败 1/);
  const failed = builder(); diagnosticNodes(failed, { failure: "offline" }, "app-1", "示例应用");
  assert.match(JSON.stringify(failed.finish("", [])), /诊断读取失败：offline.*chrona admin diagnostics 示例应用/);
  const empty = builder(); diagnosticNodes(empty, { view: { ...health, evolution: [], incidents: [] } as Diagnostic }, "app-1", "示例应用");
  assert.match(JSON.stringify(empty.finish("", [])), /还没有故障记录；不代表所有功能已经过验证/);

}
async function checkAdapter() {
  const mapped: unknown[] = [];
  const call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async (...args) => { mapped.push(args); return {}; }, login: async key => { mapped.push(["login", key]); } });
  for (const name of ["today", "runs", "modules"]) await call(`$web.${name}`, {});
  await call("$web.resolve", { id: "a/b", decision: "deny" });
  await call("$web.answer", { id: "q", answer: { decision: "submit", value: false } });
  await call("$web.cancel", { id: "r" });
  await call("$web.feedback", { id: "n", feedback: "useful" });
  await call("$web.login", { key: " fixture " });
  assert.deepEqual(mapped, [["/today"], ["/runs"], ["/modules"], ["/approvals/a%2Fb/resolve", { method: "POST", body: { decision: "deny", scope: "once" } }], ["/interactions/q/answer", { method: "POST", body: { decision: "submit", value: false } }], ["/runs/r/cancel", { method: "POST", body: {} }], ["notify.feedback", { id: "n", feedback: "useful" }], ["login", "fixture"]]);
  mapped.length = 0;
  await call("$web.system-apps", {});
  await call("$web.activity", {});
  await call("$web.activity", { module: "a/b &中", before: "2026-11-04T10:00:00+08:00" });
  assert.deepEqual(mapped, [["/system-apps"], ["/activity?"], ["/activity?module=a%2Fb+%26%E4%B8%AD&before=2026-11-04T10%3A00%3A00%2B08%3A00"]]);
  mapped.length = 0;
  for (const name of ["overview", "diagnostics", "transcript"]) await call(`$web.${name}`, { id: "a/b 中" });
  await call("$web.settings-save", { id: "a/b", values: { on: true, count: 2, text: "x" } });
  await call("$web.secret-save", { id: "a/b", value: { token: "fake" } });
  await call("$web.secret-remove", { id: "a/b", field: "token" });
  await call("$web.secret-remove", { id: "a/b" });
  await call("$web.authorize", { id: "a/b", value: { provider: "google", scopes: "read", account: "work" } });
  await call("$web.revoke", { id: "g/1" });
  await call("$web.call", { target: "app.read", args: { count: 2 } });
  await call("$web.memory", { query: "a/b 中" });
  await call("$web.forget", { id: "m/1" });
  await call("$web.settings", {});
  await call("$web.settings-update", { settings: { moduleModel: { moduleDailyCalls: { example: 4 } } } });
  assert.deepEqual(mapped, [
    ["/modules/a%2Fb%20%E4%B8%AD/overview"], ["/modules/a%2Fb%20%E4%B8%AD/diagnostics"], ["/sessions/a%2Fb%20%E4%B8%AD/transcript"],
    ["/modules/a%2Fb/settings", { method: "POST", body: { values: { on: true, count: 2, text: "x" } } }],
    ["/secrets/a%2Fb", { method: "POST", body: { value: { token: "fake" } } }], ["/secrets/a%2Fb/remove", { method: "POST", body: { field: "token" } }], ["/secrets/a%2Fb/remove", { method: "POST", body: {} }],
    ["/secrets/a%2Fb/authorize", { method: "POST", body: { provider: "google", scopes: "read", account: "work" } }], ["/grants/g%2F1/revoke", { method: "POST", body: {} }],
    ["/call", { method: "POST", body: { target: "app.read", args: { count: 2 } } }], ["/memory?query=a%2Fb%20%E4%B8%AD"], ["/memory/forget", { method: "POST", body: { id: "m/1" } }], ["/settings"], ["/settings", { method: "POST", body: { moduleModel: { moduleDailyCalls: { example: 4 } } } }],
  ]);
  const readMapped: unknown[] = [];
  const reads = systemCall({ web: async (...args) => { readMapped.push(args); return { items: ["recent"] }; }, tool: async () => ({}), login: async () => {} });
  await reads("$web.tools", { query: "a/b 中" }); await reads("$web.pages", {});
  assert.deepEqual(await reads("$web.detail-activity", { module: "a/b 中" }), ["recent"]);
  await reads("$web.memory", {});
  assert.deepEqual(readMapped, [["/tools?query=a%2Fb%20%E4%B8%AD"], ["/pages"], ["/activity?module=a%2Fb%20%E4%B8%AD"], ["/memory"]]);
  const optional = systemCall({ web: async () => { throw new Error("offline"); }, tool: async () => ({}), login: async () => {} });
  assert.deepEqual(await optional("$web.system-apps", {}), []);
  assert.deepEqual(await optional("$web.diagnostics", { id: "x" }), { failure: "offline" });
  assert.deepEqual(await optional("$web.pages", {}), []);
  assert.deepEqual(await optional("$web.detail-activity", { module: "x" }), []);
  await assert.rejects(optional("$web.activity", {}), /offline/);
  await assert.rejects(call("files.today", {}), /未知系统操作/);
  await assert.rejects(call("$web.constructor", {}), /未知系统操作/);
}
function checkDetailSpecs() {
  assert.equal(selectedTab("unknown"), "overview"); assert.equal(selectedTab("permissions", true), "overview"); assert.equal(selectedTab("settings", true, "session"), "overview");
  for (const [type, value, checked, expected] of [["boolean", "on", true, true], ["boolean", "", false, false], ["number", "2.5", false, 2.5], ["text", "文本", false, "文本"]] as const) assert.equal(settingValue(type, value, checked), expected);
  const overview = { app: { id: "app/1", name: "example", status: "active", health: {}, activeHash: "abc", runs: [], versions: [] }, settings: { declarations: {}, values: {} }, permissions: { capabilities: [], grants: [], approvals: [], secrets: [], model: null }, activity: [] };
  const fallback = detailSpec({ overview }, { id: "app/1", tab: "unknown", session: "" });
  const tabs = Object.values(fallback.elements).find(node => node.type === "TabNav")!.props.items as { current: boolean; href: string }[];
  assert.equal(tabs[0]!.current, true); assert.equal(tabs.filter(tab => tab.current).length, 1); assert.equal(tabs[0]!.href, "/apps/app%2F1?tab=overview");
  assert.match(JSON.stringify(detailSpec({ overview: {} }, { id: "missing", tab: "overview", session: "" })), /没有这个应用/);
}
function checkListSpecs() {
  for (const filtered of [false, true]) {
    for (const before of [null, "older"]) {
      const spec = activitySpec({ activity: { items: [
        { id: "build", at: "2026-11-04T09:00:00Z", module: "a/b", text: "构建记录", session: { id: "build-id", source: "build" } },
        { id: "other", at: "bad", module: "a/b", text: "反思记录", session: { id: "session /中", source: "reflect" } },
      ], before } }, filtered ? "a/b" : "");
      const elements = Object.values(spec.elements), serialized = JSON.stringify(spec);
      assert.equal(spec.elements[spec.root]!.props.title, filtered ? "活动 · a/b" : "活动");
      assert.equal(elements.some(item => item.type === "ActivityMore"), !!before);
      assert.equal(elements.some(item => item.props.label === "看全部应用"), filtered);
      assert.equal(elements.some(item => item.props.href === "/activity?module=a%2Fb"), !filtered);
      for (const expected of ["构建记录", "反思记录", "/sessions/build-id", "/apps/system/a%2Fb?session=session%20%2F%E4%B8%AD", "Time"]) assert.ok(serialized.includes(expected), expected);
    }
  }
  assert.match(JSON.stringify(activitySpec({ activity: { items: [], before: null } })), /还没有活动。/);
  assert.match(JSON.stringify(activitySpec({})), /加载中/);
  for (const systemApps of [[], [{ name: "chat", description: "系统对话" }]]) {
    const spec = appsSpec({ apps: [{ id: "app /", name: "示例", builtin: true, description: "应用说明", health: { runtime: { state: "running" }, incident: { status: "unresolved" } } }], systemApps });
    const serialized = JSON.stringify(spec);
    assert.match(serialized, /运行中 · 未解决，需要处理 · 内置 · 应用说明/);
    assert.ok(serialized.includes("/apps/app%20%2F"));
    assert.equal(Object.values(spec.elements).some(item => item.props.title === "系统"), !!systemApps.length);
    if (systemApps.length) for (const expected of ["/apps/system/chat", "系统对话", "Chrona 自身的一部分"]) assert.ok(serialized.includes(expected));
  }
  assert.match(JSON.stringify(appsSpec({})), /加载中/);
}
function checkDisplayAndReach() {
  for (const value of ["", "bad", null, undefined]) {
    assert.equal(localTime(value), "时间未知");
    assert.equal(Time({ value }).props.children, "时间未知");
    assert.equal(Time({ value }).props.dateTime, undefined);
  }
  assert.match(localTime("2026-11-04T09:00:00Z"), /2026.*11.*04/);
  assert.equal(Object.keys(loginSpec().elements).length, 3);
  for (const type of ["ChatStream", "NotificationSettings", "BuildSettings", "ModuleModelSettings", "Approval", "Question", "SystemAction", "ActivityMore", "LoginForm", "SettingsForm", "ToolForm", "ModelCap", "Credentials", "DiagnosticRefresh", "MemoryPanel", "SessionWork"]) {
    assert.ok(pageErrors({ spec: { root: "x", elements: { x: { type, props: {}, children: [] } } } }, new Map(), "files").length);
  }
  const escaped = { root: "x", elements: { x: { type: "Button", props: { label: "x" }, children: [], on: { press: { action: "call", params: { tool: "$web.resolve" } } } } } };
  assert.ok(pageErrors({ spec: escaped }, new Map(), "files").length);
}
async function checkSettingsAdapter() {
  const mapped: unknown[] = [];
  const call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  for (const status of ["paused", "active", "cancelled"]) await call("$web.schedule-update", { id: "a/b 中", status });
  await call("$web.preference-forget", { id: "p/1" });
  assert.deepEqual(mapped, [
    ...["paused", "active", "cancelled"].map(status => ["/schedules/a%2Fb%20%E4%B8%AD", { method: "POST", body: { status } }]),
    ["/preferences/p%2F1/forget", { method: "POST", body: {} }],
  ]);
}
function checkModelValues() {
  const numbers = { maxCallsPerEvent: "3", maxOutputTokens: "4000", dailyCalls: "30", timeoutSeconds: "123" };
  assert.deepEqual(modelValue([
    { tier: " strong ", model: " provider/model ", thinking: "high" },
    { tier: "fast", model: "provider/fast", thinking: "" },
    { tier: "", model: "ignored", thinking: "off" }, { tier: "ignored", model: " ", thinking: "" },
  ], [{ module: " example ", calls: "0" }, { module: "other", calls: "12" }, { module: "", calls: "4" }, { module: "ignored", calls: "" }], numbers), {
    models: { strong: { model: "provider/model", thinking: "high" }, fast: { model: "provider/fast" } }, maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, timeoutMs: 123000, moduleDailyCalls: { example: 0, other: 12 },
  });
  assert.deepEqual(modelValue([], [], numbers), { models: {}, maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, timeoutMs: 123000 });
}
function checkSettingsRules() {
  const now = Date.parse("2026-11-04T10:00:00Z"), base = { id: "g", action: "read_source", mode: "allow", scope: { kind: "global" } };
  for (const [patch, expected] of [[{}, true], [{ revokedAt: "2026-11-01" }, false], [{ once: true, consumedAt: "2026-11-01" }, false], [{ once: false, consumedAt: "2026-11-01" }, true], [{ once: true }, true], [{ expiresAt: "2026-11-04T10:00:00Z" }, false], [{ expiresAt: "2026-11-04T09:59:59Z" }, false], [{ expiresAt: "2026-11-04T10:00:01Z" }, true]] as const) assert.equal(liveGrant({ ...base, ...patch }, now), expected);
  for (const [status, label, next] of [["active", "暂停", "paused"], ["paused", "恢复", "active"]]) {
    const actions = scheduleActions({ id: "schedule", mode: "cron", status: status! });
    assert.deepEqual(actions[0], { label, tool: "schedule-update", args: { id: "schedule", status: next } });
    assert.deepEqual(actions[1], { label: "取消", tool: "schedule-update", args: { id: "schedule", status: "cancelled" }, confirm: "取消这个日程？" });
  }
  assert.match(JSON.stringify(settingsSpec({})), /加载中/);
}
function checkSettingsSpec() {
  const settings = { notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" }, builds: { dailyLimit: 10, timeoutMinutes: 30, maxSubmissions: 3 }, buildUsage: { date: "2026-11-04", timezone: "UTC", used: 2, remaining: 8 } };
  const settingsView = { settings, schedules: [], grants: [], preferences: [] };
  const empty = JSON.stringify(settingsSpec({ settingsView }));
  for (const text of ["2026-11-04（UTC）：今日新建 2 / 10，剩余 8 个。", "尚未配置：模块不能调用模型。", "今天还没有模块调用模型。", "没有日程。", "没有授权规则。", "还没有。"]) assert.ok(empty.includes(text), text);
  const spec = settingsSpec({ apps: [{ id: "app /", name: "example" }], systemApps: [{ name: "system /" }], settingsView: { ...settingsView,
    secrets: [{ modules: ["example"], configured: false }],
    schedules: [{ id: "active", mode: "wake", status: "active", nextAt: "2026-11-05T10:00:00Z" }, { id: "paused", label: "暂停日程", mode: "wake", status: "paused" }, { id: "dead", label: "已结束隐藏", mode: "wake", status: "done" }],
    grants: [{ id: "g", action: "read_source", mode: "ask", scope: { kind: "global" } }], preferences: [{ id: "p", text: "偏好中文" }],
  } });
  const serialized = JSON.stringify(spec);
  for (const text of ["/apps/app%20%2F?tab=settings", "/apps/system/system%20%2F?tab=settings", "凭据未设置", "已暂停", "Time", "read_source · 先问我", "全部", "偏好中文", "删除这条偏好？"]) assert.ok(serialized.includes(text), text);
  assert.ok(!serialized.includes("已结束隐藏"));
  const actions = Object.values(spec.elements).filter(node => node.type === "SystemAction");
  assert.equal(actions.filter(node => node.props.tool === "schedule-update").length, 4);
}
async function checkChat() {
  const mapped: unknown[] = [], call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  await call("$web.sessions", {}); await call("$web.messages", { id: "a/b 中" });
  await call("$web.chat", { text: "new" }); await call("$web.chat", { text: "existing", session: "s" });
  await call("$web.revise-build", { id: "a/b", requirements: "修改" }); await call("$web.stop-build", { id: "a/b" });
  await call("$web.file", { message: "m /", ref: "chat/a 中.txt" });
  assert.deepEqual(mapped, [["/sessions"], ["/sessions/a%2Fb%20%E4%B8%AD/messages"], ["/chat", { method: "POST", body: { text: "new" } }], ["/chat", { method: "POST", body: { text: "existing", session: "s" } }], ["/sessions/a%2Fb/revise-build", { method: "POST", body: { requirements: "修改" } }], ["/sessions/a%2Fb/stop-build", { method: "POST", body: {} }], ["/file?message=m%20%2F&ref=chat%2Fa%20%E4%B8%AD.txt", { raw: true }]]);
  const sessions = [{ id: "newest", title: "最新", source: "web", createdAt: "2026-11-04" }, { id: "a/b", source: "build", createdAt: "2026-11-03" }];
  for (const [path, expected] of [["/chat", "newest"], ["/chat/new", null], ["/sessions/a%2Fb", "a/b"], ["/sessions/missing", "missing"]] as const) {
    assert.equal(selectedSession(path, sessions), expected);
    const nodes = Object.values(chatSpec({ sessions }, path).elements), stream = nodes.find(node => node.type === "ChatStream")!;
    assert.equal(stream.props.session, expected); assert.equal(stream.props.building, expected === "a/b");
    assert.equal(nodes.filter(node => node.type === "Link" && node.props.current).length, expected === "newest" || expected === "a/b" ? 1 : 0);
    assert.ok(nodes.some(node => node.props.href === "/chat/new")); assert.ok(nodes.some(node => node.props.href === "/sessions/a%2Fb")); assert.ok(nodes.some(node => node.type === "Time"));
  }
  assert.equal(selectedSession("/chat", []), null); assert.match(JSON.stringify(chatSpec({}, "/chat")), /加载中/);
}
async function checkReplies() {
  let listener!: (event: ReplyEvent) => void, finish!: (messages: Message[]) => void, closed = 0, replies = 0;
  const snapshots: Message[][] = [], errors: Error[] = [];
  const opened = openMessages("s", callback => { listener = callback; return () => { closed++; }; }, () => new Promise(resolve => { finish = resolve; }), { show: items => snapshots.push(items), reply: () => { replies++; }, fail: error => errors.push(error) });
  const event = { type: "reply", session: "s", message: "m2", text: "reply", attachments: '[{"name":"a.txt","ref":"chat/a"}]' };
  listener({ ...event, session: "other" }); listener({ ...event, type: "other" }); listener(event); listener(event);
  assert.equal(snapshots.length, 0);
  finish([{ id: "m1", text: "question", direction: "in" }, { id: "m2", text: "reply", direction: "out" }]); await opened.ready;
  assert.deepEqual(snapshots.at(-1)!.map(message => message.id), ["m1", "m2"]);
  listener(event); listener({ ...event, message: "m3" });
  assert.deepEqual(snapshots.at(-1)!.map(message => message.id), ["m1", "m2", "m3"]);
  assert.deepEqual(snapshots.at(-1)!.at(-1)!.attachments, [{ name: "a.txt", ref: "chat/a" }]); assert.equal(replies, 4);
  opened.append({ id: "m4", text: "sent", direction: "in" }); assert.equal(snapshots.at(-1)!.at(-1)!.id, "m4");
  opened.close(); assert.equal(closed, 1); const count = snapshots.length; listener({ ...event, message: "m5" }); assert.equal(snapshots.length, count);
  const late = openMessages("s", callback => { listener = callback; return () => { closed++; }; }, () => new Promise(resolve => { finish = resolve; }), { show: items => snapshots.push(items), reply: () => {}, fail: error => errors.push(error) });
  late.close(); finish([{ id: "late", text: "ignored", direction: "out" }]); await late.ready; assert.equal(snapshots.length, count); assert.equal(closed, 2); assert.deepEqual(errors, []);
}
async function checkSystemPages() {
  await checkChat();
  await checkReplies();
  await checkAdapter();
  await checkSettingsAdapter();
  checkModelValues();
  checkSettingsRules();
  checkSettingsSpec();
  checkDetailSpecs();
  checkListSpecs();
  checkDisplayAndReach();
}
try {
  await checkSystemPages();
  for (const path of ["/", "/today", "/apps/a1?path=README.md", "/sessions/s1"]) {
    const page = await get(path);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await page.text(), /<script src="\/app.js" type="module">/);
    assert.match(page.headers.get("content-security-policy")!, /default-src 'self'/);
  }
  const script = await get("/app.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  const source = await script.text();
  assert.match(source, /\/api\/web/);
  await checkHealthRendering();
  assert.equal((await get("/style.css")).headers.get("content-type"), "text/css; charset=utf-8");
  // Pages apps register are drawn by pages.js, built from src/pages.tsx.
  const pagesScript = await get("/pages.js");
  assert.equal(pagesScript.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await pagesScript.text(), /Built from src\/pages\.tsx/);
  // Static pages make no calls.
  assert.equal(calls.length, 0);

  // The data API answers from routed calls.
  assert.deepEqual(await (await get("/api/web/today")).json(), { approvals: [] });
  assert.deepEqual(await (await get("/api/web/modules/a1/diagnostics")).json(), [{ moduleId: "a1", incidents: [] }]);
  assert.deepEqual(calls.at(-1), ["modules.diagnostics", { module: "a1" }]);
  assert.equal((await (await get("/api/web/activity?module=web&before=2026-10-27T05:00:00.000Z")).json()).items[0].text, "web 已切换到版本 5caef53c");
  assert.deepEqual(calls.at(-1), ["activity.list", { module: "web", before: "2026-10-27T05:00:00.000Z" }]);
  assert.equal((await (await get("/api/web/system-apps?module=memory")).json()).name, "memory");
  assert.deepEqual(calls.at(-1), ["modules.system", { module: "memory" }]);
  assert.equal((await (await get("/api/web/modules/okx/overview")).json()).module, "okx");
  await post("/api/web/modules/okx/settings", { values: { "max-loss": 50 } });
  assert.deepEqual(calls.at(-1), ["modules.settings-set", { module: "okx", values: JSON.stringify({ "max-loss": 50 }) }]);
  assert.deepEqual(await (await get("/api/web/modules/a1/permissions")).json(), { module: "a1", capabilities: ["联网"], secrets: [], model: null, grants: [], approvals: [] });
  assert.deepEqual(await (await post("/api/web/chat", { text: "hi", session: "s1" })).json(), { sessionId: "s1", messageId: "m1" });
  assert.deepEqual(calls.at(-1), ["chat.send", { key: "web:k1", text: "hi", channel: "in_app" }]);
  await post("/api/web/chat", { text: "new" });
  assert.match(String(calls.at(-1)![1].key), /^web:/); assert.notEqual(calls.at(-1)![1].key, "web:k1");
  await post("/api/web/approvals/a1/resolve", { decision: "approve", scope: "once" });
  assert.deepEqual(calls.at(-1), ["approvals.resolve", { approval: "a1", decision: "approve", scope: "once" }]);
  assert.deepEqual(await (await post("/api/web/call", { target: "planning.get", args: {} })).json(), { plan: 1 });
  assert.equal((await post("/api/web/call", { target: "approvals.resolve", args: {} })).status, 404);
  assert.equal((await post("/api/web/call", { target: "$web.resolve", args: {} })).status, 404);
  assert.equal((await get("/api/web/nope")).status, 404);
  assert.deepEqual(await (await post("/api/web/sessions/b1/stop-build", {})).json(), { status: "build_stopped", sessionId: "b1" });
  assert.deepEqual(calls.at(-1), ["modules.stop-build", { session: "b1" }]);
  await post("/api/web/sessions/b1/revise-build", { requirements: "保留原文件" });
  assert.deepEqual(calls.at(-1), ["modules.revise-build", { session: "b1", requirements: "保留原文件" }]);
  // Settings and Provider questions go to their system interfaces (v2-9).
  assert.deepEqual(await (await get("/api/web/settings")).json(), { settings: { notifications: {} }, grants: [], preferences: [], schedules: [], secrets: [{ name: "okx_demo", configured: false, updatedAt: null, modules: ["okx-ai-trader"] }] });
  // Credentials (v2-16): written through, never echoed; not reachable through the generic call route.
  assert.deepEqual(await (await post("/api/web/secrets/okx_demo", { value: { apiKey: "k" } })).json(), { name: "okx_demo", configured: true });
  // The page merges: fields it leaves out keep their saved values.
  assert.deepEqual(calls.at(-1), ["secrets.set", { name: "okx_demo", value: JSON.stringify({ apiKey: "k" }), merge: true }]);
  await post("/api/web/secrets/okx_demo/remove", {});
  assert.deepEqual(calls.at(-1), ["secrets.remove", { name: "okx_demo" }]);
  await post("/api/web/secrets/okx_demo/remove", { field: "apiKey" });
  assert.deepEqual(calls.at(-1), ["secrets.remove", { name: "okx_demo", field: "apiKey" }]);
  await post("/api/web/secrets/okx_demo/authorize", { provider: "google", scopes: "s1 s2", account: "work" });
  assert.deepEqual(calls.at(-1), ["secrets.authorize", { name: "okx_demo", provider: "google", scopes: "s1 s2", account: "work" }]);
  assert.equal((await post("/api/web/call", { target: "secrets.set", args: {} })).status, 404);
  await post("/api/web/settings", { notifications: { dailyCap: 3 } });
  assert.deepEqual(calls.at(-1), ["settings.update", { settings: JSON.stringify({ notifications: { dailyCap: 3 } }) }]);
  await post("/api/web/settings", { builds: { dailyLimit: 20, timeoutMinutes: 60, maxSubmissions: 5 } });
  assert.deepEqual(calls.at(-1), ["settings.update", { settings: JSON.stringify({ builds: { dailyLimit: 20, timeoutMinutes: 60, maxSubmissions: 5 } }) }]);
  await post("/api/web/interactions/i1/answer", { decision: "submit", value: true });
  assert.deepEqual(calls.at(-1), ["chat.answer", { interaction: "i1", answer: JSON.stringify({ decision: "submit", value: true }) }]);
  await post("/api/web/schedules/s1", { status: "paused" });
  assert.deepEqual(calls.at(-1), ["schedules.update", { schedule: "s1", status: "paused" }]);
  assert.equal((await post("/api/web/call", { target: "settings.update", args: {} })).status, 404);
  // Attachments come from chat.file and are served as downloads, never as pages of this origin.
  const file = await get("/api/web/file?message=m1&ref=chat%2Fx-a.txt");
  assert.equal(await file.text(), "file chat/x-a.txt");
  assert.match(file.headers.get("content-security-policy")!, /sandbox/);
  assert.deepEqual(calls.at(-1), ["chat.file", { message: "m1", ref: "chat/x-a.txt" }]);

  // A pushed reply reaches an open page.
  const stream = await get("/api/web/events");
  assert.equal(stream.headers.get("content-type"), "text/event-stream");
  const reader = stream.body!.getReader();
  await new Promise(resolve => setTimeout(resolve, 100));
  const reply = await module.send({ trigger: { kind: "tool", id: "reply", firedAt: new Date().toISOString(), args: { session: "s1", message: "m2", text: "hello", workspace: "w" } }, now: new Date().toISOString(), params: {} });
  assert.match(JSON.stringify(reply), /"pages":1/);
  // Heartbeat pings may come first.
  let chunk = "";
  while (!chunk.includes("data: ")) chunk += new TextDecoder().decode((await reader.read()).value);
  assert.match(chunk, /"type":"reply"/); assert.match(chunk, /"text":"hello"/);
  await reader.cancel();

  // Apps register pages (module-dependency-direction §4): owned by the recorded caller, checked against the catalog and the app's own tools.
  const tool = (id: string, args: Args, caller?: unknown) => module.send({ trigger: { kind: "tool", id, firedAt: new Date().toISOString(), args, caller }, now: new Date().toISOString(), params: {} });
  const files = { kind: "module", module: "files", moduleId: "m-files", hash: "h" }, planning = { kind: "module", module: "planning", moduleId: "m-p", hash: "h" };
  const spec = { root: "card", elements: {
    card: { type: "Card", props: { title: "文档" }, children: ["remove"] },
    remove: { type: "Button", props: { label: "删除" }, children: [], on: { press: { action: "call", params: { tool: "delete", args: { path: { $state: "/selected" } } }, confirm: { title: "删除", message: "移到回收站" } } } },
  } };
  assert.match(JSON.stringify(await tool("page-set", { id: "main", title: "文档", spec, data: { list: { tool: "list", args: { path: "" }, refresh: 30 } } }, files)), /json-render@/);
  // Only the build's smoke start calls without a recorded caller: nothing is stored.
  assert.match(JSON.stringify(await tool("page-set", { id: "main", title: "x", spec }, undefined)), /no caller/);
  assert.match(JSON.stringify(await tool("page-set", { id: "main", title: "x", spec }, { kind: "owner", via: null })), /只有应用/);
  const wrong = JSON.stringify(await tool("page-set", { id: "bad", title: "x", spec: { root: "b", elements: { b: { type: "Button", props: { label: 1 }, children: [], on: { press: { action: "call", params: { tool: "get" } } } } } } }, files));
  assert.match(wrong, /props\.label/); assert.match(wrong, /没有工具 get/);
  // Another app's page with the same id is its own; the page lists only active apps' pages.
  await tool("page-set", { id: "main", title: "计划", spec: { root: "t", elements: { t: { type: "Text", props: { text: "x" }, children: [] } } } }, planning);
  assert.deepEqual(await (await get("/api/web/pages")).json(), [{ module: "files", id: "main", title: "文档" }]);
  const page = await (await get("/api/web/pages/files/main")).json();
  assert.equal(page.data.list.tool, "list"); assert.equal(page.spec.elements.remove.on.press.params.tool, "delete");
  // A source is not read while a required argument is empty (files.delete needs path; list needs nothing).
  assert.deepEqual(page.needs, { list: [] }); assert.deepEqual(page.keyed, []);
  // Image specs accept literals and bindings, but literals must belong to the registering app.
  for (const ref of ["files/picture.png", { $state: "/image/ref" }, { $template: "files/${name}.png" }]) {
    const imageSpec = { root: "image", elements: { image: { type: "Image", props: { ref, alt: "生成的图片", width: 640, height: null }, children: [] } } };
    assert.equal(catalog.validate(imageSpec).success, true);
    assert.deepEqual(pageErrors({ spec: imageSpec }, new Map(), "files"), []);
    assert.match(JSON.stringify(await tool("page-set", { id: "images", title: "图片", spec: imageSpec }, files)), /json-render@/);
  }
  const foreignSpec = { root: "image", elements: { image: { type: "Image", props: { ref: "planning/private.png", alt: "越权" }, children: [] } } };
  assert.match(pageErrors({ spec: foreignSpec }, new Map(), "files").join(), /只能引用本应用/);
  assert.match(JSON.stringify(await tool("page-set", { id: "bad-image", title: "图片", spec: foreignSpec }, files)), /只能引用本应用/);
  const imageUrl = "/api/web/pages/files/images/content?ref=";
  const before = calls.length;
  for (const ref of ["planning/private.png", "files-other/a.png", ""]) assert.equal((await get(imageUrl + encodeURIComponent(ref))).status, 403);
  assert.equal(calls.length, before); // Rejected before content.read.
  assert.equal((await get(imageUrl + "files%2Fno.svg")).status, 403);
  const missing = await get(imageUrl + "files%2Fmissing.png");
  assert.equal(missing.status, 404); assert.doesNotMatch(await missing.text(), /private internal/);
  assert.equal((await get("/api/web/pages/files/absent/content?ref=files%2Fa.png")).status, 404);
  const image = await get(imageUrl + "files%2Fpicture.png");
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(image.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(image.headers.get("cache-control"), "private, no-cache");
  assert.deepEqual(calls.at(-1), ["content.read", { ref: "files/picture.png" }]);
  await tool("page-remove", { id: "images" }, files);
  assert.match(JSON.stringify(await tool("pages", {}, files)), /"id":"main"/);
  assert.match(JSON.stringify(await tool("page-remove", { id: "main" }, files)), /"removed":true/);
  assert.equal((await get("/api/web/pages/files/main")).status, 404);
  assert.match(JSON.stringify(await tool("catalog", {}, files)), /"Button"/);
} finally { await module.stop(); }
