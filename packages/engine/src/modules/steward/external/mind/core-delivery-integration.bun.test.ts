import {expect,test,mock} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreMindStore} from './core-store';
import {CoreMindService} from './core-service';
import {CoreActions,type DocumentArtifact} from './core-actions';
import {CoreApplication} from './core-application';
import {CoreRuntime,deliveryRuntimeHooks} from './core-runtime';
import {CoreDelivery,deliveryPrepareSchema,type DeliveryPrepare} from './core-delivery';
import {CoreDeliveryAdmission} from './core-delivery-admission';
import type {CoreCall,Target,ToolFact} from './core-execution';
import type {CoreAccess} from './core-types';
import {candidateAdmissionInputSchema,candidateAdmissionOutputSchema,candidateReceiptSchema} from '../../../../../../contracts/src/steward/module-candidates';
import {moduleToolSchema} from '../../../../../../contracts/src/steward/module-tool';
import {parseSubmit,parseReceipt} from '../author/contracts';
import {createPages,type PageTool} from '../web/pages';
import {assertExplicitRetryIssuesFreshAttempt} from '../../__testing__/state-machine-invariants';

const identity={moduleId:'mind-delivery-integration',hash:'b'.repeat(40)};
const author={moduleId:'actual-author',hash:'a'.repeat(40)};
const owner:CoreAccess={subject:'authenticated-owner',role:'owner',scopes:[{}]};
const material={name:'timetable',dir:'packages/timetable-stage/source',intent:{changes:['Read the published timetable'],preserves:['Existing apps']},materialDigest:'c'.repeat(64)};
type Run={runId:string;contextId:string;status:string;active:boolean;ended:boolean;items:unknown[];args:Record<string,unknown>};

/** Only the kernel gateway is replaced. Runs, admissions, stages and commands survive restarts in SQLite. */
class Gateway {
 readonly db:Database;lostSubmit=false;submitRefusal:Error|undefined;authorHash=author.hash;active=false;directoryVersion=0;sourceCalls=0;readCalls=0;
 receipt=candidateReceiptSchema.parse({receiptId:'original-receipt',admissionId:'original-admission',requestKey:'original-submit-key',submitter:author,state:'pending_approval',approvalId:'approval',members:[{name:material.name,moduleId:'new-timetable',hash:'d'.repeat(40),versionId:'version',expectedActiveHash:null,materialDigest:material.materialDigest,status:'pending_review',selected:false}]});
 constructor(directory:string){this.db=new Database(join(directory,'fake-kernel.sqlite'));this.db.exec('CREATE TABLE runs(key TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE commands(seq INTEGER PRIMARY KEY,target TEXT NOT NULL,args TEXT NOT NULL,key TEXT); CREATE TABLE receipts(id TEXT PRIMARY KEY,admission TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL);');}
 runs(){return (this.db.query('SELECT json FROM runs ORDER BY rowid').all() as {json:string}[]).map(r=>JSON.parse(r.json) as Run);}
 get(runId:string){const r=this.runs().find(r=>r.runId===runId);if(!r)throw Error('Unknown gateway run');return r;}
 save(r:Run){this.db.query("UPDATE runs SET json=? WHERE json_extract(json,'$.runId')=?").run(JSON.stringify(r),r.runId);}
 commands(tool:string){return (this.db.query('SELECT target,args,key FROM commands ORDER BY seq').all() as {target:string;args:string;key:string|null}[]).filter(r=>{const t=JSON.parse(r.target) as Target;return typeof t==='string'?t===tool:t.tool===tool;}).map(r=>({target:JSON.parse(r.target) as Target,args:JSON.parse(r.args) as Record<string,unknown>,key:r.key}));}
 result(runId:string,target:Target,output:unknown,callId=typeof target==='string'?target:target.tool,principal=typeof target==='string'&&target==='modules.admit'?{moduleId:'system:modules',hash:'system'}:typeof target==='object'&&target.moduleId===author.moduleId?author:identity,status='succeeded'){
  const r=this.get(runId);expect(r.active).toBe(true);expect(r.args.tools as Target[]).toContainEqual(target);
  const value:ToolFact={...principal,runId,callId,target,status,outputState:status==='unknown'?'pending':'complete',output};
  r.items.push({kind:'tool-result',payload:{type:'tool-result',value}});this.save(r);
 }
 async invoke(runId:string,target:Target,args:Record<string,unknown>){const value=await this.call(target,args);this.result(runId,target,value);return value;}
 finish(runId:string,status='finished'){const r=this.get(runId);r.status=status;r.active=false;r.ended=true;this.save(r);}
 readonly call:CoreCall=async(target,args,options)=>{
  this.db.query('INSERT INTO commands(target,args,key) VALUES(?,?,?)').run(JSON.stringify(target),JSON.stringify(args),options?.key??null);
  if(target==='modules.receipt')return this.readReceipt(args);
  if(target==='modules.list')return {items:[{id:identity.moduleId,name:'mind',status:'active',activeHash:identity.hash},{id:author.moduleId,name:'author',status:'active',activeHash:this.authorHash},{id:'pi-current',name:'pi',status:'active',activeHash:'e'.repeat(40)},{id:'chat-current',name:'chat',status:'active',activeHash:'f'.repeat(40)},...(this.directoryVersion?[{id:'unrelated',name:'unrelated',status:'active',activeHash:'1'.repeat(40)}]:[]),...(this.active?[{id:'new-timetable',name:'timetable',status:'active',activeHash:'d'.repeat(40)}]:[])],nextCursor:null};
  if(target==='modules.describe')return {items:[...['prepare','stage','submit','receipt'].map(tool=>({target:{moduleId:author.moduleId,tool},description:tool})),{target:{moduleId:'pi-current',tool:'models'},description:'Model inventory'}],nextCursor:null};
  if(target==='modules.admit')return candidateAdmissionOutputSchema.parse({admissionId:this.receipt.admissionId,...candidateAdmissionInputSchema.parse(args)});
  if(target==='agent.run'){
   const prior=this.db.query('SELECT json FROM runs WHERE key=?').get(options?.key??'') as {json:string}|null;
   if(prior){const r=JSON.parse(prior.json) as Run;expect(r.args).toEqual(args);return r;}
   expect(this.runs().some(r=>r.active)).toBe(false);const n=this.runs().length+1;
   const r:Run={runId:`run-${n}`,contextId:`context-${n}`,status:'running',active:true,ended:false,items:[],args:structuredClone(args)};
   this.db.query('INSERT INTO runs(key,json) VALUES(?,?)').run(options!.key!,JSON.stringify(r));return r;
  }
  if(target==='agent.read'){this.readCalls++;const r=this.get(String(args.runId));return {run:r,items:r.items,ended:r.ended,nextCursor:null,interactions:[]};}
  if(target==='agent.stop'){const r=this.get(String(args.runId));return {...r,stopConfirmed:!r.active};}
  if(typeof target==='object'&&target.moduleId===author.moduleId){
   if(target.tool==='stage')return {name:args.name,dir:material.dir,materialDigest:material.materialDigest,files:3,bytes:123};
   if(target.tool==='submit'){
    const command=parseSubmit(args.input);
    expect(command).toEqual({admissionId:this.receipt.admissionId,requestKey:this.receipt.requestKey,items:[{name:material.name,dir:material.dir,intent:material.intent}]});expect(options?.key).toBe(command.requestKey);
    if(this.submitRefusal)throw this.submitRefusal;
    this.db.query('INSERT INTO receipts(id,admission,key,json) VALUES(?,?,?,?)').run(this.receipt.receiptId,command.admissionId,command.requestKey,JSON.stringify(this.receipt));
    if(this.lostSubmit)throw Error('Lost submit reply');return structuredClone(this.receipt);
   }
   if(target.tool==='receipt'){const selector=parseReceipt(args.input);return this.readReceipt('receiptId'in selector?selector:{admissionId:selector.admissionId,key:selector.requestKey});}
  }
  if(typeof target==='object'&&target.moduleId==='new-timetable'&&target.tool==='lookup')return {departure:'09:00',arrival:'11:30',source:'published timetable'};
  if(typeof target==='object'&&target.moduleId==='chat-current'){this.sourceCalls++;throw Error('Source offline');}
  if(typeof target==='object'&&target.tool==='page-set')return {};
  if(target==='timers.list')return {items:[{id:'mind-core'}]};
  throw Error(`Unexpected gateway call ${JSON.stringify(target)}`);
 };
 private readReceipt(selector:Record<string,unknown>){
  const row=('receiptId'in selector?this.db.query('SELECT json FROM receipts WHERE id=?').get(String(selector.receiptId)):this.db.query('SELECT json FROM receipts WHERE admission=? AND key=?').get(String(selector.admissionId),String(selector.key))) as {json:string}|null;
  if(!row)throw Object.assign(Error('Original receipt not found'),{code:'not_found'});
  const receipt=candidateReceiptSchema.parse(JSON.parse(row.json));
  // Lifecycle projections may change, but only for an actually published identity.
  return receipt.receiptId===this.receipt.receiptId?structuredClone(this.receipt):receipt;
 }
 close(){this.db.close();}
}

