import { strict as assert } from 'node:assert';
import { Window } from 'happy-dom';
const wait = async (fn: () => boolean) => { for (let i=0;i<200;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,5)); } throw Error('race condition timeout'); };
const copy = (x:any) => structuredClone(x);
function deferred() { let resolve!:()=>void; const promise=new Promise<void>(r=>resolve=r); return {promise,resolve}; }

export async function runRaceChecks() {
  const window=new Window({url:'http://localhost/race-test'});
  const previous=new Map<string,PropertyDescriptor|undefined>();
  for(const key of ['window','document','HTMLElement','Element','Node','navigator','localStorage','innerHeight']) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?window:key==='innerHeight'?900:(window as any)[key]});
  }
  // Match the real browser lifecycle: initialize DOMPurify only after the DOM exists.
  const { default: mount } = await import('./ui');
  const make=(id:string)=>({id,title:id,revision:5,updatedAt:'005',draft:'',settings:{providerId:'pi',model:'',thinking:'',tools:[]},messages:[],attachments:[],operations:[],deliveries:[],active:null});
  const records=new Map(['A','B','C'].map(id=>[id,make(id)]));
  let heldRead: {id:string,gate:ReturnType<typeof deferred>}|null=null, heldSave:ReturnType<typeof deferred>|null=null;
  const readStarted:string[]=[], writes:any[]=[], executions:any[]=[];
  const catalog={providers:[{id:'pi',name:'Pi',available:true}],configs:{pi:{models:[{value:'',label:'默认'},{value:'other',label:'Other'}],thinking:['off','high']}},tools:[]};
  const call=async(name:string,args:any={})=>{
    let value:any;
    if(name==='catalog') value=catalog;
    else if(name==='list') value={items:[...records.values()].map(copy)};
    else if(name==='read') {
      value=copy(records.get(args.id)); readStarted.push(args.id);
      if(heldRead && heldRead.id===args.id) {const held=heldRead;heldRead=null;await held.gate.promise;}
    } else if(name==='draft') {
      writes.push(copy(args)); const gate=heldSave;heldSave=null;if(gate)await gate.promise;
      const current=records.get(args.id)!;
      if(current.revision!==args.revision)throw Object.assign(Error('revision conflict'),{code:'conflict'});
      const patch=JSON.parse(args.patch);
      assert.ok(Object.keys(patch).every(k=>['draft','settings'].includes(k)));
      value={...current,...patch,revision:current.revision+1,updatedAt:String(current.revision+1).padStart(3,'0')};records.set(args.id,value);value=copy(value);
    } else if(name==='execute') {executions.push(copy(args));value=copy(records.get(args.id));}
    else throw Error('unexpected race tool '+name);
    return {json:JSON.stringify(value)};
  };
  let destroy:any,container:any;
  const q=(s:string)=>container.querySelector(s) as any;
  const select=(id:string)=>{const button=[...container.querySelectorAll('nav button')].find((b:any)=>b.textContent===id) as any;assert.ok(button);button.click();};
  const type=(value:string)=>{q('textarea').value=value;q('textarea').dispatchEvent(new window.Event('input',{bubbles:true}));};
  const setting=(value:string)=>{q('.chat-thinking').value=value;q('.chat-thinking').dispatchEvent(new window.Event('change',{bubbles:true}));};
  const refresh=()=>q('[data-action=refresh]').click();
  const setup=async()=>{
    destroy?.();container?.remove();window.localStorage.clear();window.history.replaceState(null,'','/race-test?keep=yes#anchor');
    for(const id of ['A','B','C'])records.set(id,make(id));
    heldRead=null;heldSave=null;writes.length=0;readStarted.length=0;executions.length=0;
    container=window.document.createElement('div');window.document.body.append(container);destroy=mount(container,{call});
    await wait(()=>!q('textarea').disabled);
  };
  const results:string[]=[];
  try {
    await setup();
    const oldRead=deferred();heldRead={id:'A',gate:oldRead};select('A');await wait(()=>readStarted.length===2);
    setting('high');await wait(()=>records.get('A')!.revision===6);
    oldRead.resolve();await new Promise(r=>setTimeout(r,0));
    type('new draft');refresh();await wait(()=>writes.length===2&&records.get('A')!.revision===7);
    assert.deepEqual(writes.map(x=>x.revision),[5,6]);assert.equal(q('.chat-thinking').value,'high');
    results.push('delayed same-ID read cannot roll revision back');

    await setup();
    const b=deferred(),c=deferred();heldRead={id:'B',gate:b};select('B');await wait(()=>readStarted.includes('B'));
    heldRead={id:'C',gate:c};select('C');await wait(()=>readStarted.includes('C'));
    c.resolve();await wait(()=>q('h1').textContent==='C');b.resolve();await new Promise(r=>setTimeout(r,0));
    assert.equal(q('h1').textContent,'C');assert.equal(new URL(window.location.href).searchParams.get('conversation'),'C');assert.equal(new URL(window.location.href).searchParams.get('keep'),'yes');assert.equal(window.location.hash,'#anchor');results.push('reverse B/C responses retain latest selection C');

    for(const withLocal of [false,true]) {
      await setup();
      const server=records.get('A')!;server.revision=6;server.updatedAt='006';server.settings.model='other';
      if(withLocal) type('unsaved local text');
      const token=window.localStorage.getItem('chat.draft.A');
      setting('high');await wait(()=>q('.chat-alert').textContent.includes('revision conflict'));
      const attempts=writes.length,reads=readStarted.length;
      refresh();await wait(()=>readStarted.length===reads+1&&q('.chat-model').value==='other');
      assert.equal(writes.length,attempts);assert.equal(window.localStorage.getItem('chat.draft.A'),token);
      if(withLocal)assert.equal(q('textarea').value,'unsaved local text');
      assert.equal(q('.chat-send').disabled,true);
      const persistedConflict=window.localStorage.getItem('chat.conflict.A');assert.ok(persistedConflict);
      destroy();container.remove();
      container=window.document.createElement('div');window.document.body.append(container);destroy=mount(container,{call});
      await wait(()=>!q('textarea').disabled);
      assert.equal(window.localStorage.getItem('chat.conflict.A'),persistedConflict);
      assert.equal(window.localStorage.getItem('chat.draft.A'),token);
      assert.equal(q('.chat-send').disabled,true);assert.ok(q('.chat-alert').textContent.includes('待核对'));
      // Block both ordinary click and a synthetic action dispatched on the disabled button.
      q('.chat-send').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,0));assert.equal(executions.length,0);
      q('[data-action=review-draft]').click();await wait(()=>!!q('.chat-draft-review'));
      const review=q('.chat-draft-review pre').textContent;
      assert.ok(review.includes('other'));assert.ok(review.includes('high'));
      assert.equal(writes.length,attempts); // A recovery read never replays stale settings.
      if(withLocal) {assert.ok(review.includes('unsaved local text'));type('newer text during review');}
      const dialog=q('.chat-draft-review');dialog.close('retry');
      await wait(()=>records.get('A')!.revision===7);
      assert.equal(records.get('A')!.settings.thinking,'high');
      assert.equal(window.localStorage.getItem('chat.conflict.A'),null);
      if(withLocal) {assert.equal(q('textarea').value,'newer text during review');assert.ok(window.localStorage.getItem('chat.draft.A')!.includes('newer text during review'));}
      results.push(`conflict recovery ${withLocal?'with':'without'} local draft preserves proposal, reads and blocks send until reviewed retry`);
    }

    results.push('remount retains conflict marker and failed settings proposal with/without local draft until confirmed save');
    await setup();const save=deferred();heldSave=save;
    setting('off');await wait(()=>writes.length===1);setting('high');save.resolve();
    await wait(()=>records.get('A')!.revision===7);assert.deepEqual(writes.map(x=>x.revision),[5,6]);
    results.push('serial settings saves increment 5→6→7');

    await setup();const draftSave=deferred();heldSave=draftSave;type('serial draft');refresh();await wait(()=>writes.length===1);refresh();draftSave.resolve();
    await wait(()=>records.get('A')!.revision===7);assert.deepEqual(writes.map(x=>x.revision),[5,6]);
    results.push('serial draft saves increment 5→6→7');
    return {checks:results.length,details:results};
  } finally {
    destroy?.();await window.happyDOM.close();
    for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];
  }
}
