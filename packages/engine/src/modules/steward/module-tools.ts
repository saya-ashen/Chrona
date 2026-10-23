import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { moduleSupervisor } from "./module-supervisor";
import { audit } from "./audit";

/** Tools belong to the workspace; session focus controls only catalog exposure. */
type Scope = { workspaceId: string; sessionId?: string | null };
type Manifest = z.infer<typeof moduleManifestSchema>;
type Tool = Manifest["tools"][number];
/** Active module tools of the workspace, ordered deterministically. */
export async function moduleTools(ports: StewardPorts, scope: Scope) {
  const { db } = ports, { workspaceId, sessionId } = scope;
  const session = sessionId ? await db.session.findFirst({ where: { id: sessionId, workspaceId } }) : null;
  const focus = Array.isArray(session?.focus) ? session.focus : [];
  const modules = await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const tools = [], names = new Set<string>(), toolsets = new Set<string>();
  for (const module of modules) {
    // One toolset per module name, like one MCP server per name.
    if (toolsets.has(module.name)) continue;
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    if (!parsed.success || !parsed.data.tools.length) continue;
    toolsets.add(module.name);
    for (const tool of parsed.data.tools) {
      const name = `m_${module.name.replaceAll("-", "_")}_${tool.name.replaceAll("-", "_")}`;
      if (name.length > 64 || names.has(name)) continue;
      names.add(name);
      tools.push({ name, module, manifest: parsed.data, tool, direct: focus.includes(module.name) });
    }
  }
  return tools;
}
type Resolved = Awaited<ReturnType<typeof moduleTools>>[number];
function toolset({ module, manifest }: Resolved) {
  return { name: `module_${module.name.replaceAll("-", "_")}`, description: (manifest.description ?? manifest.tools.map(tool => tool.description).join("; ")).slice(0, 500) };
}
/** Focused tools are direct; all others are deferred and grouped per module. */
export async function moduleToolCatalog(ports: StewardPorts, scope: Scope) {
  return (await moduleTools(ports, scope)).map(resolved => ({ name: resolved.name, exposure: resolved.direct ? "direct" as const : "deferred" as const, namespace: toolset(resolved),
    inputSchema: { ...resolved.tool.parameters, additionalProperties: false, description: `[module ${resolved.module.name}] ${resolved.tool.description}` } }));
}
type CatalogEntry = Awaited<ReturnType<typeof moduleToolCatalog>>[number];
/** Deferred tools grouped per module, like a list of MCP servers, so callers know what to search for. */
export function moduleToolsets(catalog: CatalogEntry[]) {
  const sets = new Map<string, CatalogEntry["namespace"] & { tools: string[] }>();
  for (const { name, exposure, namespace } of catalog) {
    if (exposure === "deferred") (sets.get(namespace.name) ?? sets.set(namespace.name, { ...namespace, tools: [] }).get(namespace.name)!).tools.push(name);
  }
  return [...sets.values()];
}
export function moduleToolShape(tool: Tool) {
  return Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, property]) => {
    let schema: z.ZodType = "enum" in property ? z.enum(property.enum) : z[property.type]();
    if (property.description) schema = schema.describe(property.description);
    if (!tool.parameters.required.includes(key)) schema = schema.optional();
    return [key, schema];
  }));
}
function validateArgs(tool: Tool, raw: unknown) {
  return parseInput(z.object(moduleToolShape(tool)).strict(), raw);
}
async function runTool(ports: StewardPorts, resolved: Resolved, args: Record<string, unknown>, now: Date) {
  const { module, manifest, tool } = resolved;
  return moduleSupervisor(ports).deliver(module.id, module.activeHash!, { trigger: { id: tool.name, kind: "tool", firedAt: now.toISOString(), args }, now: now.toISOString(), params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) });
}
/** Runs a workspace-owned module tool for a Provider run or the owner. */
export async function callModuleTool(ports: StewardPorts, caller: Scope & { runId: string | null }, name: string, raw: unknown) {
  const resolved = (await moduleTools(ports, caller)).find(tool => tool.name === name);
  if (!resolved) throw new StewardError("not_found", "Module tool not found");
  const args = validateArgs(resolved.tool, raw), now = ports.now(), { module } = resolved;
  await audit(ports.db, { workspaceId: caller.workspaceId, actor: caller.runId ? "chrona" : "user", kind: "module_tool_call", subjectId: module.id, details: { tool: name, callerRunId: caller.runId, callerSessionId: caller.sessionId ?? null } });
  try {
    const reply = await runTool(ports, resolved, args, now);
    if ("error" in reply) throw new Error(reply.error);
    return { result: reply.result.result };
  } catch (cause) { throw new StewardError("conflict", (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000)); }
}
