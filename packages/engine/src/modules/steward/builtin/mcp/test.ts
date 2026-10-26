import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

type Args = Record<string, unknown>;
const calls: [string, Args][] = [];
const moduleTools: { target: string; description: string; inputSchema: Args }[] = [{ target: "files.list", description: "List a document directory.", inputSchema: { type: "object", properties: {}, required: [] } }];
const routed = (target: string, answer: (args: Args) => unknown = () => ({ ok: target })) => [target, (args: Args) => { calls.push([target, args]); return answer(args); }] as const;
const module = await startModule("index.ts", { stubs: {
  ...Object.fromEntries([
    routed("modules.tools", args => moduleTools.filter(tool => !args.query || tool.target.includes(String(args.query)))),
    routed("chat.ask"), routed("chat.answer"), routed("chat.today", () => ({ approvals: [], updates: [{ title: "n1" }] })), routed("chat.sessions"), routed("chat.messages"), routed("approvals.resolve"), routed("modules.list"),
    routed("planning.get", args => ({ plan: args.id })),
    routed("modules.stop-build"), routed("modules.revise-build"), routed("modules.diagnostics", args => [{ module: args.module, incidents: [] }]),
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
  assert.deepEqual(await json("chrona_module_diagnostics", { module: "web" }), [{ module: "web", incidents: [] }]);
  assert.deepEqual(calls.at(-1), ["modules.diagnostics", { module: "web" }]);
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
  moduleTools.push({ target: "planning.get", description: "Get a plan", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } });
  assert.deepEqual((await json("chrona_module_tools", { query: "planning" })).map((entry: { target: string }) => entry.target), ["planning.get"]);
  assert.deepEqual(await json("chrona_module_call", { name: "planning.get", arguments: { id: "x" } }), { plan: "x" });
  await json("chrona_module_call", { name: "modules.stop-build", arguments: { session: "b1" } });
  assert.deepEqual(calls.at(-1), ["modules.stop-build", { session: "b1" }]);
  await json("chrona_module_call", { name: "modules.revise-build", arguments: { session: "b1", requirements: "new goal" } });
  assert.deepEqual(calls.at(-1), ["modules.revise-build", { session: "b1", requirements: "new goal" }]);
  assert.equal((await tool("chrona_module_call", { name: "modules.build", arguments: {} })).isError, true);
  assert.equal((await tool("chrona_module_call", { name: "approvals.resolve", arguments: {} })).isError, true);
  assert.equal((await tool("chrona_module_call", { name: "m_files_list" })).isError, true);
  // Today and notifications come from chat.today; app content is reached through the apps' own tools.
  assert.deepEqual(await json("chrona_notifications"), [{ title: "n1" }]);
  assert.ok(!names.some((name: string) => name.startsWith("chrona_content") || name === "chrona_apps"));
  assert.equal((await tool("nope")).isError, true);
  assert.equal((await rpc("nope")).body.error.code, -32601);
} finally { await module.stop(); }
