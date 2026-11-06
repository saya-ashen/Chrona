import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createEvents, type Directory } from "./events";

const caller = (name: string, moduleId = `${name}-id`, hash = "h") => ({ kind: "module" as const, module: name, moduleId, hash });
const inputSchema = { type: "object", properties: { event: { type: "string" }, from: { type: "string" }, payload: { type: "string" } }, required: ["event", "from", "payload"] };
async function fixture() {
  const dir = await mkdtemp("/tmp/events-lifecycle-");
  const directory: Directory = { modules: ["alpha", "beta", "source"].map(name => ({ id: `${name}-id`, name, status: "active", activeHash: "h" })), tools: ["alpha", "beta"].map(name => ({ target: `${name}.receive`, moduleId: `${name}-id`, hash: "h", contractHash: "callback-v1", inputSchema })) };
  const calls: { target: string; key: string; callId: string }[] = [];
  let offline = false, loseNextReceipt = false;
  const ports = { dataDir: dir, directory: async () => { if (offline) throw new Error("directory unavailable"); return directory; },
    contributions: async () => [{ module: "source", value: { emits: [{ name: "changed", payload: { required: ["id"], properties: { id: { type: "string" } } } }] } }],
    call: async (target: string, _args: Record<string, unknown>, options: { key: string }) => {
      const existing = calls.find(call => call.target === target && call.key === options.key);
      if (existing) return { callId: existing.callId, duplicate: true };
      const call = { target, key: options.key, callId: `call-${calls.length}` }; calls.push(call);
      if (loseNextReceipt) { loseNextReceipt = false; throw new Error("enqueue acknowledgement lost"); }
      return { callId: call.callId };
    } };
  let events = createEvents(ports);
  return { dir, directory, calls, get events() { return events; }, restart() { events = createEvents(ports); }, offline(value: boolean) { offline = value; }, loseReceipt() { loseNextReceipt = true; },
    subscribe: (name: string) => events.handle("subscribe", { event: "source.changed", tool: "receive" }, caller(name)),
    emit: (key: string) => events.handle("emit", { event: "changed", payload: '{"id":"one"}', key }, caller("source")),
    list: (name: string) => events.handle("subscriptions", {}, caller(name)),
    close: () => rm(dir, { recursive: true, force: true }) };
}

test("two subscribers remain isolated across duplicate registration, pause/resume, deletion and same-name replacement", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha"); await f.subscribe("beta"); await f.subscribe("alpha");
    expect(await f.emit("one")).toEqual({ delivered: 2 });
    await f.emit("one"); expect(f.calls).toHaveLength(2);
    f.directory.modules[0]!.status = "paused";
    expect(await f.emit("two")).toEqual({ delivered: 1 }); expect(f.calls.at(-1)!.target).toBe("beta.receive");
    f.directory.modules[0]!.status = "active";
    expect(await f.emit("three")).toEqual({ delivered: 2 });
    f.directory.modules[0]!.id = "replacement-alpha";
    expect(await f.emit("four")).toEqual({ delivered: 1 });
    expect(await f.events.handle("subscriptions", {}, caller("alpha", "replacement-alpha"))).toEqual({ subscriptions: [] });
    await expect(f.subscribe("alpha")).rejects.toThrow("forbidden");
    expect(await f.list("beta")).toEqual({ subscriptions: [{ event: "source.changed", module: "beta", tool: "receive" }] });
  } finally { await f.close(); }
});

test("persistent revision fencing rejects stale failed receipts, duplicate and unknown results do not replay", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha"); await f.emit("first");
    const old = f.calls[0]!;
    f.directory.tools[0]!.contractHash = "callback-v2";
    expect(await f.emit("invalidated")).toEqual({ delivered: 0 });
    await f.subscribe("alpha");
    f.restart();
    f.events.result({ callId: old.callId, status: "failed", error: "forbidden: previous contract" });
    expect(await f.emit("second")).toEqual({ delivered: 1 });
    const second = f.calls.at(-1)!;
    f.events.result({ callId: second.callId, status: "unknown", error: "receipt lost" });
    f.restart(); await f.emit("second");
    expect(f.calls).toHaveLength(2);
    f.events.result({ callId: second.callId, status: "failed", error: "not_found: stale duplicate" });
    expect(await f.emit("third")).toEqual({ delivered: 1 });
    f.events.result({ callId: f.calls.at(-1)!.callId, status: "failed", error: "unavailable: owner paused" });
    expect(await f.emit("fourth")).toEqual({ delivered: 1 });
  } finally { await f.close(); }
});

test("failed directory reads preserve registrations; invalid callbacks and publisher identity changes never redirect", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha"); await f.subscribe("beta"); f.offline(true);
    await expect(f.emit("offline")).rejects.toThrow("directory unavailable");
    expect(f.calls).toHaveLength(0); f.offline(false);
    expect(await f.list("alpha")).toMatchObject({ subscriptions: [{ module: "alpha" }] });
    f.directory.tools[0]!.inputSchema = { type: "object", properties: { payload: { type: "number" } } };
    expect(await f.emit("invalid")).toEqual({ delivered: 1 });
    await expect(f.subscribe("alpha")).rejects.toThrow("forbidden");
    f.directory.modules[2]!.id = "new-source";
    await expect(f.emit("old-source")).rejects.toThrow("forbidden");
    expect(await f.events.handle("emit", { event: "changed", payload: '{"id":"new"}', key: "new-source" }, caller("source", "new-source"))).toEqual({ delivered: 0 });
  } finally { await f.close(); }
});

test("lost enqueue acknowledgement resumes the persisted revision after restart without another callback", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha"); f.loseReceipt();
    await expect(f.emit("same-key")).rejects.toThrow("acknowledgement lost");
    expect(f.calls).toHaveLength(1);
    f.restart(); await f.emit("same-key"); expect(f.calls).toHaveLength(1);
    f.events.result({ callId: f.calls[0]!.callId, status: "failed", error: "conflict: old callback invalid" });
    expect(await f.emit("no-replay")).toEqual({ delivered: 0 });
    await f.subscribe("alpha"); expect(await f.emit("fresh-key")).toEqual({ delivered: 1 });
    expect(f.calls).toHaveLength(2);
  } finally { await f.close(); }
});

test("caller, payload type and 64KiB boundary are enforced", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha");
    await expect(f.events.handle("emit", { event: "changed", payload: '{"id":1}', key: "invalid" }, caller("source"))).rejects.toThrow("payload.id must be string");
    await expect(f.events.handle("emit", { event: "changed", payload: "x".repeat(65_537), key: "large" }, caller("source"))).rejects.toThrow("64 KiB");
    await expect(f.events.handle("unsubscribe", { event: "source.changed", tool: "receive" }, { kind: "owner" })).rejects.toThrow("forbidden");
    await f.events.handle("unsubscribe", { event: "source.changed", tool: "receive" }, caller("beta"));
    expect(await f.emit("still-alpha")).toEqual({ delivered: 1 });
    expect(f.calls[0]!.target).toBe("alpha.receive");
  } finally { await f.close(); }
});