class Fixture {
 readonly directory=mkdtempSync(join(tmpdir(),'mind-real-delivery-'));readonly gateway=new Gateway(this.directory);
 private originalGoalId?:string;
 now='2026-11-14T00:00:00.000Z';store!:CoreMindStore;service!:CoreMindService;actions!:CoreActions;application!:CoreApplication;runtime!:CoreRuntime;delivery!:CoreDelivery;proof!:CoreDeliveryAdmission;
 constructor(){this.open();}
 open(){
  this.store=new CoreMindStore(this.directory);this.service=new CoreMindService(this.store,{now:()=>this.now});this.application=new CoreApplication(this.directory,this.service,this.gateway.call,identity.moduleId);this.actions=new CoreActions(this.directory,this.service,()=>this.application);
  this.runtime=new CoreRuntime(this.store,this.service,this.gateway.call,()=>identity,this.actions,()=>this.now,deliveryRuntimeHooks(()=>this.delivery,()=>this.proof));
  this.proof=new CoreDeliveryAdmission(this.directory,this.runtime.journal);
  this.delivery=new CoreDelivery(this.directory,this.service,this.gateway.call,{worker:runRef=>this.runtime.journal.all().find(e=>e.runId===runRef),verifyAdmission:async r=>this.proof.verify(r),assertMaySubmit:id=>{if(this.runtime.pendingControl(id))throw Error('Pending control holds delivery');}});
 }
 closeStores(){this.delivery.close();this.proof.close();this.runtime.close();this.actions.close();this.application.close();this.store.close();}
 restart(){this.closeStores();this.open();}
 close(){this.closeStores();this.gateway.close();rmSync(this.directory,{recursive:true,force:true});}
 goal(key='original-goal'){const p=this.service.pursue({actionKey:key,expectedRevision:0,expectedVisibilityRevision:this.store.read().visibilityRevision,semanticKey:key,goal:'Find a published train arriving before noon',completionCriteria:['Published departure and arrival times before noon'],scope:{},reason:'explicit-goal',evidenceRefs:[]},owner).value!;this.originalGoalId??=p.id;return p;}
 get pursuit(){return this.store.read().pursuits.find(p=>p.id===this.originalGoalId)!;}
 access(){return this.runtime.accessForCaller('current-bound-worker',true,this.runtime.journal.outstanding()?.runId??undefined);}
 mutation(actionKey:string){return {actionKey,pursuitId:this.pursuit.id,expectedRevision:this.pursuit.revision,expectedVisibilityRevision:this.store.read().visibilityRevision};}
 async prepare(proofs=true){
  const run=this.gateway.runs().at(-1)!;
  if(proofs){await this.gateway.invoke(run.runId,'modules.admit',{requestKey:'original-admit-key',submitter:author,targets:[{name:material.name,moduleId:null,expectedActiveHash:null}]});await this.gateway.invoke(run.runId,{moduleId:author.moduleId,tool:'stage'},{name:material.name});}
  const input:DeliveryPrepare={...this.mutation(`prepare-delivery:${this.gateway.receipt.requestKey}`),author,admissionId:this.gateway.receipt.admissionId,requestKey:this.gateway.receipt.requestKey,items:[material],criteria:this.pursuit.completionCriteria};
  const receipt=await this.delivery.prepare(input,this.access());return {run,input,id:receipt.id};
 }
 exhaustObservations(){while(this.runtime.observationBudget.view().remaining>3)this.runtime.observationBudget.consume('ordinary');}
}

