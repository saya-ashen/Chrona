import { randomUUID } from "node:crypto";
import {redactSensitiveText} from './core-redaction';
import { CoreMindStore, CoreTransaction, canonical, coreDigest, evidenceId, objectRetractionId, sessionRetractionId } from "./core-store";
import { isChatEvidence } from "./core-sources";
import { CoreError, type ActionRecord, type ApplyProgressInput, type ClaimInput, type ContextInput, type ContextResult,
  type ControlInput, type CoreAccess, type CoreRecords, type CoreSettings, type Evidence, type FeedbackInput,
  type ForgetInput, type GuardActionInput, type IngestBatch, type Mutation, type OverviewInput, type OverviewResult,
  type ProgressInput, type PursueInput, type Pursuit, type Receipt, type RecordKind, type ReleaseInput,
  type RememberInput, type Scope, type Understanding } from "./core-types";

const fail = (code: CoreError["code"], message: string): never => { throw new CoreError(code, message); };
const unique = (values: string[]) => [...new Set(values)];
const DAY = 86_400_000;
export const scopeCovers = (outer: Scope, inner: Scope): boolean =>
  (!outer.projectId || outer.projectId === inner.projectId) && (!outer.sessionId || outer.sessionId === inner.sessionId);
export function scopeValid(scope: unknown): asserts scope is Scope {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).some(k => k !== "projectId" && k !== "sessionId")) fail("INVALID_INPUT", 'Invalid scope: use {}, {projectId:"id"}, {sessionId:"id"}, or both; no other keys');
  for (const value of Object.values(scope as Record<string,unknown>)) text(value, "scope identifier", 512);
}
function text(value: unknown, name: string, max = 8192): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) fail("INVALID_INPUT", `Invalid ${name}`);
}
function version(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || actual !== expected) fail("CONFLICT", `Version mismatch: expected ${expected}, current ${actual}`);
}
function validateAccess(value: unknown): asserts value is CoreAccess {
  const access = value as CoreAccess | null | undefined;
  if (!access || !access.subject || !["owner", "application", "runtime"].includes(access.role) || !Array.isArray(access.scopes)) {
    fail("FORBIDDEN", "Trusted caller access is required");
  }
}
function authorized(access: CoreAccess, scope?: Scope) {
  validateAccess(access);
  if (scope) { scopeValid(scope); if (!access.scopes.some(grant => scopeCovers(grant, scope))) fail("FORBIDDEN", "Caller scope does not cover object"); }
}
function privileged(access: CoreAccess, role: "owner" | "runtime") {
  authorized(access); if (access.role !== role) fail("FORBIDDEN", `${role} caller required`);
}
function readable(access: CoreAccess, scope: Scope) { return access.scopes.some(grant => scopeCovers(grant, scope)); }
function get<K extends RecordKind>(tx: CoreTransaction, kind: K, id: string): CoreRecords[K] {
  return tx.get(kind, id) ?? fail("NOT_FOUND", `${kind} not found`);
}

