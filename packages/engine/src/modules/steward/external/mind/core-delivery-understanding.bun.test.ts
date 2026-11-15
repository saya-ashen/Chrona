import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreDelivery, type DeliveryPrepare } from './core-delivery';
import { CoreExecutionJournal, type CoreCall } from './core-execution';
import { CoreMindService } from './core-service';
import { CoreMindStore, coreDigest } from './core-store';
import type { CoreAccess, Pursuit, Understanding } from './core-types';

const owner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]};
const author={moduleId:'author-id',hash:'a'.repeat(40)},principal={moduleId:'mind-id',hash:'b'.repeat(40)};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'mind-delivery-understanding-'));
 const store=new CoreMindStore(dir),service=new CoreMindService(store),journal=new CoreExecutionJournal(dir);
 const now=new Date().toISOString();
 // Independent sources keep each understanding dependency outside direct pursuit evidence.
 for(const sourceIdentity of ['support-source','oppose-source'])service.ingest({sourceIdentity,epoch:'epoch-1',expectedCheckpointRevision:0,nextCursor:'1',scopeRevision:1,capturedAt:now,coverage:{complete:true},events:[{id:'event',eventId:'event',cursor:'1',object:{kind:'message',id:sourceIdentity,revision:1},kind:'message',scope:{sessionId:'session'},actor:'user',origin:{rootId:sourceIdentity},occurredAt:now,receivedAt:now,scopeRevision:1,content:{text:sourceIdentity,truncated:false}}]}, {...owner,role:'runtime'});
 const support=store.read().evidence.find(e=>e.sourceIdentity==='support-source')!.id,oppose=store.read().evidence.find(e=>e.sourceIdentity==='oppose-source')!.id;
 const u=service.remember({actionKey:'understand',expectedRevision:0,expectedVisibilityRevision:0,kind:'constraint',value:'Keep original calendar data',scope:{sessionId:'session'},explicitness:'explicit',supportingRefs:[support],opposingRefs:[oppose]},owner).value as Understanding;
 const p=service.pursue({actionKey:'pursue',expectedRevision:0,expectedVisibilityRevision:0,semanticKey:'calendar',goal:'Deliver a calendar',completionCriteria:['Verify actual calendar'],scope:{sessionId:'session'},reason:'explicit-goal',evidenceRefs:[],understandingRefs:[u.id]},owner).value as Pursuit;
 let e=journal.prepare({purpose:'pursuit',subject:p.id,revision:p.revision,visibilityRevision:0,prompt:'Stage calendar',tools:[{moduleId:author.moduleId,tool:'stage'}],principal},now);
 e.runId='actual-run';e.status='running';e.active=true;journal.save(e);
 const worker:CoreAccess={subject:'mind',role:'runtime',scopes:[{sessionId:'session'}],execution:{actor:'mind',runRef:e.runId}};
 const claimed=service.claim({pursuitId:p.id,actionKey:'claim',expectedRevision:p.revision,expectedVisibilityRevision:0},worker).value as Pursuit;e.revision=claimed.revision;journal.save(e);
 const input:DeliveryPrepare={pursuitId:p.id,expectedRevision:claimed.revision,expectedVisibilityRevision:0,actionKey:'delivery',author,admissionId:'admission',requestKey:'original-key',items:[{name:'calendar',dir:'packages/calendar-stage/source',intent:{changes:['Calendar capability'],preserves:['Original data']},materialDigest:'c'.repeat(64)}],criteria:['Verify actual calendar']};
 const receipt={receiptId:'receipt',admissionId:input.admissionId,requestKey:input.requestKey,submitter:author,state:'pending_approval',approvalId:'approval',members:[{name:'calendar',moduleId:'calendar-id',hash:'d'.repeat(40),versionId:'version',expectedActiveHash:null,materialDigest:input.items[0]!.materialDigest,status:'pending_review',selected:false}]};
 const state={submits:0,queries:[] as unknown[],lost:false,admission:undefined as undefined|(()=>void),directory:undefined as undefined|(()=>void)};
 const call:CoreCall=async(target,args)=>{
  if(target==='modules.receipt'){state.queries.push('receiptId'in args?{receiptId:args.receiptId}:{admissionId:args.admissionId,requestKey:args.key});return structuredClone(receipt);}
  if(target==='modules.list'){state.directory?.();return {items:[{id:author.moduleId,name:'author',status:'active',activeHash:author.hash}],nextCursor:null};}
  if(typeof target==='object'&&target.moduleId===author.moduleId){
   if(target.tool==='submit'){state.submits++;if(state.lost)throw Error('original reply lost');return structuredClone(receipt);}
   if(target.tool==='receipt'){state.queries.push(JSON.parse(args.input as string));return structuredClone(receipt);}
  }throw Error('Unexpected gateway call');
 };
 const options={worker:(run:string)=>journal.all().find(e=>e.runId===run),verifyAdmission:async()=>{state.admission?.();}};
 let delivery=new CoreDelivery(dir,service,call,options);
 return {dir,store,service,journal,input,worker,u,support,oppose,state,get delivery(){return delivery;},
  reopen(){delivery.close();delivery=new CoreDelivery(dir,service,call,options);},
  changeUnderstanding(change:(u:Understanding)=>void){store.update(tx=>{const current=tx.get('understanding',u.id)!;change(current);tx.put('understanding',current);});},
  gap(ref:string){const source=store.read().evidence.find(e=>e.id===ref)!;const cp=store.read().checkpoints.find(c=>c.sourceIdentity===source.sourceIdentity)!;service.ingest({sourceIdentity:cp.sourceIdentity,epoch:cp.epoch,expectedCheckpointRevision:cp.revision,nextCursor:'2',scopeRevision:cp.scopeRevision,capturedAt:now,coverage:{complete:false,gap:'source history unavailable'},events:[]},{...owner,role:'runtime'});},
  async stage(){e=journal.get(e.id);e.status='settling';e.ended=true;e.active=false;e.terminalStatus='finished';e.facts=[{runId:e.runId!,callId:'actual-stage',target:{moduleId:author.moduleId,tool:'stage'},...author,status:'succeeded',outputState:'complete',output:{name:input.items[0]!.name,dir:input.items[0]!.dir,materialDigest:input.items[0]!.materialDigest}}];journal.save(e);return delivery.capture(e);},
  close(){delivery.close();journal.close();store.close();rmSync(dir,{recursive:true,force:true});}
 };
}
type Fixture=ReturnType<typeof fixture>;
const refs=['support','oppose'] as const;