function autoSubmit(f:Fixture,enabled=true){
 const s=f.store.read();
 f.service.settings({patch:{autoSubmit:enabled},expectedRevision:s.settings.revision,expectedVisibilityRevision:s.visibilityRevision,actionKey:`auto-submit:${enabled}:${s.settings.revision}`},owner);
}
async function ready(f:Fixture){f.goal();await f.runtime.tick();const r=await f.prepare();f.gateway.finish(r.run.runId);await f.runtime.tick();return r;}
function hold(f:Fixture){
 const s=f.store.read(),p=f.pursuit;
 f.runtime.admission.enqueue('control',{actionKey:'hold-delivery',kind:'pursuit',id:p.id,expectedRevision:p.revision,expectedVisibilityRevision:s.visibilityRevision,operation:'pause',evidenceRefs:p.evidenceRefs},{subject:'chat:agent',role:'application',scopes:[{}]});
 expect(f.runtime.pendingControl(p.id)).toBe(true);
}
test.each(['xx','a'.repeat(41)])('kernel, Author and Mind accept the same valid target name %s',name=>{
 const admission=candidateAdmissionInputSchema.parse({requestKey:'admit',submitter:author,targets:[{name,moduleId:null,expectedActiveHash:null}]});
 const command=parseSubmit({admissionId:'admission',requestKey:'submit',items:[{name,dir:material.dir,intent:material.intent}]});
 const prepared=deliveryPrepareSchema.parse({pursuitId:'p',expectedRevision:1,expectedVisibilityRevision:0,actionKey:'prepare',author,admissionId:'admission',requestKey:command.requestKey,items:[{...material,name}],criteria:['Requested behavior works']});
 expect(prepared.items[0].name).toBe(admission.targets[0].name);
 expect(command.items[0].name).toBe(prepared.items[0].name);
});
test.each(['x','a'.repeat(42)])('admission rejects names the runnable module manifest cannot accept: %s',name=>{
 expect(candidateAdmissionInputSchema.safeParse({requestKey:'admit',submitter:author,targets:[{name,moduleId:null,expectedActiveHash:null}]}).success).toBe(false);
 expect(()=>parseSubmit({admissionId:'admission',requestKey:'submit',items:[{name,dir:material.dir,intent:material.intent}]})).toThrow();
 expect(deliveryPrepareSchema.safeParse({pursuitId:'p',expectedRevision:1,expectedVisibilityRevision:0,actionKey:'prepare',author,admissionId:'admission',requestKey:'submit',items:[{...material,name}],criteria:['Requested behavior works']}).success).toBe(false);
});
test('autoSubmit defaults off; enabling submits once with the prepared key, even across restart',async()=>{
 const f=new Fixture();try{
  const r=await ready(f);expect(f.store.read().settings.autoSubmit).toBe(false);
  expect(f.runtime.view().autonomousPublishing.enabled).toBe(false);expect(f.gateway.commands('submit')).toHaveLength(0);
  autoSubmit(f);expect(f.runtime.view().autonomousPublishing.enabled).toBe(true);
  await f.runtime.tick(false,false);expect(f.gateway.commands('submit')).toHaveLength(1);
  expect((f.gateway.commands('submit')[0].args.input as {requestKey: string}).requestKey).toBe(r.input.requestKey);
  await f.runtime.tick(false,false);f.restart();await f.runtime.reconcileOriginals();await f.runtime.tick(false,false);
  expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.gateway.commands('modules.receipt').length).toBeGreaterThan(0);
 }finally{f.close();}
});
test('disabling autoSubmit still reconciles an existing submission and releases activated work',async()=>{
 const f=new Fixture();try{
  const prepared=await ready(f);
  await f.delivery.submit(prepared.id,owner);
  expect(f.store.read().settings.autoSubmit).toBe(false);
  expect(f.delivery.pendingFor(f.pursuit.id)).toBe(true);
  f.gateway.receipt.state='approved';
  f.gateway.receipt.members[0].selected=true;
  f.gateway.receipt.members[0].status='approved';
  f.gateway.active=true;
  f.restart();
  await f.runtime.reconcileOriginals();
  expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);
  expect(f.gateway.commands('submit')).toHaveLength(1);
  expect(f.gateway.commands('modules.receipt').length).toBeGreaterThan(0);
  expect(f.pursuit.status).not.toBe('done');
 }finally{f.close();}
});
test('enabled runtime submits immediately after authenticated worker settlement',async()=>{
 const f=new Fixture();try{
  autoSubmit(f);f.goal();await f.runtime.tick();const r=await f.prepare();
  expect(f.gateway.commands('submit')).toHaveLength(0);expect(f.delivery.detail(r.id,owner).status).toBe('awaiting-worker-proof');
  f.gateway.finish(r.run.runId);await f.runtime.tick();
  expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.delivery.detail(r.id,owner).status).toBe('submitted');
  expect(f.pursuit.status).not.toBe('done');
 }finally{f.close();}
});
test('autoSubmit resumes ready deliveries after restart and reconciles a lost submit reply without resubmission',async()=>{
 const f=new Fixture();try{
  const r=await ready(f);autoSubmit(f);f.gateway.lostSubmit=true;f.restart();
  await f.runtime.reconcileOriginals();expect(f.gateway.commands('submit')).toHaveLength(0);
  await f.runtime.tick(false,false);expect(f.delivery.detail(r.id,owner).status).toBe('submit-unknown');
  expect(f.gateway.commands('submit')).toHaveLength(1);
  f.delivery.withdraw(r.id,owner);
  const outcomes=deliveryRuntimeHooks(()=>f.delivery,()=>f.proof).deliveryOutcomes!();
  expect(outcomes.find(outcome=>outcome.id===r.id)).toMatchObject({status:'submit-unknown',withdrawn:true,requestKey:r.input.requestKey,admissionId:r.input.admissionId});
  f.restart();await f.runtime.reconcileOriginals();
  expect(f.gateway.commands('modules.receipt').at(-1)?.args).toEqual({admissionId:r.input.admissionId,key:r.input.requestKey});
  await f.runtime.tick(false,false);expect(f.gateway.commands('submit')).toHaveLength(1);
 }finally{f.close();}
});
test('autoSubmit holds pending controls across restart and skips withdrawn or forgotten deliveries',async()=>{
 for(const mode of ['control','withdraw','forget','disabled'] as const){
  const f=new Fixture();try{
   const r=await ready(f);autoSubmit(f);
   if(mode==='control')hold(f);
   if(mode==='withdraw')f.delivery.withdraw(r.id,owner);
   if(mode==='forget')f.service.forget({actionKey:'forget-before-auto-submit',expectedVisibilityRevision:f.store.read().visibilityRevision,target:{kind:'evidence',id:f.pursuit.evidenceRefs[0]}},owner);
   if(mode==='disabled')autoSubmit(f,false);
   f.restart();await f.runtime.tick(false,false);expect(f.gateway.commands('submit')).toHaveLength(0);
  }finally{f.close();}
 }
},15000);
test('slow delivery receipts do not hold execution recovery or duplicate reconciliation',async()=>{
 const f=new Fixture();let release:()=>void=()=>{};let pending:Promise<unknown>|undefined;
 try{
  await ready(f);autoSubmit(f);await f.runtime.tick(false,false);
  f.goal('other-goal');await f.runtime.tick();const worker=f.runtime.journal.outstanding()!;expect(worker.runId).toBeTruthy();
  let entered=false;const original=f.gateway.call;
  const call:CoreCall=async(target,args,options)=>{if(target==='modules.receipt'){entered=true;await new Promise<void>(resolve=>{release=resolve;});}return original(target,args,options);};
  f.delivery.close();f.delivery=new CoreDelivery(f.directory,f.service,call,{worker:runRef=>f.runtime.journal.all().find(e=>e.runId===runRef),verifyAdmission:async d=>f.proof.verify(d)});
  pending=f.runtime.tick(false,false);
  for(let i=0;i<100&&!entered;i++)await Bun.sleep(1);
  expect(entered).toBe(true);const reads=f.gateway.readCalls;
  await f.runtime.tick(false,false);expect(f.gateway.readCalls).toBeGreaterThan(reads);
 }finally{release();await pending;f.close();}
});

