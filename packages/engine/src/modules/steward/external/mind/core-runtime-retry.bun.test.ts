import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreMindStore} from './core-store';
import {CoreMindService} from './core-service';
import {CoreActions} from './core-actions';
import {CoreRuntime,RUNTIME_ACCESS} from './core-runtime';
import {CoreObservationCoordinator} from './core-observation';
import type {CoreAccess} from './core-types';
import type {CoreCall,CoreExecutionJournal,Execution,ToolFact} from './core-execution';

const identity={moduleId:'mind-retry',hash:'v1'};
const owner:CoreAccess={subject:'authenticated-owner',role:'owner',scopes:[{}]};
type Run={runId:string;contextId:string;status:string;active:boolean;ended:boolean;items:unknown[];args:Record<string,unknown>};
class Fixture {
 readonly directory=mkdtempSync(join(tmpdir(),'mind-bounded-retry-'));
 readonly gateway=new Database(join(this.directory,'gateway.sqlite'));
 now='2026-11-13T10:00:00.000Z';hash='tools-v1';reverse=false;loseReply=false;directoryCalls=0;readCalls=0;keys:string[]=[];
 failDescription=false;holdDirectory?:Promise<void>;directoryPages=1;
 selected='';store!:CoreMindStore;service!:CoreMindService;actions!:CoreActions;runtime!:CoreRuntime;
 constructor(){this.gateway.exec('CREATE TABLE runs(key TEXT PRIMARY KEY,json TEXT NOT NULL)');this.open();}
 open(){this.store=new CoreMindStore(this.directory);this.service=new CoreMindService(this.store,{now:()=>this.now});this.actions=new CoreActions(this.directory,this.service);this.runtime=new CoreRuntime(this.store,this.service,this.call,()=>identity,this.actions,()=>this.now);}
 restart(){this.runtime.close();this.actions.close();this.store.close();this.open();}
 close(){this.runtime.close();this.actions.close();this.store.close();this.gateway.close();rmSync(this.directory,{recursive:true,force:true});}
 advance(ms:number){this.now=new Date(Date.parse(this.now)+ms).toISOString();}
 runs(){return (this.gateway.query('SELECT json FROM runs ORDER BY rowid').all() as {json:string}[]).map(r=>JSON.parse(r.json) as Run);}
 save(r:Run){this.gateway.query("UPDATE runs SET json=? WHERE json_extract(json,'$.runId')=?").run(JSON.stringify(r),r.runId);}
 finish(status='finished'){const r=this.runs().at(-1)!;r.status=status;r.active=false;r.ended=true;this.save(r);}
 get pursuit(){return this.store.read().pursuits.find(p=>p.id===this.selected)!;}
 goal(key='goal'){const p=this.service.pursue({actionKey:key,expectedRevision:0,expectedVisibilityRevision:this.store.read().visibilityRevision,semanticKey:key,goal:'Prepare a useful result',completionCriteria:['A usable result'],scope:{},reason:'explicit-goal',evidenceRefs:[]},owner).value!;this.selected=p.id;return p;}
 control(operation:'pause'|'resume',key:string=operation){return this.service.control({actionKey:key,expectedRevision:this.pursuit.revision,expectedVisibilityRevision:this.store.read().visibilityRevision,kind:'pursuit',id:this.pursuit.id,operation},owner);}
 readonly call:CoreCall=async(target,args,options)=>{
  if(target==='modules.list'){this.directoryCalls++;await this.holdDirectory;const items=[{id:identity.moduleId,name:'mind',hash:identity.hash},{id:'installed-app',name:'author',hash:this.hash}];return {items:this.reverse?items.reverse():items,nextCursor:this.directoryPages>1&&!args.cursor?'page-2':null};}
  if(target==='modules.describe'){this.directoryCalls++;if(this.failDescription)throw Error('Directory unavailable');return {items:[{target:{moduleId:'installed-app',tool:'read'},description:'Read current prepared material'}],nextCursor:null};}
  if(target==='agent.run'){
   this.keys.push(options!.key!);const prior=this.gateway.query('SELECT json FROM runs WHERE key=?').get(options!.key!) as {json:string}|null;
   if(prior){const r=JSON.parse(prior.json) as Run;expect(r.args).toEqual(args);return r;}
   expect(this.runs().some(r=>r.active)).toBe(false);
   const n=this.runs().length+1,r:Run={runId:`run-${n}`,contextId:`context-${n}`,status:'running',active:true,ended:false,items:[],args:structuredClone(args)};
   this.gateway.query('INSERT INTO runs(key,json) VALUES(?,?)').run(options!.key!,JSON.stringify(r));
   if(this.loseReply){this.loseReply=false;throw Error('Lost original command reply');}return r;
  }
  if(target==='agent.read'){this.readCalls++;const r=this.runs().find(r=>r.runId===args.runId)!;return {run:r,items:r.items,ended:r.ended,nextCursor:null,interactions:[]};}
  if(target==='agent.stop'){const r=this.runs().find(r=>r.runId===args.runId)!;return {...r,stopConfirmed:!r.active};}
  throw Error(`Unexpected gateway call ${JSON.stringify(target)}`);
 };
 seed(journal:CoreExecutionJournal,count:number,purpose:Execution['purpose']='understand'){
  for(let i=0;i<count;i++){const e=journal.prepare({purpose,subject:`settled-${i}`,revision:0,visibilityRevision:0,prompt:'Already settled fixture run',tools:[]},this.now);e.ended=true;e.settled=true;e.status='finished';e.terminalStatus='finished';journal.save(e);}
 }
}

