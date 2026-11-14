import { strict as assert } from 'node:assert';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Drafts, Operations, uploadFiles } from './client-state';
import { Store } from './state';
import { submittedReceipts } from './delivery';
const wait = async (fn: () => boolean) => { for (let i=0;i<200;i++) { if(fn())return; await new Promise(r=>setTimeout(r,5)); } throw Error('DOM condition timeout'); };
export async function runDomChecks() {
  const window = new Window({ url:'http://localhost/chat-test' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window','document','HTMLElement','Element','Node','navigator','localStorage','innerHeight']) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?window:key==='innerHeight'?900:(window as any)[key]});
  }
  const directory=mkdtempSync(join(tmpdir(),'chat-dom-'));let destroy:any;
  let stopped=false,holdStop=false,releaseStop:any,loseMessage=true;
  const keys:any[]=[];const replies=new Map();let mindUpdates:any[]=[],observedReads=0;
  const store=new Store(join(directory,'data'),join(directory,'content'),async(t,a,o)=>{
    if(o?.mode==='async')throw Object.assign(Error('Agent is synchronous'),{code:'invalid'});
    if(t==='agent.providers')return {items:[{id:'pi',available:true,hash:'h',revision:'v',capabilities:{conversation:true,images:true}}]};
    if(t==='agent.read')return {run:{runId:'r',contextId:'ctx',status:stopped?'finished':'running',active:!stopped},items:[],ended:stopped,nextCursor:stopped?null:'1',interactions:[],transcript:[]};
    if(!replies.has(o.key)){if(t==='agent.stop')stopped=true;replies.set(o.key,t==='agent.run'?{runId:'r',contextId:'ctx',status:'running',active:true}:t==='agent.stop'?{runId:'r',contextId:'ctx',status:'finished',active:false,stopConfirmed:true}:{accepted:true});}
    return replies.get(o.key);
  });
  store.create('pi'); // Existing session: ordinary navigation no longer creates implicitly.
  const catalog={providers:[{id:'pi',name:'Pi',available:true}],configs:{pi:{models:[{value:'',label:'继承模型'}],thinking:['off','high']}},tools:[]};
  const call=async(name:string,a:any={})=>{
    let result:any;
    switch(name){
      case 'catalog':await new Promise(r=>setTimeout(r,30));result=catalog;break;
      case 'list':result={items:store.list()};break;
      case 'create':result=store.create('pi');break;
      case 'read':if(a.observe)observedReads++;result={...await store.reconcile(a.id,a.observe!==true),mindUpdates};break;
      case 'draft':result=store.draft(a.id,JSON.parse(a.patch),a.revision);break;
      case 'execute':keys.push(a);result=await store.operate(a.id,a.key,a.kind,JSON.parse(a.input));if(a.kind==='message'&&loseMessage){loseMessage=false;throw Error('accepted HTTP reply lost');}if(a.kind==='stop'&&holdStop)await new Promise(r=>releaseStop=r);break;
      default:throw Error('unexpected DOM tool '+name);
    }
    return {json:JSON.stringify(result)};
  };
  try {
    const {default:mount}=await import('./ui');
    const container=window.document.createElement('div');window.document.body.append(container);
    destroy=mount(container as any,{call});
    const q=(s:string)=>container.querySelector(s) as any;
    assert.equal(q('[data-action=settings]').disabled,true);
    q('[data-action=settings]').click();assert.equal(q('.chat-settings').open,false);
    await wait(()=>!q('textarea').disabled);
    assert.equal(q('.chat-send').disabled,true);assert.equal(q('.chat-badge').textContent,'可开始对话');
    const type=(value:string)=>{q('textarea').value=value;q('textarea').dispatchEvent(new window.Event('input',{bubbles:true}));};
    type('hello');q('.chat-send').click();await wait(()=>keys.length===1&&!q('.chat-stop').hidden&&!q('.chat-stop').disabled);
    type('supplement');q('.chat-send').click();await wait(()=>keys.some(x=>x.kind==='message'));
    await wait(()=>q('.chat-alert').textContent.includes('lost'));
    q('[data-action=refresh]').click();await wait(()=>keys.filter(x=>x.kind==='message').length===2);
    const sends=keys.filter(x=>x.kind==='message');assert.equal(sends[0].key,sends[1].key);assert.equal(sends[0].input,sends[1].input);
    holdStop=true;await wait(()=>!q('.chat-stop').disabled);q('.chat-stop').click();await wait(()=>!!releaseStop);
    type('new draft while stop reply is delayed');releaseStop();await wait(()=>q('.chat-stop').hidden);
    assert.equal(q('textarea').value,'new draft while stop reply is delayed');
    assert.equal(JSON.parse(window.localStorage.getItem('chat.draft.'+store.list()[0].id)!).text,'new draft while stop reply is delayed');
    const commandCount=keys.length;
    mindUpdates=[{id:'goal',status:'waiting',goal:'交付应用中心',waitReason:'缺少实际材料接口',nextStep:'任务负责人补齐后继续'}];
    q('[data-action=refresh]').click();await wait(()=>q('.chat-mind-updates').textContent.includes('缺少实际材料接口'));
    assert.equal(q('.chat-mind-updates').getAttribute('role'),'status');assert.equal(keys.length,commandCount);
    assert.equal(q('.chat-messages').textContent.includes('缺少实际材料接口'),false);
    mindUpdates=[];q('[data-action=refresh]').click();await wait(()=>q('.chat-mind-updates').hidden);
    const d=new Drafts(window.localStorage as any),ops=new Operations(window.localStorage as any);
    const idle=store.list()[0].id,unreceived=ops.begin(idle,'send',{},null),beforePoll=observedReads;
    await new Promise(r=>setTimeout(r,2200));
    assert.ok(observedReads>beforePoll);assert.equal(keys.length,commandCount);assert.equal(ops.read(idle)?.key,unreceived.key);
    ops.settle(idle,{operations:[{key:unreceived.key,status:'failed'}]},d);
    const old=d.edit('isolated','old'),op=ops.begin('isolated','message',{text:'old'},old.token);d.edit('isolated','new');
    ops.settle('isolated',{operations:[{key:op.key,status:'succeeded'}]},d);assert.equal(d.read('isolated').text,'new');
    let unblock:any;const uploaded:any[]=[];
    const file={name:'x.png',type:'image/png',size:1,arrayBuffer:()=>new Promise(r=>unblock=r)};
    const upload=uploadFiles('A',[file],async args=>{uploaded.push(args);return {};},()=>{});
    const current='B';unblock(new Uint8Array([1]).buffer);await upload;assert.equal(current,'B');assert.equal(uploaded[0].id,'A');
    const receipt={receiptId:'receipt',requestKey:'key',members:[{moduleId:'m',hash:'a'.repeat(40)}]};
    const found=submittedReceipts({messages:[{run:{transcript:[{kind:'result',tool:'m_author_submit',text:JSON.stringify({result:receipt}),error:false}]}}],deliveries:[]});assert.equal(found.length,1);
    const empty=store.create('pi');const blank=ops.begin(empty.id,'send',{},null);const rejected=await store.operate(empty.id,blank.key,'send',{});ops.settle(empty.id,rejected,d);assert.equal(ops.read(empty.id),null);
    return {checks:11,details:['initialization disabled','default Provider ready','real UI+Store synchronous send','same-key supplemental HTTP loss','late stop does not erase draft or recovery copy','acknowledged token only','upload origin fixed','actual m_author_submit receipt','native dialog controls']};
  }finally{
    destroy?.();store.close();rmSync(directory,{recursive:true,force:true});await window.happyDOM.close();
    for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];
  }
}