test('autoSubmit stops polling settled receipts',async()=>{
 const f=new Fixture();try{
  await ready(f);autoSubmit(f);f.gateway.receipt={...f.gateway.receipt,state:'rejected'};
  await f.runtime.tick(false,false);const polls=f.gateway.commands('modules.receipt').length;
  await f.runtime.tick(false,false);await f.runtime.tick(false,false);
  expect(f.gateway.commands('modules.receipt')).toHaveLength(polls);
 }finally{f.close();}
});

test('autoSubmit rechecks controls and settings after asynchronous validation, before dispatch',async()=>{
 for(const mode of ['control','disabled'] as const){
  const f=new Fixture();try{
   const r=await ready(f);autoSubmit(f);const original=f.gateway.call;
   const call:CoreCall=async(target,args,options)=>{const result=await original(target,args,options);if(target==='modules.list'){if(mode==='control')hold(f);else autoSubmit(f,false);}return result;};
   f.delivery.close();f.delivery=new CoreDelivery(f.directory,f.service,call,{worker:runRef=>f.runtime.journal.all().find(e=>e.runId===runRef),verifyAdmission:async d=>f.proof.verify(d),assertMaySubmit:id=>{if(f.runtime.pendingControl(id))throw Error('Pending control holds delivery');}});
   await f.runtime.tick(false,false);expect(f.gateway.commands('submit')).toHaveLength(0);expect(f.delivery.detail(r.id,owner).status).toBe('coordinator-ready');
  }finally{f.close();}
 }
});

