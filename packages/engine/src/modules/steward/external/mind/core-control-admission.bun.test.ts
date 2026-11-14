import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreActions, type DocumentArtifact } from './core-actions';
import { CoreRuntime, RUNTIME_ACCESS } from './core-runtime';
import type { CoreCall, Target, ToolFact } from './core-execution';
import type { CoreAccess, ProgressCandidate } from './core-types';
import type { VerdictInput } from './core-verification';

const identity = { moduleId: 'mind-integration', hash: 'mind-current-version' };
const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const scope = { sessionId: 'train-planning' };
const criterion = 'Give departure and arrival times supported by the original timetable, arriving before noon';
const body = 'Take the 09:00 train, arriving at 11:30 before noon. Source: the timetable supplied in the original user message.';
type Run = { runId: string; contextId: string; status: string; active: boolean; ended: boolean; args: Record<string, unknown>; items: unknown[] };

/** Bounded transport double: only Agent/directory I/O is replaced. Results survive runtime restarts. */
class AgentGateway {
  readonly db: Database;
  readonly stops: string[] = [];
  confirmStops = true;
  loseNextRunReply = false;
  constructor(directory: string) {
    this.db = new Database(join(directory, 'test-agent.sqlite'));
    this.db.exec('CREATE TABLE runs(key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  }
  runs(): Run[] { return (this.db.query('SELECT json FROM runs ORDER BY rowid').all() as { json: string }[]).map(r => JSON.parse(r.json) as Run); }
  get(id: string) { const run = this.runs().find(r => r.runId === id); if (!run) throw Error('Unknown test run'); return run; }
  save(run: Run) { this.db.query('UPDATE runs SET json=? WHERE json_extract(json,\'$.runId\')=?').run(JSON.stringify(run), run.runId); }
  finish(id: string, status = 'finished') { const run = this.get(id); run.status = status; run.active = false; run.ended = true; this.save(run); }
  result(id: string, tool: string, output: unknown, callId = tool, status = 'succeeded') {
    const run = this.get(id), target = { moduleId: identity.moduleId, tool };
    expect(run.args.tools as Target[]).toContainEqual(target);
    expect(run.active).toBe(true);
    const value: ToolFact = { ...identity, runId: id, callId, target, status, outputState: status === 'unknown' ? 'unknown' : 'complete', output: { json: JSON.stringify(output) } };
    run.items.push({ kind: 'tool-result', payload: { type: 'tool-result', value } });
    if (run.items.length > 50) throw Error('Fixture observation bound exceeded');
    this.save(run);
  }
  readonly call: CoreCall = async (target, args, options) => {
    if (target === 'modules.list') return { items: [{ id: identity.moduleId, name: 'mind' }], nextCursor: null };
    if (target === 'modules.describe') return { items: [], nextCursor: null };
    if (target === 'agent.run') {
      expect(options?.key).toBeTruthy();
      const prior = this.db.query('SELECT json FROM runs WHERE key=?').get(options!.key!) as { json: string } | null;
      if (prior) { const run = JSON.parse(prior.json) as Run; expect(run.args).toEqual(args); return run; }
      expect(this.runs().filter(r => r.active)).toHaveLength(0);
      expect(args).toMatchObject({ lane: 'background', content: [], kind: 'conversation' });
      for (const field of ['contextId', 'model', 'profile', 'cwd']) expect(args[field]).toBeUndefined();
      const n = this.runs().length + 1;
      const run: Run = { runId: `run-${n}`, contextId: `context-${n}`, status: 'running', active: true, ended: false, args: structuredClone(args), items: [] };
      this.db.query('INSERT INTO runs(key,json) VALUES(?,?)').run(options!.key!, JSON.stringify(run));
      if (this.loseNextRunReply) { this.loseNextRunReply = false; throw Error('Injected lost original run reply'); }
      return run;
    }
    if (target === 'agent.read') {
      expect(args.limit).toBe(100); expect(args.waitMs).toBe(0);
      const run = this.get(String(args.runId));
      return { run, items: run.items, ended: run.ended, nextCursor: null, interactions: [] };
    }
    if (target === 'agent.stop') { const run = this.get(String(args.runId)); this.stops.push(run.runId); return { ...run, stopConfirmed: this.confirmStops && !run.active }; }
    throw Error(`Unexpected integration gateway call ${JSON.stringify(target)}`);
  };
  close() { this.db.close(); }
}

class Harness {
  readonly directory = mkdtempSync(join(tmpdir(), 'mind-runtime-integration-'));
  readonly gateway = new AgentGateway(this.directory);
  store!: CoreMindStore;
  service!: CoreMindService;
  actions!: CoreActions;
  runtime!: CoreRuntime;
  constructor() { this.open(); }
  private open() {
    this.store = new CoreMindStore(this.directory); this.service = new CoreMindService(this.store);
    this.actions = new CoreActions(this.directory, this.service);
    this.runtime = new CoreRuntime(this.store, this.service, this.gateway.call, () => identity, this.actions);
  }
  restart() { this.runtime.close(); this.actions.close(); this.store.close(); this.open(); }
  cleanup() { this.runtime.close(); this.actions.close(); this.store.close(); this.gateway.close(); rmSync(this.directory, { recursive: true, force: true }); }
  ingest(text: string, complete = true) {
    const state = this.store.read(), checkpoint = state.checkpoints[0], now = new Date().toISOString();
    this.service.ingest({ sourceIdentity: 'chat-source', epoch: 'epoch-1', expectedCheckpointRevision: checkpoint?.revision ?? 0,
      nextCursor: '2', scopeRevision: 1, capturedAt: now, coverage: { complete, ...(complete ? {} : { gap: 'snapshot page still missing' }) },
      events: checkpoint ? [] : [{ id: 'request', eventId: 'request', cursor: '1', object: { kind: 'message', id: 'request', revision: 1 },
        kind: 'message', actor: 'user', scope, origin: { rootId: scope.sessionId }, occurredAt: now, receivedAt: now,
        scopeRevision: 1, content: { text, truncated: false } },{id:'foreground-ended',eventId:'foreground-ended',cursor:'2',object:{kind:'execution',id:scope.sessionId,revision:1},kind:'operation',actor:'application',scope,origin:{rootId:scope.sessionId},occurredAt:now,receivedAt:now,scopeRevision:1,content:{text:JSON.stringify({foregroundActive:false,pendingCommand:false,terminalConfirmed:true}),truncated:false}}] }, RUNTIME_ACCESS);
    return this.store.read().evidence.find(e=>e.actor==='user')!.id;
  }
  get pursuit() { return this.store.read().pursuits[0]; }
  workerAccess() { return this.runtime.accessForCaller('adapter:mind', true,this.runtime.journal.outstanding()?.runId??undefined); }
  mutation(key: string) { return { actionKey: key, expectedRevision: this.pursuit.revision, expectedVisibilityRevision: this.store.read().visibilityRevision, pursuitId: this.pursuit.id }; }
  async discover() {
    const evidence = this.ingest('Please prepare a train itinerary arriving before noon. The published timetable says depart 09:00 and arrive 11:30. Remember that I prefer trains.');
    await this.runtime.tick(true);
    const understand = this.gateway.runs()[0];
    expect(understand.args.tools as Target[]).toContainEqual({ moduleId: identity.moduleId, tool: 'remember' });
    expect(understand.args.tools as Target[]).not.toContainEqual({ moduleId: identity.moduleId, tool: 'action' });
    const access = this.workerAccess();
    expect(access.execution?.runRef).toBe(understand.runId);
    const remembered = this.runtime.admission.enqueue('remember', { actionKey: 'request:preference', expectedRevision: 0, expectedVisibilityRevision: this.store.read().visibilityRevision,
      kind: 'preference', value: 'Prefers trains', scope, explicitness: 'explicit', supportingRefs: [evidence] }, access);
    this.gateway.result(understand.runId, 'remember', remembered);
    // Both candidates cite the original source; pending memory is not an active understanding dependency.
    const pursued = this.runtime.admission.enqueue('pursue', { actionKey: 'request:itinerary', expectedRevision: 0, expectedVisibilityRevision: this.store.read().visibilityRevision,
      semanticKey: 'train-before-noon', goal: 'Prepare a useful train itinerary arriving before noon', completionCriteria: [criterion], scope,
      reason: 'explicit-goal', evidenceRefs: [evidence] }, access);
    this.gateway.result(understand.runId, 'pursue', pursued);
    expect(this.store.read().understandings).toEqual([]); expect(this.store.read().pursuits).toEqual([]);
    await this.runtime.tick(true);
    expect(this.gateway.runs()).toHaveLength(1); expect(this.runtime.admission.outstanding()).toBeUndefined();
    this.gateway.finish(understand.runId); await this.runtime.tick(true);
    const accepted = new Set<string>();
    const requests = [remembered, pursued];
    for (let n = 0; n < requests.length; n++) {
      if (!this.runtime.admission.outstanding()) await this.runtime.tick(true);
      for (const request of requests.filter(request => !accepted.has(request.requestId)))
        expect(this.runtime.admission.view(request.requestId).status).toBe('pending');
      const verifier = this.runtime.admission.outstanding()!;
      expect(verifier).toBeDefined(); expect(verifier.runId).toBeTruthy();
      expect(requests.map(request => request.requestId)).toContain(verifier.subject);
      expect(accepted.has(verifier.subject)).toBe(false);
      expect(verifier.tools).toEqual([{ moduleId: identity.moduleId, tool: 'admission-verdict' }]);
      const runs = this.gateway.runs();
      expect(runs).toHaveLength(2 + n);
      expect(new Set(runs.map(run => run.runId)).size).toBe(runs.length);
      expect(new Set(runs.map(run => run.contextId)).size).toBe(runs.length);
      const request = this.runtime.admission.view(verifier.subject);
      expect(request.status).toBe('pending');
      const receipt = this.runtime.admission.verdict({ requestId: request.requestId, candidateDigest: request.candidateDigest,
        targetDigest: request.targetDigest, sourceDigest: request.sourceDigest, decision: 'accepted',
        reason: request.operation === 'remember' ? 'The user explicitly asks to remember their preference for trains.'
          : 'The user requests an itinerary before noon and supplies the 09:00–11:30 timetable.' }, { ...identity, runId: verifier.runId! });
      this.gateway.result(verifier.runId!, 'admission-verdict', receipt);
      await this.runtime.tick(true); await this.runtime.tick(true);
      // A selected accepted result is still pending until its actual verifier is terminal.
      expect(this.runtime.admission.view(request.requestId).status).toBe('pending');
      expect(this.store.read().understandings).toHaveLength(accepted.has(remembered.requestId) ? 1 : 0);
      expect(this.store.read().pursuits).toHaveLength(accepted.has(pursued.requestId) ? 1 : 0);
      expect(this.pursuit?.currentActor).toBeUndefined();
      expect(this.store.read().actions).toEqual([]);
      expect(this.runtime.journal.outstanding()).toBeUndefined();
      expect(this.gateway.runs()).toHaveLength(2 + n);
      this.gateway.finish(verifier.runId!); await this.runtime.tick(true);
      expect(this.runtime.admission.view(request.requestId).status).toBe('applied');
      accepted.add(request.requestId);
    }
    expect(this.runtime.admission.pending()).toEqual([]);
    expect(requests.map(request => this.runtime.admission.view(request.requestId).status)).toEqual(['applied', 'applied']);
    const worker = this.gateway.runs()[3];
    expect(this.gateway.runs()).toHaveLength(4);
    expect(worker).toBeDefined(); expect(this.pursuit.currentActor?.runRef).toBe(worker.runId);
    expect(new Set(this.gateway.runs().map(run => run.contextId)).size).toBe(4);
    expect(this.actions.list(this.pursuit.id)).toEqual([]);
    expect(() => this.actions.create({ ...this.mutation('discovery-run-document'), target: 'document', arguments: {},
      document: { title: 'Original discovery run', body } }, access)).toThrow('responsibility');
    return { evidence, worker };
  }
  produce(worker: Run): { document: DocumentArtifact; candidate: ProgressCandidate } {
    const document = this.actions.create({ ...this.mutation('itinerary:document'), target: 'document', arguments: {}, document: { title: 'Train itinerary', body } }, this.workerAccess());
    this.gateway.result(worker.runId, 'action', document, 'create-itinerary');
    const progress = this.service.progress({ ...this.mutation('itinerary:progress'), summary: 'Itinerary ready for independent review',
      artifactRefs: [document.ref], originalReceiptRef: 'create-itinerary', evidenceRefs: this.pursuit.evidenceRefs, desiredStatus: 'done' }, this.workerAccess());
    this.gateway.result(worker.runId, 'progress', progress);
    return { document, candidate: progress.value! };
  }
  verdict(document: DocumentArtifact, candidate: ProgressCandidate, decision: VerdictInput['decision'] = 'accepted') {
    const verifier = this.runtime.verification.outstanding()!;
    const input: VerdictInput = { requestId: verifier.id, candidateRef: candidate.receipt, artifacts: [{ ref: document.ref, digest: document.digest }], decision,
      observations: [{ criterion, satisfied: decision === 'accepted', observation: decision === 'accepted'
        ? 'The itinerary gives 09:00 departure and 11:30 arrival, matches the source timetable, and arrives before noon.'
        : 'The proposed itinerary needs another check against the current timetable before it is useful.', artifactRefs: [document.ref],
      ...(decision === 'accepted' ? { excerpt: 'Take the 09:00 train, arriving at 11:30 before noon.' } : {}) }] };
    return this.runtime.verdict(input, {...identity,runId:verifier.runId!});
  }
}


function addPauseEvidence(f:Harness){
 const cp=f.store.read().checkpoints[0],now=new Date().toISOString(),id='explicit-pause-user-message';
 f.service.ingest({sourceIdentity:'chat-source',epoch:'epoch-1',expectedCheckpointRevision:cp.revision,nextCursor:'3',scopeRevision:1,capturedAt:now,coverage:{complete:true},events:[{id,eventId:id,cursor:'3',object:{kind:'message',id,revision:1},kind:'message',actor:'user',scope,origin:{rootId:scope.sessionId},occurredAt:now,receivedAt:now,scopeRevision:1,content:{text:'Pause the train itinerary pursuit now. Do not complete it or create any further work for it.',truncated:false}}]},RUNTIME_ACCESS);
 return f.store.read().evidence.find(e=>e.object.id===id)!.id;
}

const application: CoreAccess = { subject: 'chat:agent', role: 'application', scopes: [{}] };
function pauseRequest(f: Harness, key = 'chat:natural-pause') {
  const evidence = addPauseEvidence(f);
  const input = { actionKey: key, kind: 'pursuit', id: f.pursuit.id, expectedRevision: f.pursuit.revision,
    expectedVisibilityRevision: f.store.read().visibilityRevision, operation: 'pause', evidenceRefs: [evidence] };
  return { input, receipt: f.runtime.admission.enqueue('control', input, application) };
}
async function acceptControl(f: Harness, requestId: string) {
  const verifier = f.runtime.admission.outstanding()!;
  expect(verifier.subject).toBe(requestId);
  const request = f.runtime.admission.view(requestId);
  const receipt = f.runtime.admission.verdict({ requestId, candidateDigest: request.candidateDigest,
    targetDigest: request.targetDigest, sourceDigest: request.sourceDigest, decision: 'accepted',
    reason: 'The original user message explicitly requests pausing this exact itinerary pursuit.' }, { ...identity, runId: verifier.runId! });
  f.gateway.result(verifier.runId!, 'admission-verdict', receipt);
  await f.runtime.tick(true);
  expect(f.pursuit.paused).toBe(false);
  expect(f.runtime.admission.view(requestId).status).toBe('pending');
  f.gateway.finish(verifier.runId!); await f.runtime.tick(true);
  expect(f.runtime.admission.view(requestId).status).toBe('applied');
  expect(f.pursuit.paused).toBe(true);
}

test('natural control requests stop, holds effects and survives authenticated release with an idempotent original receipt', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover();
    const { input, receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    expect(f.workerAccess().execution).toBeUndefined();
    expect(() => f.actions.create({ ...f.mutation('held-document'), target: 'document', arguments: {}, document: { title: 'Held', body } }, f.workerAccess())).toThrow();
    await f.runtime.tick(true);
    expect(f.gateway.stops).toContain(worker.runId);
    expect(f.runtime.view().current).toMatchObject({ stopRequested: true, stopConfirmed: false });
    expect(f.pursuit).toEqual(before);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    f.restart();
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const after = f.pursuit, rebased = f.runtime.admission.view(receipt.requestId);
    expect(after).toEqual({ ...before, currentActor: undefined, revision: before.revision + 1, updatedAt: after.updatedAt });
    expect(rebased.status).toBe('pending');
    expect(rebased.snapshot?.target).toEqual(after);
    expect(rebased.candidateDigest).not.toBe(receipt.candidateDigest);
    const verifier = f.runtime.admission.outstanding()!;
    expect(verifier.runId).not.toBe(worker.runId);
    expect(f.gateway.get(verifier.runId!).contextId).not.toBe(worker.contextId);
    const prompt = String(f.gateway.get(verifier.runId!).args.prompt);
    expect(prompt).toContain('"expectedRevision":' + after.revision);
    expect(prompt).toContain(rebased.candidateDigest);
    expect(f.runtime.admission.enqueue('control', input, application)).toEqual(receipt);
    expect(() => f.runtime.admission.enqueue('control', { ...input, operation: 'end' }, application)).toThrow();
    f.restart();
    expect(f.runtime.admission.enqueue('control', input, application)).toEqual(receipt);
    await acceptControl(f, receipt.requestId);
    expect(f.runtime.admission.enqueue('control', input, application)).toMatchObject({ requestId: receipt.requestId, candidateDigest: receipt.candidateDigest, status: 'applied' });
  } finally { f.cleanup(); }
});

test('pending user control discards worker completion before artifact verification without changing target semantics', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { candidate } = f.produce(worker);
    const { receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.runtime.verification.journal.all()).toEqual([]);
    expect(f.store.read().candidates.find(c => c.id === candidate.id)?.state).toBe('rejected');
    expect(f.pursuit).toEqual({ ...before, currentActor: undefined, revision: before.revision + 1, updatedAt: f.pursuit.updatedAt });
    expect(f.pursuit.status).not.toBe('done');
    expect(f.pursuit.verification).toBeUndefined();
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    await acceptControl(f, receipt.requestId);
  } finally { f.cleanup(); }
});

