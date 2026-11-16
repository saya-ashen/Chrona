import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreDelivery, deliveryPrepareSchema, deliveryReceiptSchema, type DeliveryPrepare } from './core-delivery';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { deliveryRuntimeHooks } from './core-runtime';
import { CoreExecutionJournal, type CoreCall } from './core-execution';
import type { CoreAccess, Pursuit } from './core-types';
import { candidateReceiptSchema } from '../../../../../../contracts/src/steward/module-candidates';
import { parseSubmit, parseReceipt } from '../author/contracts';
import { assertInterleavedSettlementConverges } from '../../__testing__/state-machine-invariants';
const owner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]};
const author={moduleId:'author-id',hash:'a'.repeat(40)}, principal={moduleId:'mind-id',hash:'b'.repeat(40)};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'mind-delivery-')),store=new CoreMindStore(dir),service=new CoreMindService(store),journal=new CoreExecutionJournal(dir);
 const p=service.pursue({actionKey:'pursue',expectedVisibilityRevision:0,expectedRevision:0,scope:{},semanticKey:'new-capability',goal:'Deliver a new capability',completionCriteria:['Verify real result'],reason:'explicit-goal',evidenceRefs:[],understandingRefs:[]},owner).value as Pursuit;
 let e=journal.prepare({purpose:'pursuit',subject:p.id,revision:p.revision,visibilityRevision:0,prompt:'Implement material',tools:[{moduleId:author.moduleId,tool:'stage'}],principal},new Date().toISOString());e.runId='actual-run';e.status='running';e.active=true;journal.save(e);
 const worker:CoreAccess={subject:'mind',role:'runtime',scopes:[{}],execution:{actor:'mind',runRef:e.runId}};
 const claimed=service.claim({pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'claim'},worker).value as Pursuit;e.revision=claimed.revision;journal.save(e);
 const input:DeliveryPrepare={pursuitId:p.id,expectedRevision:claimed.revision,expectedVisibilityRevision:0,actionKey:'delivery',author,admissionId:'admission',requestKey:'stable-command',items:[{name:'calendar',dir:'packages/calendar-stage/source',intent:{changes:['private-intent-marker'],preserves:[]},materialDigest:'c'.repeat(64)}],criteria:['private-criteria-marker']};
 const receipt:ReturnType<typeof candidateReceiptSchema.parse>={receiptId:'real-receipt',admissionId:input.admissionId,requestKey:input.requestKey,submitter:author,state:'pending_approval',approvalId:'approval',members:[{name:'calendar',moduleId:'calendar-id',hash:'d'.repeat(40),versionId:'version',expectedActiveHash:null,materialDigest:input.items[0]!.materialDigest,status:'pending_review',selected:false}]};
 const state={authorHash:author.hash,submits:0,receiptQueries:[] as unknown[],lost:false,admission:true,active:false,badReceipt:false,baseline:null as null|string,submitError:undefined as Error|undefined,receiptError:undefined as Error|undefined,hold:undefined as undefined|(()=>Promise<void>)};
 const calls:{target:unknown;args:Record<string,unknown>;key?:string}[]=[];
 const call:CoreCall=async(target,args,options)=>{
  calls.push({target,args,key:options?.key});
  if(target==='modules.list')return {items:[{id:author.moduleId,name:'author',status:'active',activeHash:state.authorHash},...(state.baseline?[{id:'calendar-id',name:'calendar',status:'active',activeHash:state.baseline}]:[]),...(state.active?[{id:'calendar-id',name:'calendar',status:'active',activeHash:'d'.repeat(40)}]:[])],nextCursor:null};
  if(typeof target==='object'&&target.moduleId===author.moduleId&&target.tool==='submit'){
   expect(options?.expectedTarget).toEqual({moduleId:author.moduleId,hash:author.hash});state.submits++;expect(parseSubmit(args.input)).toEqual({admissionId:input.admissionId,requestKey:input.requestKey,items:input.items.map(({name,dir,intent})=>({name,dir,intent}))});expect(options?.key).toBe(input.requestKey);await state.hold?.();if(state.submitError)throw state.submitError;if(state.lost)throw Error('lost reply');return structuredClone(receipt);
  }
  if(target==='modules.receipt'){const selector='receiptId'in args?{receiptId:args.receiptId}:{admissionId:args.admissionId,requestKey:args.key};parseReceipt(selector);state.receiptQueries.push(selector);if(state.receiptError)throw state.receiptError;return {...structuredClone(receipt),...(state.badReceipt?{receiptId:'other-receipt'}:{})};}
  throw Error('Unexpected bounded call');
 };
 let submitGate:((pursuitId:string)=>void)|undefined;let admissionWait:(()=>Promise<void>)|undefined;
 const opts={worker:(run:string)=>journal.all().find(e=>e.runId===run),verifyAdmission:async()=>{if(!state.admission)throw Error('Real admission denied');await admissionWait?.();},assertMaySubmit:(id:string)=>submitGate?.(id)};
 let delivery=new CoreDelivery(dir,service,call,opts);
 return {dir,store,service,journal,input,worker,state,call,calls,receipt,get delivery(){return delivery;},setSubmitGate(gate:(pursuitId:string)=>void){submitGate=gate;},setAdmissionWait(wait:()=>Promise<void>){admissionWait=wait;},reopen(){delivery.close();delivery=new CoreDelivery(dir,service,call,opts);},async stage(id:string,mutate?:(execution:import('./core-execution').Execution)=>void){e=journal.get(e.id);e.status='settling';e.ended=true;e.active=false;e.terminalStatus='finished';e.facts=[{runId:e.runId!,callId:'actual-stage-call',target:{moduleId:author.moduleId,tool:'stage'},moduleId:author.moduleId,hash:author.hash,status:'succeeded',outputState:'complete',output:{name:input.items[0]!.name,dir:input.items[0]!.dir,materialDigest:input.items[0]!.materialDigest,files:3,bytes:40,metadata:'packages/calendar-stage/provenance.json'}}];mutate?.(e);journal.save(e);return delivery.capture(e);},cleanup(){delivery.close();journal.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('actual stage proof gates owner-only submission; exact structured receipt and active identity never complete pursuit',async()=>{
 const f=fixture();try{
  expect(candidateReceiptSchema.parse(f.receipt)).toEqual(deliveryReceiptSchema.parse(f.receipt));
  const r=await f.delivery.prepare(f.input,f.worker);expect(r.status).toBe('awaiting-worker-proof');
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('stage proof');expect(f.state.submits).toBe(0);
  expect(await f.stage(r.id)).toBe(1);expect(f.delivery.detail(r.id,owner).proof[0]!.callId).toBe('actual-stage-call');
  for(const access of [f.worker,{...owner,role:'application' as const}]){await expect(f.delivery.submit(r.id,access)).rejects.toThrow('Owner');expect(()=>f.delivery.list({},access)).toThrow('Owner');expect(()=>f.delivery.detail(r.id,access)).toThrow('Owner');}
  const submitted=await f.delivery.submit(r.id,owner);expect(submitted.receipt).toEqual(f.receipt);expect(submitted.observation).toBe('pending approval');
  f.receipt.state='approved';f.receipt.members[0]!.status='approved';f.receipt.members[0]!.selected=true;f.state.active=true;
  const active=await f.delivery.reconcile(r.id,owner);expect(active.observation).toBe('active; waiting for owner proof of original goal');expect(f.state.receiptQueries).toEqual([{receiptId:'real-receipt'}]);expect(f.store.read().pursuits[0]!.status).not.toBe('done');
  f.state.badReceipt=true;await expect(f.delivery.reconcile(r.id,owner)).rejects.toThrow('Immutable');expect(f.delivery.detail(r.id,owner).receipt!.receiptId).toBe('real-receipt');
 }finally{f.cleanup();}
});
test.each([false,true])('first prepared material survives applied progress and auto submission (released=%s)',async released=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker),before=f.delivery.detail(r.id,owner);
  const p=f.store.read().pursuits[0]!;
  const candidate=f.service.progress({pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'progress',summary:'Exact material is ready; waiting for user acceptance',artifactRefs:['artifact:calendar-stage'],originalReceiptRef:'worker-stage-receipt',evidenceRefs:p.evidenceRefs,desiredStatus:'waiting',waitFor:'user',waitReason:'Await user acceptance',nextStep:'Check the original delivery receipt'},f.worker).value!;
  expect(await f.stage(r.id)).toBe(1);
  const applied=f.service.applyProgress({candidateId:candidate.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'apply-progress',verified:{candidateReceipt:candidate.receipt,runRef:'actual-run',originalReceiptRef:candidate.originalReceiptRef,artifactRefs:candidate.artifactRefs,method:'Exact persisted stage material',criteriaSatisfied:false,executionTerminal:true}},f.worker).value!;
  expect(applied.applied).toBe(true);
  expect(applied.pursuit).toMatchObject({status:'waiting',waitFor:'user',artifactRefs:candidate.artifactRefs,nextStep:candidate.nextStep,verification:{runRef:'actual-run',originalReceiptRef:candidate.originalReceiptRef}});
  if(released)f.service.release({pursuitId:p.id,expectedRevision:applied.pursuit.revision,expectedVisibilityRevision:0,actionKey:'release-progress',runRef:'actual-run',executionStopped:true,effectsReconciled:true},f.worker);
  f.reopen();expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
  const hooks=deliveryRuntimeHooks(()=>f.delivery,()=>{throw Error('Stage proof already captured');});
  await hooks.advanceDeliveries!(()=>true);
  expect(f.delivery.detail(r.id,owner)).toMatchObject({status:'submitted',requestKey:before.requestKey,prepareDigest:before.prepareDigest,materials:before.materials,receipt:f.receipt});
  expect(f.state.submits).toBe(1);expect(f.journal.all()).toHaveLength(1);
  expect(f.store.read().pursuits[0]!.status).toBe('waiting');
 }finally{f.cleanup();}
});