test('actual terminal runtime captures admission and stage before release/scrub; explicit owner handoff survives restart, then original goal resumes through reviewed actions',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const {run,id,input}=await f.prepare();
  const selected=run.args.tools as Target[];expect(selected).toContainEqual({moduleId:identity.moduleId,tool:'delivery'});expect(selected).not.toContainEqual({moduleId:author.moduleId,tool:'submit'});expect(selected).not.toContainEqual({moduleId:'pi-current',tool:'models'});
  expect(String(run.args.prompt)).toContain('materialDigest');expect(String(run.args.prompt)).toContain('Finish this run after preparing');
  f.gateway.finish(run.runId);await f.runtime.tick();
  expect(f.runtime.journal.outstanding()).toBeUndefined();expect(f.pursuit.currentActor).toBeUndefined();expect(f.pursuit.revision).toBe(input.expectedRevision+1);
  expect(f.runtime.journal.all()[0].facts.every(fact=>fact.output===undefined)).toBe(true);
  expect(f.delivery.detail(id,owner)).toMatchObject({status:'coordinator-ready',proof:[{name:material.name,callId:'stage',materialDigest:material.materialDigest}]});
  expect(f.gateway.commands('submit')).toEqual([]);f.restart();
  await f.delivery.submit(id,owner);expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.delivery.detail(id,owner).observation).toBe('pending approval');
  f.gateway.directoryVersion++;await f.runtime.tick();expect(f.gateway.runs()).toHaveLength(1);expect(f.runtime.view().phase).toBe('idle');
  f.gateway.receipt.state='approved';f.gateway.receipt.members[0].selected=true;f.gateway.receipt.members[0].status='approved';f.gateway.active=true;
  await f.delivery.reconcile(id,owner);expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);expect(f.pursuit.status).not.toBe('done');
  await f.runtime.tick();const continuation=f.runtime.journal.outstanding()!;expect(continuation.subject).toBe(f.pursuit.id);expect(continuation.runId).not.toBe(run.runId);expect(f.pursuit.goal).toBe('Find a published train arriving before noon');
  const grant=await f.application.grant({moduleId:'new-timetable',activeHash:'d'.repeat(40),tool:'lookup',effect:'read',params:{route:'one'},description:'Owner-reviewed timetable lookup'},owner);
  const document=await f.actions.applicationRead({...f.mutation('read-original-goal'),adapterId:grant.id,params:{route:'one'}},f.access()) as DocumentArtifact;
  expect(document.body).toContain('11:30');expect(document.body).toContain('published timetable');expect(f.pursuit.status).not.toBe('done');
  // Real result is available to the existing independent-verification path; activation itself created no candidate.
  expect(f.store.read().candidates).toEqual([]);expect(f.gateway.commands('submit')).toHaveLength(1);
 }finally{f.close();}
});

test('lost explicit submit is queried by original admission/key after restart and forget; no autonomous resubmission',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const {run,id}=await f.prepare();f.gateway.finish(run.runId);await f.runtime.tick();f.gateway.lostSubmit=true;
  await expect(f.delivery.submit(id,owner)).rejects.toThrow('Lost submit');f.restart();
  f.service.forget({actionKey:'forget-original-goal',expectedVisibilityRevision:0,target:{kind:'evidence',id:f.pursuit.evidenceRefs[0]}},owner);
  const cleanup=f.runtime.cleanupWithdrawn();expect(cleanup.delivery?.deferred).toBe(0);expect(f.delivery.detail(id,owner).payload).toBeNull();
  expect(readFileSync(join(f.directory,'mind.sqlite')).includes(Buffer.from('Existing apps'))).toBe(false);
  await f.delivery.reconcile(id,owner);expect(f.gateway.commands('modules.receipt').map(c=>({admissionId:c.args.admissionId,requestKey:c.args.key}))).toEqual([{admissionId:'original-admission',requestKey:'original-submit-key'}]);
  expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.delivery.detail(id,owner).withdrawn).toBe(true);
 }finally{f.close();}
});

test('known failure releases real runtime work; a fresh attempt uses a new delivery identity after restart',async()=>{
 const f=new Fixture();try{
  await assertExplicitRetryIssuesFreshAttempt({
   runFailingAttempt:async()=>{
    const prepared=await ready(f);f.gateway.authorHash='9'.repeat(40);
    await expect(f.delivery.submit(prepared.id,owner)).rejects.toThrow('Author');
    expect(f.delivery.detail(prepared.id,owner)).toMatchObject({status:'failed',receipt:null});
    expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);expect(f.gateway.commands('submit')).toHaveLength(0);
    return prepared;
   },
   retry:async failed=>{
    f.restart();expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);
    f.gateway.authorHash=author.hash;f.gateway.directoryVersion++;
    f.now=new Date(Date.parse(f.now)+60000).toISOString();await f.runtime.tick();
    expect(f.gateway.runs()).toHaveLength(2);expect(f.runtime.journal.outstanding()?.subject).toBe(f.pursuit.id);
    f.gateway.receipt={...f.gateway.receipt,receiptId:'retry-receipt',admissionId:'retry-admission',requestKey:'retry-submit-key'};
    const retry=await f.prepare();expect(retry.run.runId).not.toBe(failed.run.runId);expect(retry.id).not.toBe(failed.id);
    expect(retry.input.requestKey).not.toBe(failed.input.requestKey);
    f.gateway.finish(retry.run.runId);await f.runtime.tick();await f.delivery.submit(retry.id,owner);
    expect(f.delivery.detail(failed.id,owner).status).toBe('failed');expect(f.gateway.commands('submit')).toHaveLength(1);
    expect(f.gateway.commands('submit')[0].key).toBe(retry.input.requestKey);expect(f.pursuit.status).not.toBe('done');
   },
   observedDownstreamAttempts:()=>f.gateway.runs().length,
  });
 }finally{f.close();}
});

