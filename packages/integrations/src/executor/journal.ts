import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXECUTOR_LIMITS, executorCleanupOperationSchema, executorCleanupResultSchema, type ExecutorCleanupOperation, type ExecutorCleanupResult, executorCanonicalJson, executorJournalSchema, executorProcessIdentitySchema, executorStopProofSchema, executionSourceReceiptSchema, type ExecutionSourceReceipt, type ExecutorAssignment, type ExecutorFinal } from "@chrona/contracts/steward";

export const localDigest = (value: unknown) => createHash("sha256").update(executorCanonicalJson(value)).digest("hex");
export const assignmentUnit = (assignment: ExecutorAssignment) => `chrona-executor-${localDigest({ executorId: assignment.executorId, assignmentId: assignment.assignmentId })}.service`;
const observationSchema = z.object({ assignmentId: z.string().min(1).max(200), launchDigest: z.string().regex(/^[a-f0-9]{64}$/), identity: executorProcessIdentitySchema, observedAt: z.string().datetime(), properties: z.record(z.string(), z.string()), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const cleanupSchema = z.object({ operation: executorCleanupOperationSchema, result: executorCleanupResultSchema.nullable(), reported: z.boolean(), reservation: z.string().length(2048).optional() }).strict();
const localSchema = z.object({ cleanup: z.array(cleanupSchema).max(EXECUTOR_LIMITS.controlReceipts).optional(), supervisionRoot: z.string().regex(/^[a-f0-9]{64}$/).optional(), prepared: z.object({ sourceReceipt: executionSourceReceiptSchema.nullable() }).strict().optional(), workspaceLocks: z.array(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2).default([]), launchState: z.enum(["prelaunch", "spawn_possible", "unknown"]).default("unknown"), signals: z.array(z.object({ signal: z.string().max(20), at: z.string().datetime() }).strict()).max(4).default([]), version: z.literal(1), unit: z.string(), journal: executorJournalSchema, ack: z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), at: z.string().datetime(), stopConfirmed: z.boolean() }).nullable().default(null), observation: observationSchema.nullable() }).strict();
export const prelaunchTombstone = (assignment: ExecutorAssignment) => localDigest({ kind: "executor_prelaunch_never_started", target: { workId: assignment.workId, sessionId: assignment.sessionId, runId: assignment.runId, attemptId: assignment.attemptId, assignmentId: assignment.assignmentId, generation: assignment.generation }, launchDigest: localDigest(assignment) });
export type LocalJournal = z.infer<typeof localSchema>;
export type ManagerObservation = z.infer<typeof observationSchema>;
const MAX_BYTES = EXECUTOR_LIMITS.terminalBytes + EXECUTOR_LIMITS.launchBytes + EXECUTOR_LIMITS.proofBytes;