/** Business policy only. The adapter authenticates callers, source snapshots and verifier inputs. No method executes effects. */
export class CoreMindService {
  private readonly now: () => string;
  constructor(readonly store: CoreMindStore, options: { now?: () => string } = {}) { this.now = options.now ?? (() => new Date().toISOString()); }
  private mutate<T>(operation: string, input: Mutation, access: CoreAccess, apply: (tx: CoreTransaction, now: string) => T,
    beforeReceipt?: (tx: CoreTransaction) => void): Receipt<T> {
    authorized(access); text(input.actionKey, "actionKey", 512);
    if (access.role !== 'owner' && ['remember','pursue','control','feedback'].includes(operation)
      && access.semanticAdmission?.digest !== coreDigest({operation,input})) {
      fail('FORBIDDEN','A grounded independent semantic admission is required; a live user reference alone does not authorize its claimed meaning');
    }
    const now = this.now();
    return this.store.update(tx => {
      tx.authorizeValue(input, scope => authorized(access, scope));
      beforeReceipt?.(tx);
      return tx.receipt({ subject: access.subject, actionKey: input.actionKey,
        args: { operation, input, role: access.role, execution: access.execution ?? null }, now,
        apply: () => { version(tx.meta().visibilityRevision, input.expectedVisibilityRevision); return apply(tx, now); },
        authorizeCached: value => tx.authorizeValue(value, scope => authorized(access, scope)) });
    });
  }
  private active(tx: CoreTransaction, learning = false) {
    const settings = tx.settings();
    if (settings.restoreBlocked) fail("RESTORE_BLOCKED", "Retraction ledger is unverified after restore; reconcile before ingest or action");
    if (!settings.enabled || (learning && !settings.learningEnabled)) fail("FORBIDDEN", "Mind or learning is paused");
  }
  private refs(tx: CoreTransaction, ids: string[], access: CoreAccess): Evidence[] {
    if (!Array.isArray(ids) || ids.length > 100) fail("INVALID_INPUT", "Expected bounded evidence references");
    return unique(ids).map(id => {
      text(id, "evidence reference", 512);
      const item = get(tx, "evidence", id); authorized(access, item.scope);
      if (item.retractedAt || item.expiredAt) fail("CONFLICT", "Evidence is retracted or expired");
      if(item.sourceIdentity!=='owner'&&item.sourceIdentity!=='mind-owner'&&!tx.list('checkpoint').some(cp=>cp.sourceIdentity===item.sourceIdentity&&cp.epoch===item.epoch&&cp.scopeRevision===item.scopeRevision&&cp.coverage.complete))fail('CONFLICT','Evidence source coverage is incomplete or has changed');
      return item;
    });
  }
  private userRefs(tx: CoreTransaction, ids: string[], access: CoreAccess,
    request: { scope: Scope; actionKey: string; content: string; now: string }): string[] {
    const { scope, actionKey, content, now } = request;
    const refs = this.refs(tx, ids, access);
    if (refs.some(item => item.actor === "user" && !item.origin.pursuitId && scopeCovers(item.scope, scope))) return unique(ids);
    if (access.role !== "owner") fail("FORBIDDEN", "Explicit user evidence in the applicable scope is required");
    const id = evidenceId("mind-owner", "1", coreDigest([access.subject, actionKey]));
    tx.put("evidence", { id, revision: 1, createdAt: now, updatedAt: now, sourceIdentity: "mind-owner", epoch: "1", eventId: id,
      cursor: id, object: { kind: "owner-input", id, revision: 1 }, kind: "message", scope, actor: "user", origin: { rootId: id },
      occurredAt: now, receivedAt: now, scopeRevision: 0, content: { text: redactSensitiveText(content,Number.MAX_SAFE_INTEGER), truncated: false },
      visibilityRevision: tx.meta().visibilityRevision, sourceDigest: coreDigest(content) });
    return unique([...ids, id]);
  }
  private linked(tx: CoreTransaction, refs: string[], access: CoreAccess, scope: Scope) {
    for (const item of this.refs(tx, refs, access)) if (!scopeCovers(item.scope, scope)) fail("FORBIDDEN", "Evidence from a narrower or different scope cannot establish a broader claim");
  }
  private owned(tx: CoreTransaction, input: ClaimInput, access: CoreAccess): Pursuit {
    this.active(tx);
    const pursuit = get(tx, "pursuit", input.pursuitId); authorized(access, pursuit.scope); version(pursuit.revision, input.expectedRevision);
    if (pursuit.paused || ["done", "ended"].includes(pursuit.status)) fail("CONFLICT", "Pursuit is paused or closed");
    this.refs(tx,pursuit.evidenceRefs,access);
    if (!access.execution || pursuit.currentActor?.actor !== access.execution.actor || pursuit.currentActor.runRef !== access.execution.runRef || pursuit.currentActor.stopRequested) fail("FORBIDDEN", "Current execution does not hold responsibility");
    return pursuit;
  }
  ingest(input: IngestBatch, access: CoreAccess) {
    privileged(access, "runtime"); text(input.sourceIdentity, "source identity", 512); text(input.epoch, "source epoch", 512);
    text(input.nextCursor, "next cursor", 512);
    if (!Array.isArray(input.events) || input.events.length > 50 || Buffer.byteLength(canonical(input.events)) > 65536) fail("INVALID_INPUT", "Source batch exceeds bounds");
    const now = this.now();
    return this.store.update(tx => {
      this.active(tx, true);
      const id = input.sourceIdentity, previous = tx.get("checkpoint", id), batchDigest = coreDigest(input);
      if (previous?.batchDigest === batchDigest) return previous;
      this.validateCheckpoint(tx, input, previous);
      for (const event of input.events) this.ingestEvent(tx, input, event, { access, now });
      return this.commitCheckpoint(tx, input, previous, batchDigest);
    });
  }
  private validateCheckpoint(tx: CoreTransaction, input: IngestBatch, previous: CoreRecords["checkpoint"] | undefined): void {
    if (previous && previous.epoch !== input.epoch && !input.identityContinuityVerified) {
      fail("RESTORE_BLOCKED", "Source epoch changed: verify stable object/session identities or reconcile retraction mappings before import");
    }
    version(previous?.revision ?? 0, input.expectedCheckpointRevision);
    if (!Number.isSafeInteger(input.scopeRevision) || input.scopeRevision < (previous?.scopeRevision ?? 0)) fail("CONFLICT", "Source scope revision regressed");
    if (tx.approximateBytes() >= tx.settings().maxDatabaseBytes) fail("CAPACITY", "Mind private storage is full; reclaim retained snippets before ingest");
  }
  private validateEvent(event: IngestBatch["events"][number], input: IngestBatch, access: CoreAccess): void {
    authorized(access, event.scope); text(event.id, "source event id", 512); text(event.object.id, "source object id", 512); text(event.object.kind, "source object kind", 128);
    if (!["user", "assistant", "application"].includes(event.actor) || !["message", "operation", "result", "correction", "retract", "scope-change"].includes(event.kind)) fail("INVALID_INPUT", "Invalid source event kind or actor");
    if (!Number.isSafeInteger(event.object.revision) || event.object.revision < 0 || event.scopeRevision > input.scopeRevision) fail("INVALID_INPUT", "Invalid source revision");
    this.validateSourceContent(event.content);
    if (![event.occurredAt, event.receivedAt].every(at => Number.isFinite(Date.parse(at)))) fail("INVALID_INPUT", "Invalid source timestamps");
  }
  private validateSourceContent(content: Evidence["content"]): void {
    if (content?.text && Buffer.byteLength(content.text) > 16384) fail("INVALID_INPUT", "Source text exceeds 16384 bytes");
    if (content?.artifactRefs && content.artifactRefs.length > 50) fail("INVALID_INPUT", "Too many source artifact references");
  }
  private ingestEvent(tx: CoreTransaction, input: IngestBatch, event: IngestBatch["events"][number],
    context: { access: CoreAccess; now: string }): void {
    const { access, now } = context; this.validateEvent(event, input, access);
    const fenceId=objectRetractionId(input.sourceIdentity,event.object.kind,event.object.id),fence=tx.get('retraction',fenceId);
    // Shared Chat conclusions remain forgettable by their originating conversation.
    // The verified adapter marker prevents another source sharing the same root ID
    // from being captured by this session fence.
    const chatRoot = isChatEvidence(event) ? event.origin.rootId : undefined;
    if ((event.scope.sessionId && tx.get('retraction', sessionRetractionId(event.scope.sessionId))) ||
        (chatRoot && tx.get('retraction', sessionRetractionId(chatRoot)))) return;
    if(fence){if(fence.reason==='forgotten'||fence.sourceScopeRevision===undefined||event.scopeRevision<=fence.sourceScopeRevision||event.kind==='retract'||event.kind==='scope-change')return;tx.delete('retraction',fenceId);}
    const eid = evidenceId(input.sourceIdentity, input.epoch, event.id), sourceDigest = coreDigest(event), existing = tx.get("evidence", eid);
    if (existing) { if (existing.sourceDigest !== sourceDigest) fail("CONFLICT", "Source event identity reused with different data"); return; }
    const older = tx.list("evidence").filter(e => e.sourceIdentity === input.sourceIdentity && e.object.kind === event.object.kind && e.object.id === event.object.id && !e.retractedAt);
    if (older.some(e => e.object.revision > event.object.revision)) return;
    if (event.kind === "retract" || event.kind === "scope-change") {
      tx.retract({ evidenceRefs: older.map(e => e.id), now, reason: "source-retracted" });
      tx.put("retraction", { id: objectRetractionId(input.sourceIdentity, event.object.kind, event.object.id), revision: tx.meta().visibilityRevision, at: now, reason: "source-retracted",sourceScopeRevision:input.scopeRevision });
      return;
    }
    const superseded = older.filter(e => e.object.revision < event.object.revision);
    if (superseded.length) tx.retract({ evidenceRefs: superseded.map(e => e.id), now, reason: "source-retracted", fenceObjects: false });
    const safeEvent={...event,...(event.content?{content:{...event.content,...(event.content.text!==undefined?{text:redactSensitiveText(event.content.text,Number.MAX_SAFE_INTEGER)}:{})}}:{})};
    tx.put("evidence", { ...safeEvent, id: eid, eventId: event.id, revision: 1, sourceIdentity: input.sourceIdentity, epoch: input.epoch,
      createdAt: now, updatedAt: now, visibilityRevision: tx.meta().visibilityRevision, sourceDigest });
  }
  private commitCheckpoint(tx: CoreTransaction, input: IngestBatch, previous: CoreRecords["checkpoint"] | undefined, batchDigest: string) {
    const epochChanged = previous && previous.epoch !== input.epoch;
    const id = input.sourceIdentity;
    const checkpoint = { id, revision: (previous?.revision ?? 0) + 1, sourceIdentity: input.sourceIdentity, epoch: input.epoch,
      cursor: input.nextCursor, scopeRevision: input.scopeRevision, capturedAt: input.capturedAt,
      coverage: epochChanged ? { ...input.coverage, complete: false, gap: "source_epoch_changed: consistent inventory rebuild required" } : input.coverage, batchDigest,
      ...(input.identityContinuityVerified || previous?.identityContinuityEpoch === input.epoch ? { identityContinuityEpoch: input.epoch } : {}) };
    tx.put("checkpoint", checkpoint); return checkpoint;
  }
  remember(input: RememberInput, access: CoreAccess) {
    return this.mutate("remember", input, access, (tx, now) => {
      this.active(tx, true); authorized(access, input.scope); text(input.value, "understanding value");
      if (!["goal", "preference", "constraint", "habit", "environment"].includes(input.kind) || !["explicit", "inferred"].includes(input.explicitness)) fail("INVALID_INPUT", "Invalid understanding kind or explicitness");
      const duplicate = tx.list("understanding").find(u => u.kind === input.kind && u.value === input.value &&
        canonical(u.scope) === canonical(input.scope) && u.status !== "retracted");
      const existing = input.id ? get(tx, "understanding", input.id) : duplicate;
      if (existing) authorized(access, existing.scope);
      if (existing && !input.id && input.expectedRevision === 0) return existing;
      this.validateUnderstandingChange(existing, input);
      const supportingRefs = this.understandingEvidence(tx, input, access, now);
      const item = this.assembleUnderstanding(tx, input, { existing, supportingRefs, now });
      tx.put("understanding", item);
      if (existing) tx.invalidateUnderstanding(existing.id, now);
      return item;
    });
  }
  private validateUnderstandingChange(existing: Understanding | undefined, input: RememberInput): void {
    version(existing?.revision ?? 0, input.expectedRevision);
    if (existing?.status === "retracted") fail("CONFLICT", "Retracted understanding cannot be revived; use new evidence");
    if (existing?.explicitness === "explicit" && input.explicitness === "inferred") fail("CONFLICT", "Inference cannot overwrite explicit understanding");
  }
  private understandingEvidence(tx: CoreTransaction, input: RememberInput, access: CoreAccess, now: string): string[] {
    const supportingRefs = input.explicitness === "explicit" ? this.userRefs(tx, input.supportingRefs, access, { scope: input.scope, actionKey: input.actionKey, content: input.value, now }) : input.supportingRefs;
    if (!supportingRefs.length) fail("INVALID_INPUT", "Understanding needs evidence");
    this.linked(tx, supportingRefs, access, input.scope); this.linked(tx, input.opposingRefs ?? [], access, input.scope);
    if (tx.get("retraction", tx.understandingRetractionId(input.kind, input.scope, supportingRefs))) {
      fail("CONFLICT", "Forgotten understanding cannot be rebuilt from the same historical evidence");
    }
    return supportingRefs;
  }
  private assembleUnderstanding(tx: CoreTransaction, input: RememberInput,
    source: { existing?: Understanding; supportingRefs: string[]; now: string }): Understanding {
    const { existing, supportingRefs, now } = source;
    return { id: existing?.id ?? randomUUID(), revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now, kind: input.kind, value: input.value, scope: input.scope,
      explicitness: input.explicitness, supportingRefs: unique(supportingRefs), opposingRefs: unique(input.opposingRefs ?? []),
      status: input.explicitness === "explicit" ? "active" : "candidate", visibilityRevision: tx.meta().visibilityRevision,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) };
  }
  pursue(input: PursueInput, access: CoreAccess) {
    return this.mutate("pursue", input, access, (tx, now) => {
      this.active(tx); authorized(access, input.scope); text(input.goal, "goal"); text(input.semanticKey, "semanticKey", 512);
      this.validatePursuit(input);
      const semanticKey = coreDigest([input.scope, input.semanticKey]);
      const duplicate = tx.list("pursuit").find(p => p.semanticKey === semanticKey && canonical(p.scope) === canonical(input.scope) && p.status !== "ended");
      const existing = input.id ? get(tx, "pursuit", input.id) : duplicate;
      if (existing) {
        authorized(access, existing.scope);
        if (!input.id && input.expectedRevision === 0) return existing; // Concurrent discovery joins the existing work, never takes its actor.
        version(existing.revision, input.expectedRevision);
        if (existing.paused || existing.status === "ended") fail("CONFLICT", "Paused or ended pursuit requires explicit control");
      } else version(0, input.expectedRevision);
      const { evidenceRefs, understandingRefs } = this.pursuitEvidence(tx, input, access, now);
      const item = this.assemblePursuit(tx, input, { existing, semanticKey, evidenceRefs, understandingRefs, now });
      tx.put("pursuit", item); return item;
    });
  }
  private validatePursuit(input: PursueInput): void {
    if (!Array.isArray(input.completionCriteria) || !input.completionCriteria.length || input.completionCriteria.length > 30) fail("INVALID_INPUT", "Pursuit needs bounded completion criteria");
    input.completionCriteria.forEach(item => text(item, "completion criterion"));
    if (!["explicit-goal", "unfinished-commitment", "important-blocker", "improvement"].includes(input.reason)) fail("INVALID_INPUT", "A continuing outcome is required");
  }
  private pursuitEvidence(tx: CoreTransaction, input: PursueInput, access: CoreAccess, now: string) {
    const evidenceRefs = input.reason === "explicit-goal" ? this.userRefs(tx, input.evidenceRefs, access, { scope: input.scope, actionKey: input.actionKey, content: input.goal, now }) : input.evidenceRefs;
    if (!evidenceRefs.length) fail("INVALID_INPUT", "Pursuit needs source evidence");
    this.linked(tx, evidenceRefs, access, input.scope);
    if (input.reason === "improvement") {
      const independent = new Set(this.refs(tx, evidenceRefs, access).filter(e => e.actor === "user" && !e.origin.pursuitId && !e.origin.runId).map(e => `${e.sourceIdentity}:${e.origin.rootId}`));
      if (independent.size < 3) fail("CONFLICT", "Unrequested improvement needs three independent user roots; explicit requests use explicit-goal");
    }
    const understandingRefs = input.understandingRefs ?? [];
    for (const id of understandingRefs) {
      const u = get(tx, "understanding", id); authorized(access, u.scope);
      if (u.status !== "active" || !scopeCovers(u.scope, input.scope)) fail("CONFLICT", "Understanding is inactive or outside pursuit scope");
    }
    return { evidenceRefs, understandingRefs };
  }
  private assemblePursuit(tx: CoreTransaction, input: PursueInput,
    source: { existing?: Pursuit; semanticKey: string; evidenceRefs: string[]; understandingRefs: string[]; now: string }): Pursuit {
    const { existing, semanticKey, evidenceRefs, understandingRefs, now } = source;
    const item: Pursuit = { ...(existing ?? {}), id: existing?.id ?? randomUUID(), revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now, semanticKey, goal: input.goal,
      completionCriteria: input.completionCriteria, scope: input.scope, reason: input.reason,
      evidenceRefs: unique([...(existing?.evidenceRefs ?? []), ...evidenceRefs]), understandingRefs: unique(understandingRefs),
      status: existing ? "waiting" : "candidate", paused: false, artifactRefs: existing?.artifactRefs ?? [],
      visibilityRevision: tx.meta().visibilityRevision, ...(input.nextStep ? { nextStep: input.nextStep } : {}) };
    if (item.currentActor) item.currentActor.stopRequested = true; // Changed goal invalidates the old execution plan.
    delete item.verification;
    return item;
  }
  claim(input: ClaimInput, access: CoreAccess) {
    return this.mutate("claim", input, access, (tx, now) => {
      this.active(tx); const p = get(tx, "pursuit", input.pursuitId); authorized(access, p.scope); version(p.revision, input.expectedRevision);
      const binding = access.execution ?? fail("FORBIDDEN", "Trusted execution binding required");
      if (p.currentActor || p.paused || ["done", "ended"].includes(p.status)) fail("CONFLICT", "Responsibility is occupied, paused or closed");
      this.refs(tx,p.evidenceRefs,access);
      if (p.suppression && p.suppression.until > now) fail("CONFLICT", "User feedback suppresses this topic; explicit restart or resume required");
      p.revision++; p.updatedAt = now; p.status = "active";
      p.currentActor = { ...binding, claimedRevision: p.revision, stopRequested: false };
      tx.put("pursuit", p); return p;
    });
  }
  release(input: ReleaseInput, access: CoreAccess) {
    privileged(access, "runtime");
    return this.mutate("release", input, access, (tx, now) => {
      const p = get(tx, "pursuit", input.pursuitId); authorized(access, p.scope); version(p.revision, input.expectedRevision);
      if (p.currentActor?.runRef !== input.runRef || !input.executionStopped || !input.effectsReconciled) fail("CONFLICT", "Original execution and outstanding effects must be reconciled before release");
      delete p.currentActor; p.revision++; p.updatedAt = now; tx.put("pursuit", p); return p;
    });
  }
  progress(input: ProgressInput, access: CoreAccess) {
    return this.mutate("progress", input, access, (tx, now) => {
      const p = this.owned(tx, input, access); this.linked(tx, input.evidenceRefs, access, p.scope);
      text(input.summary, "progress summary"); text(input.originalReceiptRef, "original action receipt", 2048);
      if (!["active", "waiting", "done"].includes(input.desiredStatus) || !input.evidenceRefs.length) fail("INVALID_INPUT", "Progress needs evidence and a valid result status");
      input.artifactRefs.forEach(ref => text(ref, "artifact reference", 2048));
      const candidate = { id: randomUUID(), revision: 1, createdAt: now, updatedAt: now,
        receipt: randomUUID(), pursuitId: p.id, pursuitRevision: p.revision, visibilityRevision: tx.meta().visibilityRevision,
        actor: p.currentActor!.actor, runRef: p.currentActor!.runRef, actionKey: input.actionKey,
        evidenceRefs: unique(input.evidenceRefs), summary: input.summary, artifactRefs: unique(input.artifactRefs), originalReceiptRef: input.originalReceiptRef,
        desiredStatus: input.desiredStatus, state: "pending" as const,
        ...(input.nextStep ? { nextStep: input.nextStep } : {}), ...(input.waitReason ? { waitReason: input.waitReason } : {}) };
      tx.put("candidate", candidate); return candidate;
    });
  }
  applyProgress(input: ApplyProgressInput, access: CoreAccess) {
    privileged(access, "runtime");
    return this.mutate("applyProgress", input, access, (tx, now) => {
      const c = get(tx, "candidate", input.candidateId), p = get(tx, "pursuit", c.pursuitId); authorized(access, p.scope);
      const v = input.verified;
      if (c.receipt !== v.candidateReceipt || c.runRef !== v.runRef || c.originalReceiptRef !== v.originalReceiptRef || !c.artifactRefs.every(ref => v.artifactRefs.includes(ref)) || !v.method.trim()) fail("FORBIDDEN", "Persisted candidate result and original receipt verification do not match");
      if (c.state !== "pending") fail("CONFLICT", "Candidate already reconciled");
      const stale = this.progressStale(tx, p, c, input.expectedRevision);
      if (stale) { c.state = "stale"; c.revision++; c.updatedAt = now; tx.put("candidate", c); return { applied: false, reason: "stale" as const, pursuit: p }; }
      this.active(tx); this.refs(tx, c.evidenceRefs, access);
      if (c.desiredStatus === "done" && (!v.criteriaSatisfied || !v.executionTerminal)) fail("CONFLICT", "Finished run alone does not establish completion; criteria and terminal execution must be verified");
      p.revision++; p.updatedAt = now; p.status = c.desiredStatus; p.artifactRefs = unique([...p.artifactRefs, ...c.artifactRefs]);
      p.nextStep = c.nextStep; p.waitReason = c.waitReason;
      p.verification = { at: now, method: v.method, originalReceiptRef: v.originalReceiptRef, runRef: v.runRef };
      // Terminal execution is not proof that unresolved effects are reconciled. release() owns that decision.
      c.state = "applied"; c.revision++; c.updatedAt = now; tx.put("candidate", c); tx.put("pursuit", p);
      return { applied: true, pursuit: p };
    });
  }
  rejectProgress(input: Mutation & {candidateId:string;expectedRevision:number;reason:string}, access:CoreAccess) {
    privileged(access,"runtime");text(input.reason,"verification reason");
    return this.mutate("rejectProgress",input,access,(tx,now)=>{
      const c=get(tx,"candidate",input.candidateId),p=get(tx,"pursuit",c.pursuitId);authorized(access,p.scope);
      if(c.state!=="pending")fail("CONFLICT","Candidate already reconciled");
      const stale=this.progressStale(tx,p,c,input.expectedRevision);
      c.state=stale?"stale":"rejected";c.revision++;c.updatedAt=now;tx.put("candidate",c);
      if(!stale){p.status="waiting";p.waitReason=input.reason;p.revision++;p.updatedAt=now;tx.put("pursuit",p);}
      return {applied:false,reason:stale?"stale":"not-verified",pursuit:p};
    });
  }
  private progressStale(tx: CoreTransaction, p: Pursuit, c: CoreRecords["candidate"], expectedRevision: number): boolean {
    return p.revision !== expectedRevision || p.revision !== c.pursuitRevision || tx.meta().visibilityRevision !== c.visibilityRevision || p.paused || p.currentActor?.runRef !== c.runRef || p.currentActor.actor !== c.actor || p.currentActor.stopRequested;
  }
  control(input: ControlInput, access: CoreAccess) {
    return this.mutate("control", input, access, (tx, now) => {
      const item = get(tx, input.kind, input.id); authorized(access, item.scope); version(item.revision, input.expectedRevision);
      const scope = input.scope ?? item.scope; authorized(access, scope);
      if (input.scope && !scopeCovers(item.scope, input.scope)) fail("FORBIDDEN", "Correction cannot broaden its original scope; establish a separate understanding with broader evidence");
      const evidenceRefs = this.userRefs(tx, input.evidenceRefs ?? [], access, { scope, actionKey: input.actionKey, content: input.value ?? input.operation, now });
      if (input.operation === "correct") this.correctItem(item, input, scope, evidenceRefs);
      else if (input.kind === "pursuit") this.controlPursuit(item as Pursuit, input.operation);
      else fail("INVALID_INPUT", "Understanding supports correction only; use forget to remove it");
      if (input.kind === "pursuit" && (item as Pursuit).currentActor) (item as Pursuit).currentActor!.stopRequested = true;
      item.revision++; item.updatedAt = now; item.visibilityRevision = tx.meta().visibilityRevision;
      if (input.kind === "understanding") {
        tx.put("understanding", item as Understanding); tx.invalidateUnderstanding(item.id, now);
      } else tx.put("pursuit", item as Pursuit);
      return item;
    });
  }
  private correctItem(item: Understanding | Pursuit, input: ControlInput, scope: Scope, evidenceRefs: string[]): void {
    text(input.value, "correction"); item.scope = scope;
    if (input.kind === "understanding") {
      const u = item as Understanding;
      if (u.status === "retracted") fail("CONFLICT", "Cannot correct a forgotten understanding");
      u.value = input.value; u.explicitness = "explicit"; u.supportingRefs = evidenceRefs; u.opposingRefs = []; u.status = "active";
    } else {
      const p = item as Pursuit; p.goal = input.value; p.evidenceRefs = unique([...p.evidenceRefs, ...evidenceRefs]);
      if (input.completionCriteria) {
        if (!input.completionCriteria.length) fail("INVALID_INPUT", "Completion criteria cannot be empty");
        input.completionCriteria.forEach(v => text(v, "completion criterion")); p.completionCriteria = input.completionCriteria;
      }
      p.status = "waiting"; p.waitReason = "corrected; previous execution requires reconciliation"; delete p.verification;
    }
  }
  private controlPursuit(p: Pursuit, operation: unknown): void {
    switch (operation) {
      case "pause": p.paused = true; p.waitReason = p.currentActor ? "stop requested; execution unconfirmed" : "paused by user"; break;
      case "resume":
        if (p.status === "ended") fail("CONFLICT", "Ended work needs a new pursuit");
        if (p.currentActor) fail("CONFLICT", "Previous execution must be reconciled before resume");
        p.paused = false; p.status = "waiting"; p.waitReason = "ready to continue"; delete p.suppression; break;
      case "end": p.status = "ended"; p.paused = true; break;
      default: fail("INVALID_INPUT", "Unknown control operation");
    }
  }
  feedback(input: FeedbackInput, access: CoreAccess) {
    return this.mutate("feedback", input, access, (tx, now) => {
      const target = get(tx, input.targetKind, input.targetId); authorized(access, target.scope); authorized(access, input.scope); version(target.revision, input.expectedRevision);
      if (!scopeCovers(target.scope, input.scope) || !["useful", "not-useful", "reject", "restart"].includes(input.value)) fail("INVALID_INPUT", "Feedback must be explicit and within target scope");
      const evidenceRefs = this.userRefs(tx, input.evidenceRefs ?? [], access, { scope: input.scope, actionKey: input.actionKey, content: input.value, now });
      const item = { id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, targetKind: input.targetKind, targetId: input.targetId,
        scope: input.scope, value: input.value, evidenceRefs,
        ...(input.value === "reject" ? { suppressedUntil: new Date(Date.parse(now) + 30 * DAY).toISOString() } : {}) };
      tx.put("feedback", item);
      this.applyFeedback(tx, input, target, item, now);
      return item;
    });
  }
  private applyFeedback(tx: CoreTransaction, input: FeedbackInput, target: Understanding | Pursuit,
    item: CoreRecords["feedback"], now: string): void {
    const negative = tx.list("feedback").filter(f => f.targetKind === input.targetKind && f.targetId === input.targetId &&
      f.value === "not-useful" && canonical(f.scope) === canonical(input.scope) &&
      f.createdAt >= new Date(Date.parse(now) - 30 * DAY).toISOString());
    if (input.value === "reject" || input.value === "not-useful" && negative.length >= 2) {
      item.suppressedUntil = new Date(Date.parse(now) + 30 * DAY).toISOString(); tx.put("feedback", item);
      if (canonical(target.scope) !== canonical(input.scope)) return;
      target.suppression = { until: item.suppressedUntil, reason: input.value === "reject" ? "rejected" : "repeated-not-useful", feedbackId: item.id };
      if (input.targetKind === "pursuit") {
        const p = target as Pursuit; p.paused = true; p.waitReason = "suppressed by explicit user feedback";
        if (p.currentActor) p.currentActor.stopRequested = true;
      } else { (target as Understanding).status = "needs-review"; tx.invalidateUnderstanding(target.id, now); }
      target.revision++; target.updatedAt = now; tx.put(input.targetKind, target);
    } else if (input.value === "restart" && canonical(target.scope) === canonical(input.scope)) {
      delete target.suppression;
      if (input.targetKind === "pursuit") {
        const p = target as Pursuit;
        if (p.status === "ended") fail("CONFLICT", "Ended work needs a new pursuit");
        p.paused = !!p.currentActor; p.waitReason = p.currentActor ? "restart requested; old execution requires reconciliation" : "ready to continue";
        if (p.status !== "done") p.status = "waiting";
      }
      target.revision++; target.updatedAt = now; tx.put(input.targetKind, target);
    }
  }
  forget(input: ForgetInput, access: CoreAccess) {
    privileged(access, "owner");
    return this.mutate("forget", input, access, (tx, now) => {
      const target = input.target; let refs: string[] = [], understandingIds: string[] = [];
      if (target.kind === "evidence") { const e = get(tx, "evidence", target.id); authorized(access, e.scope); refs = [e.id]; }
      else if (target.kind === "understanding") { const u = get(tx, "understanding", target.id); authorized(access, u.scope); understandingIds = [u.id]; }
      else if (target.kind === "session") {
        authorized(access, { sessionId: target.sessionId });
        refs = tx.list("evidence").filter(e =>
          e.scope.sessionId === target.sessionId || (isChatEvidence(e) && e.origin.rootId === target.sessionId)
        ).map(e => e.id);
        tx.put("retraction", { id: sessionRetractionId(target.sessionId), revision: tx.meta().visibilityRevision + 1, at: now, reason: "forgotten" });
      } else {
        this.validateObjectForgetTarget(target);
        privileged(access, "owner");
        const matches = tx.list("evidence").filter(e => e.sourceIdentity === target.sourceIdentity && e.object.kind === target.objectKind && e.object.id === target.objectId);
        matches.forEach(e => authorized(access, e.scope)); refs = matches.map(e => e.id);
        tx.put("retraction", { id: objectRetractionId(target.sourceIdentity, target.objectKind, target.objectId), revision: tx.meta().visibilityRevision + 1, at: now, reason: "forgotten" });
      }
      const result = tx.retract({ evidenceRefs: refs, now, reason: "forgotten", understandingIds });
      return { ...result, cleanup: { mind: "complete" as const, external: "not-requested" as const, nativeExecution: "requires-owner-reconciliation" as const } };
    });
  }
  private validateObjectForgetTarget(target: { kind: unknown }): asserts target is Extract<ForgetInput['target'], {kind:'object'}> {
    if (target.kind !== "object") fail("INVALID_INPUT", "Unknown forget target");
  }
  guardAction(input: GuardActionInput, access: CoreAccess) {
    return this.mutate("guardAction", input, access, (tx, now) => {
      const p = this.owned(tx, input, access); text(input.target, "fixed effect target", 1024);
      // The adapter must check the real approval/policy before invoking this method in its dispatch path.
      const action: ActionRecord = { id: input.actionKey, pursuitId: p.id, pursuitRevision: p.revision,
        visibilityRevision: tx.meta().visibilityRevision, actor: p.currentActor!.actor, runRef: p.currentActor!.runRef,
        argumentDigest: coreDigest(input.arguments), target: input.target, at: now, outcome: "intent" };
      if (tx.get("action", action.id)) fail("CONFLICT", "Effect key belongs to another request");
      tx.put("action", action); return action;
    }, tx => {
      version(tx.meta().visibilityRevision, input.expectedVisibilityRevision);
      this.owned(tx, input, access);
    });
  }
  recordAction(input: Mutation & { outcome: "unknown" | "succeeded" | "failed"; originalReceiptRef: string; effectActionKey: string }, access: CoreAccess) {
    privileged(access, "runtime");
    return this.mutate("recordAction", input, access, (tx) => {
      const action = get(tx, "action", input.effectActionKey); authorized(access, get(tx, "pursuit", action.pursuitId).scope);
      text(input.originalReceiptRef, "original effect receipt", 2048);
      if (!["unknown", "succeeded", "failed"].includes(input.outcome)) fail("INVALID_INPUT", "Invalid effect outcome");
      if (["succeeded", "failed"].includes(action.outcome) && (action.outcome !== input.outcome || action.originalReceiptRef !== input.originalReceiptRef)) fail("CONFLICT", "Final effect receipt cannot change");
      action.outcome = input.outcome; action.originalReceiptRef = input.originalReceiptRef; tx.put("action", action); return action;
    });
  }
  context(input: ContextInput, access: CoreAccess): ContextResult {
    authorized(access, input.scope);
    return this.store.inspect(tx => {
      const limit = this.limit(input.limit), maxBytes = input.maxBytes ?? 16384;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || maxBytes > 32768) fail("INVALID_INPUT", "Context maxBytes must be 512..32768");
      const query = input.query ?? "";
      if (typeof query !== "string" || Buffer.byteLength(query) > 8192) fail("INVALID_INPUT", "Context query must be at most 8192 bytes");
      const applies = (item: { scope: Scope }) => readable(access, item.scope) && scopeCovers(item.scope, input.scope);
      return tx.collectContext({ limit, maxBytes, query, applies, readable: scope => readable(access, scope) });
    });
  }
  /** Read-only projection for the actual source application; no new messages or model work. */
  conversationUpdates(sourceIdentity: string, conversationId: string, access: CoreAccess, source: { epoch: unknown; scopeRevision: unknown }) {
    authorized(access); text(sourceIdentity, "source identity", 512); text(conversationId, "conversation identifier", 512);
    text(source.epoch, "source epoch", 512);
    if (typeof source.scopeRevision !== "number" || !Number.isSafeInteger(source.scopeRevision) || source.scopeRevision < 0) fail("INVALID_INPUT", "Invalid source scope revision");
    return this.store.inspect(tx => {
      if (tx.settings().restoreBlocked) fail("RESTORE_BLOCKED", "Restored memory is unavailable until owner review");
      const checkpoint = tx.get("checkpoint", sourceIdentity);
      // A local checkpoint can still be complete while Chat has already withdrawn and reauthorized.
      if (!checkpoint?.coverage.complete || checkpoint.epoch !== source.epoch || checkpoint.scopeRevision !== source.scopeRevision) return { items: [] };
      const pursuits = tx.visiblePursuits({ limit: 8,
        readable: scope => readable(access, scope),
        applies: item => readable(access, item.scope) && "evidenceRefs" in item && (item as Pursuit).evidenceRefs.some(id => {
          const evidence = tx.get("evidence", id);
          return evidence?.sourceIdentity === sourceIdentity && evidence.origin.rootId === conversationId;
        }) });
      const items = pursuits.map(p => ({ id: p.id, revision: p.revision, status: p.paused ? "paused" : p.status,
        goal: p.goal.slice(0, 300), waitReason: p.waitReason?.slice(0, 500), nextStep: p.nextStep?.slice(0, 500),
        artifactRefs: p.artifactRefs.slice(0, 3), updatedAt: p.updatedAt }));
      // Bound only projected status, not the source text needed for visibility checks.
      while (Buffer.byteLength(JSON.stringify({ items })) > 16384) items.pop();
      return { items };
    });
  }
  private limit(value = 20) { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail("INVALID_INPUT", "limit must be 1..100"); return value; }
  overview(input: OverviewInput, access: CoreAccess): OverviewResult {
    authorized(access); if (input.scope) authorized(access, input.scope);
    return this.store.inspect(tx => {
      const limit = this.limit(input.limit);
      const all = [...tx.list("understanding").filter(u => u.status !== "retracted"), ...tx.list("pursuit")]
        .filter(item => readable(access, item.scope) && (!input.scope || scopeCovers(item.scope, input.scope)))
        .sort((a, b) => a.id.localeCompare(b.id)).filter(item => !input.after || item.id.localeCompare(input.after) > 0);
      const items = all.slice(0, limit);
      return { ...tx.meta(), items, settings: tx.settings(), ...(all.length > limit ? { next: items.at(-1)!.id } : {}) };
    });
  }
  detail<K extends "evidence" | "understanding" | "pursuit">(input: { kind: K; id: string }, access: CoreAccess): CoreRecords[K] {
    authorized(access);
    return this.store.inspect(tx => { const item = get(tx, input.kind, input.id); authorized(access, item.scope); return item; });
  }
  settings(input: (Mutation & { expectedRevision: number; patch: Partial<Omit<CoreSettings, "revision" | "restoreBlocked">> }) | undefined, access: CoreAccess) {
    privileged(access, "owner");
    if (!input) return this.store.inspect(tx => tx.settings());
    return this.mutate("settings", input, access, tx => tx.updateSettings(input.expectedRevision, input.patch));
  }
  setRestoreBlocked(blocked: boolean, access: CoreAccess) {
    privileged(access, "runtime");
    return this.store.update(tx => {
      const s = tx.settings(); s.restoreBlocked = blocked; s.revision++; tx.setSettings(s);
      const m = tx.meta(); m.visibilityRevision++; tx.setMeta(m); return s;
    });
  }
  maintain(access: CoreAccess) {
    privileged(access, "runtime"); const now = this.now();
    return this.store.update(tx => tx.maintain(now));
  }
}
