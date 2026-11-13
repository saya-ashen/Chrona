import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindStore, digest } from "./external/mind/store";
import { MindService } from "./external/mind/service";
import { MindRuntime } from "./external/mind/runtime";
import { DAY, selectWork } from "./external/mind/policy";
import { inputs, outputs } from "./external/mind/schema";
import type { Call, Caller, Decision, ReportResult, State } from "./external/mind/types";

// Real private-file persistence and business code. Only the external Agent is doubled.
const NOW = "2026-11-09T12:00:00.000Z";
const at = (milliseconds: number) => new Date(Date.parse(NOW) + milliseconds).toISOString();
const owner: Caller = { kind: "owner", via: "test" };
const source: Caller = { kind: "module", module: "calendar", moduleId: "calendar-id", hash: "source-hash" };
const mind = { kind: "module", module: "mind", moduleId: "mind-id", hash: "mind-hash" } as const satisfies Caller;
const rule = { source: "calendar", moduleId: "calendar-id", event: "changed", ref: "application-7", thread: "thread-1", from: "office", domain: "example.test", textAll: ["received"] };
const observation = { "request-key": "signal-original", "event-id": "event-original", event: rule.event, ref: rule.ref, version: "v1", thread: rule.thread, from: rule.from, domain: rule.domain, kind: "event", text: "Documents received", "occurred-at": NOW };
const dimensions: ReportResult["feedback"] = { newEvidence: true, progress: false, internal: false, redundant: false, unavailable: false, userVisible: false };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chrona-mind-policy-regressions-"));
  directories.push(directory);
  const store = new MindStore(directory), service = new MindService(store);
  const note = async (patch: Record<string, unknown> = {}, now = NOW) => outputs.note.parse(await service.tool("note", { "request-key": "note-original", title: "Await application confirmation", awaiting: JSON.stringify([rule]), ...patch }, owner, now));
  const signal = async (patch: Record<string, unknown> = {}, now = NOW) => outputs.signal.parse(await service.tool("signal", { ...observation, ...patch }, source, now));
  return { directory, store, service, note, signal };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// No execution/storage simulation: identities come from the runtime's durable current decision.
function agent(f: Fixture) {
  let active = true;
  let receipt: unknown;
  const calls: string[] = [];
  const call: Call = async (target, args, options) => {
    calls.push(target);
    const state = await f.store.read();
    const current = state.decisions.find(d => d.id === state.runtime.currentDecisionId);
    if (!current) throw new Error(`Agent called without a durable decision: ${target}`);
    const contextId = `context-${current.id}`, runId = `run-${current.id}`;
    if (target === "agent.run") {
      expect(options?.key).toBe(current.runKey);
      expect(args.prompt).toBe(current.prompt);
      return { contextId, runId, active, status: active ? "running" : "finished" };
    }
    if (target === "agent.read") return { run: { contextId, runId, active, status: active ? "running" : "finished" }, items: receipt && !args.cursor ? [{ sequence: 1, kind: "tool-result", payload: { type: "tool-result", value: { runId, callId: "call-report", target: "mind.report", moduleId: mind.moduleId, hash: mind.hash, status: "succeeded", outputState: "complete", output: receipt } } }] : [], nextCursor: receipt ? "opaque:1" : null, ended: !active, interactions: [] };
    throw new Error(`Unexpected external call: ${target}`);
  };
  return { call, calls, finish(value: unknown) {
    active = false;
    receipt = value;
  } };
}
async function currentDecision(f: Fixture) {
  const state = await f.store.read();
  const decision = state.decisions.find(d => d.id === state.runtime.currentDecisionId);
  if (!decision) throw new Error("Expected an admitted current Mind decision");
  return decision;
}
function resultFor(decision: Decision, patch: Partial<ReportResult> = {}): ReportResult {
  return { summary: "Application evidence assessed", concerns: decision.concernIds.map(id => ({ id, revision: decision.revisions[id]!, conclusion: "Documents received; owner review still required", signalIds: decision.signalIds })), feedback: { ...dimensions }, ...patch };
}
async function stage(f: Fixture, decision: Decision, result: ReportResult, key = `${decision.id}:report`, now = NOW) {
  return outputs.report.parse(await f.service.tool("report", { "request-key": key, "decision-id": decision.id, result: JSON.stringify(result) }, mind, now));
}