test('confirmed failed work retries twice at persisted 60s and 5m boundaries, then remains exhausted across restart',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.finish('failed');await f.runtime.tick();expect(f.runtime.view().retry[0]).toMatchObject({attempts:1,nextRetryAt:'2026-11-13T10:01:00.000Z',error:'Worker ended with failed status'});
  f.restart();f.advance(59999);await f.runtime.tick(true);expect(f.runs()).toHaveLength(1);
  f.advance(1);await f.runtime.tick();expect(f.runs()).toHaveLength(2);expect(new Set(f.keys).size).toBe(2);
  f.finish('failed');await f.runtime.tick();expect(f.runtime.view().retry[0].nextRetryAt).toBe('2026-11-13T10:06:00.000Z');
  f.restart();f.advance(299999);await f.runtime.tick();expect(f.runs()).toHaveLength(2);
  f.advance(1);await f.runtime.tick();expect(f.runs()).toHaveLength(3);
  f.finish('failed');await f.runtime.tick();expect(f.runtime.view().retry[0]).toMatchObject({attempts:3,nextRetryAt:null});
  f.restart();f.advance(86400000);await f.runtime.tick(true);expect(f.runs()).toHaveLength(3);
 }finally{f.close();}
});

for(const hold of ['none','pause','forget','unknown-effect'] as const)test(`unrelated source supersession permits bounded fresh continuation only after safe stop: ${hold}`,async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const original=f.runs()[0];
  for(const revision of [1,2])f.service.ingest({sourceIdentity:'other-chat',epoch:'one',expectedCheckpointRevision:revision-1,nextCursor:String(revision),scopeRevision:1,capturedAt:f.now,coverage:{complete:true},events:[{id:`execution-${revision}`,eventId:`execution-${revision}`,cursor:String(revision),object:{kind:'execution',id:'other-chat',revision},kind:'operation',actor:'application',scope:{sessionId:'other-chat'},origin:{rootId:'other-chat'},occurredAt:f.now,receivedAt:f.now,scopeRevision:1,content:{text:JSON.stringify({foregroundActive:revision===1,pendingCommand:false,terminalConfirmed:revision===2}),truncated:false}}]},RUNTIME_ACCESS);
  if(hold==='pause')f.control('pause');
  if(hold==='forget')f.service.forget({actionKey:'forget-goal-source',expectedVisibilityRevision:f.store.read().visibilityRevision,target:{kind:'evidence',id:f.pursuit.evidenceRefs[0]}},owner);
  await f.runtime.tick();expect(f.runtime.journal.outstanding()?.stopRequested).toBe(true);expect(f.runtime.journal.outstanding()?.stopConfirmed).toBe(false);
  f.restart();f.advance(60000);await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.finish('cancelled');
  if(hold==='unknown-effect'){const run=f.runs()[0];run.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...identity,runId:run.runId,callId:'uncertain',target:{moduleId:identity.moduleId,tool:'detail'},status:'unknown',outputState:'pending'}}}];f.save(run);}
  await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.restart();f.advance(59999);await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.advance(1);await f.runtime.tick();expect(f.runs()).toHaveLength(hold==='none'?2:1);
  if(hold==='none'){expect(String(f.runs()[1].args.prompt)).toContain(`\"expectedVisibilityRevision\":${f.store.read().visibilityRevision}`);f.finish('failed');await f.runtime.tick();f.advance(300000);await f.runtime.tick();expect(f.runs()).toHaveLength(3);f.finish('failed');await f.runtime.tick();f.advance(86400000);f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(3);}
  else expect(f.pursuit.status).not.toBe('done');
  expect(f.runs()[0].runId).toBe(original.runId);
 }finally{f.close();}
});

