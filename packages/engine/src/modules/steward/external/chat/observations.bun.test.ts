import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type Call } from './state';

const identity = { moduleId: 'chat-observations-fixture', hash: 'chat-fixture-hash-v1' };
const mindTarget = { moduleId: 'mind-fixture', tool: 'context' };
const stores = new Set<Store>();
const directories = new Set<string>();
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const messageRef = (conversationId: string, id: string) => ({ kind: 'message', id: JSON.stringify([conversationId, id]) });

function fixture(call: Call = async target => { throw Error(`Unexpected external call: ${JSON.stringify(target)}`); }) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-observations-'));
  directories.add(dir);
  const open = () => {
    const store = new Store(join(dir, 'data'), join(dir, 'content'), call);
    store.moduleId = identity.moduleId;
    store.version = identity.hash;
    store.mindTarget = mindTarget;
    stores.add(store);
    return store;
  };
  return {
    store: open(),
    reopen(store: Store) {
      store.db.close();
      stores.delete(store);
      return open();
    },
  };
}

afterEach(() => {
  try {
    for (const store of stores) store.db.close();
  } finally {
    stores.clear();
    for (const dir of directories) rmSync(dir, { recursive: true, force: true });
    directories.clear();
    setSystemTime();
  }
});

function scope(store: Store, patch: Record<string, unknown> = { enabled: true }) {
  return store.observations.scopeTool({ expectedRevision: store.observations.scopeTool().revision, ...patch });
}

function addUser(store: Store, conversationId: string, id: string, text: string) {
  const c = store.get(conversationId);
  c.messages.push({ id, role: 'user', text, attachments: [], at: new Date().toISOString() });
  store.save(c);
  return messageRef(conversationId, id);
}