test.each([
  { reason: "deadline", patch: { "due-at": at(3_600_000) } },
  { reason: "review", patch: { "revisit-at": at(-60_000) } },
  { reason: "review", patch: { "expected-progress-at": at(-60_000) } },
])("unavailable assessment preserves $reason eligibility and successful-review state ($patch)", async ({ reason, patch }) => {
  const f = await fixture();
  const { concern } = await f.note(patch);
  await f.signal({ "progress-at": NOW });
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await runtime.tick(NOW, true);
  const decision = await currentDecision(f);
  const receipt = await stage(f, decision, resultFor(decision, { feedback: { ...dimensions, unavailable: true, progress: true, redundant: true } }));
  a.finish(receipt);
  // A fresh runtime/store must apply the same durable decision, without launching again.
  await new MindRuntime(new MindStore(f.directory), a.call).tick(at(1000));
  const state = await f.store.read(), assessed = state.concerns.find(c => c.id === concern.id)!;
  expect(state.runtime.currentDecisionId).toBeNull();
  expect(a.calls.filter(target => target === "agent.run")).toHaveLength(1);
  expect({
    lastCheckedAt: assessed.lastCheckedAt, lastAssessment: assessed.lastAssessment,
    escalation: assessed.escalation, progressAt: assessed.progressAt, links: assessed.links,
    reviewed: state.signals[0]!.reviewed, dailyReviewedAt: state.signals[0]!.dailyReviewedAt,
  }).toEqual({ lastCheckedAt: null, lastAssessment: null, escalation: "none", progressAt: null, links: [], reviewed: [], dailyReviewedAt: null });
  expect(state.feedback).toHaveLength(1);
  expect(state.feedback[0]!.dimensions).toMatchObject({ unavailable: true, redundant: false, progress: false });
  // Scheduling may back off attempts, but the concern's underlying reason must remain actionable.
  expect(selectWork(state, Date.parse(at(2 * 3_600_000)), false)?.kind).toBe(reason);
});

test("unavailable daily assessment keeps unmatched evidence in the review backlog", async () => {
  const f = await fixture();
  const evidence = await f.signal();
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await f.service.tool("ui-settings", { enabled: true }, owner, NOW);
  await runtime.tick(NOW);
  const decision = await currentDecision(f);
  expect(decision.kind).toBe("daily");
  expect(decision.signalIds).toContain(evidence.signalId);
  a.finish(await stage(f, decision, resultFor(decision, { concerns: [], feedback: { ...dimensions, unavailable: true } })));
  await runtime.tick(at(1000));
  expect((await f.store.read()).signals[0]!.dailyReviewedAt).toBeNull();
  const agenda = outputs.agenda.parse(await f.service.tool("agenda", {}, owner, at(1000)));
  expect(agenda.stats.unmatched).toBe(1);
});

const changedRules = [
  { field: "source", patch: { source: "other-source" } },
  { field: "moduleId", patch: { moduleId: "other-module" } },
  { field: "event", patch: { event: "other-event" } },
  { field: "ref", patch: { ref: "application-8" } },
  { field: "thread", patch: { thread: "thread-2" } },
  { field: "from", patch: { from: "other-office" } },
  { field: "domain", patch: { domain: "other.test" } },
  { field: "textAll", patch: { textAll: ["signed"] } },
];
test.each(changedRules)("editing awaited $field removes obsolete associations and review marks only for that concern", async ({ patch }) => {
  const f = await fixture();
  const first = (await f.note()).concern;
  const second = (await f.note({ "request-key": "note-second", title: "Another application" })).concern;
  await f.signal();
  await f.store.update(state => { state.signals[0]!.reviewed = [first.id, second.id]; });
  await f.note({ "request-key": "change-identity", id: first.id, awaiting: JSON.stringify([{ ...rule, ...patch }]) });
  let signal = (await f.store.read()).signals[0]!;
  expect({ associations: signal.associations, reviewed: signal.reviewed }).toEqual({ associations: [second.id], reviewed: [second.id] });
  // Matching again may reassociate the observation, but cannot inherit the obsolete review.
  await f.note({ "request-key": "restore-identity", id: first.id, awaiting: JSON.stringify([rule]) });
  signal = (await f.store.read()).signals[0]!;
  expect(signal.associations.toSorted()).toEqual([first.id, second.id].toSorted());
  expect(signal.reviewed).toEqual([second.id]);
});