test('real user correction after stage and responsibility release invalidates the first material',async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage(r.id)).toBe(1);
  const released=f.service.release({pursuitId:f.input.pursuitId,expectedRevision:f.input.expectedRevision,expectedVisibilityRevision:0,actionKey:'release-before-correction',runRef:'actual-run',executionStopped:true,effectsReconciled:true},f.worker).value as Pursuit;
  f.service.control({kind:'pursuit',id:released.id,operation:'correct',value:'Deliver a read-only calendar',completionCriteria:['Never modify existing events'],expectedRevision:released.revision,expectedVisibilityRevision:0,actionKey:'owner-correction'},owner);
  f.reopen();await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('authorization');
  expect(f.state.submits).toBe(0);expect(f.delivery.detail(r.id,owner).status).toBe('failed');
 }finally{f.cleanup();}
});

test.each(['pause','end','forget'] as const)('real user %s after responsibility release still blocks fresh submission',async operation=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage(r.id)).toBe(1);
  const p=f.service.release({pursuitId:f.input.pursuitId,expectedRevision:f.input.expectedRevision,expectedVisibilityRevision:0,actionKey:'release-before-control',runRef:'actual-run',executionStopped:true,effectsReconciled:true},f.worker).value as Pursuit;
  if(operation==='forget')f.service.forget({target:{kind:'evidence',id:p.evidenceRefs[0]!},expectedVisibilityRevision:0,actionKey:'owner-forget'},owner);
  else f.service.control({kind:'pursuit',id:p.id,operation,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'owner-control'},owner);
  f.reopen();await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);
 }finally{f.cleanup();}
});

