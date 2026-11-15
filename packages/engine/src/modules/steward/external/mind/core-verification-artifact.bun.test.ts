import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { retainedToolOutput } from '../../run-events';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreApplication } from './core-application';
import { CoreActions, type DocumentArtifact } from './core-actions';
import { artifactToolResult, type ArtifactChunk } from './core-artifact';
import { CoreExecutionJournal, type CoreCall, type ToolFact } from './core-execution';
import { CoreVerification, type VerdictInput, type VerdictReceipt } from './core-verification';
import type { CoreAccess, Evidence, Pursuit } from './core-types';

const now = '2026-11-13T14:00:00.000Z';
const identity = { moduleId: 'mind-real', hash: 'mind-v1' };
const binding = { ...identity, runId: 'verifier-run' };
const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const workerAccess: CoreAccess = { subject: 'worker', role: 'runtime', scopes: [{}], execution: { actor: 'worker', runRef: 'worker-run' } };
const reader: CoreAccess = { subject: 'verifier', role: 'runtime', scopes: [{}] };
const criterion = 'Give supported departure and arrival times, arriving before noon';
// Supplementary characters and a decisive answer beyond the first retained result.
const notes = 'x'.repeat(2047) + '🚆\n' + '経由駅を比較する旅程の記録。\n'.repeat(2500);
const itinerary = (arrival: string) => `Published timetable: depart 09:00, arrive ${arrival}.`;
const fact = (tool: string, value: unknown, callId: string, runId = binding.runId): ToolFact => ({
  runId, callId, target: { moduleId: identity.moduleId, tool }, ...identity, status: 'succeeded',
  ...retainedToolOutput({ json: JSON.stringify(value) }, false),
});
const item = (value: ToolFact) => ({ kind: 'tool-result', payload: { type: 'tool-result', value } });
function readFacts(document: DocumentArtifact): ToolFact[] {
  const result = artifactToolResult(document), facts = [fact('artifact', result, 'manifest')];
  if ('kind' in result && result.kind === 'artifact-manifest') {
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = artifactToolResult(document, offset) as ArtifactChunk;
      facts.push(fact('artifact', chunk, `chunk-${offset}`)); offset = chunk.nextOffset;
    }
  }
  return facts;
}

