import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreApplication, type ApplicationGrantInput, type ApplicationInvokeInput } from './core-application';
import { CoreMindStore, coreDigest } from './core-store';
import { CoreMindService } from './core-service';
import type { CoreAccess } from './core-types';
import type { CoreCall } from './core-execution';

const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const runtime: CoreAccess = { subject: 'mind', role: 'runtime', scopes: [{}], execution: { actor: 'mind', runRef: 'run-1' } };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mind-application-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store);
  let rows = [{ id: 'app-1', name: 'catalog', activeHash: 'hash-1' }, { id: 'pi-real', name: 'pi', activeHash: 'pi-hash' }, { id: 'mind-real', name: 'mind', activeHash: 'mind-hash' }];
  const calls: { target: unknown; args: unknown; options: Parameters<CoreCall>[2] }[] = [];
  let reply: (args: Record<string, unknown>) => Promise<unknown> = async () => ({ items: ['actual value'] });
  const call: CoreCall = async (target, args, options) => {
    if (target === 'modules.list') return { items: structuredClone(rows), nextCursor: null };
    calls.push({ target, args: structuredClone(args), options: structuredClone(options) }); return reply(args);
  };
  const app = new CoreApplication(directory, service, call, 'mind-real');
  const p = service.pursue({ actionKey: 'pursue', expectedRevision: 0, expectedVisibilityRevision: 0,
    semanticKey: 'catalog', goal: 'Read the actual catalog', completionCriteria: ['Catalog result verified'], scope: { sessionId: 's1' }, reason: 'explicit-goal', evidenceRefs: [] }, owner).value!;
  const pursuit = service.claim({ actionKey: 'claim', pursuitId: p.id, expectedRevision: p.revision, expectedVisibilityRevision: 0 }, runtime).value!;
  const grantInput: ApplicationGrantInput = { moduleId: 'app-1', activeHash: 'hash-1', tool: 'lookup', effect: 'read', params: { query: 'one', limit: 2 }, description: 'Reviewed catalog lookup implementation at hash-1; exact bounded query' };
  cleanup.push(() => { app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, store, service, directory, call, calls, pursuit, grantInput,
    setRows: (next: typeof rows) => { rows = next; }, rows: () => rows,
    setReply: (fn: typeof reply) => { reply = fn; },
    input: (adapterId: string, actionKey = 'read-1'): ApplicationInvokeInput => ({ actionKey, pursuitId: pursuit.id,
      expectedRevision: pursuit.revision, expectedVisibilityRevision: 0, adapterId, params: structuredClone(grantInput.params) }) };
}

 test('owner-only exact version registration, bounded read policy, no caller or Agent claim grants authority', async () => {
  const f = fixture();
  await expect(f.app.grant({ ...f.grantInput, caller: 'owner' } as never, runtime)).rejects.toThrow('owner');
  await expect(f.app.grant({ ...f.grantInput, activeHash: 'old' }, owner)).rejects.toThrow('Exact');
  for (const effect of ['send', 'delete', 'payment', 'publish', 'write']) await expect(f.app.grant({ ...f.grantInput, effect } as never, owner)).rejects.toThrow('read');
  await expect(f.app.grant({ ...f.grantInput, params: { huge: 'x'.repeat(8192) } }, owner)).rejects.toThrow('8 KiB');
  await expect(f.app.grant({ ...f.grantInput, params: { password: 'sensitive-value' } }, owner)).rejects.toThrow('Credentials');
  const a = await f.app.grant(f.grantInput, owner);
  expect(await f.app.grant(f.grantInput, owner)).toEqual(a);
  await expect(f.app.invoke({ ...f.input(a.id), params: { query: 'two' } }, runtime)).rejects.toThrow('Params');
  expect(f.calls).toHaveLength(0);
 });

 test('built-in pi.models resolves real directory ID/hash and allows empty params only', async () => {
  const f = fixture(), builtin = (await f.app.list(runtime)).find(a => a.source === 'builtin')!;
  expect(builtin.moduleId).toBe('pi-real'); expect(builtin.activeHash).toBe('pi-hash');
  const result = await f.app.invoke({ ...f.input(builtin.id), params: {} }, runtime);
  expect(result.status).toBe('succeeded'); expect(f.calls[0]!.target).toEqual({ moduleId: 'pi-real', tool: 'models' });
  expect(f.calls[0]!.options).toEqual({ key: `mind-application:${coreDigest('read-1')}`,
    expectedTarget: { moduleId: 'pi-real', hash: 'pi-hash' } });
  f.setRows(f.rows().filter(r => r.name !== 'pi'));
  await expect(f.app.invoke({ ...f.input(builtin.id, 'pi-again'), params: {} }, runtime)).rejects.toThrow('authorization');
 });

 test('real guard rejects wrong actor, revision and absent authorization before forwarding', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner), input = f.input(a.id);
  await expect(f.app.invoke(input, { ...runtime, execution: { actor: 'other', runRef: 'run-2' } })).rejects.toThrow('responsibility');
  await expect(f.app.invoke({ ...input, expectedRevision: 0 }, runtime)).rejects.toThrow('Version');
  await expect(f.app.invoke({ ...input, adapterId: 'Agent-proposed-target' }, runtime)).rejects.toThrow('authorization');
  f.setRows(f.rows().map(r => r.id === 'app-1' ? { ...r, activeHash: 'hash-2' } : r));
  await expect(f.app.invoke(input, runtime)).rejects.toThrow('version'); expect(f.calls).toHaveLength(0);
 });

 test('actual sanitized receipts survive SQLite reopen; stable replay preserves original result and intent', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner), input = f.input(a.id);
  f.setReply(async () => ({ items: ['actual value'], password: 'very-private', nested: { text: 'Bearer abcdefg123456789' }, url: 'https://u:p@example.org/?token=private' }));
  const first = await f.app.invoke(input, runtime);
  expect(first.status).toBe('succeeded'); expect(first.moduleId).toBe('app-1'); expect(first.activeHash).toBe('hash-1');
  expect(first.argsDigest).toBe(coreDigest(f.grantInput.params)); expect(first.responseDigest).toBe(coreDigest(first.responseBody));
  expect(first.intentDigest).toBe(coreDigest({ guard: { actionKey: input.actionKey, pursuitId: input.pursuitId,
    expectedRevision: input.expectedRevision, expectedVisibilityRevision: input.expectedVisibilityRevision,
    target: 'application-read', arguments: { adapterId: a.id, moduleId: 'app-1', activeHash: 'hash-1',
      tool: 'lookup', effect: 'read', params: f.grantInput.params } },
    subject: runtime.subject, role: runtime.role, execution: runtime.execution }));
  expect(f.calls[0]).toEqual({ target: { moduleId: 'app-1', tool: 'lookup' }, args: f.grantInput.params,
    options: { key: `mind-application:${coreDigest(input.actionKey)}`, expectedTarget: { moduleId: 'app-1', hash: 'hash-1' } } });
  expect(JSON.stringify(first)).not.toContain('very-private'); expect(JSON.stringify(first)).not.toContain('abcdefg123456789');
  expect(f.store.read().actions.find(r => r.id === input.actionKey)?.outcome).toBe('succeeded');
  f.setReply(async () => ({ items: ['changed result'] })); expect(await f.app.invoke(input, runtime)).toEqual(first); expect(f.calls).toHaveLength(1);
  const second = new CoreApplication(f.directory, f.service, f.call, 'mind-real');
  try { expect(second.readReceipt(first.ref, owner)).toEqual(first); expect(await second.invoke(input, runtime)).toEqual(first); }
  finally { second.close(); }
  const other = await f.app.grant({ ...f.grantInput, params: { query: 'different' } }, owner);
  await expect(f.app.invoke({ ...input, adapterId: other.id, params: other.params }, runtime)).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
  expect(readFileSync(join(f.directory, 'mind.sqlite')).subarray(0, 15).toString()).toBe('SQLite format 3');
  for (const suffix of ['', '-wal']) {
    const bytes = readFileSync(join(f.directory, `mind.sqlite${suffix}`)); expect(bytes.includes(Buffer.from('very-private'))).toBe(false);
  }
  expect(() => f.app.readReceipt(first.ref, { subject: 'other-app', role: 'application', scopes: [{ sessionId: 's2' }] })).toThrow('scope');
 });

 test('lost reply stays unknown and repeats only original command; no exception becomes success', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner), input = f.input(a.id);
  f.setReply(async () => { throw Error('password=do-not-store'); });
  const unknown = await f.app.invoke(input, runtime);
  expect(unknown.status).toBe('unknown'); expect(unknown.reason).toBe('dispatch-exception'); expect(unknown.responseBody).toBeUndefined();
  expect(f.app.readReceipt(unknown.ref, owner)).toEqual(unknown);
  expect(f.store.read().actions.find(r => r.id === input.actionKey)?.outcome).toBe('unknown');
  f.setReply(async () => ({ result: 'original actual outcome' }));
  const actual = await f.app.invoke(input, runtime); expect(actual.status).toBe('succeeded');
  expect(actual).toMatchObject({ ref: unknown.ref, intentDigest: unknown.intentDigest, argsDigest: unknown.argsDigest,
    moduleId: unknown.moduleId, activeHash: unknown.activeHash });
  expect(actual.responseDigest).toBe(coreDigest({ result: 'original actual outcome' }));
  expect(f.calls[0]!.options).toEqual({ key: unknown.ref, expectedTarget: { moduleId: 'app-1', hash: 'hash-1' } });
  expect(f.calls[0]).toEqual(f.calls[1]);
 });

 test('unknown receipt recovery after reopen keeps the original reviewed target, key and command digests', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner), input = f.input(a.id, 'recover-original');
  const pendingBody = { status: 'unknown', receipt: 'catalog:original-request' };
  f.setReply(async () => pendingBody);
  const original = await f.app.invoke(input, runtime);
  expect(original.status).toBe('unknown'); expect(original.responseDigest).toBe(coreDigest(pendingBody));
  const reopened = new CoreApplication(f.directory, f.service, f.call, 'mind-real');
  try {
    expect(reopened.readReceipt(original.ref, owner)).toEqual(original);
    const response = { result: 'recovered original outcome' };
    f.setReply(async () => response);
    const recovered = await reopened.invoke(input, runtime);
    expect(recovered).toMatchObject({ status: 'succeeded', ref: original.ref, actionKey: original.actionKey,
      moduleId: original.moduleId, activeHash: original.activeHash, tool: original.tool,
      intentDigest: original.intentDigest, argsDigest: original.argsDigest, createdAt: original.createdAt,
      responseBody: response, responseDigest: coreDigest(response) });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toEqual(f.calls[1]);
    expect(f.calls[1]).toEqual({ target: { moduleId: 'app-1', tool: 'lookup' }, args: f.grantInput.params,
      options: { key: `mind-application:${coreDigest('recover-original')}`,
        expectedTarget: { moduleId: 'app-1', hash: 'hash-1' } } });
    expect(await reopened.invoke(input, runtime)).toEqual(recovered); expect(f.calls).toHaveLength(2);
  } finally { reopened.close(); }
 });

 test('unknown/approval replies retain actual bounded response without success; application failure is real failure', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  for (const raw of [undefined, { status: 'unknown', receipt: 'app:pending' }, { approvalRequired: true }, { status: 'pending' }]) {
    f.setReply(async () => raw); const r = await f.app.invoke(f.input(a.id, `unknown-${f.calls.length}`), runtime);
    expect(r.status).toBe('unknown'); expect(r.responseBody).toEqual(raw);
  }
  f.setReply(async () => ({ ok: false, error: 'lookup failed' }));
  const failed = await f.app.invoke(f.input(a.id, 'failed'), runtime); expect(failed.status).toBe('failed'); expect(failed.responseBody).toEqual({ ok: false, error: 'lookup failed' });
 });

 test('application results above 32 KiB stay complete; invalid replies cannot become successes', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  const raw = { body: '界'.repeat(24000) };
  f.setReply(async () => raw);
  const complete = await f.app.invoke(f.input(a.id, 'complete'), runtime);
  expect(complete.status).toBe('succeeded'); expect(complete.responseBody).toEqual(raw);
  for (const raw of [{ n: Number.NaN }]) {
    f.setReply(async () => raw); const result = await f.app.invoke(f.input(a.id, `large-${f.calls.length}`), runtime);
    expect(result.status).toBe('failed'); expect(result.responseBody).toBeUndefined();
  }
 });

 test('owner revoke, version switch, or pursuit withdrawal during await withholds response', async () => {
  for (const change of ['revoke', 'version', 'withdraw']) {
    const f = fixture(), a = await f.app.grant(f.grantInput, owner);
    f.setReply(async () => {
      if (change === 'revoke') f.app.revoke(a.id, owner);
      if (change === 'version') f.setRows(f.rows().map(r => r.id === 'app-1' ? { ...r, activeHash: 'hash-2' } : r));
      if (change === 'withdraw') f.service.control({ actionKey: 'pause', expectedVisibilityRevision: 0, expectedRevision: f.pursuit.revision, kind: 'pursuit', id: f.pursuit.id, operation: 'pause' }, owner);
      return { result: 'must never be used' };
    });
    await expect(f.app.invoke(f.input(a.id), runtime)).rejects.toThrow('withheld');
    const r = f.app.readReceipt(`mind-application:${coreDigest('read-1')}`, owner);
    expect(r.status).toBe('withheld'); expect(r.responseBody).toBeUndefined();
    expect(f.store.read().actions.find(r => r.id === 'read-1')?.outcome).toBe('failed');
  }
 });

 test('never forwards self, admin, Author submit or unsupported named effect targets', async () => {
  const f = fixture();
  for (const name of ['mind', 'author', 'approvals', 'secrets', 'kernel', 'system', 'agent', 'modules']) {
    const row = { id: `blocked-${name}`, name, activeHash: 'h' }; f.setRows([...f.rows(), row]);
    await expect(f.app.grant({ ...f.grantInput, moduleId: row.id, activeHash: 'h', tool: name === 'author' ? 'submit' : 'read' }, owner)).rejects.toThrow('target');
  }
  for (const tool of ['payment', 'send', 'delete', 'publish', 'author.submit', 'secrets.read', 'approvals.resolve']) await expect(f.app.grant({ ...f.grantInput, tool }, owner)).rejects.toThrow('target');
  expect(() => f.app.revoke('anything', runtime)).toThrow('owner'); expect(f.calls).toHaveLength(0);
 });

 test('no second concurrent dispatch through the same instance', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  f.setReply(async () => { await barrier; return { actual: true }; });
  const running = f.app.invoke(f.input(a.id), runtime);
  await expect(f.app.invoke(f.input(a.id), runtime)).rejects.toThrow('in flight');
  release(); expect((await running).status).toBe('succeeded'); expect(f.calls).toHaveLength(1);
 });

 test('a newly installed exact application can be granted; revocation survives reopening', async () => {
  const f = fixture(); f.setRows([...f.rows(), { id: 'new-app', name: 'new-catalog', activeHash: 'new-hash' }]);
  const a = await f.app.grant({ ...f.grantInput, moduleId: 'new-app', activeHash: 'new-hash' }, owner);
  expect((await f.app.invoke(f.input(a.id), runtime)).moduleId).toBe('new-app');
  f.app.revoke(a.id, owner);
  const second = new CoreApplication(f.directory, f.service, f.call, 'mind-real');
  try {
    expect((await second.list(owner)).some(g => g.id === a.id)).toBe(false);
    await expect(second.invoke(f.input(a.id, 'after-revoke'), runtime)).rejects.toThrow('revoked');
    const renewed = await second.grant({ ...f.grantInput, moduleId: 'new-app', activeHash: 'new-hash' }, owner);
    expect(renewed.id).not.toBe(a.id);
    expect(await second.grant({ ...f.grantInput, moduleId: 'new-app', activeHash: 'new-hash' }, owner)).toEqual(renewed);
  } finally { second.close(); }
 });

 test('first terminal application result stays immutable across independent SQLite instances', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  const second = new CoreApplication(f.directory, f.service, f.call, 'mind-real');
  let firstEntered!: () => void, releaseFirst!: () => void;
  const entered = new Promise<void>(r => { firstEntered = r; });
  const held = new Promise<void>(r => { releaseFirst = r; });
  let count = 0;
  f.setReply(async () => { if (++count === 1) { firstEntered(); await held; return { result: 'late' }; } return { result: 'first terminal' }; });
  try {
    const pending = f.app.invoke(f.input(a.id), runtime); await entered;
    const firstTerminal = await second.invoke(f.input(a.id), runtime); releaseFirst();
    expect(await pending).toEqual(firstTerminal); expect(firstTerminal.responseBody).toEqual({ result: 'first terminal' });
    expect(f.calls[0]).toEqual(f.calls[1]);
  } finally { releaseFirst(); second.close(); }
 });

 test('global visibility withdrawal during call persists no returned content and blocks receipt reuse', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  f.setReply(async () => {
    f.service.forget({ actionKey: 'forget', expectedVisibilityRevision: 0, target: { kind: 'evidence', id: f.pursuit.evidenceRefs[0]! } }, owner);
    return { result: 'withdrawn private result' };
  });
  await expect(f.app.invoke(f.input(a.id), runtime)).rejects.toThrow('withheld');
  expect(() => f.app.readReceipt(`mind-application:${coreDigest('read-1')}`, owner)).toThrow('visibility');
  expect(f.store.read().actions.find(r => r.id === 'read-1')?.outcome).toBe('failed');
 });

 test('an invalid retry cannot reuse an earlier unknown response as its result', async () => {
  const f = fixture(), a = await f.app.grant(f.grantInput, owner);
  f.setReply(async () => ({ status: 'unknown', receipt: 'original-observation' }));
  expect((await f.app.invoke(f.input(a.id), runtime)).responseBody).toBeDefined();
  f.setReply(async () => ({ n: Number.NaN }));
  const failed = await f.app.invoke(f.input(a.id), runtime);
  expect(failed.status).toBe('failed'); expect(failed.responseBody).toBeUndefined(); expect(failed.responseDigest).toBeUndefined();
 });

test('focus is local to reviewed apps overview and cannot expand another adapter contract', async () => {
  const f = fixture(), granted = await f.app.grant(f.grantInput, owner);
  await expect(f.app.invoke({ ...f.input(granted.id), focus: { name: 'catalog' } }, runtime)).rejects.toThrow('reviewed apps overview');
  const pi = (await f.app.list(runtime)).find(a => a.moduleId === 'pi-real')!;
  await expect(f.app.invoke({ ...f.input(pi.id), params: {}, focus: { name: 'catalog' } }, runtime)).rejects.toThrow('reviewed apps overview');
  f.setRows([...f.rows(), { id: 'apps-real', name: 'apps', activeHash: 'reviewed-apps' }]);
  const apps = (await f.app.list(runtime)).find(a => a.moduleId === 'apps-real')!;
  await expect(f.app.invoke({ ...f.input(apps.id), params: {}, focus: {} }, runtime)).rejects.toThrow('moduleId or name');
  expect(f.calls).toHaveLength(0);
});
