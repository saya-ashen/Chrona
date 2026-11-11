type Row = Record<string, unknown>;
type Call = (target: string, args?: Row) => Promise<unknown>;
type Tool = Row & { target: string; moduleId?: string };
type App = Row & { id: string; name: string };
type Diagnostic = Row & { moduleId: string };

const kernelDescriptions = {
  agent: "Agent Providers 与受治理的执行。",
  approvals: "授权请求与审批记录。",
  modules: "已安装模块、可发现的工具合同、诊断与受治理的生命周期。",
  settings: "内核运行设置与授权规则。",
  secrets: "凭据的受控存取与授权。",
  activity: "内核运行事实与消费确认。",
  timers: "应用持久唤醒与预算。",
};

/** Only known kernel namespaces without an application identity belong in this projection. */
function kernelEntries(tools: Tool[]) {
  return Object.entries(kernelDescriptions).flatMap(([name, description]) => {
    const contracts = tools.filter(tool => tool.moduleId === undefined && tool.target.startsWith(`${name}.`));
    return contracts.length ? [{ name, origin: "kernel" as const, description, tools: contracts }] : [];
  });
}
function notFound(module: string) {
  return Object.assign(new Error(`Module ${module} not found`), { code: "not_found" });
}

/** Web owns the page projection; discovery returns only currently reachable contracts. */
export async function systemApps(call: Call, module?: string) {
  const entries = kernelEntries(await call("modules.describe").then(page => (page as { items: unknown }).items) as Tool[]);
  if (module === undefined) return entries;
  const entry = entries.find(item => item.name === module);
  if (!entry) throw notFound(module);
  return entry;
}

/** null means activity is undiscovered; a discovered source's errors must remain visible. */
async function recentActivity(call: Call, tools: Tool[], module: string) {
  if (!tools.some(tool => tool.target === "notify.activity")) return null;
  return (await call("notify.activity", { module, limit: 30 }) as { items: unknown[] }).items;
}

export async function appOverview(call: Call, module: string) {
  const tools = await call("modules.describe").then(page => (page as { items: unknown }).items) as Tool[];
  const system = kernelEntries(tools).find(item => item.name === module);
  if (system) return { kind: "system" as const, ...system, activity: await recentActivity(call, tools, module) };

  const apps = await call("modules.list").then(page => (page as { items: unknown }).items) as App[];
  const app = apps.find(item => item.id === module || item.name === module);
  if (!app) throw notFound(module);
  const [diagnostics, activity] = await Promise.all([
    call("modules.health", { moduleId: app.id, detail: true }).then(page => (page as { items: unknown }).items) as Promise<Diagnostic[]>,
    recentActivity(call, tools, app.name),
  ]);
  return {
    kind: "app" as const, app,
    tools: tools.filter(tool => tool.moduleId === app.id && tool.target.startsWith(`${app.name}.`)),
    diagnostics: diagnostics.find(item => item.moduleId === app.id) ?? null,
    activity,
  };
}
