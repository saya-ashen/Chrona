import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreMindStore} from './core-store';
import {CoreMindService} from './core-service';
import {CoreActions} from './core-actions';
import {CoreRuntime,RUNTIME_ACCESS,type RuntimeHooks} from './core-runtime';
import {readCapabilities,selectMindTools} from './core-capabilities';
import {mindPromptDelivery,type DeliveryOutcome} from './core-prompt';
import {publicSystemTools} from '../../system/tool-contract-declarations';
import {CoreObservationCoordinator} from './core-observation';
import type {CoreAccess} from './core-types';
import type {CoreCall,CoreExecutionJournal,Execution,ToolFact} from './core-execution';
import {assertExplicitRetryIssuesFreshAttempt,assertPoisonedHeadDoesNotStarveTail,assertTerminalRecordsReleaseQuota} from '../../__testing__/state-machine-invariants';

const identity={moduleId:'mind-retry',hash:'v1'};
const owner:CoreAccess={subject:'authenticated-owner',role:'owner',scopes:[{}]};
type Run={runId:string;contextId:string;status:string;active:boolean;ended:boolean;items:unknown[];args:Record<string,unknown>};
class Fixture {
 readonly directory=mkdtempSync(join(tmpdir(),'mind-bounded-retry-'));
 readonly gateway=new Database(join(this.directory,'gateway.sqlite'));
 now='2026-11-13T10:00:00.000Z';hash='tools-v1';reverse=false;loseReply=false;directoryCalls=0;readCalls=0;keys:string[]=[];
 failDescription=false;obsoleteContext=false;holdDirectory?:Promise<void>;directoryPages=1;
 selected='';store!:CoreMindStore;service!:CoreMindService;actions!:CoreActions;runtime!:CoreRuntime;
 directorySnapshot?:Awaited<ReturnType<typeof readCapabilities>>;
 constructor(private readonly hooks:RuntimeHooks={}){this.gateway.exec('CREATE TABLE runs(key TEXT PRIMARY KEY,json TEXT NOT NULL)');this.open();}
 open(){this.store=new CoreMindStore(this.directory);this.service=new CoreMindService(this.store,{now:()=>this.now});this.actions=new CoreActions(this.directory,this.service);this.runtime=new CoreRuntime(this.store,this.service,this.call,()=>identity,this.actions,()=>this.now,this.hooks);}
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
  if(this.obsoleteContext&&(target==='agent.stop'||target==='agent.read'))throw Error('Obsolete context unavailable');
  if(target==='modules.list'&&this.directorySnapshot)return {items:this.directorySnapshot.modules,nextCursor:null};
  if(target==='modules.describe'&&this.directorySnapshot)return {items:this.directorySnapshot.tools,nextCursor:null};
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
 checkpoint(body:string,key:string,waitFor?:'permission'|'budget'){
  const run=this.runs().at(-1)!,p=this.pursuit;
  const mutation={pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:this.store.read().visibilityRevision};
  const access=this.runtime.accessForCaller('adapter:mind',true,run.runId);
  const document=this.actions.create({...mutation,actionKey:`${key}:document`,target:'document',arguments:{},document:{title:'Development checkpoint',body}},access);
  const candidate=this.service.progress({...mutation,actionKey:`${key}:progress`,summary:`Saved actual implementation progress: ${key}`,artifactRefs:[document.ref],originalReceiptRef:`${key}:document`,evidenceRefs:p.evidenceRefs,
   desiredStatus:waitFor?'waiting':'active',...(waitFor?{waitFor}:{}),nextStep:'Resume /workspace/train-app/src/index.ts and fix the failing arrival-time check'},access);
  const fact:ToolFact={...identity,runId:run.runId,callId:`${key}:progress`,target:{moduleId:identity.moduleId,tool:'progress'},status:'succeeded',outputState:'complete',output:candidate};
  run.items.push({kind:'tool-result',payload:{type:'tool-result',value:fact}});this.save(run);return document;
 }
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
  if(hold==='none'){expect(String(f.runs()[1].args.prompt)).toContain(`"expectedVisibilityRevision":${f.store.read().visibilityRevision}`);f.finish('failed');await f.runtime.tick();f.advance(300000);await f.runtime.tick();expect(f.runs()).toHaveLength(3);f.finish('failed');await f.runtime.tick();f.advance(86400000);f.restart();await f.runtime.tick();expect(f.runs()).toHaveLength(3);}
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

test.each([true,false])('restart releases an older actor from terminal evidence without accessing its obsolete context (settled=%s)',async settled=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const e=f.runtime.journal.outstanding()!;expect(f.pursuit.currentActor?.runRef).toBe(e.runId!);
  f.finish();e.ended=true;e.active=false;e.terminalStatus='finished';e.stopRequested=true;e.stopConfirmed=false;e.settled=settled;e.status='failed';f.runtime.journal.save(e);
  f.obsoleteContext=true;f.restart();await f.runtime.tick(false,false,false);
  expect(f.pursuit.currentActor).toBeUndefined();expect(f.runtime.journal.get(e.id).stopConfirmed).toBe(true);expect(f.runs()).toHaveLength(1);
 }finally{f.close();}
});