test('lost run replies recover the original key and unknown effects occupy concurrency beyond the observation cap',async()=>{
 const f=new Fixture();try{
  f.goal();f.loseReply=true;await f.runtime.tick();expect(f.runtime.view().phase).toBe('unknown');expect(f.runs()).toHaveLength(1);
  const original=f.keys[0];f.runtime.journal.db.query('UPDATE runtime_observation_budget SET credits=0').run();
  f.restart();await f.runtime.tick();expect(f.keys).toEqual([original,original]);expect(f.pursuit.currentActor?.runRef).toBe('run-1');
  const run=f.runs()[0],fact:ToolFact={...identity,runId:run.runId,callId:'uncertain-read',target:{moduleId:identity.moduleId,tool:'detail'},status:'unknown',outputState:'pending'};
  run.items=[{kind:'tool-result',payload:{type:'tool-result',value:fact}}];run.active=false;run.ended=true;run.status='failed';f.save(run);
  await f.runtime.tick();expect(f.runtime.journal.outstanding()?.status).toBe('unknown');expect(f.pursuit.currentActor).toBeDefined();
  f.restart();f.advance(360000);await f.runtime.tick();expect(f.runs()).toHaveLength(1);expect(f.readCalls).toBeGreaterThan(1);expect(f.runtime.view().budget.observations).toBeGreaterThanOrEqual(2);
  run.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...fact,status:'failed',outputState:'complete'}}}];f.save(run);await f.runtime.tick();
  expect(f.runtime.journal.outstanding()).toBeUndefined();expect(f.pursuit.currentActor).toBeUndefined();expect(f.runs()).toHaveLength(1);
 }finally{f.close();}
});

test('same successful basis never loops, including after journal pruning and restart',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();
  f.restart();f.advance(31*86400000);await f.runtime.tick(true);await f.runtime.tick(true);
  expect(f.runs()).toHaveLength(1);expect(f.runtime.view().retry).toEqual([]);expect(f.pursuit.currentActor).toBeUndefined();
 }finally{f.close();}
});

test('authenticated owner pause/resume deliberately retries an unchanged goal; release revisions do not',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();const goal=f.pursuit.goal;
  f.control('pause');await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.control('resume');f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(2);expect(f.pursuit.goal).toBe(goal);
  f.finish();await f.runtime.tick();f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(2);
  f.control('resume','retry-once-more');await f.runtime.tick();expect(f.runs()).toHaveLength(3);
 }finally{f.close();}
});

test('directory identity changes permit continuation; timestamps, order and restart do not',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();
  f.reverse=true;f.advance(60000);f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(1);
  f.hash='tools-v2-installed';await f.runtime.tick();expect(f.runs()).toHaveLength(1);f.advance(60000);await f.runtime.tick();expect(f.runs()).toHaveLength(2);
  f.finish();await f.runtime.tick();f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(2);
 }finally{f.close();}
});

