import {mainModelSelection} from './core-execution';
import { randomUUID, createHash } from 'node:crypto';
import { admissionPrompt } from './core-admission-prompt';
import { scopeValid } from './core-service';
import { CoreExecutionJournal, CoreExecutor, type CoreCall, type Execution } from './core-execution';
import { canonical, coreDigest, objectRetractionId, sessionRetractionId, type CoreMindStore } from './core-store';
import type { CoreAccess, CoreState, Pursuit, Scope } from './core-types';

export type AdmissionOperation = 'remember' | 'pursue' | 'control' | 'feedback';
export type AdmissionIdentity = { moduleId: string; hash: string };
export type AdmissionCaller = AdmissionIdentity & { runId: string };
export type AdmissionDecision = 'accepted' | 'rejected';
export type AdmissionVerdictInput = {
  requestId: string;
  candidateDigest: string;
  targetDigest: string;
  sourceDigest: string;
  decision: AdmissionDecision;
  reason: string;
};
export type AdmissionVerdictReceipt = {
  receipt: string;
  requestId: string;
  candidateDigest: string;
  targetDigest: string;
  sourceDigest: string;
  decision: AdmissionDecision;
};
export type AdmissionOutcome = 'pending' | 'applied' | 'rejected' | 'invalidated' | 'failed';
export type AdmissionReceipt = {
  requestId: string;
  operation: AdmissionOperation;
  candidateDigest: string;
  status: AdmissionOutcome;
  reason?: string;
};
export type AdmissionOptions = {
  /** Starts owned by the worker and the artifact verifier, counted against the shared daily limit. */
  otherStarts?: (now: string) => number;
  /** True while another lane has a prepared, unknown, running, settling, or unreconciled command. */
  hasActiveRun?: () => boolean;
};
export type AuthorizedApply = (operation: AdmissionOperation, input: Record<string, unknown>, access: CoreAccess) => unknown;

type Snapshot = {
  meta: Pick<CoreState, 'revision' | 'visibilityRevision'>;
  evidence: unknown[];
  checkpoints: unknown[];
  target: unknown;
  related: unknown[];
};
type AdmissionRequest = {
  id: string;
  operation: AdmissionOperation;
  input: Record<string, unknown>;
  access: CoreAccess;
  createdAt: string;
  candidateDigest: string;
  /** Stable caller input identity; runtime release rebasing only changes the verifier input. */
  originalInputDigest?: string;
  targetDigest: string;
  sourceDigest: string;
  snapshot: Snapshot;
  status: AdmissionOutcome;
  reason?: string;
  executionId?: string;
  verdict?: { input: AdmissionVerdictInput; receipt: AdmissionVerdictReceipt; binding: AdmissionCaller };
  applied?: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const asText = (value: unknown, name: string, max = 8192): string => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) throw Error(`Invalid ${name}`);
  return value;
};
const textArray = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim() || Buffer.byteLength(item) > 2048))
    throw Error(`Invalid ${name}`);
  return [...new Set(value)];
};
const scopeCovers = (outer: Scope, inner: Scope) =>
  (!outer.projectId || outer.projectId === inner.projectId) && (!outer.sessionId || outer.sessionId === inner.sessionId);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const unwrap = (value: unknown): unknown => {
  if (!isObject(value) || typeof value.json !== 'string') return value;
  try { return JSON.parse(value.json) as unknown; }
  catch (error) {
    console.error(JSON.stringify({ component: 'mind', event: 'admission_invalid_tool_json', error: error instanceof Error ? error.name : 'Invalid JSON' }));
    return undefined;
  }
};
const same = (a: unknown, b: unknown) => a !== undefined && b !== undefined && canonical(a) === canonical(b);
const terminal = (e: Execution) => e.terminalStatus === 'finished' && e.ended && !e.active && (!e.stopRequested || e.stopConfirmed) && e.facts.every(f => f.status !== 'unknown');

