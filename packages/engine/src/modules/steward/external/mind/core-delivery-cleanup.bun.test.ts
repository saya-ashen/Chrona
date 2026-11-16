import { tableBytes } from "./test-support/storage";
import {test,expect} from 'bun:test';
import {mkdirSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {CoreMindStore,coreDigest} from './core-store';
import {CoreMindService} from './core-service';
import {CoreDelivery} from './core-delivery';
import type {DeliveryPrepare,DeliveryRecord} from './core-delivery';
import {CoreDeliveryAdmission} from './core-delivery-admission';
import {CoreExecutionJournal,type CoreCall} from './core-execution';
import type {CoreAccess,Pursuit} from './core-types';
import {Database} from 'bun:sqlite';

function temporaryDirectory(){
 const root=join(process.cwd(),'$bunfs/root/pi');
 mkdirSync(root,{recursive:true});
 return mkdtempSync(join(root,'mind-delivery-clean-'));
}
test('coordinator wait holds only original pursuit; withdrawal cleans its private payload and preserves unknown identity',()=>{
 const dir=temporaryDirectory(),store=new CoreMindStore(dir),service=new CoreMindService(store),owner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]};
 const p=service.pursue({actionKey:'goal',expectedVisibilityRevision:0,expectedRevision:0,scope:{},semanticKey:'new',goal:'New capability',completionCriteria:['real outcome'],reason:'explicit-goal',evidenceRefs:[],understandingRefs:[]},owner).value as Pursuit;
 const delivery=new CoreDelivery(dir,service,async()=>{throw Error('No external call expected');},{worker:()=>undefined,verifyAdmission:async()=>{throw Error('No submission expected');}}),db=new Database(join(dir,'mind.sqlite'));
 try{const {revision:_revision,updatedAt:_updatedAt,currentActor:_currentActor,...basis}=p;const r={id:'record',pursuitId:p.id,revision:p.revision-1,visibilityRevision:0,author:{moduleId:'author',hash:'a'.repeat(40)},admissionId:'admission',requestKey:'original',worker:{executionId:'e',runId:'run',actor:'mind',principal:{moduleId:'mind',hash:'b'.repeat(40)}},pursuitBasis:coreDigest(basis),materials:[{name:'calendar',materialDigest:'c'.repeat(64)}],status:'submit-unknown',withdrawn:false,receipt:null,directory:[],proof:[],payload:{criteria:['erase-me'],items:[{dir:'packages/stage/source'}]}} as unknown as DeliveryRecord;
 db.query('INSERT INTO delivery(id,command_key,body) VALUES(?,?,?)').run(r.id,'key',JSON.stringify(r));expect(delivery.pendingFor(p.id)).toBe(true);expect(delivery.pendingFor('other')).toBe(false);
 store.update(tx=>{const m=tx.meta();m.visibilityRevision++;tx.setMeta(m);});expect(delivery.cleanupWithdrawn().deferred).toBe(0);const clean=delivery.detail(r.id,owner);expect(clean.withdrawn).toBe(true);expect(clean.payload).toBeNull();expect(clean.status).toBe('submit-unknown');expect(clean.requestKey).toBe('original');expect(delivery.pendingFor(p.id)).toBe(false);
 }finally{db.close();delivery.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

const cleanupOwner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]};
const cleanupAuthor={moduleId:'original-author',hash:'a'.repeat(40)};
const cleanupPrincipal={moduleId:'actual-mind',hash:'b'.repeat(40)};
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}

