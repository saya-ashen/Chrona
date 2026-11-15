import type {readCapabilities} from './core-capabilities';
import type {DeliveryRecord} from './core-delivery';
import type {Target} from './core-execution';

type Directory=Awaited<ReturnType<typeof readCapabilities>>;
export type DeliveryOutcome=Pick<DeliveryRecord,'id'|'pursuitId'|'worker'|'status'|'observation'|'actionKey'|'author'|'requestKey'|'admissionId'|'materials'|'receipt'|'payload'|'directory'|'updatedAt'> & {withdrawn?:boolean};
const targetKey=(target:Target)=>typeof target==='string'?target:JSON.stringify([target.moduleId,target.tool]);

/** Describe exactly the executable selection; share module identity once and discover other contracts on demand. */
export function mindPromptCapabilities(directory:Directory,selected:Target[]){
 const known=new Map(directory.tools.map(c=>[targetKey(c.target),c]));
 const modules=new Map<string,{moduleId:string;metadata:Record<string,unknown>;tools:Record<string,unknown>[]}>();
 const system:Record<string,unknown>[]=[];
 for(const target of selected){
  const capability=known.get(targetKey(target));
  const detail=capability?{description:capability.description,available:capability.available,...(capability.reason?{reason:capability.reason}:{})}:{};
  if(typeof target==='string'){system.push({target,...detail});continue;}
  let module=modules.get(target.moduleId);
  if(!module){
   const source=directory.modules.find(m=>m.id===target.moduleId)??{};
   const metadata=Object.fromEntries(['name','hash','activeHash','version','activeVersion','enabled','status'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
   module={moduleId:target.moduleId,metadata,tools:[]};modules.set(target.moduleId,module);
  }
  module.tools.push({name:target.tool,...detail});
 }
 return {capturedAt:directory.capturedAt,readiness:directory.readiness,modules:[...modules.values()],system,
  discovery:'Only selected tools are shown. Use modules.list to find installed applications and modules.describe for their current contracts; use modules.health for readiness. Application reads still require mind.applications/mind.action reviewed adapters.'};
}

/** Reuse owner-recorded outcomes without repeating the prepare payload or losing original material/receipt identities. */
export function mindPromptDelivery({payload,materials,...outcome}:DeliveryOutcome){
 return {...outcome,materials:materials.map(material=>{
  const item=payload?.items.find(i=>i.name===material.name&&i.materialDigest===material.materialDigest);
  return {...material,...(item?{dir:item.dir,intent:item.intent}:{})};
 })};
}