for(const tail of ['explicit-goal','understanding','last-start-understanding'] as const)test(`capped opportunities do not starve ${tail} behind the head`,async()=>{
 const f=new Fixture();let healthy='';try{
  await assertPoisonedHeadDoesNotStarveTail({windowSize:1,maxTicks:2,
   seedBlockedHead:count=>{
    for(let i=0;i<3;i++){f.goal(`source-${i}`);f.control('pause',`pause-source-${i}`);}
    const evidenceRefs=f.store.read().evidence.map(e=>e.id);
    for(let i=0;i<count;i++)f.service.pursue({actionKey:`improvement-${i}`,expectedRevision:0,expectedVisibilityRevision:f.store.read().visibilityRevision,
     semanticKey:`improve-${i}`,goal:`Improve recurring workflow ${i}`,completionCriteria:['Useful improvement'],scope:{},reason:'improvement',evidenceRefs},owner);
    f.seed(f.runtime.journal,8,'opportunity');
    if(tail==='last-start-understanding')f.seed(f.runtime.journal,15);
   },
   seedHealthyTail:()=>{
    if(tail==='explicit-goal'){healthy=f.goal('healthy-explicit-goal').id;return;}
    if(tail==='last-start-understanding')f.goal('needs-two-starts');
    f.service.ingest({sourceIdentity:'chat-tail',epoch:'one',expectedCheckpointRevision:0,nextCursor:'2',scopeRevision:1,capturedAt:f.now,coverage:{complete:true},events:[
     {id:'tail-user',eventId:'tail-user',cursor:'1',object:{kind:'message',id:'tail-user',revision:1},kind:'message',actor:'user',scope:{},origin:{rootId:'tail'},occurredAt:f.now,receivedAt:f.now,scopeRevision:1,content:{text:'Remember my preference for trains',truncated:false}},
     {id:'tail-ended',eventId:'tail-ended',cursor:'2',object:{kind:'execution',id:'tail',revision:1},kind:'operation',actor:'application',scope:{},origin:{rootId:'tail'},occurredAt:f.now,receivedAt:f.now,scopeRevision:1,content:{text:JSON.stringify({foregroundActive:false,pendingCommand:false,terminalConfirmed:true}),truncated:false}}
    ]},RUNTIME_ACCESS);
   },tick:async()=>{f.restart();await f.runtime.tick(true);},
   isTailProcessed:()=>!!f.runs().length&&(tail==='explicit-goal'?f.store.read().pursuits.find(p=>p.id===healthy)?.currentActor?.runRef===f.runs()[0].runId:f.runtime.journal.outstanding()?.purpose==='understand')
  });
  expect(f.runs()).toHaveLength(1);expect(f.runtime.view().budget.opportunities).toBe(8);expect(f.runtime.lastError).toBeNull();
  if(tail==='last-start-understanding')expect(f.runtime.view().budget.starts).toBe(24);
 }finally{f.close();}
});