test.each([false,true])('pre-receipt refusal and lost reply remain distinct in the gateway, but SDK uncertainty survives restart (published=%s)',async published=>{
 const f=new Fixture();try{
  const prepared=await ready(f);
  if(published)f.gateway.lostSubmit=true;
  else f.gateway.submitRefusal=Object.assign(Error('Admission refused'),{code:'forbidden',reason:'reauthorize'});
  await expect(f.delivery.submit(prepared.id,owner)).rejects.toThrow();
  expect(f.gateway.db.query('SELECT COUNT(*) AS count FROM receipts').get()).toEqual({count:published?1:0});
  f.restart();expect(f.delivery.detail(prepared.id,owner).status).toBe('submit-unknown');
  if(published){
   await f.delivery.submit(prepared.id,owner);
   expect(f.delivery.detail(prepared.id,owner).receipt?.receiptId).toBe('original-receipt');
  }else{
   await expect(f.delivery.submit(prepared.id,owner)).rejects.toThrow('receipt not found');
   f.restart();await expect(f.delivery.reconcile(prepared.id,owner)).rejects.toThrow('receipt not found');
   expect(f.delivery.detail(prepared.id,owner)).toMatchObject({status:'submit-unknown',receipt:null,observation:expect.stringContaining('Admission refused')});
  }
  expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.delivery.pendingFor(f.pursuit.id)).toBe(true);
  expect(f.gateway.commands('modules.receipt').every(command=>command.args.admissionId===prepared.input.admissionId&&command.args.key===prepared.input.requestKey)).toBe(true);
 }finally{f.close();}
});

test.each(['failed','missing-stage','missing-admission'] as const)('terminal %s preparation withdraws exact record and cannot block a future runtime attempt',async mode=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const {run,id}=await f.prepare(false);
  if(mode==='missing-admission')await f.gateway.invoke(run.runId,{moduleId:author.moduleId,tool:'stage'},{name:material.name});
  f.gateway.finish(run.runId,mode==='failed'?'failed':'finished');await f.runtime.tick();
  expect(f.delivery.detail(id,owner)).toMatchObject({withdrawn:true,payload:null});expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);expect(f.runtime.journal.outstanding()).toBeUndefined();
  f.restart();f.now=new Date(Date.parse(f.now)+60000).toISOString();if(mode!=='failed')f.gateway.directoryVersion++;
  await f.runtime.tick();expect(f.gateway.runs()).toHaveLength(2);expect(f.gateway.commands('submit')).toHaveLength(0);
 }finally{f.close();}
});

test('unknown tool effects keep their execution and preparation pending beyond the observation cap, then failed settlement withdraws',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const {run,id}=await f.prepare(false);
  f.gateway.result(run.runId,{moduleId:author.moduleId,tool:'stage'},undefined,'uncertain-stage',undefined,'unknown');f.gateway.finish(run.runId,'failed');f.exhaustObservations();
  await expect(f.runtime.observe('modules.list',{})).rejects.toThrow('budget exhausted');await f.runtime.tick();
  expect(f.runtime.journal.outstanding()?.status).toBe('unknown');expect(f.delivery.detail(id,owner).withdrawn).toBe(false);expect(f.pursuit.currentActor).toBeDefined();
  const observed=f.gateway.get(run.runId);observed.items=[];f.gateway.save(observed);
  // The original effect gets a terminal failed result, rather than a fabricated successful proof.
  observed.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...author,runId:run.runId,callId:'uncertain-stage',target:{moduleId:author.moduleId,tool:'stage'},status:'failed',outputState:'complete'}}}];f.gateway.save(observed);
  const reads=f.gateway.readCalls;await f.runtime.tick();expect(f.gateway.readCalls).toBeGreaterThan(reads);expect(f.runtime.journal.outstanding()).toBeUndefined();expect(f.delivery.detail(id,owner).withdrawn).toBe(true);expect(f.gateway.runs()).toHaveLength(1);expect(f.runtime.view().budget.throttled).toBe(true);
 }finally{f.close();}
});

