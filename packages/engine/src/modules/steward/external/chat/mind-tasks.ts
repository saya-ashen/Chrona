type Caller = { kind:string; moduleId?:string };
type Call = (target:{moduleId:string;tool:string},args:Record<string,unknown>)=>Promise<unknown>;
/** Only Web's authenticated page callback may delegate the owner's all-task view. */
export async function mindTaskCall(call:Call, dependencies:Record<string,string>, caller:Caller|undefined,
  tool:'task-view'|'task-control', args:Record<string,unknown>) {
  if (caller?.kind !== 'module' || !dependencies.web || caller.moduleId !== dependencies.web)
    throw Object.assign(Error('任务仅可通过已登录的 Web 页面查看或操作'),{code:'forbidden'});
  if (!dependencies.mind) throw Object.assign(Error('Mind 尚未安装或绑定，暂时无法加载后台任务。普通对话仍可使用。'),{code:'unavailable'});
  const raw = await call({moduleId:dependencies.mind,tool},args);
  if (!raw || typeof raw !== 'object' || !('json' in raw) || typeof raw.json !== 'string') throw Error('Mind 任务返回格式不正确');
  const value = JSON.parse(raw.json);
  if (value?.error) throw Object.assign(Error(value.error.message),{code:value.error.code});
  return value;
}