test('explicit owner retry after failure creates a fresh attempt with failure context instead of replaying the failed command',async()=>{
 const f=new Fixture();try{
  await assertExplicitRetryIssuesFreshAttempt({
   runFailingAttempt:async()=>{f.goal();await f.runtime.tick();f.finish('failed');await f.runtime.tick();return f.runs()[0];},
   retry:async failed=>{f.control('resume','explicit-retry');f.restart();await f.runtime.tick();const retry=f.runs().at(-1)!;
    expect(retry.contextId).not.toBe(failed.contextId);expect(String(retry.args.prompt)).toContain('Worker ended with failed status');
    expect(String(retry.args.prompt)).toContain(`"previousRun":"${failed.runId}"`);
   },observedDownstreamAttempts:()=>new Set(f.keys).size
  });
 }finally{f.close();}
});

for(const waitFor of [undefined,'budget','permission'] as const)test(`concrete checkpoint continuation respects ${waitFor??'active'} status and stops on identical content`,async()=>{
 const f=new Fixture();try{
  const original=f.goal();await f.runtime.tick();
  const body='Workspace /workspace/train-app/src/index.ts now implements timetable parsing. Check: arrival-time test fails for 11:30. Next: fix the date conversion.';
  const artifact=f.checkpoint(body,'first',waitFor);f.finish();await f.runtime.tick();
  expect(f.pursuit.artifactRefs).toContain(artifact.ref);f.restart();f.advance(60000);await f.runtime.tick();
  expect(f.runs()).toHaveLength(waitFor==='permission'?1:2);
  if(waitFor==='permission'){expect(f.pursuit.waitFor).toBe('permission');return;}
  const prompt=String(f.runs()[1].args.prompt);expect(prompt).toContain(body);expect(prompt).toContain(artifact.ref);expect(prompt).toContain('Saved concrete progress');
  expect(f.pursuit.id).toBe(original.id);expect(f.pursuit.goal).toBe(original.goal);
  f.checkpoint(body,'same-bytes-new-key',waitFor);f.finish();await f.runtime.tick();f.restart();f.advance(86400000);await f.runtime.tick();
  expect(f.runs()).toHaveLength(2);expect(f.runtime.view().retry).toEqual([]);
 }finally{f.close();}
});

test('successive concrete development checkpoints are limited to three attempts across restart',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();
  for(let attempt=1;attempt<=3;attempt++){
   f.checkpoint(`Workspace /workspace/train-app: implemented step ${attempt}; next check ${attempt+1}`,`step-${attempt}`,'budget');
   f.finish();await f.runtime.tick();f.restart();f.advance(attempt===1?60000:300000);await f.runtime.tick();
   expect(f.runs()).toHaveLength(Math.min(attempt+1,3));
  }
  expect(f.runtime.view().retry[0]).toMatchObject({attempts:3,nextRetryAt:null});
  f.advance(86400000);await f.runtime.tick(true);expect(f.runs()).toHaveLength(3);
 }finally{f.close();}
});

test('a timed-out development worker resumes saved concrete work only after confirmed stop',async()=>{
 const f=new Fixture();try{
  const goal=f.goal();await f.runtime.tick();const first=f.runs()[0];
  const artifact=f.checkpoint('Workspace /workspace/train-app: parser implemented and checked; fix the arrival-time test next','timed-out','budget');
  f.advance(180001);await f.runtime.tick();expect(f.runtime.journal.outstanding()?.stopRequested).toBe(false);
  f.advance(420000);await f.runtime.tick();expect(f.runtime.journal.outstanding()?.stopRequested).toBe(true);expect(f.runtime.journal.outstanding()?.stopConfirmed).toBe(false);
  f.restart();f.advance(60000);await f.runtime.tick();expect(f.runs()).toHaveLength(1);expect(f.pursuit.currentActor?.runRef).toBe(first.runId);
  f.finish('cancelled');await f.runtime.tick();expect(f.pursuit.artifactRefs).toContain(artifact.ref);expect(f.pursuit.currentActor).toBeUndefined();
  f.restart();f.advance(60000);await f.runtime.tick();expect(f.runs()).toHaveLength(2);expect(f.pursuit.id).toBe(goal.id);
  expect(String(f.runs()[1].args.prompt)).toContain('/workspace/train-app');expect(String(f.runs()[1].args.prompt)).toContain('fix the arrival-time test next');
 }finally{f.close();}
});

