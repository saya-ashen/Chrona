import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Observations} from './external/chat/observations';
import {readMindUpdates} from './external/chat/mind-updates';
import {CoreMindStore,evidenceId} from './external/mind/core-store';
import {CoreMindService} from './external/mind/core-service';
import type {CoreAccess} from './external/mind/core-types';

const owner:CoreAccess={subject:'owner',role:'owner',scopes:[{}]};
const runtime:CoreAccess={subject:'source',role:'runtime',scopes:[{}]};
test.each(['enabled','private','excluded'] as const)('withdrawal and reauthorization hide stale original-conversation status before source sync: %s',async kind=>{
 const directory=mkdtempSync(join(tmpdir(),'chat-mind-updates-')),mind=new CoreMindStore(directory),db=new Database(':memory:');
 try{
  db.run('CREATE TABLE conversations(id TEXT PRIMARY KEY)');db.run("INSERT INTO conversations VALUES ('conversation'),('other')");
  const observations=new Observations(db,()=>({moduleId:'chat-id',hash:'chat-hash'})),service=new CoreMindService(mind);
  observations.scopeTool({enabled:true,expectedRevision:0});
  const source=()=>{const m=observations.scopeTool();return {epoch:m.epoch as string,scopeRevision:m.revision as number};};
  const ingest=(id:string)=>{
   const current=source(),cp=mind.inspect(tx=>tx.get('checkpoint','chat-id'));
   service.ingest({sourceIdentity:'chat-id',epoch:current.epoch,scopeRevision:current.scopeRevision,expectedCheckpointRevision:cp?.revision??0,nextCursor:id,capturedAt:new Date().toISOString(),coverage:{complete:true},events:[{id,eventId:id,cursor:id,object:{kind:'message',id,revision:1},kind:'message',scope:{},actor:'user',origin:{rootId:'conversation'},occurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),scopeRevision:current.scopeRevision,content:{text:id,truncated:false}}]},runtime);
   service.pursue({actionKey:id,expectedRevision:0,expectedVisibilityRevision:mind.inspect(tx=>tx.meta().visibilityRevision),semanticKey:id,goal:id,completionCriteria:['实际交付'],scope:{},reason:'explicit-goal',evidenceRefs:[evidenceId('chat-id',current.epoch,id)]},owner);
  };
  const read=async(onRead?:()=>void)=>{
   if(!observations.admission('conversation'))return [];
   const before=source();
   const items=await readMindUpdates(async(_target,args)=>{
    const result=service.conversationUpdates('chat-id','conversation',owner,{epoch:args.epoch as string,scopeRevision:args.scopeRevision as number});
    onRead?.();return {json:JSON.stringify(result)};
   },'mind-id','conversation',before);
   const after=source();return after.epoch===before.epoch&&after.scopeRevision===before.scopeRevision?items:[];
  };
  ingest('withdrawn marker');expect((await read()).map(p=>p.goal)).toEqual(['withdrawn marker']);
  const scope=(enabled:boolean)=>observations.scopeTool({expectedRevision:observations.scopeTool().revision,...(kind==='enabled'?{enabled}:{conversationId:'conversation',[kind]:!enabled})});
  scope(false);expect(await read()).toEqual([]);
  scope(true);expect(await read()).toEqual([]);
  ingest('fresh marker');expect((await read()).map(p=>p.goal)).toEqual(['fresh marker']);
  expect(await read(()=>observations.scopeTool({conversationId:'other',private:true,expectedRevision:observations.scopeTool().revision}))).toEqual([]);
 }finally{db.close();mind.close();rmSync(directory,{recursive:true,force:true});}
});
