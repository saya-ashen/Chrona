import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { canonical, coreDigest } from './core-store';
import type { CoreAccess, Pursuit, Understanding } from './core-types';
import type { CoreMindService } from './core-service';
import type { CoreCall, Execution } from './core-execution';

const id = z.string().min(1).max(128), hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identity = z.object({ moduleId: id, hash }).strict();
const intent = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20) }).strict();
const name = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).refine(n => !['mind','chat','pi','author','web','self','core','agent'].includes(n), 'Reserved target');
const item = z.object({ name, dir: z.string().regex(/^packages\/[a-z][a-z0-9-]{0,63}\/source$/).max(180), intent, materialDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const deliveryPrepareSchema = z.object({ pursuitId: id, expectedRevision: z.number().int().nonnegative(), expectedVisibilityRevision: z.number().int().nonnegative(), actionKey: z.string().min(1).max(200), author: identity, admissionId: id, requestKey: z.string().min(1).max(200), items: z.array(item).min(1).max(4), criteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(20) }).strict().refine(v => new Set(v.items.map(i => i.name)).size === v.items.length && new Set(v.items.map(i => i.dir)).size === v.items.length, 'Duplicate material');
export type DeliveryPrepare = z.infer<typeof deliveryPrepareSchema>;
// Mirrors the actual kernel candidateReceiptSchema, including changing lifecycle projections.
export const deliveryReceiptSchema = z.object({ receiptId: id, admissionId: id, requestKey: z.string().min(1).max(200), submitter: identity, state: z.enum(['submitted','pending_approval','approved','rejected']), approvalId: id.nullable(), members: z.array(z.object({ name: z.string().min(1).max(64), moduleId: id, hash, versionId: id, expectedActiveHash: hash.nullable(), materialDigest: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['building','testing','pending_review','approved','rejected']), selected: z.boolean() }).strict()).min(1).max(4) }).strict();
type Receipt = z.infer<typeof deliveryReceiptSchema>;
type Module = { id: string; name: string; status: string; activeHash: string | null };
export type DeliveryRecord = {
 id: string; pursuitId: string; revision: number; visibilityRevision: number; actionKey: string;
 author: {moduleId: string; hash: string}; admissionId: string; requestKey: string;
 worker: {executionId: string; runId: string; actor: string; principal: {moduleId: string; hash: string}};
 commandDigest: string; prepareDigest: string; pursuitBasis: string; materials: {name: string; materialDigest: string}[];
 payload: DeliveryPrepare | null; proof: {name: string; callId: string; materialDigest: string}[];
 status: 'awaiting-worker-proof' | 'coordinator-ready' | 'submit-unknown' | 'submitted' | 'withdrawn';
 withdrawn: boolean; receipt: Receipt | null; observation: string; directory: Module[]; cleanup: string; updatedAt: string;
};
export type DeliveryOptions = {
 /** Trusted adapter reads its actual private execution journal; never supplied by a tool caller. */
 worker: (runRef: string) => Execution | undefined;
 /** Independent owner coordinator checks the REAL admission, including the complete NEW target set.
  * Must throw unless submitter == record.author, all targets have null moduleId/activeHash,
  * and the admitted target names exactly equal record.materials. This is not worker JSON. */
 verifyAdmission: (record: Readonly<DeliveryRecord>) => Promise<void>;
 /** Trusted runtime gate rechecks pending user controls immediately before a new dispatch. */
 assertMaySubmit?: (pursuitId: string) => void;
 now?: () => string;
};
const owner = (a: CoreAccess) => { if (a.role !== 'owner') throw Error('Owner coordinator required'); };
const command = (p: DeliveryPrepare) => ({ admissionId: p.admissionId, requestKey: p.requestKey, items: p.items.map(({name,dir,intent}) => ({name,dir,intent})) });
const target = (r: DeliveryRecord, tool: string) => ({ moduleId: r.author.moduleId, tool });
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
// A real service.release changes only these three fields; releasing the finished worker
// must not invalidate an otherwise identical handoff or reserve worker concurrency.
const pursuitBasis = ({revision,updatedAt,currentActor,...basis}:Pursuit, understandings:Understanding[]) => coreDigest(understandings.length ? {pursuit:basis,understandings} : basis);
const immutableReceipt = (r: Receipt) => ({ receiptId:r.receiptId, admissionId:r.admissionId, requestKey:r.requestKey, submitter:r.submitter, members:r.members.map(({status,selected,...m})=>m).sort((a,b)=>a.name.localeCompare(b.name)) });

/** Private handoff ledger, not another executor or lifecycle queue. Submission is shared by owner review and the trusted runtime coordinator. */
export class CoreDelivery {
 private db: Database;
 private inflight = new Set<string>();
 constructor(directory: string, private service: CoreMindService, private call: CoreCall, private options: DeliveryOptions) {
  const dir = resolve(directory); if (existsSync(dir) && (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())) throw Error('Unsafe delivery directory');
  mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700);
  const path=join(dir,'mind-delivery.sqlite'); if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('Unsafe delivery database');
  this.db=new Database(path,{create:true}); chmodSync(path,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS delivery (id TEXT PRIMARY KEY, command_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL)');
 }
 close(){this.db.close();}
 /** Coordinator waits reserve no executor lane; activated exact targets may resume the original goal. */
 pendingFor(pursuitId:string){return (this.db.query('SELECT body FROM delivery').all() as {body:string}[]).some(row=>{const r:DeliveryRecord=JSON.parse(row.body);return r.pursuitId===pursuitId&&!r.withdrawn&&r.receipt?.state!=='rejected'&&!(r.receipt?.members.every(m=>m.selected&&r.directory.some(d=>d.id===m.moduleId&&d.activeHash===m.hash&&d.status==='active')));});}
 cleanupWithdrawn(){
  let deferred=0;
  for(const row of this.db.query('SELECT body FROM delivery').all() as {body:string}[]){
   const r:DeliveryRecord=JSON.parse(row.body);let result:DeliveryRecord|undefined;
   if(r.withdrawn){if(r.cleanup.startsWith('deferred'))result=this.checkpointWithdrawal(r.id);}
   else try{this.live(r,{subject:'delivery-cleanup',role:'runtime',scopes:[{}]});}
   catch(error){console.error(JSON.stringify({component:'mind',event:'delivery_authorization_withdrawn',id:r.id,error:error instanceof Error?error.message:String(error)}));result=this.withdraw(r.id,{subject:'delivery-cleanup',role:'owner',scopes:[{}]});}
   if(result?.cleanup.startsWith('deferred'))deferred++;
  }return {deferred};
 }
 private now(){return this.options.now?.() ?? new Date().toISOString();}
 private get(idValue:string):DeliveryRecord { const row=this.db.query('SELECT body FROM delivery WHERE id=?').get(id.parse(idValue)) as {body:string}|null;if(!row)throw Error('Delivery not found');return JSON.parse(row.body); }
 private save(r:DeliveryRecord){r.updatedAt=this.now();const body=canonical(r);if(body.length>100_000)throw Error('Delivery record too large');this.db.query('INSERT INTO delivery(id,command_key,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(r.id,coreDigest([r.author,r.admissionId,r.requestKey]),body);}
 list(input:{limit?:number;after?:string}, access:CoreAccess){owner(access);const p=z.object({limit:z.number().int().min(1).max(50).default(20),after:id.optional()}).strict().parse(input);const rows=this.db.query('SELECT body FROM delivery WHERE id>? ORDER BY id LIMIT ?').all(p.after??'',p.limit+1) as {body:string}[];const values=rows.slice(0,p.limit).map(row=>{const r:DeliveryRecord=JSON.parse(row.body);return {id:r.id,pursuitId:r.pursuitId,status:r.status,withdrawn:r.withdrawn,observation:r.observation,cleanup:r.cleanup};});return {items:values,nextCursor:rows.length>p.limit?values.at(-1)!.id:null};}
 detail(idValue:string,access:CoreAccess){owner(access);return this.get(idValue);}
 private async modules():Promise<Module[]> {
  const result:Module[]=[];let cursor:string|undefined;const seen=new Set<string>();
  for(let n=0;n<20;n++){
   const p=z.object({items:z.array(z.object({id,name:z.string(),status:z.string(),activeHash:hash.nullable()}).passthrough()).max(100),nextCursor:z.string().nullable()}).passthrough().parse(await this.call('modules.list',{limit:100,...(cursor?{cursor}:{})}));
   result.push(...p.items.map(({id,name,status,activeHash})=>({id,name,status,activeHash})));
   if(!p.nextCursor)return result;if(seen.has(p.nextCursor))throw Error('Directory cursor repeated');seen.add(p.nextCursor);cursor=p.nextCursor;
  }throw Error('Directory exceeds bounded scan');
 }
 private authorLive(r:Pick<DeliveryRecord,'author'>,modules:Module[]){if(!modules.some(m=>m.id===r.author.moduleId&&m.name==='author'&&m.status==='active'&&m.activeHash===r.author.hash))throw Error('Original Author identity is no longer active');}
 private guard(p:DeliveryPrepare,access:CoreAccess){this.service.guardAction({pursuitId:p.pursuitId,expectedRevision:p.expectedRevision,expectedVisibilityRevision:p.expectedVisibilityRevision,actionKey:p.actionKey,target:`${p.author.moduleId}.submit`,arguments:command(p)},access);}
 private basis(p:Pursuit,access:CoreAccess){
  const s=this.service.store.read(),evidenceRefs=new Set(p.evidenceRefs);
  const understandings=p.understandingRefs.map(id=>{
   const u=this.service.detail({kind:'understanding',id},access);
   if(u.status==='retracted'||!u.value)throw Error('Live pursuit understanding unavailable');
   for(const ref of [...u.supportingRefs,...u.opposingRefs])evidenceRefs.add(ref);
   return u;
  });
  // Resolve dependencies from current understanding content, never only its saved ID or revision.
  for(const id of evidenceRefs){
   const e=this.service.detail({kind:'evidence',id},access);
   if(e.retractedAt||e.expiredAt||(e.sourceIdentity!=='owner'&&e.sourceIdentity!=='mind-owner'&&!s.checkpoints.some(c=>c.sourceIdentity===e.sourceIdentity&&c.epoch===e.epoch&&c.scopeRevision===e.scopeRevision&&c.coverage.complete)))throw Error('Live pursuit evidence unavailable');
  }
  return pursuitBasis(p,understandings);
 }
 private live(r:DeliveryRecord,access:CoreAccess){
  const s=this.service.store.read();const p=this.service.detail({kind:'pursuit',id:r.pursuitId},access) as Pursuit;
  const held=p.revision===r.revision&&p.currentActor?.actor===r.worker.actor&&p.currentActor.runRef===r.worker.runId;
  const released=p.revision===r.revision+1&&!p.currentActor;
  if(!s.settings.enabled||s.settings.restoreBlocked||s.visibilityRevision!==r.visibilityRevision||(!held&&!released)||this.basis(p,access)!==r.pursuitBasis||p.paused||['done','ended'].includes(p.status)||p.currentActor?.stopRequested)throw Error('Pursuit authorization or visibility changed');
 }
 async prepare(input:unknown,access:CoreAccess){
  const p=deliveryPrepareSchema.parse(input);if(!access.execution)throw Error('Current worker execution required');
  const e=this.options.worker(access.execution.runRef);
  if(!e||e.runId!==access.execution.runRef||e.purpose==='understand'||e.subject!==p.pursuitId||e.revision!==p.expectedRevision||e.visibilityRevision!==p.expectedVisibilityRevision||!e.runId||!e.principal||e.settled||e.ended||e.stopRequested||!['running','waiting'].includes(e.status))throw Error('Actual current worker required');
  this.guard(p,access);const modules=await this.modules();this.authorLive(p,modules);
  if(p.items.some(i=>modules.some(m=>m.name===i.name)))throw Error('Only NEW capability names are allowed');
  this.guard(p,access); // An async directory read never extends a stale authorization.
  const current=this.options.worker(access.execution.runRef);
  if(!current||current.id!==e.id||current.runId!==e.runId||!same(current.principal,e.principal)||current.settled||current.ended||current.stopRequested)throw Error('Original worker changed during preparation');
  const key=coreDigest([p.author,p.admissionId,p.requestKey]), recordId=coreDigest(['delivery',key]);
  const prior=this.db.query('SELECT body FROM delivery WHERE command_key=?').get(key) as {body:string}|null;
  const basis=this.basis(this.service.detail({kind:'pursuit',id:p.pursuitId},access),access);
  if(prior){const r:DeliveryRecord=JSON.parse(prior.body);if(r.prepareDigest!==coreDigest(p)||r.worker.executionId!==e.id||r.pursuitBasis!==basis||r.withdrawn)throw Error('Original delivery identity conflicts');return {id:r.id,status:r.status};}
  const r:DeliveryRecord={id:recordId,pursuitId:p.pursuitId,revision:p.expectedRevision,visibilityRevision:p.expectedVisibilityRevision,actionKey:p.actionKey,author:p.author,admissionId:p.admissionId,requestKey:p.requestKey,worker:{executionId:e.id,runId:e.runId,actor:access.execution.actor,principal:e.principal},commandDigest:coreDigest(command(p)),prepareDigest:coreDigest(p),pursuitBasis:basis,materials:p.items.map(({name,materialDigest})=>({name,materialDigest})),payload:p,proof:[],status:'awaiting-worker-proof',withdrawn:false,receipt:null,observation:'waiting for actual settled worker stage proof',directory:[],cleanup:'content retained',updatedAt:this.now()};this.save(r);return {id:r.id,status:r.status};
 }
 /** Trusted settle hook only. Call BEFORE CoreExecutor scrubs Execution.facts.output. */
 async capture(e:Execution):Promise<number>{
  if(!e.ended||e.active||e.settled||e.status!=='settling'||e.terminalStatus!=='finished'||e.stopRequested||e.facts.some(f=>f.status==='unknown'))return 0;
  const original=e.runId ? this.options.worker(e.runId) : undefined;if(!original||!same(original,e))throw Error('Capture requires actual journal execution');
  const rows=this.db.query('SELECT body FROM delivery').all() as {body:string}[];let captured=0;
  const modules=await this.modules();
  for(const row of rows){const r:DeliveryRecord=JSON.parse(row.body);if(r.status!=='awaiting-worker-proof'||r.withdrawn||!r.payload||r.worker.executionId!==e.id||r.worker.runId!==e.runId||!same(r.worker.principal,e.principal))continue;
   this.authorLive(r,modules);this.live(r,{subject:'delivery-settle',role:'runtime',scopes:[{}]});
   const selected=e.tools.some(t=>same(t,target(r,'stage')));if(!selected)continue;
   const proofs=r.payload.items.map(i=>{const f=e.facts.find(f=>f.runId===e.runId&&f.moduleId===r.author.moduleId&&f.hash===r.author.hash&&same(f.target,target(r,'stage'))&&f.status==='succeeded'&&f.outputState==='complete'&&!!f.output&&typeof f.output==='object'&&same({name:(f.output as any).name,dir:(f.output as any).dir,materialDigest:(f.output as any).materialDigest},{name:i.name,dir:i.dir,materialDigest:i.materialDigest}));return f?{name:i.name,callId:f.callId,materialDigest:i.materialDigest}:null;});
   if(proofs.some(p=>p===null))continue;
   captured+=this.db.transaction(()=>{const fresh=this.get(r.id);if(fresh.withdrawn||fresh.status!=='awaiting-worker-proof')return 0;fresh.proof=proofs as DeliveryRecord['proof'];fresh.status='coordinator-ready';fresh.observation='stage proven; waiting for independent owner admission verification';this.save(fresh);return 1;}).immediate();
  }return captured;
 }
 private accept(r:DeliveryRecord,raw:unknown){
  const receipt=deliveryReceiptSchema.parse(raw);
  this.db.transaction(()=>{r=this.get(r.id);
  if(receipt.admissionId!==r.admissionId||receipt.requestKey!==r.requestKey||!same(receipt.submitter,r.author)||receipt.members.length!==r.materials.length||new Set(receipt.members.map(m=>m.name)).size!==receipt.members.length||receipt.members.some(m=>m.expectedActiveHash!==null||!r.materials.some(i=>i.name===m.name&&i.materialDigest===m.materialDigest)))throw Error('Author receipt does not match original material identity');
  if(r.receipt&&!same(immutableReceipt(r.receipt),immutableReceipt(receipt)))throw Error('Immutable receipt identity changed');
  r.receipt=receipt;r.status='submitted';r.observation=receipt.state==='pending_approval'?'pending approval':receipt.state==='rejected'?'candidate rejected':receipt.members.some(m=>['building','testing'].includes(m.status))?'pending checks':'waiting for activation or owner proof';this.save(r);
  }).immediate();
 }
 async submit(idValue:string,access:CoreAccess,mayDispatch?:()=>boolean){
  owner(access);let r=this.get(idValue);if(r.status==='submit-unknown'||r.receipt)return this.reconcile(idValue,access);
  if(r.withdrawn||r.status!=='coordinator-ready'||!r.payload||r.proof.length!==r.materials.length)throw Error('Actual worker stage proof required');
  if(this.inflight.has(r.id))throw Error('Delivery call already in flight');this.inflight.add(r.id);
  try{
   const modules=await this.modules();r=this.get(r.id);this.authorLive(r,modules);this.live(r,access);
   if(r.materials.some(i=>modules.some(m=>m.name===i.name)))throw Error('Target is no longer NEW');
   await this.options.verifyAdmission(structuredClone(r));
   const finalModules=await this.modules();
   const args=this.db.transaction(()=>{
    r=this.get(r.id);this.authorLive(r,finalModules);this.live(r,access);
    if(r.materials.some(i=>finalModules.some(m=>m.name===i.name)))throw Error('Target is no longer NEW');
    if(r.withdrawn||r.status!=='coordinator-ready'||!r.payload)throw Error('Delivery withdrawn or changed');
    this.options.assertMaySubmit?.(r.pursuitId);
    if(mayDispatch&&!mayDispatch())throw Error('Automatic submission held by current settings or user control');
    const original=command(r.payload);if(coreDigest(original)!==r.commandDigest)throw Error('Original command changed');
    r.status='submit-unknown';r.observation='original submit outcome unknown; exact receipt query required';this.save(r);return original;
   }).immediate();
   const raw=await this.call(target(r,'submit'),{input:JSON.stringify(args)},{key:r.requestKey,expectedTarget:{moduleId:r.author.moduleId,hash:r.author.hash}});
   this.accept(this.get(r.id),raw);return this.get(r.id);
  }finally{this.inflight.delete(r.id);}
 }
 async reconcile(idValue:string,access:CoreAccess){
  owner(access);let r=this.get(idValue);if(!r.receipt&&r.status!=='submit-unknown')return r;
  // The approved owner coordinator reads the fixed kernel receipt independently of
  // the submitter's current version. Never replay the original submission here.
  const selector=r.receipt?{receiptId:r.receipt.receiptId}:{admissionId:r.admissionId,key:r.requestKey};
  const raw=await this.call('modules.receipt',selector);r=this.get(r.id);this.accept(r,raw);
  const liveModules=await this.modules();
  return this.db.transaction(()=>{r=this.get(r.id);
  r.directory=liveModules.filter(m=>r.receipt!.members.some(i=>i.moduleId===m.id));
  const active=r.receipt!.members.every(i=>i.selected&&r.directory.some(m=>m.id===i.moduleId&&m.name===i.name&&m.status==='active'&&m.activeHash===i.hash));
  if(active)r.observation='active; waiting for owner proof of original goal';else if(r.directory.some(m=>m.status==='migrating'))r.observation='waiting for drain';
  this.save(r);return r;
  }).immediate();
 }
 /** Owner forget adapter uses the same erasure path. Unknown commands remain queryable. */
 forget(idValue:string,access:CoreAccess){return this.withdraw(idValue,access);}
 withdraw(idValue:string,access:CoreAccess){
  owner(access);this.db.transaction(()=>{const r=this.get(idValue);r.withdrawn=true;r.payload=null;if(r.status!=='submit-unknown'&&!r.receipt)r.status='withdrawn';
  r.observation=r.status==='submit-unknown'?'withdrawn; original submit still unknown; receipt reconciliation retained':'withdrawn; original receipt identity retained';r.cleanup=this.inflight.has(r.id)?'deferred: original call arguments remain in flight':'source paths, intents and criteria removed; content-free reconciliation identity retained';this.save(r);
  return r;
  }).immediate();return this.checkpointWithdrawal(idValue);
 }
 private checkpointWithdrawal(idValue:string){
  const r=this.get(idValue),inflight=this.inflight.has(r.id);
  const clean=inflight?'deferred: original call arguments remain in flight':'source paths, intents and criteria removed; content-free reconciliation identity retained';
  // Persist the cleared marker BEFORE TRUNCATE so a successful retry also checkpoints that update.
  if(r.cleanup!==clean){r.cleanup=clean;this.save(r);}
  const result=this.db.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {busy:number};
  if(result.busy){r.cleanup=`deferred: SQLite checkpoint busy; logical content removal complete${inflight?'; original call arguments remain in flight':''}`;this.save(r);}
  return r;
 }
}
