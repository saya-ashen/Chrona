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
  constructor(directory: string) {
    this.db = new Database(join(directory, 'test-agent.sqlite'));
    this.db.exec('CREATE TABLE runs(key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  }
  runs(): Run[] { return (this.db.query('SELECT json FROM runs ORDER BY rowid').all() as { json: string }[]).map(r => JSON.parse(r.json) as Run); }
  get(id: string) { const run = this.runs().find(r => r.runId === id); if (!run) throw Error('Unknown test run'); return run; }
  save(run: Run) { this.db.query('UPDATE runs SET json=? WHERE json_extract(json,\'$.runId\')=?').run(JSON.stringify(run), run.runId); }
  finish(id: string, status = 'finished') { const run = this.get(id); run.status = status; run.active = false; run.ended = true; this.save(run); }
  result(id: string, tool: string, output: unknown, callId = tool) {
    const run = this.get(id), target = { moduleId: identity.moduleId, tool };
    expect(run.args.tools as Target[]).toContainEqual(target);
    expect(run.active).toBe(true);
    const value: ToolFact = { ...identity, runId: id, callId, target, status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(output) } };
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
      return run;
    }
    if (target === 'agent.read') {
      expect(args.limit).toBe(100); expect(args.waitMs).toBe(0);
      const run = this.get(String(args.runId));
      return { run, items: run.items, ended: run.ended, nextCursor: null, interactions: [] };
    }
    if (target === 'agent.stop') { const run = this.get(String(args.runId)); this.stops.push(run.runId); return { ...run, stopConfirmed: !run.active }; }
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

test('ingested evidence becomes understanding and a pursuit; bound actual work completes only after a separate terminal verifier reads and accepts the artifact', async () => {
  const f = new Harness(); try {
    const { evidence, worker } = await f.discover();
    expect(f.store.read().understandings[0]).toMatchObject({ value: 'Prefers trains', supportingRefs: [evidence], status: 'active' });
    const { document, candidate } = f.produce(worker);
    expect(f.actions.read(document.ref).body).toBe(body);
    await f.runtime.tick(true);
    expect(f.pursuit.status).toBe('active'); expect(f.runtime.verification.outstanding()).toBeUndefined(); expect(f.gateway.runs()).toHaveLength(4);
    f.restart(); await f.runtime.tick(true);
    expect(f.gateway.runs()).toHaveLength(4); expect(f.pursuit.currentActor?.runRef).toBe(worker.runId);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const verifier = f.runtime.verification.outstanding()!;
    expect(verifier.runId).not.toBe(worker.runId); expect(verifier.contextId).not.toBe(worker.contextId);
    expect(verifier.tools).toEqual(['artifact', 'detail', 'verdict'].map(tool => ({ moduleId: identity.moduleId, tool })));
    expect(f.pursuit.status).toBe('active'); expect(f.pursuit.currentActor?.runRef).toBe(worker.runId);
    f.restart();
    const read = f.actions.read(document.ref);
    expect(read.body).toBe(body); f.gateway.result(verifier.runId!, 'artifact', read);
    const receipt = f.verdict(document, candidate); f.gateway.result(verifier.runId!, 'verdict', receipt);
    await f.runtime.tick(true); expect(f.pursuit.status).toBe('active'); expect(f.pursuit.verification).toBeUndefined();
    f.gateway.finish(verifier.runId!); await f.runtime.tick(true);
    expect(f.runtime.lastError).toBeNull(); expect(f.pursuit.status).toBe('done'); expect(f.pursuit.currentActor).toBeUndefined();
    expect(f.pursuit.artifactRefs).toEqual([document.ref]); expect(f.store.read().candidates[0].state).toBe('applied');
    expect(f.pursuit.verification?.method).toContain(`run=${verifier.runId}`);
    f.restart(); await f.runtime.tick(true); expect(f.pursuit.status).toBe('done'); expect(f.gateway.runs()).toHaveLength(5);
  } finally { f.cleanup(); }
});

test('ordinary conversation settles a durable no-op watermark without creating understanding, pursuit or artifacts', async () => {
  const f = new Harness(); try {
    f.ingest('What is 2 + 2?'); await f.runtime.tick(true);
    const run = f.gateway.runs()[0]; expect(String(run.args.prompt)).toContain('What is 2 + 2?');
    f.gateway.finish(run.runId); await f.runtime.tick(true); f.restart(); await f.runtime.tick(true);
    const state = f.store.read(); expect(state.understandings).toEqual([]); expect(state.pursuits).toEqual([]); expect(state.actions).toEqual([]);
    expect(state.candidates).toEqual([]); expect(f.gateway.runs()).toHaveLength(1); expect(f.runtime.view().phase).toBe('idle');
  } finally { f.cleanup(); }
});

test('overlapping conversations retain evidence deferred until their foreground ends, including after restart', async () => {
  const f = new Harness(); try {
    f.ingest('A completed ordinary question');
    const state = f.store.read(), original = state.evidence.find(e => e.actor === 'user')!;
    const deferred = { ...original, id: 'deferred-user', eventId: 'deferred-user', object: { kind: 'message', id: 'deferred-user', revision: 1 },
      scope: { sessionId: 'overlapping-chat' }, origin: { rootId: 'overlapping-chat' },
      content: { text: 'Prepare the unfinished overlapping request', truncated: false } };
    const execution = { ...deferred, id: 'deferred-execution', eventId: 'deferred-execution', actor: 'application' as const, kind: 'operation' as const,
      object: { kind: 'execution', id: 'overlapping-chat', revision: 1 },
      content: { text: JSON.stringify({foregroundActive:true,pendingCommand:false,terminalConfirmed:false}), truncated: false } };
    f.store.update(tx => { tx.put('evidence', deferred); tx.put('evidence', execution); });
    await f.runtime.tick(true);
    const first = f.gateway.runs()[0]; expect(String(first.args.prompt)).not.toContain(deferred.content.text);
    f.gateway.finish(first.runId); await f.runtime.tick(true); f.restart();
    f.store.update(tx => tx.put('evidence', { ...execution, revision: 2,
      content: { text: JSON.stringify({foregroundActive:false,pendingCommand:false,terminalConfirmed:true}), truncated:false } }));
    await f.runtime.tick(true);
    expect(f.gateway.runs()).toHaveLength(2);
    const second = f.gateway.runs()[1]; expect(String(second.args.prompt)).toContain(deferred.content.text);
    f.gateway.finish(second.runId); await f.runtime.tick(true); f.restart(); await f.runtime.tick(true);
    expect(f.gateway.runs()).toHaveLength(2);
    expect(f.store.read().pursuits).toEqual([]);
  } finally { f.cleanup(); }
});

test('document action cannot run before bound pursuit responsibility or under a different caller', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover();
    const input = { ...f.mutation('unauthorized-document'), target: 'document', arguments: {}, document: { title: 'Unauthorized', body } };
    expect(() => f.actions.create(input, f.runtime.accessForCaller('other-application', false))).toThrow('responsibility');
    expect(() => f.actions.create(input, { ...RUNTIME_ACCESS, execution: { actor: 'mind', runRef: 'other-run' } })).toThrow('responsibility');
    expect(f.actions.list(f.pursuit.id)).toEqual([]);
    expect(f.workerAccess().execution?.runRef).toBe(worker.runId);
    f.produce(worker); expect(f.actions.list(f.pursuit.id)).toHaveLength(1);
  } finally { f.cleanup(); }
});

