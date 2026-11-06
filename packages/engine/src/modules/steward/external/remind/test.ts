import { strict as assert } from "node:assert";
import { PAGE } from "./page";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule, paths } from "chrona/testing";

const pages = new Map<string, typeof PAGE>();
const module = await startModule("activation-harness.ts", {
  stubs: {
    "web.page-set": (args: typeof PAGE) => { pages.set(args.id, args); return { id: args.id }; },
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
  for (let i = 0; i < 100 && !existsSync(join(paths.data, "activation-ready")); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(join(paths.data, "activation-ready")));
  const activate = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal((await activate()).error, "Web unavailable");
  assert.equal(pages.size, 0);
  // SDK reports the failed event without killing the handler process; supervisor owns re-delivery.
  assert.deepEqual(await tool("list", {}), { reminders: [{ key: "r-1", label: "喝水", text: "喝水", rule: { kind: "daily", time: "08:00" }, status: "active", nextAt: "2026-10-23T00:00:00.000Z" }] });
  assert.equal((await activate()).error, undefined);
  const firstPage = pages.get("main");
  assert.equal((await activate()).error, undefined);
  assert.equal(pages.size, 1);
  assert.deepEqual(pages.get("main"), firstPage);
  assert.equal(firstPage?.title, "提醒");
  assert.deepEqual(firstPage?.data, { list: { tool: "list" } });
  assert.ok(firstPage);
  assert.match(firstPage.spec.elements.empty.props.text, /还没有提醒/);
  assert.equal(firstPage?.spec.elements.active.props.text, "等待提醒");
  assert.equal(firstPage?.spec.elements.paused.props.text, "已暂停");
  for (const [scheduleId, text] of [["first", "喝水"], ["second", "Take a break"]]) {
    const reply = await module.send({ trigger: { kind: "schedule", id: scheduleId, scheduleId, firedAt: now, payload: { text } }, now, params: {} });
    assert.equal(reply.error, undefined);
    const call = module.calls.at(-1);
    assert.deepEqual(call.params, { target: "notify.send", args: { key: `${scheduleId}:${now}`, level: "now", title: "提醒", body: text }, mode: "async", key: `${scheduleId}:${now}` });
  }
  const firing = { trigger: { kind: "schedule", id: "first", scheduleId: "first", firedAt: now, payload: { text: "喝水" } }, now, params: {} };
  await module.send(firing);
  const repeated = module.calls.at(-1).params;
  assert.equal(repeated.key, `first:${now}`);
  assert.deepEqual(repeated, module.calls.find((call: { params: { target: string } }) => call.params.target === "notify.send").params);
  const args = { rule: JSON.stringify({ kind: "daily", time: "08:00" }), text: "喝水", label: "喝水" };
  const first = await tool("create", args), again = await tool("create", args);
  // The same reminder twice names the same timer: a retry replaces it instead of adding another.
  assert.match(first.key, /^r-[0-9a-f]{24}$/);
  assert.equal(again.key, first.key);
  assert.deepEqual(module.calls.at(-1).params.args, { key: first.key, rule: args.rule, payload: JSON.stringify({ text: "喝水" }), label: "喝水" });
  assert.deepEqual(await tool("list", {}), { reminders: [{ key: "r-1", label: "喝水", text: "喝水", rule: { kind: "daily", time: "08:00" }, status: "active", nextAt: "2026-10-23T00:00:00.000Z" }] });
  assert.deepEqual(await tool("cancel", { key: "r-1" }), { cancelled: true });
} finally { await module.stop(); }