test('continuation includes the newest candidate handoffs in creation order rather than UUID order',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();
  for(let i=0;i<7;i++){f.advance(1);f.checkpoint(`Workspace /workspace/train-app: concrete implementation step ${i}`,`context-${i}`);}
  f.finish('failed');await f.runtime.tick();f.restart();f.advance(60000);await f.runtime.tick();
  const data=JSON.parse(String(f.runs()[1].args.prompt).split('\nData:\n').at(-1)!);
  expect(data.continuation.candidates.map((c:{summary:string})=>c.summary)).toEqual([6,5,4,3,2].map(i=>`Saved actual implementation progress: context-${i}`));
 }finally{f.close();}
});

test('terminal workers release the single active slot for later goals across restarts',async()=>{
 const f=new Fixture();try{
  await assertTerminalRecordsReleaseQuota({quota:1,extra:2,
   allocate:async index=>{const p=f.goal(`goal-${index}`);await f.runtime.tick();expect(f.runs()).toHaveLength(index+1);expect(f.pursuit.currentActor).toBeDefined();return p.id;},
   settleTerminal:async id=>{f.finish();await f.runtime.tick();f.restart();expect(f.store.read().pursuits.find(p=>p.id===id)?.currentActor).toBeUndefined();expect(f.runtime.journal.outstanding()).toBeUndefined();},
  });
 }finally{f.close();}
});

test('a delayed continuation retains failure and concrete workspace context after execution retention pruning',async()=>{
 const f=new Fixture();try{
  f.goal();f.service.settings({actionKey:'retain-source',expectedRevision:f.store.read().settings.revision,
   expectedVisibilityRevision:f.store.read().visibilityRevision,patch:{eventRetentionDays:90}},owner);
  await f.runtime.tick();const document=f.checkpoint('Workspace /workspace/train-app: saved timetable parser and failing noon-boundary check','delayed');
  f.finish('failed');await f.runtime.tick();f.restart();f.advance(31*86400000);await f.runtime.tick();
  expect(f.runs()).toHaveLength(2);expect(f.runtime.journal.all()).toHaveLength(1);
  const prompt=String(f.runs()[1].args.prompt);expect(prompt).toContain('Worker ended with failed status');expect(prompt).toContain(document.body);expect(prompt).toContain('run-1');
 }finally{f.close();}
});

test('the final permission wait supersedes an earlier active checkpoint from the same worker',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();
  f.checkpoint('Implemented the parser in /workspace/train-app','intermediate');
  f.advance(1);f.checkpoint('Parser ready; owner must approve access to the private timetable','final-wait','permission');
  f.finish();await f.runtime.tick();
  expect(f.store.read().pursuits[0]?.waitFor).toBe('permission');
  f.restart();f.advance(60000);await f.runtime.tick();
  expect(f.runs()).toHaveLength(1);
 }finally{f.close();}
});