test('already running artifact verifier is stopped and cannot complete ahead of pending user control', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { document, candidate } = f.produce(worker);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const verifier = f.runtime.verification.outstanding()!;
    f.gateway.result(verifier.runId!, 'artifact', f.actions.read(document.ref));
    f.gateway.result(verifier.runId!, 'verdict', f.verdict(document, candidate));
    const { receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    await f.runtime.tick(true);
    expect(f.gateway.stops).toContain(verifier.runId!);
    expect(f.runtime.verification.outstanding()).toMatchObject({ stopRequested: true, stopConfirmed: false });
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    expect(f.pursuit).toEqual(before);
    f.gateway.finish(verifier.runId!); await f.runtime.tick(true);
    expect(f.pursuit).toEqual({ ...before, currentActor: undefined, revision: before.revision + 1, updatedAt: f.pursuit.updatedAt });
    expect(f.pursuit.status).not.toBe('done');
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    await acceptControl(f, receipt.requestId);
  } finally { f.cleanup(); }
});

test('substantive goal correction invalidates a pending control rather than rebasing it', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { receipt } = pauseRequest(f);
    f.service.control({ actionKey: 'owner:correct-goal', kind: 'pursuit', id: f.pursuit.id, expectedRevision: f.pursuit.revision,
      expectedVisibilityRevision: f.store.read().visibilityRevision, operation: 'correct', value: 'Prepare a bus itinerary instead', evidenceRefs: f.pursuit.evidenceRefs }, owner);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.runtime.admission.view(receipt.requestId).status).toBe('invalidated');
    expect(f.runtime.admission.view(receipt.requestId).candidateDigest).toBe(receipt.candidateDigest);
    expect(f.pursuit.goal).toBe('Prepare a bus itinerary instead');
    expect(f.pursuit.paused).toBe(false);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
  } finally { f.cleanup(); }
});

