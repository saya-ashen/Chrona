import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile, stat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindStore, STATE_FILE } from "./store";
import { MindService } from "./service";
import { MindRuntime, REASONING_TOOLS } from "./runtime";
import { currentSignal, DAY, deferToDaily, selectWork } from "./policy";
import { inputs, outputs, freshState } from "./schema";
import { buildManifest } from "./manifest";
import { agendaPage, decisionsPage, encodedBytes, RESPONSE_BYTES } from "./responses";
import type { Caller, Call, Decision, ReportResult } from "./types";

const now = "2026-11-09T12:00:00.000Z";
const later = (ms: number) => new Date(Date.parse(now) + ms).toISOString();
const owner: Caller = { kind: "owner", via: "test" };
const source: Caller = { kind: "module", module: "calendar", moduleId: "calendar-id", hash: "test-hash" };
const mind: Caller = { kind: "module", module: "mind", moduleId: "mind-id", hash: "test-hash" };
const rule = { source: "calendar", moduleId: "calendar-id", event: "changed", ref: "order-7", thread: "thread-1", from: "person-4", domain: "example.test", textAll: ["approved", "signed"] };
const observation = { "request-key": "signal-1", "event-id": "event-1", event: "changed", ref: "order-7", version: "v1", thread: "thread-1", from: "person-4", domain: "example.test", text: "approved and signed", "occurred-at": now, "progress-at": now };
const dimensions = { newEvidence: false, progress: false, internal: false, redundant: false, unavailable: false, userVisible: false };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chrona-mind-offline-"));
  const store = new MindStore(directory), service = new MindService(store);
  const tool = async (name: keyof typeof inputs, args: unknown, caller: Caller = owner, at = now) => outputs[name].parse(await service.tool(name, args, caller, at));
  const note = async (args: Record<string, unknown> = {}) => outputs.note.parse(await service.tool("note", { "request-key": "note-1", title: "Contract", awaiting: JSON.stringify([rule]), ...args }, owner, now)).concern;
  const signal = async (args: Record<string, unknown> = {}, caller: Caller = source) => outputs.signal.parse(await service.tool("signal", { ...observation, ...args }, caller, now));
  return { directory, store, service, tool, note, signal, close: () => rm(directory, { recursive: true, force: true }) };
}
function resultFor(decision: Decision, patch: Partial<ReportResult> = {}): ReportResult {
  return { summary: "Checked the supplied source observation.", concerns: decision.concernIds.map(id => ({ id, revision: decision.revisions[id]!, conclusion: "Evidence checked; owner review remains required.", signalIds: decision.signalIds })), feedback: { ...dimensions, newEvidence: true, progress: true }, ...patch };
}
async function candidate(f: Awaited<ReturnType<typeof fixture>>, patch: Partial<ReportResult> = {}, caller = mind) {
  const state = await f.store.read(), decision = state.decisions.find(d => d.id === state.runtime.currentDecisionId)!;
  const receipt = outputs.report.parse(await f.service.tool("report", { "request-key": `${decision.id}:report`, "decision-id": decision.id, result: JSON.stringify(resultFor(decision, patch)) }, caller, now));
  return { decision, receipt };
}
function agent(f: Awaited<ReturnType<typeof fixture>>) {
  let status = "running", active = true, interactions: unknown[] = [];
  const items: { sequence: number; kind: string; payload: unknown }[] = [];
  let loseRun = false, loseNotify = false;
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const runs = new Map<string, string>();
  // eslint-disable-next-line complexity -- Offline Agent fixture keeps each injected lost-response boundary explicit.
  const call: Call = async (target, args, options) => {
    calls.push({ target, args });
    const state = await f.store.read(), current = state.decisions.find(d => d.id === state.runtime.currentDecisionId);
    if (target === "agent.run") {
      assert.equal(options?.key, current?.runKey, "run key must already be durable");
      assert.deepEqual(args.tools, REASONING_TOOLS);
      assert.equal(args.prompt, current?.prompt);
      const key = String(options?.key); if (!runs.has(key)) runs.set(key, "run-1");
      if (loseRun) { loseRun = false; throw new Error("run reply lost"); }
      return { contextId: "context-1", runId: runs.get(key), status, active };
    }
    if (target === "agent.read") {
      assert.equal(args.runId, current?.runId);
      const offset = args.cursor ? Number(String(args.cursor).slice("events:".length)) : 0;
      return { run: { contextId: "context-1", runId: "run-1", status, active }, items: items.filter(item => item.sequence > offset), nextCursor: items.length ? `events:${items.at(-1)!.sequence}` : null, ended: !active, interactions };
    }
    if (target === "notify.send") {
      assert.ok(state.decisions.some(d => d.notification !== null && d.notification.key === args.key && d.notification.status === "unknown"), "notification uncertainty must be durable before effect");
      if (loseNotify) throw new Error("notify reply lost");
      return { id: "notify-1", status: "queued", duplicate: false };
    }
    throw new Error(`Unexpected effect: ${target}`);
  };
  return {
    call, calls, runs,
    loseRun: () => { loseRun = true; }, loseNotify: () => { loseNotify = true; },
    finish: (value = "finished") => { status = value; active = false; }, unknown: () => { status = "unknown"; active = true; },
    text: (text: string) => { items.push({ sequence: (items.at(-1)?.sequence ?? 0) + 1, kind: "progress", payload: { text } }); },
    verify: (receipt: unknown, error = false) => { items.push({ sequence: (items.at(-1)?.sequence ?? 0) + 1, kind: "tool-result", payload: { type: "tool-result", value: { runId: "run-1", callId: "call-1", target: "mind.report", moduleId: "mind-test", hash: "mind-test-hash", status: error ? "failed" : "succeeded", outputState: "complete", output: receipt } } }); },
    wait: () => { interactions = [{ id: "question-1", status: "pending", expiresAt: later(60_000), question: { title: "Please sign in", message: "Source access needs your action." } }]; },
  };
}
const checks: { name: string; run(): Promise<void> }[] = [];
function check(name: string, run: () => Promise<void>) { checks.push({ name, run }); }

