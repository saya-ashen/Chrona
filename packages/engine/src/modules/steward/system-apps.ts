import type { StewardPorts } from "./ports";
import { CallError, listSystemModules } from "./module-calls";

/** v2-20: system modules are Chrona's code, not versions: shown read-only, with the conversations they work in. */
export async function systemApps(ports: StewardPorts, workspaceId: string, name?: string) {
  const apps = listSystemModules().map(module => ({ name: module.name, description: module.description, sessions: module.sessions ?? null,
    tools: module.tools.map(tool => ({ name: tool.name, description: tool.description, callers: tool.callers ?? null, visibility: tool.visibility })) }));
  if (name === undefined) return apps;
  const app = apps.find(item => item.name === name);
  if (!app) throw new CallError("not_found", "System module not found");
  const work = app.sessions ? await ports.db.session.findMany({ where: { workspaceId, source: app.sessions }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, createdAt: true, endedAt: true } }) : [];
  return { ...app, work };
}
