import { z } from "zod";
import type { StewardPorts } from "./ports";
import { moduleCapabilities } from "./module-identity";
import { CallError, listSystemModules, normalizedToolInputSchema } from "./module-calls";

/** v2-20: system modules are Chrona's code, not versions: shown read-only, with the conversations they work in. */
export async function systemApps(ports: StewardPorts, workspaceId: string, name?: string) {
  const apps = listSystemModules().map(module => ({ origin: "kernel" as const, capabilities: moduleCapabilities("kernel", { configurable: !!module.settings }), name: module.name, description: module.description, sessions: module.sessions ?? null,
    tools: module.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: "input" in tool && tool.input ? z.toJSONSchema(tool.input) : normalizedToolInputSchema(tool),
      outputSchema: tool.output ? z.toJSONSchema(tool.output as z.ZodType) : null, examples: "examples" in tool ? tool.examples ?? null : null,
      sideEffects: "sideEffects" in tool ? tool.sideEffects ?? null : null, errors: "errors" in tool ? tool.errors ?? null : null,
      idempotent: tool.idempotent, retry: tool.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.",
      visibility: tool.visibility })) }));
  if (name === undefined) return apps;
  const app = apps.find(item => item.name === name);
  if (!app) throw new CallError("not_found", "System module not found");
  const work = app.sessions ? await ports.db.session.findMany({ where: { workspaceId, source: app.sessions }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, createdAt: true, endedAt: true } }) : [];
  return { ...app, work };
}
