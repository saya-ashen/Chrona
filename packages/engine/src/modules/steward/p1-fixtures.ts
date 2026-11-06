import { randomUUID } from "node:crypto";
import {
  executionJsonBytes, EXECUTION_EVENT_LIMITS as limits,
  type ProviderAdapter, type ProviderRunInput, type ExecutionPrincipal, type ExecutionStart, type ExecutionPorts, type ExecutionView, type ExecutionRef,
  type ExecutionEvent, type ExecutionEventStore, type ExecutionEventRead, type ExecutionSnapshot, type ExecutionPayload,
} from "@chrona/contracts/steward";

/** Test doubles only. No runtime registration, scheduling, persistence or filesystem access. */
export class P1FixtureError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "conflict" | "capacity" | "cursor_expired", message = code) { super(message); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const principalKey = (p: ExecutionPrincipal) => JSON.stringify([p.workspaceId, p.ownerId, p.caller.kind, ...(p.caller.kind === "module" ? [p.caller.moduleId, p.caller.hash] : [])]);
const ownerKey = (p: ExecutionPrincipal) => JSON.stringify([p.workspaceId, p.ownerId]);
function assertOwner(a: ExecutionPrincipal, b: ExecutionPrincipal) {
  if (ownerKey(a) !== ownerKey(b) || b.caller.kind !== "owner" && principalKey(a) !== principalKey(b)) throw new P1FixtureError("forbidden");
}
export function createFakeExecutionPorts(options: {
  projects: ReadonlyMap<string, { workspaceId: string; ownerId: string; moduleId: string; canonicalPath: string }>;
  beforeCommit?: () => void;
  now?: () => number;
}) {
  const works = new Map<string, { principal: ExecutionPrincipal; view: ExecutionView }>();
  const receipts = new Map<string, { input: ExecutionStart; view: ExecutionView }>();
  const commands = new Map<string, string>();
  const questions = new Map<string, { runId: string; attemptId: string; expires: number; answered: boolean }>();
  const enqueued: ExecutionRef[] = [];
  function owned(p: ExecutionPrincipal, work: string) {
    const row = works.get(work); if (!row) throw new P1FixtureError("not_found");
    assertOwner(row.principal, p); return row.view;
  }
  function checkCommand(p: ExecutionPrincipal, input: { workId: string; runId: string; attemptId: string; commandKey: string }) {
    const view = owned(p, input.workId);
    if (view.runId !== input.runId || view.attemptId !== input.attemptId) throw new P1FixtureError("conflict");
    return view;
  }
  function remember(p: ExecutionPrincipal, input: { commandKey: string; op: string }) {
    const key = JSON.stringify([principalKey(p), input.op, input.commandKey]), body = JSON.stringify(input);
    const prior = commands.get(key);
    if (prior && prior !== body) throw new P1FixtureError("conflict");
    commands.set(key, body); return !!prior;
  }
  const ports: ExecutionPorts = {
    async start(p, input) {
      const key = JSON.stringify([principalKey(p), "start", input.commandKey]);
      const previous = receipts.get(key);
      if (previous) { if (!same(previous.input, input)) throw new P1FixtureError("conflict"); return structuredClone(previous.view); }
      const project = options.projects.get(input.projectRef);
      if (!project || project.workspaceId !== p.workspaceId || project.ownerId !== p.ownerId || p.caller.kind !== "owner" && project.moduleId !== p.caller.moduleId) throw new P1FixtureError("forbidden");
      if (works.has(input.workId)) throw new P1FixtureError("conflict");
      const view: ExecutionView = { workId: input.workId, sessionId: randomUUID(), runId: randomUUID(), attemptId: randomUUID(), projectRef: input.projectRef, status: "queued", cancelRequested: false, stopConfirmed: false };
      options.beforeCommit?.(); // Failure injection precedes all three atomic fixture writes.
      works.set(input.workId, { principal: structuredClone(p), view }); receipts.set(key, { input, view }); enqueued.push(view);
      return structuredClone(view);
    },
    async get(p, id) { return structuredClone(owned(p, id)); },
    async resultSource(p, input) {
      const view = owned(p, input.workId);
      if (view.runId !== input.runId || view.attemptId !== input.attemptId) throw new P1FixtureError("conflict");
      return { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, baseline: { kind: "snapshot", digest: "fixture-only" } };
    },
    async lookupStart(p, commandKey) {
      const matches = p.caller.kind === "owner"
        ? [...receipts.values()].filter(receipt => receipt.input.commandKey === commandKey && ownerKey(works.get(receipt.view.workId)!.principal) === ownerKey(p))
        : [receipts.get(JSON.stringify([principalKey(p), "start", commandKey]))].filter(value => value !== undefined);
      if (!matches.length) throw new P1FixtureError("not_found");
      if (matches.length > 1) throw new P1FixtureError("conflict");
      return structuredClone(matches[0]!.view);
    },
    async list(p, input) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new P1FixtureError("conflict");
      const visible: ExecutionView[] = [];
      for (const row of works.values()) {
        if (ownerKey(p) !== ownerKey(row.principal) || p.caller.kind !== "owner" && principalKey(p) !== principalKey(row.principal)) continue;
        if (input.after && row.view.workId <= input.after) continue;
        visible.push(row.view);
      }
      visible.sort((a, b) => a.workId.localeCompare(b.workId));
      const page = visible.slice(0, input.limit);
      return { works: structuredClone(page), after: visible.length > input.limit ? page.at(-1)!.workId : null };
    },
    async send(p, input) { checkCommand(p, input); remember(p, input); },
    async answer(p, input) {
      checkCommand(p, input);
      const key = JSON.stringify([principalKey(p), input.op, input.commandKey]);
      if (commands.has(key)) { remember(p, input); return; }
      const question = questions.get(input.requestId);
      if (!question || question.runId !== input.runId || question.attemptId !== input.attemptId || question.expires <= (options.now?.() ?? Date.now()) || question.answered) throw new P1FixtureError("conflict");
      remember(p, input); question.answered = true;
    },
    async cancel(p, input) {
      const view = checkCommand(p, input); remember(p, input); view.cancelRequested = true;
      if (view.status === "queued") { view.status = "cancelled"; view.stopConfirmed = true; }
      return structuredClone(view);
    },
  };
  return {
    ports, enqueued,
    question(requestId: string, ref: ExecutionRef, expires: number) { questions.set(requestId, { runId: ref.runId, attemptId: ref.attemptId, expires, answered: false }); },
    restart() { questions.clear(); },
    settle(p: ExecutionPrincipal, id: string, status: "running" | "completed" | "unknown", stopped = false) { const view = owned(p, id); view.status = status; view.stopConfirmed = stopped; },
    detach() { /* Detaching a test client has no execution effect. */ },
  };
}