for (const withdrawal of ['pause', 'forget'] as const) test(`${withdrawal} while a worker has a done candidate prevents completion and waits for confirmed termination`, async () => {
  const f = new Harness(); try {
    const { evidence, worker } = await f.discover(); const { document } = f.produce(worker);
    if (withdrawal === 'pause') f.service.control({ actionKey: 'owner:pause', expectedVisibilityRevision: f.store.read().visibilityRevision,
      kind: 'pursuit', id: f.pursuit.id, expectedRevision: f.pursuit.revision, operation: 'pause' }, owner);
    else f.service.forget({ actionKey: 'owner:forget', expectedVisibilityRevision: f.store.read().visibilityRevision, target: { kind: 'evidence', id: evidence } }, owner);
    await f.runtime.tick(true);
    expect(f.gateway.stops).toContain(worker.runId); expect(f.runtime.journal.outstanding()?.stopConfirmed).toBe(false);
    expect(f.pursuit.status).not.toBe('done'); expect(f.pursuit.currentActor?.runRef).toBe(worker.runId);
    expect(() => f.actions.create({ ...f.mutation('late-action'), target: 'document', arguments: {}, document: { title: 'Late', body } }, f.workerAccess())).toThrow();
    f.restart(); await f.runtime.tick(true); expect(f.gateway.runs()).toHaveLength(4);
    f.gateway.finish(worker.runId, 'cancelled'); await f.runtime.tick(true);
    expect(f.pursuit.status).not.toBe('done'); expect(f.pursuit.verification).toBeUndefined(); expect(f.runtime.verification.outstanding()).toBeUndefined();
    expect(f.pursuit.currentActor).toBeUndefined(); expect(f.runtime.journal.outstanding()).toBeUndefined(); expect(f.gateway.runs()).toHaveLength(4);
    if (withdrawal === 'pause') expect(f.actions.read(document.ref).body).toBe(body);
  } finally { f.cleanup(); }
});

