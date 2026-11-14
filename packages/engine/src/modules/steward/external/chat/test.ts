import { strict as assert } from 'node:assert';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Author supplies the SDK test harness.
import { startModule } from 'chrona/testing';
import { runStateChecks } from './state-checks';
import { runDomChecks } from './dom-checks';
import { runRegistrationChecks } from './registration-checks';
import { runRaceChecks } from './race-checks';
import { runSelectionChecks } from './selection-checks';
import { runCreateChecks } from './create-checks';
assert.equal(await runStateChecks(),15);
assert.equal((await runDomChecks()).checks,11);
assert.equal((await runRaceChecks()).checks,7);
assert.equal((await runSelectionChecks()).checks,9);
assert.equal((await runCreateChecks()).checks,6);
assert.equal((await runRegistrationChecks()).component,'chat:Workbench');
const directory=await mkdtemp(join(tmpdir(),'chat-sdk-v2-'));
const oldData=process.env.CHRONA_DATA,oldContent=process.env.CHRONA_CONTENT;
process.env.CHRONA_DATA=join(directory,'data');process.env.CHRONA_CONTENT=join(directory,'content');
let stopped=false;
const run={runId:'sdk-run',contextId:'sdk-context',status:'running',active:true};
const m=await startModule('index.ts',{stubs:{
  'modules.list':()=>({items:[{id:'chat',name:'chat',activeHash:'fixture-hash'}],nextCursor:null}),
  'modules.describe':()=>({items:[{target:{moduleId:'chat',tool:'list'},description:'self'}],nextCursor:null}),
  'agent.providers':()=>({items:[{id:'pi',available:true,hash:'p',revision:'v',capabilities:{conversation:true,images:true}}],nextCursor:null}),
  'agent.run':(a:any,o:any)=>{assert.notEqual(o.mode,'async');assert.ok(o.key);assert.deepEqual(a.tools,[{moduleId:'chat',tool:'list'}]);return run;},
  'agent.stop':(_a:any,o:any)=>{assert.notEqual(o.mode,'async');stopped=true;return {...run,status:'finished',active:false,stopConfirmed:true};},
  'agent.read':()=>({run:{...run,status:stopped?'finished':'running',active:!stopped},items:[],nextCursor:stopped?null:'cursor',ended:stopped,interactions:[],transcript:[]}),
  'web.component-set':()=>({name:'Workbench',type:'chat:Workbench',revision:'fixture'}),
  'web.page-set':()=>({id:'main',catalog:'fixture'})
}});
const now=new Date().toISOString();
async function send(id:string,args:any={}){
  const reply=await m.send({trigger:{kind:'tool',id,args,caller:{kind:'owner',via:'test'},firedAt:now},now,params:{}});
  if(reply.error)throw Error(reply.error);
  return JSON.parse(reply.result.result.json);
}
try {
  let c=await send('create',{requestKey:'sdk-create'});const duplicate=await send('create',{requestKey:'sdk-create'});assert.equal(c.id,duplicate.id);assert.equal(c.settings.providerId,'pi');assert.deepEqual(c.settings.tools,[{moduleId:'chat',tool:'list'}]);
  c=await send('draft',{id:c.id,revision:0,patch:JSON.stringify({draft:'SDK hello'})});
  c=await send('execute',{id:c.id,key:'sdk-start',kind:'send',input:'{}'});assert.equal(c.active.runId,'sdk-run');
  await send('execute',{id:c.id,key:'sdk-start',kind:'send',input:'{}'});
  assert.equal(m.calls.filter((x:any)=>x.params.target==='agent.run').length,1);
  c=await send('execute',{id:c.id,key:'sdk-stop',kind:'stop',input:'{}'});assert.equal(c.active,null);assert.equal(c.messages.at(-1).run.stopConfirmed,true);
  assert.equal(m.calls.some((x:any)=>x.method==='callStatus'),false);
  const result=await m.send({trigger:{kind:'activated',id:'activated',firedAt:now},now,params:{}});assert.equal(result.error,undefined);
  console.log(JSON.stringify({stateChecks:15,domChecks:11,raceChecks:7,selectionChecks:9,createChecks:6,registration:'passed',sdk:'passed'}));
}finally{
  await m.stop();
  if(oldData===undefined)delete process.env.CHRONA_DATA;else process.env.CHRONA_DATA=oldData;
  if(oldContent===undefined)delete process.env.CHRONA_CONTENT;else process.env.CHRONA_CONTENT=oldContent;
  await rm(directory,{recursive:true,force:true});
}