function cloneAccess(access: CoreAccess): CoreAccess {
  if (!isObject(access) || typeof access.subject !== 'string' || !access.subject.trim() ||
    !['owner', 'application', 'runtime'].includes(access.role as string) || !Array.isArray(access.scopes)) throw Error('Authenticated caller access is required');
  const scopes = access.scopes.map(scope => {
    if (!isObject(scope) || Object.keys(scope).some(key => key !== 'projectId' && key !== 'sessionId')) throw Error('Invalid caller scope');
    for (const value of Object.values(scope)) if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 512) throw Error('Invalid caller scope');
    return structuredClone(scope) as Scope;
  });
  if (!scopes.length) throw Error('Authenticated caller scope is required');
  return { subject: access.subject, role: access.role, scopes,
    ...(access.execution ? { execution: structuredClone(access.execution) } : {}) };
}

function operationRefs(operation: AdmissionOperation, input: Record<string, unknown>): { evidence: string[]; related: string[]; target: { kind: string; id: string } | null } {
  const evidence = textArray(input.evidenceRefs ?? input.supportingRefs ?? [], 'evidence references');
  const related: string[] = [];
  let target: { kind: string; id: string } | null = null;
  if (operation === 'remember') {
    textArray(input.opposingRefs ?? [], 'opposing evidence references').forEach(id => evidence.push(id));
    if (input.id !== undefined) target = { kind: 'understanding', id: asText(input.id, 'understanding id', 2048) };
  } else if (operation === 'pursue') {
    related.push(...textArray(input.understandingRefs ?? [], 'understanding references'));
    if(input.id!==undefined)target={kind:'pursuit',id:asText(input.id,'pursuit id',2048)};
  } else if (operation === 'control') {
    target = { kind: asText(input.kind, 'control target kind', 64), id: asText(input.id, 'control target id', 2048) };
  } else {
    target = { kind: asText(input.targetKind, 'feedback target kind', 64), id: asText(input.targetId, 'feedback target id', 2048) };
  }
  return { evidence: [...new Set(evidence)], related: [...new Set(related)], target };
}

function record(state: CoreState, kind: string, id: string): unknown {
  const key = kind === 'understanding' ? 'understandings' : kind === 'pursuit' ? 'pursuits' : kind === 'feedback' ? 'feedback' : kind === 'candidate' ? 'candidates' : kind;
  const records = (state as unknown as Record<string, unknown>)[key];
  return Array.isArray(records) ? records.find(item => isObject(item) && item.id === id) : undefined;
}

function readable(access: CoreAccess, value: unknown): boolean {
  return isObject(value) && isObject(value.scope) && access.scopes.some(scope => scopeCovers(scope, value.scope as Scope));
}