/** The gateway alone is replaced; preparation, admission proof, capture and erasure use SQLite. */
function cleanupFixture(){
 const dir=temporaryDirectory(),entered=deferred<void>(),dispatch=deferred<void>();
 let store:CoreMindStore,service:CoreMindService,journal:CoreExecutionJournal,admission:CoreDeliveryAdmission,delivery:CoreDelivery;
 const calls:{target:Parameters<CoreCall>[0];args:Record<string,unknown>;key?:string}[]=[];
 const material={name:'calendar',dir:'packages/private-calendar-stage/source',intent:{changes:['private-cleanup-intent'],preserves:[]},materialDigest:'c'.repeat(64)};
 const receipt:NonNullable<DeliveryRecord['receipt']>={receiptId:'original-receipt',admissionId:'original-admission',requestKey:'original-submit-key',submitter:cleanupAuthor,state:'pending_approval',approvalId:'approval',members:[{name:material.name,moduleId:'calendar-id',hash:'d'.repeat(40),versionId:'version',expectedActiveHash:null,materialDigest:material.materialDigest,status:'pending_review',selected:false}]};
 const call:CoreCall=async(target,args,options)=>{
  calls.push({target,args:structuredClone(args),key:options?.key});
  if(target==='modules.receipt')return structuredClone(receipt);
  if(target==='modules.list')return {items:[{id:cleanupAuthor.moduleId,name:'author',status:'active',activeHash:cleanupAuthor.hash}],nextCursor:null};
  if(target==='modules.admit')return {admissionId:receipt.admissionId,...args};
  if(typeof target==='object'&&target.moduleId===cleanupAuthor.moduleId){
   if(target.tool==='stage')return {name:material.name,dir:material.dir,materialDigest:material.materialDigest};
   if(target.tool==='submit'){entered.resolve();await dispatch.promise;return structuredClone(receipt);}
   if(target.tool==='receipt')return structuredClone(receipt);
  }
  throw Error(`Unexpected cleanup gateway call ${JSON.stringify(target)}`);
 };
 function open(){
  store=new CoreMindStore(dir);service=new CoreMindService(store);journal=new CoreExecutionJournal(dir);admission=new CoreDeliveryAdmission(dir,journal);
  delivery=new CoreDelivery(dir,service,call,{worker:run=>journal.all().find(e=>e.runId===run),verifyAdmission:async record=>admission.verify(record)});
 }
 function closeStores(){delivery.close();admission.close();journal.close();store.close();}
 open();
 return {dir,calls,entered,dispatch,material,receipt,get delivery(){return delivery;},
  async ready(){
   const p=service.pursue({actionKey:'goal',expectedVisibilityRevision:0,expectedRevision:0,scope:{},semanticKey:'new-calendar',goal:'Deliver a calendar capability',completionCriteria:['Verify real result'],reason:'explicit-goal',evidenceRefs:[],understandingRefs:[]},cleanupOwner).value as Pursuit;
   let e=journal.prepare({purpose:'pursuit',subject:p.id,revision:p.revision,visibilityRevision:0,prompt:'Stage calendar',tools:['modules.admit',{moduleId:cleanupAuthor.moduleId,tool:'stage'}],principal:cleanupPrincipal},new Date().toISOString());
   e.runId='actual-cleanup-run';e.status='running';e.active=true;journal.save(e);
   const worker:CoreAccess={subject:'mind',role:'runtime',scopes:[{}],execution:{actor:'mind',runRef:e.runId}};
   const claimed=service.claim({pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'claim'},worker).value as Pursuit;
   e.revision=claimed.revision;journal.save(e);
   const input:DeliveryPrepare={pursuitId:p.id,expectedRevision:claimed.revision,expectedVisibilityRevision:0,actionKey:'delivery',author:cleanupAuthor,admissionId:receipt.admissionId,requestKey:receipt.requestKey,items:[material],criteria:['private-cleanup-criteria']};
   const prepared=await delivery.prepare(input,worker);
   expect(prepared.status).toBe('awaiting-worker-proof');
   e=journal.get(e.id);e.status='settling';e.ended=true;e.active=false;e.terminalStatus='finished';
   const admitted=await call('modules.admit',{requestKey:'original-admit-key',submitter:cleanupAuthor,targets:[{name:material.name,moduleId:null,expectedActiveHash:null}]});
   const staged=await call({moduleId:cleanupAuthor.moduleId,tool:'stage'},{name:material.name});
   e.facts=[{runId:e.runId!,callId:'actual-admission',target:'modules.admit',moduleId:'system:modules',hash:'kernel-contract-hash',status:'succeeded',outputState:'complete',output:admitted},{runId:e.runId!,callId:'actual-stage',target:{moduleId:cleanupAuthor.moduleId,tool:'stage'},...cleanupAuthor,status:'succeeded',outputState:'complete',output:staged}];
   journal.save(e);expect(admission.capture(e)).toBe(1);expect(await delivery.capture(e)).toBe(1);
   expect(delivery.detail(prepared.id,cleanupOwner).status).toBe('coordinator-ready');
   return {id:prepared.id,input};
  },
  restart(){closeStores();open();},
  close(){closeStores();rmSync(dir,{recursive:true,force:true});}
 };
}

