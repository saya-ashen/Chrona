import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreExecutionJournal,CoreExecutor,type CoreCall,type Execution} from './core-execution';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'mind-execution-'));const journal=new CoreExecutionJournal(dir);return {dir,journal,cleanup(){journal.close();rmSync(dir,{recursive:true,force:true});}};}
const input={purpose:'understand' as const,subject:'batch:1',revision:1,visibilityRevision:1,prompt:'Understand source evidence',tools:[{moduleId:'mind-id',tool:'progress'}]};
const now='2026-11-13T14:00:00.000Z';
test('lost reply and restart reconcile exact original run once, only complete real selected tool results settle',async()=>{
 const f=fixture();let runCalls=0;const keys:string[]=[];let settled:Execution|undefined;
 const call:CoreCall=async(target,args,options)=>{if(target==='agent.run'){runCalls++;keys.push(options!.key!);if(runCalls===1)throw Error('reply lost');return {runId:'r',contextId:'c',active:true,status:'running'};}
 if(target==='agent.read')return {run:{runId:'r',contextId:'c',active:false,status:'finished'},ended:true,nextCursor:null,interactions:[],items:[
 {kind:'tool-result',payload:{type:'tool-result',value:{runId:'other',callId:'forged',target:input.tools[0],moduleId:'mind-id',hash:'h',status:'succeeded',outputState:'complete',output:{receipt:'wrong'}}}},
 {at:now,kind:'tool-result',payload:{type:'tool-result',value:{runId:'r',callId:'yes',target:input.tools[0],moduleId:'mind-id',hash:'h',status:'succeeded',outputState:'complete',output:{receipt:'actual'}}}},
 ]};throw Error('Unexpected '+target);};
 try{f.journal.prepare(input,now);await new CoreExecutor(f.journal,call,{current:()=>true,settle:async e=>{settled=e;}}).reconcile(now);expect(f.journal.outstanding()?.status).toBe('unknown');
 await new CoreExecutor(f.journal,call,{current:()=>true,settle:async e=>{settled=structuredClone(e);}}).reconcile(now);expect(keys[0]).toBe(keys[1]);expect(settled?.facts.map(f=>f.callId)).toEqual(['yes']);expect(settled?.facts[0]?.at).toBe(now);expect(f.journal.outstanding()).toBeUndefined();}finally{f.cleanup();}
});
test('withdrawal before dispatch cancels without any Agent call; unknown stop keeps occupying concurrency',async()=>{
 const f=fixture();let calls=0;try{f.journal.prepare(input,now);const ex=new CoreExecutor(f.journal,async()=>{calls++;throw Error('not expected');},{current:()=>false,settle:async()=>{}});await ex.reconcile(now);expect(calls).toBe(0);expect(f.journal.outstanding()).toBeUndefined();
 f.journal.prepare(input,now);let current=true;const call:CoreCall=async t=>t==='agent.run'?{runId:'r',contextId:'c',status:'running',active:true}:t==='agent.stop'?{runId:'r',contextId:'c',status:'stopping',active:true,stopConfirmed:false}:{run:{runId:'r',contextId:'c',status:'running',active:true},ended:false,nextCursor:null,items:[],interactions:[]};
 const running=new CoreExecutor(f.journal,call,{current:()=>current,settle:async()=>{}});await running.reconcile(now);current=false;await running.reconcile(now);expect(f.journal.outstanding()?.stopRequested).toBe(true);expect(f.journal.outstanding()?.stopConfirmed).toBe(false);expect(()=>f.journal.prepare(input,now)).toThrow('Previous execution');}finally{f.cleanup();}
});
test('daily budget survives restart, unrelated admin targets rejected, queued wait does not consume activity timeout',async()=>{
 const f=fixture();try{let e=f.journal.prepare(input,now,1);e.settled=true;f.journal.save(e);expect(()=>f.journal.prepare(input,now,1)).toThrow('budget');expect(()=>f.journal.prepare({...input,tools:['approvals.resolve']},'2026-11-14T01:00:00Z')).toThrow('administration');
 e=f.journal.prepare(input,'2026-11-14T01:00:00Z');const ex=new CoreExecutor(f.journal,async t=>t==='agent.run'?{runId:'r',contextId:'c',active:true,status:'queued'}:{run:{runId:'r',contextId:'c',active:true,status:'queued'},items:[],ended:false,nextCursor:null,interactions:[]},{current:()=>true,settle:async()=>{}});await ex.reconcile('2026-11-15T01:00:00Z');expect(f.journal.outstanding()?.activityStartedAt).toBeNull();expect(f.journal.outstanding()?.stopRequested).toBe(false);}finally{f.cleanup();}
});
test('real called target identities retain selected Author and kernel facts while rejecting wrong run, self hash and target identity',async()=>{
 const f=fixture();let settled:Execution|undefined;
 const principal={moduleId:'mind-id',hash:'mind-hash'},author={moduleId:'author-id',hash:'author-hash'};
 const targets=[{moduleId:author.moduleId,tool:'stage'},'modules.admit',...input.tools];
 const result=(callId:string,target:typeof targets[number],moduleId:string,hash:string,runId='r')=>({kind:'tool-result',payload:{type:'tool-result',value:{runId,callId,target,moduleId,hash,status:'succeeded',outputState:'complete',output:{receipt:callId}}}});
 const call:CoreCall=async target=>target==='agent.run'?{runId:'r',contextId:'c',status:'running',active:true}:{run:{runId:'r',contextId:'c',status:'finished',active:false},ended:true,nextCursor:null,interactions:[],items:[
  result('stage',targets[0]!,author.moduleId,author.hash),result('admission','modules.admit','system:modules','kernel-contract-hash'),
  result('self',input.tools[0]!,principal.moduleId,principal.hash),result('wrong-run',targets[0]!,author.moduleId,author.hash,'other'),
  result('wrong-object',targets[0]!,principal.moduleId,principal.hash),result('wrong-system','modules.admit','system:agent','contract'),
  result('wrong-self-hash',input.tools[0]!,principal.moduleId,'stale'),result('unselected',{moduleId:'other',tool:'read'},'other','hash'),
 ]};
 try{f.journal.prepare({...input,tools:targets,principal},now);await new CoreExecutor(f.journal,call,{current:()=>true,settle:async e=>{settled=structuredClone(e);}}).reconcile(now);expect(settled?.facts.map(x=>x.callId)).toEqual(['stage','admission','self']);expect(settled?.principal).toEqual(principal);expect(f.journal.outstanding()).toBeUndefined();}finally{f.cleanup();}
});

