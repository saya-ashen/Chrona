type Row = Record<string, unknown>;
type Call = (target: string, args?: Row) => Promise<unknown>;
type Tool = Row & { target: string; moduleId?: string };
type App = Row & { id: string; name: string };
export const kernelNamespaces = ["modules", "approvals", "settings", "secrets", "activity", "timers"];
const notFound = (module: string) => Object.assign(new Error(`App or kernel namespace ${module} not found`), { code: "not_found" });
const boundedTools = (tools: Tool[]) => ({ tools: tools.slice(0, 50), truncated: tools.length > 50 });

type KernelEntry = { name: string; origin: string; tools: Tool[]; truncated: boolean };
/** MCP owns this read-only projection. Discovery grants no invocation authority. */
export function systemApps(call: Call, module: string): Promise<KernelEntry>;
export function systemApps(call: Call, module?: undefined): Promise<KernelEntry[]>;
export function systemApps(call: Call, module?: string): Promise<KernelEntry | KernelEntry[]>;
export async function systemApps(call: Call, module?: string) {
  const tools = await call("modules.describe", { audience: "user" }).then(page => (page as { items: unknown }).items) as Tool[];
  const entries = kernelNamespaces.flatMap(name => {
    const contracts = tools.filter(tool => tool.moduleId === undefined && tool.target.startsWith(`${name}.`));
    return contracts.length ? [{ name, origin: "kernel", ...boundedTools(contracts) }] : [];
  });
  if (module === undefined) return entries;
  const entry = entries.find(item => item.name === module);
  if (!entry) throw notFound(module);
  return entry;
}

/** Bounded installed identity, user-facing contracts and observed diagnostics; no app execution. */
export async function appOverview(call: Call, module: string) {
  if (kernelNamespaces.includes(module)) return { kind: "system" as const, ...await systemApps(call, module) };
  const apps = await call("modules.list").then(page => (page as { items: unknown }).items) as App[];
  const app = apps.find(item => item.id === module || item.name === module);
  if (!app) throw notFound(module);
  const [tools, diagnostics] = await Promise.all([
    call("modules.describe", { query: `${app.name}.`, audience: "user" }).then(page => (page as { items: unknown }).items) as Promise<Tool[]>,
    call("modules.health", { moduleId: app.id, detail: true }).then(page => (page as { items: unknown }).items) as Promise<(Row & { moduleId: string })[]>,
  ]);
  return { kind: "app" as const, app, ...boundedTools(tools.filter(tool => tool.moduleId === app.id && tool.target.startsWith(`${app.name}.`))), diagnostics: diagnostics.find(item => item.moduleId === app.id) ?? null };
}
