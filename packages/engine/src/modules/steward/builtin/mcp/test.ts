import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

type Args = Record<string, unknown>;
const calls: [string, Args][] = [];
const installedApps = [{ id: "alpha-id", name: "alpha", origin: "external", capabilities: { build: true, remove: true } }, { id: "notify-id", name: "notify", origin: "builtin", capabilities: { build: false, remove: false } }];
let installStatus = "pending";
const installation = (args: Args) => ({ package: args.package, requestKey: args.requestKey, status: installStatus, moduleId: null, hash: null, approvalId: null, error: null });
const problems = [{ module: "web", moduleId: "web-id", incidentStatus: "verifying", contractFailures: 0, nextAction: "等待实际调用验证", since: "2026-10-27T04:00:00Z" }];
const diagnostics = { module: "web", runtime: { state: "connected" }, activation: { observedCapabilities: [] }, consecutiveFailures: 0,
  incident: { status: "verifying" }, contractFailureCount: 0, open: true, nextAction: "等待实际调用验证", truncated: true, incidents: [], contractFailures: [], evolution: [] };
const moduleTools: { target: string; description: string; inputSchema: Args; outputSchema: Args | null; examples: Args[] | null; sideEffects: string[] | null; errors: Args[] | null; retry: string; idempotent: boolean }[] = [{ target: "files.list", description: "List a document directory.", inputSchema: { type: "object", properties: {}, required: [] }, outputSchema: null, examples: null, sideEffects: null, errors: null, retry: "Unknown async outcomes are not redelivered automatically.", idempotent: false }];
const routed = (target: string, answer: (args: Args) => unknown = () => ({ ok: target })) => [target, (args: Args) => { calls.push([target, args]); return answer(args); }] as const;
const module = await startModule("index.ts", { stubs: {
  ...Object.fromEntries([
    routed("modules.tools", args => moduleTools.filter(tool => !args.query || tool.target.includes(String(args.query)))),
    routed("chat.ask"), routed("chat.answer"), routed("chat.today", () => ({ approvals: [], updates: [{ title: "n1" }], problems })), routed("chat.sessions"), routed("chat.messages"), routed("approvals.resolve"), routed("modules.list", () => installedApps), routed("modules.catalog", () => [{ name: "memory-local", available: true, installation: null }]), routed("modules.install", installation),
    routed("planning.get", args => ({ plan: args.id })), routed("planning.search", args => ({ filters: args.filters })),
    routed("modules.stop-build"), routed("modules.revise-build"), routed("modules.build-owner", args => args), routed("modules.diagnostics", args => [{ ...diagnostics, module: args.module }]),
    routed("activity.list", args => ({ items: [{ id: "x", at: "2026-10-27T04:42:00.000Z", kind: "module_activate", module: args.module ?? null, text: "web 已切换到版本 5caef53c" }], before: null })),
    routed("modules.permissions", args => ({ module: args.module, capabilities: [] })),
    routed("modules.system", args => ({ name: args.module, work: [] })),
    routed("modules.overview", args => ({ kind: "app", module: args.module })), routed("modules.settings-set", args => args),
  ]),
} });
async function rpc(method: string, params: unknown = {}, id: number | null = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("http://module/api/mcp", { unix: module.httpSocket, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
      return { status: response.status, body: response.status === 200 ? await response.json() : null };
    } catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
const tool = async (name: string, args: Args = {}) => (await rpc("tools/call", { name, arguments: args })).body.result;
const json = async (name: string, args: Args = {}) => JSON.parse((await tool(name, args)).content[0].text);
try {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.match(init.body.result.instructions, /Apps with tools: files\./);
  assert.equal((await rpc("notifications/initialized", {}, null)).status, 202);
  const names = (await rpc("tools/list")).body.result.tools.map((entry: { name: string }) => entry.name);
  assert.ok(["chrona_chat", "chrona_module_tools", "chrona_module_call", "chrona_module_diagnostics"].every(name => names.includes(name)));
  assert.deepEqual(await json("chrona_module_diagnostics", { module: "web" }), [diagnostics]);
  assert.deepEqual(calls.at(-1), ["modules.diagnostics", { module: "web" }]);
  assert.equal((await json("chrona_activity", { module: "web" })).items[0].text, "web 已切换到版本 5caef53c");
  assert.deepEqual(await json("chrona_module_permissions", { module: "web" }), { module: "web", capabilities: [] });
  assert.deepEqual(calls.at(-1), ["modules.permissions", { module: "web" }]);
  assert.deepEqual(await json("chrona_system_apps", { module: "memory" }), { name: "memory", work: [] });
  assert.deepEqual(await json("chrona_app", { module: "okx" }), { kind: "app", module: "okx" });
  assert.deepEqual(await json("chrona_app_settings", { module: "okx", values: { "max-loss": 50 } }), { module: "okx", values: JSON.stringify({ "max-loss": 50 }) });
  assert.deepEqual(await json("chrona_modules"), installedApps);
  assert.deepEqual(await json("chrona_module_catalog"), [{ name: "memory-local", available: true, installation: null }]);
  const install = { package: "memory-local", mode: "install", requestKey: "authorized-install" };
  assert.equal((await json("chrona_module_install", install)).status, "pending");
  assert.equal((await json("chrona_module_install", install)).status, "pending");
  assert.deepEqual(calls.at(-1), ["modules.install", install]);
  installStatus = "unavailable";
  assert.equal((await json("chrona_module_install", install)).status, "unavailable");
  const installCalls = calls.filter(([target]) => target === "modules.install").length;
  assert.equal(installCalls, 3, "one routed call per explicit owner request; no background retries");
  for (const invalid of [{ ...install, package: "web" }, { ...install, path: "/host/private" }, { ...install, requestKey: " " }, { ...install, requestKey: "x".repeat(121) }, { ...install, package: ["qq"] }, { ...install, mode: ["install"] }])
    assert.equal((await tool("chrona_module_install", invalid)).isError, true);
  assert.equal(calls.filter(([target]) => target === "modules.install").length, installCalls);
  assert.equal((await tool("chrona_module_call", { name: "modules.install", arguments: install })).isError, true);
  const build = { name: "alpha", goal: "memory only", intent: { changes: ["memory"], preserves: [] }, requestKey: "authorized-once", execution: { provider: "pi", model: "openai/gpt-6.1-sol", timeoutMinutes: 10, maxSubmissions: 1 } };
  assert.ok(names.includes("chrona_build"));
  assert.deepEqual(await json("chrona_build", build), build);
  assert.deepEqual(calls.at(-1), ["modules.build-owner", build]);
  // Conversations, approvals and app records are routed calls with the system modules' argument names.
  calls.length = 0;
  await tool("chrona_chat", { text: "hi" });
  assert.equal(calls[0]![0], "chat.ask"); assert.match(String(calls[0]![1].key), /^mcp:/); assert.equal(calls[0]![1].session, undefined);
  await tool("chrona_session_messages", { sessionId: "s1", limit: 5 });
  assert.deepEqual(calls.at(-1), ["chat.messages", { session: "s1", limit: 5 }]);
  await tool("chrona_approval_resolve", { approvalId: "a1", decision: "approve" });
  assert.deepEqual(calls.at(-1), ["approvals.resolve", { approval: "a1", decision: "approve", scope: "once" }]);
  await tool("chrona_run_answer", { interactionId: "i1", decision: "submit", value: 2 });
  assert.deepEqual(calls.at(-1), ["chat.answer", { interaction: "i1", answer: JSON.stringify({ decision: "submit", value: 2 }) }]);
  await tool("chrona_run_answer", { interactionId: "i1", decision: "cancel", value: 2 });
  assert.deepEqual(calls.at(-1), ["chat.answer", { interaction: "i1", answer: JSON.stringify({ decision: "cancel" }) }]);
  // A module activated after the client listed its tools is found and callable at once.
  moduleTools.push({ target: "planning.get", description: "Get a plan", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, outputSchema: null, examples: null, sideEffects: null, errors: null, retry: "Unknown async outcomes are not redelivered automatically.", idempotent: false });
  moduleTools.push({ target: "planning.search", description: "Search plans", inputSchema: {
    type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { state: { type: "string", enum: ["open", "done"] } }, required: ["state"], additionalProperties: false } } },
    required: ["filters"], additionalProperties: false
  }, outputSchema: null, examples: [{ args: { filters: [{ state: "open" }] }, result: { filters: [{ state: "open" }] } }], sideEffects: [], errors: null, retry: "Unknown async outcomes are not redelivered automatically.", idempotent: false });
  const discovered = await json("chrona_module_tools", { query: "planning" });
  assert.deepEqual(discovered.map((entry: { target: string }) => entry.target), ["planning.get", "planning.search"]);
  assert.deepEqual(discovered[1], moduleTools[2]);
  const filters = [{ state: "open" }];
  assert.deepEqual(await json("chrona_module_call", { name: "planning.search", arguments: { filters } }), { filters });
  assert.deepEqual(calls.at(-1), ["planning.search", { filters }]);
  assert.deepEqual(await json("chrona_module_call", { name: "planning.get", arguments: { id: "x" } }), { plan: "x" });
  await json("chrona_module_call", { name: "modules.stop-build", arguments: { session: "b1" } });
  assert.deepEqual(calls.at(-1), ["modules.stop-build", { session: "b1" }]);
  await json("chrona_module_call", { name: "modules.revise-build", arguments: { session: "b1", requirements: "new goal" } });
  assert.deepEqual(calls.at(-1), ["modules.revise-build", { session: "b1", requirements: "new goal" }]);
  assert.equal((await tool("chrona_module_call", { name: "modules.build", arguments: {} })).isError, true);
  assert.equal((await tool("chrona_module_call", { name: "approvals.resolve", arguments: {} })).isError, true);
  assert.equal((await tool("chrona_module_call", { name: "m_files_list" })).isError, true);
  // Today and notifications come from chat.today; app content is reached through the apps' own tools.
  assert.deepEqual((await json("chrona_today")).problems, problems);
  assert.deepEqual(await json("chrona_notifications"), [{ title: "n1" }]);
  assert.ok(!names.some((name: string) => name.startsWith("chrona_content") || name === "chrona_apps"));
  assert.equal((await tool("nope")).isError, true);
  assert.equal((await rpc("nope")).body.error.code, -32601);
} finally { await module.stop(); }
