import { strict as assert } from "node:assert";

// Consumer assertions deliberately import no engine, database or shared schema implementation.
// A harness supplies two installed SDK callers, an echo tool, and a restart of the same data.
type Reply = { value?: unknown; error?: { code: string } };
export type ConsumerHarness = {
  request(caller: "owner" | "ordinary", body: Record<string, unknown>): Promise<Reply>;
  restart(): Promise<void>;
  loseReply(caller: "owner" | "ordinary", body: Record<string, unknown>): Promise<void>;
  target: { moduleId: string; tool: string };
};
const record = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const ok = (reply: Reply) => { assert.equal(reply.error, undefined, JSON.stringify(reply)); return reply.value; };
const object = (reply: Reply) => record(ok(reply));
const page = (reply: Reply) => {
  const value = object(reply);
  assert.ok(Array.isArray(value.items));
  return { ...value, nextCursor: value.nextCursor, items: value.items.map(record) };
};
export async function verifyKernelConsumer(harness: ConsumerHarness) {
  const call = async (caller: "owner" | "ordinary", target: unknown, args = {}, options = {}) => harness.request(caller, { target, args, options });
  const list = page(await call("owner", "modules.list", { limit: 1 }));
  assert.equal(list.items.length, 1); assert.equal(typeof list.nextCursor, "string");
  const next = page(await call("owner", "modules.list", { limit: 1, cursor: list.nextCursor }));
  assert.notEqual(next.items[0]!.id, list.items[0]!.id);
  assert.equal((await call("owner", "approvals.list", { cursor: list.nextCursor })).error?.code, "invalid");
  assert.equal((await call("ordinary", "settings.update", { timezone: "UTC" })).error?.code, "forbidden");
  assert.equal(object(await call("owner", "settings.update", { timezone: "UTC" })).timezone, "UTC");
  assert.equal((await call("owner", "settings.update", { settings: "{}" })).error?.code, "invalid");
  assert.equal((await call("owner", "modules.tools")).error?.code, "not_found");
  const secret = { name: "consumer_fixture", value: { token: "synthetic-consumer-value" } };
  assert.equal((await call("ordinary", "secrets.set", secret)).error?.code, "forbidden");
  ok(await call("owner", "secrets.set", secret));
  const saved = page(await call("owner", "secrets.list"));
  assert.ok(saved.items.some(item => item.name === secret.name));
  assert.ok(!JSON.stringify(saved).includes(secret.value.token));
  assert.equal((await call("ordinary", "secrets.get", { name: secret.name })).error?.code, "forbidden");
  ok(await call("owner", "secrets.remove", { name: secret.name }));
  await harness.loseReply("owner", { target: harness.target, args: { value: "original" }, options: { key: "fixed-operation" } });
  const recovered = object(await harness.request("owner", { status: { target: harness.target, key: "fixed-operation" } }));
  assert.equal(recovered.status, "succeeded");
  const first = object(await call("owner", harness.target, { value: "original" }, { key: "fixed-operation" }));
  assert.deepEqual(recovered.output, first);
  assert.equal(first.count, 1);
  assert.deepEqual(ok(await call("owner", harness.target, { value: "original" }, { key: "fixed-operation" })), first);
  assert.equal((await call("owner", harness.target, { value: "changed" }, { key: "fixed-operation" })).error?.code, "conflict");
  const timer = { id: "review", schedule: { kind: "every", milliseconds: 60000 }, payload: { review: true } };
  ok(await call("ordinary", "timers.set", timer, { key: "timer-start" }));
  assert.equal(page(await call("ordinary", "timers.list")).items.length, 1);
  assert.equal(page(await call("owner", "timers.list")).items.length, 0);
  await harness.restart();
  const receipt = object(await harness.request("owner", { status: { target: harness.target, key: "fixed-operation" } }));
  assert.equal(receipt.status, "succeeded"); assert.deepEqual(receipt.output, first);
  assert.deepEqual(ok(await call("owner", harness.target, { value: "original" }, { key: "fixed-operation" })), first);
  assert.equal(page(await call("ordinary", "timers.list")).items[0]!.id, "review");
  ok(await call("ordinary", "timers.cancel", { id: "review" }, { key: "timer-stop" }));
  assert.equal(page(await call("ordinary", "timers.list")).items[0]!.status, "cancelled");
  const pause = { moduleId: harness.target.moduleId, reason: "consumer explicitly pauses fixture" };
  assert.equal((await call("owner", "modules.disable", pause)).error?.code, "invalid");
  const operation = object(await call("owner", "modules.disable", pause, { key: "pause-fixture" }));
  assert.equal(operation.status, "done");
  assert.deepEqual(ok(await call("owner", "modules.operation", { moduleId: pause.moduleId, action: "disable", key: "pause-fixture" })), operation);
  assert.equal((await call("owner", "modules.disable", { ...pause, reason: "different" }, { key: "pause-fixture" })).error?.code, "conflict");
  await harness.restart();
  assert.deepEqual(ok(await call("owner", "modules.operation", { moduleId: pause.moduleId, action: "disable", key: "pause-fixture" })), operation);
  return { pagination: true, authority: true, durableReceipts: true, timerOwnership: true, restart: true, secrets: true, lifecycle: true };
}