test.each(["expired", "superseded"] as const)("512 %s observations release capacity while durable event deduplication survives archival", async kind => {
  const f = await fixture();
  const receivedAt = kind === "expired" ? at(-31 * DAY) : at(-600_000);
  const originalInput = { ...observation, "occurred-at": receivedAt };
  const original = await f.signal({ "occurred-at": receivedAt }, receivedAt);
  const parsed = inputs.signal.parse(originalInput);
  const { "request-key": _requestKey, ...payload } = parsed;
  const seeded = await f.store.update(state => {
    const base = state.signals[0]!;
    state.signals = Array.from({ length: 512 }, (_, n) => {
      const eventId = n ? `seed-event-${n}` : base.eventId;
      const occurredAt = kind === "superseded" ? new Date(Date.parse(receivedAt) + n).toISOString() : receivedAt;
      return { ...base, id: n ? `seed-signal-${n}` : base.id, eventId, occurredAt, digest: digest({ ...payload, "event-id": eventId, "occurred-at": occurredAt }) };
    });
    return state.signals.map(s => ({ id: s.id, eventId: s.eventId, occurredAt: s.occurredAt }));
  });
  const freshInput = { ...observation, "request-key": "fresh-observation", "event-id": "fresh-observation", version: "v2", "occurred-at": NOW };
  const fresh = await f.signal(freshInput);
  expect(fresh.duplicate).toBe(false);
  const afterIngest = await f.store.read();
  expect(afterIngest.signals.length).toBeLessThanOrEqual(512);
  // Replay an identity that was actually removed, regardless of the retention order.
  const archived = seeded.find(s => !afterIngest.signals.some(live => live.id === s.id));
  if (!archived) throw new Error("Capacity recovery must archive at least one obsolete observation");
  const archivedInput = { ...originalInput, "event-id": archived.eventId, "occurred-at": archived.occurredAt, "request-key": "archived-event-new-receipt" };
  const restarted = new MindService(new MindStore(f.directory));
  expect(await restarted.tool("signal", originalInput, source, NOW)).toEqual(original);
  const replay = outputs.signal.parse(await restarted.tool("signal", archivedInput, source, NOW));
  expect(replay).toMatchObject({ signalId: archived.id, duplicate: true });
  await expect(restarted.tool("signal", { ...archivedInput, "request-key": "conflicting-archived-event", version: "changed" }, source, NOW)).rejects.toMatchObject({ code: "conflict" });
  expect(await restarted.tool("signal", freshInput, source, NOW)).toEqual(fresh);
  const state = await f.store.read();
  expect(state.signals.filter(s => s.eventId === "fresh-observation")).toHaveLength(1);
  // A tombstone lookup must not recreate archived evidence as pending work.
  expect(state.signals.map(s => s.id)).toEqual(afterIngest.signals.map(s => s.id));
});

test("signal reclamation protects evidence and identities held by an outstanding run", async () => {
  const f = await fixture(), old = at(-31 * DAY);
  await f.note({}, old);
  const protectedSignal = await f.signal({ "occurred-at": old }, old);
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await runtime.tick(old, true);
  const pending = await currentDecision(f);
  expect(pending.signalIds).toContain(protectedSignal.signalId);
  await f.store.update(state => {
    const base = state.signals[0]!;
    state.signals.push(...Array.from({ length: 511 }, (_, n) => ({ ...base, id: `expired-${n}`, eventId: `expired-event-${n}`, digest: digest(n), associations: [], reviewed: [] })));
  });
  await f.signal({ "request-key": "new-after-gap", "event-id": "new-after-gap" });
  const state = await f.store.read();
  expect(state.signals.find(s => s.id === protectedSignal.signalId)).toBeDefined();
  expect(state.runtime.currentDecisionId).toBe(pending.id);
  expect(state.decisions.find(d => d.id === pending.id)).toEqual(pending);
  expect(a.calls.filter(target => target === "agent.run")).toHaveLength(1);
});