test('failed work is recorded as failed and cannot immediately redispatch the same unchanged pursuit, including after restart', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(); f.gateway.finish(worker.runId, 'failed'); await f.runtime.tick(true);
    expect(f.runtime.journal.all().find(e => e.runId === worker.runId)?.status).toBe('failed');
    expect(f.pursuit.status).not.toBe('done'); expect(f.pursuit.currentActor).toBeUndefined();
    for (let n = 0; n < 3; n++) await f.runtime.tick(true);
    f.restart(); await f.runtime.tick(true); expect(f.gateway.runs()).toHaveLength(4); expect(f.runtime.verification.outstanding()).toBeUndefined();
  } finally { f.cleanup(); }
});

test('incomplete source coverage blocks both understanding and pursuit dispatch until ingestion commits complete coverage', async () => {
  const f = new Harness(); try {
    const evidence = f.ingest('Prepare the train itinerary from 09:00 to 11:30.', true);
    // The owner records an existing pursuit; it must obey a later coverage loss as well as new understanding.
    f.service.pursue({ actionKey: 'explicit-source-goal', expectedVisibilityRevision: f.store.read().visibilityRevision, expectedRevision: 0,
      semanticKey: 'train-before-noon', goal: 'Prepare train itinerary', completionCriteria: [criterion], scope, reason: 'explicit-goal', evidenceRefs: [evidence] }, owner);
    expect(f.pursuit.currentActor).toBeUndefined(); expect(f.actions.list(f.pursuit.id)).toEqual([]);
    expect(() => f.actions.create({ ...f.mutation('pre-claim-document'), target: 'document', arguments: {},
      document: { title: 'Too early', body } }, f.workerAccess())).toThrow('responsibility');
    f.store.update(tx=>{const cp=tx.list('checkpoint')[0]!;tx.put('checkpoint',{...cp,revision:cp.revision+1,coverage:{complete:false,gap:'retention_gap'}});});
    await f.runtime.tick(true); expect(f.gateway.runs()).toEqual([]);
    f.restart(); await f.runtime.tick(true); expect(f.gateway.runs()).toEqual([]); expect(f.pursuit.currentActor).toBeUndefined();
    f.ingest('', true); await f.runtime.tick(true);
    expect(f.gateway.runs()).toHaveLength(1); expect(f.pursuit.currentActor?.runRef).toBe(f.gateway.runs()[0].runId);
  } finally { f.cleanup(); }
});

for (const decision of ['needs-work', 'rejected'] as const) test(`independent ${decision} never completes and releases the terminal worker without wedging subsequent ticks`, async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(); const { document, candidate } = f.produce(worker);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const verifier = f.runtime.verification.outstanding()!;
    f.gateway.result(verifier.runId!, 'artifact', f.actions.read(document.ref));
    f.gateway.result(verifier.runId!, 'verdict', f.verdict(document, candidate, decision));
    f.gateway.finish(verifier.runId!); await f.runtime.tick(true);
    expect(f.pursuit.status).not.toBe('done'); expect(f.runtime.lastError).toBeNull(); expect(f.pursuit.currentActor).toBeUndefined();
    f.restart(); await f.runtime.tick(true); expect(f.runtime.lastError).toBeNull(); expect(f.gateway.runs()).toHaveLength(5);
  } finally { f.cleanup(); }
});