test('throttling charges before failed dispatch, persists through restart and replenishes without a daily reset',async()=>{
 const f=new Fixture();try{
  f.runtime.journal.db.query('UPDATE runtime_observation_budget SET credits=4').run();
  f.failDescription=true;
  await expect(f.runtime.observe('modules.describe',{})).rejects.toThrow('Directory unavailable');
  expect(f.runtime.view().budget).toMatchObject({observations:1,remaining:3,observationLimit:518});
  await expect(f.runtime.observe('modules.list',{})).rejects.toThrow('budget exhausted');
  expect(f.runtime.view().budget.throttled).toBe(true);expect(f.directoryCalls).toBe(1);
  f.restart();await expect(f.runtime.observe('modules.list',{})).rejects.toThrow('budget exhausted');
  f.advance(10000);await f.runtime.observe('modules.list',{});expect(f.runtime.view().budget).toMatchObject({observations:2,remaining:3});
  // Source control calls retain the reserve, while ordinary discovery cannot spend it.
  await f.runtime.observe({moduleId:'source',tool:'observation-scope'},{},undefined,'source-control').catch(()=>{});
  expect(f.runtime.view().budget.remaining).toBe(2);
 }finally{f.close();}
});

test('idle capability success is reused for sixty seconds; incomplete refresh preserves prior identity and late activation resumes the goal',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();const prior=f.runtime.capabilities;
  expect(f.directoryCalls).toBe(2);f.hash='late-activation';f.failDescription=true;
  f.advance(59999);await f.runtime.tick(true);expect(f.directoryCalls).toBe(2);
  f.advance(1);await f.runtime.tick();expect(f.directoryCalls).toBe(4);expect(f.runtime.capabilities).toBe(prior);expect(f.runs()).toHaveLength(1);
  f.failDescription=false;await f.runtime.tick();expect(f.directoryCalls).toBe(4);
  f.advance(60000);await f.runtime.tick();expect(f.directoryCalls).toBe(6);expect(f.runtime.capabilities).not.toBe(prior);expect(f.runs()).toHaveLength(2);
 }finally{f.close();}
});

test('coordinator keeps unknown effects, controls and forget progressing while source sync is pending and credits are exhausted',async()=>{
 const f=new Fixture();let release!:()=>void;try{
  f.goal();await f.runtime.tick();const run=f.runs()[0];
  const fact:ToolFact={...identity,runId:run.runId,callId:'uncertain',target:{moduleId:identity.moduleId,tool:'detail'},status:'unknown',outputState:'pending'};
  run.items=[{kind:'tool-result',payload:{type:'tool-result',value:fact}}];run.active=false;run.ended=true;run.status='failed';f.save(run);
  f.runtime.journal.db.query('UPDATE runtime_observation_budget SET credits=0').run();
  let syncs=0;const pending=new Promise<void>(resolve=>{release=resolve;});
  const coordinator=new CoreObservationCoordinator(async()=>{syncs++;await pending;},manual=>f.runtime.tick(manual,false,false),()=>Date.parse(f.now));
  await coordinator.check();expect(syncs).toBe(1);expect(f.runtime.journal.outstanding()?.status).toBe('unknown');
  f.control('pause');f.advance(10000);await coordinator.check(true);expect(f.runtime.journal.outstanding()?.stopRequested).toBe(true);
  f.service.forget({actionKey:'forget-pending',expectedVisibilityRevision:f.store.read().visibilityRevision,target:{kind:'evidence',id:f.pursuit.evidenceRefs[0]}},owner);f.runtime.cleanupWithdrawn();
  run.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...fact,status:'failed',outputState:'complete'}}}];f.save(run);
  const reads=f.readCalls;f.advance(10000);await coordinator.check();
  expect(f.readCalls).toBeGreaterThan(reads);expect(f.runtime.journal.outstanding()).toBeUndefined();expect(f.pursuit.currentActor).toBeUndefined();expect(f.runs()).toHaveLength(1);expect(syncs).toBe(1);
  release();await coordinator.settled();
 }finally{release?.();f.close();}
});

