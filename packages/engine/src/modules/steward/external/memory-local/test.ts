import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

// Offline: no memory_embedding credential, so full-text recall only.
const module = await startModule("index.ts");
const owner = { kind: "owner", via: "mcp" };
const tool = (id: string, args: Record<string, unknown>, caller: unknown = owner) => module.send({ trigger: { kind: "tool", id, firedAt: "2026-10-27T12:00:00.000Z", args, caller }, now: "2026-10-27T12:00:00.000Z", params: {} });
const ok = async (id: string, args: Record<string, unknown>) => {
  const reply = await tool(id, args);
  assert.ok(!("error" in reply), JSON.stringify(reply));
  return reply.result.result;
};
try {
  const { id } = await ok("retain", { content: "用户不希望 okx 页面自动执行任何交易操作。" });
  await ok("retain", { content: "The user prefers concise Chinese replies." });
  const found = await ok("recall", { query: "okx 自动", limit: 5 });
  assert.equal(found.items[0].id, id);
  assert.match(found.items[0].content, /okx/);
  assert.equal(found.items[0].source, "owner:mcp");
  assert.equal(found.items[0].correction, null);
  assert.equal((await ok("recall", { query: "concise replies" })).items.length, 1);
  assert.equal(module.calls.filter((call: { params: { target: string } }) => targetName(call.params.target) === "secrets.get").length, 1);
  assert.equal(module.calls.some((call: { params: { target: string } }) => targetName(call.params.target) === "provider.complete"), false);
  assert.ok("error" in await tool("correct-memory", { id, "expected-content": found.items[0].content, content: "更正后的 okx 偏好" }, { kind: "provider", runId: "r1" }));
  await ok("correct-memory", { id, "expected-content": found.items[0].content, content: "更正后的 okx 偏好" });
  const corrected = (await ok("recall", { query: "okx" })).items[0];
  assert.equal(corrected.content, "更正后的 okx 偏好");
  assert.deepEqual(corrected.correction, { source: "owner:mcp", at: "2026-10-27T12:00:00.000Z" });
  assert.ok("error" in await tool("retain", { content: found.items[0].content }));
  assert.equal((await ok("forget", { id })).forgotten, true);
  assert.equal((await ok("recall", { query: "okx 自动" })).items.length, 0);
  // The router and SDK supply real module/owner/Provider identities; kernel proxy calls are gone.
  for (const caller of [{ kind: "module", module: "web", moduleId: "web-id", hash: "web-hash" }, { kind: "provider", runId: "r1" }, owner]) {
    assert.ok(!("error" in await tool("recall", { query: "concise replies" }, caller)));
  }
  for (const [toolId, args] of [["recall", { query: "okx" }], ["retain", { content: "unauthorized" }], ["forget", { id }]] as const) {
    assert.ok("error" in await tool(toolId, args, { kind: "kernel" }));
  }
  const snapshot = { session: { id: "conversation-1", source: "forged" }, messages: [{ direction: "in", text: "zirconium old preference", at: "2026-10-27T11:00:00Z" }], now: "2026-10-27T12:00:00Z", autoRecall: true, autoRetain: true, ending: true, recalled: false, retainedThrough: null };
  const entry = { kind: "module", module: "web", moduleId: "web-id", hash: "web-hash" };
  assert.equal((await tool("conversation-retain", { snapshot: JSON.stringify(snapshot) }, entry)).result.result.retained, true);
  const remembered = (await ok("recall", { query: "zirconium" })).items[0];
  assert.equal(remembered.source, "conversation:web:web-id:conversation-1");
  await ok("correct-memory", { id: remembered.id, "expected-content": remembered.content, content: "zirconium corrected preference" });
  snapshot.messages.push({ direction: "out", text: "more context", at: "2026-10-27T11:01:00Z" });
  assert.deepEqual((await tool("conversation-retain", { snapshot: JSON.stringify(snapshot) }, entry)).result.result, { retained: false, reason: "corrected_source" });
  const preference = await ok("remember", { text: "使用中文简短回复", topic: "ui" });
  assert.equal((await ok("preferences", {}))[0].id, preference.id);
  assert.equal((await ok("forget", { id: preference.id })).forgotten, true);
  assert.deepEqual(await ok("preferences", {}), []);
  assert.ok("error" in await tool("conversation-context", { snapshot: "{}" }, owner));
  assert.equal((await ok("recall", { query: "concise replies" })).items.length, 1);
  assert.ok("error" in await tool("recall", { query: " " }));
  const smoke = await module.send({ trigger: { kind: "tool", id: "recall", firedAt: "2026-10-27T12:00:00.000Z", args: {} }, now: "2026-10-27T12:00:00.000Z", params: {} });
  assert.deepEqual(smoke.result.result, { ignored: "no caller" });
} finally { await module.stop(); }

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