test('lost reply survives restart and withdrawal; only original admission/key receipt query is sent',async()=>{
 const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);f.state.lost=true;await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('lost reply');expect(f.delivery.detail(r.id,owner).status).toBe('submit-unknown');f.reopen();
  f.store.update(tx=>{const m=tx.meta();m.visibilityRevision++;tx.setMeta(m);});
  const forgotten=f.delivery.withdraw(r.id,owner);expect(forgotten.payload).toBeNull();expect(forgotten.cleanup).toContain('content-free');
  const bytes=readFileSync(join(f.dir,'mind.sqlite'));expect(bytes.includes(Buffer.from('private-intent-marker'))).toBe(false);expect(bytes.includes(Buffer.from('private-criteria-marker'))).toBe(false);
  f.reopen();const recovered=await f.delivery.submit(r.id,owner);expect(recovered.receipt!.receiptId).toBe('real-receipt');expect(recovered.withdrawn).toBe(true);expect(recovered.payload).toBeNull();expect(f.state.submits).toBe(1);expect(f.state.receiptQueries).toEqual([{admissionId:'admission',requestKey:'stable-command'}]);
  expect(statSync(join(f.dir,'mind.sqlite')).mode&0o777).toBe(0o600);expect(statSync(f.dir).mode&0o777).toBe(0o700);
 }finally{f.cleanup();}
});
test('proof rejects wrong run, called Author identity, target, result state, material and unselected tools',async()=>{
 const mutations=[(e:any)=>e.facts[0].runId='forged',(e:any)=>e.facts[0].moduleId=principal.moduleId,(e:any)=>e.facts[0].hash='e'.repeat(40),(e:any)=>e.facts[0].target.tool='prepare',(e:any)=>e.facts[0].outputState='partial',(e:any)=>e.facts[0].status='failed',(e:any)=>e.facts[0].output.dir='packages/other/source',(e:any)=>e.facts[0].output.materialDigest='0'.repeat(64),(e:any)=>e.facts[0].output.name='other',(e:any)=>e.tools=[],(e:any)=>e.stopRequested=true,(e:any)=>e.terminalStatus='failed',(e:any)=>e.ended=false,(e:any)=>e.active=true];
 for(const mutation of mutations){const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage(r.id,mutation)).toBe(0);await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('stage proof');expect(f.state.submits).toBe(0);}finally{f.cleanup();}}
},20000);
test('current real worker, reserved names, NEW targets, original command conflicts and strict JSON enforced',async()=>{
 const f=fixture();try{await expect(f.delivery.prepare(f.input,owner)).rejects.toThrow('worker');await expect(f.delivery.prepare(f.input,{...f.worker,execution:{actor:'mind',runRef:'made-up'}})).rejects.toThrow('worker');
  for(const name of ['self','core','agent'])expect(deliveryPrepareSchema.safeParse({...f.input,items:[{...f.input.items[0],name}]}).success).toBe(false);
  expect(deliveryPrepareSchema.safeParse({...f.input,role:'owner'}).success).toBe(false);expect(deliveryPrepareSchema.safeParse({...f.input,items:[{...f.input.items[0],dir:'packages/../source'}]}).success).toBe(false);
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.delivery.prepare(f.input,f.worker)).toEqual(r);
  await expect(f.delivery.prepare({...f.input,criteria:['changed']},f.worker)).rejects.toThrow('conflicts');
  f.state.authorHash='e'.repeat(40);await expect(f.stage(r.id)).rejects.toThrow('Author identity');
 }finally{f.cleanup();}
});
test('fresh submit blocks stale authorization, changed Author identity, denied admission and expired source evidence',async()=>{
 for(const kind of ['visibility','criteria','disabled','author','admission','expired']){const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  if(kind==='author')f.state.authorHash='e'.repeat(40);else if(kind==='admission')f.state.admission=false;else f.store.update(tx=>{if(kind==='visibility'){const m=tx.meta();m.visibilityRevision++;tx.setMeta(m);}if(kind==='disabled'){const s=tx.settings();s.enabled=false;tx.setSettings(s);}if(kind==='criteria'){const p=tx.get('pursuit',f.input.pursuitId)!;p.completionCriteria=['Different user acceptance criteria'];tx.put('pursuit',p);}if(kind==='expired'){const e=tx.list('evidence')[0]!;e.expiredAt=new Date().toISOString();tx.put('evidence',e);}});
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);
  expect(f.delivery.detail(r.id,owner).status).toBe('failed');expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);
  expect(f.delivery.list({},owner).items[0]).toMatchObject({status:'failed',needsDecision:false,observation:expect.stringContaining('before dispatch')});
  f.reopen();expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);expect((await f.delivery.submit(r.id,owner)).status).toBe('failed');expect(f.state.submits).toBe(0);
 }finally{f.cleanup();}}
});
test('real responsibility release permits owner handoff; a new claim blocks fresh submission',async()=>{
 for(const reclaim of [false,true]){const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  const released=f.service.release({pursuitId:f.input.pursuitId,expectedRevision:f.input.expectedRevision,expectedVisibilityRevision:0,actionKey:'release',runRef:'actual-run',executionStopped:true,effectsReconciled:true},f.worker).value as Pursuit;
  if(reclaim){f.service.claim({pursuitId:released.id,expectedRevision:released.revision,expectedVisibilityRevision:0,actionKey:'new-claim'},{...f.worker,execution:{actor:'mind',runRef:'new-run'}});await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('authorization');expect(f.state.submits).toBe(0);}else expect((await f.delivery.submit(r.id,owner)).receipt!.receiptId).toBe('real-receipt');
 }finally{f.cleanup();}}
});
test('unknown command recovers by fixed kernel receipt after Author upgrade',async()=>{
 const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);f.state.lost=true;await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('lost reply');f.reopen();f.state.authorHash='e'.repeat(40);expect((await f.delivery.reconcile(r.id,owner)).receipt!.receiptId).toBe('real-receipt');expect(f.state.receiptQueries).toEqual([{admissionId:'admission',requestKey:'stable-command'}]);expect(f.state.submits).toBe(1);
 }finally{f.cleanup();}
});
test('two ledger instances cannot dispatch the same original command twice',async()=>{
 const f=fixture();let other:CoreDelivery|undefined;try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  // Both independently authorized owner adapters share the real durable ledger.
  other=new CoreDelivery(f.dir,f.service,f.call,{worker:run=>f.journal.all().find(e=>e.runId===run),verifyAdmission:async()=>{}});
  const results=await Promise.allSettled([f.delivery.submit(r.id,owner),other.submit(r.id,owner)]);
  expect(results.filter(r=>r.status==='fulfilled').length).toBe(1);expect(f.state.submits).toBe(1);expect(f.delivery.detail(r.id,owner).receipt!.receiptId).toBe('real-receipt');
 }finally{other?.close();f.cleanup();}
});
test('withdrawal during submit cannot resurrect private content from a late reply',async()=>{
 const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);f.state.hold=async()=>{entered();await new Promise<void>(resolve=>release=resolve);};const pending=f.delivery.submit(r.id,owner);await started;expect(f.delivery.withdraw(r.id,owner).cleanup).toContain('deferred');release();const returned=await pending;expect(returned.withdrawn).toBe(true);expect(returned.payload).toBeNull();expect(returned.receipt!.receiptId).toBe('real-receipt');expect(f.state.submits).toBe(1);}finally{f.cleanup();}
});
test('a user control arriving during admission verification blocks fresh dispatch but permits original receipt reconciliation',async()=>{
 const f=fixture();try{
  const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  f.setAdmissionWait(async()=>{entered();await new Promise<void>(resolve=>release=resolve);});
  let held=false;f.setSubmitGate(id=>{expect(id).toBe(f.input.pursuitId);if(held)throw Error('Pending user control');});
  const pending=f.delivery.submit(r.id,owner);await started;held=true;release();
  await expect(pending).rejects.toThrow('Pending user control');expect(f.state.submits).toBe(0);expect(f.delivery.detail(r.id,owner).status).toBe('coordinator-ready');
  held=false;f.setAdmissionWait(async()=>{});f.state.lost=true;
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('lost reply');held=true;
  expect((await f.delivery.submit(r.id,owner)).receipt!.receiptId).toBe('real-receipt');expect(f.state.submits).toBe(1);expect(f.state.receiptQueries).toEqual([{admissionId:'admission',requestKey:'stable-command'}]);
 }finally{f.cleanup();}
});

