import { checkSystemPages, checkHealthRendering } from "./test-system-pages";
import { strict as assert } from "node:assert";
import { catalog } from "./catalog";
import { pageErrors } from "./pages";
import { systemCall } from "./src/system/adapter";
import { checkAttachments } from "./test-attachments";
import { checkRasterContent } from "./test-content";
import { checkExecutableComponents } from "./test-executable";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

/** Read complete SSE frames until the requested reply arrives, allowing earlier reconciliation events. */
async function readReply(reader: ReadableStreamDefaultReader<Uint8Array>, session: string, message: string) {
  const decoder = new TextDecoder();
  let chunk = "";
  for (;;) {
    const part = await reader.read();
    assert.equal(part.done, false, "Reply stream ended before the target reply");
    chunk += decoder.decode(part.value, { stream: true });
    let boundary: number;
    while ((boundary = chunk.indexOf("\n\n")) !== -1) {
      const frame = chunk.slice(0, boundary); chunk = chunk.slice(boundary + 2);
      const event = frame.split("\n").filter(line => line.startsWith("data: "))
        .map(line => JSON.parse(line.slice(6)))
        .find(item => item.type === "reply" && item.session === session && item.message === message);
      if (event) return event;
    }
  }
}

type Args = Record<string, unknown>;
const calls: [string, Args][] = [];
const stub = (target: string, answer: (args: Args, options: { key?: string }) => unknown) => [target, (args: Args, options: { key?: string }) => { calls.push([target, args]); return answer(args, options); }] as const;
let inventoryFailure = false;
const inventory = [{ id: "m-files", name: "files", status: "active", activeHash: "h" }, { id: "m-p", name: "planning", status: "active", activeHash: "h" }].map(app => ({ ...app, health: { module: app.name, moduleId: app.id, open: false, incident: null, contractFailureCount: 0, nextAction: null, truncated: false } }));
let filesDescription = "Files tool description";
let execution = { status: "queued", active: true }, phase = "", earlyText = false;
const admissions = new Map<string, { digest: string; runId: string; status: string; active: boolean }>();
const module = await startModule("index.ts", { stubs: Object.fromEntries([
  stub("activity.runtime", () => ({ at: "2026-10-27T04:00:00Z", provider: { name: "fixture", available: false, sandboxed: false, lastError: null }, moduleSandbox: false, queuedRuns: 0, runningRuns: 0, failedRunsToday: 0, dueSchedules: 0, lastTickAt: null })),
  stub("approvals.list", () => ({ items: [], nextCursor: null })), stub("modules.health", () => ({ items: [], nextCursor: null })), stub("notify.list", () => ({ items: [] })), stub("notify.counts", () => ({ queued: 0, failed: 0 })),
  stub("agent.run", (args, options) => {
    const key = String(options.key), digest = JSON.stringify(args);
    if (admissions.has(key)) assert.equal(admissions.get(key)!.digest, digest);
    else admissions.set(key, { digest, runId: `run-author-${admissions.size + 1}`, status: "queued", active: true });
    const { digest: _digest, ...run } = admissions.get(key)!; return { ...run, contextId: "context-author" };
  }),
  stub("agent.read", args => ({ run: { ...execution, runId: args.runId, contextId: "context-author" }, transcript: earlyText ? [{ at: "2026-11-09T00:00:00Z", kind: "text", text: "已开始检查，尚未完成。" }] : [], interactions: [], items: phase ? [{ sequence: 1, payload: { type: "progress", value: { phase } } }] : [], nextCursor: phase ? "opaque:1" : null, ended: !execution.active })),
  stub("approvals.resolve", args => ({ id: args.approval })),
  stub("modules.disable", () => ({ status: "paused" })),
  stub("modules.enable", () => ({ status: "active" })),
  stub("modules.remove", () => ({ status: "pending_approval", approvalId: "remove-1" })),
  stub("modules.health", args => ({ items: [{ moduleId: args.moduleId, incidents: [] }], nextCursor: null })),
  stub("notify.activity", args => ({ items: [{ id: "x", at: "2026-10-27T04:42:00.000Z", kind: "module_activate", module: "web", text: "web 已切换到版本 5caef53c" }], before: null, args })),
  stub("modules.describe", args => {
    const tools = [
      ...[{ target: "files.list", description: "List", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] }, idempotent: true },
        { target: "files.read-image", description: "Read image", inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] }, idempotent: true },
        { target: "files.delete", description: "Delete", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, idempotent: false }]
        .map(tool => ({ ...tool, moduleId: "m-files", hash: "h", inputSchema: { ...tool.inputSchema, description: filesDescription } })),
      { target: "chat.list", moduleId: "m-chat", hash: "h", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] }, idempotent: true },
      { target: "planning.get", moduleId: "m-p", hash: "h", inputSchema: { type: "object", properties: {}, required: [] }, idempotent: true },
      { target: "modules.list", inputSchema: { type: "object", properties: {} } },
      ...["notify.list", "notify.counts", "notify.settings", "notify.activity", "pi.settings"].map(target => ({ target, moduleId: target.split(".")[0] })),
      ...(args.audience === "user" ? [] : [{ target: "agent.run", moduleId: "agent" }]),
    ];
    // Search may return a related contract; forwarding must still require the exact target.
    if (args.query === "planning.missing") return { items: tools.filter(tool => tool.target === "planning.get"), nextCursor: null };
    return { items: tools.filter(tool => !args.query || tool.target.includes(String(args.query))), nextCursor: null };
  }),
  stub("modules.list", () => ({ items: inventoryFailure ? null : inventory, nextCursor: null })),
  stub("modules.rollback", () => ({ status: "pending_approval", approvalId: "rollback-1" })),
  stub("planning.get", () => ({ plan: 1 })),
  stub("chat.list", () => ({ sessions: [] })),

  stub("activity.usage", () => ({ items: [], nextCursor: null })), stub("settings.get", () => ({ timezone: "UTC", runTimeoutMinutes: null, moduleModel: null, wake: { minIntervalMs: 60000, dailyLimit: 1000, moduleDailyLimit: 100 } })), stub("notify.settings", () => ({ settings: {} })),
  stub("secrets.list", () => ({ items: [{ name: "okx_demo", configured: false, updatedAt: null, modules: ["okx-ai-trader"] }], nextCursor: null })), stub("secrets.set", args => ({ name: args.name, configured: true })), stub("secrets.remove", args => ({ name: args.name, configured: false })), stub("secrets.authorize", () => ({ url: "https://accounts.example/auth", redirectUri: "https://chrona.example/oauth/callback", expiresAt: "2026-11-02T04:00:00Z" })),
  stub("settings.update", args => args), stub("pi.settings", () => ({ config: null, ready: false })),
  stub("files.read-image", args => {
    if (args.ref === "files/missing.png") return null;
    if (args.ref === "files/bad.png") return { base64: "<script>", mime: "image/png" };
    if (args.ref === "files/pretend.png") return { base64: Buffer.from("not an image").toString("base64"), mime: "image/png" };
    if (args.ref === "files/large.png") return { base64: "A".repeat(12 * 1024 * 1024), mime: "image/png" };
    return { base64: png.toString("base64"), mime: args.ref === "files/no.svg" ? "image/svg+xml" : "image/png", size: png.length, sha256: "fixture" };
  }),
]) });
async function get(path: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await module.fetch(path, init); }
    catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
