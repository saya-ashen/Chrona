import { randomUUID } from "node:crypto";
import { readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { EXECUTOR_PROTOCOL, EXECUTOR_LIMITS, executorDetailSchema, executorFinalSchema, type ExecutionSourceReceipt, type ExecutionResultSource, type ExecutorAssignment, type ExecutorFence, type ExecutorFinal, type ExecutorRequests, type ExecutorResponses, type ProviderAnswer } from "@chrona/contracts/steward";
import { createPiProvider, type PiProviderOptions } from "../steward/pi-provider";
import { createExecutorClient, ExecutorRequestError, ExecutorTransportError } from "./client";
import { createExecutorBridge } from "./bridge";
import { assignmentUnit, ExecutorJournal, localDigest, managerStopProof, type LocalJournal } from "./journal";
import { createExecutorLauncher, recoverExecutorProcess, stopRecoveredExecutorProcess, type ExecutorProcessEntry } from "./process";
import { ExecutorSpool } from "./spool";

type Client = ReturnType<typeof createExecutorClient>;
type Prepared = { cwd: string; sourceReceipt: ExecutionSourceReceipt | null; release(): void };
type Options = {
  processEntry?: ExecutorProcessEntry;
  client: Client; fence: ExecutorFence; journal: ExecutorJournal;
  /** Explicit service-specific profile/resources/model; no personal profile discovery. */
  provider: Omit<PiProviderOptions, "launch" | "agentUrl"> & { agentDir: string; model: string };
  prepareWorkspace: ((assignment: ExecutorAssignment, recordLock?: (lock: LocalJournal["workspaceLocks"][number]) => void) => Promise<Prepared>) & { recover?(value: LocalJournal): void; cleanup?(operation: NonNullable<ExecutorResponses["poll"]["cleanupOperations"]>[number], read: () => LocalJournal): Promise<import("@chrona/contracts/steward").WorkCleanupReceipt> };
  canonicalFinal(final: ExecutorFinal, localSecrets: readonly string[]): ExecutorFinal;
  captureWorkspaceChanges(cwd: string, baseline: ExecutionResultSource["baseline"]): Promise<NonNullable<ExecutionResultSource["changes"]>>;
};
type Active = { assignment: ExecutorAssignment; run: ReturnType<ReturnType<typeof createPiProvider>["start"]>; stopped: boolean; expires: number; timer: ReturnType<typeof setTimeout>; release(): void; sourceReceipt: ExecutionSourceReceipt | null; finalizing?: Promise<void> };
const ref = (assignment: ExecutorAssignment) => ({ workId: assignment.workId, sessionId: assignment.sessionId, runId: assignment.runId, attemptId: assignment.attemptId, assignmentId: assignment.assignmentId, generation: assignment.generation });

export function createExecutorDaemon(options: Options) { return new ExecutorDaemon(options); }
class ExecutorDaemon {
  constructor(readonly options: Options) { this.journal = options.journal; this.client = options.client; this.fence = options.fence; this.spool = new ExecutorSpool(options.journal); }
  readonly journal: ExecutorJournal;
  readonly client: Client;
  readonly fence: ExecutorFence;
  readonly spool: ExecutorSpool;
  readonly active = new Map<string, Active>();
  readonly questions = new Map<string, { interactionId: string | null; resolve(answer: ProviderAnswer): void; reply?: ExecutorResponses["poll"]["questions"][number] }>();
  closed = false;
  reconciled = false;
  readonly request = () => ({ v: EXECUTOR_PROTOCOL, requestId: randomUUID(), ...this.fence });
  readonly units = () => readdirSync(this.journal.directory).filter(name => /^chrona-executor-[a-f0-9]{64}\.service\.json$/.test(name)).sort().map(name => name.slice(0, -5));
  readonly stop = async (item: Active) => {
    item.stopped = true; clearTimeout(item.timer);
    await item.run.abort();
  };
  arm(item: Active) {
    clearTimeout(item.timer);
    item.timer = setTimeout(() => { void this.stop(item).catch(() => {}); }, Math.max(0, item.expires - Date.now()));
  }
  async sendFinal(unit: string, finalOnly = false, signal?: AbortSignal) {
    const value = this.journal.read(unit)!;
    if (!value.journal.final || value.ack?.stopConfirmed) return;
    if (!finalOnly && value.journal.identity && value.journal.assignment.incarnation === this.fence.incarnation) {
      try { await this.client.request("report", { ...this.request(), target: ref(value.journal.assignment), records: [], started: { identity: value.journal.identity, launchDigest: value.journal.launchDigest, sourceReceipt: value.journal.final.sourceReceipt } }); }
      catch (error) { if (!(error instanceof ExecutorRequestError) || !["forbidden", "cursor_expired"].includes(error.code)) throw error; }
    }
    const receipt = await this.client.request("final", { ...this.request(), digest: value.journal.finalDigest!, final: value.journal.final }, signal);
    if (receipt.digest !== value.journal.finalDigest) throw new Error("Final receipt digest mismatch");
    this.journal.acknowledgeFinal(unit, receipt.digest, receipt.stopConfirmed);
  }
  finishPrelaunch(unit: string) {
    let saved = this.journal.read(unit)!;
    if (saved.launchState !== "prelaunch" || saved.journal.final) return saved;
    if (this.spool.read(unit).produced !== 0) {
      return this.journal.write({ ...saved, launchState: "unknown", journal: { ...saved.journal, phase: "unknown" } });
    }
    saved = this.journal.neverStarted(unit);
    const assignment = saved.journal.assignment;
    const final = executorFinalSchema.parse({ ...ref(assignment), throughSourceSeq: this.spool.read(unit).produced, baseline: assignment.mapping.baseline, launchDigest: saved.journal.launchDigest,
      outcome: { outcome: "unavailable", sessionId: null, error: "Executor stopped before launch" }, finalMessage: null, missing: false, sourceReceipt: null,
      stop: { kind: "never_started", tombstoneDigest: saved.journal.tombstoneDigest } });
    return this.journal.final(unit, final);
  }
  finishRecovered(unit: string) {
    const value = this.journal.read(unit)!;
    if (value.journal.final || !value.observation || !value.journal.identity) return;
    if (!value.prepared && value.journal.assignment.source?.files.length) return;
    const assignment = value.journal.assignment;
    const raw: ExecutorFinal = { ...ref(assignment), launchDigest: value.journal.launchDigest, baseline: assignment.mapping.baseline,
      throughSourceSeq: Math.max(value.journal.sourceAck, this.spool.read(unit).produced), sourceReceipt: value.prepared?.sourceReceipt ?? null,
      outcome: { outcome: "unavailable", sessionId: null, error: "Executor recovered after interrupted execution" }, finalMessage: null, missing: true, stop: managerStopProof(value.observation) };
    this.journal.final(unit, executorFinalSchema.parse(raw));
  }
  async reconcile() {
    const snapshot = this.units().map(unit => {
      this.finishPrelaunch(unit);
      recoverExecutorProcess(this.journal, unit);
      this.finishRecovered(unit);
      const value = this.journal.read(unit)!;
      this.options.prepareWorkspace.recover?.(value);
      const entry: ExecutorRequests["reconcile"]["entries"][number] = { target: ref(value.journal.assignment), launchDigest: value.journal.launchDigest, phase: value.journal.final ? "final" : "unknown", sourceAck: value.journal.sourceAck,
        ...(value.ack && value.journal.finalDigest ? { finalDigest: value.journal.finalDigest } : {}), ...(value.observation ? { stop: managerStopProof(value.observation) } : value.journal.final?.stop.kind === "never_started" ? { stop: value.journal.final.stop } : {}) };
      return entry;
    });
    let after: string | null = null, offset = 0;
    do {
      const entries = snapshot.slice(offset, offset + EXECUTOR_LIMITS.reconcileEntries); offset += entries.length;
      const result: ExecutorResponses["reconcile"] = await this.client.request("reconcile", { ...this.request(), after, entries, complete: offset === snapshot.length });
      after = result.after;
      for (const decision of result.decisions) {
        const value = this.units().map(unit => this.journal.read(unit)!).find(row => row.journal.assignment.assignmentId === decision.target.assignmentId);
        if (!value) continue;
        if (decision.action === "ack_final") continue;
        if (value.journal.final) await this.sendFinal(value.unit);
        // Recovery cannot restart Pi. Stop of a retained invocation uses trusted manager identity only.
        if (decision.action === "stop" && !value.observation) stopRecoveredExecutorProcess(this.journal, value.unit);
        recoverExecutorProcess(this.journal, value.unit);
        this.finishRecovered(value.unit);
        this.options.prepareWorkspace.recover?.(this.journal.read(value.unit)!);
        if (this.journal.read(value.unit)!.journal.final) await this.sendFinal(value.unit, true);
      }
      this.reconciled = result.reconciled;
    } while (after !== null);
    if (this.reconciled) this.spool.retire(new Date());
    return this.reconciled;
  }
  async launch(assignment: ExecutorAssignment, remainingMs: number, startedAt: number) {
    const unit = assignmentUnit(assignment);
    if (this.journal.read(unit)) return; // Lost launch ACK never repeats an attempt.
    if (this.active.size >= EXECUTOR_LIMITS.codingEnvironment || this.closed) throw new Error("Device launch capacity unavailable");
    const beginSpawn = this.journal.prepareLaunch(assignment);
    let prepared: Prepared;
    try {
      prepared = await this.options.prepareWorkspace(assignment, lock => { this.journal.recordWorkspaceLock(unit, lock); });
    } catch (error) {
      const saved = this.finishPrelaunch(unit);
      this.options.prepareWorkspace.recover?.(saved);
      throw error;
    }
    this.journal.prepared(unit, prepared.sourceReceipt);
    if (Date.now() >= Math.min(Date.parse(assignment.deadlineAt), startedAt + remainingMs)) { this.finishPrelaunch(unit); prepared.release(); throw new Error("Launch authorization expired during workspace preparation"); }
    let bridge: ReturnType<typeof createExecutorBridge>;
    try { bridge = createExecutorBridge(); }
    catch (error) { this.finishPrelaunch(unit); prepared.release(); throw error; }
    let entry: Active | undefined;
    try {
      const provider = createPiProvider({ ...this.options.provider, agentUrl: bridge.agentUrl, launch: input => { this.spool.reserve(unit); return createExecutorLauncher(this.journal, assignment, beginSpawn, this.options.processEntry)(input); } });
      const sessionDir = join(this.journal.directory, `session-${localDigest(ref(assignment))}`);
      mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      let missing = false;
      let finalMessage: ExecutorFinal["finalMessage"] = null;
      const append = (item: Parameters<ExecutorSpool["append"]>[1]) => { missing = this.spool.append(unit, item) || missing; };
      const run = provider.start({ runId: assignment.runId, token: bridge.token, lane: "background", cwd: prepared.cwd, sessionDir, sessionId: null, prompt: assignment.goal, deadline: new Date(assignment.deadlineAt), model: this.options.provider.model,
        execution: { workId: assignment.workId, sessionId: assignment.sessionId, runId: assignment.runId, attemptId: assignment.attemptId }, executionBudget: { maxToolCalls: assignment.budget.maxToolCalls },
        detail: { append: async event => {
          if (event.payload.type === "gap") { append({ kind: "gap", throughSourceSeq: this.spool.read(unit).produced + 1, reason: "backpressure" }); return; }
          const parsed = executorDetailSchema.safeParse(event.payload);
          if (parsed.success) append({ kind: "detail", payload: parsed.data });
          if (event.payload.type === "message" && event.payload.role === "assistant" && event.payload.complete) finalMessage = { messageId: event.payload.messageId, text: event.payload.text, truncated: false };
        } },
        events: { async progress(value) { append({ kind: "progress", value }); }, async usage(value) { append({ kind: "usage", value }); }, async resources(value) { append({ kind: "resources", value }); },
          question: async (value, signal) => {
            const questionKey = randomUUID();
            let resolve!: (answer: ProviderAnswer) => void;
            const answer = new Promise<ProviderAnswer>(done => { resolve = done; });
            const pending: { interactionId: string | null; resolve(answer: ProviderAnswer): void; reply?: ExecutorResponses["poll"]["questions"][number] } = { interactionId: null, resolve }; this.questions.set(questionKey, pending);
            const abort = () => { this.questions.delete(questionKey); resolve({ decision: "cancel" }); };
            signal.addEventListener("abort", abort, { once: true });
            try {
              const receipt = await this.client.request("question", { ...this.request(), target: ref(assignment), questionKey, value }, signal);
              pending.interactionId = receipt.requestId;
              if (pending.reply?.requestId === receipt.requestId) {
                if (pending.reply.state === "answer") resolve(pending.reply.answer);
                else if (pending.reply.state === "interrupted") abort();
              }
              if (receipt.state === "interrupted") abort();
              return await answer;
            } finally { signal.removeEventListener("abort", abort); this.questions.delete(questionKey); }
          } },
      });
      entry = { assignment, run, stopped: false, expires: Math.min(Date.parse(assignment.deadlineAt), startedAt + remainingMs, startedAt + EXECUTOR_LIMITS.graceMs), timer: setTimeout(() => {}, 0), release: prepared.release, sourceReceipt: prepared.sourceReceipt };
      this.active.set(assignment.assignmentId, entry); this.arm(entry);
      entry.finalizing = run.done.then(async outcome => {
        const saved = this.finishPrelaunch(unit);
        if (saved.journal.final?.stop.kind === "never_started") {
          prepared.release(); clearTimeout(entry!.timer); this.active.delete(assignment.assignmentId); return;
        }
        const observation = saved.observation;
        const rawFinal: ExecutorFinal = { ...ref(assignment), throughSourceSeq: this.spool.read(unit).produced, baseline: assignment.mapping.baseline, launchDigest: saved.journal.launchDigest, outcome, finalMessage, missing, sourceReceipt: prepared.sourceReceipt,
          ...(observation ? { changes: await this.options.captureWorkspaceChanges(prepared.cwd, assignment.mapping.baseline) } : {}), stop: observation ? managerStopProof(observation) : { kind: "unknown", reason: "Owned stop observation unavailable" } };
        const display = this.options.canonicalFinal(rawFinal, [bridge.token]);
        const final = executorFinalSchema.parse({ ...rawFinal, finalMessage: display.finalMessage, outcome: display.outcome });
        this.journal.final(unit, final);
        if (observation) { prepared.release(); clearTimeout(entry!.timer); this.active.delete(assignment.assignmentId); }
      }).catch(() => { /* Durable intent/final remains for explicit reconciliation; no relaunch. */ }).finally(() => bridge.close());
    } catch (error) {
      bridge.close();
      const saved = this.finishPrelaunch(unit);
      if (saved.journal.final?.stop.kind === "never_started") prepared.release();
      throw error;
    }
  }
  // eslint-disable-next-line complexity -- Preserve fixed-device polling and cleanup-before-launch ordering.
  async poll() {
    if (this.closed || !this.reconciled) throw new Error("Device must reconcile before polling");
    const start = Date.now(), result = await this.client.request("poll", { ...this.request(), waitMs: EXECUTOR_LIMITS.pollMs });
    for (const item of this.active.values()) {
      if (item.stopped) continue;
      item.expires = Math.min(Date.parse(item.assignment.deadlineAt), start + result.authorizedForMs);
      this.arm(item);
    }
    await this.consumeControls(result.controls);
    for (const operation of result.cleanupOperations ?? []) {
      if (!this.options.prepareWorkspace.cleanup || this.active.has(operation.target.assignmentId)) throw new Error("Cleanup workspace is unavailable or still active");
      const saved = this.units().map(unit => this.journal.read(unit)!).find(value => value.journal.assignment.assignmentId === operation.target.assignmentId);
      if (!saved || saved.journal.assignment.executorId !== this.fence.executorId || saved.journal.assignment.generation !== this.fence.generation || saved.journal.assignment.incarnation !== this.fence.incarnation) throw new Error("Cleanup device identity changed");
      this.options.prepareWorkspace.recover?.(saved);
      const pending = this.journal.cleanupOperation(saved.unit, operation);
      if (pending.result) continue;
      const receipt = await this.options.prepareWorkspace.cleanup(operation, () => this.journal.read(saved.unit)!);
      this.journal.cleanupResult(saved.unit, { commandKey: operation.input.commandKey, requestDigest: operation.requestDigest, receipt });
    }
    for (const reply of result.questions) {
      const pending = this.questions.get(reply.questionKey);
      if (!pending) continue;
      if (pending.interactionId === null) { pending.reply = reply; continue; }
      if (pending.interactionId !== reply.requestId) continue;
      if (reply.state === "answer") pending.resolve(reply.answer);
      else if (reply.state === "interrupted") pending.resolve({ decision: "cancel" });
    }
    await this.consumeLaunches(result, start);
  }
  async consumeLaunches(result: ExecutorResponses["poll"], start: number) {
    for (const descriptor of result.launches) {
      if (descriptor.launchDigest !== localDigest(descriptor.assignment) || descriptor.assignment.executorId !== this.fence.executorId || descriptor.assignment.incarnation !== this.fence.incarnation || descriptor.assignment.generation !== this.fence.generation) throw new Error("Launch binding mismatch");
      if (Date.now() - start >= descriptor.remainingMs || result.authorizedForMs <= Date.now() - start) continue;
      await this.launch(descriptor.assignment, Math.min(descriptor.remainingMs, result.authorizedForMs), start);
    }
  }
  async consumeControls(controls: ExecutorResponses["poll"]["controls"]) {
    for (const command of controls) {
      const item = this.active.get(command.target.assignmentId);
      if (!item || localDigest(ref(item.assignment)) !== localDigest(command.target)) continue;
      if (command.op === "cancel") { await this.stop(item); continue; }
      const unit = assignmentUnit(item.assignment), saved = this.journal.read(unit)!;
      if (saved.journal.consumedControls.some(row => row.commandKey === command.commandKey)) continue;
      if (saved.journal.consumedControls.length >= EXECUTOR_LIMITS.controlReceipts) throw new Error("Control receipt capacity reached");
      this.journal.write({ ...saved, journal: { ...saved.journal, consumedControls: [...saved.journal.consumedControls, { commandKey: command.commandKey, effect: "unknown" }] } });
      await item.run.inject(command.text);
      const delivered = this.journal.read(unit)!;
      this.journal.write({ ...delivered, journal: { ...delivered.journal, consumedControls: delivered.journal.consumedControls.map(row => row.commandKey === command.commandKey ? { ...row, effect: "delivered" as const } : row) } });
    }
  }
  async report() {
    for (const unit of this.units()) if (!this.active.has(this.journal.read(unit)!.journal.assignment.assignmentId)) {
      recoverExecutorProcess(this.journal, unit); this.finishRecovered(unit);
      this.options.prepareWorkspace.recover?.(this.journal.read(unit)!);
    }
    for (const unit of this.units()) if (this.journal.read(unit)!.journal.final) await this.sendFinal(unit);
    for (const unit of this.units()) {
      const saved = this.journal.read(unit)!;
      if (saved.journal.final || saved.journal.assignment.incarnation !== this.fence.incarnation) continue;
      const records = this.spool.batch(unit);
      if (!saved.journal.identity) continue;
      const receipt = await this.client.request("report", { ...this.request(), target: ref(saved.journal.assignment), records,
        started: { launchDigest: saved.journal.launchDigest, identity: saved.journal.identity, sourceReceipt: this.active.get(saved.journal.assignment.assignmentId)?.sourceReceipt ?? null }, consumed: saved.journal.consumedControls });
      this.spool.acknowledge(unit, receipt.acceptedThroughSourceSeq);
      const latest = this.journal.read(unit)!;
      this.journal.write({ ...latest, journal: { ...latest.journal, sourceAck: receipt.acceptedThroughSourceSeq, sourceProduced: this.spool.read(unit).produced } });
    }
    await this.reportCleanup();
  }
  async reportCleanup() {
    for (const unit of this.units()) {
      const value = this.journal.read(unit)!, assignment = value.journal.assignment;
      if (assignment.executorId !== this.fence.executorId || assignment.generation !== this.fence.generation || assignment.incarnation !== this.fence.incarnation) continue;
      for (const item of value.cleanup ?? []) {
        if (!item.result || item.reported) continue;
        await this.client.request("report", { ...this.request(), target: item.operation.target, records: [], cleanupResults: [item.result] });
        this.journal.acknowledgeCleanup(unit, item.result.commandKey, item.result.requestDigest);
      }
    }
  }
  async run(signal: AbortSignal) {
    await this.reconcile();
    if (!this.reconciled) throw new Error("Device reconciliation incomplete");
    const loop = async (operation: () => Promise<void>) => {
      while (!signal.aborted && !this.closed) {
        try { await operation(); } catch (error) {
          if (!(error instanceof ExecutorTransportError) && !(error instanceof ExecutorRequestError)) throw error;
          if (error instanceof ExecutorRequestError && error.code === "forbidden") { await this.close(); throw error; }
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, EXECUTOR_LIMITS.heartbeatMs);
          function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
      }
    };
    const close = () => { void this.close(); };
    signal.addEventListener("abort", close, { once: true });
    try { await Promise.all([loop(() => this.poll()), loop(() => this.report())]); }
    finally { signal.removeEventListener("abort", close); await this.close(); }
  }
  closing?: Promise<void>;
  async close() {
    if (this.closing) return this.closing;
    this.closing = this.closeAndDrain();
    return this.closing;
  }
  async closeAndDrain() {
    this.closed = true; this.reconciled = false;
    for (const pending of this.questions.values()) pending.resolve({ decision: "cancel" });
    const active = [...this.active.values()];
    await Promise.all(active.map(this.stop));
    await Promise.all(active.map(item => item.finalizing));
    await this.drainFinals();
  }
  async drainFinals() {
    await drainExecutorFinals({ client: this.client, fence: this.fence, journal: this.journal });
  }
}

/** Final-only recovery uses the original credential/fence and never reads a profile or starts a process. */
// eslint-disable-next-line complexity -- Every unacknowledged original journal must contribute to the explicit drain result.
export async function drainExecutorFinals(input: { client: Client; fence: ExecutorFence; journal: ExecutorJournal }): Promise<void> {
  const signal = AbortSignal.timeout(EXECUTOR_LIMITS.requestTimeoutMs);
  let incomplete = false;
  const units = readdirSync(input.journal.directory).filter(name => /^chrona-executor-[a-f0-9]{64}\.service\.json$/.test(name));
  for (const name of units) {
    const unit = name.slice(0, -5), value = input.journal.read(unit)!;
    if (value.ack?.stopConfirmed) continue;
    const assignment = value.journal.assignment;
    if (signal.aborted || !value.journal.final || !value.journal.finalDigest || assignment.executorId !== input.fence.executorId || assignment.generation !== input.fence.generation || assignment.incarnation !== input.fence.incarnation) { incomplete = true; continue; }
    try {
      const receipt = await input.client.request("final", { v: EXECUTOR_PROTOCOL, requestId: randomUUID(), ...input.fence, digest: value.journal.finalDigest, final: value.journal.final }, signal);
      if (receipt.digest !== value.journal.finalDigest) throw new Error("Final receipt mismatch");
      input.journal.acknowledgeFinal(unit, receipt.digest, receipt.stopConfirmed);
      if (!receipt.stopConfirmed) incomplete = true;
    } catch { incomplete = true; }
  }
  if (incomplete) throw new Error("Executor final drain remains unconfirmed");
}