async function fixture(kind: 'document' | 'application-read' = 'document', arrival = '11:30', body?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'mind-large-artifact-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store), workers = new CoreExecutionJournal(directory);
  const pursuit: Pursuit = { id: 'p', revision: 2, createdAt: now, updatedAt: now, visibilityRevision: 0,
    semanticKey: 'train', goal: 'Find a supported train itinerary arriving before noon', completionCriteria: [criterion],
    scope: {}, reason: 'explicit-goal', evidenceRefs: ['e'], understandingRefs: [], artifactRefs: [], status: 'active', paused: false,
    currentActor: { actor: 'worker', runRef: 'worker-run', claimedRevision: 2, stopRequested: false } };
  const evidence: Evidence = { id: 'e', revision: 1, createdAt: now, updatedAt: now, sourceIdentity: 'owner', epoch: '1', eventId: 'message', cursor: '1',
    object: { kind: 'message', id: 'message', revision: 1 }, kind: 'message', scope: {}, actor: 'user', origin: { rootId: 'message' },
    occurredAt: now, receivedAt: now, scopeRevision: 1, visibilityRevision: 0, sourceDigest: 'original',
    content: { text: `Use the published timetable: depart 09:00, arrive ${arrival}. I need to arrive before noon.`, truncated: false } };
  store.update(tx => { tx.put('evidence', evidence); tx.put('pursuit', pursuit); });
  let items: unknown[] = [], ended = false, applicationCalls = 0, response: unknown = { notes, timetable: itinerary(arrival) };
  const call: CoreCall = async (target, args) => {
    if (target === 'modules.list') return { items: [{ id: 'trains-real', name: 'trains', activeHash: 'trains-v1' }], nextCursor: null };
    if (typeof target === 'object' && target.moduleId === 'trains-real' && target.tool === 'lookup') { applicationCalls++; return response; }
    if (target === 'agent.run') return { runId: binding.runId, contextId: 'independent-context', active: true, status: 'running' };
    if (target === 'agent.read') {
      // Exercise real cursor accumulation and unique call identities across bounded observation pages.
      const offset = Number(args.cursor ?? 0), page = items.slice(offset, offset + 12), next = offset + page.length;
      return { run: { runId: binding.runId, contextId: 'independent-context', active: !ended, status: ended ? 'finished' : 'running' },
        items: page, ended, nextCursor: next < items.length ? String(next) : null, interactions: [] };
    }
    throw Error(`Unexpected target ${JSON.stringify(target)}`);
  };
  let application = new CoreApplication(directory, service, call, identity.moduleId);
  let actions = new CoreActions(directory, service, () => application);
  const action = { actionKey: 'create', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0 };
  let document: DocumentArtifact;
  if (kind === 'application-read') {
    const adapter = await application.grant({ moduleId: 'trains-real', activeHash: 'trains-v1', tool: 'lookup', effect: 'read', params: {}, description: 'Published timetable lookup' }, owner);
    document = await actions.applicationRead({ ...action, adapterId: adapter.id, params: {} }, workerAccess) as DocumentArtifact;
  } else document = actions.create({ ...action, target: 'document', arguments: {}, document: { title: 'Train itinerary', body: body ?? notes + itinerary(arrival) } }, workerAccess);
  // Read after closing/reopening the actual SQLite owners; gateway changes cannot supply the proof.
  actions.close(); application.close(); response = { timetable: 'invented later response' };
  application = new CoreApplication(directory, service, call, identity.moduleId); actions = new CoreActions(directory, service, () => application);
  document = actions.read(document.ref, reader);
  const candidate = service.progress({ actionKey: 'progress', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
    summary: 'Itinerary ready for assessment', artifactRefs: [document.ref], originalReceiptRef: document.ref, evidenceRefs: ['e'], desiredStatus: 'done' }, workerAccess).value!;
  const worker = { ...workers.prepare({ purpose: 'pursuit', subject: 'p', revision: 2, visibilityRevision: 0, prompt: 'Read timetable',
    tools: ['action', 'progress'].map(tool => ({ moduleId: identity.moduleId, tool })) }, now),
    runId: 'worker-run', contextId: 'worker-context', ended: true, active: false, status: 'finished' as const,
    facts: [fact('action', artifactToolResult(document), 'original-action', 'worker-run'), fact('progress', { value: candidate }, 'progress', 'worker-run')] };
  workers.save(worker);
  const verification = new CoreVerification(directory, { store, actions, call, self: () => identity, hasActiveRun: () => false });
  const request = verification.prepare(candidate.id, worker, now);
  const input: VerdictInput = { requestId: request.id, candidateRef: candidate.receipt, artifacts: [{ ref: document.ref, digest: document.digest }],
    decision: 'accepted', observations: [{ criterion, satisfied: true, observation: 'The published timetable gives departure 09:00 and arrival 11:30, before noon.',
      artifactRefs: [document.ref], excerpt: itinerary(arrival) }] };
  return { store, service, actions, workers, worker, document, candidate, request, verification, input,
    get applicationCalls() { return applicationCalls; },
    async start() { await verification.reconcile(now); },
    async finish(receipt: VerdictReceipt, reads = readFacts(actions.read(document.ref, reader))) {
      expect(reads.length + 1).toBeLessThanOrEqual(60);
      items = [...reads, fact('verdict', receipt, 'verdict')].map(item); ended = true;
      // Two passes cover the five-page observation budget.
      await verification.reconcile(now); if (verification.outstanding()) await verification.reconcile(now);
    },
    close() { verification.close(); workers.close(); actions.close(); application.close(); store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test.each(['document', 'application-read'] as const)('persisted >37KB Unicode %s verifies only after every retained chunk and criterion verdict', async kind => {
  const f = await fixture(kind); try {
    expect(f.document.body.length).toBeGreaterThan(37000); expect(Buffer.byteLength(f.document.body)).toBeGreaterThan(37000);
    expect(retainedToolOutput({ json: JSON.stringify(f.document) }, false).outputState).not.toBe('complete');
    expect(f.worker.facts[0].outputState).toBe('complete'); expect(artifactToolResult(f.document)).toMatchObject({ kind: 'artifact-manifest', offsetUnit: 'utf16', bodyLength: f.document.body.length });
    const reads = readFacts(f.actions.read(f.document.ref, reader));
    expect(reads.length).toBeGreaterThan(3); expect(reads.every(r => r.outputState === 'complete')).toBe(true);
    if (kind === 'application-read') { expect(JSON.parse(f.document.body).response.timetable).toBe(itinerary('11:30')); expect(f.applicationCalls).toBe(1); }
    await f.start();
    const receipt = f.verification.verdict(f.input, binding);
    expect(f.verification.assess(f.request.id).verified).toBeUndefined();
    await f.finish(receipt, reads);
    const result = f.verification.assess(f.request.id);
    expect(result.status).toBe('accepted'); expect(result.verified?.criteriaSatisfied).toBe(true);
    expect(f.store.read().pursuits[0].status).toBe('active');
    expect(f.service.applyProgress({ actionKey: 'apply', candidateId: f.candidate.id, expectedRevision: 2, expectedVisibilityRevision: 0, verified: result.verified! }, workerAccess).value?.pursuit.status).toBe('done');
  } finally { f.close(); }
});

test('the full 150000-character action capacity survives control escaping and Unicode boundaries', async () => {
  const tail = itinerary('11:30'), body = ('x'.repeat(2047) + '🚆\u0001\n"\\').padEnd(150000 - tail.length, '\u0001') + tail;
  const f = await fixture('document', '11:30', body); try {
    const reads = readFacts(f.document), chunks = reads.slice(1).map(r => JSON.parse((r.output as { json: string }).json) as ArtifactChunk);
    expect(body.length).toBe(150000); expect(chunks.every(c => !/[\uD800-\uDFFF]/u.test(c.body))).toBe(true);
    expect(chunks.map(c => c.body).join('')).toBe(body);
    expect(createHash('sha256').update(chunks.map(c => c.body).join('')).digest('hex')).toBe(f.document.digest);
    expect(reads.every(r => r.outputState === 'complete')).toBe(true);
    for (const offset of [-1, 1.5, NaN, Infinity, body.length, 2048]) expect(() => artifactToolResult(f.document, offset)).toThrow('complete character');
    await f.start(); await f.finish(f.verification.verdict(f.input, binding), reads);
    expect(f.verification.assess(f.request.id).status).toBe('accepted');
  } finally { f.close(); }
});

test.each(['manifest-only', 'missing-middle', 'missing-tail', 'corrupt-body', 'wrong-digest', 'wrong-length', 'wrong-offset', 'premature-end', 'other-run', 'other-version', 'filtered', 'overlap'])(
  'large artifact cannot verify with %s evidence', async mode => {
    const f = await fixture(); try {
      await f.start(); const receipt = f.verification.verdict(f.input, binding), reads = readFacts(f.document), at = 3;
      const chunk = JSON.parse((reads[at].output as { json: string }).json) as ArtifactChunk;
      if (mode === 'manifest-only') reads.splice(1);
      if (mode === 'missing-middle') reads.splice(at, 1);
      if (mode === 'missing-tail') reads.pop();
      if (mode === 'corrupt-body') reads[at] = fact('artifact', { ...chunk, body: chunk.body + 'invented' }, reads[at].callId);
      if (mode === 'wrong-digest') reads[at] = fact('artifact', { ...chunk, digest: 'invented' }, reads[at].callId);
      if (mode === 'wrong-length') reads[at] = fact('artifact', { ...chunk, bodyLength: chunk.bodyLength - 1 }, reads[at].callId);
      if (mode === 'wrong-offset') reads[at] = fact('artifact', { ...chunk, offset: chunk.offset + 1 }, reads[at].callId);
      if (mode === 'premature-end') reads[at] = fact('artifact', { ...chunk, nextOffset: null }, reads[at].callId);
      if (mode === 'other-run') reads[at].runId = 'worker-run';
      if (mode === 'other-version') reads[at].hash = 'different-version';
      if (mode === 'filtered') reads[at].outputState = 'filtered';
      if (mode === 'overlap') reads[at] = fact('artifact', artifactToolResult(f.document, chunk.offset - 1), reads[at].callId);
      await f.finish(receipt, reads);
      expect(f.verification.assess(f.request.id).status).toBe('unverified'); expect(f.verification.assess(f.request.id).verified).toBeUndefined();
      expect(f.store.read().pursuits[0].status).toBe('active');
    } finally { f.close(); }
  },
);

test.each(['document', 'application-read'] as const)('complete large %s reads retain a failing actual arrival criterion', async kind => {
  const f = await fixture(kind, '13:30'); try {
    await f.start();
    const wrongExcerpt = structuredClone(f.input); wrongExcerpt.observations[0].excerpt = itinerary('11:30');
    expect(() => f.verification.verdict(wrongExcerpt, binding)).toThrow('exact original document excerpts');
    f.input.decision = 'needs-work'; f.input.observations[0].satisfied = false;
    f.input.observations[0].observation = 'The complete published timetable says arrival 13:30, which fails the original request to arrive before noon.';
    await f.finish(f.verification.verdict(f.input, binding));
    expect(f.verification.assess(f.request.id).status).toBe('needs-work'); expect(f.verification.assess(f.request.id).reason).toContain('13:30');
    expect(f.verification.assess(f.request.id).verified).toBeUndefined(); expect(f.store.read().pursuits[0].status).toBe('active');
  } finally { f.close(); }
});

test('adaptive chunk boundaries preserve complete retention for inline credential-like text', async () => {
  const probeFixture = await fixture(); let boundary: number;
  try { boundary = (artifactToolResult({ ...probeFixture.document, body: 'x'.repeat(40000) }, 0) as ArtifactChunk).nextOffset!; }
  finally { probeFixture.close(); }
  const body = 'x'.repeat(boundary) + 'sk-' + 'a'.repeat(12) + ' ' + 'x'.repeat(22000) + itinerary('11:30');
  const f = await fixture('document', '11:30', body); try {
    const reads = readFacts(f.actions.read(f.document.ref, reader));
    expect((artifactToolResult(f.document, 0) as ArtifactChunk).nextOffset).toBeLessThan(boundary);
    expect(reads.every(r => r.outputState === 'complete')).toBe(true);
    expect(reads.slice(1).map(r => (JSON.parse((r.output as { json: string }).json) as ArtifactChunk).body).join('')).toBe(body);
    await f.start(); await f.finish(f.verification.verdict(f.input, binding), reads);
    expect(f.verification.assess(f.request.id).status).toBe('accepted');
  } finally { f.close(); }
});

test('candidate admission accounts for the whole artifact set and verdict within the actual run budget', async () => {
  const body = '\u0001'.repeat(150000 - itinerary('11:30').length) + itinerary('11:30');
  const f = await fixture('document', '11:30', body); try {
    const extra = f.actions.create({ actionKey: 'extra-document', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
      target: 'document', arguments: {}, document: { title: 'Extra notes', body: 'Additional published timetable context.' } }, workerAccess);
    const candidate = f.service.progress({ actionKey: 'extra-progress', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
      summary: 'Two artifacts ready', artifactRefs: [f.document.ref, extra.ref], originalReceiptRef: f.document.ref, evidenceRefs: ['e'], desiredStatus: 'done' }, workerAccess).value!;
    f.worker.facts.push(fact('action', artifactToolResult(extra), 'extra-action', 'worker-run'), fact('progress', { value: candidate }, 'extra-progress', 'worker-run'));
    expect(readFacts(f.document).length + readFacts(extra).length + 1).toBeGreaterThan(60);
    expect(() => f.verification.prepare(candidate.id, f.worker, now)).toThrow('60 tool-call budget');
  } finally { f.close(); }
});

test('a forged or filtered worker manifest cannot establish the persisted original action', async () => {
  const f = await fixture(); try {
    const manifest = artifactToolResult(f.document);
    f.worker.facts[0] = fact('action', { ...manifest, digest: 'model assertion' }, 'original-action', 'worker-run');
    expect(() => f.verification.prepare(f.candidate.id, f.worker, now)).toThrow('persisted selected worker');
    f.worker.facts[0] = fact('action', manifest, 'original-action', 'worker-run'); f.worker.facts[0].outputState = 'filtered';
    expect(() => f.verification.prepare(f.candidate.id, f.worker, now)).toThrow('persisted selected worker');
  } finally { f.close(); }
});