function validateObservation(observation: ManagerObservation) {
  const expected = { Id: observation.identity.unit, InvocationID: observation.identity.invocationId, ExitType: "cgroup", RemainAfterExit: "yes", KillMode: "control-group", MainPID: "0" };
  if (Object.entries(expected).some(([key, value]) => observation.properties[key] !== value)) throw new Error("Journal lacks manager terminal proof");
  const p = observation.properties;
  const normal = p.ActiveState === "active" && p.SubState === "exited";
  const failed = p.LoadState === "loaded" && p.ActiveState === "failed" && p.SubState === "failed" && p.ControlGroup === "" && ["empty", "removed"].includes(p.KernelCgroupState!);
  if (!normal && !failed) throw new Error("Journal lacks complete manager cgroup proof");
}
function validateFinal(journal: LocalJournal["journal"]) {
  const final = journal.final;
  if (!final) return;
  const keys = ["workId", "sessionId", "runId", "attemptId", "assignmentId", "generation"] as const;
  if (journal.finalDigest !== localDigest(final) || final.launchDigest !== journal.launchDigest || keys.some(key => final[key] !== journal.assignment[key])) throw new Error("Journal final binding mismatch");
}
function validateObservationBinding(observation: ManagerObservation, journal: LocalJournal["journal"]) {
  const { digest, ...binding } = observation;
  if (observation.assignmentId !== journal.assignment.assignmentId || observation.launchDigest !== journal.launchDigest || digest !== localDigest(binding) || executorCanonicalJson(observation.identity) !== executorCanonicalJson(journal.identity)) throw new Error("Journal observation binding mismatch");
}
function validatePrelaunch(value: LocalJournal) {
  const { journal, observation } = value;
  if (value.launchState === "prelaunch" && [journal.identity, observation, journal.sourceAck, journal.sourceProduced, value.signals.length, journal.consumedControls.length].some(Boolean)) throw new Error("Prelaunch journal has process evidence");
  if (journal.tombstoneDigest && (value.launchState !== "prelaunch" || journal.tombstoneDigest !== prelaunchTombstone(journal.assignment))) throw new Error("Invalid prelaunch tombstone");
  if (journal.final?.stop.kind === "never_started" && journal.final.stop.tombstoneDigest !== journal.tombstoneDigest) throw new Error("Final tombstone mismatch");
}
function validateCleanup(value: LocalJournal) {
  const keys = new Set<string>();
  for (const item of value.cleanup ?? []) {
    const { requestDigest, ...operation } = item.operation;
    const invalidOperation = [keys.has(operation.input.commandKey), localDigest(operation) !== requestDigest,
      operation.launchDigest !== value.journal.launchDigest, operation.workspaceRef !== value.journal.assignment.workspaceRef,
      Object.entries(operation.target).some(([key, field]) => field !== value.journal.assignment[key as keyof typeof operation.target])].some(Boolean);
    if (invalidOperation) throw new Error("Cleanup journal operation binding mismatch");
    keys.add(operation.input.commandKey);
    if (item.result) {
      const invalidReceipt = [item.result.requestDigest !== requestDigest, item.result.commandKey !== operation.input.commandKey,
        item.result.receipt.workId !== operation.input.workId, item.result.receipt.workspaceRef !== operation.workspaceRef,
        item.reservation !== undefined, Buffer.byteLength(executorCanonicalJson(item.result)) > 2048].some(Boolean);
      if (invalidReceipt) throw new Error("Cleanup journal receipt binding mismatch");
    } else if (item.reservation?.length !== 2048 || item.reported) throw new Error("Cleanup journal receipt headroom missing");
  }
}
function validateCleanupTransition(previous: LocalJournal, value: LocalJournal) {
  for (const [index, old] of (previous.cleanup ?? []).entries()) {
    const next = value.cleanup?.[index];
    if (!next || localDigest(old.operation) !== localDigest(next.operation) || old.result && localDigest(old.result) !== localDigest(next.result) || old.reported && !next.reported) throw new Error("Cleanup journal facts are immutable");
  }
}
function validate(raw: unknown): LocalJournal {
  const value = localSchema.parse(raw), { journal, observation } = value;
  if (value.unit !== assignmentUnit(journal.assignment) || journal.launchDigest !== localDigest(journal.assignment)) throw new Error("Journal launch binding mismatch");
  if (journal.identity && journal.identity.unit !== value.unit) throw new Error("Journal unit mismatch");
  validatePrelaunch(value);
  validateCleanup(value);
  validateFinal(journal);
  if (value.ack && value.ack.digest !== journal.finalDigest) throw new Error("Journal ACK binding mismatch");
  if (observation) {
    validateObservation(observation); validateObservationBinding(observation, journal);
    if (observation.properties.ActiveState === "failed" && (!value.supervisionRoot || observation.properties.KernelCgroupRoot !== value.supervisionRoot)) throw new Error("Journal failed proof lacks original cgroup mount");
  }
  return value;
}

