import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { CoreMindService } from './core-service';
import { CoreError, type CoreAccess, type GuardActionInput } from './core-types';
import type { CoreApplication, ApplicationInvokeInput, ApplicationReceipt } from './core-application';
import { canonical, coreDigest } from './core-store';
/** Lazy because the authoritative self module ID is available only after identity verification. */
export type ApplicationActionAdapter = Pick<CoreApplication, 'invoke' | 'readReceipt' | 'cleanupWithdrawn'>;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export type DocumentArtifact={ref:string;digest:string;title:string;body:string;format:'markdown'|'text';pursuitId:string;visibilityRevision:number;createdAt:string};
/** Concrete documents and reviewed persisted application reads, guarded by the live core. */
export class CoreActions {
 readonly db:Database;
 private lastApplicationCleanup:ReturnType<ApplicationActionAdapter['cleanupWithdrawn']>|undefined;
 get applicationCleanup(){return this.lastApplicationCleanup?{...this.lastApplicationCleanup}:undefined;}
 constructor(directory:string,private readonly service:CoreMindService,private readonly application?:()=>ApplicationActionAdapter){
  mkdirSync(directory,{recursive:true,mode:0o700});const path=join(directory,'mind-artifacts.sqlite');this.db=new Database(path,{create:true});chmodSync(path,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS documents(ref TEXT PRIMARY KEY, action_key TEXT UNIQUE NOT NULL, input_digest TEXT NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS application_reads(ref TEXT PRIMARY KEY, pursuit_id TEXT NOT NULL, goal_digest TEXT);');
  if(!(this.db.query('PRAGMA table_info(application_reads)').all() as {name:string}[]).some(c=>c.name==='goal_digest'))this.db.exec('ALTER TABLE application_reads ADD COLUMN goal_digest TEXT;');
 }
 create(input:GuardActionInput&{document:{title:string;body:string;format?:'markdown'|'text'}},access:CoreAccess){
  if(input.target!=='document')throw Error('Only local document creation is available through this effect adapter');
  const d=input.document;if(!d||typeof d.title!=='string'||typeof d.body!=='string'||!d.body.trim()||d.body.length>150000||d.title.length>200)throw Error('A bounded, nonempty local document is required');
  // Core guard atomically checks current responsibility, pursuit revision and visibility, including replays.
  const guard={...input,arguments:{title:d.title,body:d.body,format:d.format??'markdown'}};
  this.service.guardAction(guard,access);
  const document = this.db.transaction(()=>{
   const signature=digest(JSON.stringify(guard.arguments));const prior=this.db.query('SELECT input_digest,json FROM documents WHERE action_key=?').get(input.actionKey) as {input_digest:string;json:string}|null;
   if(prior){if(prior.input_digest!==signature)throw Error('Same action key cannot change document');return JSON.parse(prior.json) as DocumentArtifact;}
   const document:DocumentArtifact={ref:`mind-document:${digest(input.actionKey)}`,digest:digest(d.body),title:d.title,body:d.body,format:d.format??'markdown',pursuitId:input.pursuitId,visibilityRevision:input.expectedVisibilityRevision,createdAt:new Date().toISOString()};
   this.db.query('INSERT INTO documents(ref,action_key,input_digest,json) VALUES(?,?,?,?)').run(document.ref,input.actionKey,signature,JSON.stringify(document));return document;
  }).immediate();
  this.service.recordAction({actionKey:`${input.actionKey}:outcome`,expectedVisibilityRevision:input.expectedVisibilityRevision,effectActionKey:input.actionKey,outcome:'succeeded',originalReceiptRef:document.ref},{subject:'mind:document-adapter',role:'runtime',scopes:[{}]});
  return document;
 }
 private applicationAdapter(){if(!this.application)throw new CoreError('INVALID_INPUT','Application reads are unavailable');return this.application();}
 private applicationArtifact(receipt:ApplicationReceipt):DocumentArtifact{
  if(receipt.status!=='succeeded'||receipt.responseBody===undefined||!receipt.responseDigest)throw new CoreError('CONFLICT','Application read has no confirmed successful response');
  if(coreDigest(receipt.responseBody)!==receipt.responseDigest)throw Error('Application response digest mismatch');
  // The complete sanitized reply and observed identity come only from the persisted authoritative adapter.
  const body=canonical({kind:'application-read',receiptRef:receipt.ref,adapterId:receipt.adapterId,moduleId:receipt.moduleId,activeHash:receipt.activeHash,
   tool:receipt.tool,argsDigest:receipt.argsDigest,responseDigest:receipt.responseDigest,response:receipt.responseBody,
   pursuitId:receipt.pursuitId,pursuitRevision:receipt.pursuitRevision,visibilityRevision:receipt.visibilityRevision,actor:receipt.actor,runRef:receipt.runRef});
  return {ref:receipt.ref,digest:digest(body),title:`Application read ${coreDigest([receipt.moduleId,receipt.tool]).slice(0,16)}`,body,format:'text',
   pursuitId:receipt.pursuitId,visibilityRevision:receipt.visibilityRevision,createdAt:receipt.completedAt??receipt.createdAt};
 }
 async applicationRead(input:ApplicationInvokeInput,access:CoreAccess):Promise<DocumentArtifact|ApplicationReceipt>{
  // Ignore all model-provided bodies, outcomes and identities, including extra fields in tool JSON.
  const receipt=await this.applicationAdapter().invoke({actionKey:input.actionKey,pursuitId:input.pursuitId,expectedRevision:input.expectedRevision,
   expectedVisibilityRevision:input.expectedVisibilityRevision,adapterId:input.adapterId,params:input.params},access);
  if(receipt.status!=='succeeded')return receipt;
  const artifact=this.read(receipt.ref,access);
  const pursuit=this.service.detail({kind:'pursuit',id:artifact.pursuitId},access);
  this.db.query('INSERT OR IGNORE INTO application_reads(ref,pursuit_id,goal_digest) VALUES(?,?,?)').run(artifact.ref,artifact.pursuitId,coreDigest({goal:pursuit.goal,criteria:pursuit.completionCriteria,scope:pursuit.scope}));
  return artifact;
 }
 read(ref:string,access:CoreAccess={subject:'mind:artifact-reader',role:'runtime',scopes:[{}]}){
  if(ref.startsWith('mind-application:')){
   const receipt=this.applicationAdapter().readReceipt(ref,access);
   const pursuit=this.service.detail({kind:'pursuit',id:receipt.pursuitId},access);
   const original=this.db.query('SELECT goal_digest FROM application_reads WHERE ref=?').get(ref) as {goal_digest:string|null}|null;
   const sameGoal=original?.goal_digest?original.goal_digest===coreDigest({goal:pursuit.goal,criteria:pursuit.completionCriteria,scope:pursuit.scope}):pursuit.revision===receipt.pursuitRevision;
   if(!sameGoal||!pursuit.goal)throw new CoreError('CONFLICT','Application read belongs to a different pursuit goal revision');
   return this.applicationArtifact(receipt);
  }
  const r=this.db.query('SELECT json FROM documents WHERE ref=?').get(ref) as {json:string}|null;if(!r)throw Error('Document not found');const d=JSON.parse(r.json) as DocumentArtifact;if(digest(d.body)!==d.digest)throw Error('Document digest mismatch');const pursuit=this.service.detail({kind:'pursuit',id:d.pursuitId},access);if(!pursuit.goal)throw new CoreError('CONFLICT','Document pursuit has been withdrawn');return d;
 }
 list(pursuitId:string,access?:CoreAccess){
  const reader=access??{subject:'mind:artifact-reader',role:'runtime' as const,scopes:[{}]};
  const pursuit=this.service.detail({kind:'pursuit',id:pursuitId},reader);
  if(!pursuit.goal)return [];
  const documents=(this.db.query('SELECT json FROM documents').all() as {json:string}[]).map(r=>JSON.parse(r.json) as DocumentArtifact).filter(d=>d.pursuitId===pursuitId);
  const applications=(this.db.query('SELECT ref FROM application_reads WHERE pursuit_id=?').all(pursuitId) as {ref:string}[]).flatMap(r=>{
   try{return [this.read(r.ref,access)];}catch(error){console.error(JSON.stringify({component:'mind',event:'application_artifact_unavailable',ref:r.ref,error:error instanceof Error?error.message:String(error)}));return [];}// Withdrawn/changed-goal receipts are not current visible artifacts.
  });
  return [...documents,...applications].map(({body:_body,...d})=>d);
 }
 /** Forget removes local derived content; occurred effects remain content-free in the core ledger. */
 forgetPursuits(ids:string[]){const set=new Set(ids);for(const row of this.db.query('SELECT ref,json FROM documents').all() as {ref:string;json:string}[])if(set.has((JSON.parse(row.json) as DocumentArtifact).pursuitId))this.db.query('DELETE FROM documents WHERE ref=?').run(row.ref);
  for(const id of ids)this.db.query('DELETE FROM application_reads WHERE pursuit_id=?').run(id);
  // Visibility/source withdrawal can affect receipts even when no pursuit was fully erased.
  let applicationCleanup:ReturnType<ApplicationActionAdapter['cleanupWithdrawn']>|undefined;
  if(this.application)applicationCleanup=this.applicationAdapter().cleanupWithdrawn();
  // These rows contain only receipt identities and goal digests. Keep them through
  // temporary source gaps or read failures so repaired coverage restores discovery.
  // Explicitly forgotten pursuits were removed above; the adapter scrubs withdrawn bodies.
  this.lastApplicationCleanup=applicationCleanup;
  // Retry on every maintenance pass, even after all documents have been deleted or after restart.
  let deferred=0;
  try{const checkpoint=this.db.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {busy:number};if(checkpoint.busy)deferred++;}
  catch(error){deferred++;console.error(JSON.stringify({component:'mind',event:'artifact_checkpoint_failed',error:error instanceof Error?error.message:String(error)}));}
  return {deferred,...(applicationCleanup?{application:applicationCleanup}:{})};}
 close(){this.db.close();}
}
