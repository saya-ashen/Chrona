import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { Store } from './state';
import { discoverTools, defaultTools } from './tool-selection';
const wait = async (fn:()=>boolean) => {for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('create recovery DOM timeout');};
export async function runCreateChecks() {
 const dir=mkdtempSync(join(tmpdir(),'chat-create-'));
 const noModel=async(t:any)=>{throw Error('No model/tool execution permitted: '+t);};
 let store=new Store(join(dir,'data'),join(dir,'content'),noModel);
 let destroy:any; const previous=new Map<string,PropertyDescriptor|undefined>();
 const window=new Window({url:'http://localhost/p/chat/main?new=1&keep=yes#anchor'});
 try {
  // A second connection models a restart/another module instance using the same receipt DB.
  const a=store.create('pi',[],'durable');store.close();store=new Store(join(dir,'data'),join(dir,'content'),noModel);
  assert.equal(store.create('pi',[],'durable').id,a.id);assert.equal(store.list().length,1);
  assert.throws(()=>store.create('pi',[],'durable',true),/不能更改/);
  store.delete(a.id,true);assert.throws(()=>store.create('pi',[],'durable'),/已删除/);assert.equal(store.list().length,0);
  for(const key of ['window','document','HTMLElement','Element','Node','navigator','localStorage','innerHeight']){
   previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?window:key==='innerHeight'?900:(window as any)[key]});
  }
  const keys:string[]=[];let lose=true,hold=false,release:any;
  const call=async(name:string,args:any={})=>{
   let result:any;
   if(name==='catalog')result={tools:[],providers:[],configs:{}};
   else if(name==='list')result={items:store.list()};
   else if(name==='read')result=store.get(args.id);
   else if(name==='create'){
    assert.equal(new URL(window.location.href).searchParams.get('createKey'),args.requestKey);assert.ok(args.requestKey);
    keys.push(args.requestKey);result=store.create('pi',[],args.requestKey,args.emptyTools===true);
    if(hold)await new Promise(r=>release=r);
    if(lose){lose=false;throw Error('create reply lost');}
   } else throw Error('No model or unexpected UI call '+name);
   return {json:JSON.stringify(result)};
  };
  const {default:mount}=await import('./ui');const el=window.document.createElement('div');window.document.body.append(el);
  const q=(s:string)=>el.querySelector(s) as any;
  destroy=mount(el as any,{call});await wait(()=>q('.chat-alert').textContent.includes('lost'));
  const firstKey=new URL(window.location.href).searchParams.get('createKey');assert.ok(firstKey);assert.equal(store.list().length,1);
  // Reload following an accepted create with a lost HTTP reply.
  destroy();destroy=mount(el as any,{call});await wait(()=>new URL(window.location.href).searchParams.has('conversation'));
  assert.equal(store.list().length,1);assert.deepEqual(keys,[firstKey,firstKey]);assert.equal(new URL(window.location.href).searchParams.has('createKey'),false);assert.equal(new URL(window.location.href).searchParams.has('new'),false);
  // Explicit new also reuses the unconfirmed key on a second click.
  lose=true;q('[data-action=new]').click();await wait(()=>keys.length===3&&q('.chat-alert').textContent.includes('lost'));
  const clickedKey=keys[2];q('[data-action=new]').click();await wait(()=>keys.length===4&&!new URL(window.location.href).searchParams.has('new'));
  assert.equal(keys[3],clickedKey);assert.equal(store.list().length,2);
  // Unmount while the create is accepted but its response is still in flight.
  hold=true;lose=false;q('[data-action=new]').click();await wait(()=>!!release);const heldKey=keys[4];const unblock=release;
  assert.equal(store.list().length,3);destroy();hold=false;destroy=mount(el as any,{call});
  await wait(()=>keys.length===6&&!new URL(window.location.href).searchParams.has('new'));
  assert.equal(keys[5],heldKey);assert.equal(store.list().length,3);const route=window.location.href;
  unblock();await new Promise(r=>setTimeout(r,10));assert.equal(window.location.href,route);assert.equal(store.list().length,3);
  assert.equal(new URL(route).searchParams.get('keep'),'yes');assert.equal(window.location.hash,'#anchor');
  // Legal module and tool slugs can combine into a Provider name the kernel skips.
  const longModule='a'.repeat(30), longTool='b'.repeat(40);
  const discovered=await discoverTools(async(t:string)=>t==='modules.list'?{items:[{id:'long',name:longModule},{id:'short',name:'short-app'}]}:{items:[{target:{moduleId:'long',tool:longTool},description:'legal but too long'},{target:{moduleId:'short',tool:'short-tool'},description:'short'},{target:'agent.providers',description:'system'}]});
  assert.equal(discovered.length,3);assert.equal(discovered[0].available,false);assert.match(discovered[0].reason,/超过64/);
  assert.deepEqual(defaultTools(discovered),[{moduleId:'short',tool:'short-tool'},'agent.providers']);
  const boundary=await discoverTools(async(t:string)=>t==='modules.list'?{items:[{id:'b',name:'a'.repeat(20)}]}:{items:[{target:{moduleId:'b',tool:'b'.repeat(41)},description:'exactly 64'}]});assert.equal(boundary[0].available,true);
  return {checks:6};
 } finally {destroy?.();store.close();await window.happyDOM.close();for(const[k,d]of previous)if(d)Object.defineProperty(globalThis,k,d);else delete(globalThis as any)[k];rmSync(dir,{recursive:true,force:true});}
}
