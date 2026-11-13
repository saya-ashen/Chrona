import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindStore, digest } from "./store";
import { MindService } from "./service";
import { MindRuntime, REASONING_TOOLS } from "./runtime";
import { DAY, selectWork } from "./policy";
import { freshState, stateSchema } from "./schema";
import { addReportCandidate, selectRunReport } from "./report-candidates";
import { archiveSignals, archivedSignal, MAX_STATE_BYTES } from "./retention";
import type { Call, Caller, Decision, ReportResult, Signal } from "./types";

const NOW = "2026-11-09T12:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString();
const owner: Caller = { kind: "owner", via: "followup-test" };
const mind: Caller = { kind: "module", module: "mind", moduleId: "mind-test", hash: "mind-test-hash" };
const source: Caller = { kind: "module", module: "calendar", moduleId: "source-test", hash: "source-test-hash" };
const rule = { source: "calendar", moduleId: source.moduleId, event: "changed", ref: "ref-1", thread: "", from: "", domain: "", textAll: [] };
const feedback = { newEvidence: true, progress: false, internal: false, redundant: false, unavailable: true, userVisible: false };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-mind-followup-")); roots.push(root);
  const store = new MindStore(root), service = new MindService(store);
  return { root, store, service };
}
function decision(id = "decision-1"): Decision {
  return { id, at: NOW, kind: "review", concernIds: [], signalIds: [], revisions: {}, sourceKinds: [], phase: "unknown", runKey: `${id}:run`, contextId: "context-1", runId: "run-1", prompt: "Uncompacted active evidence", tools: [...REASONING_TOOLS], report: null, finishedAt: null, error: null, interactions: [], notification: null };
}
function result(row: Decision): ReportResult {
  return { summary: "Evidence unavailable", concerns: row.concernIds.map(id => ({ id, revision: row.revisions[id]!, conclusion: "Try the source again later", signalIds: row.signalIds })), feedback: { ...feedback } };
}
function receipt(row: Decision, reportId: string) { return { accepted: true, reportId, decisionId: row.id, pendingVerification: true }; }
function transcript(value: unknown, patch: Record<string, unknown> = {}) {
  return { sequence: 1, kind: "tool-result", payload: { type: "tool-result", value: { runId: "run-1", callId: "call-1", target: "mind.report", moduleId: "mind-test", hash: "mind-test-hash", status: "succeeded", outputState: "complete", output: value, ...patch } } };
}

// The external Agent is the only fake: all receipts, report staging and settlement use the real private store.
function agent(f: Awaited<ReturnType<typeof fixture>>) {
  let active = true, output: ReturnType<typeof transcript>[] = [];
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const call: Call = async (target, args) => {
    calls.push({ target, args });
    const state = await f.store.read(), row = state.decisions.find(d => d.id === state.runtime.currentDecisionId)!;
    if (!row) throw new Error("No durable current decision");
    const identity = { contextId: `context-${row.id}`, runId: `run-${row.id}`, active, status: active ? "running" : "finished" };
    if (target === "agent.run") return identity;
    if (target === "agent.read") {
      expect(args.runId).toBe(row.runId);
      return { items: (args.cursor ? [] : output).map(item => ({ ...item, payload: { ...item.payload, value: { ...item.payload.value, runId: row.runId } } })), run: identity, nextCursor: output.length ? "receipt-cursor" : null, ended: !active, interactions: [] };
    }
    throw new Error(`Unexpected effect ${target}`);
  };
  return { call, calls, finish(value: unknown) { active = false; output = [transcript(value)]; }, restart() { active = true; output = []; } };
}
async function unavailable(f: Awaited<ReturnType<typeof fixture>>, a: ReturnType<typeof agent>, now: string) {
  const state = await f.store.read(), row = state.decisions.find(d => d.id === state.runtime.currentDecisionId)!;
  const accepted = await f.service.tool("report", { "request-key": `${row.id}:report`, "decision-id": row.id, result: JSON.stringify(result(row)) }, mind, now);
  a.finish(accepted);
  await new MindRuntime(new MindStore(f.root), a.call).tick(now);
  return (await f.store.read()).decisions.find(d => d.id === row.id)!;
}

