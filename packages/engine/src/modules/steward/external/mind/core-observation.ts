import type {Database} from 'bun:sqlite';

export const OBSERVATION_CAPACITY=518;
export const OBSERVATION_REFILL_PER_MINUTE=6;
export const OBSERVATION_WINDOW_MS=60_000;
/** Identity plus initial/final live scope checks must survive ordinary discovery. */
export const SOURCE_RESERVE=3;
export type ObservationPriority='ordinary'|'source-data'|'source-control';
type Bucket={credits:number;refilled_at:string;throttled:number;reason:string|null};
export class ObservationBudgetError extends Error {
 readonly code='OBSERVATION_THROTTLED';
 constructor(){super('Lightweight observation budget exhausted; waiting for replenishment');}
}

/** Charges before dispatch, including failed calls; neither restart nor midnight fills the bucket. */
export class CoreObservationBudget {
 constructor(private readonly db:Database,private readonly clock:()=>string){
  db.exec(`CREATE TABLE IF NOT EXISTS runtime_observations(day TEXT PRIMARY KEY,used INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS runtime_observation_budget(id INTEGER PRIMARY KEY CHECK(id=1),credits REAL NOT NULL,refilled_at TEXT NOT NULL,throttled INTEGER NOT NULL DEFAULT 0,reason TEXT);`);
  // Migrate the old daily counter once. It remains the honest daily dispatch counter.
  const used=(db.query('SELECT used FROM runtime_observations WHERE day=?').get(clock().slice(0,10)) as {used:number}|null)?.used??0;
  db.query('INSERT OR IGNORE INTO runtime_observation_budget(id,credits,refilled_at) VALUES(1,?,?)').run(Math.max(0,OBSERVATION_CAPACITY-used),clock());
 }
 private refill(now:string){
  const row=this.db.query('SELECT credits,refilled_at,throttled,reason FROM runtime_observation_budget WHERE id=1').get() as Bucket;
  // A backwards clock cannot refill twice for the same elapsed interval.
  const at=Math.max(Date.parse(row.refilled_at),Date.parse(now));
  return {...row,credits:Math.min(OBSERVATION_CAPACITY,row.credits+(at-Date.parse(row.refilled_at))*OBSERVATION_REFILL_PER_MINUTE/OBSERVATION_WINDOW_MS),refilled_at:new Date(at).toISOString()};
 }
 consume(priority:ObservationPriority='ordinary'){
  const accepted=this.db.transaction(()=>{
   const now=this.clock(),row=this.refill(now),reserve=priority==='ordinary'?SOURCE_RESERVE:priority==='source-data'?1:0;
   const accepted=row.credits>=reserve+1;
   this.db.query('UPDATE runtime_observation_budget SET credits=?,refilled_at=?,throttled=?,reason=? WHERE id=1').run(accepted?row.credits-1:row.credits,row.refilled_at,accepted?0:1,accepted?null:`${priority}: waiting for credits (reserve ${reserve})`);
   if(accepted)this.db.query('INSERT INTO runtime_observations(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1').run(now.slice(0,10));
   return accepted;
  }).immediate();
  // Throw after commit so the throttled diagnostic survives the rejected dispatch.
  if(!accepted)throw new ObservationBudgetError();
 }
 defer(reason:string){this.db.query('UPDATE runtime_observation_budget SET throttled=1,reason=? WHERE id=1').run(reason);}
 view(){return this.db.transaction(()=>{
  const now=this.clock(),row=this.refill(now);
  this.db.query('UPDATE runtime_observation_budget SET credits=?,refilled_at=? WHERE id=1').run(row.credits,row.refilled_at);
  const used=(this.db.query('SELECT used FROM runtime_observations WHERE day=?').get(now.slice(0,10)) as {used:number}|null)?.used??0;
  return {observations:used,observationLimit:OBSERVATION_CAPACITY,remaining:Math.floor(row.credits),refillPerMinute:OBSERVATION_REFILL_PER_MINUTE,throttled:!!row.throttled,throttleReason:row.reason};
 }).immediate();}
}

/** Shared by timer, check and the ten-second loop. A pending read never owns reconciliation. */
export class CoreObservationCoordinator {
 private next=0;private pending?:Promise<void>;
 constructor(private readonly observe:()=>Promise<void>,private readonly reconcile:(manual:boolean)=>Promise<unknown>,private readonly clock:()=>number=Date.now,private readonly failed:(error:unknown)=>void=()=>{}){}
 get observing(){return !!this.pending;}
 async check(manual=false){
  if(!this.pending&&this.clock()>=this.next){
   this.next=this.clock()+OBSERVATION_WINDOW_MS;
   const pending=Promise.resolve().then(this.observe).catch(this.failed);
   this.pending=pending;
   void pending.finally(()=>{if(this.pending===pending)this.pending=undefined;});
  }
  return this.reconcile(manual);
 }
 /** Private lifecycle helper: await only when shutting down or testing, never for reconciliation. */
 async settled(){await this.pending;}
}