// eslint-disable-next-line complexity -- Original launch, preparation, final and physical-lock facts are immutable across recovery.
function validateTransition(previous: LocalJournal | null, value: LocalJournal) {
  if (!previous) return;
  validateCleanupTransition(previous, value);
  if (previous.journal.launchDigest !== value.journal.launchDigest) throw new Error("Original assignment is immutable");
  if (previous.supervisionRoot && previous.supervisionRoot !== value.supervisionRoot) throw new Error("Supervisor mount identity is immutable");
  if (previous.prepared && localDigest(previous.prepared) !== localDigest(value.prepared ?? null)) throw new Error("Prepared source receipt is immutable");
  if (previous.journal.finalDigest && previous.journal.finalDigest !== value.journal.finalDigest) throw new Error("Final is immutable");
  if (previous.launchState !== "prelaunch" && value.launchState === "prelaunch") throw new Error("Spawn fence cannot be reversed");
  if (previous.workspaceLocks.some((lock, index) => localDigest(lock) !== localDigest(value.workspaceLocks[index] ?? null))) throw new Error("Workspace lock binding is immutable");
  if (previous.journal.tombstoneDigest && previous.journal.tombstoneDigest !== value.journal.tombstoneDigest) throw new Error("Tombstone is immutable");
}

/** One trusted writer; no credentials, RPC records or answers. Spool allocation belongs to R. */
export class ExecutorJournal {
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("Journal directory must be private");
  }
  private path(unit: string) {
    if (!/^chrona-executor-[a-f0-9]{64}\.service$/.test(unit)) throw new Error("Invalid journal unit");
    return join(this.directory, `${unit}.json`);
  }
  read(unit: string): LocalJournal | null {
    const path = this.path(unit);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > MAX_BYTES) throw new Error("Unsafe journal file");
    return validate(JSON.parse(readFileSync(path, "utf8")));
  }
  write(raw: LocalJournal): LocalJournal {
    const value = validate(raw), body = executorCanonicalJson(value), path = this.path(value.unit);
    const previous = this.read(value.unit);
    validateTransition(previous, value);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Journal byte capacity reached");
    this.capacity(path, Buffer.byteLength(body));
    const temporary = `${path}.next`, fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const directory = openSync(this.directory, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return value;
  }
  private capacity(path: string, bytes: number) {
    let metadata = bytes, total = bytes;
    for (const name of readdirSync(this.directory)) {
      const other = join(this.directory, name);
      if (other === path) continue;
      const stat = lstatSync(other);
      if (!stat.isFile()) continue;
      if (stat.isSymbolicLink()) throw new Error("Unsafe device metadata");
      total += stat.size;
      if (name.endsWith(".json")) metadata += stat.size;
    }
    if (metadata > EXECUTOR_LIMITS.deviceReceiptBytes || total > EXECUTOR_LIMITS.deviceSpoolBytes) throw new Error("Device journal aggregate capacity reached");
  }
  cleanupOperation(unit: string, operation: ExecutorCleanupOperation) {
    const value = this.read(unit);
    if (!value) throw new Error("Cleanup journal missing");
    const old = value.cleanup?.find(item => item.operation.input.commandKey === operation.input.commandKey);
    if (old) {
      if (localDigest(old.operation) !== localDigest(operation)) throw new Error("Cleanup command key conflict");
      return old;
    }
    // Actual durable padding reserves bounded receipt bytes before any filesystem effect.
    const item = { operation, result: null, reported: false, reservation: " ".repeat(2048) };
    this.write({ ...value, cleanup: [...value.cleanup ?? [], item] });
    return item;
  }
  cleanupResult(unit: string, result: ExecutorCleanupResult) {
    const value = this.read(unit);
    if (!value?.cleanup?.some(item => item.operation.input.commandKey === result.commandKey)) throw new Error("Cleanup operation missing");
    this.write({ ...value, cleanup: value.cleanup.map(item => item.operation.input.commandKey === result.commandKey ? { operation: item.operation, result, reported: item.reported } : item) });
  }
  acknowledgeCleanup(unit: string, commandKey: string, requestDigest: string) {
    const value = this.read(unit);
    if (!value?.cleanup?.some(item => item.result && item.result.commandKey === commandKey && item.result.requestDigest === requestDigest)) throw new Error("Cleanup receipt missing");
    this.write({ ...value, cleanup: value.cleanup.map(item => item.operation.input.commandKey === commandKey ? { ...item, reported: true } : item) });
  }
  acknowledgeFinal(unit: string, digest: string, stopConfirmed: boolean) {
    const value = this.read(unit);
    if (!value || value.journal.finalDigest !== digest) throw new Error("Final ACK binding mismatch");
    if (value.ack?.stopConfirmed && !stopConfirmed) throw new Error("Final ACK cannot weaken stop");
    return this.write({ ...value, ack: { digest, stopConfirmed, at: value.ack?.at ?? new Date().toISOString() } });
  }
  intent(assignment: ExecutorAssignment, prelaunch = false): LocalJournal {
    const unit = assignmentUnit(assignment);
    if (this.read(unit)) throw new Error("Assignment already journaled; reconcile without relaunch");
    if (readdirSync(this.directory).filter(name => name.endsWith(".json")).length >= EXECUTOR_LIMITS.assignmentRecords) throw new Error("Journal assignment capacity reached");
    return this.write({ workspaceLocks: [], launchState: prelaunch ? "prelaunch" : "unknown", version: 1, unit, signals: [], ack: null, observation: null, journal: { assignment, launchDigest: localDigest(assignment), phase: "intent", identity: null, sourceAck: 0, sourceProduced: 0, consumedControls: [], final: null, finalDigest: null, tombstoneDigest: null } });
  }
  recordWorkspaceLock(unit: string, lock: LocalJournal["workspaceLocks"][number]) {
    const value = this.read(unit);
    if (!value || value.launchState !== "prelaunch" || value.journal.tombstoneDigest) throw new Error("Workspace lock requires prelaunch journal");
    return this.write({ ...value, workspaceLocks: [...value.workspaceLocks, lock] });
  }
  prepareLaunch(assignment: ExecutorAssignment) {
    const prepared = this.intent(assignment, true);
    let used = false;
    return () => {
      const value = this.read(prepared.unit)!;
      if (used || value.launchState !== "prelaunch" || value.journal.tombstoneDigest || value.journal.final) throw new Error("Launch permit unavailable");
      used = true;
      return this.write({ ...value, launchState: "spawn_possible" });
    };
  }
  prepared(unit: string, sourceReceipt: ExecutionSourceReceipt | null) {
    const value = this.read(unit);
    if (!value || value.launchState !== "prelaunch") throw new Error("Prepared source must precede spawn");
    return this.write({ ...value, prepared: { sourceReceipt } });
  }
  neverStarted(unit: string) {
    const value = this.read(unit);
    if (!value || value.launchState !== "prelaunch") throw new Error("Launch possibility unknown");
    return this.write({ ...value, journal: { ...value.journal, tombstoneDigest: prelaunchTombstone(value.journal.assignment) } });
  }
  final(unit: string, final: ExecutorFinal) {
    const value = this.read(unit);
    if (!value) throw new Error("Journal missing");
    const digest = localDigest(final);
    if (value.journal.final) {
      if (value.journal.finalDigest !== digest) throw new Error("Final is immutable");
      return value;
    }
    return this.write({ ...value, journal: { ...value.journal, phase: "final", final, finalDigest: digest } });
  }
}

export function managerStopProof(observation: ManagerObservation) {
  return executorStopProofSchema.parse({ kind: "cgroup_empty", identity: observation.identity, observedAt: observation.observedAt, observer: "systemd_tracked", populated: 0, observationDigest: observation.digest });
}