test("omitted candidate and tombstone fields default without rejecting seeded decision literals", () => {
  const state = freshState(), row = decision();
  delete state.signalTombstones;
  state.decisions.push(row); state.runtime.currentDecisionId = row.id;
  const parsed = stateSchema.parse(state);
  expect(parsed.signalTombstones).toEqual([]);
  expect(parsed.decisions[0]!.reportCandidates).toEqual([]);
});

test.each(["deadline", "review"] as const)("unavailable %s retry backs off while preserving the actionable concern and allowing new evidence", async kind => {
  const f = await fixture(), a = agent(f), runtime = new MindRuntime(f.store, a.call);
  const note = await f.service.tool("note", { "request-key": "note", title: "Await response", awaiting: JSON.stringify([rule]), ...(kind === "deadline" ? { "due-at": at(-1) } : { "revisit-at": at(-1) }) }, owner, NOW) as { concern: { id: string } };
  await f.service.tool("ui-settings", { enabled: true, "daily-time": "23:00", "quiet-start": "00:00", "quiet-end": "00:00" }, owner, NOW);
  await runtime.tick(NOW);
  const first = await unavailable(f, a, NOW);
  expect(first.retryAt).toBe(at(1));
  expect(selectWork(await f.store.read(), Date.parse(at(0.5)), false)).toBeNull();
  a.restart(); await runtime.tick(at(0.5));
  expect(a.calls.filter(c => c.target === "agent.run")).toHaveLength(1);
  await runtime.tick(at(1));
  const second = await unavailable(f, a, at(1));
  expect(second.retryAt).toBe(at(3));
  expect(selectWork(await f.store.read(), Date.parse(at(2)), false)).toBeNull();
  await f.service.tool("signal", { "request-key": "new-evidence", "event-id": "new-event", event: rule.event, ref: rule.ref, version: "v2", "occurred-at": at(2) }, source, at(2));
  const selected = selectWork(await f.store.read(), Date.parse(at(2)), false);
  expect(selected?.concerns.map(c => c.id)).toContain(note.concern.id);
  expect(selected?.kind).toBe(kind);
  // A user edit is new input, so an old revision's cooldown cannot consume its due reason.
  await f.service.tool("note", { "request-key": "owner-change", id: note.concern.id, title: "Await updated response" }, owner, at(2));
  expect(selectWork(await f.store.read(), Date.parse(at(2)), false)?.concerns[0]?.revision).toBe(2);
});

test("older evidence omitted from a bounded snapshot does not bypass its retry cooldown", async () => {
  const f = await fixture();
  const noted = await f.service.tool("note", { "request-key": "note", title: "Retry a bounded review", awaiting: JSON.stringify([rule]), "revisit-at": at(-2) }, owner, NOW) as { concern: { id: string; revision: number } };
  await f.service.tool("signal", { "request-key": "older", "event-id": "older", event: rule.event, ref: rule.ref, version: "1", "occurred-at": at(-1) }, source, at(-1));
  await f.store.update(state => {
    state.settings.dailyTime = "23:00";
    const old: Decision = { ...decision("old-attempt"), concernIds: [noted.concern.id], revisions: { [noted.concern.id]: noted.concern.revision }, phase: "unreported", finishedAt: NOW, retryAt: at(1) };
    state.decisions.push(old);
  });
  expect(selectWork(await f.store.read(), Date.parse(at(0.5)), false)).toBeNull();
});

test("repeated unavailable attempts cap their retry delay at 24 hours", async () => {
  const f = await fixture(), a = agent(f);
  const noted = await f.service.tool("note", { "request-key": "note", title: "Unavailable source" }, owner, NOW) as { concern: { id: string; revision: number } };
  await f.store.update(state => {
    state.decisions = Array.from({ length: 8 }, (_, n) => ({ ...decision(`previous-${n}`), kind: "manual", concernIds: [noted.concern.id], revisions: { [noted.concern.id]: noted.concern.revision }, phase: "unreported", finishedAt: at(-1), retryAt: at(-1) }));
  });
  await new MindRuntime(f.store, a.call).tick(NOW, true);
  expect((await unavailable(f, a, NOW)).retryAt).toBe(at(24));
});