test('a stale completion candidate cannot schedule repair over an already applied permission wait',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();const document=f.checkpoint('Workspace /workspace/train-app: awaiting private timetable permission','permission','permission');
  const pending=f.store.read().candidates.find(c=>c.runRef==='run-1')!,run=f.runs()[0];
  const completion=f.service.progress({actionKey:'stale-completion',pursuitId:f.pursuit.id,expectedRevision:f.pursuit.revision,
   expectedVisibilityRevision:f.store.read().visibilityRevision,summary:'Claimed complete before permission was applied',desiredStatus:'done',
   artifactRefs:[document.ref],evidenceRefs:f.pursuit.evidenceRefs,originalReceiptRef:'permission:document'},f.runtime.accessForCaller('adapter:mind',true,run.runId));
  run.items.push({kind:'tool-result',payload:{type:'tool-result',value:{...identity,runId:run.runId,callId:'stale-completion',
   target:{moduleId:identity.moduleId,tool:'progress'},status:'succeeded',outputState:'complete',output:completion}}});f.save(run);
  f.service.applyProgress({candidateId:pending.id,expectedRevision:pending.pursuitRevision,expectedVisibilityRevision:pending.visibilityRevision,
   actionKey:'permission:apply',verified:{candidateReceipt:pending.receipt,runRef:run.runId,originalReceiptRef:pending.originalReceiptRef,
    artifactRefs:[document.ref],method:'Exact persisted local artifact digest',criteriaSatisfied:false,executionTerminal:true}},RUNTIME_ACCESS);
  f.finish();await f.runtime.tick();expect(f.pursuit.waitFor).toBe('permission');expect(f.runtime.view().retry).toEqual([]);
  f.restart();f.advance(60000);await f.runtime.tick();expect(f.runs()).toHaveLength(1);expect(f.pursuit.waitFor).toBe('permission');
 }finally{f.close();}
});

test('failed worker cannot override its final permission wait',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();
  f.checkpoint('Ready for owner permission to access the private timetable','wait-before-failure','permission');
  f.finish('failed');await f.runtime.tick();
  f.restart();f.advance(60000);await f.runtime.tick();
  expect(f.pursuit.waitFor).toBe('permission');expect(f.runs()).toHaveLength(1);
 }finally{f.close();}
});

test('escaped checkpoint bodies leave continuation within the agent prompt contract',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.checkpoint('\u0001'.repeat(40000),'escaped-checkpoint');
  f.finish();await f.runtime.tick();f.restart();f.advance(60000);await f.runtime.tick();
  expect(f.runs()).toHaveLength(2);
  const prompt=String(f.runs().at(-1)!.args.prompt);
  expect(prompt.length).toBeLessThanOrEqual(200000);expect(prompt).toContain('"truncated":true');
 }finally{f.close();}
});

test('capability changes do not release a permission wait; owner resume does',async()=>{
 const f=new Fixture();try{
  f.goal();await f.runtime.tick();f.checkpoint('Waiting for owner access to private data','waiting-owner','permission');
  f.finish('failed');await f.runtime.tick();f.restart();f.hash='new-tool-version';f.advance(60000);await f.runtime.tick();
  expect(f.pursuit.waitFor).toBe('permission');expect(f.runs()).toHaveLength(1);
  f.control('resume');await f.runtime.tick();expect(f.runs()).toHaveLength(2);
 }finally{f.close();}
});

/** Real checked-in descriptions, including irrelevant owner settings/secrets, rather than padded text. */
async function largeDirectory(){
 const modules:Record<string,unknown>[]=[],items:{target:Parameters<CoreCall>[0];description:string}[]=[];
 const external=new URL('../',import.meta.url);
 for(const folder of readdirSync(external)){
  const file=new URL(`${folder}/module.json`,external);
  if(!await Bun.file(file).exists())continue;
  const manifest=JSON.parse(readFileSync(file,'utf8')) as {name:string;description:string;tools:{name:string;description:string;visibility?:string[]}[]};
  const moduleId=manifest.name==='mind'?identity.moduleId:manifest.name==='author'?'installed-app':`installed-${manifest.name}`;
  modules.push({id:moduleId,name:manifest.name,description:manifest.description,status:'active',activeHash:'a'.repeat(40),hash:'a'.repeat(40),builtin:false,
   versions:[{hash:'a'.repeat(40),status:'active',createdAt:'2026-11-13T09:00:00.000Z',errors:null,git:null}],runs:[]});
  for(const tool of manifest.tools??[])if((tool.visibility??['owner']).some(v=>v==='owner'||v==='provider'))items.push({target:{moduleId,tool:tool.name},description:tool.description});
 }
 for(const [module,tools] of Object.entries(publicSystemTools))for(const tool of tools)
  if(tool.visibility.some(v=>v==='owner'||v==='provider'))items.push({target:`${module}.${tool.name}`,description:tool.description});
 return readCapabilities(async target=>{
  if(target==='modules.list')return {items:modules,nextCursor:null};
  if(target==='modules.describe')return {items,nextCursor:null};
  throw Error(`Unexpected fixture directory call ${JSON.stringify(target)}`);
 });
}

