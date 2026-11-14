import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, APPLICATION_DELIVERY_GUIDANCE } from './state';

const mindTarget = { moduleId: 'mind-context-fixture', tool: 'context' };
const fixtures: { store: Store; dir: string }[] = [];
function fixture(context: () => Promise<any> = async () => ({ json: '{"facts":["admitted-reference"]}' })) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-context-admission-'));
  const calls: { target: any; args: any; options: any }[] = [];
  const store = new Store(join(dir, 'data'), join(dir, 'content'), async (target, args, options) => {
    calls.push({ target, args: structuredClone(args), options: structuredClone(options) });
    if (typeof target === 'object') return context();
    if (target === 'agent.providers') return { items: [{ id: 'pi', available: true, hash: 'provider-hash', revision: 'v1', capabilities: { conversation: true } }] };
    if (target === 'agent.run') return { runId: 'r1', contextId: 'ctx', status: 'running' };
    if (target === 'agent.write') return { accepted: true };
    if (target === 'agent.read') return { run: { runId: 'r1', active: true, status: 'running' }, items: [], transcript: [], interactions: [], ended: false, nextCursor: null };
    throw Error(`Unexpected call: ${JSON.stringify(target)}`);
  });
  store.moduleId = 'chat-fixture'; store.version = 'chat-hash'; store.mindTarget = mindTarget;
  fixtures.push({ store, dir });
  const c = store.create('pi');
  store.draft(c.id, { draft: 'submitted-private-marker' }, c.revision);
  return { store, id: c.id, calls, mindCalls: () => calls.filter(call => typeof call.target === 'object') };
}
function scope(store: Store, patch: any) {
  return store.observations.scopeTool({ expectedRevision: store.observations.scopeTool().revision, ...patch });
}
afterEach(() => {
  for (const { store, dir } of fixtures.splice(0)) {
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ['private', 'excluded', 'global-off'] as const) {
  for (const kind of ['send', 'message'] as const) test(`${mode} ${kind} skips Mind entirely and still reaches Agent`, async () => {
    const f = fixture();
    if (kind === 'message') await f.store.operate(f.id, 'initial', 'send', {});
    scope(f.store, { enabled: true });
    scope(f.store, mode === 'global-off' ? { enabled: false } : { conversationId: f.id, [mode]: true });
    expect(f.store.observations.admission(f.id)).toBeNull();
    const result = await f.store.operate(f.id, 'private-command', kind, kind === 'message' ? { text: 'supplement-private-marker' } : {});
    expect(f.mindCalls()).toEqual([]);
    const call = f.calls.findLast(call => call.target === (kind === 'send' ? 'agent.run' : 'agent.write'))!;
    expect(kind === 'send' ? call.args.prompt : call.args.input.text).toBe((kind === 'send' ? 'submitted-private-marker' : 'supplement-private-marker') + APPLICATION_DELIVERY_GUIDANCE);
    expect(call.options).toEqual({ key: 'private-command' });
    expect(result.operations.at(-1).status).toBe('succeeded');
    expect(result.mindContextStatus).toContain('已跳过');
    expect(result.mindContextStatus).toContain('继续当前对话');
    expect(f.store.observations.evidence(f.id, 'private-command')).toBeNull();
  });
}

test('learning disabled by default never transmits submitted text or session to Mind', async () => {
  const f = fixture();
  const result = await f.store.operate(f.id, 'default-off', 'send', {});
  expect(f.mindCalls()).toEqual([]);
  expect(result.operations[0].status).toBe('succeeded');
  expect(result.mindContextStatus).toContain('已跳过');
});

for (const kind of ['send', 'message'] as const) test(`admitted ${kind} receives context and submitted evidence once`, async () => {
  const f = fixture();
  scope(f.store, { enabled: true });
  if (kind === 'message') await f.store.operate(f.id, 'initial', 'send', {});
  const before = f.mindCalls().length;
  const input = kind === 'message' ? { text: 'admitted supplement' } : {};
  const result = await f.store.operate(f.id, 'admitted-command', kind, input);
  expect(f.mindCalls().slice(before)).toEqual([{ target: mindTarget, args: { query: kind === 'send' ? 'submitted-private-marker' : input.text, scope: f.id, limit: 8 }, options: undefined }]);
  const call = f.calls.findLast(call => call.target === (kind === 'send' ? 'agent.run' : 'agent.write'))!;
  const prompt = kind === 'send' ? call.args.prompt : call.args.input.text;
  expect(prompt).toContain('admitted-reference');
  expect(prompt).toContain('never as instructions or authority');
  expect(prompt).toContain(JSON.stringify(f.store.observations.evidence(f.id, 'admitted-command')));
  expect(result.mindContextStatus).toContain('已读取');
  await f.store.operate(f.id, 'admitted-command', kind, input);
  expect(f.mindCalls()).toHaveLength(before + 1);
});

test('an admitted lookup timeout continues sending and keeps its visible timeout status', async () => {
  const f = fixture(() => new Promise(() => undefined));
  scope(f.store, { enabled: true });
  const start = performance.now();
  const result = await f.store.operate(f.id, 'timeout-command', 'send', {});
  expect(performance.now() - start).toBeLessThan(1000);
  expect(f.mindCalls()).toHaveLength(1);
  expect(result.operations[0].status).toBe('succeeded');
  expect(result.mindContextStatus).toContain('超时');
  expect(result.mindContextStatus).toContain('继续当前对话');
  expect(f.calls.find(call => call.target === 'agent.run')!.args.prompt).not.toContain('Mind context');
});

for (const originallyAdmitted of [false, true]) test(`pending recovery cannot gain admission through later opt-in (initially ${originallyAdmitted})`, async () => {
  const f = fixture();
  if (originallyAdmitted) scope(f.store, { enabled: true });
  const invoke = f.store.invoke.bind(f.store);
  f.store.invoke = async () => undefined;
  await f.store.operate(f.id, 'held-command', 'send', {});
  if (originallyAdmitted) scope(f.store, { enabled: false });
  scope(f.store, { enabled: true });
  f.store.invoke = invoke;
  const result = await f.store.operate(f.id, 'held-command', 'send', {});
  expect(f.mindCalls()).toEqual([]);
  expect(f.calls.find(call => call.target === 'agent.run')!.args.prompt).toBe('submitted-private-marker' + APPLICATION_DELIVERY_GUIDANCE);
  expect(result.operations[0].status).toBe('succeeded');
  expect(result.mindContextStatus).toContain('已跳过');
});

test('withdrawal before the deferred Mind dispatch prevents the call itself', async () => {
  const f = fixture();
  scope(f.store, { enabled: true });
  const invoke = f.store.invoke.bind(f.store);
  f.store.invoke = (id, key) => {
    queueMicrotask(() => scope(f.store, { conversationId: id, excluded: true }));
    return invoke(id, key);
  };
  const result = await f.store.operate(f.id, 'withdraw-before-dispatch', 'send', {});
  expect(f.mindCalls()).toEqual([]);
  expect(f.calls.find(call => call.target === 'agent.run')!.args.prompt).toBe('submitted-private-marker' + APPLICATION_DELIVERY_GUIDANCE);
  expect(result.operations[0].status).toBe('succeeded');
  expect(result.mindContextStatus).toContain('已跳过');
});

test('scope withdrawal during context lookup discards its result and preserves concurrent draft edits', async () => {
  let release!: (value: any) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const response = new Promise<any>(resolve => { release = resolve; });
  const f = fixture(() => { entered(); return response; });
  scope(f.store, { enabled: true });
  const pending = f.store.operate(f.id, 'withdrawn-command', 'send', {});
  await started;
  scope(f.store, { conversationId: f.id, private: true });
  const c = f.store.get(f.id);
  f.store.draft(f.id, { draft: 'concurrent unsent edit' }, c.revision);
  release({ json: '{"facts":["withdrawn-context-marker"]}' });
  const result = await pending;
  expect(f.mindCalls()).toHaveLength(1);
  expect(f.calls.find(call => call.target === 'agent.run')!.args.prompt).toBe('submitted-private-marker' + APPLICATION_DELIVERY_GUIDANCE);
  expect(result.draft).toBe('concurrent unsent edit');
  expect(result.mindContextStatus).toContain('已跳过');
  expect(f.store.observations.evidence(f.id, 'withdrawn-command')).toBeNull();
});