function feed(store: Store, after = '0') {
  const epoch = store.observations.scopeTool().epoch;
  const events: any[] = [];
  let cursor = after;
  for (let page = 0; page < 100; page++) {
    const result = store.observations.observations({ sourceEpoch: epoch, after: cursor, limit: 2 });
    expect(result.coverage.complete).toBe(true);
    expect(byteLength(result)).toBeLessThanOrEqual(32768);
    for (const event of result.events) {
      expect(Number(event.cursor)).toBeGreaterThan(Number(cursor));
      expect(event.id).toBe(`${epoch}:${event.cursor}`);
      cursor = event.cursor;
      events.push(event);
    }
    if (!result.hasMore) {
      expect(new Set(events.map(event => event.id)).size).toBe(events.length);
      return events;
    }
    expect(result.nextCursor).toBe(cursor);
  }
  throw Error('Observation feed did not terminate');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function agentFixture(context: () => Promise<any> = async () => ({ json: JSON.stringify({ facts: ['mind-reference'] }) })) {
  const calls: { target: any; args: any; options: any }[] = [];
  const state = { failNextRun: false, terminal: false, transcript: [] as any[], items: [] as any[] };
  const call: Call = async (target, args, options) => {
    calls.push({ target, args: structuredClone(args), options: structuredClone(options) });
    if (typeof target === 'object' && target.moduleId === mindTarget.moduleId && target.tool === 'context') return context();
    if (target === 'agent.providers') return { items: [{ id: 'pi', available: true, hash: 'provider-hash', revision: 'provider-v1', capabilities: { conversation: true, images: true } }] };
    if (target === 'agent.run') {
      if (state.failNextRun) {
        state.failNextRun = false;
        throw Object.assign(Error('transport-error-private-string'), { code: 'transport' });
      }
      return { runId: 'run-fixture', contextId: 'context-fixture', active: true, status: 'running' };
    }
    if (target === 'agent.read') return {
      run: { runId: 'run-fixture', active: !state.terminal, status: state.terminal ? 'finished' : 'running' },
      items: state.items, transcript: state.transcript, interactions: [], ended: state.terminal, nextCursor: null,
    };
    if (target === 'agent.write') return { accepted: true };
    throw Error(`Unexpected Agent fixture call: ${JSON.stringify(target)}`);
  };
  return { call, calls, state };
}

test('learning is disabled by default; enabling never backscans history, drafts, or a pre-enable Run', () => {
  const { store } = fixture();
  const initial = store.observations.scopeTool();
  expect(initial).toMatchObject({ enabled: false, revision: 0, enabledAt: null, startCursor: '0' });
  const c = store.create('pi');
  const historical = addUser(store, c.id, 'historical-user', 'before-enabling-secret');
  store.draft(c.id, { draft: 'unsent-draft-secret' }, c.revision);
  expect(store.observations.observations().events).toEqual([]);
  expect(store.observations.inventory().objects).toEqual([]);
  expect(store.observations.evidence(c.id, 'historical-user')).toBeNull();

  const enabled = scope(store);
  expect(enabled.enabled).toBe(true);
  expect(enabled.revision).toBe(initial.revision + 1);
  expect(enabled.startCursor).toBe('0');
  expect(enabled.enabledAt).toEqual(expect.any(String));
  const current = store.get(c.id);
  current.messages.push({ id: 'historical-run', role: 'assistant', run: { key: 'historical-user', transcript: [{ kind: 'text', text: 'late-historical-answer-secret' }] } });
  store.save(current);
  store.edit(c.id, { title: 'metadata edit after enabling' });
  expect(store.observations.inventory().objects).toEqual([]);
  expect(store.observations.snapshot({ objectRef: historical }).items).toEqual([]);
  expect(store.observations.snapshot({ objectRef: { kind: 'conversation', id: c.id } }).items).toEqual([]);

  const admitted = addUser(store, c.id, 'new-user', 'newly submitted fact');
  const events = feed(store);
  expect(events.filter(event => event.content).map(event => ({ object: event.object, text: event.content.text }))).toEqual([
    { object: { ...admitted, revision: 1 }, text: 'newly submitted fact' },
    { object: { kind: 'execution', id: c.id, revision: 1 }, text: JSON.stringify({ foregroundActive: false, pendingCommand: false, terminalConfirmed: true }) },
  ]);
  for (const secret of ['before-enabling-secret', 'unsent-draft-secret', 'late-historical-answer-secret']) expect(JSON.stringify(events)).not.toContain(secret);
  expect(store.observations.evidence(c.id, 'new-user')).toEqual({
    source: { ...identity, epoch: enabled.epoch }, objectRef: { ...admitted, revision: 1 }, actor: 'user', scopeRevision: enabled.revision,
  });
});

test('scope mutations require the current CAS revision and conflicts preserve the public state', () => {
  const { store } = fixture();
  const initial = store.observations.scopeTool();
  expect(() => store.observations.scopeTool({ enabled: true })).toThrow(expect.objectContaining({ code: 'conflict' }));
  const enabled = scope(store);
  const before = feed(store);
  expect(() => store.observations.scopeTool({ expectedRevision: initial.revision, enabled: false })).toThrow(expect.objectContaining({ code: 'conflict' }));
  expect(store.observations.scopeTool()).toEqual(enabled);
  expect(feed(store)).toEqual(before);
});

test('save rolls back the main record and observation writes when the observation hook throws', () => {
  const { store } = fixture();
  scope(store);
  const c = store.create('pi');
  const ref = addUser(store, c.id, 'atomic-user', 'committed text');
  const before = store.get(c.id);
  const beforeFeed = feed(store);
  const beforeSnapshot = store.observations.snapshot({ objectRef: ref });
  const saved = store.observations.saved;
  const failure = Error('injected observation failure after ledger writes');
  store.observations.saved = function (previous, next) {
    saved.call(this, previous, next);
    throw failure;
  };
  try {
    const changed = store.get(c.id);
    changed.title = 'must roll back';
    changed.messages[0].text = 'uncommitted correction';
    changed.messages.push({ id: 'uncommitted-user', role: 'user', text: 'uncommitted insertion' });
    expect(() => store.save(changed)).toThrow(failure);
  } finally {
    store.observations.saved = saved;
  }
  expect(store.get(c.id)).toEqual(before);
  expect(feed(store)).toEqual(beforeFeed);
  expect(store.observations.snapshot({ objectRef: ref })).toEqual(beforeSnapshot);
  expect(store.observations.evidence(c.id, 'uncommitted-user')).toBeNull();
  const changed = store.get(c.id);
  changed.messages[0].text = 'committed correction';
  store.save(changed);
  const correction = feed(store).at(-1);
  expect(correction).toMatchObject({ kind: 'correction', object: { ...ref, revision: 2 }, retracts: [beforeFeed.find(event => event.object.kind === ref.kind && event.object.id === ref.id).id], content: { text: 'committed correction' } });
});

test('a sent user fact is persisted and snapshot-verifiable before Mind context resolves or Agent runs', async () => {
  const entered = deferred<void>();
  const context = deferred<any>();
  const agent = agentFixture(() => { entered.resolve(); return context.promise; });
  const { store } = fixture(agent.call);
  const enabled = scope(store);
  const c = store.create('pi');
  store.draft(c.id, { draft: 'submitted before lookup' }, c.revision);
  const pending = store.operate(c.id, 'held-context-send', 'send', {});
  let evidence: any;
  try {
    await entered.promise;
    expect(agent.calls.filter(call => call.target === 'agent.run')).toEqual([]);
    expect(store.get(c.id).messages).toEqual([expect.objectContaining({ id: 'held-context-send', role: 'user', text: 'submitted before lookup' })]);
    evidence = store.observations.evidence(c.id, 'held-context-send');
    expect(evidence).toEqual({ source: { ...identity, epoch: enabled.epoch }, objectRef: { ...messageRef(c.id, 'held-context-send'), revision: 1 }, actor: 'user', scopeRevision: enabled.revision });
    const snapshot = store.observations.snapshot({ objectRef: evidence.objectRef, expectedRevision: evidence.objectRef.revision });
    expect(snapshot.source).toEqual(evidence.source);
    expect(snapshot.items).toEqual([expect.objectContaining({ actor: 'user', content: expect.objectContaining({ text: 'submitted before lookup' }) })]);
    expect(agent.calls.filter(call => typeof call.target === 'object')).toEqual([{ target: mindTarget, args: { query: 'submitted before lookup', scope: c.id, limit: 8 }, options: undefined }]);
  } finally {
    context.resolve({ json: JSON.stringify({ facts: ['held-context-reference'] }) });
    await pending;
  }
  const runs = agent.calls.filter(call => call.target === 'agent.run');
  expect(runs).toHaveLength(1);
  expect(runs[0]!.args.prompt).toContain('held-context-reference');
  expect(runs[0]!.args.prompt).toContain(JSON.stringify(evidence));
});

test('retry after an uncertain dispatch reuses exact arguments and key, fetching Mind context once', async () => {
  const agent = agentFixture();
  agent.state.failNextRun = true;
  const { store, reopen } = fixture(agent.call);
  scope(store);
  const c = store.create('pi');
  store.draft(c.id, { draft: 'original submitted text' }, c.revision);
  const first = await store.operate(c.id, 'stable-send', 'send', {});
  expect(first.operations[0]).toMatchObject({ status: 'unknown', contextState: 'ready' });
  expect(agent.calls.filter(call => call.target === 'agent.run')).toHaveLength(1);
  const recovered = reopen(store);
  recovered.draft(c.id, { draft: 'later draft must not replace arguments' }, recovered.get(c.id).revision);
  const result = await recovered.operate(c.id, 'stable-send', 'send', {});
  expect(result.operations[0].status).toBe('succeeded');
  expect(result.draft).toBe('later draft must not replace arguments');
  expect(result.messages.filter((message: any) => message.id === 'stable-send')).toHaveLength(1);
  const runs = agent.calls.filter(call => call.target === 'agent.run');
  expect(runs).toHaveLength(2);
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[0]!.options).toEqual({ key: 'stable-send' });
  expect(runs[0]!.args.prompt).toContain('mind-reference');
  expect(runs[0]!.args.prompt).toContain('original submitted text');
  expect(runs[0]!.args.prompt).not.toContain('later draft');
  expect(agent.calls.filter(call => typeof call.target === 'object')).toHaveLength(1);
  await expect(recovered.operate(c.id, 'stable-send', 'send', { changed: true })).rejects.toThrow(/不能改变/);
  expect(agent.calls.filter(call => call.target === 'agent.run')).toHaveLength(2);
});

