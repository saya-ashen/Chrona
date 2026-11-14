import {Database} from 'bun:sqlite';
import {chmodSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {canonical} from './core-store';
import type {CoreExecutionJournal,Execution} from './core-execution';
import type {DeliveryRecord} from './core-delivery';
const text=z.string().min(1).max(200),hash=z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const admission=z.object({admissionId:text,requestKey:text,submitter:z.object({moduleId:text,hash}).strict(),targets:z.array(z.object({name:text,moduleId:text.nullable(),expectedActiveHash:hash.nullable()}).strict()).min(1).max(4)}).strict();
type Proof={executionId:string;runId:string;principal:{moduleId:string;hash:string};callId:string;value:z.infer<typeof admission>};
/** Retains authenticated selected admission facts before the worker journal erases result bodies.
 * The owner coordinator consumes this proof; no caller-supplied admission object is authority. */
export class CoreDeliveryAdmission {
 private db:Database;
 constructor(directory:string,private journal:CoreExecutionJournal){const path=join(directory,'mind-delivery-admission.sqlite');this.db=new Database(path,{create:true});chmodSync(path,0o600);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS proofs(id TEXT PRIMARY KEY,json TEXT NOT NULL)');}
 capture(e:Execution){
  const actual=this.journal.get(e.id);
  if(canonical(actual)!==canonical(e)||!e.runId||!e.principal||!e.ended||e.active||e.settled||e.status!=='settling'||e.terminalStatus!=='finished'||e.stopRequested||e.facts.some(f=>f.status==='unknown')||!e.tools.includes('modules.admit'))return 0;
  let count=0;
  for(const f of e.facts){
   if(f.target!=='modules.admit'||f.runId!==e.runId||f.moduleId!=='system:modules'||!f.hash||f.status!=='succeeded'||f.outputState!=='complete')continue;
   const parsed=admission.safeParse(f.output);if(!parsed.success)continue;
   const value=parsed.data;if(new Set(value.targets.map(t=>t.name)).size!==value.targets.length||value.targets.some(t=>t.moduleId!==null||t.expectedActiveHash!==null))continue;
   const proof:Proof={executionId:e.id,runId:e.runId,principal:e.principal,callId:f.callId,value};
   const prior=this.db.query('SELECT json FROM proofs WHERE id=?').get(value.admissionId) as {json:string}|null;
   if(prior&&canonical(JSON.parse(prior.json))!==canonical(proof))throw Error('Original admission proof identity changed');
   this.db.query('INSERT OR IGNORE INTO proofs(id,json) VALUES(?,?)').run(value.admissionId,JSON.stringify(proof));count++;
  }return count;
 }
 verify(record:Readonly<DeliveryRecord>){
  const row=this.db.query('SELECT json FROM proofs WHERE id=?').get(record.admissionId) as {json:string}|null;
  if(!row)throw Error('Authenticated original selected admission proof unavailable');
  const p=JSON.parse(row.json) as Proof;
  if(p.executionId!==record.worker.executionId||p.runId!==record.worker.runId||canonical(p.principal)!==canonical(record.worker.principal)||canonical(p.value.submitter)!==canonical(record.author)||p.value.admissionId!==record.admissionId||p.value.targets.some(t=>t.moduleId!==null||t.expectedActiveHash!==null)||canonical(p.value.targets.map(t=>t.name).sort())!==canonical(record.materials.map(m=>m.name).sort()))throw Error('Original admission does not authorize this exact new capability handoff');
 }
 close(){this.db.close();}
}
