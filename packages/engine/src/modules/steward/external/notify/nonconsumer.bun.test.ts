import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { openStore } from "./store";
import { createNotify, type Caller } from "./notify";
import { ingestKernelFacts, tickNotify } from "./facts";
import { testDirectory } from "./test-directory";

type Fact = { id: string; at: string; type: string; data: Record<string, unknown> };
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
const moduleCaller: Caller = { kind: "module", module: "source", moduleId: "source-id", hash: "h" };
const transport: Caller = { kind: "module", module: "transport", moduleId: "transport-id", hash: "h" };
const morning = new Date("2026-11-08T08:00:00Z"), noon = new Date("2026-11-08T12:00:00Z");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const denied = () => Object.assign(new Error("Only the selected application consumes kernel facts"), { code: "forbidden" });
function notice(key: string, level = "now"): Fact {
  return { id: `fact:${key}`, at: morning.toISOString(), type: "lifecycle", data: {
    key, module: "source-id", fact: { kind: level === "digest" ? "module-build-failed" : "module-paused", app: key },
  } };
}
async function fixture() {
  const dir = await mkdtemp("/tmp/chrona-notify-nonconsumer-"), store = openStore(dir);
  cleanups.push(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const calls: Record<string, unknown>[] = [], statuses: string[] = [];
  let rejectDigest = false, pendingDigest = false;
  let onDelivery: ((args: Record<string, unknown>) => Promise<void>) | null = null;
  const directory = testDirectory("transport");
  const ports = { store, publicUrl: null, listModules: async () => directory.modules, describeTools: async () => directory.tools,
    call: async (_target: string, args: Record<string, unknown>) => {
      calls.push(args);
      if (onDelivery) await onDelivery(args);
      if (pendingDigest && String(args.key).startsWith("digest:")) return { callId: `delivery-${calls.length}`, status: "running" };
      return { callId: `delivery-${calls.length}`, status: "succeeded", output: rejectDigest && String(args.key).startsWith("digest:")
        ? { outcome: "rejected", retryable: true, error: "temporarily unavailable" }
        : { outcome: "accepted", receiptRef: `receipt-${calls.length}` } };
    }, status: async (callId: string) => { statuses.push(callId); return { callId, status: "unknown", error: "receipt unknown" }; } };
  const create = () => createNotify(ports), notify = create();
  await notify.refresh();
  expect(notify.handle("channel", { channel: "transport", tool: "deliver", ready: true, at: morning.toISOString() }, transport, morning)).toEqual({ ready: true });
  store.set("settings", JSON.stringify({ dailyCap: 100, timezone: "UTC", digestAt: "09:00", quietHours: null }));
  const send = (key: string, level = "now", at = morning) => notify.handle("send", { key, title: key, body: `Body ${key}`, level, responds: level === "now" }, moduleCaller, at);
  return { store, notify, create, calls, statuses, send,
    rejectDigests(value: boolean) { rejectDigest = value; }, pendingDigests(value: boolean) { pendingDigest = value; },
    onDelivery(callback: (args: Record<string, unknown>) => Promise<void>) { onDelivery = callback; } };
}
function pageCall(facts: Fact[], withdrawn: string[] = []): Call {
  let pending = facts;
  return async (target, args) => {
    if (target === "activity.facts") return { revision: "selected", facts: pending };
    if (target === "activity.ack") { pending = []; return { acknowledged: args.ids }; }
    if (target === "activity.withdrawals") return { withdrawn: withdrawn.filter(key => (args.keys as string[]).includes(key)) };
    throw new Error(`Unexpected call ${target}`);
  };
}

test.each(["notify-id", "other-id", null])("ordinary deliveries continue with consumer %s; queued internal rows keep their source", async selection => {
  const f = await fixture();
  // Both the subject identity and key look like an ordinary module send. Neither establishes origin.
  const fact = notice("module:source-id:internal");
  expect(await ingestKernelFacts(f.store, f.notify, pageCall([fact]), morning)).toBe(true);
  f.send("ordinary");
  const reads: string[] = [];
  const call: Call = async (target, args) => {
    reads.push(target);
    if (selection !== "notify-id") throw denied();
    return pageCall([])(target, args);
  };
  await tickNotify(f.store, f.notify, call, noon);
  expect(f.store.byKey("module:source-id:ordinary")).toMatchObject({ status: "sent", attempts: 1 });
  expect(f.store.byKey(String(fact.data.key))).toMatchObject({ status: selection === "notify-id" ? "sent" : "queued", attempts: selection === "notify-id" ? 1 : 0 });
  expect(f.calls.map(call => call.key)).toContain("module:source-id:ordinary");
  expect(reads).toEqual(selection === "notify-id" ? ["activity.facts", "activity.withdrawals"] : ["activity.facts"]);
});

test("a nonconsumer composes an ordinary-only digest without attaching queued kernel sources", async () => {
  const f = await fixture();
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("internal-fold", "digest")]), morning);
  f.send("ordinary-fold", "digest");
  await tickNotify(f.store, f.notify, async () => { throw denied(); }, noon);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.body).toContain("ordinary-fold");
  expect(f.calls[0]!.body).not.toContain("internal-fold");
  expect(f.store.byKey("internal-fold")).toMatchObject({ status: "folded", digest_id: null, attempts: 0 });
  expect(f.store.byKey("module:source-id:ordinary-fold")!.digest_id).not.toBeNull();
});

