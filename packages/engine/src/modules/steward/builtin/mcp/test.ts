import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

const owner: { method: string; path: string; body?: unknown }[] = [];
const moduleTools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [{ name: "m_files_list", description: "[module files] List", inputSchema: { type: "object", properties: {}, required: [] } }];
const module = await startModule("index.ts", { stubs: { owner: (params: { method: string; path: string; body?: unknown }) => {
  owner.push(params);
  if (params.path === "/modules/tools") return { status: 200, body: { tools: [...moduleTools], toolsets: [{ name: "module_files", description: "Files", tools: ["m_files_list"] }] } };
  if (params.path.startsWith("/approvals/")) return { status: 403, body: { code: "forbidden", message: "rescue only" } };
  return { status: 200, body: { ok: params.path } };
} } });
async function rpc(method: string, params: unknown = {}, id: number | null = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("http://module/api/mcp", { unix: module.httpSocket, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
      return { status: response.status, body: response.status === 200 ? await response.json() : null };
    } catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
try {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.match(init.body.result.instructions, /module_files: Files/);
  assert.equal((await rpc("notifications/initialized", {}, null)).status, 202);
  const names = (await rpc("tools/list")).body.result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("chrona_chat") && names.includes("chrona_module_tools") && names.includes("chrona_module_call"));
  assert.ok(!names.some((name: string) => name.startsWith("m_")));
  const found = async (query?: string) => JSON.parse((await rpc("tools/call", { name: "chrona_module_tools", arguments: query === undefined ? {} : { query } })).body.result.content[0].text).map((tool: { name: string }) => tool.name);
  assert.deepEqual(await found(), ["m_files_list"]);
  // A module activated after the client listed its tools is found and callable at once.
  moduleTools.push({ name: "m_planning_get", description: "[module planning] Get a plan", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } });
  assert.deepEqual(await found("PLANNING plan"), ["m_planning_get"]);
  assert.deepEqual(await found("planning list"), []);
  owner.length = 0;
  assert.deepEqual((await rpc("tools/call", { name: "chrona_content_read", arguments: { appId: "a b" } })).body.result.content[0].text, JSON.stringify({ ok: "/apps/a%20b/file?path=README.md" }, null, 1));
  await rpc("tools/call", { name: "chrona_chat", arguments: { text: "hi" } });
  assert.match(String((owner.at(-1)!.body as { key: string }).key), /^mcp:/);
  await rpc("tools/call", { name: "chrona_module_call", arguments: { name: "m_planning_get", arguments: { id: "x" } } });
  assert.deepEqual(owner.at(-1), { method: "POST", path: "/modules/tools/m_planning_get", body: { id: "x" } });
  assert.equal((await rpc("tools/call", { name: "chrona_module_call", arguments: { name: "chrona_today" } })).body.result.isError, true);
  assert.equal((await rpc("tools/call", { name: "m_files_list", arguments: {} })).body.result.isError, true);
  const denied = (await rpc("tools/call", { name: "chrona_approval_resolve", arguments: { approvalId: "x", decision: "approve" } })).body.result;
  assert.equal(denied.isError, true); assert.equal(denied.content[0].text, "forbidden: rescue only");
  assert.equal((await rpc("nope")).body.error.code, -32601);
} finally { await module.stop(); }