test('unconfirmed stop retains the original actor and occupancy even after a terminal run observation', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    f.gateway.confirmStops = false; f.gateway.finish(worker.runId);
    await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()).toMatchObject({ runId: worker.runId, ended: true, active: false, stopRequested: true, stopConfirmed: false, settled: false });
    expect(f.pursuit).toEqual(before);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    f.restart(); await f.runtime.tick(true);
    expect(f.pursuit).toEqual(before);
    expect(f.runtime.admission.view(receipt.requestId).status).toBe('pending');
    expect(f.gateway.runs()).toHaveLength(4);
    f.gateway.confirmStops = true; await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()).toBeUndefined();
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    await acceptControl(f, receipt.requestId);
  } finally { f.cleanup(); }
});

test('unknown original effects retain occupancy and prevent actor release and admission dispatch', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover();
    f.gateway.result(worker.runId, 'action', {}, 'original-unknown-effect', 'unknown');
    await f.runtime.tick(true);
    const { receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()).toMatchObject({ runId: worker.runId, status: 'unknown', stopRequested: true, stopConfirmed: true, settled: false });
    expect(f.pursuit).toEqual(before);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    f.restart(); await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()?.facts.some(fact => fact.status === 'unknown')).toBe(true);
    expect(f.runtime.admission.view(receipt.requestId).status).toBe('pending');
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    expect(f.pursuit).toEqual(before);
    expect(f.gateway.runs()).toHaveLength(4);
  } finally { f.cleanup(); }
});