test('SQLite handoff with live supporting and opposing evidence permits unchanged review after restart and release',async()=>{
 const f=fixture();try{
  expect(f.store.read().pursuits[0]!.evidenceRefs).not.toContain(f.support);expect(f.store.read().pursuits[0]!.evidenceRefs).not.toContain(f.oppose);
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);f.reopen();
  f.service.release({actionKey:'release',pursuitId:f.input.pursuitId,expectedRevision:f.input.expectedRevision,expectedVisibilityRevision:0,runRef:f.worker.execution!.runRef,executionStopped:true,effectsReconciled:true},f.worker);
  expect((await f.delivery.submit(r.id,owner)).receipt!.receiptId).toBe('receipt');expect(f.state.submits).toBe(1);
  expect(readFileSync(join(f.dir,'mind-delivery.sqlite')).subarray(0,15).toString()).toBe('SQLite format 3');
 }finally{f.close();}
});

for(const ref of refs)for(const phase of ['prepare','capture','submit'] as const)test(`${ref} source gap blocks ${phase} without direct pursuit or visibility changes`,async()=>{
 const f=fixture();try{
  const original=f.service.detail({kind:'pursuit',id:f.input.pursuitId},owner);
  const r=phase==='prepare'?undefined:await f.delivery.prepare(f.input,f.worker);
  if(phase==='submit')expect(await f.stage()).toBe(1);
  f.gap(f[ref]);f.reopen();
  expect(f.service.detail({kind:'pursuit',id:f.input.pursuitId},owner)).toEqual(original);expect(f.store.read().visibilityRevision).toBe(0);
  if(phase==='prepare')await expect(f.delivery.prepare(f.input,f.worker)).rejects.toThrow('evidence');
  if(phase==='capture')await expect(f.stage()).rejects.toThrow('evidence');
  if(phase==='submit'){
   await expect(f.delivery.submit(r!.id,owner)).rejects.toThrow('evidence');
   expect(f.delivery.detail(r!.id,owner).status).toBe('failed');expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);
  }
  expect(f.state.submits).toBe(0);
  if(r){
   expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
   expect(f.delivery.detail(r.id,owner)).toMatchObject({withdrawn:true,payload:null,status:phase==='submit'?'failed':'withdrawn'});
   expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);expect(f.state.submits).toBe(0);
  }
 }finally{f.close();}
});

