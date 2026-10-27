import { strict as assert } from "node:assert";
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
  stub("modules.system", args => ({ name: "reflection", args })),
  stub("modules.overview", args => ({ kind: "app", module: args.module })), stub("modules.settings-set", args => args),
  stub("activity.list", args => ({ items: [{ id: "x", at: "2026-10-27T04:42:00.000Z", kind: "module_activate", module: "web", text: "web 已切换到版本 5caef53c" }], before: null, args })),
  stub("modules.permissions", args => ({ module: args.module, capabilities: ["联网"], secrets: [], model: null, grants: [], approvals: [] })),
  stub("modules.tools", () => [{ target: "planning.get", description: "Get", inputSchema: { type: "object", properties: {}, required: [] }, idempotent: true }]),
  stub("planning.get", () => ({ plan: 1 })),
  stub("modules.stop-build", args => ({ status: "build_stopped", sessionId: args.session })),
  stub("modules.revise-build", args => ({ status: "build_revised", sessionId: args.session })),
  stub("settings.get", () => ({ notifications: {} })), stub("settings.grants", () => []), stub("settings.preferences", () => []), stub("schedules.list", () => []),
  stub("secrets.list", () => [{ name: "okx_demo", configured: false, updatedAt: null, modules: ["okx-ai-trader"] }]), stub("secrets.set", args => ({ name: args.name, configured: true })), stub("secrets.remove", args => ({ name: args.name, configured: false })),
  stub("settings.update", args => args), stub("chat.answer", args => args), stub("schedules.update", args => args),
  stub("chat.file", args => ({ base64: Buffer.from(`file ${args.ref}`).toString("base64"), mime: "text/plain" })),
]) });
async function get(path: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(`http://module${path}`, { unix: module.httpSocket, ...init }); }
    catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
const post = async (path: string, body: unknown) => get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
try {
  for (const path of ["/", "/today", "/apps/a1?path=README.md", "/sessions/s1"]) {
    const page = await get(path);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await page.text(), /<script src="\/app.js" type="module">/);
    assert.match(page.headers.get("content-security-policy")!, /default-src 'self'/);
  }
  const script = await get("/app.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await script.text(), /\/api\/web/);
  assert.equal((await get("/style.css")).headers.get("content-type"), "text/css; charset=utf-8");
  // Static pages make no calls.
  assert.equal(calls.length, 0);

  // The data API answers from routed calls.
  assert.deepEqual(await (await get("/api/web/today")).json(), { approvals: [] });
  assert.deepEqual(await (await get("/api/web/modules/a1/diagnostics")).json(), [{ moduleId: "a1", incidents: [] }]);
  assert.deepEqual(calls.at(-1), ["modules.diagnostics", { module: "a1" }]);
  assert.equal((await (await get("/api/web/activity?module=web&before=2026-10-27T05:00:00.000Z")).json()).items[0].text, "web 已切换到版本 5caef53c");
  assert.deepEqual(calls.at(-1), ["activity.list", { module: "web", before: "2026-10-27T05:00:00.000Z" }]);
  assert.equal((await (await get("/api/web/system-apps?module=reflection")).json()).name, "reflection");
  assert.deepEqual(calls.at(-1), ["modules.system", { module: "reflection" }]);
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
  assert.equal((await get("/api/web/nope")).status, 404);
  assert.deepEqual(await (await post("/api/web/sessions/b1/stop-build", {})).json(), { status: "build_stopped", sessionId: "b1" });
  assert.deepEqual(calls.at(-1), ["modules.stop-build", { session: "b1" }]);
  await post("/api/web/sessions/b1/revise-build", { requirements: "保留原文件" });
  assert.deepEqual(calls.at(-1), ["modules.revise-build", { session: "b1", requirements: "保留原文件" }]);
  // Settings and Provider questions go to their system interfaces (v2-9).
  assert.deepEqual(await (await get("/api/web/settings")).json(), { settings: { notifications: {} }, grants: [], preferences: [], schedules: [], secrets: [{ name: "okx_demo", configured: false, updatedAt: null, modules: ["okx-ai-trader"] }] });
  // Credentials (v2-16): written through, never echoed; not reachable through the generic call route.
  assert.deepEqual(await (await post("/api/web/secrets/okx_demo", { value: { apiKey: "k" } })).json(), { name: "okx_demo", configured: true });
  assert.deepEqual(calls.at(-1), ["secrets.set", { name: "okx_demo", value: JSON.stringify({ apiKey: "k" }) }]);
  await post("/api/web/secrets/okx_demo/remove", {});
  assert.deepEqual(calls.at(-1), ["secrets.remove", { name: "okx_demo" }]);
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
} finally { await module.stop(); }