test('lost original command reply is reconciled with its original key and exact arguments before any admission run', async () => {
  const f = new Harness(); try {
    const evidence = f.ingest('Please prepare a train itinerary arriving before noon using the original timetable.');
    f.service.pursue({ actionKey: 'owner:train-goal', expectedRevision: 0, expectedVisibilityRevision: f.store.read().visibilityRevision,
      semanticKey: 'train-before-noon', goal: 'Prepare a train itinerary before noon', completionCriteria: [criterion],
      scope, reason: 'explicit-goal', evidenceRefs: [evidence] }, owner);
    f.gateway.loseNextRunReply = true; await f.runtime.tick(true);
    const original = f.runtime.journal.outstanding()!, worker = f.gateway.runs()[0];
    expect(original).toMatchObject({ runId: null, status: 'unknown', settled: false });
    const { receipt } = pauseRequest(f);
    f.restart();
    expect(f.runtime.journal.outstanding()?.args).toEqual(original.args);
    expect(f.runtime.journal.outstanding()?.key).toBe(original.key);
    await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()).toMatchObject({ key: original.key, runId: worker.runId, stopRequested: true, stopConfirmed: false });
    expect(f.gateway.stops).toContain(worker.runId);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    const held = structuredClone(f.pursuit);
    await f.runtime.bindResponsibility();
    expect(f.pursuit).toEqual(held);
    expect(f.pursuit.currentActor).toBeUndefined();
    expect(f.workerAccess().execution).toBeUndefined();
    expect(f.pursuit.paused).toBe(false);
    expect(f.gateway.runs()).toHaveLength(1);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    await acceptControl(f, receipt.requestId);
  } finally { f.cleanup(); }
});

