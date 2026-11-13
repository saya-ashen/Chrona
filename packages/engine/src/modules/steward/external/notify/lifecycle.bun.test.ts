import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createNotify, type Caller } from "./notify";
import { openStore } from "./store";
import { testDirectory } from "./test-directory";
import { lifecycleNotice } from "./lifecycle";

test("rejected update tells the owner why and identifies the retained version", () => {
  const error = `TS2322: Type string is not assignable to number ${"x".repeat(400)}`;
  const notice = lifecycleNotice("module-update-rejected", { app: "web", hash: "new-candidate", activeHash: "1234567890abcdef", error });
  expect(notice.level).toBe("now");
  expect(notice.title).toBe("应用 web 的更新未通过");
  expect(notice.body).toBe(`应用 web 的更新未通过：${error.slice(0, 300)}。当前仍在运行旧版本 12345678，它可能与当前 Chrona 不兼容。`);
});

const at = new Date("2026-11-05T04:00:00Z");
const caller = (name: string, id = `${name}-id`, hash = "h"): Caller => ({ kind: "module", module: name, moduleId: id, hash });
async function fixture() {
  const dir = await mkdtemp("/tmp/notify-lifecycle-"), store = openStore(dir);
  const alpha = testDirectory("alpha"), beta = testDirectory("beta");
  const directory = { modules: [...alpha.modules, ...beta.modules], tools: [...alpha.tools, ...beta.tools] };
  const calls: { target: string; key: string; callId: string; expectedTarget: { moduleId: string } }[] = [];
  let unavailable = false, loseReceipt = false;
  const ports = { store, publicUrl: null, listModules: async () => { if (unavailable) throw new Error("directory offline"); return directory.modules; },
    describeTools: async () => directory.tools,
    call: async (target: string, _args: Record<string, unknown>, options: { key: string; expectedTarget: { moduleId: string } }) => {
      const existing = calls.find(call => call.target === target && call.key === options.key);
      if (existing) return { callId: existing.callId, status: "queued" };
      const call = { target, key: options.key, callId: `call-${calls.length}`, expectedTarget: options.expectedTarget }; calls.push(call);
      if (loseReceipt) throw new Error("enqueue response lost");
      return { callId: call.callId, status: "queued" };
    }, status: async (callId: string) => ({ callId, status: "unknown", error: "transport receipt lost" }) };
  let notify = createNotify(ports);
  await notify.refresh();
  return { store, calls, directory,
    get notify() { return notify; },
    restart() { notify = createNotify(ports); },
    unavailable(value: boolean) { unavailable = value; }, loseReceipt() { loseReceipt = true; },
    register(name: string, channel = name, id = `${name}-id`, hash = "h") { return notify.handle("channel", { channel, tool: "deliver", ready: true, at: at.toISOString() }, caller(name, id, hash), at); },
    send(key: string, name = "alpha") { return notify.handle("send", { key, level: "now", title: key, body: "body", responds: true }, caller(name), at) as { id: string; duplicate: boolean }; },
    async close() { store.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test("two external channel owners: repeated registration, pause/resume, deletion, replacement and unreadable directory", async () => {
  const f = await fixture();
  try {
    expect(f.register("alpha")).toEqual({ ready: true });
    const first = f.store.get("channel:alpha");
    expect(f.register("alpha")).toEqual({ ready: true });
    expect(f.store.get("channel:alpha")).toBe(first);
    expect(f.register("beta")).toEqual({ ready: true });
    expect(f.register("beta", "alpha")).toMatchObject({ error: "forbidden" });
    const a = f.send("same"), b = f.send("same", "beta");
    expect(a.id).not.toBe(b.id);
    expect(f.send("same").duplicate).toBe(true);
    await f.notify.tick(at);
    expect(f.calls.map(call => call.target)).toEqual(["alpha.deliver", "alpha.deliver"]);
    f.directory.modules[0]!.status = "paused";
    const c = f.send("only-beta"); await f.notify.tick(at);
    expect(f.calls.at(-1)!.target).toBe("beta.deliver");
    expect(f.store.get("channel:alpha")).toBe(first);
    f.notify.result({ callId: f.calls.at(-1)!.callId, status: "succeeded", output: { outcome: "accepted", receiptRef: "beta-1" } }, at);
    expect(f.store.byId(c.id)!.status).toBe("sent");
    f.directory.modules[0]!.status = "active";
    f.send("alpha-resumed"); await f.notify.tick(at);
    expect(f.calls.at(-1)!.target).toBe("alpha.deliver");
    f.unavailable(true); const count = f.calls.length;
    f.send("while-directory-down");
    await expect(f.notify.tick(at)).rejects.toThrow("directory offline");
    expect(f.calls).toHaveLength(count); expect(f.store.get("channel:alpha")).toBe(first);
    f.unavailable(false);
    f.directory.modules[0]!.id = "alpha-reinstalled";
    await f.notify.refresh();
    expect(f.store.get("channel:alpha")).toBeNull();
    expect(f.store.get("channel:beta")).not.toBeNull();
    expect(f.register("alpha")).toMatchObject({ error: "forbidden" });
    await f.notify.tick(at);
    expect(f.calls.at(-1)!.target).toBe("beta.deliver");
  } finally { await f.close(); }
});

test.each(["tool description", "schema documentation"])("channel continues across a %s upgrade and ignores legacy stored hashes", async change => {
  const f = await fixture();
  try {
    f.register("alpha");
    const channel = JSON.parse(f.store.get("channel:alpha")!);
    expect(channel).not.toHaveProperty("contractHash");
    f.store.set("channel:alpha", JSON.stringify({ ...channel, contractHash: "old-contract" }));
    const callback = f.directory.tools[0]!;
    if (change === "tool description") Object.assign(callback, { description: "Updated delivery documentation" });
    else {
      callback.inputSchema = { ...callback.inputSchema, description: "Updated input documentation" };
      callback.outputSchema = { ...(callback.outputSchema as Record<string, unknown>), description: "Updated output documentation" };
    }
    Object.assign(callback, { hash: "upgraded-code", contractHash: "new-contract" });
    f.directory.modules[0]!.activeHash = "upgraded-code";
    const sent = f.send("after-upgrade"); await f.notify.tick(at);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.expectedTarget).toEqual({ moduleId: "alpha-id" });
    expect(JSON.parse(f.store.get(`attempt:${sent.id}:1`)!)).not.toHaveProperty("contractHash");
    f.notify.result({ callId: f.calls[0]!.callId, status: "succeeded", output: { outcome: "accepted", receiptRef: "upgraded" } }, at);
    expect(f.store.byId(sent.id)!.status).toBe("sent");
    f.restart(); await f.notify.refresh();
    expect(f.register("alpha", "alpha", "alpha-id", "upgraded-code")).toEqual({ ready: true });
    expect(JSON.parse(f.store.get("channel:alpha")!)).toEqual(channel);
  } finally { await f.close(); }
});

test.each(["unknown", "malformed", "enqueue-lost"])("%s is terminal uncertain across restart and late receipts never create a new attempt", async mode => {
  const f = await fixture();
  try {
    f.register("alpha"); if (mode === "enqueue-lost") f.loseReceipt();
    const sent = f.send("one"); await f.notify.tick(at);
    const call = f.calls[0]!;
    if (mode !== "enqueue-lost") f.notify.result({ callId: call.callId, status: mode === "unknown" ? "unknown" : "succeeded", output: { outcome: "rejected" }, error: "receipt lost" }, at);
    expect(f.store.byId(sent.id)!.status).toBe("uncertain");
    f.restart(); await f.notify.tick(new Date(at.getTime() + 86_400_000));
    expect(f.calls).toHaveLength(1);
    expect(f.notify.handle("retry", { id: sent.id }, { kind: "kernel" }, at)).toMatchObject({ error: "conflict" });
    f.notify.result({ callId: call.callId, status: "succeeded", output: { outcome: "accepted", receiptRef: "late" } }, at);
    expect(f.store.byId(sent.id)!.status).toBe("uncertain");
  } finally { await f.close(); }
});

test("interrupted attempt uses its persisted original target instead of changed channel registration", async () => {
  const f = await fixture();
  try {
    f.register("alpha"); const sent = f.send("interrupted"); await f.notify.tick(at);
    const row = f.store.byId(sent.id)!;
    // Crash after enqueue, before its acknowledgement was persisted.
    f.store.update(row.id, { call_id: null });
    const channel = JSON.parse(f.store.get("channel:alpha")!);
    const attemptKey = `attempt:${row.id}:1`;
    f.store.set(attemptKey, JSON.stringify({ ...JSON.parse(f.store.get(attemptKey)!), contractHash: "legacy-contract" }));
    f.store.set("channel:alpha", JSON.stringify({ ...channel, tool: "other", revision: "new" }));
    f.restart(); await f.notify.tick(new Date(at.getTime() + 61_000));
    expect(f.calls).toHaveLength(1); expect(f.calls[0]!.target).toBe("alpha.deliver");
    expect(f.store.byId(row.id)!.call_id).toBe(f.calls[0]!.callId);
    expect(JSON.parse(f.store.get(attemptKey)!)).toMatchObject({ moduleId: "alpha-id", tool: "deliver", revision: channel.revision });
    expect(f.calls[0]!.expectedTarget).toEqual({ moduleId: "alpha-id" });
  } finally { await f.close(); }
});

test("interrupted delivery cannot resume against a same-name reinstalled module", async () => {
  const f = await fixture();
  try {
    f.register("alpha"); const sent = f.send("before-reinstall"); await f.notify.tick(at);
    f.store.update(sent.id, { call_id: null });
    f.directory.modules[0]!.id = "alpha-reinstalled";
    f.directory.tools[0]!.moduleId = "alpha-reinstalled";
    f.restart(); await f.notify.tick(new Date(at.getTime() + 61_000));
    expect(f.calls).toHaveLength(1);
    expect(f.store.byId(sent.id)!.status).toBe("uncertain");
    expect(f.store.get("channel:alpha")).toBeNull();
    expect(f.register("alpha")).toMatchObject({ error: "forbidden" });
    expect(f.register("alpha", "alpha", "alpha-reinstalled")).toEqual({ ready: true });
    expect(f.store.byId(sent.id)!.status).toBe("uncertain");
  } finally { await f.close(); }
});

test.each(["input", "output", "missing"])("channel length, callback ownership and %s callback incompatibility fail closed", async change => {
  const f = await fixture();
  try {
    expect(f.register("alpha", "a".repeat(120))).toEqual({ ready: true });
    expect(f.register("alpha", "a".repeat(121))).toMatchObject({ error: "invalid" });
    expect(f.register("alpha", "bad/name")).toMatchObject({ error: "invalid" });
    expect(f.register("alpha", "valid", "alpha-id", "old-code")).toMatchObject({ error: "forbidden" });
    const original = structuredClone(f.directory.tools[0]!);
    f.directory.tools[0]!.inputSchema = { type: "object", properties: { key: { type: "integer" } } };
    expect(f.register("alpha", "broken")).toMatchObject({ error: "forbidden" });
    if (change === "output") {
      f.directory.tools[0]!.inputSchema = original.inputSchema;
      f.directory.tools[0]!.outputSchema = { type: "object", properties: { outcome: { const: "accepted" } }, required: ["outcome"] };
    } else if (change === "missing") f.directory.tools.splice(0, 1);
    f.send("invalid-callback"); await f.notify.tick(at);
    expect(f.calls).toHaveLength(0);
    expect(JSON.parse(f.store.get(`channel:${"a".repeat(120)}`)!)).toMatchObject({ invalid: true });
    if (change === "missing") f.directory.tools.unshift(original);
    else f.directory.tools[0] = original;
    f.send("rolled-back"); await f.notify.tick(at);
    expect(f.calls).toHaveLength(0);
    expect(f.register("alpha", "a".repeat(120))).toEqual({ ready: true });
    f.send("re-registered"); await f.notify.tick(at);
    expect(f.calls.at(-1)!.target).toBe("alpha.deliver");
  } finally { await f.close(); }
});