test('a failed independent verifier cannot establish completion even with a persisted accepted verdict', async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(); const { document, candidate } = f.produce(worker);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const verifier = f.runtime.verification.outstanding()!;
    f.gateway.result(verifier.runId!, 'artifact', f.actions.read(document.ref));
    const receipt = f.verdict(document, candidate);
    f.gateway.result(verifier.runId!, 'verdict', receipt);
    f.gateway.finish(verifier.runId!, 'failed'); await f.runtime.tick(true);
    expect(f.pursuit.status).not.toBe('done');
    expect(f.pursuit.verification).toBeUndefined();
    expect(f.runtime.lastError).toBeNull();
    expect(f.pursuit.currentActor).toBeUndefined();
  } finally { f.cleanup(); }
});

for (const missing of ['artifact-read', 'selected-verdict-result'] as const) test(`a terminal verifier missing ${missing} cannot complete from a submitted verdict alone`, async () => {
  const f = new Harness(); try {
    const { worker } = await f.discover(); const { document, candidate } = f.produce(worker);
    f.gateway.finish(worker.runId); await f.runtime.tick(true);
    const verifier = f.runtime.verification.outstanding()!;
    if (missing !== 'artifact-read') f.gateway.result(verifier.runId!, 'artifact', f.actions.read(document.ref));
    const receipt = f.verdict(document, candidate);
    if (missing !== 'selected-verdict-result') f.gateway.result(verifier.runId!, 'verdict', receipt);
    f.gateway.finish(verifier.runId!); await f.runtime.tick(true);
    expect(f.store.read().candidates.find(c=>c.id===candidate.id)?.state).toBe('rejected');
    expect(f.pursuit.waitReason).toContain('unverified');
    expect(f.pursuit.status).not.toBe('done'); expect(f.pursuit.verification).toBeUndefined();
    expect(f.store.read().candidates[0].state).not.toBe('applied');
    expect(f.runtime.lastError).toBeNull(); expect(f.pursuit.currentActor).toBeUndefined();
    f.restart(); await f.runtime.tick(true); expect(f.gateway.runs()).toHaveLength(5);
  } finally { f.cleanup(); }
});