test('release receipt and pending control rebase recover across a crash between the two durable stores', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { input, receipt } = pauseRequest(f), before = structuredClone(f.pursuit);
    f.runtime.admission.rebaseRuntimeRelease = () => { throw Error('Injected interruption after authenticated runtime release'); };
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.pursuit.currentActor).toBeUndefined();
    expect(f.pursuit.revision).toBe(before.revision + 1);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    expect(f.runtime.admission.view(receipt.requestId).candidateDigest).toBe(receipt.candidateDigest);
    f.restart(); await f.runtime.tick(true);
    expect(f.pursuit.revision).toBe(before.revision + 1);
    expect(f.runtime.admission.view(receipt.requestId).candidateDigest).not.toBe(receipt.candidateDigest);
    expect(f.runtime.admission.enqueue('control', input, application)).toEqual(receipt);
    expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
    await acceptControl(f, receipt.requestId);
  } finally { f.cleanup(); }
});

test('a substantive target change between durable release intent and release remains invalidated and does not strand the actor', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(), { receipt } = pauseRequest(f);
    const release = f.service.release.bind(f.service);
    let corrected = false;
    f.service.release = (input, access) => {
      if (!corrected) {
        corrected = true;
        f.service.control({ actionKey: 'owner:correct-during-release', kind: 'pursuit', id: f.pursuit.id,
          expectedRevision: f.pursuit.revision, expectedVisibilityRevision: f.store.read().visibilityRevision,
          operation: 'correct', value: 'Prepare a bus itinerary instead', evidenceRefs: f.pursuit.evidenceRefs }, owner);
      }
      return release(input, access);
    };
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    f.restart(); await f.runtime.tick(true);
    expect(f.runtime.journal.outstanding()?.runId).not.toBe(worker.runId);
    expect(f.pursuit.currentActor?.runRef).not.toBe(worker.runId);
    expect(f.runtime.admission.outstanding()).toBeUndefined();
    expect(f.runtime.admission.view(receipt.requestId).status).toBe('invalidated');
    expect(f.runtime.admission.view(receipt.requestId).candidateDigest).toBe(receipt.candidateDigest);
    expect(f.pursuit.goal).toBe('Prepare a bus itinerary instead');
    expect(f.pursuit.paused).toBe(false);
  } finally { f.cleanup(); }
});
