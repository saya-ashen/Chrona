export const TOOL_LIMIT = 100;
export const targetKey = (t: any): string => typeof t === 'string' ? t : `${t.moduleId}.${t.tool}`;
export function validateTools(tools: any[]) {
 if (!Array.isArray(tools) || tools.length > TOOL_LIMIT) throw Error(`内核每轮最多支持 ${TOOL_LIMIT} 个应用工具；当前 ${tools?.length ?? 0} 个，请手动选择后重试。`);
 if (new Set(tools.map(targetKey)).size !== tools.length) throw Error('工具选择不能重复');
 return tools;
}
export async function discoverTools(call: any) {
 const modules: any[] = []; let cursor: string | undefined;
 do { const p: any = await call('modules.list', {limit:100, ...(cursor ? {cursor} : {})}); modules.push(...p.items); cursor=p.nextCursor??undefined; } while(cursor);
 const names = new Map(modules.map(m=>[m.id,m.name])); const tools = new Map<string, any>(); cursor=undefined;
 do { const p: any = await call('modules.describe', {audience:'user',limit:100,...(cursor?{cursor}:{})});
  for(const t of p.items??[]) {
   // audience:user is filtered by the current caller's discoveryAdmission.
   // selectContextTools includes systemEntries as well as module entries.
   const target = t.target;
   const module = typeof target === 'string' ? target.split('.')[0] : names.get(target.moduleId) ?? target.moduleId;
   const name = typeof target === 'string' ? target.split('.')[1] : target.tool;
   const app = modules.find(m=>m.name===module);
   const key = typeof target === 'string' && app ? targetKey({moduleId:app.id,tool:name}) : targetKey(target);
   // module-tools.addModuleTools skips generated Provider names longer than 64.
   // systemEntries uses its own names and is not subject to that module-entry filter.
   const generated = `m_${module.replaceAll('-', '_')}_${name.replaceAll('-', '_')}`;
   const available = !app || generated.length <= 64;
   if (!tools.has(key)) tools.set(key, {...t,module,name,available,...(!available ? {reason:`内核生成的工具名长度${generated.length}超过64，无法委派；请应用作者缩短应用名或工具名后恢复。`} : {})});
  } cursor=p.nextCursor??undefined;
 } while(cursor);
 return [...tools.values()];
}
export function defaultTools(tools: any[]) { return validateTools(tools.filter(t=>t.available!==false).map(t=>t.target)); }