test('existing application update binds baseline through prepare, receipt and restart; stale updates never submit',async()=>{
 for(const stale of [false,true]){const f=fixture();try{
  const hash='9'.repeat(40);f.state.baseline=hash;f.input.items[0]!.baseline={moduleId:'calendar-id',expectedActiveHash:hash};f.receipt.members[0]!.expectedActiveHash=hash;
  const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);f.reopen();
  if(stale){f.state.baseline='8'.repeat(40);await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('baseline changed');expect(f.state.submits).toBe(0);expect(f.delivery.detail(r.id,owner).withdrawn).toBe(true);expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);}
  else{const submitted=await f.delivery.submit(r.id,owner);expect(submitted.receipt!.members[0]!.expectedActiveHash).toBe(hash);expect(f.store.read().pursuits[0]!.status).not.toBe('done');}
 }finally{f.cleanup();}}
});
test('an existing name without baseline and mismatched update receipt are rejected',async()=>{
 const f=fixture();try{
  f.state.baseline='9'.repeat(40);await expect(f.delivery.prepare(f.input,f.worker)).rejects.toThrow('baseline is required');
  f.input.items[0]!.baseline={moduleId:'calendar-id',expectedActiveHash:f.state.baseline};const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('receipt does not match');expect(f.delivery.detail(r.id,owner).status).toBe('submit-unknown');
 }finally{f.cleanup();}
});