function originalIdentity(r:DeliveryRecord){
 const {id,pursuitId,author,admissionId,requestKey,worker,commandDigest,prepareDigest,materials,proof}=r;
 return {id,pursuitId,author,admissionId,requestKey,worker,commandDigest,prepareDigest,materials,proof};
}
function pinReader(dir:string,id:string){
 const reader=new Database(join(dir,'mind.sqlite'),{readonly:true});
 reader.exec('BEGIN');
 const row=reader.query('SELECT body FROM delivery WHERE id=?').get(id) as {body:string};
 expect(JSON.parse(row.body).payload.criteria).toEqual(['private-cleanup-criteria']);
 return reader;
}
function walSize(dir:string){return statSync(join(dir,'mind.sqlite-wal')).size;}
function expectErased(r:DeliveryRecord,identity:ReturnType<typeof originalIdentity>){
 expect(r).toMatchObject({...identity,withdrawn:true,payload:null});
}
function expectPrivateBytesRemoved(dir:string){
 const bytes=tableBytes(join(dir, "mind.sqlite"), "delivery");
 for(const value of ['private-cleanup-criteria','private-cleanup-intent','packages/private-calendar-stage/source'])expect(bytes.includes(Buffer.from(value))).toBe(false);
}
function observeSubmit(pending:Promise<DeliveryRecord>){
 return pending.then(value=>({value,error:null}),error=>{
  console.error(JSON.stringify({component:'mind-cleanup-test',event:'original_dispatch_rejected',error:error instanceof Error?error.message:String(error)}));
  return {value:null,error};
 });
}

test('pinned SQLite reader defers withdrawal repeatedly; retry clears marker before WAL truncation and survives restart',async()=>{
 const f=cleanupFixture();let reader:Database|undefined;
 try{
  const {id}=await f.ready();
  const pending=observeSubmit(f.delivery.submit(id,cleanupOwner));await f.entered.promise;
  f.dispatch.reject(Error('original reply lost'));
  expect((await pending).error.message).toBe('original reply lost');
  const identity=originalIdentity(f.delivery.detail(id,cleanupOwner));
  reader=pinReader(f.dir,id);
  const withdrawn=f.delivery.withdraw(id,cleanupOwner);
  expectErased(withdrawn,identity);expect(withdrawn.status).toBe('submit-unknown');expect(withdrawn.receipt).toBeNull();
  expect(withdrawn.cleanup).toContain('deferred: SQLite checkpoint busy');
  expect(withdrawn.cleanup).not.toContain('arguments remain in flight');expect(walSize(f.dir)).toBeGreaterThan(0);
  for(let n=0;n<2;n++){
   expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:1});
   expect(f.delivery.detail(id,cleanupOwner).cleanup).toContain('deferred: SQLite checkpoint busy');
  }
  // The reader still sees the original private payload, proving BEGIN actually pinned a snapshot.
  const snapshot=reader.query('SELECT body FROM delivery WHERE id=?').get(id) as {body:string};
  expect(JSON.parse(snapshot.body).payload.criteria).toEqual(['private-cleanup-criteria']);
  reader.exec('COMMIT');reader.close();reader=undefined;
  expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
  const clean=f.delivery.detail(id,cleanupOwner);
  expectErased(clean,identity);expect(clean.cleanup).toContain('content-free');expect(clean.cleanup).not.toContain('deferred');
  // A write of the cleared marker AFTER TRUNCATE would leave a nonzero WAL here.
  expect(walSize(f.dir)).toBe(0);expectPrivateBytesRemoved(f.dir);
  f.restart();
  expectErased(f.delivery.detail(id,cleanupOwner),identity);
  expect(f.delivery.detail(id,cleanupOwner)).toMatchObject({status:'submit-unknown',receipt:null,cleanup:clean.cleanup});
  expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
  await f.delivery.submit(id,cleanupOwner);
  const submits=f.calls.filter(c=>typeof c.target==='object'&&c.target.tool==='submit');
  const queries=f.calls.filter(c=>c.target==='modules.receipt');
  expect(submits).toHaveLength(1);expect(submits[0]!.key).toBe(identity.requestKey);
  expect(queries).toEqual([{target:'modules.receipt',args:{admissionId:identity.admissionId,key:identity.requestKey},key:undefined}]);
 }finally{reader?.close();f.close();}
});

