import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreDelivery, deliveryPrepareSchema, deliveryReceiptSchema, type DeliveryPrepare } from './core-delivery';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreExecutionJournal, type CoreCall } from './core-execution';
import type { CoreAccess, Pursuit } from './core-types';
import { candidateReceiptSchema } from '../../../../../../contracts/src/steward/module-candidates';
import { parseSubmit, parseReceipt } from '../author/contracts';
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
 const state={authorHash:author.hash,submits:0,receiptQueries:[] as unknown[],lost:false,admission:true,active:false,badReceipt:false,hold:undefined as undefined|(()=>Promise<void>)};
 const calls:{target:unknown;args:Record<string,unknown>;key?:string}[]=[];
 const call:CoreCall=async(target,args,options)=>{
  calls.push({target,args,key:options?.key});
  if(target==='modules.list')return {items:[{id:author.moduleId,name:'author',status:'active',activeHash:state.authorHash},...(state.active?[{id:'calendar-id',name:'calendar',status:'active',activeHash:'d'.repeat(40)}]:[])],nextCursor:null};
  if(typeof target==='object'&&target.moduleId===author.moduleId&&target.tool==='submit'){
   expect(options?.expectedTarget).toEqual({moduleId:author.moduleId,hash:author.hash});state.submits++;expect(parseSubmit(JSON.parse(args.input as string))).toEqual({admissionId:input.admissionId,requestKey:input.requestKey,items:input.items.map(({materialDigest,...item})=>item)});expect(options?.key).toBe(input.requestKey);await state.hold?.();if(state.lost)throw Error('lost reply');return structuredClone(receipt);
  }
  if(target==='modules.receipt'){const selector='receiptId'in args?{receiptId:args.receiptId}:{admissionId:args.admissionId,requestKey:args.key};parseReceipt(selector);state.receiptQueries.push(selector);return {...structuredClone(receipt),...(state.badReceipt?{receiptId:'other-receipt'}:{})};}
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
test('lost reply survives restart and withdrawal; only original admission/key receipt query is sent',async()=>{
 const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);f.state.lost=true;await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('lost reply');expect(f.delivery.detail(r.id,owner).status).toBe('submit-unknown');f.reopen();
  f.store.update(tx=>{const m=tx.meta();m.visibilityRevision++;tx.setMeta(m);});
  const forgotten=f.delivery.withdraw(r.id,owner);expect(forgotten.payload).toBeNull();expect(forgotten.cleanup).toContain('content-free');
  const bytes=readFileSync(join(f.dir,'mind-delivery.sqlite'));expect(bytes.includes(Buffer.from('private-intent-marker'))).toBe(false);expect(bytes.includes(Buffer.from('private-criteria-marker'))).toBe(false);
  f.reopen();const recovered=await f.delivery.submit(r.id,owner);expect(recovered.receipt!.receiptId).toBe('real-receipt');expect(recovered.withdrawn).toBe(true);expect(recovered.payload).toBeNull();expect(f.state.submits).toBe(1);expect(f.state.receiptQueries).toEqual([{admissionId:'admission',requestKey:'stable-command'}]);
  expect(statSync(join(f.dir,'mind-delivery.sqlite')).mode&0o777).toBe(0o600);expect(statSync(f.dir).mode&0o777).toBe(0o700);
 }finally{f.cleanup();}
});
test('proof rejects wrong run, called Author identity, target, result state, material and unselected tools',async()=>{
 const mutations=[(e:any)=>e.facts[0].runId='forged',(e:any)=>e.facts[0].moduleId=principal.moduleId,(e:any)=>e.facts[0].hash='e'.repeat(40),(e:any)=>e.facts[0].target.tool='prepare',(e:any)=>e.facts[0].outputState='partial',(e:any)=>e.facts[0].status='failed',(e:any)=>e.facts[0].output.dir='packages/other/source',(e:any)=>e.facts[0].output.materialDigest='0'.repeat(64),(e:any)=>e.facts[0].output.name='other',(e:any)=>e.tools=[],(e:any)=>e.stopRequested=true,(e:any)=>e.terminalStatus='failed',(e:any)=>e.ended=false,(e:any)=>e.active=true];
 for(const mutation of mutations){const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);expect(await f.stage(r.id,mutation)).toBe(0);await expect(f.delivery.submit(r.id,owner)).rejects.toThrow('stage proof');expect(f.state.submits).toBe(0);}finally{f.cleanup();}}
},20000);
test('current real worker, reserved names, NEW targets, original command conflicts and strict JSON enforced',async()=>{
 const f=fixture();try{await expect(f.delivery.prepare(f.input,owner)).rejects.toThrow('worker');await expect(f.delivery.prepare(f.input,{...f.worker,execution:{actor:'mind',runRef:'made-up'}})).rejects.toThrow('worker');
  for(const name of ['mind','chat','pi','author','web','self','core','agent'])expect(deliveryPrepareSchema.safeParse({...f.input,items:[{...f.input.items[0],name}]}).success).toBe(false);
  expect(deliveryPrepareSchema.safeParse({...f.input,role:'owner'}).success).toBe(false);expect(deliveryPrepareSchema.safeParse({...f.input,items:[{...f.input.items[0],dir:'packages/../source'}]}).success).toBe(false);
  const r=await f.delivery.prepare(f.input,f.worker);expect(await f.delivery.prepare(f.input,f.worker)).toEqual(r);
  await expect(f.delivery.prepare({...f.input,criteria:['changed']},f.worker)).rejects.toThrow('conflicts');
  f.state.authorHash='e'.repeat(40);await expect(f.stage(r.id)).rejects.toThrow('Author identity');
 }finally{f.cleanup();}
});
test('fresh submit blocks stale authorization, changed Author identity, denied admission and expired source evidence',async()=>{
 for(const kind of ['visibility','revision','disabled','author','admission','expired']){const f=fixture();try{const r=await f.delivery.prepare(f.input,f.worker);await f.stage(r.id);
  if(kind==='author')f.state.authorHash='e'.repeat(40);else if(kind==='admission')f.state.admission=false;else f.store.update(tx=>{if(kind==='visibility'){const m=tx.meta();m.visibilityRevision++;tx.setMeta(m);}if(kind==='disabled'){const s=tx.settings();s.enabled=false;tx.setSettings(s);}if(kind==='revision'){const p=tx.get('pursuit',f.input.pursuitId)!;p.revision++;tx.put('pursuit',p);}if(kind==='expired'){const e=tx.list('evidence')[0]!;e.expiredAt=new Date().toISOString();tx.put('evidence',e);}});
  await expect(f.delivery.submit(r.id,owner)).rejects.toThrow();expect(f.state.submits).toBe(0);
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
