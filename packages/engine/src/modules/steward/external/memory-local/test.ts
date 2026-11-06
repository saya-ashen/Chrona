import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

// Offline: no memory_embedding credential, so full-text recall only.
const module = await startModule("index.ts");
const kernel = { kind: "kernel" };
const tool = (id: string, args: Record<string, unknown>, caller: unknown = kernel) => module.send({ trigger: { kind: "tool", id, firedAt: "2026-10-27T12:00:00.000Z", args, caller }, now: "2026-10-27T12:00:00.000Z", params: {} });
const ok = async (id: string, args: Record<string, unknown>) => {
  const reply = await tool(id, args);
  assert.ok(!("error" in reply), JSON.stringify(reply));
  return reply.result.result;
};
try {
  const { id } = await ok("retain", { content: "用户不希望 okx 页面自动执行任何交易操作。", source: "conversation:web", at: "2026-10-27T12:00:00.000Z" });
  await ok("retain", { content: "The user prefers concise Chinese replies.", source: "conversation:qq", at: "2026-10-27T12:00:00.000Z" });
  const found = await ok("recall", { query: "okx 自动", limit: 5 });
  assert.equal(found.items[0].id, id);
  assert.match(found.items[0].content, /okx/);
  assert.equal((await ok("recall", { query: "concise replies" })).items.length, 1);
  assert.equal(module.calls.filter((call: { params: { target: string } }) => call.params.target === "secrets.get").length, 1);
  assert.equal(module.calls.some((call: { params: { target: string } }) => call.params.target === "provider.complete"), false);
  assert.equal((await ok("forget", { id })).forgotten, true);
  assert.equal((await ok("recall", { query: "okx 自动" })).items.length, 0);
  // Another module, or an empty query, is refused.
  for (const caller of [{ kind: "module", module: "web" }, { kind: "provider", runId: "r1" }, { kind: "owner" }]) {
    for (const [toolId, args] of [["recall", { query: "okx" }], ["retain", { content: "unauthorized", source: "web", at: "2026-10-27T12:00:00.000Z" }], ["forget", { id }]] as const) {
      assert.ok("error" in await tool(toolId, args, caller));
    }
  }
  assert.equal((await ok("recall", { query: "concise replies" })).items.length, 1);
  assert.ok("error" in await tool("recall", { query: " " }));
  const smoke = await module.send({ trigger: { kind: "tool", id: "recall", firedAt: "2026-10-27T12:00:00.000Z", args: {} }, now: "2026-10-27T12:00:00.000Z", params: {} });
  assert.deepEqual(smoke.result.result, { ignored: "no caller" });
} finally { await module.stop(); }