test.each(["run", "context"] as const)("a mismatched Agent %s identity cannot authenticate or settle candidates", async mismatch => {
  const f = await fixture(), row = decision(), reportId = digest("authentic");
  addReportCandidate(row, { reportId, result: result(row), verified: false });
  await f.store.update(state => { state.decisions.push(row); state.runtime.currentDecisionId = row.id; });
  const effects: string[] = [];
  await new MindRuntime(f.store, async target => {
    effects.push(target);
    if (target === "agent.read") return { run: { runId: mismatch === "run" ? "wrong-run" : row.runId, contextId: mismatch === "context" ? "wrong-context" : row.contextId, active: false, status: "finished" }, items: [transcript(receipt(row, reportId))], nextCursor: null, ended: true, interactions: [] };
    throw new Error(`Unexpected Agent call ${target}`);
  }).tick(NOW);
  const state = await new MindStore(f.root).read();
  expect(effects).toEqual(["agent.read"]);
  expect(state.runtime.currentDecisionId).toBe(row.id);
  expect(state.decisions[0]).toMatchObject({ phase: "unknown", finishedAt: null, runKey: row.runKey, report: null });
  expect(state.decisions[0]!.reportCandidates).toEqual(row.reportCandidates);
});

test.each(["retained-cursor", 12, ""])("invalid Agent cursor %p retains the durable checkpoint and unverified report", async nextCursor => {
  const f = await fixture(), row = decision(), reportId = digest("stalled-receipt");
  row.cursor = "retained-cursor";
  addReportCandidate(row, { reportId, result: result(row), verified: false });
  await f.store.update(state => { state.decisions.push(row); state.runtime.currentDecisionId = row.id; });
  let reads = 0;
  await new MindRuntime(f.store, async (target, args) => {
    expect(target).toBe("agent.read"); expect(args.cursor).toBe(row.cursor); reads++;
    return { run: { runId: row.runId, contextId: row.contextId, active: false, status: "finished" }, items: [transcript(receipt(row, reportId))], nextCursor, ended: true, interactions: [] };
  }).tick(NOW);
  const state = await new MindStore(f.root).read();
  expect(reads).toBe(1);
  expect(state.runtime.currentDecisionId).toBe(row.id);
  expect(state.decisions[0]).toMatchObject({ phase: "unknown", finishedAt: null, cursor: "retained-cursor", report: null });
  expect(state.decisions[0]!.reportCandidates).toEqual(row.reportCandidates);
});

test("an unavailable unmatched daily review retries on a separate deadline", async () => {
  const f = await fixture(), a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await f.service.tool("signal", { "request-key": "event", "event-id": "event", event: "arrived", ref: "unmatched", version: "1", "occurred-at": NOW }, source, NOW);
  await f.service.tool("ui-settings", { enabled: true }, owner, NOW);
  await runtime.tick(NOW);
  const row = await unavailable(f, a, NOW);
  expect(row.kind).toBe("daily");
  expect(selectWork(await f.store.read(), Date.parse(at(0.5)), false)).toBeNull();
  expect(selectWork(await f.store.read(), Date.parse(at(1)), false)?.kind).toBe("daily");
  expect((await f.store.read()).signals[0]!.dailyReviewedAt).toBeNull();
});

