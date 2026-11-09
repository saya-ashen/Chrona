import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEvents, type Directory } from "./events";

const caller = (name: string, moduleId = `${name}-id`, hash = "h") => ({ kind: "module" as const, module: name, moduleId, hash });
const inputSchema = { type: "object", properties: { event: { type: "string" }, from: { type: "string" }, payload: { type: "string" } }, required: ["event", "from", "payload"] };
const declarations = [{ name: "changed", payload: { required: ["id"], properties: { id: { type: "string" } } } }];
async function fixture(registered = true) {
  const dir = await mkdtemp("/tmp/events-lifecycle-");
  const directory: Directory = { modules: ["alpha", "beta", "source"].map(name => ({ id: `${name}-id`, name, status: "active", activeHash: "h" })), tools: ["alpha", "beta"].map(name => ({ target: `${name}.receive`, moduleId: `${name}-id`, hash: "h", contractHash: "callback-v1", inputSchema })) };
  const calls: { target: string; key: string; callId: string; expectedTarget: { moduleId: string; contractHash: string } }[] = [];
  let offline = false, loseNextReceipt = false;
  const ports = { dataDir: dir, directory: async () => { if (offline) throw new Error("directory unavailable"); return directory; },
    call: async (target: string, _args: Record<string, unknown>, options: { key: string; expectedTarget: { moduleId: string; contractHash: string } }) => {
      const existing = calls.find(call => call.target === target && call.key === options.key);
      if (existing) return { callId: existing.callId, duplicate: true };
      const call = { target, key: options.key, callId: `call-${calls.length}`, expectedTarget: options.expectedTarget }; calls.push(call);
      if (loseNextReceipt) { loseNextReceipt = false; throw new Error("enqueue acknowledgement lost"); }
      return { callId: call.callId };
    } };
  let events = createEvents(ports);
  if (registered) await events.handle("register", { emits: JSON.stringify(declarations) }, caller("source"));
  return { dir, directory, calls, get events() { return events; }, restart() { events = createEvents(ports); }, offline(value: boolean) { offline = value; }, loseReceipt() { loseNextReceipt = true; },
    register: (emits: unknown = declarations, from = caller("source")) => events.handle("register", { emits: JSON.stringify(emits) }, from),
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
    await expect(f.events.handle("emit", { event: "changed", payload: '{"id":"new"}', key: "new-source" }, caller("source", "new-source"))).rejects.toThrow("not_found");
    await f.register(declarations, caller("source", "new-source"));
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

test("registration requires a live SDK caller and never accepts identity in arguments", async () => {
  const f = await fixture(false);
  try {
    const args = { emits: JSON.stringify(declarations) };
    for (const from of [{ kind: "owner" }, { kind: "kernel" }, caller("source", "source-id", "old"), caller("source", "replacement"), caller("beta", "source-id")])
      await expect(f.events.handle("register", args, from)).rejects.toThrow("forbidden");
    await expect(f.events.handle("register", { ...args, moduleId: "source-id" }, caller("beta"))).rejects.toThrow("invalid");
    await expect(f.subscribe("alpha")).rejects.toThrow("not_found");
    await expect(f.emit("unregistered")).rejects.toThrow("not_found");
    expect(await f.register()).toEqual({ registered: true });
    await f.subscribe("alpha");
    expect(await f.emit("registered")).toEqual({ delivered: 1 });
    expect(f.calls[0]!.expectedTarget).toEqual({ moduleId: "alpha-id", contractHash: "callback-v1" });
    expect(JSON.parse(await readFile(join(f.dir, "publishers.json"), "utf8"))).toEqual([{ module: "source", moduleId: "source-id", hash: "h", emits: declarations }]);
  } finally { await f.close(); }
});

test("strict bounded registration rejects malformed declarations without replacing valid state", async () => {
  const f = await fixture();
  try {
    const invalid = [
      null, {}, [null], [{ name: "source.changed" }], [{ name: "" }], [{ name: "UPPER" }], [{ name: "a".repeat(42) }],
      [{ name: "changed" }, { name: "changed" }], Array.from({ length: 21 }, (_, index) => ({ name: `event-${index}` })),
      [{ name: "changed", module: "other" }], [{ name: "changed", description: 3 }], [{ name: "changed", description: "x".repeat(301) }],
      ...[null, [], { type: "string" }, { additionalProperties: false }, { required: "id" }, { required: [1] }, { required: ["id", "id"] },
        { required: [""] }, { required: Array.from({ length: 101 }, (_, index) => `id${index}`) },
        { properties: [] }, { properties: { id: null } }, { properties: { id: { type: "date" } } }, { properties: { id: { enum: ["one"] } } },
        { properties: { ["x".repeat(129)]: {} } }, { properties: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`id${index}`, {}])) },
      ].map(payload => ({ name: "changed", payload })).map(item => [item]),
    ];
    for (const value of invalid) await expect(f.register(value)).rejects.toThrow("invalid");
    for (const emits of [1, "{", " ".repeat(32_769), " ".repeat(32_760) + "éééé[]"])
      await expect(f.events.handle("register", { emits }, caller("source"))).rejects.toThrow("invalid");
    const expanding = `[${Array.from({ length: 20 }, (_, index) => `{"name":"event-${index}","description":"${"\ud800".repeat(300)}"}`).join(",")}]`;
    expect(Buffer.byteLength(expanding)).toBeLessThan(32_768);
    expect(Buffer.byteLength(JSON.stringify(JSON.parse(expanding)))).toBeGreaterThan(32_768);
    await expect(f.events.handle("register", { emits: expanding }, caller("source"))).rejects.toThrow("invalid");
    await f.subscribe("alpha");
    expect(await f.emit("unchanged")).toEqual({ delivered: 1 });
    expect(await f.register(Array.from({ length: 20 }, (_, index) => ({ name: `event-${index}` })))).toEqual({ registered: true });
  } finally { await f.close(); }
});

