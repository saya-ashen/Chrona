import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoreMindStore,evidenceId} from './core-store';
import {CoreMindService} from './core-service';
import {CoreActions} from './core-actions';
import {CoreTaskView,taskGoal,taskOwnerAccess,taskTitle} from './core-task-view';
import type {CoreAccess} from './core-types';
import {CoreExecutionJournal,type CoreCall,type Execution} from './core-execution';
import {CoreDelivery,type DeliveryPrepare} from './core-delivery';
const owner:CoreAccess={subject:'owner:test',role:'owner',scopes:[{}]};
const worker:CoreAccess={subject:'mind',role:'runtime',scopes:[{}],execution:{actor:'mind',runRef:'run-1'}};
const at='2026-11-15T10:00:00.000Z';

test('task owner routes require trusted owner/Web or actual bound Chat callback path',()=>{
 const deps={web:'web-id',chat:'chat-id'};
 expect(taskOwnerAccess({kind:'owner'},[],deps).role).toBe('owner');
 expect(taskOwnerAccess({kind:'module',moduleId:'web-id'},['web'],deps).role).toBe('owner');
 expect(taskOwnerAccess({kind:'module',moduleId:'chat-id'},['web','chat'],deps).role).toBe('owner');
 for(const [caller,chain] of [
  [{kind:'module',module:'chat',moduleId:'impostor'},['web','chat']],
  [{kind:'module',moduleId:'chat-id'},['chat']],
  [{kind:'module',moduleId:'chat-id'},['web','agent','chat']],
  [{kind:'provider'},['web','chat']],[undefined,['web','chat']],
 ] as const) expect(()=>taskOwnerAccess(caller,[...chain],deps)).toThrow('owner Web callback');
});