test("bounded candidates require the exact successful receipt and preserve selected verified report", () => {
  const row = decision(), report = result(row);
  row.report = { reportId: digest("seeded"), result: report, verified: false };
  const actual = digest("authentic");
  addReportCandidate(row, { reportId: actual, result: { ...report, summary: "Actual current run" }, verified: false });
  expect(row.reportCandidates).toHaveLength(2);
  for (const wrong of [
    transcript(receipt(row, actual), { status: "failed" }),
    transcript(receipt(row, actual), { target: "other.report" }),
    transcript({ ...receipt(row, actual), decisionId: "other-decision" }),
    transcript({ ...receipt(row, actual), reportId: digest("unknown") }),
    transcript({ ...receipt(row, actual), accepted: false }),
    transcript({ ...receipt(row, actual), pendingVerification: false }),
    transcript(receipt(row, actual), { outputState: "filtered" }),
    transcript(receipt(row, actual), { runId: "other-run" }),
  ]) selectRunReport(row, [wrong]);
  expect(row.report?.verified).toBe(false);
  selectRunReport(row, [transcript(receipt(row, actual))]);
  expect(row.report).toMatchObject({ reportId: actual, verified: true, result: { summary: "Actual current run" } });
  expect(() => addReportCandidate(row, { reportId: digest("late"), result: report, verified: false })).toThrow("verified report");
  selectRunReport(row, [transcript(receipt(row, digest("seeded")))]);
  expect(row.report?.reportId).toBe(actual);
});

test("candidate capacity fails closed while exact request receipt replay remains available", async () => {
  const f = await fixture(), row = decision();
  await f.store.update(state => { state.decisions.push(row); state.runtime.currentDecisionId = row.id; });
  const requests = Array.from({ length: 8 }, (_, n) => ({ "request-key": `candidate-${n}`, "decision-id": row.id, result: JSON.stringify({ ...result(row), summary: `Candidate ${n}` }) }));
  const accepted = [];
  for (const args of requests) accepted.push(await f.service.tool("report", args, mind, NOW));
  const before = await readFile(f.store.path, "utf8");
  await expect(f.service.tool("report", { ...requests[0], "request-key": "overflow", result: JSON.stringify({ ...result(row), summary: "Overflow" }) }, mind, NOW)).rejects.toMatchObject({ code: "capacity" });
  expect(await readFile(f.store.path, "utf8")).toBe(before);
  expect(await f.service.tool("report", requests[0], mind, NOW)).toEqual(accepted[0]);
  expect((await f.store.read()).decisions[0]!.reportCandidates).toHaveLength(8);
});

function signal(n: number): Signal {
  return { id: `s-${n}`, digest: digest(n), moduleId: "source-test", source: "calendar", eventId: `event-${n}`, event: "changed", ref: "ref", version: "1", thread: "", from: "", domain: "", kind: "event", text: "old", occurredAt: new Date(Date.parse(NOW) - 8 * DAY).toISOString(), receivedAt: NOW, progressAt: null, associations: [], reviewed: [], dailyReviewedAt: null };
}
test("tombstone exhaustion retains durable identities and protected outstanding evidence", async () => {
  const f = await fixture(), row = decision(), protectedSignal = signal(0);
  row.signalIds = [protectedSignal.id];
  await f.store.update(state => {
    state.signals = Array.from({ length: 512 }, (_, n) => signal(n));
    state.decisions.push(row); state.runtime.currentDecisionId = row.id;
    state.signalTombstones = Array.from({ length: 4096 }, (_, n) => ({ moduleId: "old-source", eventId: `old-${n}`, digest: digest(n), signalId: `old-signal-${n}` }));
  });
  const before = await readFile(f.store.path, "utf8");
  await expect(f.store.update(state => archiveSignals(state, NOW))).rejects.toMatchObject({ code: "capacity" });
  expect(await readFile(f.store.path, "utf8")).toBe(before);
  const state = await new MindStore(f.root).read();
  expect(state.signals[0]).toEqual(protectedSignal);
  expect(archivedSignal(state, "old-source", "old-0", digest(0))).toEqual({ signalId: "old-signal-0", associations: [], duplicate: true });
  expect(() => archivedSignal(state, "old-source", "old-0", digest("changed"))).toThrow("different evidence");
});