test.each(["other-id", null])("switch to %s holds a queued mixed digest and kernel notice across restart; withdrawal rebuilds it before resuming", async selection => {
  const f = await fixture();
  f.rejectDigests(true);
  f.send("ordinary-fold", "digest");
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("internal-fold", "digest")]), morning);
  await tickNotify(f.store, f.notify, pageCall([]), noon);
  const digest = f.store.byKey("digest:2026-11-08")!;
  expect(digest).toMatchObject({ status: "queued", attempts: 1 });
  expect(digest.body).toContain("internal-fold");
  expect(digest.body).toContain("ordinary-fold");
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("internal-now")]), noon);
  f.rejectDigests(false);
  f.send("ordinary-now", "now", noon);
  const later = new Date(noon.getTime() + 120_000), restarted = f.create();
  await tickNotify(f.store, restarted, async target => {
    expect(target).toBe("activity.facts");
    expect(selection).not.toBe("notify-id");
    throw denied();
  }, later);
  expect(f.calls.map(call => call.key)).toEqual([digest.key, "module:source-id:ordinary-now"]);
  expect(f.store.byKey("internal-now")).toMatchObject({ status: "queued", attempts: 0 });
  expect(f.store.byId(digest.id)).toMatchObject({ status: "queued", attempts: 1 });
  // These withdrawals may already have been consumed by the other app. Reconciliation remains authoritative.
  await tickNotify(f.store, restarted, pageCall([], ["internal-fold", "internal-now"]), later);
  expect(f.calls).toHaveLength(3);
  expect(f.calls[2]!.key).toBe(digest.key);
  expect(f.calls[2]!.body).toContain("ordinary-fold");
  expect(f.calls[2]!.body).not.toContain("internal-fold");
  expect(f.store.byKey("internal-now")).toMatchObject({ status: "suppressed", attempts: 0 });
  expect(f.store.byId(digest.id)).toMatchObject({ status: "sent", attempts: 2 });
});

