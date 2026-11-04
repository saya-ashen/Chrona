import { strict as assert } from "node:assert";
import { runInNewContext } from "node:vm";
import { catalog } from "./catalog";
import { pageErrors } from "./pages";
import { systemCall } from "./src/system/adapter";
import { todaySpec } from "./src/system/today";
import { activitySpec } from "./src/system/activity";
import { appsSpec } from "./src/system/apps";
import { localTime, Time } from "./src/display";
import { loginSpec } from "./src/system/login";
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
// Exercise the shipped render functions with a node-recording h; no browser/DOM dependency.
async function checkHealthRendering(source: string) {
  const nodes: unknown[] = [];
  const h = (tag: string, attrs: Args = {}, ...children: unknown[]) => ({ tag, attrs, children: children.flat(), replaceChildren: (...next: unknown[]) => { nodes.push(next); }, addEventListener: () => {} });
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
  const code = source.slice(source.indexOf("const runtimeText"), source.indexOf("const APP_TABS"))
    + ";globalThis.panel = diagnosticPanel;";
  const context = { h, when: (iso: string) => iso, main: { replaceChildren: (...children: unknown[]) => { nodes.push(children); } },
    web: async (path: string) => path === "/today" ? view : path === "/runs" ? [] : [health],
    render: async () => {}, panel: (_meta: Args) => ({}) };
  runInNewContext(code, context);
  const rendered = () => JSON.stringify(todaySpec({ today: view, runs: [] }));
  assert.doesNotMatch(rendered(), /需要处理的应用/);
  nodes.length = 0;
  view.problems = ["unresolved", "verifying", "retrying", null].map(incidentStatus => ({ module: "示例应用", moduleId: "app-1", incidentStatus, contractFailures: 4, nextAction: "检查实际效果" }));
  const today = rendered();
  for (const text of ["需要处理的应用（4）", "/apps/app-1", "未解决，需要处理", "连接已恢复，功能待验证", "正在有限恢复", "输出不符合契约 4 次", "检查实际效果"]) assert.ok(today.includes(text), text);
  assert.ok(today.indexOf("需要处理的应用") < today.indexOf("接下来"));
  nodes.length = 0;
  context.panel({ id: "app-1", name: "示例应用" });
  await new Promise(resolve => setTimeout(resolve, 0));
  const diagnostics = JSON.stringify(nodes);
  const ordered = ["配置：已暂停", "当前版本 same-hash", "连续失败 2/3", "连接已恢复，功能待验证", "待验证能力：tool:write", "此前调用结果不确定", "输出契约不符 4 次（当前版本）", "检查实际效果", "记录较多，摘要可能不完整", "已采取保护：自动恢复受阻", "历史"];
  for (const [index, text] of ordered.entries()) {
    assert.ok(diagnostics.includes(text), text);
    if (index) assert.ok(diagnostics.indexOf(ordered[index - 1]!) < diagnostics.indexOf(text), text);
  }
  for (const label of ["当前版本 · 版本", "更早的启用 · 版本", "旧记录（归属未知） · 版本", "故障证据", "已观测功能：tool:read"]) assert.ok(diagnostics.includes(label), label);
  type Node = { tag: string; attrs: Args; children: (Node | string)[] };
  const incidents = (nodes.at(-1) as Node[]).filter(node => node.tag === "article").slice(-3);
  assert.deepEqual(incidents.map(node => (node.children[0] as Node).children[0]), ["未解决，需要处理", "更早的启用", "旧记录（归属未知）"]);
  assert.equal(incidents[0]!.children[1], "");
  for (const node of incidents.slice(1)) {
    const status = node.children[1] as Node;
    assert.equal(status.attrs.class, "muted");
    assert.deepEqual(status.children, ["该次启用结束时：未解决，需要处理"]);
  }
}
async function checkSystemPages() {
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
  const optional = systemCall({ web: async () => { throw new Error("offline"); }, tool: async () => ({}), login: async () => {} });
  assert.deepEqual(await optional("$web.system-apps", {}), []);
  await assert.rejects(optional("$web.activity", {}), /offline/);
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
  await assert.rejects(call("files.today", {}), /未知系统操作/);
  await assert.rejects(call("$web.constructor", {}), /未知系统操作/);
  for (const value of ["", "bad", null, undefined]) {
    assert.equal(localTime(value), "时间未知");
    assert.equal(Time({ value }).props.children, "时间未知");
    assert.equal(Time({ value }).props.dateTime, undefined);
  }
  assert.match(localTime("2026-11-04T09:00:00Z"), /2026.*11.*04/);
  assert.equal(Object.keys(loginSpec().elements).length, 3);
  for (const type of ["Approval", "Question", "SystemAction", "ActivityMore", "LoginForm"]) {
    assert.ok(pageErrors({ spec: { root: "x", elements: { x: { type, props: {}, children: [] } } } }, new Map(), "files").length);
  }
  const escaped = { root: "x", elements: { x: { type: "Button", props: { label: "x" }, children: [], on: { press: { action: "call", params: { tool: "$web.resolve" } } } } } };
  assert.ok(pageErrors({ spec: escaped }, new Map(), "files").length);
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
  await checkHealthRendering(source);
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