test("publisher hash changes require explicit registration and old hashes cannot revive on rollback", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha");
    f.directory.modules[2]!.activeHash = "new-hash";
    await expect(f.emit("stale")).rejects.toThrow("forbidden");
    await expect(f.subscribe("beta")).rejects.toThrow("not_found");
    await expect(f.events.handle("emit", { event: "changed", payload: '{"id":"one"}', key: "new" }, caller("source", "source-id", "new-hash"))).rejects.toThrow("not_found");
    await f.register(declarations, caller("source", "source-id", "new-hash"));
    expect(await f.events.handle("emit", { event: "changed", payload: '{"id":"one"}', key: "new" }, caller("source", "source-id", "new-hash"))).toEqual({ delivered: 1 });
    f.directory.modules[2]!.activeHash = "h";
    await expect(f.emit("rollback")).rejects.toThrow("not_found");
    await f.register();
    expect(await f.emit("explicit-rollback")).toEqual({ delivered: 1 });
  } finally { await f.close(); }
});

test("startup reconciliation persistently removes paused, missing and replaced publishers", async () => {
  for (const change of ["paused", "missing", "replacement", "hash"] as const) {
    const f = await fixture();
    try {
      await f.subscribe("alpha");
      const source = { ...f.directory.modules[2]! };
      if (change === "paused") f.directory.modules[2]!.status = "paused";
      if (change === "missing") f.directory.modules.splice(2, 1);
      if (change === "replacement") f.directory.modules[2]!.id = "replacement-source";
      if (change === "hash") f.directory.modules[2]!.activeHash = "changed";
      f.restart(); await f.events.reconcile();
      expect(JSON.parse(await readFile(join(f.dir, "publishers.json"), "utf8"))).toEqual([]);
      f.directory.modules[2] = source;
      f.restart();
      await expect(f.subscribe("beta")).rejects.toThrow("not_found");
      await expect(f.emit("restored")).rejects.toThrow("not_found");
      await f.register(); await f.subscribe("beta");
      expect(await f.emit("explicit")).toEqual({ delivered: change === "missing" || change === "replacement" ? 1 : 2 });
    } finally { await f.close(); }
  }
});

test("registration replacement and withdrawal survive restart and remain scoped to the publisher", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha");
    await f.register([{ name: "other" }], caller("beta"));
    await f.register([{ name: "replacement" }]);
    f.restart(); await f.events.reconcile();
    await expect(f.emit("withdrawn-event")).rejects.toThrow("not_found");
    await expect(f.subscribe("beta")).rejects.toThrow("not_found");
    await f.events.handle("subscribe", { event: "beta.other", tool: "receive" }, caller("alpha"));
    await f.register([]); f.restart();
    expect(await f.events.handle("emit", { event: "other", payload: "{}", key: "beta-still-registered" }, caller("beta"))).toEqual({ delivered: 1 });
    expect(JSON.parse(await readFile(join(f.dir, "publishers.json"), "utf8"))).toContainEqual({ module: "source", moduleId: "source-id", hash: "h", emits: [] });
  } finally { await f.close(); }
});

test("failed directory reconciliation preserves persisted publisher registration for recovery", async () => {
  const f = await fixture();
  try {
    await f.subscribe("alpha"); f.offline(true);
    await expect(f.events.reconcile()).rejects.toThrow("directory unavailable");
    await expect(f.register([])).rejects.toThrow("directory unavailable");
    f.restart(); f.offline(false);
    expect(await f.emit("recovered")).toEqual({ delivered: 1 });
  } finally { await f.close(); }
});

test("stored declarations are validated at load rather than trusted as caller registrations", async () => {
  const f = await fixture();
  try {
    for (const stored of [{}, [{ module: "source", emits: declarations }], [{ module: "source", moduleId: "source-id", hash: "h", emits: [{ name: "other.event" }] }]]) {
      await writeFile(join(f.dir, "publishers.json"), JSON.stringify(stored));
      expect(() => f.restart()).toThrow("invalid");
    }
  } finally { await f.close(); }
});

test("registered payload types and own required keys are enforced", async () => {
  const f = await fixture();
  try {
    await f.register([{ name: "typed", payload: { type: "object", required: ["constructor"], properties: { constructor: { type: "string" }, count: { type: "integer" }, value: { type: "number" }, flag: { type: "boolean" }, items: { type: "array" }, info: { type: "object" }, empty: { type: "null" } } } }]);
    const emit = (payload: string) => f.events.handle("emit", { event: "typed", payload, key: "typed" }, caller("source"));
    await expect(emit("{}")).rejects.toThrow("payload.constructor is required");
    const valid = { constructor: "own", count: 1, value: 1.5, flag: true, items: [], info: {}, empty: null };
    expect(await emit(JSON.stringify(valid))).toEqual({ delivered: 0 });
    for (const [key, value] of [["count", 1.5], ["value", "one"], ["flag", 1], ["items", {}], ["info", []], ["empty", false]])
      await expect(emit(JSON.stringify({ ...valid, [key as string]: value }))).rejects.toThrow(`payload.${key} must be`);
    await expect(emit('{"constructor":"own","value":1e400}')).rejects.toThrow("payload.value must be number");
  } finally { await f.close(); }
});
