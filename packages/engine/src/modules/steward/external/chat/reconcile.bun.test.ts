import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, mergeTranscript } from './state';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function readResult(runId = 'r1', ended = false, nextCursor: string | null = ended ? null : '1') {
  return {
    run: { runId, active: !ended, status: ended ? 'finished' : 'running' },
    items: [{ sequence: 1, kind: 'text', payload: { text: 'output' } }],
    transcript: [{ kind: 'text', at: '1', text: 'output' }],
    interactions: [], ended, nextCursor,
  };
}
async function fixture(fn: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-reconcile-'));
  const calls: any[] = [], reads: (() => Promise<any>)[] = [];
  let runs = 0, commandError = '', stopConfirmed = false;
  const store = new Store(join(dir, 'data'), join(dir, 'content'), async (target, args, options) => {
    calls.push(structuredClone({ target, args, options }));
    if (target === 'agent.providers') return { items: [{ id: 'pi', available: true, hash: 'h', revision: 'v', capabilities: { conversation: true } }] };
    if (target === 'agent.read') return reads.length ? reads.shift()!() : readResult(args.runId);
    if (commandError) throw Object.assign(Error('reply unknown'), { code: commandError });
    if (target === 'agent.run') return { runId: `r${++runs}`, contextId: 'ctx', status: 'running' };
    if (target === 'agent.stop') return { runId: args.runId, stopConfirmed };
    if (target === 'agent.write') return { accepted: true };
    throw Error('unexpected target ' + target);
  });
  let c = store.create('pi');
  c = store.draft(c.id, { draft: 'first' }, c.revision);
  await store.operate(c.id, 'send1', 'send', {});
  const hold = () => {
    const started = deferred<void>(), result = deferred<any>();
    reads.push(() => { started.resolve(); return result.promise; });
    return { started: started.promise, resolve: result.resolve, reject: result.reject };
  };
  try {
    await fn({ store, id: c.id, calls, reads, hold, commandError(value: string) { commandError = value; }, confirmStop() { stopConfirmed = true; } });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('delayed read merges into the latest draft, settings, metadata, messages and operations', async () => {
  await fixture(async ({ store, id, hold }: any) => {
    const read = hold(), poll = store.reconcile(id, false);
    await read.started;
    let c = store.get(id);
    const settings = { ...c.settings, model: 'new-model', thinking: 'high' };
    store.draft(id, { draft: 'new draft', settings }, c.revision);
    store.edit(id, { title: 'new title', pinned: true, archived: true });
    store.upload(id, { name: 'tiny.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' });
    await store.operate(id, 'more', 'message', { text: 'new instruction' });
    const current = store.get(id);
    read.resolve(readResult());
    c = await poll;
    for (const field of ['draft', 'settings', 'revision', 'title', 'pinned', 'archived', 'attachments', 'messages', 'operations']) expect(c[field]).toEqual(current[field]);
    expect(c.active.events).toHaveLength(1);
    expect(store.get(id)).toEqual(c);
  });
});

for (const outcome of ['unknown', 'unconfirmed', 'confirmed']) {
  test(`delayed terminal read preserves concurrent ${outcome} stop and its receipt`, async () => {
    await fixture(async ({ store, id, hold, commandError, confirmStop }: any) => {
      const read = hold(), poll = store.reconcile(id, false);
      await read.started;
      if (outcome === 'unknown') commandError('unknown');
      if (outcome === 'confirmed') confirmStop();
      await store.operate(id, 'stop1', 'stop', { runId: 'r1' });
      const operations = store.get(id).operations;
      read.resolve(readResult('r1', true));
      const c = await poll;
      expect(c.operations).toEqual(operations);
      if (outcome === 'confirmed') {
        expect(c.active).toBeNull();
        expect(c.messages.at(-1).run.stopConfirmed).toBe(true);
      } else {
        expect(c.active.runId).toBe('r1');
        expect(c.active.stopRequested).toBe(true);
        expect(c.active.status).toBe('停止未确认');
        expect(c.messages.some((m: any) => m.role === 'assistant')).toBe(false);
      }
    });
  });
}

for (const failure of [false, true]) {
  test(`late read ${failure ? 'error' : 'completion'} cannot change a newer active run`, async () => {
    await fixture(async ({ store, id, reads, hold }: any) => {
      const read = hold(), poll = store.reconcile(id, false);
      await read.started;
      reads.push(async () => readResult('r1', true));
      await store.reconcile(id, false);
      let c = store.get(id);
      store.draft(id, { draft: 'second' }, c.revision);
      await store.operate(id, 'send2', 'send', {});
      const current = store.get(id);
      expect(current.active.runId).toBe('r2');
      if (failure) read.reject(Error('old read failed'));
      else read.resolve(readResult('r1', true));
      c = await poll;
      expect(c).toEqual(current);
      expect(store.get(id)).toEqual(current);
    });
  });
}

test('late same-run response cannot rewind a cursor advanced by another reader', async () => {
  await fixture(async ({ store, id, reads, hold }: any) => {
    const read = hold(), poll = store.reconcile(id, false);
    await read.started;
    const newer = readResult('r1', false, '3');
    newer.items = [{ sequence: 2, kind: 'text', payload: { text: 'new output' } }];
    newer.transcript[0].text = 'output extended';
    reads.push(async () => newer);
    const current = await store.reconcile(id, false);
    read.resolve(readResult('r1', false, '2'));
    expect(await poll).toEqual(current);
    expect(store.get(id)).toEqual(current);
  });
});

test('each bounded page is merged and saved before the next await', async () => {
  await fixture(async ({ store, id, reads, hold }: any) => {
    reads.push(async () => readResult('r1', true, '2'));
    const read = hold(), poll = store.reconcile(id, false);
    await read.started;
    let c = store.get(id);
    expect(c.active.cursor).toBe('2');
    c = store.draft(id, { draft: 'edited on page two' }, c.revision);
    const revision = c.revision;
    read.resolve(readResult('r1', true));
    c = await poll;
    expect(c.draft).toBe('edited on page two');
    expect(c.revision).toBe(revision);
    expect(c.active).toBeNull();
    expect(c.messages.at(-1).run.events).toHaveLength(1);
  });
});

test('read failure preserves concurrent draft and stop state', async () => {
  await fixture(async ({ store, id, hold, commandError }: any) => {
    const read = hold(), poll = store.reconcile(id, false);
    await read.started;
    let c = store.get(id);
    store.draft(id, { draft: 'new draft' }, c.revision);
    commandError('unknown');
    await store.operate(id, 'stop1', 'stop', {});
    const current = store.get(id);
    read.reject(Error('read unavailable'));
    c = await poll;
    expect(c.draft).toBe('new draft');
    expect(c.revision).toBe(current.revision);
    expect(c.operations).toEqual(current.operations);
    expect(c.active.stopRequested).toBe(true);
    expect(c.active.status).toBe('停止未确认');
    expect(c.active.error).toBe('read unavailable');
  });
});

test('recover=false never replays an unknown command; recover=true reuses its exact intent', async () => {
  await fixture(async ({ store, id, calls, reads, commandError }: any) => {
    commandError('unknown');
    await store.operate(id, 'more', 'message', { text: 'original instruction' });
    const original = calls.find((c: any) => c.target === 'agent.write');
    const before = calls.length;
    reads.push(async () => readResult('r1', true));
    let c = await store.reconcile(id, false);
    expect(calls.slice(before).map((c: any) => c.target)).toEqual(['agent.read']);
    expect(c.operations.at(-1).status).toBe('unknown');
    expect(c.active.runId).toBe('r1');
    commandError('');
    c = store.get(id);
    store.draft(id, { draft: 'newer unrelated draft' }, c.revision);
    reads.push(async () => readResult('r1', true));
    c = await store.reconcile(id, true);
    expect(calls.filter((c: any) => c.target === 'agent.write')).toEqual([original, original]);
    expect(c.messages.filter((m: any) => m.id === 'more')).toHaveLength(1);
    expect(c.draft).toBe('newer unrelated draft');
    expect(c.active).toBeNull();
  });
});

test('recover=false leaves an unknown send without a run ID untouched', async () => {
  await fixture(async ({ store, id, reads, calls, commandError }: any) => {
    reads.push(async () => readResult('r1', true));
    let c = await store.reconcile(id, false);
    store.draft(id, { draft: 'second' }, c.revision);
    commandError('unknown');
    await store.operate(id, 'send2', 'send', {});
    const current = store.get(id), before = calls.length;
    expect(current.active.runId).toBeUndefined();
    c = await store.reconcile(id, false);
    expect(c).toEqual(current);
    expect(calls).toHaveLength(before);
  });
});

for (const failure of [false, true]) {
  test(`overlapping terminal reads archive once when the delayed read ${failure ? 'fails' : 'succeeds'}`, async () => {
    await fixture(async ({ store, id, reads, hold }: any) => {
      const read = hold(), poll = store.reconcile(id, false);
      await read.started;
      reads.push(async () => readResult('r1', true));
      const current = await store.reconcile(id, false);
      if (failure) read.reject(Error('old read failed'));
      else read.resolve(readResult('r1', true));
      expect(await poll).toEqual(current);
      expect(store.get(id)).toEqual(current);
      expect(current.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(1);
    });
  });
}

for (const status of ['pending', 'missing', 'unavailable']) {
  test(`terminal read preserves transcript availability: ${status}`, async () => {
    await fixture(async ({ store, id, reads }: any) => {
      reads.push(async () => {
        const r: any = readResult('r1', true);
        delete r.transcript;
        if (status !== 'missing') r.transcriptState = { status, reason: 'reply unavailable' };
        return r;
      });
      const c = await store.reconcile(id, false);
      if (status === 'unavailable') {
        expect(c.active).toBeNull();
        expect(c.messages.at(-1).run.transcriptState).toEqual({ status, reason: 'reply unavailable' });
      } else {
        expect(c.active.runId).toBe('r1');
        expect(c.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(0);
        reads.push(async () => readResult('r1', true));
        expect((await store.reconcile(id, false)).messages.at(-1).run.transcript).toHaveLength(1);
      }
    });
  });
}

test('draft saves the complete user text', async () => {
  await fixture(async ({ store, id }: any) => {
    const draft = 'x'.repeat(200001);
    store.draft(id, { draft }, store.get(id).revision);
    expect(store.get(id).draft).toBe(draft);
  });
});

test('transcript record identities retain identical operations and update only their own blocks', () => {
  const item = { kind: 'tool', at: 'same', tool: 'bash', args: '{}' };
  const run: any = { baseline: [{ ...item, id: 'old' }], transcript: [] };
  mergeTranscript(run, [{ ...item, id: 'old' }, { ...item, id: 'a' }, { ...item, id: 'b' }]);
  expect(run.transcript.map((x: any) => x.id)).toEqual(['a', 'b']);
  mergeTranscript(run, [{ ...item, id: 'b', args: '{"done":true}' }, { ...item, id: 'c' }]);
  expect(run.transcript.map((x: any) => x.id)).toEqual(['a', 'b', 'c']);
  expect(run.transcript[1].args).toBe('{"done":true}');
});