const changes:{name:string;change:(f:Fixture)=>void}[]=[
 {name:'value without revision bump',change:f=>f.changeUnderstanding(u=>{u.value='Changed calendar constraints';})},
 {name:'supporting refs without revision bump',change:f=>f.changeUnderstanding(u=>{u.supportingRefs=[f.oppose];})},
 {name:'opposing refs without revision bump',change:f=>f.changeUnderstanding(u=>{u.opposingRefs=[];})},
 {name:'understanding removed',change:f=>f.store.update(tx=>tx.delete('understanding',f.u.id))},
 {name:'understanding retracted',change:f=>f.changeUnderstanding(u=>{u.status='retracted';})},
 {name:'understanding value erased',change:f=>f.changeUnderstanding(u=>{u.value='';})},
];
for(const {name,change} of changes)test(`current ${name} invalidates frozen review across SQLite restart`,async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);
  const before=f.delivery.detail(r.id,owner),p=f.service.detail({kind:'pursuit',id:f.input.pursuitId},owner);
  change(f);f.reopen();expect(f.service.detail({kind:'pursuit',id:p.id},owner)).toEqual(p);
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);expect(f.delivery.detail(r.id,owner).pursuitBasis).toBe(before.pursuitBasis);
  expect(f.delivery.detail(r.id,owner).status).toBe('failed');expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);
  expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});f.reopen();
  expect(f.delivery.detail(r.id,owner)).toMatchObject({withdrawn:true,payload:null,status:'failed'});
  expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

test('prepare replay cannot replace old review with changed understanding basis',async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker),before=f.delivery.detail(r.id,owner);
  f.changeUnderstanding(u=>{u.value='Different authorized content';});f.reopen();
  await expect(f.delivery.prepare(f.input,f.worker)).rejects.toThrow('conflicts');
  expect(f.delivery.detail(r.id,owner)).toEqual(before);expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

test('a pursuit-only saved basis cannot bypass current understanding dependencies',async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);
  // Seed the pre-fix pursuit-only digest to exercise stale persisted review, through SQLite.
  const {Database}=await import('bun:sqlite'),db=new Database(join(f.dir,'mind-delivery.sqlite'));
  try{
   const p=f.service.detail({kind:'pursuit',id:f.input.pursuitId},owner),{revision:_revision,updatedAt:_updatedAt,currentActor:_currentActor,...basis}=p;
   const old=f.delivery.detail(r.id,owner);old.pursuitBasis=coreDigest(basis);
   db.query('UPDATE delivery SET body=? WHERE id=?').run(JSON.stringify(old),r.id);
  }finally{db.close();}
  f.reopen();await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('authorization');expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

for(const ref of refs)for(const failure of ['missing','retracted','expired','epoch','scopeRevision','checkpoint-missing'] as const)test(`${ref} evidence ${failure} blocks fresh submit`,async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);
  f.store.update(tx=>{
   const e=tx.get('evidence',f[ref])!,cp=tx.get('checkpoint',e.sourceIdentity)!;
   if(failure==='missing')tx.delete('evidence',e.id);
   else if(failure==='checkpoint-missing')tx.delete('checkpoint',cp.id);
   else if(failure==='epoch'||failure==='scopeRevision'){if(failure==='epoch')cp.epoch='different-epoch';else cp.scopeRevision++;tx.put('checkpoint',cp);}
   else{if(failure==='expired')e.expiredAt=new Date().toISOString();else e.retractedAt=new Date().toISOString();tx.put('evidence',e);}
  });
  f.reopen();await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

for(const ref of ['understanding',...refs] as const)test(`current caller must still read ${ref} scope`,async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);
  if(ref==='understanding')f.changeUnderstanding(u=>{u.scope={sessionId:'other'};});
  else f.store.update(tx=>{const e=tx.get('evidence',f[ref])!;e.scope={sessionId:'other'};tx.put('evidence',e);});
  await expect(f.delivery.submit(r.id,{...owner,scopes:[{sessionId:'session'}]})).rejects.toThrow('scope');expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

for(const phase of ['admission','directory'] as const)test(`dependency loss during asynchronous ${phase} check blocks final dispatch`,async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);
  if(phase==='admission')f.state.admission=()=>f.gap(f.support);
  else{let reads=0;f.state.directory=()=>{if(++reads===2)f.changeUnderstanding(u=>{u.value='Changed during final directory read';});};}
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);expect(f.delivery.detail(r.id,owner).status).toBe('failed');
  expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);
  f.reopen();expect(f.delivery.detail(r.id,owner).status).toBe('failed');
  expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);expect(f.state.submits).toBe(0);
 }finally{f.close();}
});

test('withdrawal after dependency loss retains only the original unknown command for reconciliation',async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage()).toBe(1);f.state.lost=true;
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('original reply lost');f.gap(f.oppose);
  expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});f.reopen();
  expect(f.delivery.detail(r.id,owner)).toMatchObject({withdrawn:true,payload:null,status:'submit-unknown',requestKey:'original-key'});
  const recovered=await f.delivery.submit(r.id,owner);expect(recovered).toMatchObject({withdrawn:true,payload:null,status:'submitted'});
  expect(f.state.submits).toBe(1);expect(f.state.queries).toEqual([{admissionId:'admission',requestKey:'original-key'}]);
 }finally{f.close();}
});