test('pre-dispatch failure preserves its reason through restart and scrubs details on forget', async () => {
 const f=fixture();try{
  const {id}=await f.delivery.prepare(f.input,f.worker);await f.stage(id);
  const reason=`${f.input.items[0]!.dir}: private-intent-marker`;
  f.setAdmissionWait(async()=>{throw Error(reason);});
  await expect(f.delivery.submit(id,owner)).rejects.toThrow(reason);f.reopen();
  expect(f.delivery.detail(id,owner)).toMatchObject({status:'failed',receipt:null,observation:expect.stringContaining(reason)});
  expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);
  const calls=f.calls.length;
  expect((await f.delivery.submit(id,owner)).status).toBe('failed');
  expect((await f.delivery.reconcile(id,owner)).status).toBe('failed');expect(f.calls).toHaveLength(calls);
  f.delivery.forget(id,owner);f.reopen();
  expect(f.delivery.detail(id,owner)).toMatchObject({status:'failed',payload:null,withdrawn:true,observation:'withdrawn; submission failed before dispatch'});
  expect(readFileSync(join(f.dir,'mind.sqlite')).includes(Buffer.from('private-intent-marker'))).toBe(false);
 }finally{f.cleanup();}
});

test.each(['invalid','forbidden','not_found','conflict','unavailable','cycle','failed','unknown'])(
 'SDK %s error after dispatch and a missing receipt never prove no effect', async code => {
  const f = fixture();
  try {
   const { id } = await f.delivery.prepare(f.input, f.worker);await f.stage(id);
   // ModelError's public shape has only code, reason and message. The same shape
   // describes both a routing refusal and a handler/replay error after publication.
   f.state.submitError = Object.assign(Error('submission refused before receipt'), {code,reason:'unsupported'});
   await expect(f.delivery.submit(id, owner)).rejects.toThrow('submission refused');
   f.reopen();
   expect(f.delivery.detail(id, owner)).toMatchObject({status:'submit-unknown',observation:expect.stringContaining('submission refused')});
   f.state.receiptError = Object.assign(Error('receipt absent at this instant'), {code:'not_found'});
   await expect(f.delivery.submit(id, owner)).rejects.toThrow('receipt absent');
   expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(true);
   expect(f.state.submits).toBe(1);
   f.reopen();f.state.receiptError = undefined;
   const recovered = await f.delivery.reconcile(id, owner);
   expect(recovered.receipt).toEqual(f.receipt);expect(f.state.submits).toBe(1);
   expect(f.state.receiptQueries).toEqual(Array(2).fill({admissionId:'admission',requestKey:'stable-command'}));
  } finally { f.cleanup(); }
 },
);