type PollWaiter = { key: string; finish: () => void };
function waitForP1Event(input: ExecutionEventRead, waiters: Set<PollWaiter>, key: string, release: () => void) {
  return new Promise<void>(resolve => {
    const waiter = { key, finish() {
      if (!waiters.delete(waiter)) return;
      clearTimeout(timer); input.signal?.removeEventListener("abort", waiter.finish); release(); resolve();
    } };
    const timer = setTimeout(waiter.finish, input.waitMs); waiters.add(waiter);
    input.signal?.addEventListener("abort", waiter.finish, { once: true });
    if (input.signal?.aborted) waiter.finish();
  });
}
function validateP1Read(input: ExecutionEventRead) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > limits.pageEvents || !Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > limits.pollMs) throw new P1FixtureError("conflict");
}
type Stream = { principal: ExecutionPrincipal; ref: ExecutionRef; events: ExecutionEvent[]; snapshot: ExecutionSnapshot };
function p1PageEvents(stream: Stream, after: number, count: number) {
  const events: ExecutionEvent[] = [];
  for (const event of stream.events) {
    if (event.seq <= after) continue;
    if (events.length >= count || executionJsonBytes(events) + executionJsonBytes(event) + 2048 > limits.pageBytes) break;
    events.push(event);
  }
  return structuredClone(events);
}
/** Test consumer for append/read/snapshot and real proxy polling; not G's storage implementation. */
export function createFakeExecutionEventStore() {
  const streams = new Map<string, Stream>();
  const polls = new Map<string, number>(), waiters = new Set<PollWaiter>();
  const keyOf = (ref: ExecutionRef) => JSON.stringify([ref.workId, ref.attemptId]);
  function lookup(p: ExecutionPrincipal, ref: ExecutionRef) {
    const stream = streams.get(keyOf(ref)); if (!stream) throw new P1FixtureError("not_found");
    assertOwner(stream.principal, p);
    if (stream.ref.runId !== ref.runId || stream.ref.sessionId !== ref.sessionId) throw new P1FixtureError("conflict");
    return stream;
  }
  function position(p: ExecutionPrincipal, stream: Stream, value?: string) {
    if (!value) return 0;
    let saved: unknown;
    try { saved = JSON.parse(Buffer.from(value, "base64url").toString()); }
    catch { throw new P1FixtureError("conflict"); }
    if (!Array.isArray(saved) || saved[0] !== principalKey(p) || saved[1] !== stream.ref.workId || saved[2] !== stream.ref.attemptId || !Number.isSafeInteger(saved[3])) throw new P1FixtureError("forbidden");
    return saved[3] as number;
  }
  function reserve(p: ExecutionPrincipal, input: ExecutionRef) {
    const ref: ExecutionRef = { workId: input.workId, sessionId: input.sessionId, runId: input.runId, attemptId: input.attemptId };
    if (streams.has(keyOf(ref))) throw new P1FixtureError("conflict");
    // Only the reviewed admission example: active headroom, completed snapshots' actual bytes.
    const used = [...streams.values()].reduce((sum, { snapshot }) => sum + (["queued", "running", "unknown"].includes(snapshot.status) ? limits.snapshotBytes : executionJsonBytes(snapshot)), 0);
    if (used + limits.snapshotBytes > limits.snapshotGlobalBytes) throw new P1FixtureError("capacity");
    const snapshot: ExecutionSnapshot = { ...ref, highWatermark: 0, status: "queued", cancelRequested: false, stopConfirmed: false, finalMessage: null, questions: [], missing: false, expiresAt: new Date(Date.now() + limits.snapshotRetentionMs).toISOString() };
    streams.set(keyOf(ref), { principal: structuredClone(p), ref, events: [], snapshot });
  }
  const store: ExecutionEventStore = {
    async append(p, event) {
      const stream = lookup(p, event), prior = stream.events.find(value => value.seq === event.seq);
      if (prior) { if (!same(prior, event)) throw new P1FixtureError("conflict"); return; }
      if (event.seq <= stream.snapshot.highWatermark) throw new P1FixtureError("conflict");
      if (event.seq !== stream.snapshot.highWatermark + 1) stream.snapshot.missing = true;
      stream.events.push(structuredClone(event)); stream.snapshot.highWatermark = event.seq;
      for (const waiter of [...waiters]) if (waiter.key === keyOf(event)) waiter.finish();
    },
    async read(p, input: ExecutionEventRead) {
      const stream = lookup(p, input), after = position(p, stream, input.cursor);
      validateP1Read(input);
      if (stream.snapshot.highWatermark <= after && input.waitMs > 0 && !input.signal?.aborted) {
        const owner = ownerKey(p), count = polls.get(owner) ?? 0;
        if (count >= limits.ownerPolls) throw new P1FixtureError("capacity");
        polls.set(owner, count + 1);
        await waitForP1Event(input, waiters, keyOf(input), () => {
          const remaining = (polls.get(owner) ?? 1) - 1;
          if (remaining) polls.set(owner, remaining); else polls.delete(owner);
        });
      }
      const events = p1PageEvents(stream, after, input.limit);
      const cursor = Buffer.from(JSON.stringify([principalKey(p), stream.ref.workId, stream.ref.attemptId, events.at(-1)?.seq ?? after])).toString("base64url");
      return { events, cursor, highWatermark: stream.snapshot.highWatermark, gap: stream.snapshot.missing, snapshotRequired: stream.snapshot.missing };
    },
    async snapshot(p, ref) { return structuredClone(lookup(p, ref).snapshot); },
  };
  return {
    store, reserve,
    saveSnapshot(p: ExecutionPrincipal, snapshot: ExecutionSnapshot) { lookup(p, snapshot).snapshot = structuredClone(snapshot); },
    stats: () => ({ waiters: waiters.size, activePolls: [...polls.values()].reduce((sum, count) => sum + count, 0) }),
  };
}

