import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoreMindStore} from './core-store';
import {CoreMindService} from './core-service';
import {CoreActions} from './core-actions';
import {CoreRuntime,RUNTIME_ACCESS} from './core-runtime';
import type {CoreCall} from './core-execution';
import type {CoreAccess} from './core-types';
const owner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]},identity={moduleId:'mind',hash:'b'.repeat(40)};
function fixture(actor:'user'|'application'='application'){
 const dir=mkdtempSync(join(tmpdir(),'mind-organizer-')),store=new CoreMindStore(dir),service=new CoreMindService(store),actions=new CoreActions(dir,service);
 let at='2026-11-15T01:00:00.000Z';const runs:{runId:string;contextId:string;active:boolean;status:string;args:Record<string,unknown>;items:unknown[]}[]=[];
 const call:CoreCall=async(target,args)=>{
  if(target==='modules.list')return {items:[{id:identity.moduleId,name:'mind',activeHash:identity.hash}],nextCursor:null};
  if(target==='modules.describe')return {items:[],nextCursor:null};
  if(target==='agent.run'){const run={runId:`run-${runs.length}`,contextId:`context-${runs.length}`,active:true,status:'running',args,items:[]};runs.push(run);return run;}
  const run=runs.find(r=>r.runId===args.runId)!;
  if(target==='agent.read')return {run,items:run.items,nextCursor:null,ended:!run.active,interactions:[]};
  if(target==='agent.stop')return {...run,stopConfirmed:!run.active};
  throw Error('Unexpected gateway');
 };
 service.settings({expectedRevision:0,expectedVisibilityRevision:0,actionKey:'models',patch:{organizerModel:'local/luna',mainModel:'local/main',mainProviderId:'pi-main'}},owner);
 service.ingest({sourceIdentity:'chat',epoch:'one',expectedCheckpointRevision:0,nextCursor:'2',scopeRevision:1,capturedAt:at,coverage:{complete:true},events:[{id:'input',eventId:'input',cursor:'1',object:{kind:actor==='user'?'message':'operation',id:'input',revision:1},kind:actor==='user'?'message':'operation',scope:{},actor,origin:{rootId:'conversation'},occurredAt:at,receivedAt:at,scopeRevision:1,content:{text:actor==='user'?'请修复发送失败':'发送操作失败，错误 unavailable',truncated:false}},{id:'terminal',eventId:'terminal',cursor:'2',object:{kind:'execution',id:'conversation',revision:1},kind:'operation',scope:{},actor:'application',origin:{rootId:'conversation'},occurredAt:at,receivedAt:at,scopeRevision:1,content:{text:JSON.stringify({foregroundActive:false,pendingCommand:false,terminalConfirmed:true}),truncated:false}}]},RUNTIME_ACCESS);
 let runtime=new CoreRuntime(store,service,call,()=>identity,actions,()=>at);
 return {store,service,runs,get runtime(){return runtime;},restart(){runtime.close();runtime=new CoreRuntime(store,service,call,()=>identity,actions,()=>at);},advance(){at='2026-11-16T01:00:01.000Z';},finish(decision?:'defer'|'investigate',failed=false){
  const e=runtime.journal.outstanding()!,run=runs.at(-1)!;
  if(decision){const result=runtime.organizer.result({evidenceRefs:e.evidenceRefs,summary:'发送失败需要核对',decision},e.runId!);run.items=[{kind:'tool-result',payload:{type:'tool-result',value:{...identity,runId:e.runId,callId:'organized',target:{moduleId:identity.moduleId,tool:'organized'},status:'succeeded',outputState:'complete',output:{json:JSON.stringify(result)}}}}];}
  run.active=false;run.status=failed?'failed':'finished';
 },close(){runtime.close();actions.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('explicit user requests bypass organizer and use the configured main model',async()=>{
 const f=fixture('user');try{await f.runtime.tick();expect(f.runs).toHaveLength(1);expect(f.runtime.journal.outstanding()!.purpose).toBe('understand');expect(f.runs[0]!.args).toMatchObject({providerId:'pi-main',providerOptions:{model:'local/main'}});}finally{f.close();}
});
for(const audit of ['manual','daily'] as const)test(`deferred operations survive restart and return to main on ${audit} review`,async()=>{
 const f=fixture();try{
  await f.runtime.tick();expect(f.runs[0]!.args).toMatchObject({providerOptions:{model:'local/luna'},tools:[{moduleId:'mind',tool:'organized'}]});
  f.finish('defer');await f.runtime.tick();expect(f.runs).toHaveLength(1);f.restart();await f.runtime.tick();expect(f.runs).toHaveLength(1);
  if(audit==='daily')f.advance();await f.runtime.tick(audit==='manual');expect(f.runs).toHaveLength(2);expect(f.runtime.journal.outstanding()!.purpose).toBe('understand');expect(String(f.runs[1]!.args.prompt)).toContain('发送失败需要核对');
 }finally{f.close();}
});
for(const failed of [true,false])test(`organizer ${failed?'failure':'escalation'} routes original evidence to main without creating a pursuit`,async()=>{
 const f=fixture();try{await f.runtime.tick();f.finish(failed?undefined:'investigate',failed);await f.runtime.tick();expect(f.runs).toHaveLength(2);expect(f.runtime.journal.outstanding()!.purpose).toBe('understand');expect(f.store.read().pursuits).toEqual([]);}finally{f.close();}
});
test('organizer rejects invented source refs and wrong run; forgetting removes summaries and old prompt authority',async()=>{
 const f=fixture();try{await f.runtime.tick();const e=f.runtime.journal.outstanding()!;
  expect(()=>f.runtime.organizer.result({evidenceRefs:['invented'],summary:'fake',decision:'defer'},e.runId!)).toThrow('exact');
  expect(()=>f.runtime.organizer.result({evidenceRefs:e.evidenceRefs,summary:'fake',decision:'defer'},'other')).toThrow('Current');
  f.finish('defer');await f.runtime.tick();f.service.forget({actionKey:'forget',expectedVisibilityRevision:f.store.read().visibilityRevision,target:{kind:'evidence',id:e.evidenceRefs![0]!}},owner);f.runtime.cleanupWithdrawn();expect(f.runtime.organizer.rows()).toEqual([]);
 }finally{f.close();}
});

test('application reports retain real caller version, deduplicate stable events and never become user authority',async()=>{
 const {ingestApplicationOperation}=await import('./core-sources');const f=fixture();try{
  const caller={moduleId:'calendar',hash:'c'.repeat(40)},input={eventId:'failed-save',operation:'save',outcome:'failed',page:'/calendar'};
  expect(ingestApplicationOperation(f.store,f.service,caller,input)).toEqual({accepted:true,eventId:'failed-save'});
  ingestApplicationOperation(f.store,f.service,caller,input);
  const evidence=f.store.read().evidence.filter(e=>e.sourceIdentity==='application:calendar');expect(evidence).toHaveLength(1);expect(evidence[0]!.actor).toBe('application');expect(evidence[0]!.content?.text).toContain(caller.hash);
  expect(()=>ingestApplicationOperation(f.store,f.service,caller,{...input,outcome:'succeeded'})).toThrow('different');
  expect(()=>ingestApplicationOperation(f.store,f.service,caller,{...input,moduleId:'other'})).toThrow();expect(f.store.read().pursuits).toEqual([]);
  f.service.settings({expectedRevision:f.store.read().settings.revision,expectedVisibilityRevision:f.store.read().visibilityRevision,actionKey:'pause-learning',patch:{learningEnabled:false}},owner);
  expect(()=>ingestApplicationOperation(f.store,f.service,caller,{...input,eventId:'next'})).toThrow('paused');
 }finally{f.close();}
});

test('timed-out organizer waits for actual stop then falls back to main, never restarts the same triage',async()=>{
 const f=fixture();try{
  await f.runtime.tick();f.advance();await f.runtime.tick();expect(f.runs).toHaveLength(1);expect(f.runtime.journal.outstanding()!.stopRequested).toBe(true);expect(f.runtime.journal.outstanding()!.stopConfirmed).toBe(false);
  f.finish(undefined,true);await f.runtime.tick();expect(f.runs).toHaveLength(2);expect(f.runtime.journal.outstanding()!.purpose).toBe('understand');
 }finally{f.close();}
});