test('pending capability discovery never owns the reconciliation guard or blocks semantic admission',async()=>{
 const f=new Fixture();let release!:()=>void;try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();f.control('pause');f.advance(60000);
  f.holdDirectory=new Promise<void>(resolve=>{release=resolve;});const refreshing=f.runtime.refreshCapabilities();
  const request=f.runtime.admission.enqueue('control',{actionKey:'resume-with-directory-pending',expectedRevision:f.pursuit.revision,expectedVisibilityRevision:f.store.read().visibilityRevision,kind:'pursuit',id:f.pursuit.id,operation:'resume',evidenceRefs:f.pursuit.evidenceRefs},{subject:'current-mind-worker',role:'runtime',scopes:[{}],execution:{actor:'mind',runRef:'source-run'}});
  f.runtime.journal.db.query('UPDATE runtime_observation_budget SET credits=0').run();
  await f.runtime.tick(false,false,false);expect(f.runtime.admission.outstanding()).toBeDefined();expect(f.runtime.admission.view(request.requestId).status).toBe('pending');
  release();await refreshing;
 }finally{release?.();f.close();}
});

test('worker, artifact verifier and semantic admission share the 24 daily starts across restart',async()=>{
 const f=new Fixture();try{
  f.seed(f.runtime.journal,8);f.seed(f.runtime.verification.journal,8);f.seed(f.runtime.admission.journal,7);f.goal();
  f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(0);expect(f.runtime.view().budget.starts).toBe(23);
  f.advance(86400000);await f.runtime.tick();expect(f.runs()).toHaveLength(1);expect(f.runtime.view().budget.starts).toBe(1);
 }finally{f.close();}
});

test('eight daily opportunity starts suppress further opportunities without hot-loop errors',async()=>{
 const f=new Fixture();try{
  for(let i=0;i<3;i++){f.goal(`source-${i}`);f.control('pause',`pause-source-${i}`);}
  const evidenceRefs=f.store.read().evidence.map(e=>e.id);
  f.service.pursue({actionKey:'improvement',expectedRevision:0,expectedVisibilityRevision:f.store.read().visibilityRevision,semanticKey:'improve',goal:'Improve the recurring workflow',completionCriteria:['Useful improvement'],scope:{},reason:'improvement',evidenceRefs},owner);
  f.seed(f.runtime.journal,8,'opportunity');await f.runtime.tick();expect(f.runs()).toHaveLength(0);expect(f.runtime.view().budget.opportunities).toBe(8);expect(f.runtime.lastError).toBeNull();
  f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(0);
 }finally{f.close();}
});

test('a semantic resume remains a safety hold until accepted selected evidence and terminal verifier admission',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.finish();await f.runtime.tick();f.control('pause');
  const input={actionKey:'semantic-resume',expectedRevision:f.pursuit.revision,expectedVisibilityRevision:f.store.read().visibilityRevision,kind:'pursuit',id:f.pursuit.id,operation:'resume',evidenceRefs:f.pursuit.evidenceRefs};
  const request=f.runtime.admission.enqueue('control',input,{subject:'current-mind-worker',role:'runtime',scopes:[{}],execution:{actor:'mind',runRef:'source-run'}});
  await f.runtime.tick();expect(f.runs()).toHaveLength(2);expect(f.pursuit.paused).toBe(true);expect(f.runtime.pendingControl(f.pursuit.id)).toBe(true);
  const e=f.runtime.admission.outstanding()!,view=f.runtime.admission.view(request.requestId);
  const receipt=f.runtime.admission.verdict({requestId:view.requestId,candidateDigest:view.candidateDigest,targetDigest:view.targetDigest,sourceDigest:view.sourceDigest,decision:'accepted',reason:'The owner explicitly asks to resume this work in the cited source.'},{...identity,runId:e.runId!});
  const run=f.runs().at(-1)!;run.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...identity,runId:run.runId,callId:'admission',target:{moduleId:identity.moduleId,tool:'admission-verdict'},status:'succeeded',outputState:'complete',output:receipt}}}];f.save(run);
  await f.runtime.tick();expect(f.pursuit.paused).toBe(true);expect(f.runs()).toHaveLength(2);
  f.restart();await f.runtime.tick();expect(f.pursuit.paused).toBe(true);expect(f.runs()).toHaveLength(2);
  f.finish();await f.runtime.tick();expect(f.runtime.admission.view(request.requestId).status).toBe('applied');expect(f.pursuit.paused).toBe(false);expect(f.runs()).toHaveLength(3);
  f.finish();await f.runtime.tick();f.advance(31*86400000);f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(3);
 }finally{f.close();}
});

