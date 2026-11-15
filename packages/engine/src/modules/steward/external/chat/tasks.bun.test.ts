import {expect,test} from 'bun:test';
import {Window} from 'happy-dom';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoreMindStore,evidenceId} from '../mind/core-store';
import {CoreMindService} from '../mind/core-service';
import {CoreActions} from '../mind/core-actions';
import {CoreTaskView,taskOwnerAccess} from '../mind/core-task-view';
import {mindTaskCall} from './mind-tasks';
const wait=async(check:()=>boolean)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Task UI condition timeout');};

test('Chat task proxy rejects ordinary modules and keeps missing Mind errors understandable',async()=>{
 const deps={web:'web-id',mind:'mind-id'};let called=false;
 const call=async()=>{called=true;return {json:'{"items":[]}'}};
 await expect(mindTaskCall(call,deps,{kind:'module',moduleId:'agent-id'},'task-view',{})).rejects.toThrow('Web');expect(called).toBe(false);
 await expect(mindTaskCall(call,{web:'web-id'},{kind:'module',moduleId:'web-id'},'task-view',{})).rejects.toThrow('普通对话仍可使用');
 expect(await mindTaskCall(call,deps,{kind:'module',moduleId:'web-id'},'task-view',{})).toEqual({items:[]});
});

test('mounted list/detail/actions refresh and lost-reply retry keep same task and original conversation',async()=>{
 const window=new Window({url:'http://localhost/chat-task-test'}),previous=new Map<string,PropertyDescriptor|undefined>();
 for(const key of ['window','document','HTMLElement','Element','Node','navigator','localStorage','innerHeight']){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?window:key==='innerHeight'?900:(window as any)[key]});}
 const directory=mkdtempSync(join(tmpdir(),'chat-tasks-')),store=new CoreMindStore(directory),service=new CoreMindService(store),actions=new CoreActions(directory,service);
 const owner={subject:'owner',role:'owner' as const,scopes:[{}]},runtime={subject:'runtime',role:'runtime' as const,scopes:[{}]};
 let destroy:(()=>void)|undefined;const logs:string[]=[],original=console.error;console.error=(line:string)=>logs.push(line);
 try{
  const at='2026-11-15T10:00:00.000Z';
  service.ingest({sourceIdentity:'chat-id',epoch:'e',expectedCheckpointRevision:0,nextCursor:'1',scopeRevision:1,capturedAt:at,coverage:{complete:true},events:[{id:'m',eventId:'m',cursor:'1',object:{kind:'message',id:'m',revision:1},kind:'message',scope:{},actor:'user',origin:{rootId:'original'},occurredAt:at,receivedAt:at,scopeRevision:1,content:{text:'请跟进研究',truncated:false}}]},runtime);
  const make=(key:string,goal:string,evidenceRefs:string[])=>service.pursue({actionKey:key,expectedVisibilityRevision:0,expectedRevision:0,semanticKey:key,goal,completionCriteria:['用户验收'],scope:{},reason:'explicit-goal',evidenceRefs},owner).value!;
  const chat=make('chat','继续整理研究资料',[evidenceId('chat-id','e','m')]),page=make('page','改进应用列表\n反馈对应版本：'+'a'.repeat(64),[]);
  store.update(tx=>{const p=tx.get('pursuit',page.id)!;p.status='waiting';p.waitFor='user';p.waitReason='等待浏览器验收反馈';p.nextStep='收到反馈后继续改进';tx.put('pursuit',p);});
  const view=new CoreTaskView(store,service,actions,()=>[],()=> 'chat-id');
  const records=['other','original'].map(id=>({id,title:id==='original'?'原来的研究对话':'普通对话',draft:'',revision:0,settings:{providerId:'pi',tools:[]},messages:[{role:'user',text:id==='original'?'原始请求仍在这里':'随时可以聊天',attachments:[]}],operations:[],attachments:[],deliveries:[]}));
  const calls:any[]=[],controls:any[]=[];let loseReply=false,missing=false,readFailure=false,rejectCode:string|undefined;
  const call=async(name:string,args:any={})=>{
   calls.push({name,args});let result:any;
   if(name==='task-view'||name==='task-control'){
    if(missing)throw Error('Mind 尚未安装，普通对话仍可使用');
    result=await mindTaskCall(async(target,input)=>{
     const who=taskOwnerAccess({kind:'module',moduleId:'chat-id'},['web','chat'],{web:'web-id',chat:'chat-id'});
     if(target.tool==='task-view')return {json:JSON.stringify(view.view(input,who))};
     if(rejectCode){const code=rejectCode;rejectCode=undefined;return {json:JSON.stringify({error:{code,message:'任务版本已改变'}})};}
     controls.push(JSON.parse(input.input as string));const value=view.control(controls.at(-1),who);
     if(loseReply){loseReply=false;throw Error('连接中断，结果未知');}
     return {json:JSON.stringify(value)};
    },{web:'web-id',mind:'mind-id'},{kind:'module',moduleId:'web-id'},name,args);
   }else if(name==='catalog')result={providers:[{id:'pi',name:'Pi',available:true}],configs:{},tools:[]};
   else if(name==='list')result={items:records};else if(name==='read'){if(readFailure&&args.id==='original')throw Error('原对话已不可用');result=records.find(c=>c.id===args.id);}else throw Error('Unexpected tool '+name);
   return {json:JSON.stringify(result)};
  };
  const {default:mount}=await import('./ui');const host=window.document.createElement('div');window.document.body.append(host);
  const q=(s:string)=>host.querySelector(s) as any;
  destroy=mount(host as any,{call});await wait(()=>host.querySelectorAll('[data-task-id]').length===2);
  q(`[data-task-id="${page.id}"]`).click();await wait(()=>q('.chat-task-overview').textContent.includes('等待你反馈'));
  expect(q('.chat-task-overview').textContent).toContain('等待浏览器验收反馈');expect(q('.chat-task-overview').textContent).toContain('收到反馈后继续改进');expect(q('.chat-workbench').classList.contains('chat-task-only')).toBe(true);
  q('[aria-label="补充任务要求"]').value='请保留筛选条件';loseReply=true;
  q('.chat-task-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>q('.chat-task-notice').textContent.includes('操作未确认'));
  expect(controls).toHaveLength(1);const first=controls[0];destroy();destroy=mount(host as any,{call});await wait(()=>q('.chat-task-retry')?.hidden===false);
  q('.chat-task-retry').click();await wait(()=>controls.length===2&&q('.chat-task-notice').textContent.includes('已记录'));
  expect(controls[1]).toEqual(first);expect(store.read().pursuits.find(p=>p.id===page.id)!.goal.match(/请保留筛选条件/g)).toHaveLength(1);
  q('.chat-task-pause').click();await wait(()=>q('.chat-task-status').textContent.includes('已暂停'));
  q('.chat-task-resume').click();await wait(()=>!q('.chat-task-status').textContent.includes('已暂停'));
  for(const code of ['conflict','CONFLICT']){
   rejectCode=code;q('.chat-task-pause').click();await wait(()=>q('.chat-task-notice').textContent.includes('请刷新任务后重试')&&!q('.chat-task-pause').disabled);
   expect(q('.chat-task-retry').hidden).toBe(true);expect(q('[aria-label="补充任务要求"]').disabled).toBe(false);
   q('.chat-tasks-refresh').click();await wait(()=>!q('.chat-task-pause').disabled);
  }
  q('.chat-tasks-refresh').click();await wait(()=>host.querySelectorAll('[data-task-id]').length===2);
  q(`[data-task-id="${chat.id}"]`).click();await wait(()=>q('.chat-workbench').classList.contains('chat-task-only')===false);
  expect(q('.chat-messages').textContent).toContain('原始请求仍在这里');expect(new URL(window.location.href).searchParams.get('conversation')).toBe('original');expect(q('.chat-workbench').classList.contains('chat-task-only')).toBe(false);
  expect(calls.filter(c=>['create','execute'].includes(c.name))).toHaveLength(0);expect(store.read().pursuits).toHaveLength(2);
  q('.chat-task-close').click();expect(q('.chat-task-panel').hidden).toBe(true);expect(q('.chat-toolbar h1').textContent).toBe('原来的研究对话');
  readFailure=true;q(`[data-task-id="${chat.id}"]`).click();await wait(()=>q('.chat-task-notice').textContent.includes('原对话暂时无法读取'));
  expect(q('.chat-task-overview').textContent).toContain('继续整理研究资料');expect(q('.chat-workbench').classList.contains('chat-task-only')).toBe(true);
  expect(q('[aria-label="补充任务要求"]').disabled).toBe(false);q('.chat-tasks-refresh').click();
  await wait(()=>q('.chat-task-overview').textContent.includes('继续整理研究资料'));expect(q('.chat-workbench').classList.contains('chat-task-only')).toBe(true);
  q('.chat-task-close').click();await wait(()=>!q('.chat-tasks-refresh').disabled);
  missing=true;q('.chat-tasks-refresh').click();await wait(()=>q('.chat-task-load').textContent.includes('普通对话仍可使用'));
  expect(q('.chat-compose>textarea').disabled).toBe(false);expect(q('.chat-alert').hidden).toBe(true);
 }finally{destroy?.();console.error=original;actions.close();store.close();rmSync(directory,{recursive:true,force:true});await window.happyDOM.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete(globalThis as any)[key];}}
});