function deliveryOutcome(pursuitId:string,worker:DeliveryOutcome['worker']):DeliveryOutcome{
 const material={name:'timetable',materialDigest:'b'.repeat(64),baseline:{moduleId:'existing-timetable',expectedActiveHash:'c'.repeat(40)}};
 return {id:'existing-delivery',pursuitId,worker,status:'submitted',observation:'Original receipt pending user approval',actionKey:'original-prepare-key',
  author:{moduleId:'installed-app',hash:'a'.repeat(40)},admissionId:'original-admission',requestKey:'original-submit-key',materials:[material],updatedAt:'2026-11-13T10:00:00.000Z',
  payload:{pursuitId,expectedRevision:1,expectedVisibilityRevision:0,actionKey:'original-prepare-key',author:{moduleId:'installed-app',hash:'a'.repeat(40)},admissionId:'original-admission',requestKey:'original-submit-key',
   items:[{...material,dir:'packages/timetable-update/source',intent:{changes:['Fix noon arrival parsing'],preserves:['Existing journeys and data']}}],criteria:['A usable result']},
  receipt:{receiptId:'original-receipt',admissionId:'original-admission',requestKey:'original-submit-key',submitter:{moduleId:'installed-app',hash:'a'.repeat(40)},state:'pending_approval',approvalId:'approval-id',
   members:[{name:material.name,moduleId:'existing-timetable',hash:'d'.repeat(40),versionId:'candidate-version',expectedActiveHash:material.baseline.expectedActiveHash,materialDigest:material.materialDigest,status:'pending_review',selected:false}]},
  directory:[{id:'existing-timetable',name:'timetable',status:'active',activeHash:material.baseline.expectedActiveHash}]};
}

/** Reconstruct the old serialization with otherwise identical evidence, artifacts and prompt instructions. */
function oldPromptSize(prompt:string,directory:Awaited<ReturnType<typeof readCapabilities>>,deliveries:DeliveryOutcome[],understand=false){
 const marker=understand?'\nContext/data:\n':'\nData:\n',offset=prompt.lastIndexOf(marker);
 const data=JSON.parse(prompt.slice(offset+marker.length));
 data.capabilities=understand?directory.tools:directory;
 if(!understand)data.continuation.deliveries=deliveries.map(({actionKey:_actionKey,author:_author,directory:_directory,...original})=>original);
 const instructions=prompt.slice(0,offset).replace(/continuation\.deliveries contains existing owner-recorded status[^\n]*\n/,'');
 return (instructions+marker+JSON.stringify(data)).length;
}