test.each([
 {state:'submitted',member:'building',selected:false,active:false,status:'submitted',pending:true},
 {state:'pending_approval',member:'pending_review',selected:false,active:false,status:'submitted',pending:true},
 {state:'approved',member:'approved',selected:false,active:false,status:'submitted',pending:true},
 {state:'approved',member:'approved',selected:true,active:true,status:'submitted',pending:false},
 {state:'rejected',member:'rejected',selected:false,active:false,status:'rejected',pending:false},
] as const)('receipt $state/$member derives $status and pending=$pending', async row => {
 const f = fixture();
 try {
  const { id } = await f.delivery.prepare(f.input, f.worker);await f.stage(id);
  f.receipt.state = row.state;f.receipt.members[0]!.status = row.member;f.receipt.members[0]!.selected = row.selected;
  await f.delivery.submit(id, owner);f.state.active = row.active;
  const result = await f.delivery.reconcile(id, owner);
  expect(result.status).toBe(row.status);expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(row.pending);
  f.reopen();expect(f.delivery.detail(id, owner).status).toBe(row.status);
  if (row.status === 'rejected') {
   const calls = f.calls.length;
   expect(f.delivery.list({}, owner).items[0]).toMatchObject({needsDecision:false,observation:'candidate rejected'});
   await f.delivery.submit(id, owner);await f.delivery.reconcile(id, owner);
   expect(f.calls).toHaveLength(calls);
  }
 } finally { f.cleanup(); }
});