test("64 owner-reviewed proposals release suggestion capacity and retain exact acceptance/dismissal receipts", async () => {
  const f = await fixture();
  const suggestions = Array.from({ length: 64 }, (_, n) => ({ "request-key": `suggest-${n}`, title: `Potential concern ${n}`, reason: "Source evidence needs owner review" }));
  const proposals = [];
  for (const args of suggestions) proposals.push(outputs.propose.parse(await f.service.tool("propose", args, source, NOW)).proposal);
  const accept = { "request-key": "accept-first", "proposal-id": proposals[0]!.id };
  const accepted = await f.service.tool("note", accept, owner, NOW);
  const dismissals = proposals.slice(1).map(proposal => ({ "request-key": `dismiss-${proposal.id}`, id: proposal.id }));
  const dismissed = [];
  for (const args of dismissals) dismissed.push(await f.service.tool("ui-dismiss", args, owner, NOW));
  const nextArgs = { "request-key": "suggest-after-review", title: "A new observation", reason: "Previous suggestions have been resolved" };
  const next = outputs.propose.parse(await f.service.tool("propose", nextArgs, source, NOW));
  expect(next.proposal.status).toBe("pending");
  const restarted = new MindService(new MindStore(f.directory));
  expect(await restarted.tool("note", accept, owner, NOW)).toEqual(accepted);
  expect(await restarted.tool("ui-dismiss", dismissals[0], owner, NOW)).toEqual(dismissed[0]);
  expect(await restarted.tool("propose", suggestions[0], source, NOW)).toEqual({ proposal: proposals[0] });
  expect(await restarted.tool("propose", nextArgs, source, NOW)).toEqual(next);
  await expect(restarted.tool("propose", { ...suggestions[0], title: "Changed retry" }, source, NOW)).rejects.toMatchObject({ code: "conflict" });
  const state = await f.store.read();
  expect(state.concerns).toHaveLength(1);
  expect(state.concerns[0]!.id).toBe(outputs.note.parse(accepted).concern.id);
  expect(state.proposals.filter(p => p.status === "pending").map(p => p.id)).toEqual([next.proposal.id]);
});

function terminalDecision(n: number, patch: Partial<Decision> = {}): Decision {
  const id = `history-${n}`;
  const result: ReportResult = { summary: "Historical assessment", concerns: [], feedback: dimensions };
  return { id, at: at(-40 * DAY), kind: "manual", concernIds: [], signalIds: [], revisions: {}, sourceKinds: [], phase: "completed", runKey: `${id}:run`, contextId: `${id}:context`, runId: `${id}:run`, prompt: "Historical terminal snapshot", tools: ["mind.agenda", "mind.propose", "mind.report"], report: { reportId: digest({ id, result }), result, verified: true }, finishedAt: at(-40 * DAY + 1000), error: null, interactions: [], notification: null, ...patch };
}
const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ result: value }), "utf8");
const SAFE_RESPONSE_BYTES = 230 * 1024;
test("agenda bounds actual UTF-8 response bytes for 200 valid concerns", async () => {
  const f = await fixture();
  const { concern } = await f.note({ title: "申".repeat(200), goal: "請".repeat(1200) });
  await f.store.update(state => { state.concerns = Array.from({ length: 200 }, (_, n) => ({ ...concern, id: n ? `concern-${n}` : concern.id })); });
  const agenda = outputs.agenda.parse(await f.service.tool("agenda", {}, owner, NOW));
  expect(agenda.concerns.length).toBeGreaterThan(0);
  expect(wireBytes(agenda)).toBeLessThanOrEqual(SAFE_RESPONSE_BYTES);
});

test("decisions bounds actual UTF-8 response bytes for a valid requested history page", async () => {
  const f = await fixture();
  const { concern } = await f.note();
  await f.store.update(state => {
    state.concerns = Array.from({ length: 8 }, (_, n) => ({ ...concern, id: `concern-${n}` }));
    state.decisions = Array.from({ length: 100 }, (_, n) => {
      const result: ReportResult = { summary: "申".repeat(800), concerns: state.concerns.map(c => ({ id: c.id, revision: c.revision, conclusion: "請".repeat(1200), signalIds: [] })), feedback: dimensions };
      return terminalDecision(n, { concernIds: state.concerns.map(c => c.id), revisions: Object.fromEntries(state.concerns.map(c => [c.id, c.revision])), report: { reportId: digest({ n, result }), result, verified: true } });
    });
  });
  const history = outputs.decisions.parse(await f.service.tool("decisions", { limit: 100 }, owner, NOW));
  expect(history.decisions.length).toBeGreaterThan(0);
  expect(wireBytes(history)).toBeLessThanOrEqual(SAFE_RESPONSE_BYTES);
});