for (const completed of [false, true]) test(`background understanding sees authorized ${completed ? 'completed' : 'paused'} scoped history without broadening public context or reviving forgotten history`, async () => {
  const f = new Harness();
  try {
    const evidence = f.ingest('For the earlier trip, only count paid tickets and list pending tickets separately.');
    const understanding = f.service.remember({ actionKey: 'scoped-policy', expectedRevision: 0,
      expectedVisibilityRevision: f.store.read().visibilityRevision, kind: 'preference', value: 'Only paid tickets count; pending tickets are separate',
      scope, explicitness: 'explicit', supportingRefs: [evidence] }, owner).value!;
    const pursuit = f.service.pursue({ actionKey: 'scoped-goal', expectedRevision: 0,
      expectedVisibilityRevision: f.store.read().visibilityRevision, semanticKey: 'earlier-trip', goal: 'Reconcile the earlier trip tickets',
      completionCriteria: ['Useful ticket totals'], scope, reason: 'explicit-goal', evidenceRefs: [evidence] }, owner).value!;
    f.service.control({ actionKey: 'hold-earlier', expectedRevision: pursuit.revision,
      expectedVisibilityRevision: f.store.read().visibilityRevision, kind: 'pursuit', id: pursuit.id, operation: 'pause' }, owner);
    // Context-only fixture: completion semantics are covered by the full worker/verifier tests above.
    if (completed) f.store.update(tx => { const p = tx.get('pursuit', pursuit.id)!; p.status = 'done'; p.paused = false; tx.put('pursuit', p); });
    const checkpoint = f.store.read().checkpoints[0], now = new Date().toISOString();
    f.service.ingest({ sourceIdentity: 'chat-source', epoch: 'epoch-1', expectedCheckpointRevision: checkpoint.revision,
      nextCursor: '4', scopeRevision: 1, capturedAt: now, coverage: { complete: true }, events: [
        { id: 'continue', eventId: 'continue', cursor: '3', object: { kind: 'message', id: 'continue', revision: 1 }, kind: 'message', actor: 'user', scope: {},
          origin: { rootId: 'another-session' }, occurredAt: now, receivedAt: now, scopeRevision: 1, content: { text: 'Continue that trip accounting with the earlier rules.', truncated: false } },
        { id: 'continue-ended', eventId: 'continue-ended', cursor: '4', object: { kind: 'execution', id: 'another-session', revision: 1 }, kind: 'operation', actor: 'application', scope: {},
          origin: { rootId: 'another-session' }, occurredAt: now, receivedAt: now, scopeRevision: 1, content: { text: JSON.stringify({ foregroundActive: false, pendingCommand: false, terminalConfirmed: true }), truncated: false } },
      ] }, RUNTIME_ACCESS);
    expect(f.service.context({ scope: {} }, owner).understandings).toHaveLength(0);
    expect(f.service.context({ scope: {} }, owner).pursuits).toHaveLength(0);
    await f.runtime.tick(true);
    const first = f.gateway.runs().at(-1)!;
    const context = JSON.parse(String(first.args.prompt).split('Context/data:\n')[1]).context;
    expect(context.understandings.map((u: { id: string }) => u.id)).toContain(understanding.id);
    expect(context.pursuits).toContainEqual(expect.objectContaining({ id: pursuit.id, paused: !completed, ...(completed ? { status: 'done' } : {}) }));
    expect(context.evidence.map((e: { id: string }) => e.id)).toContain(evidence);
    f.gateway.finish(first.runId); await f.runtime.tick(true);
    f.service.forget({ actionKey: 'forget-scoped-history',
      expectedVisibilityRevision: f.store.read().visibilityRevision, target: { kind: 'evidence', id: evidence } }, owner);
    f.restart();
    const current = f.store.read().checkpoints[0];
    f.service.ingest({ sourceIdentity: 'chat-source', epoch: 'epoch-1', expectedCheckpointRevision: current.revision,
      nextCursor: '5', scopeRevision: 1, capturedAt: now, coverage: { complete: true }, events: [
        { id: 'after-forget', eventId: 'after-forget', cursor: '5', object: { kind: 'message', id: 'after-forget', revision: 1 }, kind: 'message', actor: 'user', scope: {},
          origin: { rootId: 'another-session' }, occurredAt: now, receivedAt: now, scopeRevision: 1, content: { text: 'What history remains available now?', truncated: false } },
      ] }, RUNTIME_ACCESS);
    await f.runtime.tick(true);
    const after = f.gateway.runs().at(-1)!;
    expect(after.runId).not.toBe(first.runId);
    const withdrawn = JSON.parse(String(after.args.prompt).split('Context/data:\n')[1]).context;
    expect(withdrawn.understandings).toHaveLength(0);
    expect(withdrawn.pursuits).toHaveLength(0);
    expect(withdrawn.evidence.map((e: { id: string }) => e.id)).not.toContain(evidence);
  } finally { f.cleanup(); }
});

test('forget removes verifier excerpts and prompts, withdrawn documents and old execution authority while retaining original run identity',async()=>{
 const f=new Harness();try{const {worker,evidence}=await f.discover();const {document,candidate}=f.produce(worker);f.gateway.finish(worker.runId);await f.runtime.tick(true);
 const verifier=f.runtime.verification.outstanding()!;const receipt=f.verdict(document,candidate);expect(receipt.receipt).toBeTruthy();
 expect(f.runtime.verification.journal.db.query('SELECT count(*) AS n FROM verification_verdicts').get()).toEqual({n:1});
 f.service.forget({actionKey:'forget-source',expectedVisibilityRevision:f.store.read().visibilityRevision,target:{kind:'evidence',id:evidence}},owner);
 const cleaned=f.runtime.cleanupWithdrawn();expect(cleaned.deferred).toBe(0);expect(()=>f.actions.read(document.ref)).toThrow('not found');
 expect(f.runtime.verification.journal.db.query('SELECT count(*) AS n FROM verification_verdicts').get()).toEqual({n:0});
 const r=f.runtime.verification.journal.db.query('SELECT json FROM verification_requests WHERE id=?').get(verifier.id) as {json:string};expect(r.json).not.toContain('excerpt');
 const e=f.runtime.verification.journal.get(verifier.id);expect(e.runId).toBe(verifier.runId);expect(e.args).toEqual({});expect(e.stopRequested).toBe(true);
 expect(f.runtime.accessForCaller('self',true,worker.runId).execution).toBeUndefined();
 }finally{f.cleanup();}
});