test('a late preflight failure cannot overwrite another coordinator receipt or unknown dispatch', async () => {
 for (const lost of [false, true]) {
  const f = fixture();let other: CoreDelivery | undefined;
  try {
   const { id } = await f.delivery.prepare(f.input, f.worker);await f.stage(id);
   let release!: () => void, entered!: () => void;
   const started = new Promise<void>(resolve => entered = resolve);
   f.setAdmissionWait(async () => { entered();await new Promise<void>(resolve => release = resolve);throw Error('late admission refusal'); });
   const pending = f.delivery.submit(id, owner);
   await started;
   other = new CoreDelivery(f.dir, f.service, f.call, {worker:run => f.journal.all().find(e => e.runId === run),verifyAdmission:async () => {}});
   f.state.lost = lost;
   if (lost) await expect(other.submit(id, owner)).rejects.toThrow('lost reply');
   else await other.submit(id, owner);
   release();await expect(pending).rejects.toThrow('late admission refusal');
   expect(f.delivery.detail(id, owner).status).toBe(lost ? 'submit-unknown' : 'submitted');
   expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(true);expect(f.state.submits).toBe(1);
  } finally { other?.close();f.cleanup(); }
 }
});

test('final Author validation fails durably when admission awaits a directory change',async()=>{
 const f=fixture();try{
  const {id}=await f.delivery.prepare(f.input,f.worker);await f.stage(id);
  f.setAdmissionWait(async()=>{f.state.authorHash='9'.repeat(40);});
  await expect(f.delivery.submit(id,owner)).rejects.toThrow('Author');
  f.reopen();expect(f.delivery.detail(id,owner).status).toBe('failed');
  expect(f.delivery.pendingFor(f.input.pursuitId)).toBe(false);expect(f.state.submits).toBe(0);
 }finally{f.cleanup();}
});

test.each([false,true])('forget scrubs private error details even when an exception arrives late (dispatched=%s)',async dispatched=>{
 const f=fixture();try{
  const {id}=await f.delivery.prepare(f.input,f.worker);await f.stage(id);
  const privateReason=`${f.input.items[0]!.dir}: private-intent-marker`;
  let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve);
  const wait=async()=>{entered();await new Promise<void>(resolve=>release=resolve);throw Error(privateReason);};
  if(dispatched)f.state.hold=wait;else f.setAdmissionWait(wait);
  const pending=f.delivery.submit(id,owner);await started;
  f.delivery.forget(id,owner);release();await expect(pending).rejects.toThrow(privateReason);
  f.delivery.cleanupWithdrawn();f.reopen();
  const record=f.delivery.detail(id,owner);expect(record.payload).toBeNull();expect(record.withdrawn).toBe(true);
  expect(record.observation).not.toContain(privateReason);
  expect(readFileSync(join(f.dir,'mind.sqlite')).includes(Buffer.from('private-intent-marker'))).toBe(false);
 }finally{f.cleanup();}
});

test('withdrawal interleaved with a preflight refusal converges without resurrecting a blocker', async () => {
 const fixtures: ReturnType<typeof fixture>[] = [];
 try {
  await assertInterleavedSettlementConverges({
   beginRequest: async () => {
    const f = fixture();fixtures.push(f);
    const { id } = await f.delivery.prepare(f.input, f.worker);await f.stage(id);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    f.setAdmissionWait(async () => { entered();await new Promise<void>(resolve => release = resolve);throw Error('admission refused'); });
    const pending = f.delivery.submit(id, owner);
    await started;
    return {f,id,pending,release};
   },
   enterWaiting: async ({f,id}) => { f.delivery.withdraw(id, owner); },
   resolveExternally: async ({release,pending}) => { release();await expect(pending).rejects.toThrow('admission refused'); },
   readFinalState: async ({f,id}) => {
    f.delivery.cleanupWithdrawn();f.reopen();
    const r = f.delivery.detail(id, owner);
    return {withdrawn:r.withdrawn,payload:r.payload,pending:f.delivery.pendingFor(f.input.pursuitId)};
   },
   isStuckWaiting: state => state.pending,
  });
 } finally { for (const f of fixtures) f.cleanup(); }
});
