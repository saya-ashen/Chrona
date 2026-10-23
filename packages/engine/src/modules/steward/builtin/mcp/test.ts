import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this sandbox-only path.
import { startModule } from "/chrona/testing.ts";

const owner: { method: string; path: string; body?: unknown }[] = [];
const module = await startModule("/module/index.ts", { stubs: { owner: (params: { method: string; path: string; body?: unknown }) => {
  owner.push(params);
  if (params.path === "/modules/tools") return { status: 200, body: { tools: [{ name: "m_files_list", description: "[module files] List", inputSchema: { type: "object", properties: {}, required: [] } }], toolsets: [{ name: "module_files", description: "Files", tools: ["m_files_list"] }] } };
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
  assert.ok(names.includes("chrona_chat") && names.includes("m_files_list"));
  owner.length = 0;
  assert.deepEqual((await rpc("tools/call", { name: "chrona_content_read", arguments: { appId: "a b" } })).body.result.content[0].text, JSON.stringify({ ok: "/apps/a%20b/file?path=README.md" }, null, 1));
  await rpc("tools/call", { name: "chrona_chat", arguments: { text: "hi" } });
  assert.match(String((owner.at(-1)!.body as { key: string }).key), /^mcp:/);
  await rpc("tools/call", { name: "m_files_list", arguments: { dir: "x" } });
  assert.deepEqual(owner.at(-1), { method: "POST", path: "/modules/tools/m_files_list", body: { dir: "x" } });
  const denied = (await rpc("tools/call", { name: "chrona_approval_resolve", arguments: { approvalId: "x", decision: "approve" } })).body.result;
  assert.equal(denied.isError, true); assert.equal(denied.content[0].text, "forbidden: rescue only");
  assert.equal((await rpc("nope")).body.error.code, -32601);
} finally { await module.stop(); }