check("serialized private durable state, idempotent replay and conflicting keys", async () => {
  const f = await fixture();
  try {
    const same = { "request-key": "same", title: "First" };
    const results = await Promise.all(Array.from({ length: 8 }, () => f.tool("note", same)));
    assert.equal(new Set(results.map(item => JSON.stringify(item))).size, 1);
    await Promise.all(Array.from({ length: 12 }, (_, n) => f.note({ "request-key": `parallel-${n}`, title: `Concern ${n}` })));
    assert.equal((await f.store.read()).concerns.length, 13);
    assert.equal((await stat(join(f.directory, STATE_FILE))).mode & 0o777, 0o600);
    const restarted = new MindService(new MindStore(f.directory));
    assert.deepEqual(await restarted.tool("note", same, owner, now), results[0]);
    await assert.rejects(() => restarted.tool("note", { ...same, title: "Conflict" }, owner, now), /different input/);
    assert.equal((await f.store.read()).concerns.length, 13);
  } finally { await f.close(); }
});
check("corrupt, unknown-schema, nonprivate, legacy state fail closed without effects", async () => {
  for (const bytes of ["{broken", JSON.stringify({ ...freshState(), schema: 2 }), JSON.stringify({ ...freshState(), injected: true })]) {
    const f = await fixture();
    try {
      await writeFile(join(f.directory, STATE_FILE), bytes, { mode: 0o600 });
      let effects = 0;
      const runtime = new MindRuntime(f.store, async () => { effects++; return {}; });
      await assert.rejects(() => runtime.tick(now, true), /refusing to reset/);
      assert.equal(await readFile(join(f.directory, STATE_FILE), "utf8"), bytes);
      assert.equal(effects, 0);
    } finally { await f.close(); }
  }
  const f = await fixture();
  try {
    await f.store.read(); await chmod(join(f.directory, STATE_FILE), 0o644);
    await assert.rejects(() => f.note(), /refusing to reset/);
    await rm(join(f.directory, STATE_FILE));
    await writeFile(join(f.directory, "agenda.json"), "[]");
    await assert.rejects(() => f.store.read(), /fresh private data/);
  } finally { await f.close(); }
});
check("exact source identities, AND conditions, multiple unique associations, event dedupe", async () => {
  const f = await fixture();
  try {
    const first = await f.note(), second = await f.note({ "request-key": "note-2", title: "Also this contract" });
    const variants = [{ event: "mentioned" }, { event: "changed " }, { ref: "order-70" }, { ref: "order-7 " }, { thread: "thread-2" }, { from: "person-5" }, { domain: "elsewhere.test" }, { text: "approved only" }, { text: "signed only" }];
    for (let n = 0; n < variants.length; n++) assert.deepEqual((await f.signal({ "request-key": `miss-${n}`, "event-id": `miss-${n}`, ...variants[n] })).associations, []);
    assert.deepEqual((await f.signal({ "request-key": "other-id", "event-id": "other-id" }, { ...source, moduleId: "other-id" } as Caller)).associations, []);
    assert.deepEqual((await f.signal({ "request-key": "other-name", "event-id": "other-name" }, { ...source, module: "other" } as Caller)).associations, []);
    const hit = await f.signal();
    assert.deepEqual(hit.associations.sort(), [first.id, second.id].sort());
    const duplicate = await f.signal({ "request-key": "different-receipt" });
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.signalId, hit.signalId);
    await assert.rejects(() => f.signal({ "request-key": "changed-version", version: "v2" }), /event-id was reused/);
    await assert.rejects(() => f.signal({ source: "owner", "request-key": "forged" }), /Unrecognized key/);
    await assert.rejects(() => f.signal({}, owner), /authenticated module/);
    await assert.rejects(() => f.signal({ "event-id": "future", "request-key": "future", "occurred-at": later(DAY) }), /future/);
    assert.deepEqual((await f.signal({ "event-id": "stale", "request-key": "stale", "occurred-at": later(-8 * DAY), "progress-at": later(-8 * DAY) })).associations, []);
    const state = await f.store.read();
    assert.ok(state.concerns.every(c => c.status === "watching" && c.progressAt === null && c.lastCheckedAt === null));
    await f.note({ "request-key": "new-rule", id: first.id, goal: "Modified" });
    assert.equal((await f.store.read()).signals.find(s => s.id === hit.signalId)!.associations.filter(id => id === first.id).length, 1);
  } finally { await f.close(); }
});
check("real caller authorization, projects, stop, due, progress and suggestions without activation", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.tool("note", { "request-key": "bad", title: "bad" }, source), /real owner/);
    await assert.rejects(() => f.tool("agenda", {}, source), /private/);
    await assert.rejects(() => f.tool("ui-settings", { enabled: true }, source), /real owner/);
    await assert.rejects(() => f.tool("check", {}, { kind: "kernel" }), /real owner/);
    const c = await f.note({ project: "Application", "due-at": later(3_600_000), "expected-progress-at": later(-1000) });
    let state = await f.store.read(); state.runtime.lastDailyDate = "2026-11-09";
    assert.equal(selectWork(state, Date.parse(now), false)?.kind, "deadline");
    const proposal = outputs.propose.parse(await f.tool("propose", { "request-key": "suggest", title: "Review a new input", reason: "Unknown source evidence" }, source)).proposal;
    assert.equal((await f.store.read()).concerns.length, 1);
    assert.equal((await f.store.read()).settings.enabled, false);
    await f.note({ "request-key": "accept", "proposal-id": proposal.id, title: "Accepted by owner" });
    assert.equal((await f.store.read()).proposals[0]!.status, "accepted");
    await f.note({ "request-key": "stop", id: c.id, status: "dropped" });
    state = await f.store.read(); state.runtime.lastDailyDate = "2026-11-09";
    assert.ok(!selectWork(state, Date.parse(now), true)?.concerns.some(item => item.id === c.id));
    await assert.rejects(() => f.note({ "request-key": "forever", "silent-until": later(31 * DAY) }), /30 days/);
    await assert.rejects(() => f.note({ "request-key": "future-progress", "progress-at": later(DAY) }), /already/);
    assert.equal(state.concerns[0]!.project, "Application");
  } finally { await f.close(); }
});
check("owner routes admit only the internal entry flag and preserve actual caller receipt scope", async () => {
  const f = await fixture();
  const web: Caller = { kind: "module", module: "web", moduleId: "web-id", hash: "approved-web" };
  try {
    const args = { "request-key": "owner-route", title: "Owner's concern" };
    await assert.rejects(() => f.service.tool("note", args, web, now), /real owner/);
    const first = outputs.note.parse(await f.service.tool("note", args, web, now, true));
    assert.deepEqual(await f.service.tool("note", args, web, now, true), first);
    await f.service.tool("note", args, owner, now);
    const state = await f.store.read();
    assert.equal(state.concerns.length, 2);
    assert.deepEqual(state.receipts.map(r => r.scope).sort(), ["module:web-id:note", "owner:note"]);
    await assert.rejects(() => f.service.tool("ui-agenda", {}, web, now), /real owner/);
    assert.equal(outputs["ui-agenda"].parse(await f.service.tool("ui-agenda", {}, web, now, true)).total, 2);
    await assert.rejects(() => f.service.tool("agenda", {}, web, now, true), /private/);
    assert.equal(outputs.decisions.parse(await f.service.tool("decisions", {}, web, now, true)).total, 0);
    await f.service.tool("ui-settings", { "daily-wakes": "7" }, web, now, true);
    assert.equal((await f.store.read()).settings.dailyWakes, 7);
    const proposed = outputs.propose.parse(await f.tool("propose", { "request-key": "suggest-to-dismiss", title: "Suggestion", reason: "Owner review" }, source));
    await assert.rejects(() => f.service.tool("ui-dismiss", { "request-key": "dismiss", id: proposed.proposal.id }, web, now), /real owner/);
    const dismissed = outputs["ui-dismiss"].parse(await f.service.tool("ui-dismiss", { "request-key": "dismiss", id: proposed.proposal.id }, web, now, true));
    assert.equal(dismissed.proposal.status, "dismissed");
    assert.deepEqual(await f.service.tool("ui-dismiss", { "request-key": "dismiss", id: proposed.proposal.id }, web, now, true), dismissed);
    await assert.rejects(() => f.service.tool("ui-dismiss", { "request-key": "bad-dismiss", id: proposed.proposal.id, action: "dismiss" }, web, now, true), /Unrecognized key/);
    await assert.rejects(() => f.service.tool("propose", { "request-key": "spoof-dismiss", id: proposed.proposal.id, action: "dismiss" }, source, now, true), /Unrecognized key/);
  } finally { await f.close(); }
});
check("Unicode agenda and decision pages bound the complete encoded result and expose every row", async () => {
  const f = await fixture();
  try {
    const concern = await f.note({ goal: "关".repeat(1200) });
    const state = await f.store.read();
    state.concerns = Array.from({ length: 200 }, (_, n) => ({ ...concern, id: `c-${n}`, links: Array.from({ length: 6 }, () => ({ source: "calendar", moduleId: "calendar-id", ref: "ref", version: "v1", checkedAt: now, conclusion: "证".repeat(1200) })) }));
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = outputs.agenda.parse(agendaPage(state, { cursor, limit: 100 }, now));
      assert.ok(encodedBytes(page) <= RESPONSE_BYTES);
      assert.equal(page.total, 200);
      assert.equal(page.limited, page.nextCursor !== null);
      ids.push(...page.concerns.map(c => c.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(ids, state.concerns.map(c => c.id));
    const decision: Decision = { id: "d-0", at: now, kind: "manual", concernIds: [], signalIds: [], revisions: {}, sourceKinds: [], phase: "failed", runKey: "d-0:run", contextId: null, runId: null, prompt: "private launch material", tools: [...REASONING_TOOLS], report: null, finishedAt: now, error: null, interactions: [{ id: "q-1", title: "Input", message: "问".repeat(2000), expiresAt: later(60_000) }], notification: null };
    state.decisions = Array.from({ length: 100 }, (_, n) => ({ ...decision, id: `d-${n}` }));
    const historyIds: string[] = [];
    do {
      const page = outputs.decisions.parse(decisionsPage(state, { cursor, limit: 100 }));
      assert.ok(encodedBytes(page) <= RESPONSE_BYTES);
      assert.equal(page.total, 100);
      assert.ok(!JSON.stringify(page).includes("private launch material"));
      historyIds.push(...page.decisions.map(d => d.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(historyIds, [...state.decisions].reverse().map(d => d.id));
    assert.throws(() => agendaPage(state, { cursor: `agenda:${state.revision + 1}:1` }, now), /Records changed/);
    assert.throws(() => decisionsPage(state, { cursor: "agenda:0:1" }), /Invalid page cursor/);
  } finally { await f.close(); }
});
check("lost run replies recover by the same key; unknown and waiting occupy one slot", async () => {
  const f = await fixture();
  try {
    await f.note(); const a = agent(f); a.loseRun();
    await new MindRuntime(f.store, a.call).tick(now); assert.equal(a.calls.length, 0, "disabled background cannot start work");
    await new MindRuntime(f.store, a.call).tick(now, true);
    assert.equal((await f.store.read()).decisions[0]!.phase, "unknown");
    a.unknown(); await new MindRuntime(f.store, a.call).tick(later(2000), true);
    assert.equal((await f.store.read()).decisions.length, 1); assert.equal(a.runs.size, 1);
    const starts = a.calls.filter(c => c.target === "agent.run");
    assert.equal(starts.length, 2); assert.deepEqual(starts[0]!.args, starts[1]!.args);
    assert.equal(starts[0]!.args.lane, "foreground");
    await new MindRuntime(f.store, a.call).tick(later(DAY), true);
    assert.equal(a.calls.filter(c => c.target === "agent.run").length, 2);
    // A known active run can expose an interaction without being restarted or answered.
    const waitingCall: Call = async (target, args, opts) => target === "agent.read" ? { ...(await a.call(target, args, opts) as Record<string, unknown>), run: { contextId: "context-1", runId: "run-1", active: true, status: "running" }, ended: false } : a.call(target, args, opts);
    a.wait(); const view = await new MindRuntime(f.store, waitingCall).tick(later(DAY + 1000));
    assert.equal(view.runtime.phase, "waiting"); assert.equal(view.runtime.interactions[0]!.title, "Please sign in");
    assert.ok(!a.calls.some(c => c.target === "agent.write"));
  } finally { await f.close(); }
});
check("model text, owner spoofing and failed tool results cannot establish a trustworthy report", async () => {
  for (const mode of ["text", "error", "wrong-receipt", "failed-run"] as const) {
    const f = await fixture();
    try {
      await f.note(); await f.signal(); const a = agent(f), runtime = new MindRuntime(f.store, a.call);
      await runtime.tick(now, true);
      await assert.rejects(() => candidate(f, {}, owner), /cannot forge/);
      await assert.rejects(() => candidate(f, {}, source), /Only the current/);
      const { receipt } = await candidate(f);
      if (mode === "text") a.text(JSON.stringify(receipt));
      else a.verify(mode === "wrong-receipt" ? { ...receipt, reportId: "f".repeat(64) } : receipt, mode === "error");
      a.finish(mode === "failed-run" ? "failed" : "finished");
      await runtime.tick(later(1000));
      const state = await f.store.read();
      assert.equal(state.feedback.length, 0); assert.equal(state.concerns[0]!.progressAt, null);
      assert.ok(["unreported", "failed"].includes(state.decisions[0]!.phase));
    } finally { await f.close(); }
  }
});
check("successful current-run report applies once, preserves status and authentic source progress", async () => {
  const f = await fixture();
  try {
    await f.note(); const event = await f.signal(); const a = agent(f), runtime = new MindRuntime(f.store, a.call);
    await runtime.tick(now, true); const { receipt } = await candidate(f); a.verify(receipt);
    await runtime.tick(later(500));
    assert.equal((await f.store.read()).feedback.length, 0, "active is not final");
    a.finish(); a.text("The model says everything is complete");
    await new MindRuntime(f.store, a.call).tick(later(1000));
    let state = await f.store.read();
    assert.equal(state.decisions[0]!.phase, "completed"); assert.equal(state.feedback.length, 1);
    assert.equal(state.concerns[0]!.status, "watching"); assert.equal(state.concerns[0]!.progressAt, now);
    assert.equal(state.concerns[0]!.links[0]!.version, "v1"); assert.deepEqual(state.signals.find(s => s.id === event.signalId)!.reviewed, [state.concerns[0]!.id]);
    await runtime.tick(later(2000)); state = await f.store.read(); assert.equal(state.feedback.length, 1);
    assert.equal(a.calls.filter(c => c.target === "notify.send").length, 0);
  } finally { await f.close(); }
});
check("overlapping final polls finalize once and never rearm an uncertain notification", async () => {
  const f = await fixture();
  try {
    await f.note(); await f.signal(); await f.tool("ui-settings", { "notify-enabled": true });
    const a = agent(f); await new MindRuntime(f.store, a.call).tick(now, true);
    const { receipt } = await candidate(f, { feedback: { ...dimensions, newEvidence: true, userVisible: true } });
    a.verify(receipt); a.finish(); a.loseNotify();
    let arrivals = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const interleaved: Call = async (target, args, options) => {
      if (target === "agent.read") { arrivals++; if (arrivals === 2) release(); await barrier; }
      return a.call(target, args, options);
    };
    await Promise.all([new MindRuntime(f.store, interleaved).tick(later(1000)), new MindRuntime(f.store, interleaved).tick(later(2000))]);
    const state = await f.store.read(); assert.equal(state.feedback.length, 1);
    assert.equal(state.decisions[0]!.finishedAt, later(1000)); assert.equal(state.decisions[0]!.notification!.status, "unknown");
    await new MindRuntime(f.store, a.call).tick(later(3000));
    assert.equal(a.calls.filter(call => call.target === "notify.send").length, 1);
  } finally { await f.close(); }
});
check("concurrent owner edits and newer source versions invalidate stale progress applications", async () => {
  const f = await fixture();
  try {
    const concern = await f.note(); await f.signal(); const a = agent(f), runtime = new MindRuntime(f.store, a.call);
    await runtime.tick(now, true); const { receipt } = await candidate(f); a.verify(receipt);
    await f.note({ id: concern.id, "request-key": "owner-stopped", status: "done" });
    // Newer observation makes v1 stale even though both are within the freshness window.
    await f.service.tool("signal", { ...observation, "request-key": "v2", "event-id": "v2", version: "v2", "occurred-at": later(100), "progress-at": undefined }, source, later(100));
    a.finish(); await runtime.tick(later(1000));
    const state = await f.store.read(); assert.equal(state.concerns[0]!.status, "done"); assert.equal(state.concerns[0]!.lastCheckedAt, null);
    assert.equal(currentSignal(state, state.signals[0]!, Date.parse(later(1000))), false);
  } finally { await f.close(); }
});
check("owner changes retract obsolete associations; tied versions and unrelated senders stay precise", async () => {
  const f = await fixture();
  try {
    const concern = await f.note(); const first = await f.signal();
    await f.signal({ "request-key": "unrelated-sender", "event-id": "unrelated-sender", from: "another-person" });
    let state = await f.store.read(); assert.equal(currentSignal(state, state.signals.find(s => s.id === first.signalId)!, Date.parse(now)), true);
    const second = await f.signal({ "request-key": "same-time-v2", "event-id": "same-time-v2", version: "v2", "occurred-at": "2026-11-09T13:00:00.000+01:00" });
    state = await f.store.read(); assert.equal(currentSignal(state, state.signals.find(s => s.id === first.signalId)!, Date.parse(now)), false);
    assert.equal(currentSignal(state, state.signals.find(s => s.id === second.signalId)!, Date.parse(now)), true);
    await f.note({ id: concern.id, "request-key": "changed-awaiting", awaiting: JSON.stringify([{ ...rule, ref: "different-order" }]) });
    state = await f.store.read(); assert.ok(state.signals.every(s => !s.associations.includes(concern.id)));
    state.runtime.lastDailyDate = "2026-11-09";
    assert.equal(selectWork(state, Date.parse(now), false), null, "old associations must not route the edited concern");
  } finally { await f.close(); }
});
check("uncited observations cannot become negative feedback and unavailable daily inputs remain pending", async () => {
  for (const unavailable of [false, true]) {
    const f = await fixture();
    try {
      await f.note(); await f.signal(); const a = agent(f), runtime = new MindRuntime(f.store, a.call);
      await runtime.tick(now, true);
      const { receipt } = await candidate(f, { concerns: [], feedback: { ...dimensions, redundant: true, unavailable } });
      a.verify(receipt); a.finish(); await runtime.tick(later(1000));
      const state = await f.store.read();
      assert.equal(state.feedback[0]!.dimensions.unavailable, true); assert.equal(state.feedback[0]!.dimensions.redundant, false);
      if (unavailable) assert.equal(state.signals[0]!.dailyReviewedAt, null);
      assert.equal(state.concerns[0]!.progressAt, null);
    } finally { await f.close(); }
  }
});
check("rolling feedback minimum and decay can defer low priority only to daily review", async () => {
  const f = await fixture();
  try {
    const concern = await f.note({ priority: "low", "user-explicit": false }); await f.signal();
    const state = await f.store.read(), args = { source: "calendar-id", kind: "event", now: Date.parse(now) };
    state.runtime.lastDailyDate = "2026-11-09";
    const add = (n: number, unavailable = false, at = now) => state.feedback.push({ decisionId: `sample-${n}`, source: args.source, kind: args.kind, at, dimensions: { ...dimensions, redundant: true, unavailable } });
    for (let i = 0; i < 4; i++) add(i);
    assert.equal(deferToDaily(state, concern, args), false);
    add(4); assert.equal(deferToDaily(state, concern, args), true);
    assert.equal(selectWork(state, Date.parse(now), false), null);
    state.runtime.lastDailyDate = "2026-11-08";
    assert.equal(selectWork(state, Date.parse(now), false)?.kind, "daily");
    for (const override of [{ priority: "critical" }, { userExplicit: true }, { dueAt: later(DAY) }] as const) assert.equal(deferToDaily(state, { ...concern, ...override }, args), false);
    state.feedback = []; for (let i = 0; i < 7; i++) add(i, true); assert.equal(deferToDaily(state, concern, args), false);
    state.feedback = []; for (let i = 0; i < 5; i++) add(i, false, later(-29 * DAY)); assert.equal(deferToDaily(state, concern, args), false);
  } finally { await f.close(); }
});
check("daily unmatched suggestion path, missed review coalescing, interval and wake budget", async () => {
  const f = await fixture();
  try {
    await f.signal({ ref: "unmatched" }); await f.tool("ui-settings", { enabled: true, "daily-wakes": 1 });
    const a = agent(f), runtime = new MindRuntime(f.store, a.call);
    await runtime.tick(now);
    const state = await f.store.read(), d = state.decisions[0]!;
    assert.equal(d.kind, "daily"); assert.equal(d.concernIds.length, 0); assert.equal(d.signalIds.length, 1);
    assert.equal(a.calls.find(c => c.target === "agent.run")!.args.lane, "background");
    assert.ok(d.prompt.includes("mind.propose")); assert.equal(state.concerns.length, 0);
    a.finish(); await runtime.tick(later(1000));
    await runtime.tick(later(60_000)); await runtime.tick(later(60 * 60_000));
    assert.equal((await f.store.read()).decisions.length, 1);
    await new MindRuntime(f.store, a.call).tick(later(3 * DAY));
    assert.equal((await f.store.read()).decisions.length, 2, "several missed days produce one current review");
    assert.equal((await f.store.read()).runtime.lastDailyDate, "2026-11-12");
  } finally { await f.close(); }
});
check("optional notification is bounded and unknown send never repeats across restart", async () => {
  const f = await fixture();
  try {
    await f.note(); await f.signal(); await f.tool("ui-settings", { "notify-enabled": true });
    const a = agent(f), runtime = new MindRuntime(f.store, a.call); a.loseNotify();
    await runtime.tick(now, true); const { receipt } = await candidate(f, { feedback: { ...dimensions, newEvidence: true, userVisible: true } }); a.verify(receipt); a.finish();
    await runtime.tick(later(1000)); assert.equal((await f.store.read()).decisions[0]!.notification!.status, "unknown");
    await new MindRuntime(f.store, a.call).tick(later(2000));
    const sends = a.calls.filter(c => c.target === "notify.send"); assert.equal(sends.length, 1); assert.ok(String(sends[0]!.args.body).length <= 800);
  } finally { await f.close(); }
});
check("manifest is generated from local structs, narrow and free of obsolete coupling", async () => {
  const manifest = buildManifest();
  assert.deepEqual(manifest.effects, []); assert.equal(manifest.keepAlive, true); assert.equal(manifest.activated, true);
  assert.ok(manifest.uses.every(target => !target.includes("*") && !/health|schedules|build|complete|events/.test(target)));
  assert.ok(manifest.tools.every(tool => !("additionalProperties" in tool.parameters)));
  assert.ok(manifest.tools.every(tool => JSON.stringify(tool.output).length <= 8000));
  assert.ok(!inputs.signal.safeParse({ ...observation, "module-id": "forged" }).success);
});
export async function runOfflineChecks() {
  for (const item of checks) { await item.run(); console.log(`PASS mind: ${item.name}`); }
  return checks.length;
}