function material(store: Pick<CoreMindStore, 'read'>, operation: AdmissionOperation, input: Record<string, unknown>, access: CoreAccess): Snapshot {
  const state = store.read();
  if (!state.settings.enabled || state.settings.restoreBlocked) throw Error('Mind is paused or restore is blocked');
  const refs = operationRefs(operation, input);
  const related = refs.related.map(id => record(state, 'understanding', id));
  if (related.some(item => !item || !readable(access, item) || isObject(item) && item.status === 'retracted')) throw Error('Referenced understanding is missing or outside caller scope');
  const relatedRefs=related.flatMap(item=>isObject(item)?[...textArray(item.supportingRefs??[],'supporting references'),...textArray(item.opposingRefs??[],'opposing references')]:[]);
  const evidence = [...new Set([...refs.evidence,...relatedRefs])].map(id => record(state, 'evidence', id));
  if (evidence.some(item => {
    if (!isObject(item) || !readable(access, item) || item.retractedAt || item.expiredAt ||
      isObject(item.content) && item.content.truncated === true) return true;
    const object = isObject(item.object) ? item.object : undefined;
    return !object || state.retractions.some(retraction => retraction.id === objectRetractionId(String(item.sourceIdentity), String(object.kind), String(object.id)) ||
      isObject(item.scope) && typeof item.scope.sessionId === 'string' && retraction.id === sessionRetractionId(item.scope.sessionId));
  })) throw Error('Evidence is missing, withdrawn, expired or outside caller scope');
  const checkpoints = evidence.map(item => item as Record<string, unknown>).map(item =>
    state.checkpoints.filter(cp => cp.sourceIdentity === item.sourceIdentity && cp.epoch === item.epoch && cp.scopeRevision === item.scopeRevision));
  for (let i = 0; i < evidence.length; i++) {
    const item = evidence[i] as Record<string, unknown>;
    if (item.sourceIdentity !== 'owner' && item.sourceIdentity !== 'mind-owner' && !(checkpoints[i] as unknown[]).some(cp => isObject(cp) && isObject(cp.coverage) && cp.coverage.complete === true))
      throw Error('Evidence source coverage is incomplete');
  }
  const target = refs.target ? record(state, refs.target.kind, refs.target.id) : null;
  if (refs.target && (!target || !readable(access, target) || isObject(target) && (target.status === 'retracted' || target.retractedAt)))
    throw Error('Admission target is missing, withdrawn or outside caller scope');
  // Poll cursors, timestamps and unrelated records do not change this candidate's authority.
  // The visibility generation and exact relevant records remain binding.
  const snapshot: Snapshot = { meta: { revision: 0, visibilityRevision: state.visibilityRevision },
    evidence: structuredClone(evidence), checkpoints: checkpoints.flat().map(cp=>({sourceIdentity:cp.sourceIdentity,epoch:cp.epoch,scopeRevision:cp.scopeRevision,coverage:cp.coverage})), target: structuredClone(target), related: structuredClone(related) };
  if (Buffer.byteLength(canonical(snapshot)) > 30000) throw Error('Admission evidence exceeds the bounded verifier context');
  return snapshot;
}