test("UTF8 compaction preserves terminal identities, uncertain notifications, receipts and current snapshot", async () => {
  const f = await fixture(), active = decision(), terminal: Decision[] = Array.from({ length: 30 }, (_, n) => ({ ...decision(`old-${n}`), phase: "unreported", finishedAt: NOW, prompt: "中".repeat(99_000), notification: { key: `old-${n}:notify`, status: n ? "pending" : "unknown", body: "Keep this notification" } }));
  await f.store.receipt({ scope: "test", key: "original", payload: { value: "retained" }, now: NOW }, state => {
    state.decisions = [...terminal, active]; state.runtime.currentDecisionId = active.id;
    return { signalId: "original-signal", associations: [], duplicate: false };
  });
  const state = await new MindStore(f.root).read();
  expect((await stat(f.store.path)).size).toBeLessThanOrEqual(MAX_STATE_BYTES);
  expect(state.decisions).toHaveLength(31);
  expect(state.decisions.find(d => d.id === active.id)).toMatchObject(active);
  expect(state.decisions.some(d => d.prompt === "[Terminal reasoning snapshot compacted]")).toBe(true);
  for (const old of terminal) {
    const persisted = state.decisions.find(d => d.id === old.id)!;
    expect({ ...persisted, prompt: old.prompt }).toMatchObject(old);
  }
  const receiptBefore = state.receipts[0]!;
  expect(await f.store.receipt<typeof receiptBefore.result>({ scope: "test", key: "original", payload: { value: "retained" }, now: at(1) }, () => { throw new Error("Receipt was forgotten"); })).toEqual(receiptBefore.result);
  expect((await f.store.read()).receipts[0]).toEqual(receiptBefore);
});

test("decision identity capacity fails closed without forgetting old run keys or starting Agent", async () => {
  const f = await fixture(), effects: string[] = [];
  await f.service.tool("note", { "request-key": "note", title: "Still actionable" }, owner, NOW);
  await f.store.update(state => {
    state.decisions = Array.from({ length: 256 }, (_, n) => ({ ...decision(`terminal-${n}`), phase: "unreported", finishedAt: NOW }));
  });
  const keys = (await f.store.read()).decisions.map(d => d.runKey);
  await expect(new MindRuntime(f.store, async target => { effects.push(target); throw new Error("Unexpected effect"); }).tick(NOW, true)).rejects.toMatchObject({ code: "capacity" });
  const state = await new MindStore(f.root).read();
  expect(effects).toEqual([]);
  expect(state.decisions.map(d => d.runKey)).toEqual(keys);
  expect(state.runtime.currentDecisionId).toBeNull();
});

test("Mind resumes its persisted result cursor after a later page fails; transcript cannot authenticate", async () => {
  const f = await fixture(), row = decision(), reportId = digest("paged-report");
  addReportCandidate(row, { reportId, result: result(row), verified: false });
  await f.store.update(state => { state.decisions.push(row); state.runtime.currentDecisionId = row.id; });
  let unavailable = true;
  const cursors: unknown[] = [];
  const call: Call = async (target, args) => {
    const run = { runId: row.runId, contextId: row.contextId, active: false, status: "finished" };
    if (target !== "agent.read") throw new Error(`Unexpected effect ${target}`);
    cursors.push(args.cursor ?? null);
    if (!args.cursor) return { items: Array.from({ length: 2 }, (_, index) => ({ sequence: index + 1, kind: "progress", payload: {} })), run, nextCursor: "opaque-page-two", ended: true, interactions: [], transcript: [transcript(receipt(row, reportId))] };
    if (unavailable) throw new Error("lost second page");
    return { items: [{ ...transcript(receipt(row, reportId)), sequence: 101 }], run, nextCursor: null, ended: true, interactions: [] };
  };
  await new MindRuntime(f.store, call).tick(NOW);
  const pending = (await f.store.read()).decisions[0]!;
  expect(pending.cursor).toBe("opaque-page-two"); expect(pending.report?.verified).not.toBe(true);
  unavailable = false;
  await new MindRuntime(new MindStore(f.root), call).tick(NOW);
  expect(cursors).toEqual([null, "opaque-page-two", "opaque-page-two"]);
  expect((await f.store.read()).decisions[0]).toMatchObject({ phase: "completed", cursor: null, report: { verified: true, reportId } });
});
