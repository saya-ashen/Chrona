import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { Store } from './state';
import { discoverTools, defaultTools, validateTools } from './tool-selection';
export async function runSelectionChecks() {
 const entries: any[]=Array.from({length:101},(_,i)=>({target:{moduleId:'chat',tool:'tool'+i},description:'fixture'}));
 entries[0]={target:'modules.describe',description:'system discovery'};
 entries[1]={target:'modules.admit',description:'system admission'};
 entries[2]={target:'agent.providers',description:'system providers'};
 const calls:any[]=[];
 const found=await discoverTools(async(t:string,a:any)=>{
  calls.push({t,a}); if(t==='modules.list')return {items:[{id:'chat',name:'chat'}],nextCursor:null};
  return a.cursor ? {items:[entries[0],...entries.slice(60)],nextCursor:null} : {items:entries.slice(0,60),nextCursor:'second'};
 });
 assert.equal(found.length,101); assert.throws(()=>defaultTools(found),/最多.*100/);
 const targets=defaultTools(found.slice(0,70)); assert.equal(targets.length,70); assert.deepEqual(targets.slice(0,3),['modules.describe','modules.admit','agent.providers']);
 const dir=mkdtempSync(join(tmpdir(),'chat-selection-'));let runArgs:any;
 const store=new Store(join(dir,'data'),join(dir,'content'),async(t,a,o)=>{
  assert.notEqual(o?.mode,'async');
  if(t==='agent.providers')return {items:[{id:'pi',available:true,hash:'h',revision:'v',capabilities:{conversation:true}}]};
  if(t==='agent.run'){validateTools(a.tools);runArgs=a;return {runId:'r',contextId:'ctx',status:'running',active:true};}
  if(t==='agent.read')return {run:{status:'running',active:true},items:[],interactions:[],nextCursor:'x',ended:false};
  throw Error('Unexpected '+t);
 });
 try {
  const c=store.create('pi',targets);assert.deepEqual(store.get(c.id).settings.tools,targets);
  store.draft(c.id,{draft:'hello'},0);await store.operate(c.id,'selection-run','send',{});assert.deepEqual(runArgs.tools,targets);
  const blank=store.create('pi',targets);store.draft(blank.id,{settings:{...blank.settings,tools:[]}},0);assert.deepEqual(store.get(blank.id).settings.tools,[]);
  const legacy=store.create('pi');assert.deepEqual(store.get(legacy.id).settings.tools,[]);
  const window=new Window({url:'http://localhost/p/chat/main?new=1&keep=yes#anchor'});
  const prev=new Map<string,PropertyDescriptor|undefined>();let destroy:any;
  for(const key of ['window','document','HTMLElement','Element','Node','navigator','localStorage','innerHeight']){
   prev.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?window:key==='innerHeight'?900:(window as any)[key]});
  }
  let creates=0,records:any[]=[];
  const catalog={providers:[],configs:{},tools:found.slice(0,70)};
  const api=async(name:string,a:any={})=>{
   let result:any;
   if(name==='catalog')result=catalog;
   else if(name==='list')result={items:records};
   else if(name==='create'){creates++;result=store.create('pi',a.emptyTools ? [] : defaultTools(catalog.tools),a.requestKey,a.emptyTools===true);if(!records.some(c=>c.id===result.id))records.push(result);}
   else if(name==='read')result=store.get(a.id);
   else if(name==='delete'){result=store.delete(a.id,a.confirmed);records=records.filter(c=>c.id!==a.id);}
   else if(name==='draft'){result=store.draft(a.id,JSON.parse(a.patch),a.revision);records=records.map(c=>c.id===result.id?result:c);}
   else throw Error(name);
   return {json:JSON.stringify(result)};
  };
  const wait=async(fn:()=>boolean)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('selection DOM timeout');};
  try {
   const {default:mount}=await import('./ui');const el=window.document.createElement('div');window.document.body.append(el);
   const q=(s:string)=>el.querySelector(s) as any;
   destroy=mount(el as any,{call:api});await wait(()=>q('.chat-badge').textContent!=='正在加载');
   assert.equal(creates,1);assert.equal(new URL(window.location.href).searchParams.has('new'),false);assert.equal(window.location.hash,'#anchor');assert.equal(window.location.pathname,'/p/chat/main');assert.equal(new URL(window.location.href).searchParams.get('keep'),'yes');
   assert.equal(q('a[href="/history"]'),null);
   Object.defineProperty(window.navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new window.Event('offline'));assert.match(q('.chat-compose-hint').textContent,/当前离线/);assert.equal(q('.chat-send').disabled,true);
   Object.defineProperty(window.navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new window.Event('online'));
   q('[data-action=settings]').click();q('[data-action=tools-none]').click();await wait(()=>store.get(records[0].id).settings.tools.length===0);
   destroy();destroy=mount(el as any,{call:api});await wait(()=>q('.chat-badge').textContent!=='正在加载');assert.equal(creates,1);assert.equal(store.get(records[0].id).settings.tools.length,0);
   q('[data-action=settings]').click();assert.equal(el.querySelectorAll('.chat-tools input:checked').length,0);
   q('[data-action=tools-all]').click();await wait(()=>store.get(records[0].id).settings.tools.length===70);
   const aId=records[0].id; const b=store.create('pi',targets); b.title='B';store.save(b);records.push(b);
   destroy();destroy=mount(el as any,{call:api});await wait(()=>q('h1').textContent==='新会话');
   const bButton=[...el.querySelectorAll('nav button')].find((x:any)=>x.textContent==='B') as any;bButton.click();await wait(()=>q('h1').textContent==='B');assert.equal(new URL(window.location.href).searchParams.get('conversation'),b.id);
   destroy();destroy=mount(el as any,{call:api});await wait(()=>q('h1').textContent==='B');assert.equal(new URL(window.location.href).searchParams.get('conversation'),b.id);assert.equal(new URL(window.location.href).searchParams.get('keep'),'yes');assert.equal(window.location.hash,'#anchor');
   q('[data-action=delete]').click();q('.chat-confirm').close('delete');await wait(()=>q('h1').textContent==='新会话');assert.equal(new URL(window.location.href).searchParams.get('conversation'),aId);assert.equal(records.some(x=>x.id===b.id),false);
   destroy();records=[];window.history.replaceState(null,'','/p/chat/main');destroy=mount(el as any,{call:api});await wait(()=>q('.chat-badge').textContent==='选择或新建对话');assert.equal(creates,1);
  }finally{destroy?.();await window.happyDOM.close();for(const[k,d]of prev)if(d)Object.defineProperty(globalThis,k,d);else delete(globalThis as any)[k];}
  return {checks:9};
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
}
