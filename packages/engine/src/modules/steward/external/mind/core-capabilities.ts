import type { CoreCall, Target } from './core-execution';
export type Capability = {target:Target;module:string;name:string;description:string;available:boolean;reason?:string};
export async function readCapabilities(call:CoreCall){
 const modules:Record<string,unknown>[]=[];let cursor:string|undefined;const seen=new Set<string>();
 do{const p=await call('modules.list',{limit:100,...(cursor?{cursor}:{})}) as {items:Record<string,unknown>[];nextCursor:string|null};modules.push(...p.items);if(p.nextCursor&&seen.has(p.nextCursor))throw Error('Module directory cursor repeated');cursor=p.nextCursor??undefined;if(cursor)seen.add(cursor);}while(cursor);
 const names=new Map(modules.map(m=>[String(m.id),String(m.name)]));const tools:Capability[]=[];cursor=undefined;seen.clear();
 do{const p=await call('modules.describe',{audience:'user',limit:100,...(cursor?{cursor}:{})}) as {items:{target:Target;description:string}[];nextCursor:string|null};
 for(const t of p.items){const module=typeof t.target==='string'?t.target.split('.')[0]!:names.get(t.target.moduleId)??t.target.moduleId;const name=typeof t.target==='string'?t.target.split('.')[1]!:t.target.tool;const generated=`m_${module.replaceAll('-','_')}_${name.replaceAll('-','_')}`;tools.push({target:t.target,module,name,description:t.description,available:typeof t.target==='string'||generated.length<=64});}
 if(p.nextCursor&&seen.has(p.nextCursor))throw Error('Tool directory cursor repeated');cursor=p.nextCursor??undefined;if(cursor)seen.add(cursor);}while(cursor);
 return {modules,tools,capturedAt:new Date().toISOString(),readiness:'Directory is discovery only; configuration and actual invocation results are independent evidence'};
}
/** Pure reads and current-run material preparation. Effectful app operations go through concrete mind.action adapters. */
export function selectMindTools(capabilities:Capability[],selfId:string,mode:'understand'|'pursuit'){
 const self=mode==='understand'?['context','detail','remember','pursue','control','feedback']:['context','detail','artifact','progress','action','applications','delivery'];
 const selected:Target[]=self.map(tool=>({moduleId:selfId,tool}));
 const system=new Set(['modules.list','modules.describe','modules.health','modules.receipt','agent.providers']);
 for(const c of capabilities){if(!c.available)continue;if(typeof c.target==='string'){if(system.has(c.target))selected.push(c.target);continue;}
  if(c.module==='author'&&mode==='pursuit'&&['prepare','export','import','validate','read','write','list','stage','source','receipt'].includes(c.name))selected.push(c.target);
  // A read-looking name does not establish effect safety. Other apps require a reviewed concrete adapter.
 }
 // modules.admit allows exact Author handoff, never approvals.resolve or credential/config writes.
 if(mode==='pursuit')selected.push('modules.admit');
 const unique=[...new Map(selected.map(t=>[JSON.stringify(t),t])).values()];if(unique.length>100)throw Error('Required tool set exceeds 100; select a narrower pursuit stage');return unique;
}
