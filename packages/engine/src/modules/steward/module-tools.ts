import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { moduleSupervisor } from "./module-supervisor";
import { audit } from "./audit";

/** Tools belong to the workspace; session focus controls only catalog exposure. `audience` is who will call them. */
type Scope = { workspaceId: string; sessionId?: string | null; audience?: "provider" | "owner" };
type Manifest = z.infer<typeof moduleManifestSchema>;
type Tool = Manifest["tools"][number];
/** Active module tools of the workspace the audience may call, ordered deterministically. */
export async function moduleTools(ports: StewardPorts, scope: Scope) {
  const { db } = ports, { workspaceId, sessionId, audience = "provider" } = scope;
  const session = sessionId ? await db.session.findFirst({ where: { id: sessionId, workspaceId } }) : null;
  const focus = Array.isArray(session?.focus) ? session.focus : [];
  const modules = await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const tools = [], names = new Set<string>(), toolsets = new Set<string>();
  for (const module of modules) {
    // One toolset per module name, like one MCP server per name.
    if (toolsets.has(module.name)) continue;
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    const visible = parsed.success ? parsed.data.tools.filter(tool => tool.visibility.includes(audience)) : [];
    if (!parsed.success || !visible.length) continue;
    toolsets.add(module.name);
    for (const tool of visible) {
      const name = `m_${module.name.replaceAll("-", "_")}_${tool.name.replaceAll("-", "_")}`;
      if (name.length > 64 || names.has(name)) continue;
      names.add(name);
      tools.push({ name, module, manifest: { ...parsed.data, tools: visible }, tool, direct: focus.includes(module.name) });
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
export function validateToolArgs(tool: Tool, raw: unknown): Record<string, unknown> {
  return parseInput(z.object(moduleToolShape(tool)).strict(), raw);
}
/** Runs a workspace-owned module tool for a Provider run or the owner (`via`: the entry module that relayed an owner request). */
export async function callModuleTool(ports: StewardPorts, caller: Omit<Scope, "audience"> & { runId: string | null; via?: string | null }, name: string, raw: unknown) {
  const audience = caller.runId ? "provider" as const : "owner" as const;
  const resolved = (await moduleTools(ports, { ...caller, audience })).find(tool => tool.name === name);
  if (!resolved) throw new StewardError("not_found", "Module tool not found");
  const args = validateToolArgs(resolved.tool, raw), now = ports.now(), { module, tool } = resolved;
  await audit(ports.db, { workspaceId: caller.workspaceId, actor: caller.runId ? "chrona" : "user", kind: "module_tool_call", subjectId: module.id, details: { tool: name, callerRunId: caller.runId, callerSessionId: caller.sessionId ?? null, via: caller.via ?? null } });
  try {
    const reply = await moduleSupervisor(ports).deliver(module.id, module.activeHash!, { trigger: { id: tool.name, kind: "tool", firedAt: now.toISOString(), args,
      caller: caller.runId ? { kind: "provider", runId: caller.runId } : { kind: "owner", via: caller.via ?? null } }, now: now.toISOString(), params: {} });
    if ("error" in reply) throw new Error(reply.error);
    return { result: reply.result.result };
  } catch (cause) { throw new StewardError("conflict", (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000)); }
}