/** Whitelist before redaction: arbitrary RPC, args, result and thinking never cross this boundary. */
export function projectP1ToolStart(tool: string, toolCallId: string, args: Record<string, unknown>, redact: (text: string) => string): ExecutionPayload {
  const display: { path?: string; command?: string } = {};
  if (["read", "edit", "write"].includes(tool) && typeof args.path === "string") display.path = redact(args.path).slice(0, 1000);
  if (tool === "bash" && typeof args.command === "string") display.command = redact(args.command).slice(0, 1000);
  return { type: "tool_started", toolCallId, tool, display };
}

/** Manually settled Provider for contract consumers; never spawns a process or calls a model. */
export function createFakeP1Provider() {
  const starts: ProviderRunInput[] = [], injections: string[] = [];
  const active = new Map<string, (value: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) => void>();
  let aborted = 0;
  const provider: ProviderAdapter = {
    name: "p1-fake", supportsRunModel: true,
    async health() { return { available: true, sandboxed: false, error: null }; },
    start(input) {
      if (active.has(input.runId)) throw new P1FixtureError("conflict");
      starts.push(input);
      const done = new Promise<Awaited<ReturnType<ProviderAdapter["start"]>["done"]>>(resolve => active.set(input.runId, resolve));
      return {
        async inject(message) { injections.push(message); },
        async abort() { aborted++; active.get(input.runId)?.({ outcome: "failed", sessionId: input.sessionId, error: "Stopped by fake provider" }); active.delete(input.runId); },
        done,
      };
    },
  };
  return { provider, starts, injections, aborted: () => aborted,
    settle(runId: string, outcome: "finished" | "failed" = "finished") { active.get(runId)?.({ outcome, sessionId: null, error: outcome === "failed" ? "Fake failure" : null }); active.delete(runId); },
  };
}