for(const mode of ['understand','pursuit'] as const)test(`large directory ${mode} prompts retain executable discovery and real context with fewer characters`,async()=>{
 let deliveries:DeliveryOutcome[]=[];
 const f=new Fixture({deliveryOutcomes:()=>deliveries});try{
  f.directorySnapshot=await largeDirectory();
  if(mode==='understand')f.service.ingest({sourceIdentity:'real-chat',epoch:'one',expectedCheckpointRevision:0,nextCursor:'2',scopeRevision:1,capturedAt:f.now,coverage:{complete:true},events:[
   {id:'user-request',eventId:'user-request',cursor:'1',object:{kind:'message',id:'user-request',revision:1},kind:'message',actor:'user',scope:{sessionId:'real-task'},origin:{rootId:'real-task'},occurredAt:f.now,receivedAt:f.now,scopeRevision:1,content:{text:'Fix the timetable app: the noon arrival is wrong. Preserve my saved journeys.',truncated:false}},
   {id:'foreground-ended',eventId:'foreground-ended',cursor:'2',object:{kind:'execution',id:'real-task',revision:1},kind:'operation',actor:'application',scope:{sessionId:'real-task'},origin:{rootId:'real-task'},occurredAt:f.now,receivedAt:f.now,scopeRevision:1,content:{text:JSON.stringify({foregroundActive:false,pendingCommand:false,terminalConfirmed:true}),truncated:false}}
  ]},RUNTIME_ACCESS);
  else f.goal();
  await f.runtime.tick(true);
  const measurements:{stage:number;before:number;after:number}[]=[];
  for(let stage=1;stage<=(mode==='understand'?1:3);stage++){
   const run=f.runs().at(-1)!,prompt=String(run.args.prompt),directory=f.runtime.capabilities!;
   const data=JSON.parse(prompt.split(mode==='understand'?'\nContext/data:\n':'\nData:\n').at(-1)!);
   expect(run.args.tools).toEqual(selectMindTools(directory.tools,identity.moduleId,mode));
   const describedTargets=[...data.capabilities.system.map((t:{target:string})=>t.target),
    ...data.capabilities.modules.flatMap((m:{moduleId:string;tools:{name:string}[]})=>m.tools.map(t=>({moduleId:m.moduleId,tool:t.name})))];
   expect(describedTargets.map(t=>JSON.stringify(t)).sort()).toEqual((run.args.tools as Parameters<CoreCall>[0][]).map(t=>JSON.stringify(t)).sort());
   expect(run.args.tools).toContain('modules.list');expect(run.args.tools).toContain('modules.describe');expect(run.args.tools).toContain('modules.receipt');
   const serialized=JSON.stringify(data.capabilities);
   expect(serialized).not.toContain('secrets.');expect(serialized).not.toContain('settings.');expect(serialized).not.toContain('installed-qq');
   const author=data.capabilities.modules.find((m:{moduleId:string})=>m.moduleId==='installed-app');
   if(mode==='understand'){
    expect(author).toBeUndefined();expect(data.evidence.some((e:{content?:{text:string}})=>e.content?.text.includes('Preserve my saved journeys'))).toBe(true);
    expect(data.evidence.every((e:{id:string})=>!!e.id)).toBe(true);expect(data.actionInputGuide.pursue.evidenceRefs).toBeDefined();
   }else{
    for(const tool of ['import','validate','read','stage','receipt'])expect(author.tools.some((t:{name:string})=>t.name===tool)).toBe(true);
    expect(author.metadata.hash).toBe('a'.repeat(40));expect(author.tools.some((t:{name:string})=>t.name==='submit')).toBe(false);
    expect(data.capabilities.modules.find((m:{moduleId:string})=>m.moduleId===identity.moduleId).tools.some((t:{name:string})=>t.name==='artifact')).toBe(true);
    expect(data.pursuit.id).toBe(f.pursuit.id);expect(data.pursuit.goal).toBe('Prepare a useful result');
    if(stage>1){
     expect(data.continuation.failure).toContain('Worker ended with failed status');expect(data.continuation.artifacts[0].body).toContain('/workspace/train-app');
     expect(data.continuation.candidates[0].originalReceiptRef).toBe(`stage-${stage-1}:document`);
     const outcome=data.continuation.deliveries[0];
     expect(outcome.actionKey).toBe('original-prepare-key');expect(outcome.requestKey).toBe('original-submit-key');expect(outcome.receipt.receiptId).toBe('original-receipt');
     expect(outcome.materials[0]).toMatchObject({dir:'packages/timetable-update/source',materialDigest:'b'.repeat(64),baseline:{moduleId:'existing-timetable',expectedActiveHash:'c'.repeat(40)}});
     expect(outcome.receipt.members[0]).toMatchObject({moduleId:'existing-timetable',hash:'d'.repeat(40),versionId:'candidate-version',selected:stage===3});
     expect(outcome.directory[0].activeHash).toBe(stage===3?'d'.repeat(40):'c'.repeat(40));expect(outcome.payload).toBeUndefined();
    }
   }
   const before=oldPromptSize(prompt,directory,deliveries,mode==='understand');measurements.push({stage,before,after:prompt.length});
   expect(prompt.length).toBeLessThan(before*.55);
   if(mode==='pursuit'&&stage<3){
    f.checkpoint(`/workspace/train-app/src/index.ts: implemented parser step ${stage}; actual noon-boundary assertion still fails. Preserve existing material and fix conversion.`,`stage-${stage}`);
    const execution=f.runtime.journal.outstanding()!;
    deliveries=[deliveryOutcome(f.pursuit.id,{executionId:execution.id,runId:run.runId,actor:'mind',principal:identity})];
    if(stage===2){deliveries[0].receipt!.state='approved';deliveries[0].receipt!.members[0]!.selected=true;deliveries[0].receipt!.members[0]!.status='approved';deliveries[0].directory[0]!.activeHash='d'.repeat(40);deliveries[0].observation='Exact candidate is active; original usable-result criterion still needs checking';}
    f.finish('failed');await f.runtime.tick();f.restart();f.advance(stage===1?60000:300000);await f.runtime.tick();
    expect(f.runs()).toHaveLength(stage+1);
   }
  }
  console.info(JSON.stringify({fixture:'checked-in user-visible tool descriptions',mode,modules:f.directorySnapshot.modules.length,capabilities:f.directorySnapshot.tools.length,characters:measurements}));
 }finally{f.close();}
});

