import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at runtime.
import { startModule } from "chrona/testing";

type Args = Record<string, unknown>;
const calls: [string, Args][] = [];
let webAvailable = false;
const pages: Args[] = [];
const objectSchema = (properties: Args = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const contract = (target: string, inputSchema = objectSchema(), app?: string) => ({ target, description: target, inputSchema, outputSchema: null, ...(app ? { moduleId: `${app}-id`, hash: "a".repeat(64), contractHash: "b".repeat(64) } : {}) });
const authorInput = objectSchema({ input: { type: "string" } }, ["input"]);
const admissionInput = objectSchema({ submitter: objectSchema({ moduleId: { type: "string" }, hash: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["moduleId", "hash"]), targets: { type: "array", minItems: 1, items: objectSchema({ name: { type: "string" }, moduleId: { type: ["string", "null"] }, expectedActiveHash: { type: ["string", "null"] } }, ["name", "moduleId", "expectedActiveHash"]) } }, ["submitter", "targets"]);
const contracts = [
  contract("modules.list"), contract("approvals.resolve", objectSchema({ approval: { type: "string" }, decision: { enum: ["approve", "deny"] } }, ["approval", "decision"])),
  contract("files.list", objectSchema(), "files"), contract("web.today", objectSchema(), "web"), contract("notify.list", objectSchema(), "notify"),
  ...["prepare", "stage", "source", "submit", "receipt"].map(name => contract(`author.${name}`, authorInput, "author")),
  contract("author.write", objectSchema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]), "author"),
  contract("author.read", objectSchema({ path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["path"]), "author"),
  contract("author.list", objectSchema({ path: { type: "string" } }, ["path"]), "author"),
  contract("modules.admit", admissionInput),
  contract("planning.search", objectSchema({ filters: { type: "array", items: objectSchema({ state: { type: "string", enum: ["open", "done"] } }, ["state"]) } }, ["filters"]), "planning"),
  contract("agent.respond", objectSchema(), "agent"),
  contract("memory-local.recall", objectSchema({ query: { type: "string" }, limit: { type: "number" } }, ["query"]), "memory-local"),
  ...["conversation-context", "conversation-retain"].map(name => ({ ...contract(`memory-local.${name}`, objectSchema({ snapshot: { type: "string" } }, ["snapshot"]), "memory-local"), user: false })),
];
const diagnostic = { moduleId: "files-id", module: "files", runtime: { state: "connected" }, open: false };
const routed = (target: string, answer: (args: Args) => unknown = () => ({ ok: target })) => [target, (args: Args) => { calls.push([target, args]); return answer(args); }] as const;
const module = await startModule("index.ts", { stubs: Object.fromEntries([
  routed("web.page-set", args => { if (!webAvailable) return { error: { code: "unavailable", message: "Web unavailable" } }; pages.push(args); return { registered: true }; }),
  routed("modules.describe", args => {
    if (args.target) return { target: args.target, outputSchema: null, admission: { visibility: ["owner"] } };
    if (args.audience === undefined && args.query) assert.equal(args.query, "memory-local", "only generated memory discovery uses the caller audience");
    else if (args.audience !== undefined) assert.equal(args.audience, "user");
    return { items: contracts.filter(tool => !(args.audience === "user" && "user" in tool && tool.user === false) && (!args.query || tool.target.includes(String(args.query)))), nextCursor: null };
  }),
  routed("modules.list", () => ({ items: [{ id: "files-id", name: "files", status: "active" }], nextCursor: null })), routed("modules.health", () => ({ items: [diagnostic], nextCursor: null })),
  routed("agent.context", () => ({ contextId: "context-mcp" })), routed("agent.run", () => ({ runId: "run-mcp", status: "queued", active: true })),
  routed("agent.get", () => ({ status: "finished", active: false })), routed("agent.stream", () => ({ items: [], after: 0, ended: true, transcript: [{ at: "2026-11-08T00:00:00Z", kind: "text", text: "done" }], interactions: [{ id: "i1", status: "pending" }] })),
  routed("agent.respond"), routed("agent.interrupt"), routed("approvals.resolve"), routed("approvals.list", () => ({ items: [], nextCursor: null })), routed("activity.records", () => ({ items: [], before: null })),
  routed("planning.search", args => args), routed("files.list", () => ["file"]), routed("web.today", () => ({ approvals: [] })), routed("notify.list", () => ({ items: [] })),
  routed("author.prepare", args => ({ kind: "material-only", execution: { supported: false }, admission: { requestKey: JSON.parse(String(args.input)).requestKey, submitter: { moduleId: "author-id", hash: "a".repeat(64) }, targets: [{ name: "example", moduleId: null, expectedActiveHash: null }] } })),
  routed("modules.admit", args => ({ ...args, admissionId: "fixed-admission" })),
  routed("author.write"), routed("author.read", () => ({ content: "material" })), routed("author.list", () => ({ items: [] })), routed("author.stage"), routed("author.source"),
  routed("author.submit", args => ({ requestKey: JSON.parse(String(args.input)).requestKey, receiptId: "fixed-receipt", state: "submitted" })),
  routed("author.receipt", () => ({ receiptId: "fixed-receipt", state: "submitted" })),
  routed("memory-local.recall", args => ({ items: [{ text: `Memory: ${args.query}` }] })),
  routed("memory-local.conversation-context", () => ({ text: "Selected memory", recalled: true })),
  routed("memory-local.conversation-retain", args => { const snapshot = JSON.parse(String(args.snapshot)); return { retained: true, through: snapshot.messages.at(-1)?.at, chars: 10 }; }),
]) });
async function raw(body: unknown, options: { method?: string; contentType?: string; literal?: boolean } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await module.fetch("/api/mcp", { method: options.method ?? "POST", headers: { "content-type": options.contentType ?? "application/json" }, ...(options.method === "GET" ? {} : { body: options.literal ? String(body) : JSON.stringify(body) }) });
      return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null };
    } catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
}
const rpc = (method: string, params: unknown = {}, id: unknown = 1) => raw({ jsonrpc: "2.0", id, method, params });
const tool = async (name: string, args: unknown = {}) => (await rpc("tools/call", { name, arguments: args })).body.result;
const json = async (name: string, args: Args = {}) => {
  const result = await tool(name, args);
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
};
const forwarded = () => module.calls.filter((entry: { method: string }) => entry.method === "call");
try {
  const activate = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: "2026-11-09T00:00:00Z" }, now: "2026-11-09T00:00:00Z", params: {} });
  assert.equal((await activate()).error, undefined, "absent Web must not break MCP");
  webAvailable = true;
  assert.equal((await activate()).error, undefined);
  assert.equal((await activate()).error, undefined);
  assert.equal(pages.length, 2, "activation re-registers after Web starts or changes");
  assert.equal(pages[0].purpose, "settings");
  assert.equal(pages[0].id, "settings");
  const init = await rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.match(init.body.result.instructions, /explicit material only/);
  assert.equal((await raw({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await rpc("ping", {}, null)).body.id, null);
  assert.equal((await rpc("ping", {}, "string-id")).body.id, "string-id");
  assert.equal((await rpc("unknown")).body.error.code, -32601);
  assert.equal((await rpc("tools/call", { name: "chrona_modules", caller: { kind: "owner" } })).body.error.code, -32602);
  for (const params of [[], null, "wrong"]) assert.equal((await rpc("tools/list", params)).body.error.code, -32600);
  for (const value of [null, [], {}, { method: "ping", id: 1 }, { jsonrpc: "1.0", method: "ping", id: 1 }, { jsonrpc: "2.0", method: "ping", id: {} }, { jsonrpc: "2.0", method: "ping", id: true }, { jsonrpc: "2.0", method: "ping", id: 1, caller: "owner" }]) assert.equal((await raw(value)).body.error.code, -32600);
  assert.equal((await raw("{", { literal: true })).body.error.code, -32700);
  assert.equal((await raw({}, { contentType: "text/plain" })).status, 415);
  assert.equal((await raw({}, { method: "GET" })).status, 405);
  assert.equal((await rpc("initialize", { protocolVersion: "x" })).body.error.code, -32602);
  const listed = (await rpc("tools/list")).body.result.tools;
  const names = listed.map((entry: { name: string }) => entry.name);
  for (const name of ["chrona_module_tools", "chrona_module_reference", "chrona_module_call", "chrona_memory_preferences", "chrona_chat"]) assert.ok(names.includes(name));
  for (const name of ["chrona_build", "chrona_module_catalog", "chrona_module_install", "chrona_module_permissions", "chrona_app_settings"]) assert.ok(!names.includes(name));
  assert.equal(listed.find((entry: { name: string }) => entry.name === "chrona_approval_resolve").annotations.destructiveHint, true);
  assert.equal(listed.find((entry: { name: string }) => entry.name === "chrona_module_call").annotations, undefined);
  assert.deepEqual(await json("chrona_modules"), [{ id: "files-id", name: "files", status: "active" }]);
  assert.deepEqual((await json("chrona_module_reference", { target: "author.prepare" })).target, { moduleId: "author", tool: "prepare" });
  assert.equal((await json("chrona_module_reference")).length, contracts.length);
  const overview = await json("chrona_app", { module: "files" });
  assert.equal(overview.kind, "app"); assert.equal(overview.app.id, "files-id"); assert.equal(overview.tools[0].target, "files.list"); assert.deepEqual(overview.diagnostics, diagnostic);
  assert.equal(overview.truncated, false);
  assert.equal((await json("chrona_system_apps", { module: "modules" })).tools[0].target, "modules.list");
  assert.equal((await tool("chrona_app", { module: "absent" })).isError, true);
  assert.deepEqual(await json("chrona_today"), { approvals: [] });
  assert.deepEqual(await json("chrona_notifications"), { items: [] });
  assert.deepEqual(await json("chrona_activity"), { items: [], before: null });

  const beforeInvalid = forwarded().length;
  for (const [name, args] of [
    ["chrona_approval_resolve", { approvalId: "a", decision: "approve", scope: "always" }],
    ["chrona_approval_resolve", { approvalId: "a", decision: "other" }],
    ["chrona_approvals", { status: "other" }], ["chrona_sessions", { status: "other" }], ["chrona_sessions", { source: "build" }],
    ["chrona_session_update", { sessionId: "x", status: "active" }], ["chrona_session_messages", { sessionId: "x", limit: 0 }],
    ["chrona_module_call", { name: "files.list", arguments: null }], ["chrona_modules", { caller: { kind: "owner" } }],
    ["chrona_run_answer", { interactionId: "i1", decision: "other" }], ["chrona_chat", { text: ["hi"] }],
    ["chrona_memory_preferences", { settings: { autoRecall: "true" } }], ["chrona_memory_preferences", { settings: { scope: "always" } }],
  ] as const) assert.equal((await tool(name, args)).isError, true, name);
  for (const args of [null, [], "x", 3]) assert.equal((await rpc("tools/call", { name: "chrona_modules", arguments: args })).body.error.code, -32602);
  assert.equal(forwarded().length, beforeInvalid, "invalid fixed arguments never reach routed calls");
  await json("chrona_approval_resolve", { approvalId: "a1", decision: "approve" });
  assert.deepEqual(calls.at(-1), ["approvals.resolve", { approval: "a1", decision: "approve" }]);
  const decisions = calls.filter(([target]) => target === "approvals.resolve").length;
  assert.equal((await tool("chrona_module_call", { name: "approvals.resolve", arguments: { approval: "a1", decision: "approve" } })).isError, true);
  assert.equal((await tool("chrona_module_call", { name: "agent.respond" })).isError, true);
  assert.equal(calls.filter(([target]) => target === "approvals.resolve").length, decisions);

  assert.equal((await json("chrona_module_tools", { query: "author" })).length, 8);
  const author = (name: string, input: Args) => json("chrona_module_call", { name: `author.${name}`, arguments: { input: JSON.stringify(input) } });
  const prepared = await author("prepare", { requestKey: "material-one", submitter: { moduleId: "author-id", hash: "a".repeat(64) }, targets: [{ name: "example", moduleId: null, expectedActiveHash: null }], goal: "Use supplied material", intent: { changes: ["Add example"] } });
  assert.equal(prepared.kind, "material-only"); assert.equal(prepared.execution.supported, false);
  assert.deepEqual(forwarded().at(-1)!.params.expectedTarget, { moduleId: "author-id", contractHash: "b".repeat(64) });
  const { requestKey: admissionKey, ...admissionArgs } = prepared.admission;
  const admission = await json("chrona_module_call", { name: "modules.admit", arguments: admissionArgs, key: admissionKey });
  assert.equal(forwarded().at(-1)!.params.key, admissionKey);
  assert.equal(admission.admissionId, "fixed-admission");
  assert.equal(forwarded().at(-1)!.params.expectedTarget, undefined);
  await json("chrona_module_call", { name: "author.write", arguments: { path: "sources/workspace/index.ts", content: "material" } });
  assert.equal((await json("chrona_module_call", { name: "author.read", arguments: { path: "sources/workspace/index.ts" } })).content, "material");
  await json("chrona_module_call", { name: "author.list", arguments: { path: "sources/workspace" } });
  await author("stage", { name: "example", from: "sources/workspace", to: "packages/stage", provenance: { kind: "local", label: "owner supplied" } });
  await author("source", { admissionId: admission.admissionId, moduleId: "example-id", hash: "a".repeat(64), to: "sources/workspace" });
  const submitted = await author("submit", { admissionId: admission.admissionId, requestKey: "material-one", items: [{ name: "example", dir: "packages/stage/source", intent: { changes: ["Add example"] } }] });
  assert.equal(submitted.receiptId, "fixed-receipt");
  assert.equal((await author("receipt", { receiptId: submitted.receiptId })).state, "submitted");
  assert.ok(!calls.some(([target]) => target === "agent.run"), "material tooling never claims automatic model authoring");
  const filters = [{ state: "open" }];
  assert.deepEqual(await json("chrona_module_call", { name: "planning.search", arguments: { filters } }), { filters });
  const planningCalls = calls.filter(([target]) => target === "planning.search").length;
  for (const args of [{ filters: [{ state: "wrong" }] }, { filters: [{ state: "open", scope: "always" }] }, { filters: "wrong" }, { filters, caller: "owner" }]) assert.equal((await tool("chrona_module_call", { name: "planning.search", arguments: args })).isError, true);
  assert.equal(calls.filter(([target]) => target === "planning.search").length, planningCalls);
  for (const name of ["modules.build-owner", "modules.install", "modules.source", "agent.private", "files.missing", "planning.searc"]) assert.equal((await tool("chrona_module_call", { name })).isError, true);
  contracts.push(contract("files.later", objectSchema(), "files"));
  assert.equal((await json("chrona_module_tools", { query: "files.later" }))[0].target, "files.later");
  const changed = contracts.find(tool => tool.target === "files.list")!;
  changed.contractHash = "c".repeat(64);
  assert.deepEqual(await json("chrona_module_call", { name: "files.list" }), ["file"]);
  assert.equal(forwarded().at(-1)!.params.expectedTarget.contractHash, "c".repeat(64));
  changed.contractHash = "";
  assert.equal((await tool("chrona_module_call", { name: "files.list" })).isError, true);
  changed.contractHash = "b".repeat(64);
  delete changed.moduleId;
  assert.equal((await tool("chrona_module_call", { name: "files.list" })).isError, true, "application tools require an identity binding");
  changed.moduleId = "files-id";
  contracts.push(changed);
  assert.equal((await tool("chrona_module_call", { name: "files.list" })).isError, true, "ambiguous exact contracts cannot be forwarded");
  contracts.pop();
  contracts.splice(contracts.indexOf(changed), 1);
  assert.equal((await tool("chrona_module_call", { name: "files.list" })).isError, true, "removed tools cannot be called from stale discovery");

  assert.deepEqual(await json("chrona_memory_preferences"), { provider: null, autoRecall: true, autoRetain: true });
  assert.deepEqual(await json("chrona_memory_preferences", { settings: { autoRecall: false } }), { provider: null, autoRecall: false, autoRetain: true });
  assert.deepEqual(await json("chrona_memory"), { provider: null, available: false, autoRecall: false, autoRetain: true });
  const event = (args: Args, caller?: Args) => module.send({ trigger: { kind: "tool", id: "settings", firedAt: "2026-11-09T00:00:00Z", args, ...(caller ? { caller } : {}) }, now: "2026-11-09T00:00:00Z", params: {} });
  const owner = { kind: "owner", via: null };
  assert.equal((await event({ settings: JSON.stringify({ autoRetain: false }) }, owner)).result.result.autoRetain, false);
  assert.ok((await event({ caller: owner }, owner)).error);
  assert.ok((await event({})).error);
  assert.equal((await json("chrona_memory_preferences")).autoRetain, false);
  const ui = (args: Args, caller: unknown = owner) => module.send({ trigger: { kind: "tool", id: "ui-settings", firedAt: "2026-11-09T00:00:00Z", args, caller }, now: "2026-11-09T00:00:00Z", params: {} });
  assert.deepEqual((await ui({})).result.result, { provider: "", autoRecall: false, autoRetain: false });
  assert.deepEqual((await ui({ provider: "memory-local", "auto-recall": true })).result.result, { provider: "memory-local", autoRecall: true, autoRetain: false });
  for (const args of [{ provider: "../bad" }, { "auto-recall": "false" }, { "auto-retain": 1 }, { caller: owner }]) assert.ok((await ui(args)).error);
  assert.ok((await ui({ provider: "" }, null)).error);
  assert.equal((await json("chrona_memory_preferences")).provider, "memory-local");
  assert.deepEqual((await ui({ provider: "" })).result.result, { provider: "", autoRecall: true, autoRetain: false });
  assert.equal((await json("chrona_memory_preferences")).provider, null);
  await json("chrona_memory_preferences", { settings: { provider: "memory-local", autoRecall: true, autoRetain: true } });
  assert.deepEqual(await json("chrona_memory"), { provider: "memory-local", available: true, autoRecall: true, autoRetain: true });
  assert.deepEqual(await json("chrona_memory", { query: "test" }), { items: [{ text: "Memory: test" }] });
  assert.equal((await tool("chrona_module_call", { name: "memory-local.conversation-context", arguments: { snapshot: "{}" } })).isError, true, "generic calls cannot use module-only memory tools");
  assert.ok(!calls.some(([target]) => target === "mcp.settings"), "memory preferences stay private to MCP");

  const reply = await json("chrona_chat", { text: "hi", key: "one", requestKey: "message-one" });
  assert.equal(reply.reply, "done"); assert.match(reply.sessionId, /^mcp-agent:/);
  const started = calls.find(([target]) => target === "agent.run")![1];
  assert.equal(started.lane, "foreground"); assert.match(String(started.prompt), /User message:\nhi/);
  assert.match(String(started.prompt), /Selected memory/);
  assert.ok(calls.some(([target]) => target === "memory-local.conversation-retain"));
  const starts = calls.filter(([target]) => target === "agent.run").length;
  assert.equal((await json("chrona_chat", { text: "hi", key: "one", requestKey: "message-one" })).runId, reply.runId);
  assert.equal(calls.filter(([target]) => target === "agent.run").length, starts);
  assert.equal((await tool("chrona_chat", { text: "changed", key: "one", requestKey: "message-one" })).isError, true);
  assert.equal((await json("chrona_sessions")).length, 1);
  assert.equal((await json("chrona_session", { sessionId: reply.sessionId })).id, reply.sessionId);
  assert.equal((await json("chrona_session_messages", { sessionId: reply.sessionId, limit: 1 }))[0].text, "done");
  assert.equal((await json("chrona_session_transcript", { sessionId: reply.sessionId }))[0].text, "done");
  for (const sessionId of ["build-1", "qq-agent:foreign", "web-agent:foreign", "mcp-agent:absent"]) {
    for (const name of ["chrona_session", "chrona_session_messages", "chrona_session_transcript", "chrona_runs"]) assert.equal((await tool(name, { sessionId })).isError, true);
    assert.equal((await tool("chrona_chat", { sessionId, text: "hi" })).isError, true);
    assert.equal((await tool("chrona_session_update", { sessionId, title: "new" })).isError, true);
  }
  await json("chrona_run_answer", { interactionId: "i1", decision: "submit", value: "answer" });
  assert.deepEqual(calls.at(-1), ["agent.respond", { "run-id": "run-mcp", "question-id": "i1", answer: { decision: "submit", value: "answer" } }]);
  await json("chrona_run_cancel", { runId: "run-mcp" });
  assert.deepEqual(calls.at(-1), ["agent.interrupt", { "run-id": "run-mcp",  }]);
  assert.equal((await tool("chrona_run_cancel", { runId: "foreign-run" })).isError, true);
  assert.equal((await tool("chrona_run_answer", { interactionId: "foreign-question", decision: "cancel" })).isError, true);
  await json("chrona_session_update", { sessionId: reply.sessionId, title: "Renamed" });
  assert.equal((await json("chrona_session", { sessionId: reply.sessionId })).title, "Renamed");
  assert.equal((await json("chrona_session_new", { key: "one" })).status, "ended");
  assert.equal((await json("chrona_sessions", { status: "ended" })).length, 1);
  assert.ok(!calls.some(([target]) => /^(history|chat|content|schedules)\./.test(target) || /build-|permissions|interfaces|settings-get|settings-set|catalog|install/.test(target)));
} finally { await module.stop(); }