test.each([true, false])("lost ACK staging survives a nonconsumer pass; returning ACK ownership %s controls delivery", async accepted => {
  const f = await fixture(), fact = notice("staged");
  const lostAck: Call = async target => {
    if (target === "activity.facts") return { revision: "old", facts: [fact] };
    throw new Error("ACK reply lost");
  };
  f.send("ordinary");
  await expect(tickNotify(f.store, f.notify, lostAck, noon)).rejects.toThrow("ACK reply lost");
  expect(f.calls).toEqual([]);
  const staged = f.store.get("kernel-facts:staged");
  expect(staged).not.toBeNull();
  const restarted = f.create();
  await tickNotify(f.store, restarted, async () => { throw denied(); }, noon);
  expect(f.calls.map(call => call.key)).toEqual(["module:source-id:ordinary"]);
  expect(f.store.get("kernel-facts:staged")).toBe(staged);
  expect(f.store.byKey("staged")).toMatchObject({ status: "queued", attempts: 0 });
  const recovery: Call = async (target, args) => {
    if (target === "activity.facts") return { revision: "returned", facts: [] };
    if (target === "activity.ack") return { acknowledged: accepted ? args.ids : [] };
    if (target === "activity.withdrawals") return { withdrawn: [] };
    throw new Error(`Unexpected call ${target}`);
  };
  await tickNotify(f.store, restarted, recovery, noon);
  expect(f.store.get("kernel-facts:staged")).toBeNull();
  expect(f.store.byKey("staged")).toMatchObject({ status: accepted ? "sent" : "suppressed", attempts: accepted ? 1 : 0 });
  await tickNotify(f.store, restarted, recovery, noon);
  expect(f.calls).toHaveLength(accepted ? 2 : 1);
});

test.each(["read", "ack", "withdrawals"])("unexpected %s errors do not release kernel delivery", async boundary => {
  const f = await fixture();
  const fact = notice("internal");
  await ingestKernelFacts(f.store, f.notify, pageCall([fact]), morning);
  f.send("ordinary");
  const call: Call = async (target, args) => {
    if (target === "activity.facts") {
      if (boundary === "read") throw new Error("read offline");
      return { revision: "r", facts: boundary === "ack" ? [notice("new")] : [] };
    }
    if (target === "activity.ack") throw Object.assign(new Error("ack offline"), { code: "forbidden" });
    if (target === "activity.withdrawals") throw Object.assign(new Error("withdrawals offline"), { code: "forbidden" });
    throw new Error(`Unexpected call ${target}: ${JSON.stringify(args)}`);
  };
  await expect(tickNotify(f.store, f.notify, call, noon)).rejects.toThrow(`${boundary} offline`);
  expect(f.calls).toEqual([]);
  expect(f.store.byKey("internal")).toMatchObject({ status: "queued", attempts: 0 });
});

test("an incomplete backlog cannot starve ordinary sends behind fifty gated notices", async () => {
  const f = await fixture(); let page = 0;
  const call: Call = async (target, args) => {
    if (target === "activity.facts") return { revision: "r", facts: Array.from({ length: 6 }, (_, n) => notice(`internal-${page++}-${n}`)) };
    if (target === "activity.ack") return { acknowledged: args.ids };
    throw new Error(`Unexpected call ${target}`);
  };
  // The ordinary send is newer than every blocked internal row.
  f.send("ordinary", "now", noon);
  await tickNotify(f.store, f.notify, call, morning);
  // Not yet due at morning, then eligible without another backlog read.
  await tickNotify(f.store, f.notify, async () => { throw denied(); }, noon);
  expect(page).toBe(60);
  expect(f.calls.map(call => call.key)).toEqual(["module:source-id:ordinary"]);
  expect(f.store.rows("SELECT * FROM notifications WHERE key LIKE 'internal-%' AND attempts > 0")).toEqual([]);
});

test("nonconsumer recovery polls known receipts but cannot redispatch a kernel call without an enqueue receipt", async () => {
  const f = await fixture();
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("no-receipt"), notice("known-receipt")]), morning);
  f.send("ordinary");
  for (const [key, callId] of [["no-receipt", null], ["known-receipt", "known-call"]] as const) {
    f.store.update(f.store.byKey(key)!.id, { status: "sending", attempts: 1, call_at: morning.getTime(), call_id: callId });
  }
  await tickNotify(f.store, f.create(), async () => { throw denied(); }, noon);
  expect(f.statuses).toEqual(["known-call"]);
  expect(f.store.byKey("known-receipt")).toMatchObject({ status: "uncertain", attempts: 1 });
  expect(f.store.byKey("no-receipt")).toMatchObject({ status: "sending", attempts: 1, call_id: null });
  expect(f.calls.map(call => call.key)).toEqual(["module:source-id:ordinary"]);
});