// Fill with schema-valid, eligible terminal snapshots below the count-retention threshold.
// This is fixture construction through the real store, not an alternate compaction algorithm.
function fillTerminalHistory(state: State, keep: Decision[] = []) {
  state.decisions = [...Array.from({ length: 100 }, (_, n) => terminalDecision(n, { prompt: "x".repeat(100_000) })), ...keep];
  let excess = Buffer.byteLength(JSON.stringify(state)) - (8 * 1024 * 1024 - 1024);
  for (const decision of state.decisions.slice(0, 100).reverse()) {
    if (excess <= 0) break;
    const remove = Math.min(excess, decision.prompt.length - 1);
    decision.prompt = decision.prompt.slice(remove);
    excess -= remove;
  }
}
test("byte-aware terminal history compaction admits work before the 256-decision count limit", async () => {
  const f = await fixture();
  const noteArgs = { goal: "確".repeat(1200) };
  const saved = await f.note(noteArgs);
  await f.store.update(state => { fillTerminalHistory(state); });
  expect((await stat(f.store.path)).size).toBeLessThanOrEqual(8 * 1024 * 1024);
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await runtime.tick(NOW, true);
  const current = await currentDecision(f);
  expect(current.concernIds).toContain(saved.concern.id);
  expect(a.calls.filter(target => target === "agent.run")).toHaveLength(1);
  expect(await f.note(noteArgs)).toEqual(saved);
  expect((await f.store.read()).concerns).toHaveLength(1);
});

test("terminal history compaction leaves room to settle the outstanding run without replaying it", async () => {
  const f = await fixture();
  await f.note();
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await runtime.tick(NOW, true);
  const outstanding = await currentDecision(f);
  await f.store.update(state => { fillTerminalHistory(state, [outstanding]); });
  expect(await currentDecision(f)).toEqual(outstanding);
  const result = resultFor(outstanding, { summary: "確".repeat(800), concerns: outstanding.concernIds.map(id => ({ id, revision: outstanding.revisions[id]!, conclusion: "認".repeat(1200), signalIds: [] })) });
  const receipt = await stage(f, outstanding, result);
  a.finish(receipt);
  await new MindRuntime(new MindStore(f.directory), a.call).tick(at(1000));
  const state = await f.store.read(), settled = state.decisions.find(d => d.id === outstanding.id)!;
  expect(state.runtime.currentDecisionId).toBeNull();
  expect(settled).toMatchObject({ id: outstanding.id, runKey: outstanding.runKey, contextId: outstanding.contextId, runId: outstanding.runId, phase: "completed" });
  expect(state.concerns[0]!.lastAssessment?.conclusion).toBe(result.concerns[0]!.conclusion);
  expect(await stage(f, outstanding, result)).toEqual(receipt);
  expect(a.calls.filter(target => target === "agent.run")).toHaveLength(1);
  expect((await stat(f.store.path)).size).toBeLessThanOrEqual(8 * 1024 * 1024);
});

test("an unverified self-report cannot deny the successful current Agent persisted result candidate", async () => {
  const f = await fixture();
  await f.note();
  const a = agent(f), runtime = new MindRuntime(f.store, a.call);
  await runtime.tick(NOW, true);
  const decision = await currentDecision(f);
  const blocker = resultFor(decision, { summary: "Unverified out-of-band candidate", feedback: { ...dimensions, unavailable: true } });
  await stage(f, decision, blocker, "out-of-band-candidate");
  const authentic = resultFor(decision, { summary: "Current Agent report", concerns: decision.concernIds.map(id => ({ id, revision: decision.revisions[id]!, conclusion: "Authenticated current run conclusion", signalIds: [] })) });
  const receipt = await stage(f, decision, authentic, "current-agent-report");
  a.finish(receipt);
  await runtime.tick(at(1000));
  const state = await f.store.read();
  expect(state.decisions.find(d => d.id === decision.id)?.phase).toBe("completed");
  expect(state.concerns[0]!.lastAssessment?.conclusion).toBe("Authenticated current run conclusion");
  expect(a.calls.filter(target => target === "agent.run")).toHaveLength(1);
});