function current(store: Pick<CoreMindStore, 'read'>, request: AdmissionRequest): boolean {
  try {
    const now = material(store, request.operation, request.input, request.access);
    return digest(now) === digest(request.snapshot);
  } catch (error) {
    console.error(JSON.stringify({ component: 'mind', event: 'admission_invalidated', requestId: request.id, error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

export class CoreAdmission {
  readonly journal: CoreExecutionJournal;
  readonly executor: CoreExecutor;
  private closed = false;
  constructor(
    private readonly store: Pick<CoreMindStore, 'read'>,
    call: CoreCall,
    private readonly self: () => AdmissionIdentity,
    private readonly authorizedApply: AuthorizedApply,
    private readonly options: AdmissionOptions = {},
  ) {
    const directory = 'directory' in store && typeof store.directory === 'string' ? store.directory : process.cwd();
    this.journal = new CoreExecutionJournal(directory,()=>mainModelSelection(store.read().settings),'admission');
    this.journal.db.exec(`CREATE TABLE IF NOT EXISTS admission_requests(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admission_verdicts(request_id TEXT NOT NULL, run_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(request_id, run_id));`);
    this.executor = new CoreExecutor(this.journal, call, {
      current: execution => this.currentExecution(execution),
      settle: async execution => this.settle(execution),
    });
  }
  private get(id: string): AdmissionRequest {
    const row = this.journal.db.query('SELECT json FROM admission_requests WHERE id=?').get(id) as { json: string } | null;
    if (!row) throw Error('Admission request not found');
    return JSON.parse(row.json) as AdmissionRequest;
  }
  private save(request: AdmissionRequest) {
    this.journal.db.query('INSERT INTO admission_requests(id,created_at,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
      .run(request.id, request.createdAt, JSON.stringify(request));
  }
  private requests() { return this.journal.db.query('SELECT json FROM admission_requests ORDER BY created_at,id').all().map(row => JSON.parse((row as { json: string }).json) as AdmissionRequest); }
  private currentExecution(execution: Execution) {
    const request = this.get(execution.subject);
    return request.status === 'pending' && current(this.store, request) && !this.options.hasActiveRun?.();
  }
  enqueue(operation: AdmissionOperation, value: unknown, suppliedAccess: CoreAccess, now = new Date().toISOString()): AdmissionReceipt {
    if (this.closed) throw Error('Admission is closed');
    if (!['remember', 'pursue', 'control', 'feedback'].includes(operation)) throw Error('Unsupported semantic admission operation');
    if (!isObject(value) || Buffer.byteLength(canonical(value)) > 24000) throw Error('Bounded semantic input is required');
    const access = cloneAccess(suppliedAccess);
    if (access.role === 'owner') throw Error('Owner operations do not need semantic admission');
    const input = structuredClone(value);
    if(typeof input.actionKey!=='string'||!input.actionKey.trim()||input.actionKey.length>512)throw Error('Stable action key is required');
    const prior=this.requests().find(r=>r.operation===operation&&r.access.subject===access.subject&&r.input.actionKey===input.actionKey);
    if(prior){if((prior.originalInputDigest??prior.candidateDigest)!==coreDigest({operation,input}))throw Error('Same action key cannot change the semantic candidate');return this.receipt(prior);}
    // Reject malformed scope before spending an independent verifier run; the same validator guards application.
    if(operation!=='control'||input.scope!==undefined)scopeValid(input.scope);
    const snapshot = material(this.store, operation, input, access);
    const id = randomUUID();
    const request: AdmissionRequest = { id, operation, input, access, createdAt: now,
      // The service trust guard deliberately binds this marker to the original mutation only;
      // revision, target and source guards remain separate and are checked before applying.
      candidateDigest: coreDigest({ operation, input }),
      targetDigest: digest(snapshot.target), sourceDigest: digest({ evidence: snapshot.evidence, checkpoints: snapshot.checkpoints }), snapshot, status: 'pending' };
    // Validate the combined verifier request before reserving any durable pending work.
    this.prompt(request);
    this.save(request);
    return this.receipt(request);
  }
  private receipt(request: AdmissionRequest): AdmissionReceipt { return { requestId: request.id, operation: request.operation, candidateDigest: request.originalInputDigest??request.candidateDigest, status: request.status, ...(request.reason ? { reason: request.reason } : {}) }; }
  pending() { return this.requests().filter(request => request.status === 'pending').map(request => this.receipt(request)); }
  view(id: string): AdmissionReceipt & { targetDigest: string; sourceDigest: string; snapshot?: Snapshot; verdict?: AdmissionRequest['verdict'] } {
    const request = this.get(id); return { ...this.receipt(request), candidateDigest: request.candidateDigest, targetDigest: request.targetDigest, sourceDigest: request.sourceDigest,
      ...(request.status === 'pending' ? { snapshot: structuredClone(request.snapshot) } : {}), ...(request.verdict ? { verdict: structuredClone(request.verdict) } : {}) };
  }
  /** Runtime-only: called with a persisted, authenticated release receipt, before any verifier starts. */
  rebaseRuntimeRelease(before: Pursuit, after: Pursuit, runRef: string) {
    if (before.currentActor?.runRef !== runRef || after.currentActor || after.id !== before.id || after.revision !== before.revision + 1 ||
      !same(after, { ...before, currentActor: undefined, revision: after.revision, updatedAt: after.updatedAt })) return;
    for (const request of this.requests()) {
      if (request.status !== 'pending' || request.operation !== 'control' || request.input.kind !== 'pursuit' ||
        request.input.id !== before.id || request.executionId || request.verdict || this.journal.all().some(e => e.subject === request.id) || request.input.expectedRevision !== before.revision ||
        !same(request.snapshot.target, before)) continue;
      const input = { ...request.input, expectedRevision: after.revision };
      // A release receipt is not authority to tolerate any other target, source or visibility change.
      let snapshot: Snapshot;
      try { snapshot = material(this.store, request.operation, input, request.access); }
      catch (error) {
        console.error(JSON.stringify({ component: 'mind', event: 'admission_release_not_rebased', requestId: request.id, error: error instanceof Error ? error.message : String(error) }));
        continue;
      }
      if (!same(snapshot.target, after) || !same(snapshot, { ...request.snapshot, target: after })) continue;
      request.originalInputDigest ??= request.candidateDigest;
      request.input = input; request.snapshot = snapshot;
      request.candidateDigest = coreDigest({ operation: request.operation, input });
      request.targetDigest = digest(snapshot.target);
      request.sourceDigest = digest({ evidence: snapshot.evidence, checkpoints: snapshot.checkpoints });
      this.save(request);
    }
  }
  outstanding() { return this.journal.outstanding(); }
  verdict(input: AdmissionVerdictInput, binding: AdmissionCaller): AdmissionVerdictReceipt {
    if (!isObject(input) || typeof input.requestId !== 'string' || typeof input.candidateDigest !== 'string' ||
      typeof input.targetDigest !== 'string' || typeof input.sourceDigest !== 'string' || !['accepted', 'rejected'].includes(input.decision) ||
      typeof input.reason !== 'string' || input.reason.length > 8192) throw Error('Invalid admission verdict');
    const request = this.get(input.requestId), execution = this.journal.get(request.executionId ?? request.id), identity = this.self();
    if (binding.moduleId !== identity.moduleId || binding.hash !== identity.hash || !binding.runId ||
      binding.runId === request.access.execution?.runRef || execution.settled || execution.stopRequested || !current(this.store, request))
      throw Error('Admission verdict requires the actual independent verifier caller/run');
    if (execution.runId ? execution.runId !== binding.runId : execution.status !== 'unknown') throw Error('Admission verifier run mismatch');
    if (input.candidateDigest !== request.candidateDigest || input.targetDigest !== request.targetDigest || input.sourceDigest !== request.sourceDigest)
      throw Error('Admission verdict does not match exact candidate, target and source snapshots');
    const existing = this.journal.db.query('SELECT json FROM admission_verdicts WHERE request_id=? AND run_id=?').get(request.id, binding.runId) as { json: string } | null;
    if (existing) {
      const saved = JSON.parse(existing.json) as { input: AdmissionVerdictInput; receipt: AdmissionVerdictReceipt; binding: AdmissionCaller };
      if (!same(saved.input, input) || !same(saved.binding, binding)) throw Error('Admission verdict cannot change');
      return saved.receipt;
    }
    const receipt: AdmissionVerdictReceipt = { receipt: randomUUID(), requestId: request.id, candidateDigest: request.candidateDigest,
      targetDigest: request.targetDigest, sourceDigest: request.sourceDigest, decision: input.decision };
    this.journal.db.query('INSERT INTO admission_verdicts(request_id,run_id,json) VALUES(?,?,?)')
      .run(request.id, binding.runId, JSON.stringify({ input, receipt, binding }));
    return receipt;
  }
  private prepare(request: AdmissionRequest, now: string) {
    if (this.options.hasActiveRun?.()) return;
    const starts = this.options.otherStarts?.(now) ?? 0;
    if (!Number.isSafeInteger(starts) || starts < 0 || starts >= 24) return;
    const identity = this.self();
    const prompt = this.prompt(request);
    const execution = this.journal.prepare({ purpose: 'understand', subject: request.id, revision: request.snapshot.meta.revision,
      visibilityRevision: request.snapshot.meta.visibilityRevision, principal: identity, tools: [{ moduleId: identity.moduleId, tool: 'admission-verdict' }], prompt }, now, 24 - starts);
    request.executionId = execution.id; this.save(request);
  }
  private prompt(request: AdmissionRequest) {
    return admissionPrompt({ requestId: request.id, operation: request.operation, candidateDigest: request.candidateDigest, targetDigest: request.targetDigest, sourceDigest: request.sourceDigest,
      target: request.snapshot.target, related: request.snapshot.related, evidence: request.snapshot.evidence, checkpoints: request.snapshot.checkpoints, input: request.input });
  }
  async tick(now = new Date().toISOString()) {
    if (this.closed || this.options.hasActiveRun?.()) return;
    if(this.outstanding()){await this.executor.reconcile(now);return;}
    const request = this.requests().find(item => item.status === 'pending' && !item.executionId);
    if (request && current(this.store, request)) {
      try { this.prepare(request, now); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // A pre-dispatch failure is final for this candidate. An already reserved original
        // command remains occupied and queryable; never invent a replacement run.
        if (!this.journal.all().some(execution => execution.subject === request.id)) {
          request.status = 'failed'; request.reason = reason; this.save(request);
        }
        console.error(JSON.stringify({ component: 'mind', event: 'admission_prepare_failed', requestId: request.id, error: reason }));
      }
    } else if (request && !current(this.store, request)) {
      request.status = 'invalidated'; request.reason = 'Candidate evidence, target, revision, visibility or source coverage changed'; this.save(request);
    }
    await this.executor.reconcile(now);
  }
  private async settle(execution: Execution) {
    const request = this.get(execution.subject);
    const row = execution.runId ? this.journal.db.query('SELECT json FROM admission_verdicts WHERE request_id=? AND run_id=?').get(request.id, execution.runId) as { json: string } | null : null;
    if (row) request.verdict = JSON.parse(row.json) as AdmissionRequest['verdict'];
    const fact = execution.runId && request.verdict ? execution.facts.find(item => item.runId === execution.runId && item.moduleId === request.verdict!.binding.moduleId && item.hash === request.verdict!.binding.hash &&
      typeof item.target !== 'string' && item.target.moduleId === this.self().moduleId && item.target.tool === 'admission-verdict' && item.status === 'succeeded' && item.outputState === 'complete' && same(unwrap(item.output), request.verdict!.receipt)) : undefined;
    if (!terminal(execution) || !fact || !request.verdict || request.verdict.binding.runId !== execution.runId || !current(this.store, request)) {
      request.status = current(this.store, request) ? 'failed' : 'invalidated'; request.reason = request.status === 'failed' ? 'No authenticated selected successful admission-verdict result was observed' : 'Candidate changed before verifier completion'; this.save(request); return;
    }
    if (request.verdict.input.decision !== 'accepted') { request.status = 'rejected'; request.reason = request.verdict.input.reason; this.save(request); return; }
    try {
      const access = { ...request.access, semanticAdmission: { digest: request.candidateDigest } };
      this.authorizedApply(request.operation, structuredClone(request.input), access);
      request.status = 'applied'; request.applied = true; request.reason = request.verdict.input.reason; this.save(request);
    } catch (error) {
      request.status = 'failed'; request.reason = error instanceof Error ? error.message : String(error); this.save(request);
      console.error(JSON.stringify({ component: 'mind', event: 'admission_apply_failed', requestId: request.id, error: request.reason }));
    }
  }
  cleanupWithdrawn() {
    let deferred = 0;
    for (const request of this.requests()) {
      if (request.status !== 'pending' && request.snapshot.evidence.length === 0 && request.snapshot.checkpoints.length === 0 && !request.snapshot.target && request.snapshot.related.length === 0 && !request.verdict && Object.keys(request.input).length <= 1) continue;
      if (current(this.store, request)) continue;
      if(request.status==='pending')request.status = 'invalidated';
      request.reason = 'Candidate evidence, target, revision, visibility or source coverage changed';
      delete request.verdict;
      // Keep only content-free replay identity. Exact Agent arguments for an unknown
      // dispatch remain in the execution journal until the original receipt is recovered.
      request.input={actionKey:request.input.actionKey};request.snapshot={meta:request.snapshot.meta,evidence:[],checkpoints:[],target:null,related:[]};
      this.save(request);
    }
    const result = this.journal.scrubInvalid(execution => {
      const request = this.get(execution.subject); return request.status === 'pending' && current(this.store, request);
    });
    deferred += result.deferred;
    this.journal.db.exec("DELETE FROM admission_verdicts WHERE request_id IN (SELECT id FROM admission_requests WHERE json_extract(json, '$.status') <> 'pending')");
    return { deferred };
  }
  close() { if (!this.closed) { this.closed = true; this.journal.close(); } }
}
