import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

type Call = { id: string; method: string; params: { target?: string; mode?: string; key?: string; args?: Record<string, unknown> } };
const declared = [{ module: "planning", hash: "p1", value: { emits: [{ name: "updated", description: "A plan changed", payload: { type: "object", required: ["id"], properties: { id: { type: "string" }, rev: { type: "integer" } } } }] } }];
// beta.on-plan is visible to modules (modules.tools lists it); beta.private is not.
const module = await startModule("index.ts", { stubs: {
  "modules.contributions": () => declared,
  "modules.list": () => ["planning", "beta"].map(name => ({ id: `${name}-id`, name, status: "active", activeHash: "h" })),
  "modules.tools": () => [{ target: "beta.on-plan", moduleId: "beta-id", hash: "h", contractHash: "callback-v1", inputSchema: { type: "object", properties: { event: { type: "string" }, from: { type: "string" }, payload: { type: "string" } }, required: ["event", "from", "payload"] } }],
} });
const caller = (name: string) => ({ kind: "module", module: name, moduleId: `${name}-id`, hash: "h" });
let clock = Date.parse("2026-10-25T04:00:00.000Z");
const now = () => new Date(clock += 1000).toISOString();
const tool = async (id: string, args: Record<string, unknown>, from: unknown) => module.send({ trigger: { kind: "tool", id, firedAt: now(), args, caller: from }, now: now(), params: {} });
const ok = async (id: string, args: Record<string, unknown>, from: unknown) => {
  const reply = await tool(id, args, from);
  assert.ok(!("error" in reply), JSON.stringify(reply));
  return reply.result.result;
};
const refused = async (id: string, args: Record<string, unknown>, from: unknown, pattern: RegExp) => {
  const reply = await tool(id, args, from);
  assert.ok("error" in reply && pattern.test(String(reply.error)), JSON.stringify(reply));
};
const deliveries = () => (module.calls as Call[]).filter(call => call.method === "call" && call.params.target === "beta.on-plan");
try {
  // Only modules, only declared events, only the subscriber's own tools that let events call them.
  await refused("subscribe", { event: "planning.updated", tool: "on-plan" }, { kind: "kernel" }, /forbidden/);
  await refused("subscribe", { event: "planning.deleted", tool: "on-plan" }, caller("beta"), /not_found/);
  await refused("subscribe", { event: "planning.updated", tool: "private" }, caller("beta"), /forbidden/);
  assert.deepEqual(await ok("subscribe", { event: "planning.updated", tool: "on-plan" }, caller("beta")), { subscribed: true });
  assert.deepEqual(await ok("subscribe", { event: "planning.updated", tool: "on-plan" }, caller("beta")), { subscribed: true });
  assert.deepEqual(await ok("subscriptions", {}, caller("beta")), { subscriptions: [{ event: "planning.updated", module: "beta", tool: "on-plan" }] });

  // The emitter is the recorded caller: beta cannot emit planning's event, and a payload must match the declaration.
  await refused("emit", { event: "updated", payload: '{"id":"p1"}', key: "k0" }, caller("beta"), /not_found/);
  await refused("emit", { event: "updated", payload: '{"rev":1}', key: "k0" }, caller("planning"), /payload\.id is required/);
  await refused("emit", { event: "updated", payload: '{"id":"p1","rev":"one"}', key: "k0" }, caller("planning"), /payload\.rev must be integer/);
  await refused("emit", { event: "updated", payload: "[1]", key: "k0" }, caller("planning"), /JSON object/);
  assert.equal(deliveries().length, 0);

  // One async routed call per subscriber, keyed by the event and the emitter's key.
  assert.deepEqual(await ok("emit", { event: "updated", payload: '{"id":"p1","rev":2}', key: "k1" }, caller("planning")), { delivered: 1 });
  const [delivery] = deliveries();
  assert.deepEqual(delivery!.params.args, { event: "planning.updated", from: "planning", payload: '{"id":"p1","rev":2}' });
  assert.equal(delivery!.params.mode, "async");
  assert.equal(delivery!.params.key, createHash("sha256").update(JSON.stringify(["planning-id", "updated", "k1", "beta-id", "on-plan"])).digest("hex"));

  // A delivery whose contract failed stays visible but receives nothing until the owner registers again.
  await module.send({ trigger: { kind: "call_result", id: "call", firedAt: now(), callId: delivery!.id, target: "beta.on-plan", key: delivery!.params.key, status: "failed", error: "forbidden: the target no longer accepts this caller" }, now: now(), params: {} });
  assert.deepEqual(await ok("subscriptions", {}, caller("beta")), { subscriptions: [{ event: "planning.updated", module: "beta", tool: "on-plan" }] });
  assert.deepEqual(await ok("emit", { event: "updated", payload: '{"id":"p1"}', key: "k2" }, caller("planning")), { delivered: 0 });

  // Unsubscribing.
  await ok("subscribe", { event: "planning.updated", tool: "on-plan" }, caller("beta"));
  assert.deepEqual(await ok("unsubscribe", { event: "planning.updated", tool: "on-plan" }, caller("beta")), { unsubscribed: true });
  assert.deepEqual(await ok("subscriptions", {}, caller("beta")), { subscriptions: [] });
} finally {
  await module.stop();
}