test('runtime cleanup returns the exact application helper result, counts it once, and retries deferred delivery erasure',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const {run,id}=await f.prepare();f.gateway.finish(run.runId);await f.runtime.tick();
  // A second real owner goal can make an application read while the first waits for handoff.
  const other=f.goal('cleanup-read');await f.runtime.tick();const second=f.store.read().pursuits.find(p=>p.id===other.id)!;const current=f.runtime.journal.outstanding()!;
  expect(current.subject).toBe(second.id);f.gateway.active=true;const grant=await f.application.grant({moduleId:'new-timetable',activeHash:'d'.repeat(40),tool:'lookup',effect:'read',params:{route:'one'},description:'Owner-reviewed timetable lookup'},owner);
  const secondAccess=f.runtime.accessForCaller('bound',true,current.runId!);
  const document=await f.actions.applicationRead({actionKey:'cleanup-read',pursuitId:second.id,expectedRevision:second.revision,expectedVisibilityRevision:0,adapterId:grant.id,params:{route:'one'}},secondAccess) as DocumentArtifact;
  f.service.forget({actionKey:'forget-read',expectedVisibilityRevision:0,target:{kind:'evidence',id:second.evidenceRefs[0]}},owner);
  const cleanup=f.runtime.cleanupWithdrawn();expect(cleanup.application).toEqual(f.actions.applicationCleanup);expect(cleanup.application).toMatchObject({scrubbed:1,deferred:0,checkpoint:'complete'});expect(cleanup.deferred).toBeGreaterThanOrEqual(0);expect(()=>f.actions.read(document.ref,owner)).toThrow();
  expect(f.delivery.detail(id,owner).withdrawn).toBe(true);expect(f.delivery.detail(id,owner).payload).toBeNull();
  expect(f.runtime.cleanupWithdrawn().delivery).toEqual({deferred:0});
 }finally{f.close();}
});

test('delivery manifest uses the actual tool contract and truthfully separates worker preparation from owner submission',()=>{
 const manifest=JSON.parse(readFileSync(join(import.meta.dir,'module.json'),'utf8')) as {tools:unknown[];uses:string[]};
 const tools=manifest.tools.map(tool=>moduleToolSchema.parse(tool));expect(tools.find(t=>t.name==='delivery')?.visibility).toEqual(['owner','modules']);
 expect(manifest.uses).toContain('mind.delivery');expect(manifest.uses).toContain('author.submit');expect(manifest.uses).toContain('mind.applications');expect(manifest.uses).toContain('pi.models');
});

// Exercise the actual entry-point router in addition to the runtime integration above.
test('entry point enforces actual callers and keeps reconciling after source errors while observations coalesce',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'mind-entry-delivery-')),gateway=new Gateway(directory);
 const handlers=new Map<string,(event:any)=>Promise<any>>();let disconnect:(()=>void)|undefined;
 class FakeModelError extends Error{constructor(readonly code:string,message:string){super(message);}}
 const manifest=JSON.parse(readFileSync(join(import.meta.dir,'module.json'),'utf8')) as {tools:unknown[]};
 const pageTools=new Map<string,PageTool>(manifest.tools.map(value=>moduleToolSchema.parse(value)).filter(tool=>tool.visibility.includes('owner')).map(tool=>[tool.name,{moduleId:identity.moduleId,inputSchema:tool.parameters}]));
 const pages=createPages({dataDir:join(directory,'web'),modules:async()=>[{id:identity.moduleId,name:'mind',status:'active',activeHash:identity.hash}],tools:async()=>pageTools});
 const registeredCall:CoreCall=async(target,args,options)=>typeof target==='object'&&target.tool==='page-set'?pages.tool(target.tool,args,{kind:'module',module:'mind',moduleId:identity.moduleId,hash:identity.hash}):gateway.call(target,args,options);
 const sdk={chrona:{paths:{data:directory,module:import.meta.dir},dependencies:{chat:'chat-current',web:'web-current'},call:registeredCall},on:(name:string,handler:(event:any)=>Promise<any>)=>handlers.set(name,handler),onDisconnect:(handler:()=>void)=>{disconnect=handler;},ModelError:FakeModelError};
 mock.module('chrona',()=>sdk);
 const ownerCaller={kind:'owner'},workerCaller={kind:'module',...identity};
 const tool=async(id:string,value?:Record<string,unknown>,caller:unknown=ownerCaller,executionRunId?:string)=>{
  const response=await handlers.get('tool')!({id,args:value===undefined?{}:{input:JSON.stringify(value)},caller,call:executionRunId?{executionRunId}:undefined});return JSON.parse(response.result.json) as any;
 };
 try{
  await import(`./index.ts?delivery-integration=${Date.now()}`);
  for(let attempt=0;attempt<100&&!(await pages.get('mind','main'));attempt++)await Bun.sleep(10);
  const registeredPage=await pages.get('mind','main');expect(registeredPage).not.toBeNull();
  const extension=registeredPage!;expect(extension.tools).toContain('applications');expect(extension.tools).toContain('delivery');expect(extension.tools).not.toContain('admission-verdict');
  await tool('pursue',{actionKey:'entry-goal',expectedRevision:0,expectedVisibilityRevision:0,semanticKey:'entry-goal',goal:'Prepare a useful timetable capability',completionCriteria:['Actual published timetable result'],scope:{},reason:'explicit-goal',evidenceRefs:[]});
  await tool('check');
  // Source observation no longer owns the coordinator await; wait for its actual asynchronous completion.
  for(let attempt=0;attempt<50&&gateway.runs().length===0;attempt++){await new Promise<void>(resolve=>setImmediate(resolve));await tool('check');}
  expect(gateway.sourceCalls).toBeGreaterThan(0);expect(gateway.runs()).toHaveLength(1);
  const run=gateway.runs()[0];const inspection=new CoreMindStore(directory);let p=inspection.read().pursuits[0];
  const body='真实成果内容。'.repeat(4000);
  const document=await tool('action',{pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'entry-document',target:'document',document:{title:'完整成果',body}},workerCaller,run.runId);
  expect(document.kind).toBe('artifact-manifest');
  expect(document.bodyLength).toBe(body.length);
  const readTool=async(id:string,args:Record<string,unknown>,caller:unknown=workerCaller)=>{
   const response=await handlers.get('tool')!({id,args,caller,call:{executionRunId:run.runId}});
   return {wire:response.result,value:JSON.parse(response.result.json)};
  };
  const chunk=await readTool('artifact',{ref:document.ref,offset:0});
  expect(chunk.value.body).toBe(body.slice(0,chunk.value.nextOffset));
  expect(Buffer.byteLength(JSON.stringify(chunk.wire))).toBeLessThanOrEqual(32000);
  expect((await readTool('artifact',{ref:document.ref},ownerCaller)).value.body).toBe(body);
  expect((await readTool('detail',{id:p.id})).value.artifacts[0].body).toBeUndefined();
  const preparation={operation:'prepare',pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0,actionKey:'entry-prepare',author,admissionId:'original-admission',requestKey:'original-submit-key',items:[material],criteria:p.completionCriteria};
  await expect(tool('delivery',preparation,ownerCaller)).rejects.toThrow('kernel-bound');
  await expect(tool('delivery',preparation,workerCaller,'wrong-run')).rejects.toThrow('kernel-bound');
  await expect(tool('delivery',{...preparation,role:'owner'},{kind:'module',moduleId:'unrelated',hash:identity.hash})).rejects.toThrow('kernel-bound');
  const prepared=await tool('delivery',preparation,workerCaller,run.runId);expect(prepared.status).toBe('awaiting-worker-proof');
  await expect(tool('delivery',{operation:'list'},workerCaller,run.runId)).rejects.toThrow('actual owner');
  await expect(tool('delivery',{operation:'submit',id:prepared.id,role:'owner'},{kind:'module',moduleId:'unrelated',hash:identity.hash})).rejects.toThrow('actual owner');
  await gateway.invoke(run.runId,'modules.admit',{requestKey:'original-admit-key',submitter:author,targets:[{name:material.name,moduleId:null,expectedActiveHash:null}]});await gateway.invoke(run.runId,{moduleId:author.moduleId,tool:'stage'},{name:material.name});
  gateway.finish(run.runId);
  const reads=gateway.readCalls,sourceCalls=gateway.sourceCalls;await tool('check');expect(gateway.readCalls).toBeGreaterThan(reads);expect(gateway.sourceCalls).toBe(sourceCalls);
  p=inspection.read().pursuits[0];expect(p.currentActor).toBeUndefined();expect(p.status).not.toBe('done');inspection.close();
  const webCaller={kind:'module',moduleId:'web-current',hash:'e'.repeat(40)};
  expect((await tool('delivery',{operation:'detail',id:prepared.id},webCaller)).status).toBe('coordinator-ready');
  await tool('delivery',{operation:'submit',id:prepared.id},webCaller);expect(gateway.commands('submit')).toHaveLength(1);
  await expect(tool('delivery',{operation:'detail',id:prepared.id,access:owner},ownerCaller)).rejects.toThrow('Unexpected delivery fields');
 }finally{disconnect?.();mock.restore();gateway.close();rmSync(directory,{recursive:true,force:true});}
});