test('live list/detail/artifacts survive refresh, use original conversation and one pursuit across three runs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mind-task-view-'));let store=new CoreMindStore(dir),service=new CoreMindService(store),actions=new CoreActions(dir,service);
 try{
  service.ingest({sourceIdentity:'chat-id',epoch:'epoch',expectedCheckpointRevision:0,nextCursor:'1',scopeRevision:1,capturedAt:at,coverage:{complete:true},events:[{
   id:'message',eventId:'message',cursor:'1',object:{kind:'message',id:'message',revision:1},kind:'message',scope:{},actor:'user',origin:{rootId:'original-conversation'},occurredAt:at,receivedAt:at,scopeRevision:1,content:{text:'整理研究资料',truncated:false}
  }]},worker);
  const p=service.pursue({actionKey:'create-chat-task',expectedVisibilityRevision:0,expectedRevision:0,goal:'整理研究资料',completionCriteria:['文档可读'],semanticKey:'research',scope:{},reason:'explicit-goal',evidenceRefs:[evidenceId('chat-id','epoch','message')]},owner).value!;
  const page=service.pursue({actionKey:'create-page-task',expectedVisibilityRevision:0,expectedRevision:0,goal:`改进应用中心：改善布局\n反馈对应版本：${'a'.repeat(64)}；应用：apps；页面：/p/apps/available`,completionCriteria:['用户验收'],semanticKey:'page',scope:{},reason:'explicit-goal',evidenceRefs:[]},owner).value!;
  const claimed=service.claim({actionKey:'claim',expectedVisibilityRevision:0,pursuitId:p.id,expectedRevision:p.revision},worker).value!;
  const document=actions.create({actionKey:'document',expectedVisibilityRevision:0,pursuitId:p.id,expectedRevision:claimed.revision,target:'document',arguments:{},document:{title:'研究资料',body:'可读的任务产物'}},worker);
  store.update(tx=>{const task=tx.get('pursuit',p.id)!;task.status='waiting';task.waitFor='user';task.waitReason='请确认研究资料是否符合要求';task.nextStep='根据验收反馈继续修改';task.artifactRefs=[document.ref];delete task.currentActor;task.updatedAt='2026-11-15T11:00:00.000Z';tx.put('pursuit',task);});
  const runs:Execution[]=[1,2,3].map(i=>({
   id:'execution-'+i,purpose:'pursuit',subject:p.id,runId:'run-'+i,status:'finished',terminalStatus:'finished',
   revision:p.revision,visibilityRevision:0,key:'run-key-'+i,args:{},tools:[],activityStartedAt:null,contextId:null,cursor:null,
   ended:true,active:false,stopRequested:false,stopConfirmed:true,stopKey:'stop-'+i,error:null,interactions:[],settled:true,
   facts:[],summary:i===3?'已生成资料，等待用户验收':'阶段调查',createdAt:`2026-11-15T10:0${i}:00.000Z`
  }));
  runs[2]!.facts=[{runId:'run-3',callId:'stage-call',target:{moduleId:'author-id',tool:'stage'},moduleId:'author-id',hash:'author-hash',status:'succeeded',outputState:'complete',at:'2026-11-15T12:00:00.000Z'}];
  const view=()=>new CoreTaskView(store,service,actions,()=>runs,()=> 'chat-id');
  const list=view().view({},owner) as any;
  expect(list.items).toHaveLength(2);expect(list.items.filter((t:any)=>t.id===p.id)).toHaveLength(1);
  const detail=view().view({id:p.id},owner) as any;
  expect(detail.conversationId).toBe('original-conversation');expect(detail.status).toBe('waiting');expect(detail.waitFor).toBe('user');expect(detail.summary).toContain('等待用户验收');expect(detail.details.runs).toHaveLength(3);expect(detail.artifacts[0].title).toBe('研究资料');expect(detail.operations.some((op:any)=>op.operation==='生成文档')).toBe(true);expect(detail.operations).toContainEqual({operation:'准备交付材料',status:'succeeded',at:'2026-11-15T12:00:00.000Z'});expect(detail.lastActivity>= '2026-11-15T12:00:00.000Z').toBe(true);
  expect((view().view({id:p.id,artifactRef:document.ref},owner) as any).body).toBe('可读的任务产物');
  expect(()=>view().view({id:page.id,artifactRef:document.ref},owner)).toThrow('does not belong');
  expect((view().view({id:page.id},owner) as any).conversationId).toBeUndefined();expect((view().view({id:page.id},owner) as any).title).toBe('改进应用中心：改善布局');expect((view().view({id:page.id},owner) as any).goal).not.toContain('反馈对应版本');
  actions.close();store.close();store=new CoreMindStore(dir);service=new CoreMindService(store);actions=new CoreActions(dir,service);
  expect((view().view({id:p.id},owner) as any).conversationId).toBe('original-conversation');expect((view().view({},owner) as any).items.map((t:any)=>t.id).sort()).toEqual([p.id,page.id].sort());
  for(const module of ['web','chat'] as const){
   const deps={web:'web-id',chat:'chat-id'},chain=module==='chat'?['web','chat']:['web'];
   const before=view().view({id:page.id},owner) as any;
   const input={id:page.id,operation:'supplement' as const,expectedRevision:before.revision,expectedVisibilityRevision:before.visibilityRevision,actionKey:'page-supplement-'+module,text:'保留搜索 '+module,goal:before.details.goal};
   const access=(hash:string)=>taskOwnerAccess({kind:'module',moduleId:deps[module],hash},chain,deps);
   const result=view().control(input,access('old-hash'));
   expect(view().control(input,access('new-hash'))).toEqual(result);
   const updated=view().view({id:page.id},owner) as any;
   expect(updated.goal).toContain('保留搜索 '+module);
   expect(updated.goal).not.toContain('反馈对应版本');
   expect(updated.details.goal).toContain('反馈对应版本');
   expect(updated.goal.match(new RegExp('保留搜索 '+module,'g'))).toHaveLength(1);
  }
  for(const operation of ['supplement','pause','resume'] as const){
   const before=view().view({id:p.id},owner) as any;
   const input={id:p.id,operation,expectedRevision:before.revision,expectedVisibilityRevision:before.visibilityRevision,actionKey:'control-'+operation,...(operation==='supplement'?{text:'增加来源链接',goal:before.details.goal}:{})};
   const result=view().control(input,owner);expect(view().control(input,owner)).toEqual(result);
   expect((view().view({},owner) as any).items).toHaveLength(2);
  }
  const final=view().view({id:p.id},owner) as any;expect(final.id).toBe(p.id);expect(final.goal.match(/增加来源链接/g)).toHaveLength(1);expect(final.conversationId).toBe('original-conversation');expect(runs).toHaveLength(3);
  expect(()=>view().view({}, {subject:'module',role:'application',scopes:[{}]})).toThrow('owner');
 }finally{actions.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('display keeps readable goal and technical feedback in details only',()=>{
 const raw=`改进应用中心：改善布局\n反馈对应版本：${'b'.repeat(64)}；应用：apps；页面：/p/apps/available`;
 expect(taskTitle(raw)).toBe('改进应用中心：改善布局');expect(taskGoal(raw)).toBe('改进应用中心：改善布局');
});

test('opportunity runs expose Author work and actual delivery state without completing the goal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mind-task-delivery-'));
 const store=new CoreMindStore(dir),service=new CoreMindService(store),actions=new CoreActions(dir,service),journal=new CoreExecutionJournal(dir);
 const author={moduleId:'author-id',hash:'a'.repeat(40)},principal={moduleId:'mind-id',hash:'b'.repeat(40)};
 let now='2099-01-01T10:00:00.000Z';
 const receipt={receiptId:'receipt',admissionId:'admission',requestKey:'request',submitter:author,state:'pending_approval',approvalId:'approval',members:[{name:'calendar',moduleId:'calendar-id',hash:'c'.repeat(40),versionId:'version',expectedActiveHash:null,materialDigest:'d'.repeat(64),status:'pending_review',selected:false}]};
 const call:CoreCall=async target=>{
  if(target==='modules.list')return {items:[{id:author.moduleId,name:'author',status:'active',activeHash:author.hash}],nextCursor:null};
  if(typeof target==='object'&&target.tool==='submit')return receipt;
  if(target==='modules.receipt')return receipt;
  throw Error('Unexpected call');
 };
 const delivery=new CoreDelivery(dir,service,call,{worker:runRef=>journal.all().find(e=>e.runId===runRef),verifyAdmission:async()=>{},now:()=>now});
 try{
  const p=service.pursue({actionKey:'pursue',expectedVisibilityRevision:0,expectedRevision:0,scope:{},semanticKey:'opportunity',goal:'改善日历体验',completionCriteria:['用户确认日历体验'],reason:'explicit-goal',evidenceRefs:[]},owner).value!;
  const e=journal.prepare({purpose:'opportunity',subject:p.id,revision:p.revision,visibilityRevision:0,prompt:'Improve calendar',tools:[{moduleId:author.moduleId,tool:'stage'}],principal},'2099-01-01T08:00:00.000Z');
  e.runId='opportunity-run';e.status='running';e.active=true;
  const workerAccess:CoreAccess={...worker,execution:{actor:'mind',runRef:e.runId}};
  const claimed=service.claim({actionKey:'claim',pursuitId:p.id,expectedRevision:p.revision,expectedVisibilityRevision:0},workerAccess).value!;
  e.revision=claimed.revision;journal.save(e);
  const input:DeliveryPrepare={pursuitId:p.id,expectedRevision:claimed.revision,expectedVisibilityRevision:0,actionKey:'prepare',author,admissionId:'admission',requestKey:'request',items:[{name:'calendar',dir:'packages/calendar/source',intent:{changes:['Improve calendar'],preserves:[]},materialDigest:'d'.repeat(64)}],criteria:['User confirms result']};
  const prepared=await delivery.prepare(input,workerAccess);
  const view=()=>new CoreTaskView(store,service,actions,()=>journal.all(),{chatIdentity:()=> 'chat-id',deliveries:delivery});
  e.status='settling';e.ended=true;e.active=false;e.terminalStatus='finished';
  e.facts=['write','read','prepare','stage','unmapped-tool','progress','action'].map((tool,i)=>({runId:e.runId!,callId:'call-'+i,target:{moduleId:author.moduleId,tool},moduleId:author.moduleId,hash:author.hash,status:'succeeded',outputState:'complete',at:`2099-01-01T09:0${i}:00.000Z`,...(tool==='stage'?{output:{name:'calendar',dir:input.items[0]!.dir,materialDigest:'d'.repeat(64)}}:{})}));
  journal.save(e);expect(await delivery.capture(e)).toBe(1);
  let detail=view().view({id:p.id},owner) as any;
  expect(detail.details.runs).toHaveLength(1);
  for(const operation of ['修改应用文件','读取应用文件','准备开发材料','准备交付材料'])expect(detail.operations.some((op:any)=>op.operation===operation)).toBe(true);
  expect(detail.details.deliveries[0]).toMatchObject({id:prepared.id,status:'coordinator-ready',needsDecision:true,updatedAt:now});
  expect(detail.operations).toContainEqual({operation:'处理应用交付',status:'coordinator-ready',at:now,observation:'stage proven; waiting for independent owner admission verification',needsDecision:true});
  expect(detail.lastActivity).toBe(now);
  now='2099-01-01T11:00:00.000Z';await delivery.submit(prepared.id,owner);
  detail=view().view({id:p.id},owner) as any;
  expect(detail.details.deliveries[0]).toMatchObject({status:'submitted',observation:'pending approval',needsDecision:true});
  expect(detail.operations.at(-1)).toMatchObject({status:'submitted',observation:'pending approval',at:now,needsDecision:true});
  expect(detail.lastActivity).toBe(now);expect(detail.status).not.toBe('done');
  receipt.state='submitted';receipt.members[0]!.status='testing';now='2099-01-01T12:00:00.000Z';
  await delivery.reconcile(prepared.id,owner);
  expect((view().view({id:p.id},owner) as any).details.deliveries[0]).toMatchObject({observation:'pending checks',needsDecision:false,updatedAt:now});
  // Unmapped facts and bookkeeping calls still count as real activity.
  for(const tool of ['unmapped-tool','progress','action']){
   e.facts.find(f=>typeof f.target==='object'&&f.target.tool===tool)!.at='2099-01-01T13:00:00.000Z';journal.save(e);
   expect((view().view({id:p.id},owner) as any).lastActivity).toBe('2099-01-01T13:00:00.000Z');
   e.facts.find(f=>typeof f.target==='object'&&f.target.tool===tool)!.at='2099-01-01T09:00:00.000Z';
  }
 }finally{delivery.close();journal.close();actions.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('conversation association follows evidence ref order and excludes withdrawn or expired evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mind-task-origin-'));
 const store=new CoreMindStore(dir),service=new CoreMindService(store),actions=new CoreActions(dir,service);
 try{
  service.ingest({sourceIdentity:'chat-id',epoch:'epoch',expectedCheckpointRevision:0,nextCursor:'2',scopeRevision:1,capturedAt:at,coverage:{complete:true},events:['original','merged'].map((id,i)=>({id,eventId:id,cursor:String(i+1),object:{kind:'message',id,revision:1},kind:'message' as const,scope:{},actor:'user' as const,origin:{rootId:id+'-conversation'},occurredAt:at,receivedAt:at,scopeRevision:1,content:{text:'整理资料',truncated:false}}))},worker);
  const refs=['original','merged'].map(id=>evidenceId('chat-id','epoch',id));
  const p=service.pursue({actionKey:'task',expectedRevision:0,expectedVisibilityRevision:0,goal:'整理资料',completionCriteria:['文档可读'],semanticKey:'origins',scope:{},reason:'explicit-goal',evidenceRefs:refs.slice(0,1)},owner).value!;
  store.update(tx=>{
   const merged=tx.get('evidence',refs[1]!)!;merged.createdAt='2020-01-01T00:00:00.000Z';tx.put('evidence',merged);
   const task=tx.get('pursuit',p.id)!;task.evidenceRefs.push(refs[1]!);tx.put('pursuit',task);
  });
  const view=()=>new CoreTaskView(store,service,actions,()=>[],()=> 'chat-id');
  expect((view().view({id:p.id},owner) as any).conversationId).toBe('original-conversation');
  store.update(tx=>{const original=tx.get('evidence',refs[0]!)!;original.retractedAt=at;tx.put('evidence',original);});
  expect((view().view({id:p.id},owner) as any).conversationId).toBe('merged-conversation');
  store.update(tx=>{const merged=tx.get('evidence',refs[1]!)!;merged.expiredAt=at;tx.put('evidence',merged);});
  expect((view().view({id:p.id},owner) as any).conversationId).toBeUndefined();
 }finally{actions.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test.each(['[Application feedback context]','[应用反馈上下文]','反馈元数据：','pageId: /calendar'])('supplements after %s remain readable',marker=>{
 const raw=`改善日历\n${marker}\nmoduleId: calendar-id\nactiveHash: secret-hash\n\n补充要求：\n保留搜索\n\n补充要求：\n支持键盘导航`;
 expect(taskGoal(raw)).toBe('改善日历\n\n补充要求：\n保留搜索\n\n补充要求：\n支持键盘导航');
});
