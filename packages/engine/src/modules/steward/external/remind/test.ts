import { strict as assert } from "node:assert";
import { PAGE } from "./page";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runOfflineChecks } from "./reminders.test";
// @ts-expect-error Chrona supplies the test kernel at runtime.
import { startModule, paths } from "chrona/testing";

await runOfflineChecks();
const pages = new Map<string, typeof PAGE>();
const module = await startModule("activation-harness.ts", { stubs: { "web.page-set": (args: typeof PAGE) => { pages.set(args.id, args); return { id: args.id }; } } });
const now = new Date().toISOString();
const caller = { kind: "owner" };
async function tool(id: string, args: Record<string, unknown>) {
  const reply = await module.send({ trigger: { kind: "tool", id, firedAt: now, args, caller }, now, params: {} });
  assert.equal(reply.error, undefined); return reply.result.result;
}
try {
  for (let i = 0; i < 100 && !existsSync(join(paths.data, "activation-ready")); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(join(paths.data, "activation-ready")));
  const activate = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal((await activate()).error, "Web unavailable");
  assert.deepEqual(await tool("list", {}), { reminders: [] });
  assert.equal((await activate()).error, undefined);
  assert.equal((await activate()).error, undefined);
  assert.equal(pages.size, 1); assert.equal(pages.get("main")?.title, "提醒");
  const args = { rule: JSON.stringify({ kind: "every", minutes: 5 }), text: "喝水", label: "喝水", timezone: "UTC" };
  const created = await tool("create", args);
  assert.deepEqual(await tool("create", args), created);
  assert.equal((await tool("list", {})).reminders.length, 1);
  assert.deepEqual(await tool("cancel", { key: created.key }), { cancelled: true });
  assert.equal(module.calls.some((call: { params: { target: string } }) => targetName(call.params.target).startsWith("schedules.")), false);
} finally { await module.stop(); }

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