test('slow successful discovery stays cached for sixty seconds after publication',async()=>{
 const f=new Fixture();let release!:()=>void;try{
  f.holdDirectory=new Promise<void>(resolve=>{release=resolve;});
  const refresh=f.runtime.refreshCapabilities();f.advance(65000);release();await refresh;
  expect(f.directoryCalls).toBe(2);
  await f.runtime.refreshCapabilities();f.advance(59999);await f.runtime.refreshCapabilities();expect(f.directoryCalls).toBe(2);
  f.advance(1);await f.runtime.refreshCapabilities();expect(f.directoryCalls).toBe(4);
 }finally{release?.();f.close();}
});

test('paginated discovery accumulates credits to complete throughout the day and detects late activation',async()=>{
 const f=new Fixture();try{
  f.runtime.journal.db.exec('PRAGMA synchronous=OFF');f.directoryPages=2;
  // Force discovery to encounter insufficient credits, then accumulate for a
  // complete scan while identity/scope/feed polling keeps its priority.
  f.runtime.journal.db.query('UPDATE runtime_observation_budget SET credits=6').run();
  let published=0,latePublished=0;let prior=f.runtime.capabilities;
  const coordinator=new CoreObservationCoordinator(async()=>{
   for(let n=0;n<3;n++)f.runtime.observationBudget.consume('source-control');
   f.runtime.observationBudget.consume('source-data');
   await f.runtime.refreshCapabilities();
   if(f.runtime.capabilities!==prior){published++;if(f.hash==='late-page-activation')latePublished++;prior=f.runtime.capabilities;}
  },async()=>{},()=>Date.parse(f.now));
  for(let minute=0;minute<1440;minute++){
   if(minute===1400)f.hash='late-page-activation';
   await Promise.all([coordinator.check(),coordinator.check(true)]);await coordinator.settled();f.advance(60000);
  }
  expect(published).toBeGreaterThan(500);expect(latePublished).toBeGreaterThan(0);
  expect(f.runtime.capabilities?.modules.some(m=>m.hash==='late-page-activation')).toBe(true);
  expect(f.runtime.view().budget.observations).toBeGreaterThan(500);
  expect(f.runtime.view().budget.remaining).toBeGreaterThanOrEqual(3);
 }finally{f.close();}
});

test('startup directory discovery does not block original lost-command reconciliation or dispatch fresh work',async()=>{
 const f=new Fixture();let release!:()=>void;try{
  f.goal();f.loseReply=true;await f.runtime.tick();const original=f.keys[0];f.restart();
  const pending=new Promise<void>(resolve=>{release=resolve;});let discoveries=0;
  const coordinator=new CoreObservationCoordinator(async()=>{discoveries++;await pending;},()=>f.runtime.reconcileOriginals(),()=>Date.parse(f.now));
  await coordinator.check();expect(f.keys).toEqual([original,original]);expect(f.pursuit.currentActor?.runRef).toBe('run-1');
  f.advance(10000);await coordinator.check();expect(f.readCalls).toBeGreaterThan(1);expect(f.runs()).toHaveLength(1);expect(discoveries).toBe(1);
  release();await coordinator.settled();
 }finally{release?.();f.close();}
});