test('visibility withdrawn after a terminal read settles from actual stopped evidence without an extra stop',async()=>{
 const f=fixture();let current=true,stops=0,settlements=0;
 const call:CoreCall=async target=>{
  if(target==='agent.run')return {runId:'r',contextId:'c',status:'running',active:true};
  if(target==='agent.stop'){stops++;return {runId:'r',contextId:'c',status:'finished',active:false,stopConfirmed:true};}
  if(target==='agent.read'){current=false;return {run:{runId:'r',contextId:'c',status:'finished',active:false},ended:true,nextCursor:null,items:[]};}
  throw Error('Unexpected call');
 };
 try{
  f.journal.prepare(input,now);const ex=new CoreExecutor(f.journal,call,{current:()=>current,settle:async()=>{settlements++;}});
  await ex.reconcile(now);expect(stops).toBe(0);expect(settlements).toBe(1);expect(f.journal.outstanding()).toBeUndefined();
 }finally{f.cleanup();}
});

for(const purpose of ['organize','opportunity','pursuit'] as const)test(`${purpose} uses its bounded active window and retains occupancy until a confirmed terminal observation`,async()=>{
 const f=fixture();let active=true,stops=0,settlements=0;try{
  const call:CoreCall=async target=>{
   if(target==='agent.run')return {runId:'r',contextId:'c',status:'running',active:true};
   if(target==='agent.stop'){stops++;return {runId:'r',contextId:'c',status:active?'stopping':'cancelled',active,stopConfirmed:!active};}
   return {run:{runId:'r',contextId:'c',status:active?'running':'cancelled',active},items:[],ended:!active,nextCursor:null};
  };
  f.journal.prepare({...input,purpose},now);const ex=new CoreExecutor(f.journal,call,{current:()=>true,settle:async()=>{settlements++;}});
  await ex.reconcile(now);await ex.reconcile('2026-11-13T14:03:01.000Z');
  expect(stops).toBe(purpose==='organize'?1:0);expect(f.journal.outstanding()).toBeDefined();expect(settlements).toBe(0);
  await ex.reconcile('2026-11-13T14:10:01.000Z');expect(stops).toBeGreaterThan(0);
  expect(f.journal.outstanding()?.stopConfirmed).toBe(false);expect(()=>f.journal.prepare({...input,purpose},now)).toThrow('Previous execution');
  active=false;await ex.reconcile('2026-11-13T14:10:02.000Z');expect(settlements).toBe(1);expect(f.journal.outstanding()).toBeUndefined();
 }finally{f.cleanup();}
});
