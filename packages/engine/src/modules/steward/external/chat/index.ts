import { on, onDisconnect, chrona, ModelError } from 'chrona';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './state';
import { submittedReceipts } from './delivery';
import { readMindUpdates } from './mind-updates';
import { discoverTools, defaultTools, TOOL_LIMIT } from './tool-selection';
// Describe the provider fields consumed by Chat in both source and generated SDK builds.
type ProviderList = { items: { id: string; name: string; moduleId: string; configuration?: { tool: string }; available: boolean; capabilities: { conversation: boolean } }[] };
const store=new Store(chrona.paths.data,chrona.paths.content,(...args:any[])=>(chrona.call as any)(...args));
const dep=(name:string,tool:string)=>{const moduleId=chrona.dependencies[name];if(!moduleId)throw Error(name+' 未安装或未绑定');return {moduleId,tool};};
async function catalog(){
 const providers=await chrona.call('agent.providers',{}) as ProviderList;const tools=await discoverTools(chrona.call);
 const configs:any={};
 for(const p of providers.items){
  const cfg:any={models:[],thinking:[],warning:''};configs[p.id]=cfg;
  if(p.configuration){
   try{const target={moduleId:p.moduleId,tool:p.configuration.tool};const contract:any=await chrona.call('modules.describe',{target});const schema=contract.inputSchema;cfg.thinking=schema?.properties?.config?.properties?.thinking?.enum??schema?.properties?.form?.properties?.thinking?.enum??[];
    // This is a read-only view of the discovered configuration contract.
    if(schema?.properties?.view){const view:any=await (chrona.call as any)(target,{view:true});cfg.view=view;}
   }catch(e:any){cfg.warning=e.message;}
  }
  if(p.name==='Pi'||p.id==='pi'){
   try{const target={moduleId:p.moduleId,tool:'models'};await chrona.call('modules.describe',{target});const models:any=await (chrona.call as any)(target,{});cfg.models=models.options;cfg.warning=[cfg.warning,...models.warnings].filter(Boolean).join('；');}catch(e:any){cfg.warning=e.message;}
  }
 }
 return {providers:providers.items,tools,configs,limited:false,toolLimit:TOOL_LIMIT};
}
async function deliveries(c:any){
 const receipts=submittedReceipts(c);
 for(const d of receipts){try{
  d.receipt=await chrona.call('modules.receipt',{receiptId:d.receiptId});const r=d.receipt;
  d.requestKey=r.requestKey;d.approvalId=r.approvalId;d.state=({submitted:'候选已提交',pending_approval:'待批准',approved:'候选已批准',rejected:'候选已拒绝'} as any)[r.state]??'未知';
  const installed:any=await chrona.call('modules.list',{limit:100});
  d.members=[];for(const member of r.members){const m=installed.items.find((m:any)=>m.id===member.moduleId);const activated=m?.activeHash===member.hash&&m?.health?.activation?.hash===member.hash&&m?.health?.activation?.status==='verified';d.members.push({...member,implementationCheck:member.status,activation:activated?'已安装激活':'未知或尚未激活',health:m?.health??null,pageIdentity:'未知：公开 web.pages 只返回调用应用自己的页面，未提供其他应用的版本绑定页面查询',browserAcceptance:'未知，需要独立浏览器证据'});
  }
 }catch(e:any){d.error=e.message;d.state='回执核对未知';}}
 c.deliveries=receipts;return store.save(c);
}
on('tool',async event=>{
 const a=event.args as any;let result:any;
 try{
  if (['read','execute','new-context','observations','snapshot','observation-inventory','observation-scope'].includes(event.id) && !store.version) {
   const modules:any=await chrona.call('modules.list',{limit:100});
   const self=modules.items.find((m:any)=>m.name==='chat');
   store.version=self?.activeHash??''; store.moduleId=self?.id??'';
   if (!store.version) throw Error('无法核对 Chat 当前版本');
  }
  switch(event.id){
   case 'catalog':result=await catalog();break;
   case 'list':result={items:store.list()};break;
   case 'create':{result=store.created(a.requestKey,a.emptyTools===true);if(result)break;const p=await chrona.call('agent.providers',{}) as ProviderList;const available=p.items.filter(p=>p.available&&p.capabilities.conversation);result=store.create(available.length===1?available[0].id:'',a.emptyTools === true ? [] : defaultTools(await discoverTools(chrona.call)),a.requestKey,a.emptyTools===true);break;}
   case 'read':{
    const conversation=await store.reconcile(a.id,a.observe!==true),admission=store.observations.admission(a.id);
    const source=store.observations.scopeTool();
    const updates=admission?await readMindUpdates((target,args)=>chrona.call(target,args),chrona.dependencies.mind,a.id,{epoch:source.epoch,scopeRevision:source.revision}):[];
    const current=store.observations.scopeTool();
    result={...conversation,mindUpdates:admission&&current.epoch===source.epoch&&current.revision===source.revision?updates:[]};break;
   }
   case 'draft':result=store.draft(a.id,JSON.parse(a.patch),a.revision);break;
   case 'edit':result=store.edit(a.id,JSON.parse(a.patch));break;
   case 'delete':result=store.delete(a.id,a.confirmed);break;
   case 'upload':result=store.upload(a.id,a);break;
   case 'detach':result=store.detach(a.id,a.attachmentId);break;
   case 'new-context':result=store.newContext(a.id,a.confirmed);break;
   case 'image':result=store.image(a.id,a.attachmentId);break;
   case 'execute':store.mindTarget=chrona.dependencies.mind?{moduleId:chrona.dependencies.mind,tool:'context'}:null;result=await store.operate(a.id,a.key,a.kind,JSON.parse(a.input));break;
   case 'observations':result=store.observations.observations(a);break;
   case 'snapshot':result=store.observations.snapshot(a);break;
   case 'observation-inventory':result=store.observations.inventory(a);break;
   case 'observation-scope':result=store.observations.scopeTool(a);break;
   case 'native':{const c=store.get(a.id);const runId=c.active?.runId??[...c.messages].reverse().find((m:any)=>m.run)?.run?.runId;if(!runId)throw Error('需要已有执行；不会为发现配置启动新任务');if(!['get_state','get_available_models'].includes(a.type))throw Error('仅开放原生只读状态/模型查询');result=await chrona.call('agent.native',{runId,request:{type:a.type}},{key:a.key});break;}
   case 'delivery':{const c=store.get(a.id);if(a.receiptId&&!c.deliveries.some((d:any)=>d.receiptId===a.receiptId))c.deliveries.push({receiptId:a.receiptId,state:'待核对用户指定回执'});result=await deliveries(c);break;}
   default:throw Error('未知工具');
  }
  return {result:{json:JSON.stringify(result)}};
 }catch(e:any){console.error(JSON.stringify({component:'chat',event:event.id,error:e.message}));throw new ModelError(e.code??'failed',e.message);}
});
on('activated',async()=>{
 // The approved integration observes future sent facts by default; any explicit scope choice wins.
 const learning=store.observations.scopeTool();if(learning.revision===0&&!learning.enabled)store.observations.scopeTool({expectedRevision:0,enabled:true});
 const component=await chrona.call<{ type: string }>(dep('web','component-set'),{name:'Workbench',javascript:readFileSync(join(chrona.paths.module,'dist/ui.js'),'utf8'),css:readFileSync(join(chrona.paths.module,'ui.css'),'utf8'),props:{type:'object',properties:{},additionalProperties:false},tools:['catalog','list','create','read','draft','edit','delete','upload','detach','image','execute','native','delivery','new-context','observation-scope']});
 await chrona.call(dep('web','page-set'),{id:'main',title:'Chat',layout:'workspace',spec:{root:'chat',elements:{chat:{type:component.type,props:{},children:[]}}}});
});

// Chat remains responsible for observing its own foreground Run after the browser closes.
// This only reads existing Agent runs; uncertain commands keep their original receipt and are never replayed here.
let observing=false;
const observationTimer=setInterval(()=>{if(observing)return;observing=true;void(async()=>{
 try{
  const active=store.list().filter((c:any)=>c.active?.runId).slice(0,20);if(!active.length)return;
  if(!store.version){const directory:any=await chrona.call('modules.list',{limit:100});const self=directory.items.find((m:any)=>m.name==='chat');if(!self?.activeHash)throw Error('Chat active identity unavailable');store.version=self.activeHash;store.moduleId=self.id;}
  for(const row of active)await store.reconcile(row.id,false);
 }catch(error){console.error(JSON.stringify({component:'chat',event:'foreground_observation_failed',error:error instanceof Error?error.message.slice(0,500):'unknown'}));}
 finally{observing=false;}
})();},10000);
observationTimer.unref();
onDisconnect(()=>{clearInterval(observationTimer);});
