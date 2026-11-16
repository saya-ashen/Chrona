import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, mergeTranscript } from './state';
export async function runStateChecks() {
  let count = 0;
  async function check(name: string, fn: (f: any) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'chat-v2-'));
    const calls: any[] = [], receipts = new Map();
    let stop = false, terminal = false, mode = 'ok', total = 1;
    const run = { runId: 'r1', contextId: 'ctx', active: true, status: 'running' };
    const call = async (t: string, a: any, o: any) => {
      calls.push({ t, a: structuredClone(a), o });
      if (o?.mode === 'async') throw Object.assign(Error(`${t} is called synchronously (its arguments are never stored)`), { code: 'invalid' });
      if (t === 'agent.providers') return { items: [{ id: 'pi', available: true, hash: 'h', revision: 'v', capabilities: { conversation: true, images: true } }] };
      if (t === 'agent.read') {
        const start = Number(a.cursor || 0), end = Math.min(total, start + 100);
        return { run: { ...run, active: !terminal, status: terminal ? 'finished' : 'running' }, items: Array.from({ length: end - start }, (_, i) => ({ sequence: start + i + 1, at: 'now', kind: 'text', payload: { text: String(start + i) } })), nextCursor: end < total ? String(end) : terminal ? null : String(end), ended: terminal, interactions: [], transcript: [] };
      }
      if (mode === 'refuse') throw Object.assign(Error('explicit rejection'), { code: 'invalid' });
      if (mode === 'unknown' && t === 'agent.stop') throw Object.assign(Error('abort outcome unknown'), { code: 'unknown' });
      if (!receipts.has(o.key)) receipts.set(o.key, t === 'agent.run' ? run : t === 'agent.stop' ? { ...run, stopConfirmed: stop } : { accepted: true });
      if (t === 'agent.stop' && stop) receipts.set(o.key, { ...run, stopConfirmed: true });
      if (mode === 'lost') { mode = 'ok'; throw Object.assign(Error('reply lost'), { code: 'unknown' }); }
      return receipts.get(o.key);
    };
    let store = new Store(join(dir, 'data'), join(dir, 'content'), call);
    let c = store.create('pi'); c = store.draft(c.id, { draft: 'hello' }, c.revision);
    const f = { get store() { return store; }, id: c.id, calls, receipts, dir, stop() { stop = true; }, end(n = 1) { terminal = true; total = n; }, mode(m: string) { mode = m; }, restart() { store.close(); store = new Store(join(dir, 'data'), join(dir, 'content'), call); } };
    try { await fn(f); count++; } catch (e) { console.error('FAILED', name); throw e; } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
  await check('sync acceptance and fixed-key recovery', async f => {
    f.mode('lost'); let c = await f.store.operate(f.id, 'send1', 'send', {});
    assert.equal(c.active.runId, undefined); f.restart(); c = await f.store.reconcile(f.id);
    assert.equal(c.active.runId, 'r1'); assert.equal(c.messages.length, 1); assert.equal(f.receipts.size, 1);
    const runs = f.calls.filter((x: any) => x.t === 'agent.run'); assert.equal(runs.length, 2); assert.deepEqual(runs[0], runs[1]); assert.equal(runs[0].o.mode, undefined);
    await assert.rejects(f.store.operate(f.id, 'send1', 'send', { changed: true }), /不能改变/);
  });
  await check('explicit refusal preserves original error and draft', async f => {
    f.mode('refuse'); const c = await f.store.operate(f.id, 'reject', 'send', {});
    assert.equal(c.active, null); assert.equal(c.draft, 'hello'); assert.equal(c.operations[0].status, 'rejected'); assert.equal(c.operations[0].errors[0].message, 'explicit rejection');
    await f.store.reconcile(f.id); assert.equal(f.calls.filter((x: any) => x.t === 'agent.run').length, 1);
  });
  await check('unknown stop retains slot; same key confirms', async f => {
    await f.store.operate(f.id, 's', 'send', {}); f.mode('unknown'); await f.store.operate(f.id, 'stop', 'stop', {}); f.end();
    let c = await f.store.reconcile(f.id); assert.equal(c.active.runId, 'r1'); assert.equal(c.active.stopRequested, true);
    const refused = await f.store.operate(f.id, 'new', 'send', {}); assert.equal(refused.operations.at(-1).stage, 'preflight'); assert.equal(refused.active.runId, 'r1');
    f.mode('ok'); f.stop(); c = await f.store.reconcile(f.id); assert.equal(c.active, null); assert.equal(c.messages.at(-1).run.stopConfirmed, true);
    assert.ok(f.calls.filter((x: any) => x.t === 'agent.stop').every((x: any) => x.o.key === 'stop'));
  });
  await check('late stop cannot change another Run', async f => {
    const c = f.store.get(f.id); c.active = { runId: 'r2' }; c.messages.push({ run: { runId: 'r1' } });
    const op = { kind: 'stop', args: { runId: 'r1' }, output: { runId: 'r1', stopConfirmed: true } }; f.store.apply(c, op);
    assert.equal(c.active.stopConfirmed, undefined); assert.equal(c.messages[0].run.stopConfirmed, true);
  });
  await check('late send does not erase newer draft', async f => {
    f.mode('lost'); await f.store.operate(f.id, 's', 'send', {}); let c = f.store.get(f.id); f.store.draft(f.id, { draft: 'new text' }, c.revision);
    c = await f.store.reconcile(f.id); assert.equal(c.draft, 'new text');
  });
  await check('pending image stays alive and belongs to origin', async f => {
    let c = f.store.upload(f.id, { name: 'tiny.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' });
    const a = c.attachments[0]; f.mode('lost'); await f.store.operate(f.id, 's', 'send', {});
    assert.throws(() => f.store.detach(f.id, a.id), /仍引用/); assert.ok(existsSync(join(f.store.content, a.file)));
    const second = f.store.create('pi'); assert.throws(() => f.store.image(second.id, a.id), /不属于/);
  });
  await check('terminal pages drain across bounded reads', async f => {
    await f.store.operate(f.id, 's', 'send', {}); f.end(705); let c = await f.store.reconcile(f.id);
    assert.ok(c.active); c = await f.store.reconcile(f.id); assert.equal(c.active, null); assert.equal(c.messages.at(-1).run.events.length, 705);
  });
  await check('transcript tail accumulates and declares gaps', async () => {
    const r: any = { transcript: [] }; const items = (a: number, b: number) => Array.from({ length: b-a }, (_, i) => ({ id: String(a+i), at: String(a+i), kind: 'text', text: String(a+i) }));
    mergeTranscript(r, items(0,100)); mergeTranscript(r, items(1,101)); assert.equal(r.transcript.length,101); assert.equal(r.transcript[0].text,'0');
    mergeTranscript(r, items(200,205)); assert.equal(r.transcript.length,106); assert.deepEqual(r.rawTail,items(200,205));
  });
  await check('legacy async data is retained without replay', async f => {
    const c = f.store.get(f.id); c.active = { key: 'old' }; c.operations.push({ key: 'old', kind: 'send', status: 'unknown', args: { prompt: 'old' }, error: 'Call not found' }); f.store.save(c);
    const r = await f.store.reconcile(f.id); assert.ok(r.active); assert.equal(r.operations[0].error,'Call not found'); assert.equal(r.operations[0].status,'legacy-unverified'); assert.equal(f.calls.length,0);
  });
  await check('same-key supplement recovers without duplicate message', async f => {
    await f.store.operate(f.id,'s','send',{}); f.mode('lost'); await f.store.operate(f.id,'m','message',{text:'more'});
    let c = await f.store.operate(f.id,'m','message',{text:'more'}); assert.equal(c.messages.filter((m:any)=>m.id==='m').length,1);
    assert.equal(f.calls.filter((x:any)=>x.t==='agent.write').length,2); assert.equal(f.receipts.size,2);
  });
  await check('preflight blank rejection settles browser operation', async f => {
    let c=f.store.get(f.id);c=f.store.draft(f.id,{draft:'   '},c.revision);
    c=await f.store.operate(f.id,'blank','send',{});
    const receipt=c.operations.at(-1);assert.equal(receipt.status,'rejected');assert.equal(receipt.notAccepted,true);assert.equal(receipt.stage,'preflight');assert.equal(f.receipts.size,0);
    c=f.store.draft(f.id,{draft:'valid'},c.revision);c=await f.store.operate(f.id,'valid','send',{});assert.equal(c.active.runId,'r1');
  });
  await check('message A never consumes saved draft B', async f => {
    await f.store.operate(f.id,'s','send',{});let c=f.store.get(f.id);
    c=f.store.draft(f.id,{draft:'A'},c.revision);const clickedRevision=c.revision;
    c=f.store.draft(f.id,{draft:'B'},c.revision);
    c=await f.store.operate(f.id,'m','message',{text:'A',draftSnapshot:{draft:'A',revision:clickedRevision}});
    assert.equal(c.draft,'B');assert.equal(c.operations.at(-1).snapshot.draft,'A');
  });
  await check('baseline removed from every transcript snapshot', async()=>{
    const old={id:'old',kind:'text',at:'0',text:'old'},n1={id:'n1',kind:'text',at:'1',text:'new1'},n2={id:'n2',kind:'text',at:'2',text:'new2'};
    const run:any={baseline:[old],transcript:[]};mergeTranscript(run,[old,n1]);mergeTranscript(run,[old,n1,n2]);
    assert.deepEqual(run.transcript,[n1,n2]);assert.equal(run.gaps?.length??0,0);
    mergeTranscript(run,[old,n1,{...n2,text:'new2 extended'}]);assert.equal(run.transcript.length,2);assert.equal(run.transcript[1].text,'new2 extended');
  });
  await check('application upgrade retains messages and blocks old context',async f=>{
    f.store.version='v1';await f.store.operate(f.id,'s','send',{});f.end();let c=await f.store.reconcile(f.id);f.store.version='v2';
    c=f.store.draft(f.id,{draft:'new'},c.revision);c=await f.store.operate(f.id,'after-upgrade','send',{});
    assert.equal(c.operations.at(-1).notAccepted,true);assert.equal(f.calls.filter((x:any)=>x.t==='agent.run').length,1);assert.equal(c.messages.length,2);
    c=f.store.newContext(f.id,true);assert.equal(c.context,null);assert.equal(c.messages.length,2);
  });
  await check('Pi blocks sharing timestamp retain ordered identity',async()=>{
    const first={id:'first',kind:'text',at:'same',text:'First block'},second={id:'second',kind:'text',at:'same',text:'First block extended'};
    const run:any={transcript:[]};mergeTranscript(run,[first,second]);mergeTranscript(run,[first,second]);
    assert.deepEqual(run.transcript,[first,second]);
    const longer={...second,text:second.text+' again'};mergeTranscript(run,[first,longer]);
    assert.deepEqual(run.transcript,[first,longer]);assert.equal(run.gaps?.length??0,0);
  });
  return count;
}
