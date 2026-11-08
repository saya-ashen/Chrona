type Row = Record<string, unknown>;
type Call = (target: string, args?: Row) => Promise<unknown>;
type Interface = Row & { name: string; sessions: string | null };

/** Web owns the page projection; each source remains a separately authorized routed read. */
export async function systemApps(call: Call, module?: string) {
  const metadata = await call("modules.interfaces") as Interface[];
  if (module === undefined) return metadata;
  const entry = metadata.find(item => item.name === module);
  if (!entry) throw Object.assign(new Error(`System module ${module} not found`), { code: "not_found" });
  return withWork(call, entry);
}
async function withWork(call: Call, entry: Interface) {
  const work = entry.sessions ? await call("history.sessions", { source: entry.sessions, limit: 20 }) : [];
  return { ...entry, work };
}
export async function appOverview(call: Call, module: string) {
  const interfaces = await call("modules.interfaces") as Interface[];
  const system = interfaces.find(item => item.name === module);
  if (system) {
    const [settings, activity, entry] = await Promise.all([
      call("modules.settings-get", { module }), call("notify.activity", { module, limit: 30 }), withWork(call, system),
    ]);
    return { kind: "system", ...entry as Row, settings, activity: (activity as { items: unknown[] }).items };
  }
  const apps = await call("modules.list") as (Row & { id: string; name: string })[];
  const app = apps.find(item => item.id === module || item.name === module);
  if (!app) throw Object.assign(new Error(`Module ${module} not found`), { code: "not_found" });
  const args = { module: app.name };
  const [metadata, permissions, settings, diagnostics, activity] = await Promise.all([
    call("modules.interfaces", args), call("modules.permissions", args), call("modules.settings-get", args), call("modules.diagnostics", args), call("notify.activity", { ...args, limit: 30 }),
  ]);
  return { kind: "app", app, tools: (metadata as Row).tools, permissions, settings, diagnostics: (diagnostics as unknown[])[0] ?? null, activity: (activity as { items: unknown[] }).items };
}
