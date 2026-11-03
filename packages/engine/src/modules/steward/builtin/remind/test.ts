import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

const module = await startModule("index.ts", {
  stubs: {
    "schedules.create": (args: Record<string, unknown>) => ({ id: "s1", status: "active", nextAt: "2026-10-23T00:00:00.000Z", key: args.key }),
    "schedules.mine": () => [{ key: "r-1", label: "喝水", status: "active", nextAt: "2026-10-23T00:00:00.000Z", rule: { kind: "daily", time: "08:00" }, payload: { text: "喝水" } }],
    "schedules.cancel": () => ({ cancelled: true }),
  },
});
const now = "2026-10-22T00:00:00Z";
async function tool(id: string, args: Record<string, unknown>) {
  const reply = await module.send({ trigger: { kind: "tool", id, firedAt: now, args }, now, params: {} });
  assert.equal(reply.error, undefined);
  return reply.result.result;
}
try {
  for (const [scheduleId, text] of [["first", "喝水"], ["second", "Take a break"]]) {
    const reply = await module.send({ trigger: { kind: "schedule", id: scheduleId, scheduleId, firedAt: now, payload: { text } }, now, params: {} });
    assert.equal(reply.error, undefined);
    const call = module.calls.at(-1);
    assert.deepEqual(call.params, { target: "notify.send", args: { key: `${scheduleId}:${now}`, level: "now", title: "提醒", body: text }, mode: "async", key: `${scheduleId}:${now}` });
  }
  const args = { rule: JSON.stringify({ kind: "daily", time: "08:00" }), text: "喝水", label: "喝水" };
  const first = await tool("create", args), again = await tool("create", args);
  // The same reminder twice names the same timer: a retry replaces it instead of adding another.
  assert.match(first.key, /^r-[0-9a-f]{24}$/);
  assert.equal(again.key, first.key);
  assert.deepEqual(module.calls.at(-1).params.args, { key: first.key, rule: args.rule, payload: JSON.stringify({ text: "喝水" }), label: "喝水" });
  assert.deepEqual(await tool("list", {}), { reminders: [{ key: "r-1", label: "喝水", text: "喝水", rule: { kind: "daily", time: "08:00" }, status: "active", nextAt: "2026-10-23T00:00:00.000Z" }] });
  assert.deepEqual(await tool("cancel", { key: "r-1" }), { cancelled: true });
} finally { await module.stop(); }
