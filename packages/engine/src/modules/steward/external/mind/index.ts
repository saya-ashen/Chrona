import {chrona,on,onDisconnect,ModelError,type Caller} from 'chrona';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CoreMindStore,coreDigest} from './core-store';
import {CoreMindService} from './core-service';
import {CoreRuntime,deliveryRuntimeHooks} from './core-runtime';
import {CoreActions} from './core-actions';
import {CoreTaskView,taskOwnerAccess} from './core-task-view';
import {artifactToolResult} from './core-artifact';
import {CoreApplication} from './core-application';
import {CoreDelivery} from './core-delivery';
import {CoreDeliveryAdmission} from './core-delivery-admission';
import {CoreSources,ingestApplicationOperation} from './core-sources';
import {CoreObservationCoordinator} from './core-observation';
import {CoreNotifications} from './core-notifications';
import {CoreRecovery} from './core-recovery';
import {CoreError,type CoreAccess,type ContextInput} from './core-types';
import type {CoreCall} from './core-execution';
const store=new CoreMindStore(chrona.paths.data),service=new CoreMindService(store);
let application:CoreApplication|undefined;
const applicationAdapter=()=>application??=new CoreApplication(chrona.paths.data,service,rawCall,self().moduleId);
const actions=new CoreActions(chrona.paths.data,service,applicationAdapter);
const rawCall:CoreCall=async(target,args,options)=>{
 const value=await (chrona.call as CoreCall)(target,args,options);
 if(value&&typeof value==='object'&&'json'in value&&typeof value.json==='string')return JSON.parse(value.json) as unknown;
 return value;
};
const recovery=new CoreRecovery(chrona.paths.data,store,service);
const notifications=new CoreNotifications(store,rawCall,()=>chrona.dependencies['notify']);
let identity:{moduleId:string;hash:string}|undefined;
const self=()=>{if(!identity)throw Error('Mind current version is not verified');return identity;};
// Original persisted runs retain their execution identity during startup recovery.
// Tool authorization and all fresh dispatch still require verifyIdentity().
const runtimeIdentity=():{moduleId:string;hash:string}=>identity??runtime.journal.outstanding()?.principal??runtime.verification.outstanding()?.principal??runtime.admission.outstanding()?.principal??self();
const runtime:CoreRuntime=new CoreRuntime(store,service,rawCall,runtimeIdentity,actions,undefined,deliveryRuntimeHooks(()=>delivery,()=>proof));
const proof=new CoreDeliveryAdmission(chrona.paths.data,runtime.journal);
const delivery:CoreDelivery=new CoreDelivery(chrona.paths.data,service,rawCall,{worker:runRef=>runtime.journal.all().find(e=>e.runId===runRef),verifyAdmission:async r=>proof.verify(r),assertMaySubmit:pursuitId=>{if(runtime.pendingControl(pursuitId))throw new ModelError('conflict','A pending user control holds delivery submission');}});
const observe:CoreCall=(target,args,options)=>runtime.observe(target,args,options,typeof target==='object'&&target.tool==='observation-scope'?'source-control':'source-data');
const sources=new CoreSources(store,service,observe,async()=>{const id=chrona.dependencies['chat'];if(!id)return undefined;const rows=await directoryRows((target,args)=>runtime.observe(target,args,undefined,'source-control'));const row=rows.find(m=>m.id===id);return row?.activeHash?{moduleId:id,hash:row.activeHash}:undefined;});
const TOOLS=['overview','detail','settings','context','remember','pursue','control','feedback','forget','applications','delivery','artifact','check','recovery'];
const taskView=new CoreTaskView(store,service,actions,()=>runtime.journal.all(),{chatIdentity:()=>chrona.dependencies['chat'],deliveries:delivery});
const tools=new Set([...TOOLS,'updates','progress','action','organized','observe','verdict','admission-verdict','task-view','task-control']);let pagesReady=false,maintaining=false,closed=false;
const log=(event:string,error:unknown)=>console.error(JSON.stringify({component:'mind',event,error:error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}));
async function directoryRows(call:CoreCall){
 const rows:{id:string;name:string;activeHash:string}[]=[],seen=new Set<string>();let cursor:string|undefined;
 for(let page=0;page<100;page++){
  const result=await call('modules.list',{limit:100,...(cursor?{cursor}:{})}) as {items:{id:string;name:string;activeHash:string}[];nextCursor?:string|null};
  if(!result||!Array.isArray(result.items)||result.items.some(row=>!row||typeof row.id!=='string'||typeof row.name!=='string'))throw Error('Invalid module directory');
  rows.push(...result.items);
  if(!result.nextCursor){if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Ambiguous module directory');return rows;}
  if(typeof result.nextCursor!=='string'||seen.has(result.nextCursor))throw Error('Invalid module directory cursor');seen.add(result.nextCursor);cursor=result.nextCursor;
 }
 throw Error('Module directory exceeds pagination bound');
}
async function verifyIdentity(){
 const directory=await directoryRows(rawCall);const row=directory.find(m=>m.name==='mind');
 if(!row?.activeHash)throw Error('Active Mind module missing from directory');identity={moduleId:row.id,hash:row.activeHash};
}
function access(caller:Caller|undefined,tool:string,executionRunId?:string):CoreAccess{
 if(caller?.kind==='owner')return {subject:`owner:${caller.via??'local'}`,role:'owner',scopes:[{}]};
 if(caller?.kind==='module'){
  if(caller.moduleId===self().moduleId&&caller.hash===self().hash){const bound=runtime.accessForCaller(`module:${caller.moduleId}:${caller.hash}`,true,executionRunId);if(['remember','pursue','control','feedback','progress','action','delivery','organized'].includes(tool)&&!bound.execution)throw new ModelError('forbidden','Only the current kernel-bound Mind execution may mutate understanding or work');return bound;}
  // Web is the explicitly approved owner UI host; only its real kernel principal is accepted, never a JSON owner flag.
  if(caller.moduleId===chrona.dependencies['web']&&['overview','detail','settings','context','control','feedback','forget','remember','pursue','artifact','applications','delivery','check','recovery'].includes(tool))return {subject:`web:${caller.moduleId}:${caller.hash}`,role:'owner',scopes:[{}]};
  return {subject:`module:${caller.moduleId}:${caller.hash}`,role:'application',scopes:[{}]};
 }
 throw new ModelError('forbidden','Mind requires a real owner or approved application caller');
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function input(args:Record<string,unknown>){if(typeof args.input!=='string')throw new ModelError('invalid','Expected input JSON');const value=JSON.parse(args.input) as unknown;if(!object(value))throw new ModelError('invalid','Expected a JSON object');return value;}
function contextInput(args:Record<string,unknown>):ContextInput{
 const scope=typeof args.scope==='string'?{sessionId:args.scope}:object(args.scope)?args.scope:{};
 return {scope,...(typeof args.query==='string'?{query:args.query}:{}),...(typeof args.limit==='number'?{limit:args.limit}:{}),...(typeof args.maxBytes==='number'?{maxBytes:args.maxBytes}:{})};
}
async function register(){
 if(maintaining)return;maintaining=true;
 try{
  await verifyIdentity();if(!pagesReady&&chrona.dependencies['web']){
   for(const page of [{id:'main',title:'Mind',view:'overview'},{id:'settings',title:'Mind 设置',view:'settings'}])await chrona.call({moduleId:chrona.dependencies['web'],tool:'page-set'},{id:page.id,title:page.title,...(page.id==='settings'?{purpose:'settings'}:{}),layout:'workspace',javascript:readFileSync(join(chrona.paths.module,'dist/workspace.js'),'utf8'),css:readFileSync(join(chrona.paths.module,'dist/workspace.css'),'utf8'),props:{view:page.view},tools:TOOLS});
   pagesReady=true;
  }
  const timer=await chrona.call('timers.list',{}) as {items:{id:string}[]};if(!timer.items.some(t=>t.id==='mind-core'))await chrona.call('timers.set',{id:'mind-core',schedule:{kind:'every',milliseconds:60000}},{key:'mind-core:register'});
 }catch(error){log('registration_failed',error);}finally{maintaining=false;}
}
let sourceError:string|undefined;
const observationCoordinator:CoreObservationCoordinator=new CoreObservationCoordinator(async()=>{
 if(closed)return;
 if(!identity)await verifyIdentity();
 if(closed)return;
 try{if(!store.inspect(tx=>tx.settings().restoreBlocked)){const result=await sources.sync();sourceError=result.coverage.complete?undefined:result.unknowns.join(', ')||result.coverage.gap;}}
 catch(error){log('source_sync_failed',error);sourceError=error instanceof Error?error.message:'Source unavailable';}
 if(closed)return;
 await runtime.refreshCapabilities();
 if(closed)return;
 runtime.cleanupWithdrawn();await runtime.tick(false,false);runtime.cleanupWithdrawn();await notifications.sync();
},async manual=>{
 runtime.cleanupWithdrawn();const status=identity?await runtime.tick(manual,false,!observationCoordinator.observing):await runtime.reconcileOriginals();runtime.cleanupWithdrawn();
 return {...status,...(sourceError?{sourceError}:{})};
},Date.now,error=>{log('observation_failed',error);});
async function background(manual=false){
 if(closed)return runtime.view();
 try{
  recovery.guard();
  return await observationCoordinator.check(manual);
 }catch(error){log('runtime_failed',error);return {...runtime.view(),error:error instanceof Error?error.message:'Runtime unavailable'};}
}
on('tool',async event=>{
 try{
  if(!tools.has(event.id))throw new ModelError('invalid','Unknown Mind tool');if(!identity)await verifyIdentity();
  recovery.guard();const a=event.args,who=['task-view','task-control'].includes(event.id)?taskOwnerAccess(event.caller,event.call?.chain,chrona.dependencies):access(event.caller,event.id,event.call?.executionRunId);let result:unknown;
  if(store.inspect(tx=>tx.settings().restoreBlocked)&&who.role!=='owner'&&['context','updates','detail','artifact','overview'].includes(event.id))throw new CoreError('RESTORE_BLOCKED','Restored memory is unavailable until owner review');
  switch(event.id){
   case 'context':result=service.context(contextInput(a),who);break;
   case 'task-view':result=taskView.view(a as {id?:string;artifactRef?:string},who);break;
   case 'task-control':result=taskView.control(input(a) as never,who);await runtime.executor.reconcile();break;
   case 'updates':{
    if(event.caller?.kind!=='module'||event.caller.moduleId!==chrona.dependencies['chat'])throw new ModelError('forbidden','Only the bound Chat application may read its conversation updates');
    result=service.conversationUpdates(event.caller.moduleId,String(a.conversationId??''),who,{epoch:a.epoch,scopeRevision:a.scopeRevision});break;
   }
   case 'overview':{
    const overview=service.overview({limit:typeof a.limit==='number'?a.limit:50,...(typeof a.after==='string'?{after:a.after}:{})},who);
    result={...overview,health:runtime.view(),notifications:notifications.view(),budget:runtime.view().budget,sources:store.read().checkpoints,deliveries:who.role==='owner'?delivery.list({limit:50},who).items:[],applications:runtime.capabilities?.modules.map(m=>({id:m.id,name:m.name,activeHash:m.activeHash??null}))??[],autonomousPublishing:runtime.view().autonomousPublishing,recovery:recovery.status()};break;
   }
   case 'detail':{
    const id=String(a.id??''),state=store.read();
    const kind=state.pursuits.some(p=>p.id===id)?'pursuit':state.understandings.some(u=>u.id===id)?'understanding':'evidence';
    const detail=service.detail({kind,id},who);
    const refs='evidenceRefs'in detail?detail.evidenceRefs:'supportingRefs'in detail?[...detail.supportingRefs,...detail.opposingRefs]:[];
    const artifacts=kind==='pursuit'?actions.list(id,who):[];
    // Agent tool results have a bounded journal; read document bodies through artifact.
    result={...detail,evidence:refs.map(id=>service.detail({kind:'evidence',id},who)).filter(e=>!e.retractedAt),
     artifacts:who.role==='owner'?artifacts.map(d=>actions.read(d.ref,who)):artifacts};
    break;
   }
   case 'recovery':{result=a.input===undefined?recovery.status():recovery.review(input(a) as never,who);break;}
   case 'settings':{
    if(a.patch===undefined)result=service.settings(undefined,who);
    else {const patch=JSON.parse(String(a.patch)) as unknown;if(!object(patch))throw new ModelError('invalid','Settings patch must be an object');const state=store.read();result=service.settings({expectedRevision:Number(a.revision),expectedVisibilityRevision:state.visibilityRevision,actionKey:`settings:${coreDigest([who.subject,a.revision,patch])}`,patch},who);await runtime.executor.reconcile();}break;
   }
   case 'remember':case 'pursue':case 'control':case 'feedback':{
    const mutation=input(a);
    result=who.role==='owner'?service[event.id](mutation as never,who):runtime.admission.enqueue(event.id,mutation,who);
    if(event.id==='control')await runtime.executor.reconcile();break;
   }
   case 'forget':{
    const forgotten=service.forget(input(a) as never,who);runtime.cleanupWithdrawn();await runtime.executor.reconcile();const cleanup=runtime.cleanupWithdrawn(),applicationCleanup=cleanup.application;
    const deferred=cleanup.deferred;
    result={...forgotten,value:{...forgotten.value,cleanup:{...forgotten.value?.cleanup,mind:deferred?'deferred-original-command':applicationCleanup?.checkpoint==='busy'?'deferred-checkpoint':'complete',deferredCommands:deferred,...(applicationCleanup?{application:applicationCleanup}:{}),...(cleanup.delivery?{delivery:cleanup.delivery}:{})}}};break;
   }
   case 'admission-verdict':{if(event.caller?.kind!=='module'||event.caller.moduleId!==self().moduleId||event.caller.hash!==self().hash||!event.call?.executionRunId)throw new ModelError('forbidden','Kernel-bound independent semantic verifier required');result=runtime.admission.verdict(input(a) as never,{...event.caller,runId:event.call.executionRunId});break;}
   case 'verdict':{if(event.caller?.kind!=='module'||event.caller.moduleId!==self().moduleId||event.caller.hash!==self().hash)throw new ModelError('forbidden','Independent verifier identity required');if(!event.call?.executionRunId)throw new ModelError('forbidden','Kernel-bound verifier run required');result=runtime.verdict(input(a) as never,{...event.caller,runId:event.call.executionRunId});break;}
   case 'observe':{if(event.caller?.kind!=='module'||event.caller.moduleId===self().moduleId)throw new ModelError('forbidden','A source application caller is required');result=ingestApplicationOperation(store,service,event.caller,input(a));break;}
   case 'organized':{if(!who.execution||event.caller?.kind!=='module'||!event.call?.executionRunId)throw new ModelError('forbidden','Bound organizer required');result=runtime.organizer.result(input(a),event.call.executionRunId);break;}
   case 'progress':await runtime.bindResponsibility();result=service.progress(input(a) as never,access(event.caller,event.id,event.call?.executionRunId));break;
   case 'applications':{
    const mutation=a.input===undefined?{operation:'list'}:input(a);
    if(who.role!=='owner'&&!who.execution)throw new ModelError('forbidden','Only the owner or current bound Mind worker may list reviewed applications');
    if(mutation.operation==='list')result=await applicationAdapter().list(who);
    else {
     if(who.role!=='owner')throw new ModelError('forbidden','Only the owner may configure reviewed application reads');
     if(mutation.operation==='grant')result=await applicationAdapter().grant(mutation as never,who);
     else if(mutation.operation==='revoke')result=applicationAdapter().revoke(String(mutation.adapterId??''),who);
     else throw new ModelError('invalid','Expected applications operation list, grant or revoke');
    }break;
   }
   case 'delivery':{
    const mutation=input(a),{operation,...parameters}=mutation;
    if(operation==='prepare'){
     if(who.role!=='runtime'||!who.execution)throw new ModelError('forbidden','Only the current kernel-bound Mind worker may prepare delivery');
     if(typeof parameters.pursuitId==='string'&&runtime.pendingControl(parameters.pursuitId))throw new ModelError('conflict','A pending user control holds delivery preparation');
     await runtime.bindResponsibility();result=await delivery.prepare(parameters,access(event.caller,event.id,event.call?.executionRunId));
    }else{
     if(who.role!=='owner')throw new ModelError('forbidden','Only the actual owner coordinator may inspect or submit delivery');
     const allowed=operation==='list'?['limit','after']:['id'];
     if(Object.keys(parameters).some(key=>!allowed.includes(key)))throw new ModelError('invalid','Unexpected delivery fields');
     if(operation==='list')result=delivery.list(parameters as never,who);
     else if(typeof parameters.id!=='string'||!parameters.id)throw new ModelError('invalid','Delivery id required');
     else if(operation==='detail')result=delivery.detail(parameters.id,who);
     else if(operation==='submit'){
      const current=delivery.detail(parameters.id,who);
      if(current.status!=='submit-unknown'&&!current.receipt&&runtime.pendingControl(current.pursuitId))throw new ModelError('conflict','A pending user control holds delivery submission');
      result=await delivery.submit(parameters.id,who);
     }
     else if(operation==='reconcile')result=await delivery.reconcile(parameters.id,who);
     else if(operation==='withdraw'||operation==='forget')result=delivery.withdraw(parameters.id,who);
     else throw new ModelError('invalid','Expected delivery operation prepare, list, detail, submit, reconcile, withdraw or forget');
    }break;
   }
   case 'action':{
    const mutation=input(a);
    if(typeof mutation.pursuitId==='string'&&runtime.pendingControl(mutation.pursuitId))throw new ModelError('conflict','A pending user control is being checked; guarded effects are held');
    await runtime.bindResponsibility();
    const bound=access(event.caller,event.id,event.call?.executionRunId);
    const outcome=mutation.target==='application-read'?await actions.applicationRead(mutation as never,bound):actions.create(mutation as never,bound);
    result='body' in outcome?artifactToolResult(outcome):outcome;
    break;
   }
   case 'artifact':{
    const document=actions.read(String(a.ref),who,{full:a.full===true});
    result=who.role==='owner'&&a.offset===undefined?document:artifactToolResult(document,a.offset as number|undefined);
    break;
   }
   case 'check':if(who.role!=='owner')throw new ModelError('forbidden','Only the owner can manually check');result=await background(true);break;
  }
  return {result:{json:JSON.stringify(result)}};
 }catch(error){log(event.id,error);if(error instanceof ModelError)throw error;if(error instanceof CoreError)return {result:{json:JSON.stringify({error:{code:error.code,message:error.message}})}};throw new ModelError('failed',error instanceof Error?error.message:'Mind operation failed');}
});
on('activated',async()=>{pagesReady=false;await register();return {};});
on('timer',async event=>{if(event.id!=='mind-core')throw new ModelError('invalid','Unknown Mind timer');return {result:await background()};});
const reconciliationTimer=setInterval(()=>{void background();},10000),registrationTimer=setInterval(()=>{void register();},60000);
onDisconnect(()=>{closed=true;clearInterval(reconciliationTimer);clearInterval(registrationTimer);void observationCoordinator.settled().catch(error=>log('observation_shutdown_failed',error)).finally(()=>{delivery.close();proof.close();runtime.close();notifications.close();actions.close();application?.close();store.close();});});
void register();
