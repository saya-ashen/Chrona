import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoreMindStore } from './core-store';
import { CoreAdmission, type AdmissionVerdictInput } from './core-admission';
import type { CoreAccess, Evidence, Pursuit } from './core-types';
import type { CoreCall } from './core-execution';

const now = '2026-11-13T15:00:00.000Z';
const identity = { moduleId: 'mind-module', hash: 'mind-hash' };
const access: CoreAccess = { subject: 'web:trusted', role: 'application', scopes: [{}], semanticAdmission: { digest: 'caller-supplied-forbidden-marker' } };
const evidence: Evidence = { id: 'evidence-1', revision: 1, createdAt: now, updatedAt: now, sourceIdentity: 'owner', epoch: '1',
  eventId: 'event-1', cursor: '1', object: { kind: 'message', id: 'message-1', revision: 1 }, kind: 'message', scope: {}, actor: 'user',
  origin: { rootId: 'message-1' }, occurredAt: now, receivedAt: now, scopeRevision: 0, visibilityRevision: 0, sourceDigest: 'source',
  content: { text: 'What is 2 + 2?', truncated: false } };
const pursuit: Pursuit = { id: 'pursuit-1', revision: 2, createdAt: now, updatedAt: now, semanticKey: 'summary-language',
  goal: 'Use German for all future summaries', completionCriteria: ['Use German for all future summaries'], scope: {}, reason: 'improvement', evidenceRefs: ['evidence-1'],
  understandingRefs: [], status: 'waiting', paused: false, artifactRefs: [], visibilityRevision: 0 };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mind-admission-'));
  const store = new CoreMindStore(directory);
  store.update(tx => { tx.put('evidence', evidence); tx.put('pursuit', pursuit); });
  const state = { active: true, ended: false, items: [] as unknown[], runCalls: 0, apply: [] as Array<{ operation: string; input: Record<string, unknown>; access: CoreAccess }> };
  const call: CoreCall = async (target, args) => {
    if (target === 'agent.run') { state.runCalls++; return { runId: 'verifier-run', contextId: 'verifier-context', status: 'running', active: true }; }
    if (target === 'agent.read') return { run: { runId: 'verifier-run', contextId: 'verifier-context', status: state.active ? 'running' : 'finished', active: state.active }, items: state.items, ended: state.ended, nextCursor: null, interactions: [] };
    throw Error(`Unexpected target ${JSON.stringify(target)} ${JSON.stringify(args)}`);
  };
  const admission = new CoreAdmission(store, call, () => identity, (operation, input, supplied) => {
    state.apply.push({ operation, input, access: supplied });
  }, { hasActiveRun: () => false });
  const finish = async (input: AdmissionVerdictInput) => {
    const verdict = admission.verdict(input, { ...identity, runId: 'verifier-run' });
    state.items = [{ kind: 'tool-result', payload: { type: 'tool-result', value: {
      runId: 'verifier-run', callId: 'admission-verdict', target: { ...identity, tool: 'admission-verdict' }, ...identity,
      status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(verdict) },
    } } }];
    state.active = false; state.ended = true;
    await admission.tick(now);
  };
  return { store, admission, state, finish, cleanup: () => { admission.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

// The verifier receives the exact candidate, target and source digests from its bounded prompt and returns them unchanged.
function exactVerdict(admission: CoreAdmission, requestId: string, decision: 'accepted' | 'rejected' = 'accepted'): AdmissionVerdictInput {
  const view = admission.view(requestId) as AdmissionReceiptView;
  return { requestId, candidateDigest: view.candidateDigest, targetDigest: view.targetDigest, sourceDigest: view.sourceDigest, decision, reason: decision === 'accepted' ? 'Supported by the exact evidence.' : 'The evidence does not support the candidate.' };
}
type AdmissionReceiptView = { requestId: string; candidateDigest: string; targetDigest: string; sourceDigest: string; status: string };

test('malformed scope fails before reserving or dispatching semantic admission', async () => {
  const f = fixture(); try {
    const input = { actionKey:'bad-scope', expectedVisibilityRevision:0, expectedRevision:0, semanticKey:'summary',
      goal:'Prepare summary', completionCriteria:['Usable summary'], scope:{project:'fixture',sourceSessionId:'chat'}, reason:'explicit-goal', evidenceRefs:['evidence-1'] };
    expect(() => f.admission.enqueue('pursue', input, access, now)).toThrow('scope');
    expect(f.admission.pending()).toEqual([]);
    await f.admission.tick(now); expect(f.state.runCalls).toBe(0);
    const receipt = f.admission.enqueue('pursue', {...input,scope:{}}, access, now);
    expect(receipt.status).toBe('pending');
  } finally { f.cleanup(); }
});

test('unrelated evidence cannot be turned into an accepted nonowner semantic mutation', async () => {
  const f = fixture(); try {
    const receipt = f.admission.enqueue('remember', { actionKey: 'remember', expectedVisibilityRevision: 0, expectedRevision: 0, kind: 'preference', value: 'All future summaries must be in German', scope: {}, explicitness: 'explicit', supportingRefs: ['evidence-1'] }, access, now);
    await f.admission.tick(now);
    expect(f.state.runCalls).toBe(1);
    await f.finish(exactVerdict(f.admission, receipt.requestId, 'rejected'));
    expect(f.admission.view(receipt.requestId).status).toBe('rejected');
    expect(f.state.apply).toHaveLength(0);
  } finally { f.cleanup(); }
});

test('only the exact selected successful verifier result permits the authorized callback', async () => {
  const f = fixture(); try {
    const receipt = f.admission.enqueue('pursue', { actionKey: 'pursue', expectedVisibilityRevision: 0, expectedRevision: 2, semanticKey: 'language', goal: 'Use German for future summaries', completionCriteria: ['Use German for future summaries'], scope: {}, reason: 'improvement', evidenceRefs: ['evidence-1'] }, access, now);
    await f.admission.tick(now);
    const forged = exactVerdict(f.admission, receipt.requestId);
    f.admission.verdict(forged, { ...identity, runId: 'verifier-run' });
    f.state.items = [{ kind: 'tool-result', payload: { type: 'tool-result', value: {
      runId: 'verifier-run', callId: 'wrong', target: { ...identity, tool: 'other' }, ...identity, status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(forged) },
    } } }];
    f.state.active = false; f.state.ended = true; await f.admission.tick(now);
    expect(f.admission.view(receipt.requestId).status).toBe('failed'); expect(f.state.apply).toHaveLength(0);

    // A second request proves that the callback receives the helper-owned semantic digest, not caller JSON.
    const second = f.admission.enqueue('feedback', { actionKey: 'feedback', expectedVisibilityRevision: 0, expectedRevision: 2, targetKind: 'pursuit', targetId: 'pursuit-1', value: 'useful', scope: {}, evidenceRefs: ['evidence-1'] }, access, now);
    f.state.active = true; f.state.ended = false; f.state.items = [];
    await f.admission.tick(now); const exact = exactVerdict(f.admission, second.requestId); await f.finish(exact);
    expect(f.admission.view(second.requestId).status).toBe('applied'); expect(f.state.apply).toHaveLength(1);
    expect(f.state.apply[0].access.semanticAdmission?.digest).toBe(second.candidateDigest);
    expect(f.state.apply[0].access.semanticAdmission?.digest).not.toBe(access.semanticAdmission?.digest);
  } finally { f.cleanup(); }
});

test('target or evidence changes invalidate a pending request and cleanup reports unresolved dispatches', async () => {
  const f = fixture(); try {
    const receipt = f.admission.enqueue('feedback', { actionKey: 'feedback', expectedVisibilityRevision: 0, expectedRevision: 2, targetKind: 'pursuit', targetId: 'pursuit-1', value: 'useful', scope: {}, evidenceRefs: ['evidence-1'] }, access, now);
    await f.admission.tick(now); expect(f.admission.outstanding()).toBeDefined();
    f.store.update(tx => { const item = tx.get('evidence', 'evidence-1')!; item.content!.text = 'A changed source'; tx.put('evidence', item); });
    expect(f.admission.cleanupWithdrawn().deferred).toBe(0);
    expect(f.admission.view(receipt.requestId).status).toBe('invalidated');
    expect(f.admission.outstanding()).toBeDefined();
  } finally { f.cleanup(); }
});

test('lost candidate reply reuses the same identity and unrelated state changes do not revoke its evidence', async () => {
  const f=fixture();try{
    const input={actionKey:'lost-reply',expectedVisibilityRevision:0,expectedRevision:0,kind:'preference',value:'A candidate',scope:{},explicitness:'inferred',supportingRefs:['evidence-1']};
    const first=f.admission.enqueue('remember',input,access,now);
    expect(f.admission.enqueue('remember',input,access,now).requestId).toBe(first.requestId);
    expect(()=>f.admission.enqueue('remember',{...input,value:'Changed candidate'},access,now)).toThrow('Same action key');
    f.store.update(tx=>tx.put('evidence',{...evidence,id:'unrelated',eventId:'unrelated',object:{...evidence.object,id:'unrelated'}}));
    await f.admission.tick(now);
    await f.finish(exactVerdict(f.admission,first.requestId));
    expect(f.admission.view(first.requestId).status).toBe('applied');
    expect(f.state.apply).toHaveLength(1);
    expect(f.admission.enqueue('remember',input,access,now).requestId).toBe(first.requestId);
    expect(f.state.runCalls).toBe(1);
  }finally{f.cleanup();}
});

test('oversized combined evidence and candidate are rejected before reserving pending work', () => {
  const f=fixture();try {
    f.store.update(tx=>{
      tx.put('evidence',{...evidence,content:{text:'a'.repeat(12000),truncated:false}});
      tx.put('evidence',{...evidence,id:'evidence-2',object:{...evidence.object,id:'message-2'},content:{text:'b'.repeat(12000),truncated:false}});
    });
    expect(()=>f.admission.enqueue('remember',{actionKey:'oversized',expectedVisibilityRevision:0,expectedRevision:0,kind:'preference',value:'v'.repeat(7900),scope:{},explicitness:'inferred',supportingRefs:['evidence-1','evidence-2']},access,now)).toThrow('prompt exceeds bound');
    expect(f.admission.pending()).toHaveLength(0);
    expect(f.state.runCalls).toBe(0);
  } finally {f.cleanup();}
});

test('a restored legacy oversized request becomes visibly failed and cannot jam later work',async()=>{
  const f=fixture();try {
    f.store.update(tx=>{
      tx.put('evidence',{...evidence,content:{text:'a'.repeat(12000),truncated:false}});
      tx.put('evidence',{...evidence,id:'evidence-2',object:{...evidence.object,id:'message-2'},content:{text:'b'.repeat(12000),truncated:false}});
    });
    const first=f.admission.enqueue('remember',{actionKey:'legacy-oversized',expectedVisibilityRevision:0,expectedRevision:0,kind:'preference',value:'Short candidate',scope:{},explicitness:'inferred',supportingRefs:['evidence-1','evidence-2']},access,now);
    const row=f.admission.journal.db.query('SELECT json FROM admission_requests WHERE id=?').get(first.requestId) as {json:string};
    const legacy=JSON.parse(row.json);legacy.input.value='v'.repeat(7900);
    f.admission.journal.db.query('UPDATE admission_requests SET json=? WHERE id=?').run(JSON.stringify(legacy),first.requestId);
    await f.admission.tick(now);
    expect(f.admission.view(first.requestId).status).toBe('failed');
    expect(f.admission.view(first.requestId).reason).toContain('prompt exceeds bound');
    expect(f.admission.pending()).toHaveLength(0);expect(f.state.runCalls).toBe(0);
    f.admission.enqueue('remember',{actionKey:'later-valid',expectedVisibilityRevision:0,expectedRevision:0,kind:'preference',value:'Short candidate',scope:{},explicitness:'inferred',supportingRefs:['evidence-1']},access,now);
    await f.admission.tick(now);expect(f.state.runCalls).toBe(1);
  } finally {f.cleanup();}
});