const post = async (path: string, body: unknown) => get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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
  assert.deepEqual((await (await get("/api/web/today")).json()).approvals, []);
  assert.deepEqual(await (await get("/api/web/modules/a1/diagnostics")).json(), [{ moduleId: "a1", incidents: [] }]);
  assert.deepEqual(calls.at(-1), ["modules.health", { moduleId: "a1", detail: true }]);
  assert.equal((await (await get("/api/web/activity?module=web&before=2026-10-27T05:00:00.000Z")).json()).items[0].text, "web 已切换到版本 5caef53c");
  assert.deepEqual(calls.at(-1), ["notify.activity", { module: "web", before: "2026-10-27T05:00:00.000Z" }]);
  assert.equal((await (await get("/api/web/system-apps?module=modules")).json()).name, "modules");
  assert.deepEqual(calls.at(-1), ["modules.describe", {}]);
  const overview = await (await get("/api/web/modules/m-files/overview")).json();
  assert.equal(overview.kind, "app"); assert.equal(overview.app.name, "files"); assert.ok(overview.tools.some((tool: Args) => tool.target === "files.list"));
  assert.equal((await get("/api/web/modules/missing/overview")).status, 404);
  const lifecycleCalls: unknown[] = [];
  const lifecycle = systemCall({ web: async (...args) => { lifecycleCalls.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  for (const operation of ["disable", "enable", "remove"]) {
    const result = await post(`/api/web/modules/example/${operation}`, { reason: "untrusted replacement" });
    assert.equal(result.status, 200);
    assert.deepEqual(calls.at(-1), [`modules.${operation}`, { moduleId: "example", reason: operation === "remove" ? "用户在网页申请删除应用" : "用户在网页操作" }]);
    await lifecycle(`$web.module-${operation}`, { id: "app/name" });
    assert.deepEqual(lifecycleCalls.at(-1), [`/modules/app%2Fname/${operation}`, { method: "POST", body: {} }]);
    assert.equal((await get(`/api/web/modules/example/${operation}`)).status, 404);
  }
  assert.equal((await post("/api/web/modules/okx/settings", { values: { "max-loss": 50 } })).status, 404);
  assert.equal((await get("/api/web/modules/a1/permissions")).status, 404);
  assert.equal((await post("/api/web/modules/a1/refresh-health", {})).status, 404);
  assert.equal((await post("/api/web/chat", { text: "hi", session: "s1" })).status, 409);
  const created = await (await post("/api/web/chat", { text: "new", requestKey: "author-new" })).json();
  assert.match(created.sessionId, /^web-agent:/); assert.ok(created.runId);
  const agentRun = calls.find(([target]) => target === "agent.run")!;
  assert.match(String(agentRun[1].prompt), /personal steward[\s\S]*User message:\nnew/);
  assert.equal(agentRun[1].lane, "foreground");
  assert.equal(calls.filter(([target]) => target === "chat.send").length, 0);
  assert.deepEqual(await (await post("/api/web/chat", { text: "new", requestKey: "author-new" })).json(), created);
  const sessionPath = `/api/web/sessions/${encodeURIComponent(created.sessionId)}`;
  const request = { runId: created.runId, requestKey: `web-continue:${created.runId}` };
  assert.equal((await post(`${sessionPath}/continue`, request)).status, 409);
  execution = { status: "running", active: true }; phase = "recovering";
  assert.equal((await (await get(`${sessionPath}/execution`)).json()).phase, "recovering");
  assert.equal((await post(`${sessionPath}/continue`, request)).status, 409);
  execution = { status: "unknown", active: true };
  assert.equal((await post(`${sessionPath}/continue`, request)).status, 409);
  execution = { status: "failed", active: false }; phase = ""; earlyText = true;
  const failedMessages = await (await get(`${sessionPath}/messages`)).json();
  const failed = failedMessages.at(-1);
  assert.equal(failed.execution.status, "failed"); assert.equal(failed.execution.canContinue, true);
  assert.match(failed.text, /本次执行失败[\s\S]*已产生的过程文字（不代表完成）/);
  assert.equal(failed.progress, "已开始检查，尚未完成。");
  assert.deepEqual(await (await get(`${sessionPath}/messages`)).json(), failedMessages);
  assert.equal((await post(`${sessionPath}/continue`, { ...request, prompt: "untrusted replacement" })).status, 400);
  assert.equal((await post(`${sessionPath}/continue`, { ...request, runId: "foreign" })).status, 409);
  assert.equal((await post("/api/web/sessions/web-agent%3Aforeign/continue", request)).status, 404);
  const continued = await post(`${sessionPath}/continue`, request);
  assert.equal(continued.status, 200);
  const continuation = await continued.json(); assert.equal(continuation.runId, "run-author-2");
  assert.deepEqual(await (await post(`${sessionPath}/continue`, request)).json(), continuation);
  assert.equal(admissions.size, 2);
  const runRequests = calls.filter(([target]) => target === "agent.run");
  assert.equal(runRequests.length, 2);
  const wireRuns = module.calls.filter((call: {params: Args}) => targetName(call.params.target) === "agent.run");
  assert.notEqual(wireRuns[0].params.key, wireRuns[1].params.key);
  assert.equal(runRequests[0]![1].contextId, undefined);
  assert.equal(runRequests.at(-1)![1].contextId, "context-author");
  assert.match(String(runRequests.at(-1)![1].prompt), /Inspect the current state and prior tool outcomes/);
  execution = { status: "queued", active: true };
  assert.equal((await (await get(`${sessionPath}/execution`)).json()).canContinue, false);
  await post("/api/web/approvals/a1/resolve", { decision: "approve" });
  assert.deepEqual(calls.at(-1), ["approvals.resolve", { approval: "a1", decision: "approve" }]);
  const beforeScope = calls.length;
  for (const scope of ["once", "always"]) assert.equal((await post("/api/web/approvals/a1/resolve", { decision: "approve", scope })).status, 400);
  assert.equal(calls.length, beforeScope);
  await post("/api/web/approvals/a1/resolve", { decision: "deny" });
  assert.deepEqual(calls.at(-1), ["approvals.resolve", { approval: "a1", decision: "deny" }]);
  assert.deepEqual(await (await post("/api/web/call", { target: "planning.get", args: {} })).json(), { plan: 1 });
  assert.deepEqual(calls.at(-2), ["modules.describe", { query: "planning.get", audience: "user" }]);
  assert.deepEqual(module.calls.findLast((call: { method: string; params: Args }) => call.method === "call" && targetName(call.params.target) === "planning.get")?.params.expectedTarget, { moduleId: "m-p" });
  assert.equal((await post("/api/web/call", { target: "approvals.resolve", args: {} })).status, 404);
  assert.equal((await post("/api/web/call", { target: "$web.resolve", args: {} })).status, 404);
  assert.equal((await get("/api/web/nope")).status, 404);
  const beforeRetired = calls.length;
  for (const path of ["/sessions/b1/stop-build", "/sessions/b1/revise-build", "/schedules/s1", "/install", "/build"]) {
    assert.equal((await post(`/api/web${path}`, {})).status, 404);
  }
  for (const path of ["/catalog", "/schedules", "/sessions/build-1/messages", "/sessions/build-1/transcript"]) assert.equal((await get(`/api/web${path}`)).status, 404);
  assert.equal(calls.length, beforeRetired);
  await get("/api/web/tools?query=planning");
  assert.deepEqual(calls.at(-1), ["modules.describe", { query: "planning", audience: "user" }]);
  const userTools = await (await get("/api/web/tools?audience=caller")).json() as { target: string }[];
  assert.ok(userTools.some(tool => tool.target === "pi.settings"));
  assert.ok(!userTools.some(tool => tool.target === "agent.run"));
  assert.deepEqual(calls.at(-1), ["modules.describe", { audience: "user" }]);
  for (const target of ["agent.run", "planning.missing", "planning.private", "runtime-callback.agent-admit"]) {
    const before = module.calls.length;
    assert.equal((await post("/api/web/call", { target, args: {} })).status, 404);
    assert.equal(module.calls.slice(before).some((call: { method: string; params: Args }) => call.method === "call" && targetName(call.params.target) === target), false);
  }
  // Global Settings governs kernel budgets only; applications save through their own pages.
  assert.deepEqual(await (await get("/api/web/settings")).json(), { settings: { timezone: "UTC", runTimeoutMinutes: null, moduleModel: null, modelUsage: [], wake: { minIntervalMs: 60000, dailyLimit: 1000, moduleDailyLimit: 100 } } });
  const beforeOwnSettings = calls.length;
  for (const body of [{ memory: { provider: "memory-local", autoRecall: false, autoRetain: false } }, { agent: { clear: true } }, { notifications: { dailyCap: 3 } }]) {
    assert.equal((await post("/api/web/settings", body)).status, 400);
  }
  assert.equal(calls.slice(beforeOwnSettings).some(([target]) => ["settings.update", "notify.settings", "pi.settings"].includes(target)), false);
  // Credentials (v2-16): written through, never echoed; not reachable through the generic call route.
  assert.deepEqual(await (await post("/api/web/secrets/okx_demo", { value: { apiKey: "k" } })).json(), { name: "okx_demo", configured: true });
  // The page merges: fields it leaves out keep their saved values.
  assert.deepEqual(calls.at(-1), ["secrets.set", { name: "okx_demo", value: { apiKey: "k" }, merge: true }]);
  await post("/api/web/secrets/okx_demo/remove", {});
  assert.deepEqual(calls.at(-1), ["secrets.remove", { name: "okx_demo" }]);
  await post("/api/web/secrets/okx_demo/remove", { field: "apiKey" });
  assert.deepEqual(calls.at(-1), ["secrets.remove", { name: "okx_demo", field: "apiKey" }]);
  await post("/api/web/secrets/okx_demo/authorize", { provider: "google", scopes: "s1 s2", account: "work" });
  assert.deepEqual(calls.at(-1), ["secrets.authorize", { name: "okx_demo", provider: "google", scopes: ["s1", "s2"], account: "work" }]);
  assert.equal((await post("/api/web/call", { target: "secrets.set", args: {} })).status, 404);
  assert.equal((await post("/api/web/settings", { builds: { dailyLimit: 20 } })).status, 400);
  for (const invalid of [null, [], { sessions: {} }, { notifications: null }, { builds: [] }, { memory: { autoRecall: "yes" } }]) assert.equal((await post("/api/web/settings", invalid)).status, 400);
  const beforeGrant = calls.length;
  assert.equal((await post("/api/web/grants/g1/revoke", {})).status, 404);
  assert.equal(calls.length, beforeGrant);
  assert.ok(!calls.some(([target]) => target === "approvals.grants" || target === "approvals.revoke-grant"));
  assert.equal((await get("/api/web/sessions/qq-agent:foreign/messages")).status, 404);
  const listed = await (await get("/api/web/sessions")).json();
  assert.ok(listed.some((item: Args) => item.id === created.sessionId));
  assert.ok(listed.every((item: Args) => item.source === "web"));
  assert.ok(!calls.some(([target]) => target.startsWith("history.")));
  const beforeForeignAnswer = calls.length;
  assert.equal((await post("/api/web/interactions/i1/answer", { decision: "submit", value: true })).status, 404);
  assert.equal(calls.slice(beforeForeignAnswer).some(([target]) => target === "chat.answer" || target === "agent.write"), false);
  assert.equal((await post("/api/web/call", { target: "settings.update", args: {} })).status, 404);
  await checkAttachments(get, post, calls);

  // A pushed reply reaches an open page.
  const stream = await get("/api/web/events", { signal: AbortSignal.timeout(10_000) });
  assert.equal(stream.headers.get("content-type"), "text/event-stream");
  const reader = stream.body!.getReader();
  await new Promise(resolve => setTimeout(resolve, 100));
  // Existing conversations may emit reconciliation replies before this reply.
  await module.send({ trigger: { kind: "tool", id: "reply", firedAt: new Date().toISOString(), args: { session: "background", message: "prior", text: "earlier reply", workspace: "w" } }, now: new Date().toISOString(), params: {} });
  const reply = await module.send({ trigger: { kind: "tool", id: "reply", firedAt: new Date().toISOString(), args: { session: "s1", message: "m2", text: "hello", workspace: "w" } }, now: new Date().toISOString(), params: {} });
  assert.match(JSON.stringify(reply), /"pages":1/);
  try {
    const event = await readReply(reader, "s1", "m2");
    assert.equal(event.text, "hello");
  } finally { await reader.cancel(); }

  // Lifecycle rollback retains its protected route.
  assert.equal((await post("/api/web/call", { target: "modules.build", args: {} })).status, 404);
  assert.equal((await post("/api/web/modules/example/rollback", { hash: "a".repeat(64) })).status, 200);
  assert.deepEqual(calls.at(-1), ["modules.rollback", { moduleId: "example", hash: "a".repeat(64), reason: "用户在网页回滚应用" }]);

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
  assert.match(JSON.stringify(await tool("page-set", { id: "main", title: "x", spec }, { kind: "owner", via: null })), /只有身份完整的应用/);
  const wrong = JSON.stringify(await tool("page-set", { id: "bad", title: "x", spec: { root: "b", elements: { b: { type: "Button", props: { label: 1 }, children: [], on: { press: { action: "call", params: { tool: "get" } } } } } } }, files));
  assert.match(wrong, /props\.label/); assert.match(wrong, /没有工具 get/);
  // Another app's page with the same id is its own; the page lists only active apps' pages.
  await tool("page-set", { id: "main", title: "计划", spec: { root: "t", elements: { t: { type: "Text", props: { text: "x" }, children: [] } } } }, planning);
  inventory[1]!.status = "paused";
  assert.deepEqual(await (await get("/api/web/pages")).json(), [{ module: "files", moduleId: "m-files", id: "main", title: "文档" }]);
  assert.equal((await get("/api/web/pages/planning/main")).status, 409);
  inventory[1]!.status = "active";
  assert.equal((await get("/api/web/pages/planning/main")).status, 200);
  inventory[1]!.status = "paused";
  const page = await (await get("/api/web/pages/files/main")).json();
  const pageCall = { target: "files.list", args: { path: "" }, page: { module: "files", id: "main", revision: page.revision } };
  assert.equal((await post("/api/web/call", pageCall)).status, 200);
  assert.deepEqual(module.calls.findLast((call: { method: string; params: Args }) => call.method === "call" && targetName(call.params.target) === "files.list")?.params.expectedTarget, { moduleId: "m-files" });
  assert.equal((await post("/api/web/call", { ...pageCall, page: { ...pageCall.page, revision: "stale" } })).status, 409);
  assert.equal((await post("/api/web/call", { ...pageCall, target: "planning.get" })).status, 409);
  assert.equal(page.data.list.tool, "list"); assert.equal(page.spec.elements.remove.on.press.params.tool, "delete");
  // A source is not read while a required argument is empty (files.delete needs path; list needs nothing).
  assert.deepEqual(page.needs, { list: [] }); assert.deepEqual(page.keyed, []);
  // Image specs accept literals and bindings, but literals must belong to the registering app.
  for (const ref of ["files/picture.png", { $state: "/image/ref" }, { $template: "files/${name}.png" }]) {
    const imageSpec = { root: "image", elements: { image: { type: "Image", props: { ref, alt: "生成的图片", width: 640, height: null }, children: [] } } };
    assert.equal(catalog.validate(imageSpec).success, true);
    assert.deepEqual(pageErrors({ spec: imageSpec }, new Map(), "files"), []);
    assert.match(JSON.stringify(await tool("page-set", { id: "images", title: "图片", spec: imageSpec, content: { tool: "read-image" } }, files)), /json-render@/);
  }
  const foreignSpec = { root: "image", elements: { image: { type: "Image", props: { ref: "planning/private.png", alt: "越权" }, children: [] } } };
  assert.match(pageErrors({ spec: foreignSpec }, new Map(), "files").join(), /只能引用本应用/);
  assert.match(JSON.stringify(await tool("page-set", { id: "bad-image", title: "图片", spec: foreignSpec }, files)), /只能引用本应用/);
  const imageUrl = "/api/web/pages/files/images/content?ref=";
  const before = calls.filter(([target]) => target === "files.read-image").length;
  assert.equal((await get("/api/web/pages/files/main/content?ref=files%2Fpicture.png")).status, 403);
  assert.match(JSON.stringify(await tool("page-set", { id: "bad-content", title: "图片", spec, content: { tool: "planning.get" } }, files)), /content/);
  assert.match(JSON.stringify(await tool("page-set", { id: "bad-content", title: "图片", spec, content: { tool: "invisible" } }, files)), /没有工具/);
  for (const ref of ["planning/private.png", "files-other/a.png", "files/../planning/private.png", "files/\\private.png", ""])  assert.equal((await get(imageUrl + encodeURIComponent(ref))).status, 403);
  assert.equal(calls.filter(([target]) => target === "files.read-image").length, before); // Rejected before the owner's tool.
  await checkRasterContent(get, png);
  assert.deepEqual(calls.at(-1), ["files.read-image", { ref: "files/picture.png" }]);
  assert.deepEqual(module.calls.findLast((call: { method: string; params: Args }) => call.method === "call" && targetName(call.params.target) === "files.read-image")?.params.expectedTarget, { moduleId: "m-files" });
  inventory[0]!.status = "paused";
  assert.equal((await get(imageUrl + "files%2Fpicture.png")).status, 409);
  assert.equal((await get("/api/web/pages/files/main")).status, 409);
  inventory[0]!.status = "active";
  filesDescription = "Updated files tool description";
  assert.equal((await get("/api/web/pages/files/main")).status, 200);
  assert.equal((await post("/api/web/call", pageCall)).status, 200);
  assert.equal((await get(imageUrl + "files%2Fpicture.png")).status, 200);
  inventoryFailure = true;
  assert.equal((await get("/api/web/pages")).status, 502);
  inventoryFailure = false;
  assert.equal((await get("/api/web/pages/files/main")).status, 200);
  Object.assign(inventory[1]!, { id: "planning-reinstalled", status: "active" });
  assert.equal((await get("/api/web/pages/planning/main")).status, 404);
  assert.ok(!(await (await get("/api/web/pages")).json()).some((item: { module: string }) => item.module === "planning"));
  await checkExecutableComponents(tool, get, post, files, inventory[0]!);
  // Chat is an ordinary app: its executable callbacks follow the same page and contract guards.
  const chatState = { id: "m-chat", name: "chat", status: "active", activeHash: "h", health: { module: "chat", moduleId: "m-chat", open: false, incident: null, contractFailureCount: 0, nextAction: null, truncated: false } };
  inventory.push(chatState);
  const chat = { ...files, module: "chat", moduleId: "m-chat" };
  await checkExecutableComponents(tool, get, post, chat, chatState);
  assert.ok(calls.some(([target]) => target === "chat.list"), "Chat callback reaches its own tool");
  await tool("page-remove", { id: "images" }, files);
  assert.match(JSON.stringify(await tool("pages", {}, files)), /"id":"main"/);
  assert.match(JSON.stringify(await tool("page-remove", { id: "main" }, files)), /"removed":true/);
  assert.equal((await get("/api/web/pages/files/main")).status, 404);
  assert.match(JSON.stringify(await tool("catalog", {}, files)), /"Button"/);
} finally { await module.stop(); }

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {"m-p":"planning","m-files":"files","m-chat":"chat","agent":"agent"};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
