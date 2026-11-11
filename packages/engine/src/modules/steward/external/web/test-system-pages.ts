import { strict as assert } from "node:assert";
import { runtimeText } from "./src/system/text";
import { builder } from "./src/system/spec";
import { diagnosticNodes, checksText } from "./src/system/diagnostics";
import { detailSpec, selectedTab } from "./src/system/detail";
import { settingValue } from "./src/system/forms";
import type { Diagnostic } from "./src/system/detail-types";
import { pageErrors } from "./pages";
import { systemCall } from "./src/system/adapter";
import { todaySpec } from "./src/system/today";
import { activitySpec } from "./src/system/activity";
import { appsSpec } from "./src/system/apps";
import { checkSettingsRules, checkSettingsSpec } from "./test-settings-page";
import { checkModelValues } from "./test-model-settings";
import { chatSpec, selectedSession, openMessages, type Message } from "./src/system/chat";
import type { ReplyEvent } from "./src/system/adapter";
import { localTime, Time } from "./src/display";
import { loginSpec } from "./src/system/login";
import { systemPage } from "./src/system/page";
type Args = Record<string, unknown>;
// Exercise the shipped specs directly; browser acceptance checks the mounted renderer.
export async function checkHealthRendering() {
  const view = { approvals: [], upcoming: [], updates: [] as Args[], apps: [], sessions: [], problems: [] as Args[] };
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
  assert.doesNotMatch(rendered(), /需要处理的应用|未送达的通知/);
  view.updates = [{ id: "failed-notice", title: "申请截止提醒", createdAt: "2026-11-05T04:00:00Z", body: "两天后截止", status: "failed", lastError: "投递失败".repeat(50) }, { id: "sent", title: "已送达", createdAt: "2026-11-05T03:00:00Z", body: "完成", status: "sent" }];
  const failure = rendered();
  for (const text of ["未送达的通知（1）", "申请截止提醒", "2026-11-05T04:00:00Z", `${"投递失败".repeat(40)}…`, "检查通知设置"]) assert.ok(failure.includes(text), text);
  assert.ok(!failure.includes("投递失败".repeat(41)));
  assert.ok(failure.indexOf("未送达的通知") < failure.indexOf("接下来"));
  view.updates = [];
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
  await call("$web.login", { password: " fixture " });
  assert.deepEqual(mapped, [["/today"], ["/runs"], ["/modules"], ["/approvals/a%2Fb/resolve", { method: "POST", body: { decision: "deny" } }], ["/interactions/q/answer", { method: "POST", body: { decision: "submit", value: false } }], ["/runs/r/cancel", { method: "POST", body: {} }], ["notify.feedback", { id: "n", feedback: "useful" }], ["login", " fixture "]]);
  mapped.length = 0;
  await call("$web.system-apps", {});
  await call("$web.activity", {});
  await call("$web.activity", { module: "a/b &中", before: "2026-11-04T10:00:00+08:00" });
  assert.deepEqual(mapped, [["/system-apps"], ["/activity?"], ["/activity?module=a%2Fb+%26%E4%B8%AD&before=2026-11-04T10%3A00%3A00%2B08%3A00"]]);
  mapped.length = 0;
  for (const name of ["overview", "diagnostics", "transcript"]) await call(`$web.${name}`, { id: "a/b 中" });
  await call("$web.secret-save", { id: "a/b", value: { token: "fake" } });
  await call("$web.secret-remove", { id: "a/b", field: "token" });
  await call("$web.secret-remove", { id: "a/b" });
  await call("$web.authorize", { id: "a/b", value: { provider: "google", scopes: "read", account: "work" } });
  await assert.rejects(call("$web.revoke", { id: "g/1" }), /未知系统操作/);
  await call("$web.call", { target: "app.read", args: { count: 2 } });
  await call("$web.memory", { query: "a/b 中" });
  await call("$web.forget", { id: "m/1" });
  await call("$web.settings", {});
  await call("$web.settings-update", { settings: { moduleModel: { moduleDailyCalls: { example: 4 } } } });
  assert.deepEqual(mapped, [
    ["/modules/a%2Fb%20%E4%B8%AD/overview"], ["/modules/a%2Fb%20%E4%B8%AD/diagnostics"], ["/sessions/a%2Fb%20%E4%B8%AD/transcript"],
    ["/secrets/a%2Fb", { method: "POST", body: { value: { token: "fake" } } }], ["/secrets/a%2Fb/remove", { method: "POST", body: { field: "token" } }], ["/secrets/a%2Fb/remove", { method: "POST", body: {} }],
    ["/secrets/a%2Fb/authorize", { method: "POST", body: { provider: "google", scopes: "read", account: "work" } }],
    ["/call", { method: "POST", body: { target: "app.read", args: { count: 2 } } }], ["/memory?query=a%2Fb%20%E4%B8%AD"], ["/memory/forget", { method: "POST", body: { id: "m/1" } }], ["/settings"], ["/settings", { method: "POST", body: { moduleModel: { moduleDailyCalls: { example: 4 } } } }],
  ]);
  const readMapped: unknown[] = [];
  const reads = systemCall({ web: async (...args) => { readMapped.push(args); return { items: ["recent"] }; }, tool: async () => ({}), login: async () => {} });
  await reads("$web.tools", { query: "a/b 中" }); await reads("$web.pages", {});
  assert.deepEqual(await reads("$web.detail-activity", { module: "a/b 中" }), ["recent"]);
  await reads("$web.memory", {});
  assert.deepEqual(readMapped, [["/tools?query=a%2Fb%20%E4%B8%AD"], ["/pages"], ["/activity?module=a%2Fb%20%E4%B8%AD"], ["/memory"]]);
  const optional = systemCall({ web: async () => { throw new Error("offline"); }, tool: async () => ({}), login: async () => {} });
  await assert.rejects(optional("$web.system-apps", {}), /offline/);
  assert.deepEqual(await optional("$web.diagnostics", { id: "x" }), { failure: "offline" });
  await assert.rejects(optional("$web.pages", {}), /offline/);
  await assert.rejects(optional("$web.detail-activity", { module: "x" }), /offline/);
  await assert.rejects(optional("$web.activity", {}), /offline/);
  await assert.rejects(call("files.today", {}), /未知系统操作/);
  await assert.rejects(call("$web.constructor", {}), /未知系统操作/);
}
function checkDetailSpecs() {
  assert.equal(selectedTab("unknown"), "overview"); assert.equal(selectedTab("permissions", true), "overview"); assert.equal(selectedTab("settings", true, "session"), "overview");
  for (const [type, value, checked, expected] of [["boolean", "on", true, true], ["boolean", "", false, false], ["number", "2.5", false, 2.5], ["text", "文本", false, "文本"]] as const) assert.equal(settingValue(type, value, checked), expected);
  const overview = { tools: [], app: { id: "app/1", name: "example", origin: "external", capabilities: { remove: true, enable: true, disable: true, build: true }, status: "active", health: {}, activeHash: "abc", runs: [], versions: [] }, settings: { declarations: {}, values: {} }, permissions: { capabilities: [], grants: [], approvals: [], secrets: [], model: null }, activity: [] };
  for (const builtin of [false, true]) for (const status of ["active", "paused", "migrating"]) {
    const spec = detailSpec({ overview: { ...overview, app: { ...overview.app, builtin, status, origin: builtin ? "builtin" : "external", capabilities: { remove: !builtin, disable: true, enable: true, build: !builtin } } } }, { id: "app/1", tab: "overview", session: "" });
    const nodes = Object.values(spec.elements);
    assert.equal(nodes.some(node => node.type === "AppRemoval" || node.type === "SystemAction"), false);
    const managed = Object.values(appsSpec({ apps: [{ ...overview.app, status, origin: builtin ? "builtin" : "external", capabilities: { remove: !builtin, disable: true, enable: true } }], systemApps: [], catalog: [] }).elements);
    assert.equal(managed.some(node => node.type === "AppRemoval"), !builtin && status !== "migrating");
    const control = managed.find(node => node.type === "SystemAction");
    if (status === "migrating") assert.equal(control, undefined);
    else {
      assert.equal(control!.props.label, status === "active" ? "暂停" : "恢复"); assert.equal(control!.props.tool, status === "active" ? "module-disable" : "module-enable");
      assert.deepEqual(control!.props.args, { id: "app/1" }); assert.match(String(control!.props.confirm), /example/);
    }
  }
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
  for (const systemApps of [[], [{ name: "approvals", description: "审批" }]]) {
    const spec = appsSpec({ apps: [{ id: "app /", name: "示例", builtin: true, origin: "builtin", capabilities: { remove: false }, description: "应用说明", health: { runtime: { state: "running" }, incident: { status: "unresolved" } } }], systemApps });
    const serialized = JSON.stringify(spec);
    assert.match(serialized, /内置 · 当前不可删除。尚未启用 · 运行中 · 未解决，需要处理 · 应用说明/);
    assert.ok(serialized.includes("/apps/app%20%2F"));
    assert.deepEqual(Object.values(spec.elements).filter(item => item.type === "Card").map(item => item.props.title), ["内核", "模块"]);
    if (systemApps.length) for (const expected of ["/apps/system/approvals", "审批", "Chrona 的系统接口"]) assert.ok(serialized.includes(expected));
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
  for (const type of ["AppSettings", "PackageInstall", "AppRemoval", "ChatStream", "NotificationSettings", "BuildSettings", "ModuleModelSettings", "RunTimeoutSettings", "Approval", "Question", "SystemAction", "ActivityMore", "LoginForm", "LoginPasswordSettings", "SettingsForm", "ToolContract", "ToolForm", "ModelCap", "Credentials", "DiagnosticRefresh", "MemoryPanel", "SessionWork"]) {
    assert.ok(pageErrors({ spec: { root: "x", elements: { x: { type, props: {}, children: [] } } } }, new Map(), "files").length);
  }
  const escaped = { root: "x", elements: { x: { type: "Button", props: { label: "x" }, children: [], on: { press: { action: "call", params: { tool: "$web.resolve" } } } } } };
  assert.ok(pageErrors({ spec: escaped }, new Map(), "files").length);
}
async function checkSettingsAdapter() {
  const mapped: unknown[] = [];
  const call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  const patches = [
    { runTimeoutMinutes: 45 },
    { runTimeoutMinutes: null },
    { moduleModel: { maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, eventTimeoutMs: 120000, moduleDailyCalls: { example: 0 } } },
    { agent: { config: { tiers: { fast: { model: "fixture/model", thinking: "low" } }, "preferred-timeout-ms": 2000 } } },
    { agent: { clear: true } },
    { memory: { provider: "memory-local", autoRecall: true, autoRetain: false } },
  ];
  for (const settings of patches) await call("$web.settings-update", { settings });
  await call("$web.preference-forget", { id: "p/1" });
  assert.deepEqual(mapped, [
    ...patches.map(body => ["/settings", { method: "POST", body }]),
    ["/preferences/p%2F1/forget", { method: "POST", body: {} }],
  ]);
  await assert.rejects(call("$web.schedule-update", { id: "a/b 中", status: "paused" }), /未知系统操作/);
  assert.equal(mapped.length, patches.length + 1);
}
async function checkChat() {
  const mapped: unknown[] = [], call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  await call("$web.sessions", {}); await call("$web.messages", { id: "a/b 中" });
  await call("$web.chat", { text: "new" }); await call("$web.chat", { text: "existing", session: "s", requestKey: "stable-message" });
  await call("$web.file", { message: "m /", ref: "chat/a 中.txt" });
  assert.deepEqual(mapped, [["/sessions"], ["/sessions/a%2Fb%20%E4%B8%AD/messages"], ["/chat", { method: "POST", body: { text: "new" } }], ["/chat", { method: "POST", body: { text: "existing", session: "s", requestKey: "stable-message" } }], ["/file?message=m%20%2F&ref=chat%2Fa%20%E4%B8%AD.txt", { raw: true }]]);
  await call("$web.execution", { id: "a/b 中" });
  await call("$web.continue", { id: "a/b 中", runId: "failed-run", requestKey: "web-continue:failed-run" });
  assert.deepEqual(mapped.slice(-2), [["/sessions/a%2Fb%20%E4%B8%AD/execution"], ["/sessions/a%2Fb%20%E4%B8%AD/continue", { method: "POST", body: { runId: "failed-run", requestKey: "web-continue:failed-run" } }]]);
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
export async function checkSystemPages() {
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

assert.equal(runtimeText({ runtime: { state: "stopping" } }), "正在停止（尚未确认）");
assert.equal(runtimeText({ runtime: { state: "unknown" } }), "停止结果未知");
