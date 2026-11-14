import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreObservationBudget,CoreObservationCoordinator} from './core-observation';

// An accelerated ordinary day: every minute performs identity, two scope guards,
// one feed page and complete two-call discovery. Every ten seconds reconciles.
test('a full simulated day survives duplicate timer/check paths, source evidence and late capability activation',async()=>{
 const db=new Database(':memory:');let now=Date.parse('2026-11-13T00:00:00Z');
 const budget=new CoreObservationBudget(db,()=>new Date(now).toISOString());
 let observations=0,reconciliations=0,evidence=0,capability='v1',seenCapability='',seenEvidence=0;
 const seenScopes:number[]=[];
 const coordinator=new CoreObservationCoordinator(async()=>{
  observations++;
  budget.consume('source-control'); // fresh source identity
  budget.consume('source-control');seenScopes.push(observations); // initial live scope
  budget.consume('source-data');
  if(observations===1381)evidence++; // new evidence at 23:00
  budget.consume('source-control');seenScopes.push(observations); // final live scope
  budget.consume();budget.consume();seenCapability=capability;
  seenEvidence=evidence;
 },async()=>{reconciliations++;},()=>now);
 try{
  for(let step=0;step<8640;step++){
   if(step===8520)capability='v2-activated-at-23:40';
   // Ten-second loop plus manual check plus timer on minute boundaries.
   await Promise.all([coordinator.check(),coordinator.check(true),...(step%6===0?[coordinator.check()]:[])]);
   await coordinator.settled();now+=10000;
  }
  expect(observations).toBe(1440);expect(reconciliations).toBe(18720);
  expect(seenEvidence).toBe(1);expect(seenCapability).toBe('v2-activated-at-23:40');
  expect(seenScopes).toHaveLength(2880);
  // Day counter rolls over; the final six-credit refill is bounded by capacity.
  expect(budget.view()).toMatchObject({observations:0,remaining:518,throttled:false});
  expect(db.query('SELECT used FROM runtime_observations WHERE day=?').get('2026-11-13')).toEqual({used:8640});
 }finally{db.close();}
});

test('restart and midnight preserve debt; refill uses elapsed time and backwards clocks cannot mint credits',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mind-observation-budget-')),path=join(directory,'budget.sqlite');
 let now=Date.parse('2026-11-13T23:59:59Z'),db=new Database(path),budget=new CoreObservationBudget(db,()=>new Date(now).toISOString());
 try{
  db.exec('PRAGMA synchronous=OFF');
  for(let n=0;n<515;n++)budget.consume();
  expect(()=>budget.consume()).toThrow('budget exhausted');expect(budget.view()).toMatchObject({remaining:3,observations:515,throttled:true});
  db.close();db=new Database(path);budget=new CoreObservationBudget(db,()=>new Date(now).toISOString());
  expect(()=>budget.consume()).toThrow('budget exhausted');expect(budget.view().remaining).toBe(3);
  now+=2000;expect(budget.view()).toMatchObject({remaining:3,observations:0});expect(()=>budget.consume()).toThrow('budget exhausted');
  now+=8000;budget.consume();expect(budget.view()).toMatchObject({remaining:3,observations:1});
  now-=10000;expect(budget.view().remaining).toBe(3);now+=10000;expect(budget.view().remaining).toBe(3);
  // Identity and scope remain dispatchable after ordinary discovery is throttled.
  budget.consume('source-control');budget.consume('source-control');budget.consume('source-control');
  expect(()=>budget.consume('source-control')).toThrow('budget exhausted');
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('source data reserves a final live scope check and migration debits old observations once',()=>{
 const db=new Database(':memory:'),now=()=> '2026-11-13T12:00:00.000Z';
 try{
  db.exec('CREATE TABLE runtime_observations(day TEXT PRIMARY KEY,used INTEGER NOT NULL)');
  db.query('INSERT INTO runtime_observations VALUES(?,?)').run('2026-11-13',500);
  let budget=new CoreObservationBudget(db,now);expect(budget.view().remaining).toBe(18);
  for(let n=0;n<17;n++)budget.consume('source-data');
  expect(()=>budget.consume('source-data')).toThrow('budget exhausted');budget.consume('source-control');
  budget=new CoreObservationBudget(db,now);expect(budget.view()).toMatchObject({remaining:0,observations:518});
 }finally{db.close();}
});

test('a failed observation advances the shared deadline and pending source work never suppresses reconciliation',async()=>{
 let now=0,attempts=0,reconciliations=0,failures=0,release!:()=>void;
 let pending=new Promise<void>(resolve=>{release=resolve;});
 const coordinator=new CoreObservationCoordinator(async()=>{attempts++;await pending;throw Error('source offline');},async()=>{reconciliations++;},()=>now,()=>{failures++;});
 await coordinator.check();now=120000;await coordinator.check(true);expect(attempts).toBe(1);expect(reconciliations).toBe(2);
 release();await coordinator.settled();expect(failures).toBe(1);
 pending=Promise.resolve();await coordinator.check();await coordinator.settled();expect(attempts).toBe(2);
 now+=59999;await coordinator.check(true);expect(attempts).toBe(2);
 now++;await Promise.all([coordinator.check(),coordinator.check(true)]);await coordinator.settled();expect(attempts).toBe(3);expect(reconciliations).toBe(6);
});