test("withdrawing the only member suppresses its queued digest", async () => {
  const f = await fixture();
  f.rejectDigests(true);
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("only", "digest")]), morning);
  await tickNotify(f.store, f.notify, pageCall([]), noon);
  const digest = f.store.byKey("digest:2026-11-08")!;
  f.rejectDigests(false);
  await tickNotify(f.store, f.create(), pageCall([], ["only"]), new Date(noon.getTime() + 120_000));
  expect(f.store.byId(digest.id)).toMatchObject({ status: "suppressed", attempts: 1 });
  expect(f.calls).toHaveLength(1);
});

test("withdrawal during an in-flight mixed digest cannot relabel its saved body before confirmed rejection", async () => {
  const f = await fixture();
  f.pendingDigests(true);
  f.send("ordinary-fold", "digest");
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("internal-fold", "digest")]), morning);
  await tickNotify(f.store, f.notify, pageCall([]), noon);
  const digest = f.store.byKey("digest:2026-11-08")!;
  expect(digest).toMatchObject({ status: "sending", call_id: "delivery-1" });
  f.notify.handle("withdraw", { key: "internal-fold" }, { kind: "kernel" }, noon);
  expect(f.store.byId(digest.id)!.body).toContain("internal-fold");
  // Losing an enqueue receipt must not allow redispatch of the unchanged kernel body.
  f.store.update(digest.id, { call_id: null });
  await tickNotify(f.store, f.create(), async () => { throw denied(); }, new Date(noon.getTime() + 60_000));
  expect(f.calls).toHaveLength(1);
  f.store.update(digest.id, { call_id: "delivery-1" });
  f.notify.result({ callId: "delivery-1", status: "succeeded", output: { outcome: "rejected", retryable: true, error: "not sent" } }, noon);
  expect(f.store.byId(digest.id)).toMatchObject({ status: "queued", attempts: 1 });
  expect(f.store.byId(digest.id)!.body).not.toContain("internal-fold");
  f.pendingDigests(false);
  await tickNotify(f.store, f.create(), async () => { throw denied(); }, new Date(noon.getTime() + 120_000));
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1]!.body).toContain("ordinary-fold");
  expect(f.calls[1]!.body).not.toContain("internal-fold");
  expect(f.store.byId(digest.id)).toMatchObject({ status: "sent", attempts: 2 });
});

test.each([true, false])("withdrawal during an earlier delivery refreshes a later queued digest (mixed: %s)", async mixed => {
  const f = await fixture();
  f.send("earlier");
  if (mixed) f.send("ordinary-fold", "digest");
  await ingestKernelFacts(f.store, f.notify, pageCall([notice("internal-fold", "digest")]), morning);
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.onDelivery(async args => {
    if (args.key === "module:source-id:earlier") { started.resolve(); await release.promise; }
  });
  const pass = tickNotify(f.store, f.notify, pageCall([]), noon);
  await started.promise;
  f.notify.handle("withdraw", { key: "internal-fold" }, { kind: "kernel" }, noon);
  const digest = f.store.byKey("digest:2026-11-08")!;
  expect(digest.status).toBe(mixed ? "queued" : "suppressed");
  release.resolve();
  await pass;
  expect(f.calls).toHaveLength(mixed ? 2 : 1);
  if (mixed) {
    expect(f.calls[1]!.body).toContain("ordinary-fold");
    expect(f.calls[1]!.body).not.toContain("internal-fold");
  }
  expect(f.store.byId(digest.id)).toMatchObject({ status: mixed ? "sent" : "suppressed", attempts: mixed ? 1 : 0 });
});