test('only persisted final text and categorical operation outcomes are exposed, with opaque attachment refs', async () => {
  const agent = agentFixture();
  agent.state.failNextRun = true;
  agent.state.transcript = [
    { kind: 'text', at: '1', text: 'public first paragraph' },
    { kind: 'thinking', at: '2', text: 'thinking-private-string' },
    { kind: 'native', at: '3', text: 'native-private-string', payload: { path: '/private/native-path' } },
    { kind: 'error', at: '4', text: 'provider-error-private-string' },
    { kind: 'text', at: '5', text: 'public final paragraph' },
  ];
  agent.state.items = [{ sequence: 1, kind: 'native', payload: { text: 'raw-run-event-private-string' } }];
  const { store } = fixture(agent.call);
  scope(store);
  let c = store.create('pi');
  c = store.upload(c.id, { name: '/private/attachment-name.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' });
  const attachment = c.attachments[0];
  store.draft(c.id, { draft: 'public user text' }, c.revision);
  await store.operate(c.id, 'private-filter-send', 'send', {});
  expect(feed(store).some(event => event.kind === 'result')).toBe(false);
  await store.operate(c.id, 'private-filter-send', 'send', {});
  expect(store.get(c.id).active.transcript).toEqual(agent.state.transcript);
  expect(feed(store).some(event => event.actor === 'assistant')).toBe(false);
  agent.state.terminal = true;
  const final = await store.reconcile(c.id);
  expect(final.active).toBeNull();
  const events = feed(store);
  const result = events.filter(event => event.kind === 'result');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ actor: 'assistant', origin: { rootId: c.id, runId: 'run-fixture', parentId: messageRef(c.id, 'private-filter-send').id }, content: { text: 'public first paragraph\npublic final paragraph' } });
  const submitted = events.find(event => event.actor === 'user');
  expect(submitted.content.artifactRefs).toEqual([`chat-attachment:${JSON.stringify([c.id, attachment.id])}`]);
  const failed = events.find(event => event.object.kind === 'operation' && JSON.parse(event.content.text).status === 'unknown');
  expect(failed.actor).toBe('application');
  expect(JSON.parse(failed.content.text)).toEqual({ operation: 'send', status: 'unknown', error: true, errorCode: 'transport' });
  const conversationSnapshot = store.observations.snapshot({ objectRef: { kind: 'conversation', id: c.id } });
  const serialized = JSON.stringify({ events, conversationSnapshot });
  for (const secret of ['thinking-private-string', 'native-private-string', 'provider-error-private-string', 'raw-run-event-private-string', 'transport-error-private-string', '/private/', attachment.file, attachment.ref, 'mind-reference']) expect(serialized).not.toContain(secret);
  expect(store.observations.evidence(c.id, 'run-fixture')).toBeNull();
});