test('a definite delivery failure resumes the same goal with its material and reason after restart',async()=>{
 const f=new Fixture();
 try{
  f.goal();await f.runtime.tick();const prepared=await f.prepare();
  f.gateway.finish(prepared.run.runId);await f.runtime.tick();
  f.proof.verify=()=>{throw Error('The fixed admission is no longer usable; obtain a fresh admission for these materials');};
  await expect(f.delivery.submit(prepared.id,owner)).rejects.toThrow('fresh admission');
  expect(f.delivery.detail(prepared.id,owner).status).toBe('failed');
  expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);
  f.restart();await f.runtime.tick();expect(f.gateway.runs()).toHaveLength(1);
  f.now='2026-11-14T00:01:01.000Z';await f.runtime.tick();
  const resumed=f.gateway.runs().at(-1)!;
  expect(f.gateway.runs()).toHaveLength(2);expect(resumed.runId).not.toBe(prepared.run.runId);
  expect(String(resumed.args.prompt)).toContain('fresh admission');
  expect(String(resumed.args.prompt)).toContain(material.dir);
  expect(String(resumed.args.prompt)).toContain(prepared.input.requestKey);
  expect(f.gateway.commands('submit')).toHaveLength(0);
  f.gateway.finish(resumed.runId);await f.runtime.tick();
  f.now='2026-11-14T00:10:01.000Z';await f.runtime.tick();
  expect(f.gateway.runs()).toHaveLength(2); // An older failed delivery cannot restart a newer settled attempt.
 }finally{f.close();}
});

test.each([
 {code:'unavailable',reason:'not_dispatched'},
 {code:'invalid',reason:'submission_refused'},
])('positive original submission refusal proof releases work across restart (%s)',async failure=>{
 const f=new Fixture();try{
  const prepared=await ready(f);
  f.gateway.submitRefusal=Object.assign(Error('Explicit rejection before acceptance'),failure);
  await expect(f.delivery.submit(prepared.id,owner)).rejects.toThrow('Explicit rejection');
  expect(f.delivery.detail(prepared.id,owner).status).toBe('failed');
  f.restart();expect(f.delivery.pendingFor(f.pursuit.id)).toBe(false);
  await f.delivery.reconcile(prepared.id,owner);await f.delivery.submit(prepared.id,owner);
  expect(f.gateway.commands('submit')).toHaveLength(1);expect(f.gateway.commands('modules.receipt')).toHaveLength(0);
 }finally{f.close();}
});