for(const outcome of ['resolved','rejected'] as const)for(const pinned of [false,true]){
 test(`in-flight ${outcome} dispatch retains deferred arguments${pinned?' and SQLite busy reason':''} until cleanup can finish`,async()=>{
  const f=cleanupFixture();let reader:Database|undefined,pending:ReturnType<typeof observeSubmit>|undefined;
  try{
   const {id,input}=await f.ready();
   const identity=originalIdentity(f.delivery.detail(id,cleanupOwner));
   pending=observeSubmit(f.delivery.submit(id,cleanupOwner));await f.entered.promise;
   if(pinned)reader=pinReader(f.dir,id);
   const withdrawn=f.delivery.withdraw(id,cleanupOwner);
   expectErased(withdrawn,identity);expect(withdrawn.status).toBe('submit-unknown');expect(withdrawn.receipt).toBeNull();
   expect(withdrawn.cleanup).toContain('deferred:');expect(withdrawn.cleanup).toContain('original call arguments remain in flight');
   if(pinned)expect(withdrawn.cleanup).toContain('SQLite checkpoint busy');
   for(let n=0;n<2;n++){
    expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:1});
    const held=f.delivery.detail(id,cleanupOwner);expectErased(held,identity);
    expect(held.cleanup).toContain('original call arguments remain in flight');
    if(pinned)expect(held.cleanup).toContain('SQLite checkpoint busy');
   }
   // Exercise both release orders: reader first on rejection, dispatch first on success.
   if(reader&&outcome==='rejected'){
    reader.exec('COMMIT');reader.close();reader=undefined;
    expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:1});
    expect(f.delivery.detail(id,cleanupOwner).cleanup).toContain('original call arguments remain in flight');expect(walSize(f.dir)).toBe(0);
   }
   if(outcome==='rejected')f.dispatch.reject(Error('original reply lost'));else f.dispatch.resolve();
   const result=await pending;
   if(outcome==='rejected'){expect(result.error.message).toBe('original reply lost');expect(result.value).toBeNull();}
   else{expect(result.error).toBeNull();expectErased(result.value!,identity);expect(result.value!.receipt).toEqual(f.receipt);}
   if(reader){
    expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:1});
    const busy=f.delivery.detail(id,cleanupOwner);expectErased(busy,identity);
    expect(busy.cleanup).toContain('SQLite checkpoint busy');expect(busy.cleanup).not.toContain('arguments remain in flight');
    expect(walSize(f.dir)).toBeGreaterThan(0);
    reader.exec('COMMIT');reader.close();reader=undefined;
   }
   expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
   const clean=f.delivery.detail(id,cleanupOwner);
   expectErased(clean,identity);expect(clean.cleanup).not.toContain('deferred');expect(clean.cleanup).toContain('content-free');
   expect(clean.status).toBe(outcome==='rejected'?'submit-unknown':'submitted');
   expect(clean.receipt).toEqual(outcome==='rejected'?null:f.receipt);
   expect(walSize(f.dir)).toBe(0);expectPrivateBytesRemoved(f.dir);
   f.restart();expectErased(f.delivery.detail(id,cleanupOwner),identity);
   expect(f.delivery.detail(id,cleanupOwner)).toMatchObject({status:clean.status,receipt:clean.receipt,cleanup:clean.cleanup});
   expect(f.delivery.cleanupWithdrawn()).toEqual({deferred:0});
   await f.delivery.submit(id,cleanupOwner);
   const submits=f.calls.filter(c=>typeof c.target==='object'&&c.target.tool==='submit');
   expect(submits).toEqual([{target:{moduleId:cleanupAuthor.moduleId,tool:'submit'},args:{input:JSON.stringify({admissionId:input.admissionId,requestKey:input.requestKey,items:input.items.map(({name,dir,intent})=>({name,dir,intent}))})},key:input.requestKey}]);
   const queries=f.calls.filter(c=>c.target==='modules.receipt');
   expect(queries).toEqual([{target:'modules.receipt',args:outcome==='rejected'?{admissionId:input.admissionId,key:input.requestKey}:{receiptId:f.receipt.receiptId},key:undefined}]);
   expectErased(f.delivery.detail(id,cleanupOwner),identity);
  }finally{
   // Always let the real submit unwind before closing its SQLite connection, including on assertion failure.
   f.dispatch.resolve();if(pending)await pending;reader?.close();f.close();
  }
 });
}