for(const status of ['awaiting-worker-proof','coordinator-ready','submit-unknown','failed'] as const)test(`delivery prompt retains ${status} facts without inventing a submission receipt`,()=>{
 const original=deliveryOutcome('pursuit',{executionId:'original-execution',runId:'original-run',actor:'mind',principal:identity});
 original.status=status;original.receipt=null;original.directory=[];
 original.observation=status==='failed'?'Validation failed: missing compiled timetable handler':`Actual delivery status: ${status}`;
 const context=mindPromptDelivery(original);
 expect(context.status).toBe(status);expect(context.observation).toBe(original.observation);expect(context.receipt).toBeNull();
 expect(context.admissionId).toBe('original-admission');expect(context.requestKey).toBe('original-submit-key');expect(context.actionKey).toBe('original-prepare-key');
 expect(context.worker.runId).toBe('original-run');expect(context.author).toEqual(original.author);
 expect(context.materials[0]).toMatchObject({name:'timetable',dir:'packages/timetable-update/source',materialDigest:'b'.repeat(64)});
 original.payload=null;
 expect(mindPromptDelivery(original).materials[0]).not.toHaveProperty('dir');
});

test('continuation retains older withdrawn unknown submission identities beyond recent delivery history',async()=>{
 let deliveries:DeliveryOutcome[]=[];
 const f=new Fixture({deliveryOutcomes:()=>deliveries});try{
  const pursuit=f.goal();
  deliveries=Array.from({length:7},(_,i)=>({...deliveryOutcome(pursuit.id,{executionId:'prior-'+i,runId:'prior-run-'+i,actor:'mind',principal:identity}),
   id:'delivery-'+i,requestKey:'original-key-'+i,admissionId:'admission-'+i,updatedAt:`2026-11-13T09:0${i}:00.000Z`}));
  Object.assign(deliveries[0]!,{status:'submit-unknown',withdrawn:true,receipt:null,payload:null});
  await f.runtime.tick(true);
  const data=JSON.parse(String(f.runs()[0]!.args.prompt).split('\nData:\n').at(-1)!);
  expect(data.continuation.deliveries).toHaveLength(7);
  expect(data.continuation.deliveries).toContainEqual(expect.objectContaining({
   id:'delivery-0',status:'submit-unknown',withdrawn:true,requestKey:'original-key-0',admissionId:'admission-0'
  }));
 }finally{f.close();}
});