test('oversized UTF-8 feed advances its cursor; bounded snapshot pages reconstruct every byte exactly once', () => {
  const { store } = fixture();
  const enabled = scope(store);
  const c = store.create('pi');
  const before = store.observations.observations({ sourceEpoch: enabled.epoch }).nextCursor;
  const text = '中文😀e\u0301\\"\n'.repeat(1500) + '末尾🧪';
  const ref = addUser(store, c.id, 'oversized-utf8', text);
  const tailRef = addUser(store, c.id, 'after-oversized', 'next event');
  const maxBytes = 1600;
  const first = store.observations.observations({ sourceEpoch: enabled.epoch, after: before, limit: 1, maxBytes });
  expect(byteLength(first)).toBeLessThanOrEqual(maxBytes);
  expect(first.events).toHaveLength(1);
  expect(first.events[0]).toMatchObject({ object: { ...ref, revision: 1 }, content: { truncated: true } });
  expect(first.events[0].content.text.length).toBeGreaterThan(0);
  expect(text.startsWith(first.events[0].content.text)).toBe(true);
  expect(first.events[0].content.text).not.toContain('\ufffd');
  expect(first.nextCursor).toBe(first.events[0].cursor);
  expect(Number(first.nextCursor)).toBeGreaterThan(Number(before));
  expect(first.hasMore).toBe(true);
  const next = store.observations.observations({ sourceEpoch: enabled.epoch, after: first.nextCursor, maxBytes });
  expect(byteLength(next)).toBeLessThanOrEqual(maxBytes);
  expect(next.coverage.complete).toBe(true);
  expect(next.events.map((event: any) => event.object)).toEqual([{ kind: 'execution', id: c.id, revision: 1 }, { ...tailRef, revision: 1 }]);
  expect(next.nextCursor).toBe(next.events.at(-1).cursor);
  expect(next.hasMore).toBe(false);

  const inventory = store.observations.inventory();
  let cursor: string | undefined;
  let reconstructed = '';
  const cursors = new Set<string>();
  let pageCount = 0;
  for (; pageCount < 500; pageCount++) {
    const page = store.observations.snapshot({ objectRef: { ...ref, revision: 1 }, expectedRevision: 1, snapshotToken: inventory.snapshotToken, cursor, maxBytes, limit: 1 });
    expect(byteLength(page)).toBeLessThanOrEqual(maxBytes);
    expect(page.coverage.complete).toBe(true);
    expect(page.items).toHaveLength(1);
    const fragment = page.items[0];
    expect(fragment.object).toEqual({ ...ref, revision: 1 });
    expect(fragment.content.offsetBytes).toBe(Buffer.byteLength(reconstructed));
    expect(fragment.content.text.length).toBeGreaterThan(0);
    expect(fragment.content.text).not.toContain('\ufffd');
    reconstructed += fragment.content.text;
    expect(text.startsWith(reconstructed)).toBe(true);
    if (!page.hasMore) { expect(page.nextCursor).toBe(''); break; }
    expect(cursors.has(page.nextCursor)).toBe(false);
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  expect(pageCount).toBeGreaterThan(1);
  expect(pageCount).toBeLessThan(500);
  expect(reconstructed).toBe(text);
  expect(Buffer.from(reconstructed)).toEqual(Buffer.from(text));
});

test('inventory token pins revisions and high water across edits and new objects; later facts remain incremental', () => {
  const { store } = fixture();
  scope(store);
  const c = store.create('pi');
  const firstRef = addUser(store, c.id, 'a', 'original A');
  const secondRef = addUser(store, c.id, 'b', 'original B');
  const first = store.observations.inventory({ limit: 1, maxBytes: 1000 });
  const executionRef = { kind: 'execution', id: c.id, revision: 1 };
  expect(first.objects).toEqual([executionRef]);
  expect(byteLength(first)).toBeLessThanOrEqual(1000);
  expect(first.hasMore).toBe(true);
  const changed = store.get(c.id);
  changed.messages[0].text = 'corrected A';
  changed.messages[1].text = 'corrected B';
  store.save(changed);
  const newRef = addUser(store, c.id, 'c', 'new C');
  const continuation = store.observations.inventory({ snapshotToken: first.snapshotToken, cursor: first.nextCursor, limit: 1, maxBytes: 1000 });
  expect(continuation).toMatchObject({ snapshotToken: first.snapshotToken, highWaterCursor: first.highWaterCursor, scopeRevision: first.scopeRevision, epoch: first.epoch, hasMore: true, objects: [{ ...firstRef, revision: 1 }] });
  expect(byteLength(continuation)).toBeLessThanOrEqual(1000);
  const last = store.observations.inventory({ snapshotToken: first.snapshotToken, cursor: continuation.nextCursor, limit: 1, maxBytes: 1000 });
  expect(last).toMatchObject({ snapshotToken: first.snapshotToken, highWaterCursor: first.highWaterCursor, scopeRevision: first.scopeRevision, epoch: first.epoch, hasMore: false, objects: [{ ...secondRef, revision: 1 }] });
  expect(byteLength(last)).toBeLessThanOrEqual(1000);
  expect([...first.objects, ...continuation.objects, ...last.objects]).toEqual([executionRef, { ...firstRef, revision: 1 }, { ...secondRef, revision: 1 }]);
  for (const [ref, text] of [[firstRef, 'original A'], [secondRef, 'original B']] as const) {
    const pinned = store.observations.snapshot({ objectRef: ref, expectedRevision: 1, snapshotToken: first.snapshotToken });
    expect(pinned.items.map((item: any) => item.content.text)).toEqual([text]);
  }
  const fresh = store.observations.inventory();
  expect(fresh.objects).toEqual([executionRef, { ...firstRef, revision: 2 }, { ...secondRef, revision: 2 }, { ...newRef, revision: 1 }]);
  expect(Number(fresh.highWaterCursor)).toBeGreaterThan(Number(first.highWaterCursor));
  const incremental = feed(store, first.highWaterCursor);
  expect(incremental.map(event => event.content.text)).toEqual(['corrected A', 'corrected B', 'new C']);
  expect(incremental.slice(0, 2).every(event => event.kind === 'correction')).toBe(true);
  expect(() => store.observations.snapshot({ objectRef: firstRef, expectedRevision: 1 })).toThrow(expect.objectContaining({ code: 'revision_changed' }));
});

for (const withdrawal of ['excluded', 'private', 'deleted', 'disabled'] as const) {
  test(`${withdrawal} withdraws prior content, invalidates old tokens, and prevents replay or re-inclusion from reviving it`, () => {
    const { store } = fixture();
    scope(store);
    const c = store.create('pi');
    const ref = addUser(store, c.id, 'withdrawn-user', 'withdrawn-original-secret');
    const changed = store.get(c.id);
    changed.messages[0].text = 'withdrawn-corrected-secret';
    store.save(changed);
    const inventory = store.observations.inventory();
    expect(store.observations.evidence(c.id, 'withdrawn-user')).not.toBeNull();
    if (withdrawal === 'deleted') store.delete(c.id, true);
    else if (withdrawal === 'disabled') scope(store, { enabled: false });
    else scope(store, { conversationId: c.id, [withdrawal]: true });
    expect(() => store.observations.inventory({ snapshotToken: inventory.snapshotToken, cursor: '0' })).toThrow(expect.objectContaining({ code: 'scope_changed' }));
    expect(() => store.observations.snapshot({ objectRef: ref, snapshotToken: inventory.snapshotToken })).toThrow(expect.objectContaining({ code: 'scope_changed' }));
    expect(store.observations.evidence(c.id, 'withdrawn-user')).toBeNull();
    expect(store.observations.snapshot({ objectRef: ref })).toMatchObject({ retracted: true, items: [] });
    expect(store.observations.snapshot({ objectRef: { kind: 'conversation', id: c.id } })).toMatchObject({ retracted: true, items: [] });
    expect(store.observations.inventory().objects).toEqual([]);
    const replay = feed(store);
    expect(replay.some(event => event.kind === 'retract' && event.object.id === ref.id)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain('withdrawn-original-secret');
    expect(JSON.stringify(replay)).not.toContain('withdrawn-corrected-secret');
    expect(replay.every(event => !event.content)).toBe(true);
    if (withdrawal === 'deleted') return;
    if (withdrawal === 'disabled') scope(store, { enabled: true });
    else scope(store, { conversationId: c.id, [withdrawal]: false });
    store.edit(c.id, { title: 're-included metadata edit' });
    expect(store.observations.inventory().objects).toEqual([]);
    expect(store.observations.evidence(c.id, 'withdrawn-user')).toBeNull();
    const admitted = addUser(store, c.id, 'new-after-reinclude', 'new evidence after re-inclusion');
    const executionRef = { kind: 'execution', id: c.id, revision: 3 };
    expect(store.observations.inventory().objects).toEqual([executionRef, { ...admitted, revision: 1 }]);
    const execution = store.observations.snapshot({ objectRef: executionRef, expectedRevision: 3 });
    expect(JSON.parse(execution.items[0].content.text)).toEqual({ foregroundActive: false, pendingCommand: false, terminalConfirmed: true });
    expect(execution).toMatchObject({ retracted: false, coverage: { complete: true } });
    expect(execution.items).toHaveLength(1);
    expect(execution.items[0]).toMatchObject({ object: executionRef, scopeRevision: store.observations.scopeTool().revision });
    expect(store.observations.evidence(c.id, 'new-after-reinclude')).not.toBeNull();
    expect(store.observations.snapshot({ objectRef: ref })).toMatchObject({ retracted: true, items: [] });
    const newReplay = JSON.stringify(feed(store));
    expect(newReplay).not.toContain('withdrawn-original-secret');
    expect(newReplay).not.toContain('withdrawn-corrected-secret');
    expect(newReplay).toContain('new evidence after re-inclusion');
  });
}

test('reauthorized execution revisions survive restart and event retention without backfilling old messages or late results', () => {
  setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  const f = fixture();
  let store = f.store;
  scope(store);
  const c = store.create('pi');
  const oldRef = addUser(store, c.id, 'old-user', 'withdrawn user secret');
  for (let i = 0; i < 6; i++) {
    const current = store.get(c.id);
    current.active = i % 2 ? null : { runId: 'old-run' };
    store.save(current);
  }
  let lastRevision = store.observations.snapshot({ objectRef: { kind: 'execution', id: c.id } }).currentRevision;
  for (let cycle = 0; cycle < 2; cycle++) {
    scope(store, { enabled: false });
    expect(store.observations.snapshot({ objectRef: { kind: 'execution', id: c.id } })).toMatchObject({ retracted: true, items: [] });
    // A new message persisted without consent must stay outside the restored inventory.
    addUser(store, c.id, `disabled-${cycle}`, `disabled secret ${cycle}`);
    store = f.reopen(store);
    setSystemTime(new Date(`2026-0${cycle + 2}-02T00:00:00.000Z`));
    scope(store);
    const current = store.get(c.id);
    current.messages[0].text = 'edited historical secret';
    current.messages.push({ id: `late-result-${cycle}`, role: 'assistant', run: { key: 'old-user', transcript: [{ kind: 'text', text: 'late historical result secret' }] } });
    store.save(current);
    expect(store.observations.inventory().objects).toEqual([]);
    expect(store.observations.snapshot({ objectRef: oldRef })).toMatchObject({ retracted: true, items: [] });
    const fresh = addUser(store, c.id, `fresh-${cycle}`, `fresh consented fact ${cycle}`);
    const execution = store.observations.snapshot({ objectRef: { kind: 'execution', id: c.id } });
    expect(execution.retracted).toBe(false);
    expect(execution.currentRevision).toBe(lastRevision + 2);
    lastRevision = execution.currentRevision;
    expect(store.observations.inventory().objects).toEqual([{ kind: 'execution', id: c.id, revision: lastRevision }, { ...fresh, revision: 1 }]);
    const serialized = JSON.stringify(store.observations.snapshot({ objectRef: { kind: 'conversation', id: c.id } }));
    for (const secret of ['withdrawn user secret', 'edited historical secret', 'disabled secret', 'late historical result secret']) expect(serialized).not.toContain(secret);
    store = f.reopen(store);
    expect(store.observations.snapshot({ objectRef: { kind: 'execution', id: c.id } }).currentRevision).toBe(lastRevision);
  }
});

test('reopening SQLite preserves epoch, event IDs and evidence, while inventory tokens expire', () => {
  const { store, reopen } = fixture();
  const enabled = scope(store);
  const c = store.create('pi');
  const ref = addUser(store, c.id, 'durable-user', 'durable fact');
  const before = feed(store);
  const inventory = store.observations.inventory();
  const evidence = store.observations.evidence(c.id, 'durable-user');
  const reopened = reopen(store);
  expect(reopened.observations.scopeTool().epoch).toBe(enabled.epoch);
  expect(feed(reopened)).toEqual(before);
  expect(reopened.observations.evidence(c.id, 'durable-user')).toEqual(evidence);
  expect(reopened.observations.snapshot({ objectRef: ref }).items[0].content.text).toBe('durable fact');
  expect(() => reopened.observations.inventory({ snapshotToken: inventory.snapshotToken })).toThrow(expect.objectContaining({ code: 'snapshot_expired' }));
  expect(() => reopened.observations.snapshot({ objectRef: ref, snapshotToken: inventory.snapshotToken })).toThrow(expect.objectContaining({ code: 'snapshot_expired' }));
  addUser(reopened, c.id, 'after-reopen', 'next durable fact');
  const next = feed(reopened, before.at(-1).cursor);
  expect(next).toHaveLength(1);
  expect(next[0].id).toBe(`${enabled.epoch}:${next[0].cursor}`);
  expect(Number(next[0].cursor)).toBeGreaterThan(Number(before.at(-1).cursor));
});

test('wrong/missing epochs and a cursor ahead return explicit gaps without content', () => {
  const { store } = fixture();
  const enabled = scope(store);
  const c = store.create('pi');
  addUser(store, c.id, 'epoch-user', 'epoch-protected text');
  const high = store.observations.inventory().highWaterCursor;
  for (const [input, gap] of [
    [{ sourceEpoch: 'different-epoch', after: high }, 'epoch_changed'],
    [{ after: high }, 'source_epoch_required'],
    [{ sourceEpoch: enabled.epoch, after: String(Number(high) + 1) }, 'cursor_ahead'],
  ] as const) {
    const result = store.observations.observations(input);
    expect(result).toMatchObject({ source: { ...identity, epoch: enabled.epoch }, events: [], hasMore: false, coverage: { complete: false, gap } });
  }
});

test('five-minute inventory expiry is explicit for both inventory and snapshot reads', () => {
  setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  const { store } = fixture();
  scope(store);
  const c = store.create('pi');
  const ref = addUser(store, c.id, 'ttl-user', 'TTL fact');
  const inventory = store.observations.inventory();
  setSystemTime(new Date('2026-01-01T00:04:59.999Z'));
  expect(store.observations.snapshot({ objectRef: ref, snapshotToken: inventory.snapshotToken }).items[0].content.text).toBe('TTL fact');
  setSystemTime(new Date('2026-01-01T00:05:00.000Z'));
  expect(() => store.observations.snapshot({ objectRef: ref, snapshotToken: inventory.snapshotToken })).toThrow(expect.objectContaining({ code: 'snapshot_expired' }));
  expect(() => store.observations.inventory({ snapshotToken: inventory.snapshotToken })).toThrow(expect.objectContaining({ code: 'snapshot_expired' }));
  expect(store.observations.inventory().objects).toEqual([{ kind: 'execution', id: c.id, revision: 1 }, { ...ref, revision: 1 }]);
});

test('thirty-day feed retention reports a gap and retains current objects for a snapshot rebuild', () => {
  setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  const { store } = fixture();
  const enabled = scope(store);
  const c = store.create('pi');
  const oldRef = addUser(store, c.id, 'retained-object', 'old current fact');
  const oldHigh = store.observations.inventory().highWaterCursor;
  setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  const recentRef = addUser(store, c.id, 'recent-user', 'recent fact');
  const gap = store.observations.observations({ sourceEpoch: enabled.epoch, after: '0' });
  expect(gap).toMatchObject({ events: [], nextCursor: oldHigh, coverage: { complete: false, gap: 'retention_gap', oldestAvailableCursor: oldHigh } });
  const recent = store.observations.observations({ sourceEpoch: enabled.epoch, after: gap.nextCursor });
  expect(recent.coverage.complete).toBe(true);
  expect(recent.events.map((event: any) => event.object.id)).toEqual([recentRef.id]);
  const inventory = store.observations.inventory();
  expect(inventory.objects).toContainEqual({ ...oldRef, revision: 1 });
  expect(inventory.objects).toContainEqual({ ...recentRef, revision: 1 });
  expect(store.observations.snapshot({ objectRef: oldRef, snapshotToken: inventory.snapshotToken }).items[0].content.text).toBe('old current fact');
});

test('saved owner execution facts track pending, foreground and confirmed terminal state without leaking private data or growing unchanged feeds', () => {
  const started = Date.parse('2026-01-01T00:00:00.000Z');
  setSystemTime(new Date(started));
  const agent = agentFixture();
  const { store } = fixture(agent.call);
  scope(store);
  const c = store.create('pi');
  const executionRef = { kind: 'execution', id: c.id };
  c.draft = 'unsent-execution-draft-secret';
  c.operations.push({ key: 'execution-send', kind: 'send', status: 'prepared', createdAt: new Date().toISOString(), sourceAdmission: store.observations.admission(c.id), args: { prompt: 'execution-command-args-secret' }, errors: [] });
  store.save(c);
  expect(store.observations.inventory().objects).toEqual([]);
  expect(store.observations.snapshot({ objectRef: executionRef }).items).toEqual([]);
  const steps = [
    { change: () => { c.messages.push({ id: 'execution-user', role: 'user', text: 'submitted execution fact', attachments: [], at: new Date().toISOString() }); }, foregroundActive: false, pendingCommand: true, terminalConfirmed: false },
    { change: () => { c.active = { runId: 'execution-run-id-secret', transcript: [{ kind: 'thinking', text: 'execution-thinking-secret' }], events: [{ payload: 'execution-native-secret' }] }; }, foregroundActive: true, pendingCommand: true, terminalConfirmed: false },
    { change: () => { c.operations[0].status = 'succeeded'; }, foregroundActive: true, pendingCommand: false, terminalConfirmed: false },
    { change: () => { c.active = null; }, foregroundActive: false, pendingCommand: false, terminalConfirmed: true },
  ];
  for (const [index, step] of steps.entries()) {
    const occurredAt = new Date(started + index * 10000).toISOString();
    setSystemTime(new Date(occurredAt));
    step.change();
    store.save(c);
    const persisted = store.get(c.id);
    const events = feed(store);
    const executions = events.filter(event => event.object.kind === 'execution');
    expect(executions).toHaveLength(index + 1);
    const execution = executions.at(-1);
    const object = { ...executionRef, revision: index + 1 };
    const text = JSON.stringify({ foregroundActive: step.foregroundActive, pendingCommand: step.pendingCommand, terminalConfirmed: step.terminalConfirmed });
    expect(execution).toMatchObject({ object, kind: 'operation', actor: 'application', occurredAt });
    expect(execution.origin).toEqual({ rootId: c.id });
    expect(execution.content).toEqual({ text, truncated: false });
    const inventory = store.observations.inventory();
    expect(inventory.objects).toContainEqual(object);
    expect(inventory.highWaterCursor).toBe(events.at(-1).cursor);
    const snapshot = store.observations.snapshot({ objectRef: executionRef, expectedRevision: object.revision, snapshotToken: inventory.snapshotToken });
    expect(snapshot).toMatchObject({ currentRevision: object.revision, retracted: false, hasMore: false, coverage: { complete: true } });
    expect(snapshot.items).toEqual([{ ...execution, content: { ...execution.content, offsetBytes: 0 } }]);
    const conversation = store.observations.snapshot({ objectRef: { kind: 'conversation', id: c.id }, snapshotToken: inventory.snapshotToken });
    expect(conversation.items).toContainEqual(snapshot.items[0]);
    const serialized = JSON.stringify({ events, inventory, snapshot, conversation });
    for (const secret of ['unsent-execution-draft-secret', 'execution-command-args-secret', 'execution-run-id-secret', 'execution-thinking-secret', 'execution-native-secret']) expect(serialized).not.toContain(secret);
    expect(store.get(c.id)).toEqual(persisted);
    expect(agent.calls).toEqual([]);

    for (const elapsed of [1000, 2000]) {
      setSystemTime(new Date(started + index * 10000 + elapsed));
      store.save(store.get(c.id));
      expect(feed(store)).toEqual(events);
      expect(store.observations.snapshot({ objectRef: executionRef, expectedRevision: object.revision })).toEqual(snapshot);
    }
    expect(agent.calls).toEqual([]);
  }
});

test('observation reads never dispatch Agent work or reconcile a persisted pending operation', async () => {
  const agent = agentFixture();
  agent.state.failNextRun = true;
  const { store } = fixture(agent.call);
  scope(store);
  const c = store.create('pi');
  store.draft(c.id, { draft: 'pending submitted fact' }, c.revision);
  await store.operate(c.id, 'pending-read-test', 'send', {});
  const before = store.get(c.id);
  const calls = structuredClone(agent.calls);
  const inventory = store.observations.inventory();
  feed(store);
  store.observations.snapshot({ objectRef: messageRef(c.id, 'pending-read-test'), snapshotToken: inventory.snapshotToken });
  store.observations.evidence(c.id, 'pending-read-test');
  store.observations.scopeTool();
  expect(agent.calls).toEqual(calls);
  expect(store.get(c.id)).toEqual(before);
});
